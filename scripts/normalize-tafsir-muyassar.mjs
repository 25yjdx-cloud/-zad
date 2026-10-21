import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(projectRoot, 'public/data/tafsir-muyassar.source.json.gz');
const outputPath = path.join(projectRoot, 'public/data/tafsir-muyassar.json');

const [compressed, quranJson, applicationData] = await Promise.all([
  readFile(inputPath),
  readFile(path.join(projectRoot, 'quran-text.json'), 'utf8').then(JSON.parse),
  readFile(path.join(projectRoot, 'data.json'), 'utf8').then(JSON.parse),
]);
const sourceBytes = gunzipSync(compressed);
const source = JSON.parse(sourceBytes.toString('utf8'));
if (source.book?.id !== 2012
  || source.book?.name !== 'التفسير الميسر'
  || source.book?.author?.ar_name !== 'مجمع الملك فهد لطباعة المصحف الشريف') {
  throw new Error('The source dump is not the expected King Fahd Complex Al-Muyassar edition.');
}
if (quranJson?.schemaVersion !== 1 || quranJson?.ayahCount !== 6236 || !Array.isArray(quranJson.ayahs)) {
  throw new Error('The local Quran reference file is incomplete or has an unsupported schema.');
}

const expected = new Set(quranJson.ayahs.map(([surah, ayah]) => `${surah}:${ayah}`));
const seen = new Set();
const ayahs = source.ayahs.map((item) => {
  const key = `${item.surah}:${item.ayah}`;
  if (!expected.has(key) || seen.has(key)) throw new Error(`Unexpected or duplicate tafsir verse: ${key}`);
  const text = Array.isArray(item.content)
    ? item.content.map((part) => part?.text).filter((part) => typeof part === 'string' && part.trim()).join('\n')
    : '';
  if (!text) throw new Error(`Missing tafsir text for ${key}`);
  seen.add(key);
  return { surah_number: item.surah, ayah_number: item.ayah, text };
});

if (seen.size !== expected.size || [...expected].some((key) => !seen.has(key))) {
  throw new Error(`Expected ${expected.size} unique ayahs, found ${seen.size}.`);
}

const dataset = {
  schemaVersion: 1,
  ayahCount: ayahs.length,
  surahs: applicationData.quran.surahs.map((surah) => ({
    surah_number: surah.id,
    name: surah.name,
    ayah_count: quranJson.ayahs.filter(([number]) => number === surah.id).length,
  })),
  metadata: {
    tafsir: source.book.name,
    author: source.book.author.ar_name,
    source: 'الموسوعة القرآنية Quranpedia.net',
    sourceUrl: 'https://quranpedia.net/dumps',
    sourceFile: 'tafsir-book-2012.json.gz',
    sourceVersion: source.license.version,
    sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
    attribution: 'المصدر: الموسوعة القرآنية quranpedia.net — نسخة البيانات 2026-08-10. أُعيدت هيكلة الملف مع التحقق من مطابقته لمواضع الآيات في quran-text.json.',
    license: source.license.ar,
  },
  ayahs,
};

await writeFile(outputPath, `${JSON.stringify(dataset)}\n`, 'utf8');
console.log(`Wrote ${ayahs.length} verified ayahs to ${path.relative(projectRoot, outputPath)} (${(Buffer.byteLength(JSON.stringify(dataset)) / 1024 / 1024).toFixed(2)} MiB).`);
