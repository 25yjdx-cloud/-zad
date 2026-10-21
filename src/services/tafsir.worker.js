const tafsirBooks = new Map();
let quranAyahs;

async function loadTafsir(url) {
  if (!tafsirBooks.has(url)) {
    const request = fetch(url, { headers: { Accept: 'application/json' } }).then(async (response) => {
      if (!response.ok) throw new Error('تعذر تحميل ملف التفسير المحلي.');
      const payload = await response.json();
      if (!Array.isArray(payload.ayahs)) throw new Error('ملف التفسير المحلي غير صالح.');
      const verses = new Map();
      payload.ayahs.forEach((item) => {
        if (Array.isArray(item) && Number.isInteger(item[0]) && Number.isInteger(item[1]) && typeof item[2] === 'string') {
          verses.set(`${item[0]}:${item[1]}`, item[2]);
        }
      });
      return verses;
    });
    tafsirBooks.set(url, request);
    request.catch(() => tafsirBooks.delete(url));
  }
  return tafsirBooks.get(url);
}

async function loadQuranAyahs(url) {
  if (!quranAyahs) {
    quranAyahs = fetch(url, { headers: { Accept: 'application/json' } }).then(async (response) => {
      if (!response.ok) throw new Error('تعذر تحميل نص القرآن المحلي.');
      const payload = await response.json();
      if (!Array.isArray(payload.ayahs)) throw new Error('ملف نص القرآن المحلي غير صالح.');
      return payload.ayahs;
    }).catch((error) => {
      quranAyahs = undefined;
      throw error;
    });
  }
  return quranAyahs;
}

self.addEventListener('message', async ({ data }) => {
  const { id, type, url, surah, ayah } = data;
  try {
    let result;
    if (type === 'tafsir') {
      const verses = await loadTafsir(url);
      result = verses.get(`${surah}:${ayah}`) || '';
    } else if (type === 'quran-ayah') {
      const verses = await loadQuranAyahs(url);
      const verse = verses.find((item) => item[0] === surah && item[1] === ayah);
      if (!verse || typeof verse[3] !== 'string') throw new Error('لم يُعثر على نص هذه الآية.');
      result = verse[3];
    } else {
      throw new Error('طلب محلي غير معروف.');
    }
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'تعذر تحميل البيانات المحلية.' });
  }
});
