import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase.js';

export async function mirrorAyahBookmark(bookmark) {
  const user = auth.currentUser;
  if (!user || !bookmark?.surah || !bookmark?.ayah) return false;
  try {
    await setDoc(doc(db, 'users', user.uid, 'data', `bookmark_ayah_${bookmark.surah}_${bookmark.ayah}`), {
      kind: 'ayah',
      surah: bookmark.surah,
      ayah: bookmark.ayah,
      surahName: bookmark.surahName,
      text: bookmark.text,
      createdAt: bookmark.createdAt,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export async function mirrorReaderState() {
  const user = auth.currentUser;
  if (!user) return false;
  const read = (key) => {
    try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
  };
  try {
    await setDoc(doc(db, 'users', user.uid, 'data', 'bookmarks'), {
      kind: 'reader_state',
      pageBookmarks: Array.isArray(read('zad.bookmarks')) ? read('zad.bookmarks').slice(0, 500) : [],
      ayahBookmarks: (Array.isArray(read('zad.ayahBookmarks')) ? read('zad.ayahBookmarks') : []).slice(0, 500)
        .map(({ id, surah, ayah, surahName, createdAt }) => ({ id, surah, ayah, surahName, createdAt })),
      readingPosition: read('zad.lastRead'),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export function startReaderStateMirror() {
  const user = auth.currentUser;
  if (!user) return () => {};

  const readerStateRef = doc(db, 'users', user.uid, 'data', 'bookmarks');
  const legacyReaderStateRef = doc(db, 'users', user.uid, 'bookmarks', 'reader_state');
  let timer = 0;
  let fallbackTimer = 0;
  let isReady = false;
  let stopped = false;
  let hasServerSnapshot = false;
  let primaryStateExists = false;
  let localChangedBeforeReady = false;

  const schedule = () => {
    if (!isReady || stopped || !hasServerSnapshot) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void mirrorReaderState();
    }, 450);
  };

  const readJson = (key, fallback) => {
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  const mergeList = (local, cloud, keyOf) => {
    const merged = new Map();
    [...(Array.isArray(cloud) ? cloud : []), ...(Array.isArray(local) ? local : [])].forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const key = keyOf(item);
      if (key) merged.set(key, item);
    });
    return [...merged.values()].slice(0, 500);
  };

  const writeLocal = (key, value, restoredKeys) => {
    const serialized = JSON.stringify(value);
    try {
      if (window.localStorage.getItem(key) === serialized) return;
      window.localStorage.setItem(key, serialized);
      restoredKeys.push(key);
      window.dispatchEvent(new CustomEvent('uns:local-data-changed', { detail: { key, value: serialized } }));
    } catch { /* Keep this device's current value if local storage is unavailable. */ }
  };

  const applyCloudState = (cloud = {}) => {
    const localPageBookmarks = readJson('zad.bookmarks', []);
    const localAyahBookmarks = readJson('zad.ayahBookmarks', []);
    const localPosition = readJson('zad.lastRead', null);
    const pageBookmarks = mergeList(localPageBookmarks, cloud.pageBookmarks, (item) => item.id || (item.page ? `page-${item.page}` : ''));
    const ayahBookmarks = mergeList(localAyahBookmarks, cloud.ayahBookmarks, (item) => item.id || (item.surah && item.ayah ? `${item.surah}:${item.ayah}` : ''));
    const readingPosition = localPosition ?? cloud.readingPosition ?? null;
    const restoredKeys = [];
    writeLocal('zad.bookmarks', pageBookmarks, restoredKeys);
    writeLocal('zad.ayahBookmarks', ayahBookmarks, restoredKeys);
    if (readingPosition) writeLocal('zad.lastRead', readingPosition, restoredKeys);
    if (restoredKeys.length) {
      window.dispatchEvent(new CustomEvent('uns:cloud-data-restored', { detail: { keys: restoredKeys } }));
    }

    const cloudPageBookmarks = Array.isArray(cloud.pageBookmarks) ? cloud.pageBookmarks : [];
    const cloudAyahBookmarks = Array.isArray(cloud.ayahBookmarks) ? cloud.ayahBookmarks : [];
    const needsUpload = localChangedBeforeReady
      || JSON.stringify(pageBookmarks) !== JSON.stringify(cloudPageBookmarks)
      || JSON.stringify(ayahBookmarks) !== JSON.stringify(cloudAyahBookmarks)
      || JSON.stringify(readingPosition) !== JSON.stringify(cloud.readingPosition ?? null);
    localChangedBeforeReady = false;
    if (needsUpload) schedule();
  };

  const markReadyFromLocal = () => {
    if (isReady || stopped) return;
    isReady = true;
  };

  const unsubscribe = onSnapshot(readerStateRef, { includeMetadataChanges: true }, (snapshot) => {
    if (stopped) return;
    if (snapshot.metadata.fromCache && navigator.onLine !== false) return;
    primaryStateExists = snapshot.exists();
    hasServerSnapshot = !snapshot.metadata.fromCache;
    isReady = true;
    window.clearTimeout(fallbackTimer);
    applyCloudState(snapshot.exists() ? snapshot.data() : {});
  }, () => {
    markReadyFromLocal();
  });
  const unsubscribeLegacy = onSnapshot(legacyReaderStateRef, { includeMetadataChanges: true }, (snapshot) => {
    if (stopped || (snapshot.metadata.fromCache && navigator.onLine !== false)) return;
    if (!primaryStateExists && snapshot.exists()) {
      hasServerSnapshot = !snapshot.metadata.fromCache;
      isReady = true;
      window.clearTimeout(fallbackTimer);
      applyCloudState(snapshot.data());
    }
  }, () => { /* Existing bookmark documents may not be available; keep local state. */ });
  fallbackTimer = window.setTimeout(markReadyFromLocal, 7_000);

  const onLocalData = (event) => {
    if (['zad.bookmarks', 'zad.ayahBookmarks', 'zad.lastRead'].includes(event.detail?.key)) {
      if (isReady && hasServerSnapshot) schedule();
      else localChangedBeforeReady = true;
    }
  };
  const onOffline = () => {
    if (!isReady) markReadyFromLocal();
    else schedule();
  };
  const onOnline = () => {
    if (!isReady) markReadyFromLocal();
    if (hasServerSnapshot) schedule();
  };
  window.addEventListener('uns:local-data-changed', onLocalData);
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearTimeout(fallbackTimer);
    unsubscribe();
    unsubscribeLegacy();
    window.removeEventListener('uns:local-data-changed', onLocalData);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
  };
}
