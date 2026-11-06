import { useEffect, useState } from 'react';
import { getAyahAsbab, getSurahMetadata } from '../services/tafsir.js';

export default function SurahInfoModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [surahNumber, setSurahNumber] = useState(1);
  const [surahs, setSurahs] = useState([]);
  const [ayahNumber, setAyahNumber] = useState(1);
  const [ayahInput, setAyahInput] = useState('1');
  const [asbab, setAsbab] = useState([]);
  const [asbabLoading, setAsbabLoading] = useState(false);
  const [asbabError, setAsbabError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const open = (event) => {
      const requested = Number(event.detail?.surahNumber);
      if (Number.isInteger(requested) && requested >= 1 && requested <= 114) setSurahNumber(requested);
      const requestedAyah = Number(event.detail?.ayahNumber);
      const initialAyah = Number.isInteger(requestedAyah) && requestedAyah >= 1 ? requestedAyah : 1;
      setAyahNumber(initialAyah);
      setAyahInput(String(initialAyah));
      setIsOpen(true);
    };
    window.addEventListener('uns:open-surah-info', open);
    return () => window.removeEventListener('uns:open-surah-info', open);
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getSurahMetadata(controller.signal)
      .then(setSurahs)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError('تعذر تحميل معلومات السور. تحقق من توفر الملف المحلي ثم أعد المحاولة.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    setAsbab([]);
    setAsbabError('');
    setAsbabLoading(true);
    getAyahAsbab(surahNumber, ayahNumber, controller.signal)
      .then(setAsbab)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setAsbabError('تعذر تحميل أسباب النزول من المصدر. تحقق من الاتصال ثم أعد المحاولة.');
      })
      .finally(() => { if (!controller.signal.aborted) setAsbabLoading(false); });
    return () => controller.abort();
  }, [isOpen, surahNumber, ayahNumber]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setIsOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen]);

  if (!isOpen) return null;
  const selected = surahs.find((item) => item.surah === surahNumber);

  return (
    <div className="surah-info-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setIsOpen(false);
    }}>
      <section className="surah-info-dialog" role="dialog" aria-modal="true" aria-labelledby="surah-info-title" dir="rtl">
        <header className="surah-info-header">
          <div>
            <p className="section-kicker">معلومات ومقاصد السورة</p>
            <h2 id="surah-info-title">{selected?.name || 'عن السورة'}</h2>
          </div>
          <button className="tafsir-close" type="button" onClick={() => setIsOpen(false)} aria-label="إغلاق معلومات السورة">×</button>
        </header>
        <label className="surah-info-select">
          <span>اختر السورة</span>
          <select value={surahNumber} onChange={(event) => {
            setSurahNumber(Number(event.target.value));
            setAyahNumber(1);
            setAyahInput('1');
          }} disabled={!surahs.length}>
            {(surahs.length ? surahs : [{ surah: surahNumber, name: 'جارٍ تحميل السور…' }])
              .map((item) => <option key={item.surah} value={item.surah}>{item.surah}. {item.name}</option>)}
          </select>
        </label>
        {loading ? <p className="tafsir-loading" role="status"><span className="tafsir-spinner" aria-hidden="true" />جارٍ تحميل معلومات السورة…</p>
          : error ? <p className="tafsir-status" role="alert">{error}</p>
            : selected ? (
              <div className="surah-info-content">
                <dl className="tafsir-surah-facts">
                  <div><dt>مكان النزول</dt><dd>{selected.revelationPlace || 'غير متاح في المصدر'}</dd></div>
                  <div><dt>عدد الآيات</dt><dd>{selected.verseCount || 'غير متاح في المصدر'}</dd></div>
                  <div><dt>ترتيب النزول</dt><dd>{selected.revelationOrder || 'غير متاح في المصدر'}</dd></div>
                </dl>
                <h3>أسباب النزول</h3>
                <div className="surah-asbab-controls">
                  <label htmlFor="surah-asbab-ayah">الآية</label>
                  <input id="surah-asbab-ayah" type="number" min="1" max={selected.verseCount}
                    value={ayahInput} onChange={(event) => setAyahInput(event.target.value)} />
                  <button type="button" disabled={!Number.isInteger(Number(ayahInput))
                    || Number(ayahInput) < 1 || Number(ayahInput) > selected.verseCount}
                    onClick={() => setAyahNumber(Number(ayahInput))}>عرض السبب</button>
                </div>
                {asbabLoading ? <p className="tafsir-loading" role="status"><span className="tafsir-spinner" aria-hidden="true" />جارٍ تحميل أسباب نزول الآية {ayahNumber}…</p>
                  : asbabError ? <p className="tafsir-status" role="alert">{asbabError}</p>
                    : asbab.length ? asbab.map((item, index) => (
                      <article className="surah-asbab-source" key={`${item.source}-${index}`}>
                        <h4>{item.source} · الآية {ayahNumber}</h4>
                        <p>{item.text}</p>
                      </article>
                    )) : <p className="tafsir-status" role="status">لا تتوفر رواية لسبب نزول هذه الآية في مصادر أسباب النزول المتاحة.</p>}
                <h3>مقاصد السورة</h3>
                <p>{selected.purposes || 'لم يذكر المصدر مقاصد مستقلة لهذه السورة.'}</p>
                {selected.topics && <><h3>موضوعات السورة</h3><p>{selected.topics}</p></>}
                {selected.introduction && <><h3>نبذة عن السورة</h3><p>{selected.introduction}</p></>}
              </div>
            ) : <p className="tafsir-status" role="status">لا تتوفر معلومات لهذه السورة.</p>}
      </section>
    </div>
  );
}
