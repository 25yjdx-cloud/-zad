import spiritualMessages from '../data/spiritualMessages.json';

export const SPIRITUAL_MESSAGE_STORAGE_KEYS = {
  usageSeconds: 'uns.spiritual-message-usage-seconds.v2',
  nextPromptSeconds: 'uns.spiritual-message-next-prompt-seconds.v2',
  favorites: 'uns.spiritual-message-favorites.v1',
};

export const SPIRITUAL_MESSAGE_AUTO_DELAY_SECONDS = 3 * 60;
export const SPIRITUAL_MESSAGE_REPEAT_SECONDS = 12 * 60;

export const usableSpiritualMessages = spiritualMessages.filter((message) => (
  Number.isInteger(message.id)
  && typeof message.category === 'string'
  && typeof message.text === 'string'
  && message.text.trim().length > 0
));

export function getRandomSpiritualMessage(excludeId) {
  const options = usableSpiritualMessages.filter((message) => message.id !== excludeId);
  const pool = options.length ? options : usableSpiritualMessages;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function readSpiritualMessageFavorites() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SPIRITUAL_MESSAGE_STORAGE_KEYS.favorites) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

export function toggleSpiritualMessageFavorite(id) {
  const favorites = new Set(readSpiritualMessageFavorites());
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  const next = [...favorites];
  try {
    window.localStorage.setItem(SPIRITUAL_MESSAGE_STORAGE_KEYS.favorites, JSON.stringify(next));
  } catch { /* Keep the current interaction usable if storage is unavailable. */ }
  return next;
}
