const DATASET_FILES = {
  muyassar: 'tafsir-muyassar.json',
  sharawi: 'tafsir-sharawi.json',
  wajiz: 'tafsir-wajiz.json',
};

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
  return new URL(`data/${fileName}`, document.baseURI).href;
}

export async function getTafsir(sourceId, surah, ayah, signal) {
  const source = TAFSIR_SOURCES.find((item) => item.id === sourceId);
  if (!source) throw new Error('مصدر التفسير غير معروف.');
  if (!Number.isInteger(surah) || surah < 1 || surah > 114
    || !Number.isInteger(ayah) || ayah < 1) throw new Error('رقم السورة أو الآية غير صحيح.');

  const text = await requestWorker({
    type: 'tafsir',
    sourceId,
    url: dataUrl(DATASET_FILES[sourceId]),
    surah,
    ayah,
  }, signal);
  return {
    text: text || 'لا يتوفر تفسير لهذه الآية في هذا المصدر.',
    source: source.label,
    unavailable: !text,
    local: true,
  };
}

export async function getQuranAyah(surah, ayah, signal) {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114
    || !Number.isInteger(ayah) || ayah < 1) throw new Error('رقم السورة أو الآية غير صحيح.');
  return requestWorker({
    type: 'quran-ayah',
    url: new URL('quran-text.json', document.baseURI).href,
    surah,
    ayah,
  }, signal);
}

export async function getSurahMetadata(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  if (!surahMetadataRequest) {
    surahMetadataRequest = fetch(dataUrl('surahs.json'), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('تعذر تحميل معلومات السور المحلية.');
        const payload = await response.json();
        if (!Array.isArray(payload?.surahs)) throw new Error('ملف معلومات السور المحلية غير صالح.');
        return payload.surahs;
      })
      .catch((error) => {
        surahMetadataRequest = undefined;
        throw error;
      });
  }
  const surahs = await surahMetadataRequest;
  if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  return surahs;
}
