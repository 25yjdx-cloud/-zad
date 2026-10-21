import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase.js';

const REMINDERS_KEY = 'zad.reminders';
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function readReminders() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REMINDERS_KEY) || '{}');
    return Object.fromEntries(['quran', 'morning', 'evening'].map((key) => [
      key, typeof parsed[key] === 'string' ? parsed[key] : '',
    ]));
  } catch {
    return { quran: '', morning: '', evening: '' };
  }
}

function saveReminders(reminders, announce = true) {
  try {
    const previous = JSON.parse(window.localStorage.getItem(REMINDERS_KEY) || '{}');
    const next = { ...previous, ...reminders };
    window.localStorage.setItem(REMINDERS_KEY, JSON.stringify(next));
    if (announce) {
      window.dispatchEvent(new CustomEvent('uns:local-data-changed', {
        detail: { key: REMINDERS_KEY, value: JSON.stringify(next) },
      }));
    }
  } catch { /* Current browser session still has the selected reminder values. */ }
}

async function saveDeviceToken(uid, registration) {
  if (!VAPID_KEY) return false;
  try {
    const messagingApi = await import('firebase/messaging');
    if (!await messagingApi.isSupported()) return false;
    const messaging = messagingApi.getMessaging();
    const token = await messagingApi.getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return false;
    let deviceId = window.localStorage.getItem('uns.push.deviceId');
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      window.localStorage.setItem('uns.push.deviceId', deviceId);
    }
    await setDoc(doc(db, 'users', uid, 'settings', `device-${deviceId}`), {
      token,
      platform: navigator.userAgent.slice(0, 40),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function enableBrowserNotifications(uid) {
  if (!('Notification' in window)) return { permission: 'unsupported', pushReady: false };
  const permission = Notification.permission === 'default'
    ? await Notification.requestPermission()
    : Notification.permission;
  if (permission !== 'granted') return { permission, pushReady: false };

  const registration = 'serviceWorker' in navigator
    ? await navigator.serviceWorker.ready
    : null;
  let pushReady = false;
  if (uid && registration) pushReady = await saveDeviceToken(uid, registration);
  if (uid) {
    await setDoc(doc(db, 'users', uid, 'settings', 'notifications'), {
      reminders: readReminders(),
      permission,
      timeZone: DEVICE_TIME_ZONE,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }
  return { permission, pushReady };
}

export function startNotificationSettingsSync(uid) {
  const settingsRef = doc(db, 'users', uid, 'settings', 'notifications');
  let isWriting = false;
  const unsubscribe = onSnapshot(settingsRef, (snapshot) => {
    if (!snapshot.exists()) {
      if (window.localStorage.getItem(REMINDERS_KEY)) {
        isWriting = true;
        setDoc(settingsRef, {
          reminders: readReminders(),
          permission: 'Notification' in window ? Notification.permission : 'default',
          timeZone: DEVICE_TIME_ZONE,
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {
          // Keep local preferences and retry when the account reconnects.
        }).finally(() => { isWriting = false; });
      }
      return;
    }
    const reminders = snapshot.data().reminders;
    if (!reminders || typeof reminders !== 'object') return;
    const restoredReminders = Object.fromEntries(['quran', 'morning', 'evening'].map((key) => [
      key, typeof reminders[key] === 'string' ? reminders[key] : '',
    ]));
    saveReminders(restoredReminders, false);
    window.dispatchEvent(new CustomEvent('uns:notification-settings-restored', {
      detail: { reminders: restoredReminders },
    }));
  }, () => { /* Retain browser-local preferences when Firestore is unavailable. */ });

  const writePreferences = async (event) => {
    if (event.detail?.key !== REMINDERS_KEY || isWriting) return;
    isWriting = true;
    try {
      await setDoc(settingsRef, {
        reminders: readReminders(),
        permission: 'Notification' in window ? Notification.permission : 'default',
        timeZone: DEVICE_TIME_ZONE,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch {
      // Keep local preferences and retry after the next settings change.
    } finally {
      isWriting = false;
    }
  };
  window.addEventListener('uns:local-data-changed', writePreferences);
  return () => {
    unsubscribe();
    window.removeEventListener('uns:local-data-changed', writePreferences);
  };
}
