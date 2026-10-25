import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { mirrorLegacyStorageKey } from './unsDatabase.js';

const LOCAL_KEY_PREFIX = 'zad.';
const PENDING_KEYS_STORAGE_PREFIX = 'uns.firebase.pendingKeys.';
const GLOBAL_PENDING_KEYS_STORAGE = 'uns.firebase.pendingLocalKeys';
const OWNER_UID_STORAGE = 'uns.firebase.ownerUid';
const MAX_SYNC_VALUE_LENGTH = 300_000;
const INITIAL_SYNC_TIMEOUT_MS = 7_000;
const SYNC_WRITE_TIMEOUT_MS = 7_000;
const EXCLUDED_KEYS = new Set(['zad.demoProfile']);
const WORSHIP_RECORD_IDS = new Map([
  ['zad.selfAccountability.v1', 'accountability'],
  ['zad.worshipTracking.v1', 'tracking'],
]);

function readPendingKeys(uid) {
  try {
    const keys = JSON.parse(window.localStorage.getItem(`${PENDING_KEYS_STORAGE_PREFIX}${uid}`) || '[]');
    return new Set(Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function savePendingKeys(uid, keys) {
  try {
    const key = `${PENDING_KEYS_STORAGE_PREFIX}${uid}`;
    if (keys.size) window.localStorage.setItem(key, JSON.stringify([...keys]));
    else window.localStorage.removeItem(key);
  } catch { /* Local data remains the offline fallback if pending markers cannot be saved. */ }
}

function readGlobalPendingKeys() {
  try {
    const keys = JSON.parse(window.localStorage.getItem(GLOBAL_PENDING_KEYS_STORAGE) || '[]');
    return new Set(Array.isArray(keys) ? keys.filter((key) => typeof key === 'string' && isSyncableKey(key)) : []);
  } catch {
    return new Set();
  }
}

function saveGlobalPendingKeys(keys) {
  try {
    if (keys.size) window.localStorage.setItem(GLOBAL_PENDING_KEYS_STORAGE, JSON.stringify([...keys]));
    else window.localStorage.removeItem(GLOBAL_PENDING_KEYS_STORAGE);
  } catch { /* Local fallback is still usable if pending markers cannot be saved. */ }
}

function isSyncableKey(key) {
  return typeof key === 'string'
    && key.startsWith(LOCAL_KEY_PREFIX)
    && !EXCLUDED_KEYS.has(key)
    && /^[a-zA-Z0-9._-]{1,128}$/u.test(key);
}

function readLocalData() {
  const values = new Map();
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!isSyncableKey(key)) continue;
      const value = window.localStorage.getItem(key);
      if (typeof value === 'string' && value.length <= MAX_SYNC_VALUE_LENGTH) values.set(key, value);
    }
  } catch { /* Continue with the local values that could be read. */ }
  return values;
}

function setLocalValue(key, value) {
  if (!isSyncableKey(key) || typeof value !== 'string' || value.length > MAX_SYNC_VALUE_LENGTH) return false;
  try {
    window.localStorage.setItem(key, value);
    void mirrorLegacyStorageKey(key, value).catch(() => { /* Cloud restoration remains usable without IndexedDB. */ });
    return true;
  } catch {
    return false;
  }
}

function dispatchRestored(keys) {
  if (keys.length) window.dispatchEvent(new CustomEvent('uns:cloud-data-restored', { detail: { keys } }));
}

