import Dexie from 'dexie';
import { writeStorage } from './storage.js';

export const UnsDatabase = new Dexie('UnsDatabase');
UnsDatabase.version(1).stores({
  appState: '&key, updatedAt',
  readingProgress: '&id, page, updatedAt',
  pageBookmarks: '&id, page, updatedAt',
  ayahBookmarks: '&id, surah, ayah, updatedAt, [surah+ayah]',
  offlineAzkar: '&id, category, position, updatedAt, [category+position]',
  azkarProgress: '&id, category, updatedAt',
  verseNotes: '&id, surah, ayah, updatedAt, [surah+ayah]',
  verseTafseer: '&id, source, surah, ayah, updatedAt, [source+surah+ayah]',
});

export const unsDatabase = UnsDatabase;

const MAX_LEGACY_VALUE_LENGTH = 300_000;
let databaseReady;
let syncListenerAttached = false;

function safeParse(value) {
  if (typeof value !== 'string' || value.length > MAX_LEGACY_VALUE_LENGTH) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function validPage(value) {
  return Number.isInteger(value) && value >= 1 && value <= 604;
}

function updatedAt() {
  return new Date().toISOString();
}

async function applyLegacyValue(key, serialized, timestamp = updatedAt()) {
  if (typeof key !== 'string' || !key.startsWith('zad.') || typeof serialized !== 'string') return;
  const value = safeParse(serialized);
  await UnsDatabase.appState.put({ key, value: serialized, updatedAt: timestamp });

  if (key === 'zad.lastRead') {
    if (validPage(value?.page)) {
      await UnsDatabase.readingProgress.put({ id: 'current', ...value, updatedAt: timestamp });
    }
  } else if (key === 'zad.bookmarks' && Array.isArray(value)) {
    const rows = value.filter((item) => item && typeof item === 'object' && validPage(item.page))
      .slice(-500)
      .map((item) => ({ ...item, id: String(item.id || `page-${item.page}`), updatedAt: item.updatedAt || timestamp }));
    await UnsDatabase.pageBookmarks.clear();
    if (rows.length) await UnsDatabase.pageBookmarks.bulkPut(rows);
  } else if (key === 'zad.ayahBookmarks' && Array.isArray(value)) {
    const rows = value.filter((item) => item && Number.isInteger(item.surah) && item.surah >= 1 && item.surah <= 114
      && Number.isInteger(item.ayah) && item.ayah >= 1)
      .slice(-500)
      .map((item) => ({ ...item, id: String(item.id || `${item.surah}:${item.ayah}`), updatedAt: item.updatedAt || timestamp }));
    await UnsDatabase.ayahBookmarks.clear();
    if (rows.length) await UnsDatabase.ayahBookmarks.bulkPut(rows);
  } else if (key === 'zad.azkarCounts' && value && typeof value.counts === 'object' && !Array.isArray(value.counts)) {
    const rows = Object.entries(value.counts).filter(([, count]) => Number.isFinite(count) && count >= 0)
      .slice(0, 2_000)
      .map(([id, count]) => ({ id, category: 'progress', count, date: value.date || '', updatedAt: timestamp }));
    await UnsDatabase.azkarProgress.clear();
    if (rows.length) await UnsDatabase.azkarProgress.bulkPut(rows);
  } else if (key === 'zad.notes' || key === 'zad.verseNotes') {
    const noteRows = key === 'zad.notes'
      ? (typeof value === 'string'
        ? [{ id: 'legacy-note', note: value }]
        : value && typeof value === 'object' && !Array.isArray(value)
          ? [{ id: 'legacy-note', note: JSON.stringify(value) }]
          : [])
      : value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).slice(0, 2_000).flatMap(([id, item]) => {
          const match = /^(\d{1,3}):(\d{1,3})$/u.exec(id);
          if (!match) return [];
          const [surah, ayah] = match.slice(1).map(Number);
          if (surah < 1 || surah > 114 || ayah < 1) return [];
          return [{ id, surah, ayah, ...(item && typeof item === 'object' ? item : { note: String(item ?? '') }) }];
        })
        : [];
    if (key === 'zad.notes') {
      await UnsDatabase.verseNotes.delete('legacy-note');
    } else {
      const existing = await UnsDatabase.verseNotes.toCollection().primaryKeys();
      const verseIds = existing.filter((id) => /^\d{1,3}:\d{1,3}$/u.test(String(id)));
      if (verseIds.length) await UnsDatabase.verseNotes.bulkDelete(verseIds);
    }
    const rows = noteRows.map((item) => ({ ...item, updatedAt: item.updatedAt || timestamp }));
    if (rows.length) await UnsDatabase.verseNotes.bulkPut(rows);
  }
}

async function migrateLegacyStorage() {
  const entries = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('zad.')) continue;
      const value = localStorage.getItem(key);
      if (typeof value === 'string' && value.length <= MAX_LEGACY_VALUE_LENGTH) entries.push([key, value]);
    }
  } catch { /* The database remains available if browser storage is disabled. */ }

  await UnsDatabase.transaction('rw', [
    UnsDatabase.appState,
    UnsDatabase.readingProgress,
    UnsDatabase.pageBookmarks,
    UnsDatabase.ayahBookmarks,
    UnsDatabase.azkarProgress,
    UnsDatabase.verseNotes,
  ], async () => {
    for (const [key, value] of entries) await applyLegacyValue(key, value);
  });
}

