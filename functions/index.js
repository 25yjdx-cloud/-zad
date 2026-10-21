import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

initializeApp();

const db = getFirestore();
const reminderCopy = {
  quran: ['حان وقت ورد القرآن', 'افتح المصحف وأكمل وردك اليومي.'],
  morning: ['حان وقت أذكار الصباح', 'ابدأ يومك بذكر الله.'],
  evening: ['حان وقت أذكار المساء', 'اختم يومك بأذكار المساء.'],
};

function localScheduleParts(timeZone, now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function chunks(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

async function sendDueReminder(userId, settingsRef, settings, reminderKey, date) {
  const devicesSnapshot = await db.collection('users').doc(userId).collection('settings').get();
  const devices = devicesSnapshot.docs
    .filter((item) => item.id.startsWith('device-') && typeof item.data().token === 'string')
    .map((item) => ({ ref: item.ref, token: item.data().token }));
  if (!devices.length) return;

  const [title, body] = reminderCopy[reminderKey];
  let sentAny = false;
  for (const batch of chunks(devices, 500)) {
    const result = await getMessaging().sendEachForMulticast({
      tokens: batch.map(({ token }) => token),
      // Data-only payloads are rendered by the app's service worker push handler.
      data: { title, body, url: '/', tag: `uns-${reminderKey}-${date}` },
      webpush: { headers: { TTL: '60' } },
    });
    sentAny ||= result.successCount > 0;
    const staleTokens = result.responses.flatMap((response, index) => (
      response.error?.code === 'messaging/registration-token-not-registered'
        || response.error?.code === 'messaging/invalid-registration-token'
        ? [batch[index].ref.delete()]
        : []
    ));
    if (staleTokens.length) await Promise.all(staleTokens);
  }

  if (sentAny) {
    await settingsRef.set({
      lastSent: { ...(settings.lastSent || {}), [reminderKey]: date },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

export const sendScheduledReminders = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'Etc/UTC',
  maxInstances: 1,
}, async () => {
  const now = new Date();
  const eligible = await db.collectionGroup('settings').where('permission', '==', 'granted').get();
  const jobs = [];

  for (const snapshot of eligible.docs) {
    if (snapshot.id !== 'notifications' || snapshot.ref.parent.id !== 'settings') continue;
    const segments = snapshot.ref.path.split('/');
    if (segments.length !== 4 || segments[0] !== 'users') continue;
    const userId = segments[1];
    const settings = snapshot.data();
    const timeZone = typeof settings.timeZone === 'string' ? settings.timeZone : 'UTC';
    let localTime;
    try { localTime = localScheduleParts(timeZone, now); } catch {
      logger.warn('Skipping a reminder with an invalid timezone.', { userId });
      continue;
    }
    for (const reminderKey of Object.keys(reminderCopy)) {
      if (settings.reminders?.[reminderKey] !== localTime.time
        || settings.lastSent?.[reminderKey] === localTime.date) continue;
      jobs.push(sendDueReminder(userId, snapshot.ref, settings, reminderKey, localTime.date));
    }
  }

  const results = await Promise.allSettled(jobs);
  const failures = results.filter(({ status }) => status === 'rejected');
  if (failures.length) logger.error('Some scheduled reminder sends failed.', { count: failures.length });
});
