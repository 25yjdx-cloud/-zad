const MAX_STORAGE_BYTES = 256 * 1024;
const MAX_STORAGE_DEPTH = 12;
const MAX_STORAGE_NODES = 10_000;
const MAX_STORAGE_STRING_LENGTH = 20_000;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const CLOUD_PENDING_KEYS = 'uns.firebase.pendingLocalKeys';

function rememberCloudSyncChange(key) {
  if (!key.startsWith('zad.')) return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLOUD_PENDING_KEYS) || '[]');
    const keys = new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
    keys.add(key);
    window.localStorage.setItem(CLOUD_PENDING_KEYS, JSON.stringify([...keys].slice(-500)));
  } catch { /* The app remains usable with local-only storage. */ }
}

function isSafeJsonValue(value, seen = new WeakSet(), depth = 0, nodeCount = { value: 0 }) {
  nodeCount.value += 1;
  if (nodeCount.value > MAX_STORAGE_NODES || depth > MAX_STORAGE_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= MAX_STORAGE_STRING_LENGTH;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  if (Array.isArray(value) && value.length > MAX_STORAGE_NODES) return false;
  seen.add(value);

  const entries = Array.isArray(value) ? value : Object.entries(value);
  if (entries.length > MAX_STORAGE_NODES) return false;
  for (const entry of entries) {
    if (Array.isArray(value)) {
      if (!isSafeJsonValue(entry, seen, depth + 1, nodeCount)) return false;
    } else {
      const [key, entryValue] = entry;
      if (BLOCKED_KEYS.has(key) || key.length > 128
        || !isSafeJsonValue(entryValue, seen, depth + 1, nodeCount)) return false;
    }
  }
  return true;
}

export function parseStoredJson(serialized, fallback) {
  if (typeof serialized !== 'string' || serialized.length > MAX_STORAGE_BYTES) return fallback;
  try {
    const value = JSON.parse(serialized);
    return isSafeJsonValue(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function serializeStoredJson(value) {
  if (!isSafeJsonValue(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    return new TextEncoder().encode(serialized).byteLength <= MAX_STORAGE_BYTES ? serialized : null;
  } catch {
    return null;
  }
}

export function readStorage(key, fallback) {
  try {
    const serialized = window.localStorage.getItem(key);
    return serialized === null ? fallback : parseStoredJson(serialized, fallback);
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  const serialized = serializeStoredJson(value);
  if (serialized === null) return false;
  try {
    const previousValue = window.localStorage.getItem(key);
    window.localStorage.setItem(key, serialized);
    if (key.startsWith('zad.') && previousValue !== serialized) {
      rememberCloudSyncChange(key);
      window.dispatchEvent(new CustomEvent('uns:local-data-changed', { detail: { key, value: serialized } }));
    }
    return true;
  } catch {
    return false;
  }
}
