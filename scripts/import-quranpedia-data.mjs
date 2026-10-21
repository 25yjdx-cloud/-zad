import { readFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const downloadsPath = process.argv[2] || path.join(os.homedir(), 'Downloads');
const outputPath = path.join(projectRoot, 'public', 'data');

async function readGzipJson(fileName) {
  const compressed = await readFile(path.join(downloadsPath, fileName));
  return JSON.parse((await gunzipAsync(compressed)).toString('utf8'));
}

function plainText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|section|blockquote)\s*>/giu, '\n')
    .replace(/<li\b[^>]*>/giu, '• ')
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;|&#160;|&#xA0;/giu, ' ')
    .replace(/&emsp;/giu, '\u2003')
    .replace(/&ensp;/giu, '\u2002')
    .replace(/&thinsp;/giu, '\u2009')
    .replace(/&mdash;/giu, '—')
    .replace(/&ndash;/giu, '–')
    .replace(/&lsquo;|&rsquo;/giu, '’')
    .replace(/&ldquo;|&rdquo;/giu, '”')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;|&#34;|&#x22;/giu, '"')
    .replace(/&apos;|&#39;|&#x27;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#(\d+);/gu, (_match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/giu, (_match, hexadecimal) => String.fromCodePoint(Number.parseInt(hexadecimal, 16)))
    .replace(/[\t\f\v ]+\n/gu, '\n')
    .replace(/\n[\t ]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function sourceMetadata(dataset, displayName) {
  return {
    source: 'الموسوعة القرآنية Quranpedia.net',
    sourceUrl: dataset.license?.source || 'https://quranpedia.net',
    sourceVersion: dataset.license?.version || 'غير محدد',
    attribution: `المصدر: الموسوعة القرآنية Quranpedia.net — نسخة البيانات ${dataset.license?.version || 'غير محددة'}.`,
    displayName,
    book: dataset.book,
    license: dataset.license,
  };
}

await mkdir(outputPath, { recursive: true });

const [surahDataset, quranData, quranText] = await Promise.all([
  readGzipJson('surahs.json.gz'),
  readFile(path.join(projectRoot, 'data.json'), 'utf8').then(JSON.parse),
  readFile(path.join(projectRoot, 'quran-text.json'), 'utf8').then(JSON.parse),
]);

const quranSurahs = quranData.quran?.surahs;
if (!Array.isArray(quranSurahs) || !Array.isArray(quranText.ayahs)) {
  throw new Error('Expected surah names in data.json and ayah tuples in quran-text.json.');
}

const verseCounts = new Map();
for (const verse of quranText.ayahs) {
  if (!Array.isArray(verse) || !Number.isInteger(verse[0])) continue;
  verseCounts.set(verse[0], (verseCounts.get(verse[0]) || 0) + 1);
}

const surahInfoByNumber = new Map((surahDataset.data || []).map((item) => [Number(item.surah), item.information || {}]));
const surahs = quranSurahs.map(({ id, name }) => {
  const info = surahInfoByNumber.get(Number(id)) || {};
  return {
    surah: Number(id),
    name,
    revelationPlace: plainText(info.surah_type?.value),
    verseCount: verseCounts.get(Number(id)) || 0,
    revelationOrder: plainText(info.descent?.value),
    introduction: plainText(info.introduction?.value),
    topics: plainText(info.topics?.value),
    purposes: plainText(info.purposes?.value),
  };
});

if (surahs.length !== 114 || surahs.some((item) => !item.verseCount)) {
  throw new Error('The surah metadata could not be matched to all 114 Quran surahs.');
}

await writeFile(path.join(outputPath, 'surahs.json'), JSON.stringify({
  schemaVersion: 1,
  metadata: sourceMetadata(surahDataset, 'معلومات السور ومقاصدها'),
  surahs,
}), 'utf8');

const tafsirSources = [
  { fileName: 'tafsir-book-27809.json.gz', outputName: 'tafsir-muyassar.json', id: 27809, displayName: 'التفسير الميسر' },
  { fileName: 'tafsir-book-27803.json.gz', outputName: 'tafsir-sharawi.json', id: 27803, displayName: 'خواطر الشيخ الشعراوي' },
  { fileName: 'tafsir-book-72.json.gz', outputName: 'tafsir-wajiz.json', id: 72, displayName: 'الوجيز في تفسير الكتاب العزيز' },
];

for (const source of tafsirSources) {
  const dataset = await readGzipJson(source.fileName);
  if (Number(dataset.book?.id) !== source.id || !Array.isArray(dataset.ayahs)) {
    throw new Error(`Unexpected book metadata in ${source.fileName}.`);
  }
  const ayahs = dataset.ayahs.map((record) => [
    Number(record.surah),
    Number(record.ayah),
    plainText((record.content || []).map((part) => part.text || '').join('\n')),
  ]).filter(([surah, ayah, text]) => Number.isInteger(surah) && Number.isInteger(ayah) && text);

  await writeFile(path.join(outputPath, source.outputName), JSON.stringify({
    schemaVersion: 1,
    metadata: sourceMetadata(dataset, source.displayName),
    ayahCount: ayahs.length,
    ayahs,
  }), 'utf8');
  console.log(`${source.outputName}: ${ayahs.length} ayahs`);
}

console.log(`surahs.json: ${surahs.length} surahs`);
