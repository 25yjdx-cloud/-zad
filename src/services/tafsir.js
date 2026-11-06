import { cacheTafseer, getCachedTafseer } from './unsDatabase.js';
import { appUrl } from './appUrl.js';

const DATASET_FILES = {
  muyassar: 'tafsir-muyassar.json',
  sharawi: 'tafsir-sharawi.json',
  wajiz: 'tafsir-wajiz.json',
};

const API_BOOK_IDS = {
  muyassar: 2012,
  sharawi: 27803,
  wajiz: 72,
};
const QURANPEDIA_API_BASE = 'https://api.quranpedia.net/v1/';

export const TAFSIR_SOURCES = [
  { id: 'muyassar', label: 'التفسير الميسر' },
  { id: 'sharawi', label: 'خواطر الشعراوي' },
  { id: 'wajiz', label: 'التفسير الوجيز' },
];

let tafsirWorker;
let requestId = 0;
let surahMetadataRequest;
const pendingRequests = new Map();

function worker() {
  if (tafsirWorker) return tafsirWorker;
  tafsirWorker = new Worker(new URL('./tafsir.worker.js', import.meta.url), { type: 'module' });
  tafsirWorker.addEventListener('message', ({ data }) => {
    const request = pendingRequests.get(data.id);
    if (!request) return;
    pendingRequests.delete(data.id);
    request.signal?.removeEventListener('abort', request.abort);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  });
  tafsirWorker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'تعذر تشغيل قارئ التفسير المحلي.');
    pendingRequests.forEach((request) => {
      request.signal?.removeEventListener('abort', request.abort);
      request.reject(error);
    });
    pendingRequests.clear();
    tafsirWorker?.terminate();
    tafsirWorker = undefined;
  });
  return tafsirWorker;
}

function requestWorker(payload, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Aborted', 'AbortError'));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const abort = () => {
      pendingRequests.delete(id);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    pendingRequests.set(id, { resolve, reject, signal, abort });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker().postMessage({ id, ...payload });
    } catch (error) {
      pendingRequests.delete(id);
      signal?.removeEventListener('abort', abort);
      reject(error);
    }
  });
}

function dataUrl(fileName) {
  return appUrl(`data/${fileName}`);
}

function plainText(markup) {
  const formatted = markup
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)\s*>/giu, '\n');
  const parsed = new DOMParser().parseFromString(formatted, 'text/html');
  return parsed.body.textContent?.replace(/[ \t]+/gu, ' ').replace(/\s*\n\s*/gu, '\n').trim() || '';
}