export function initializeUnsDatabase() {
  if (!syncListenerAttached && typeof window !== 'undefined') {
    syncListenerAttached = true;
    window.addEventListener('uns:local-data-changed', (event) => {
      const { key, value } = event.detail || {};
      if (typeof key === 'string' && typeof value === 'string') {
        void mirrorLegacyStorageKey(key, value).catch(() => { /* Local storage remains the fallback. */ });
      }
    });
  }
  if (!databaseReady) {
    databaseReady = UnsDatabase.open()
      .then(migrateLegacyStorage)
      .catch((error) => {
        databaseReady = undefined;
        throw error;
      });
  }
  return databaseReady;
}

export async function mirrorLegacyStorageKey(key, serialized) {
  await initializeUnsDatabase();
  await UnsDatabase.transaction('rw', [
    UnsDatabase.appState,
    UnsDatabase.readingProgress,
    UnsDatabase.pageBookmarks,
    UnsDatabase.ayahBookmarks,
    UnsDatabase.azkarProgress,
    UnsDatabase.verseNotes,
  ], () => applyLegacyValue(key, serialized));
}

export async function getReadingProgress() {
  await initializeUnsDatabase();
  return (await UnsDatabase.readingProgress.get('current')) || null;
}

export async function saveReadingProgress(page, metadata = {}) {
  if (!validPage(page)) throw new TypeError('Invalid Quran page number.');
  await initializeUnsDatabase();
  const record = { ...metadata, id: 'current', page, updatedAt: updatedAt() };
  await UnsDatabase.readingProgress.put(record);
  if (!writeStorage('zad.lastRead', { ...metadata, page })) {
    throw new Error('Unable to save the local reading progress snapshot.');
  }
  return record;
}

export async function getPageBookmarks() {
  await initializeUnsDatabase();
  return UnsDatabase.pageBookmarks.orderBy('page').toArray();
}

export async function getAyahBookmarks() {
  await initializeUnsDatabase();
  return UnsDatabase.ayahBookmarks.orderBy('[surah+ayah]').toArray();
}

function azkarText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  for (const key of ['text', 'zekr', 'dhikr', 'content', 'arabic', 'النص', 'الذكر']) {
    if (typeof value[key] === 'string') return value[key];
  }
  return '';
}

function flattenAzkar(value, path = [], rows = [], depth = 0) {
  if (depth > 5 || rows.length >= 5_000) return rows;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenAzkar(item, [...path, String(index)], rows, depth + 1));
    return rows;
  }
  if (typeof value === 'string') {
    if (value.trim()) rows.push({ id: path.join(':'), category: path[0] || 'general', position: rows.length, text: value, content: value });
    return rows;
  }
  if (!value || typeof value !== 'object') return rows;
  const text = azkarText(value);
  if (text) {
    rows.push({
      id: path.join(':') || `item-${rows.length}`,
      category: String(value.category || value.group || value.section || path[0] || 'general'),
      position: rows.length,
      text,
      content: value,
    });
    return rows;
  }
  Object.entries(value).forEach(([key, item]) => flattenAzkar(item, [...path, key], rows, depth + 1));
  return rows;
}

export async function cacheOfflineAzkar(payload) {
  await initializeUnsDatabase();
  const rows = flattenAzkar(payload).map((item) => ({ ...item, updatedAt: updatedAt() }));
  if (!rows.length) return 0;
  await UnsDatabase.transaction('rw', UnsDatabase.offlineAzkar, async () => {
    await UnsDatabase.offlineAzkar.clear();
    await UnsDatabase.offlineAzkar.bulkPut(rows);
  });
  return rows.length;
}

export async function getOfflineAzkar(category) {
  await initializeUnsDatabase();
  const query = category
    ? UnsDatabase.offlineAzkar.where('category').equals(category)
    : UnsDatabase.offlineAzkar.orderBy('position');
  return query.toArray();
}

export async function getVerseNote(surah, ayah) {
  await initializeUnsDatabase();
  return (await UnsDatabase.verseNotes.get(`${surah}:${ayah}`)) || null;
}

export async function saveVerseNote({ surah, ayah, note }) {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114 || !Number.isInteger(ayah) || ayah < 1
    || typeof note !== 'string' || note.length > 20_000) throw new TypeError('Invalid verse note.');
  await initializeUnsDatabase();
  const id = `${surah}:${ayah}`;
  const record = { id, surah, ayah, note, updatedAt: updatedAt() };
  const saved = await UnsDatabase.verseNotes.put(record);
  try {
    const parsed = safeParse(localStorage.getItem('zad.verseNotes') || '{}');
    const localValue = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    localValue[id] = record;
    if (!writeStorage('zad.verseNotes', localValue)) throw new Error('Unable to save the local note snapshot.');
  } catch (error) {
    throw error;
  }
  return saved;
}

export async function getCachedTafseer(source, surah, ayah) {
  await initializeUnsDatabase();
  return (await UnsDatabase.verseTafseer.get(`${source}:${surah}:${ayah}`)) || null;
}

export async function cacheTafseer({ source, surah, ayah, text }) {
  if (typeof source !== 'string' || !Number.isInteger(surah) || !Number.isInteger(ayah)
    || typeof text !== 'string' || text.length > 20_000) return;
  await initializeUnsDatabase();
  await UnsDatabase.verseTafseer.put({
    id: `${source}:${surah}:${ayah}`,
    source,
    surah,
    ayah,
    text,
    updatedAt: updatedAt(),
  });
}
