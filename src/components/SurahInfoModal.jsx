import { useEffect, useState } from 'react';
import { getSurahMetadata } from '../services/tafsir.js';

export default function SurahInfoModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [surahNumber, setSurahNumber] = useState(1);
  const [surahs, setSurahs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const open = (event) => {
      const requested = Number(event.detail?.surahNumber);
      if (Number.isInteger(requested) && requested >= 1 && requested <= 114) setSurahNumber(requested);
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
          <select value={surahNumber} onChange={(event) => setSurahNumber(Number(event.target.value))} disabled={!surahs.length}>
            {(surahs.length ? surahs : [{ surah: surahNumber, name: 'جارٍ تحميل السور…' }])
              .map((item) => <option key={item.surah} value={item.surah}>{item.surah}. {item.name}</option>)}
          </select>
        </label>
        {loading ? <p className="tafsir-loading" role="status"><span className="tafsir-spinner" aria-hidden="true" />جارٍ تحميل معلومات السورة…</p>
          : error ? <p className="tafsir-status" role="alert">{error}</p>
            : selected ? (
              <div className="surah-info-content">
                <dl className="tafsir-surah-facts">
                  <div><dt>مكان النزول</dt><dd>{selected.revelationPlace || '—'}</dd></div>
                  <div><dt>عدد الآيات</dt><dd>{selected.verseCount || '—'}</dd></div>
                  <div><dt>ترتيب النزول</dt><dd>{selected.revelationOrder || '—'}</dd></div>
                </dl>
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