async function fetchApiJson(path, signal) {
  const response = await fetch(new URL(path, QURANPEDIA_API_BASE), {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Quranpedia returned HTTP ${response.status}.`);
  return response.json();
}

async function getApiTafsir(sourceId, surah, ayah, signal) {
  const payload = await fetchApiJson(`ayah/${surah}/${ayah}/book/${API_BOOK_IDS[sourceId]}`, signal);
  if (!Array.isArray(payload?.content)) throw new Error('The Quranpedia tafsir response has an unexpected format.');
  return payload.content
    .map((item) => typeof item?.text === 'string' ? plainText(item.text) : '')
    .filter(Boolean)
    .join('\n\n');
}

export async function getTafsir(sourceId, surah, ayah, signal) {
  const source = TAFSIR_SOURCES.find((item) => item.id === sourceId);
  if (!source) throw new Error('مصدر التفسير غير معروف.');
  if (!Number.isInteger(surah) || surah < 1 || surah > 114
    || !Number.isInteger(ayah) || ayah < 1) throw new Error('رقم السورة أو الآية غير صحيح.');

  let text;
  try { text = (await getCachedTafseer(sourceId, surah, ayah))?.text; } catch { /* Continue with the local JSON source. */ }
  if (typeof text !== 'string') {
    try {
      text = await requestWorker({
        type: 'tafsir',
        sourceId,
        url: dataUrl(DATASET_FILES[sourceId]),
        surah,
        ayah,
      }, signal);
    } catch (localError) {
      if (signal?.aborted) throw localError;
      try {
        text = await getApiTafsir(sourceId, surah, ayah, signal);
      } catch (apiError) {
        throw new AggregateError([localError, apiError], 'Local and online tafsir sources could not be loaded.');
      }
    }
    if (!text) text = await getApiTafsir(sourceId, surah, ayah, signal);
    if (text) void cacheTafseer({ source: sourceId, surah, ayah, text }).catch(() => {});
  }
  return {
    text: text || 'لا يتوفر تفسير لهذه الآية في هذا المصدر.',
    source: source.label,
    unavailable: !text,
    local: true,
  };
}

export async function getAyahAsbab(surah, ayah, signal) {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114
    || !Number.isInteger(ayah) || ayah < 1) throw new Error('رقم السورة أو الآية غير صحيح.');
  const books = await fetchApiJson(`ayah/${surah}/${ayah}/asbab`, signal);
  if (!Array.isArray(books)) throw new Error('The Quranpedia asbab response has an unexpected format.');
  const sources = await Promise.all(books
    .filter((book) => Number.isInteger(book?.id))
    .map(async (book) => {
      const payload = await fetchApiJson(`ayah/${surah}/${ayah}/book/${book.id}`, signal);
      if (!Array.isArray(payload?.content)) throw new Error('The Quranpedia asbab text has an unexpected format.');
      const text = payload.content
        .map((item) => typeof item?.text === 'string' ? plainText(item.text) : '')
        .filter(Boolean)
        .join('\n\n');
      return text ? { source: typeof book.name === 'string' ? book.name : 'مصدر أسباب النزول', text } : null;
    }));
  return sources.filter((source) => source !== null);
}

export async function getQuranAyah(surah, ayah, signal) {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114
    || !Number.isInteger(ayah) || ayah < 1) throw new Error('رقم السورة أو الآية غير صحيح.');
  return requestWorker({
    type: 'quran-ayah',
    url: appUrl('quran-text.json'),
    surah,
    ayah,
  }, signal);
}

async function loadSurahMetadata() {
  let localSurahs = [];
  let localError;
  try {
    const response = await fetch(appUrl('data/surahs.json'), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('تعذر تحميل معلومات السور المحلية.');
    const payload = await response.json();
    if (!Array.isArray(payload?.surahs)) throw new Error('ملف معلومات السور المحلية غير صالح.');
    localSurahs = payload.surahs;
  } catch (error) {
    localError = error;
  }

  const missingFact = (surah) => !surah.revelationPlace || !surah.revelationOrder;
  if (!localError && localSurahs.length === 114 && !localSurahs.some(missingFact)) return localSurahs;

  let onlineSurahs;
  try {
    onlineSurahs = await fetchApiJson('surahs');
    if (!Array.isArray(onlineSurahs)) throw new Error('The Quranpedia surah list has an unexpected format.');
  } catch (error) {
    if (localError) throw new AggregateError([localError, error], 'Local and online surah metadata could not be loaded.');
    if (localSurahs.length !== 114) throw error;
    return localSurahs;
  }

  const onlineByNumber = new Map(onlineSurahs
    .filter((surah) => Number.isInteger(surah?.id))
    .map((surah) => [surah.id, surah]));
  const localByNumber = new Map(localSurahs
    .filter((surah) => Number.isInteger(surah?.surah))
    .map((surah) => [surah.surah, surah]));
  return Array.from({ length: 114 }, (_, index) => {
    const number = index + 1;
    const local = localByNumber.get(number);
    const online = onlineByNumber.get(number);
    const onlineName = typeof online?.translated_name === 'string'
      ? online.translated_name.trim()
      : typeof online?.name === 'string' ? online.name.replace(/^سورة\s*/u, '') : '';
    return {
      ...local,
      surah: number,
      name: local?.name || onlineName || `السورة ${number}`,
      revelationPlace: local?.revelationPlace || online?.revelation_type || '',
      verseCount: local?.verseCount || online?.number_of_ayahs || 0,
      revelationOrder: local?.revelationOrder || String(online?.revelation_order || ''),
    };
  });
}

export async function getSurahMetadata(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  if (!surahMetadataRequest) {
    surahMetadataRequest = loadSurahMetadata()
      .catch((error) => {
        surahMetadataRequest = undefined;
        throw error;
      });
  }
  const surahs = await surahMetadataRequest;
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  return surahs;
}