/* === Start Section: مزامنة بيانات المستخدم مع Firestore === */
export function startFirestoreSync(authenticatedUser, onStatus = () => {}) {
  const uid = authenticatedUser?.uid;
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new TypeError('Firestore sync requires an authenticated Firebase user.');
  }
  const userData = collection(db, 'users', uid, 'data');
  const legacyAppData = collection(db, 'users', uid, 'appData');
  const legacyWorship = collection(db, 'users', uid, 'worship');
  const pendingKeys = readPendingKeys(uid);
  let previousOwner = null;
  try { previousOwner = window.localStorage.getItem(OWNER_UID_STORAGE); } catch { /* Continue with cloud restore. */ }
  const canAdoptLocalData = !previousOwner || previousOwner === uid;
  const globalPendingKeys = readGlobalPendingKeys();
  if (canAdoptLocalData) {
    globalPendingKeys.forEach((key) => pendingKeys.add(key));
    savePendingKeys(uid, pendingKeys);
  } else if (globalPendingKeys.size) {
    globalPendingKeys.clear();
    saveGlobalPendingKeys(globalPendingKeys);
  }
  if (!canAdoptLocalData && pendingKeys.size) {
    pendingKeys.clear();
    savePendingKeys(uid, pendingKeys);
  }
  const activeUploads = new Map();
  let isReady = false;
  let isActive = true;
  let appDataReady = false;
  let legacyAppDataReady = false;
  let worshipReady = false;
  let appDataSyncAvailable = true;
  let syncDeadlineReached = false;
  const failedWrites = new Set();
  let appCloudValues = new Map();
  let legacyAppCloudValues = new Map();
  let legacyWorshipValues = new Map();

  function publishSyncStatus() {
    if (!isActive) return;
    if (navigator.onLine === false) {
      onStatus({ state: 'offline' });
    } else if (!appDataSyncAvailable || failedWrites.size) {
      onStatus({ state: 'error' });
    } else if (!appDataReady || !legacyAppDataReady || !worshipReady || !isReady || activeUploads.size) {
      onStatus({ state: syncDeadlineReached ? 'offline' : 'syncing' });
    } else {
      onStatus({ state: 'synced' });
    }
  }

  const syncDeadlineTimer = window.setTimeout(() => {
    if (!isReady) {
      syncDeadlineReached = true;
      publishSyncStatus();
    }
  }, INITIAL_SYNC_TIMEOUT_MS);

  function markPending(key) {
    pendingKeys.add(key);
    savePendingKeys(uid, pendingKeys);
  }

  async function uploadValue(key, value) {
    if (!isActive || !isSyncableKey(key) || typeof value !== 'string' || value.length > MAX_SYNC_VALUE_LENGTH) return;
    if (activeUploads.get(key) === value) return;
    if (navigator.onLine === false) {
      publishSyncStatus();
      return;
    }
    if (!appDataSyncAvailable) return;
    activeUploads.set(key, value);
    publishSyncStatus();
    let writeTimeout = 0;
    try {
      const target = doc(userData, key);
      await Promise.race([
        setDoc(target, { value, updatedAt: serverTimestamp() }),
        new Promise((_, reject) => {
          writeTimeout = window.setTimeout(() => {
            const error = new Error('Firestore write did not finish before the sync deadline.');
            error.code = 'app/sync-timeout';
            reject(error);
          }, SYNC_WRITE_TIMEOUT_MS);
        }),
      ]);
      if (window.localStorage.getItem(key) === value) {
        pendingKeys.delete(key);
        savePendingKeys(uid, pendingKeys);
        globalPendingKeys.delete(key);
        saveGlobalPendingKeys(globalPendingKeys);
      }
      failedWrites.delete(key);
    } catch (error) {
      failedWrites.add(key);
      onStatus({ state: navigator.onLine === false || error?.code === 'app/sync-timeout' ? 'offline' : 'error', error });
    } finally {
      window.clearTimeout(writeTimeout);
      if (activeUploads.get(key) === value) activeUploads.delete(key);
      publishSyncStatus();
    }
  }

  function handleLocalChange(event) {
    const { key, value } = event.detail ?? {};
    if (!isSyncableKey(key) || typeof value !== 'string' || value.length > MAX_SYNC_VALUE_LENGTH) return;
    markPending(key);
    if (isReady) void uploadValue(key, value);
  }

  function handleOtherTabChange(event) {
    if (isSyncableKey(event.key) && typeof event.newValue === 'string') {
      handleLocalChange({ detail: { key: event.key, value: event.newValue } });
    }
  }

  window.addEventListener('uns:local-data-changed', handleLocalChange);
  window.addEventListener('storage', handleOtherTabChange);
  onStatus({ state: 'syncing' });

  function reconcileCloudData() {
    if (!isActive || !appDataReady || !legacyAppDataReady || !worshipReady) return;
    const cloudValues = new Map(appCloudValues);
    legacyAppCloudValues.forEach((value, key) => {
      if (!cloudValues.has(key)) {
        cloudValues.set(key, value);
        void uploadValue(key, value);
      }
    });
    if (worshipReady) {
      WORSHIP_RECORD_IDS.forEach((_recordId, key) => {
        const cloudValue = legacyWorshipValues.get(key);
        if (!cloudValues.has(key) && typeof cloudValue === 'string') {
          cloudValues.set(key, cloudValue);
          void uploadValue(key, cloudValue);
        }
      });
    }

    const restoredKeys = [];
    const localValues = readLocalData();
    cloudValues.forEach((cloudValue, key) => {
      const localValue = localValues.get(key);
      if (canAdoptLocalData && pendingKeys.has(key) && localValue !== null && localValue !== undefined) {
        if (localValue !== cloudValue) void uploadValue(key, localValue);
        else {
          pendingKeys.delete(key);
          savePendingKeys(uid, pendingKeys);
          globalPendingKeys.delete(key);
          saveGlobalPendingKeys(globalPendingKeys);
        }
        return;
      }
      if (localValue !== cloudValue && setLocalValue(key, cloudValue)) {
        restoredKeys.push(key);
        globalPendingKeys.delete(key);
        saveGlobalPendingKeys(globalPendingKeys);
      }
    });

    localValues.forEach((value, key) => {
      if (!appDataSyncAvailable) return;
      if (pendingKeys.has(key) && (!canAdoptLocalData || !cloudValues.has(key))) {
        if (canAdoptLocalData) void uploadValue(key, value);
        return;
      }
      if (cloudValues.has(key)) return;
      if (canAdoptLocalData) void uploadValue(key, value);
      else {
        try {
          window.localStorage.removeItem(key);
          restoredKeys.push(key);
        } catch { /* Cloud stays authoritative for this account. */ }
      }
    });

    try { window.localStorage.setItem(OWNER_UID_STORAGE, uid); } catch { /* Sync still works for this session. */ }

    isReady = true;
    syncDeadlineReached = false;
    dispatchRestored(restoredKeys);
    window.clearTimeout(syncDeadlineTimer);
    publishSyncStatus();
  }

  const unsubscribeAppData = onSnapshot(userData, { includeMetadataChanges: true }, (snapshot) => {
    if (!isActive) return;
    if (snapshot.metadata.fromCache && navigator.onLine !== false) {
      publishSyncStatus();
      return;
    }
    appDataSyncAvailable = true;
    appCloudValues = new Map();
    snapshot.forEach((item) => {
      const value = item.data().value;
      if (isSyncableKey(item.id) && typeof value === 'string') appCloudValues.set(item.id, value);
    });
    appDataReady = true;
    reconcileCloudData();
  }, (error) => {
    if (!isActive) return;
    appDataReady = true;
    appDataSyncAvailable = false;
    onStatus({ state: 'error', error });
    reconcileCloudData();
  });
  const unsubscribeLegacyAppData = onSnapshot(legacyAppData, { includeMetadataChanges: true }, (snapshot) => {
    if (!isActive) return;
    if (snapshot.metadata.fromCache && navigator.onLine !== false) {
      publishSyncStatus();
      return;
    }
    legacyAppCloudValues = new Map();
    snapshot.forEach((item) => {
      const value = item.data().value;
      if (isSyncableKey(item.id) && typeof value === 'string') legacyAppCloudValues.set(item.id, value);
    });
    legacyAppDataReady = true;
    reconcileCloudData();
  }, () => {
    if (!isActive) return;
    legacyAppDataReady = true;
    reconcileCloudData();
  });
  const unsubscribeWorship = onSnapshot(legacyWorship, { includeMetadataChanges: true }, (snapshot) => {
    if (!isActive) return;
    if (snapshot.metadata.fromCache && navigator.onLine !== false) {
      publishSyncStatus();
      return;
    }
    legacyWorshipValues = new Map();
    snapshot.forEach((item) => {
      const localKey = [...WORSHIP_RECORD_IDS].find(([, recordId]) => recordId === item.id)?.[0];
      if (localKey && typeof item.data().value === 'string') legacyWorshipValues.set(localKey, item.data().value);
    });
    worshipReady = true;
    reconcileCloudData();
  }, (error) => {
    if (!isActive) return;
    worshipReady = true;
    reconcileCloudData();
  });

  function handleOffline() {
    publishSyncStatus();
  }

  function handleOnline() {
    syncDeadlineReached = false;
    publishSyncStatus();
    if (!isReady) return;
    const localValues = readLocalData();
    pendingKeys.forEach((key) => {
      const value = localValues.get(key);
      if (typeof value === 'string') void uploadValue(key, value);
    });
  }

  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);

  return () => {
    isActive = false;
    window.clearTimeout(syncDeadlineTimer);
    unsubscribeAppData();
    unsubscribeLegacyAppData();
    unsubscribeWorship();
    window.removeEventListener('uns:local-data-changed', handleLocalChange);
    window.removeEventListener('storage', handleOtherTabChange);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('online', handleOnline);
  };
}
/* === End Section: مزامنة بيانات المستخدم مع Firestore === */
