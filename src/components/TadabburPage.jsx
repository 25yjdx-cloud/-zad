import { useEffect, useMemo, useState } from 'react';
import { getQuranAyah, getSurahMetadata } from '../services/tafsir.js';

function openSurahInfo(surahNumber) {
  window.dispatchEvent(new CustomEvent('uns:open-surah-info', { detail: { surahNumber } }));
}

function openTafsir(ayah) {
  if (!ayah) return;
  window.dispatchEvent(new CustomEvent('uns:open-tafsir', {
    detail: {
      surahNumber: ayah.surahNumber,
      ayahNumber: ayah.ayahNumber,
      ayahText: ayah.ayahText,
      surahName: ayah.surahName,
    },
  }));
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}

export default function TadabburPage() {
  const [active, setActive] = useState(
    () => document.querySelector('#tadabbur-panel')?.classList.contains('active') ?? false,
  );
  const [surahs, setSurahs] = useState([]);
  const [surahNumber, setSurahNumber] = useState(1);
  const [ayahNumber, setAyahNumber] = useState(1);
  const [ayah, setAyah] = useState(null);
  const [loadingSurahs, setLoadingSurahs] = useState(false);
  const [loadingAyah, setLoadingAyah] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const onTabShown = (event) => {
      if (event.target?.id === 'tadabbur-tab') setActive(true);
      else if (event.target?.matches?.('[data-bs-toggle="pill"]')) setActive(false);
    };
    document.addEventListener('shown.bs.tab', onTabShown);
    return () => document.removeEventListener('shown.bs.tab', onTabShown);
  }, []);

  useEffect(() => {
    const onAyahSelected = (event) => {
      const selected = event.detail;
      const nextSurah = Number(selected?.surahNumber);
      const nextAyah = Number(selected?.ayahNumber);
      if (!Number.isInteger(nextSurah) || nextSurah < 1 || nextSurah > 114
        || !Number.isInteger(nextAyah) || nextAyah < 1 || typeof selected?.ayahText !== 'string') return;
      setActive(true);
      setSurahNumber(nextSurah);
      setAyahNumber(nextAyah);
      setAyah({
        surahNumber: nextSurah,
        ayahNumber: nextAyah,
        ayahText: selected.ayahText,
        surahName: selected.surahName || `السورة ${nextSurah}`,
      });
      setError('');
      setNotice('');
    };
    window.addEventListener('uns:select-tadabbur-ayah', onAyahSelected);
    return () => window.removeEventListener('uns:select-tadabbur-ayah', onAyahSelected);
  }, []);

  useEffect(() => {
    if (!active || surahs.length) return undefined;
    const controller = new AbortController();
    setLoadingSurahs(true);
    setError('');
    getSurahMetadata(controller.signal)
      .then((items) => {
        setSurahs(items);
        setSurahNumber((current) => items.some((item) => item.surah === current) ? current : 1);
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError('تعذر تحميل بيانات السور المحلية. تحقق من الاتصال بالملفات ثم أعد المحاولة.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingSurahs(false); });
    return () => controller.abort();
  }, [active, surahs.length, retryCount]);

  const selectedSurah = useMemo(
    () => surahs.find((item) => item.surah === surahNumber),
    [surahs, surahNumber],
  );

  useEffect(() => {
    if (!active || !selectedSurah || ayahNumber < 1 || ayahNumber > selectedSurah.verseCount) return undefined;
    const controller = new AbortController();
    setLoadingAyah(true);
    setError('');
    setNotice('');
    getQuranAyah(surahNumber, ayahNumber, controller.signal)
      .then((ayahText) => setAyah({ surahNumber, ayahNumber, ayahText, surahName: selectedSurah.name }))
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError('تعذر تحميل نص الآية المحلية. تحقق من ملف القرآن ثم أعد المحاولة.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingAyah(false); });
    return () => controller.abort();
  }, [active, selectedSurah, surahNumber, ayahNumber]);

  function moveAyah(offset) {
    if (!selectedSurah) return;
    const next = ayahNumber + offset;
    if (next >= 1 && next <= selectedSurah.verseCount) {
      setAyahNumber(next);
      return;
    }
    const adjacent = surahs.find((item) => item.surah === surahNumber + Math.sign(offset));
    if (!adjacent) return;
    setSurahNumber(adjacent.surah);
    setAyahNumber(offset > 0 ? 1 : adjacent.verseCount);
  }

  async function shareAyah() {
    if (!ayah) return;
    const text = `${ayah.surahName} · الآية ${ayah.ayahNumber}\n${ayah.ayahText}`;
    try {
      if (navigator.share) await navigator.share({ title: `تدبّر ${ayah.surahName}`, text });
      else { await copyText(text); setNotice('تم نسخ الآية للمشاركة.'); }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') setNotice('تعذرت المشاركة على هذا الجهاز.');
    }
  }

  async function copyAyah() {
    if (!ayah) return;
    try {
      await copyText(`${ayah.surahName} · الآية ${ayah.ayahNumber}\n${ayah.ayahText}`);
      setNotice('تم نسخ الآية.');
    } catch { setNotice('تعذر نسخ الآية على هذا الجهاز.'); }
  }

  return (
    <section id="tadabbur-panel" className="tab-pane fade tadabbur-page" role="tabpanel" aria-labelledby="tadabbur-tab" tabIndex="0" dir="rtl">
      <header className="tadabbur-page-header">
        <div>
          <p className="section-kicker">مساحة هادئة للتأمل</p>
          <h1>أُنْس وتدبّر</h1>
          <p className="tadabbur-page-subtitle">عَش مع آيات الله</p>
        </div>
        <button type="button" className="tadabbur-info-button" onClick={() => openSurahInfo(surahNumber)} disabled={!selectedSurah}>
          معلومات ومقاصد السورة
        </button>
      </header>

      <div className="tadabbur-selectors">
        <label>
          <span>السورة</span>
          <select value={surahNumber} disabled={!surahs.length} onChange={(event) => {
            setSurahNumber(Number(event.target.value));
            setAyahNumber(1);
          }}>
            {(surahs.length ? surahs : [{ surah: 1, name: loadingSurahs ? 'جارٍ تحميل السور…' : 'الفاتحة' }])
              .map((item) => <option key={item.surah} value={item.surah}>{item.surah}. {item.name}</option>)}
          </select>
        </label>
        <label>
          <span>رقم الآية</span>
          <input type="number" min="1" max={selectedSurah?.verseCount || undefined} value={ayahNumber} inputMode="numeric"
            disabled={!selectedSurah} onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= 1 && value <= selectedSurah.verseCount) setAyahNumber(value);
            }} />
        </label>
      </div>

      <article className="tadabbur-ayah-card" aria-live="polite" aria-busy={loadingAyah}>
        <div className="tadabbur-ayah-reference">
          <span>{selectedSurah?.name || (loadingSurahs ? 'جارٍ تحميل السور…' : 'اختر سورة')}</span>
          {selectedSurah && <span>الآية {ayahNumber} من {selectedSurah.verseCount}</span>}
        </div>
        {loadingSurahs || loadingAyah
          ? <p className="tadabbur-loading" role="status"><span className="tafsir-spinner" aria-hidden="true" />جارٍ تحميل الآية…</p>
          : error
            ? <div className="tadabbur-error" role="alert"><p>{error}</p><button type="button" onClick={() => { setSurahs([]); setAyah(null); setRetryCount((count) => count + 1); }}>إعادة المحاولة</button></div>
            : ayah && <button className="tadabbur-ayah-text" type="button" onClick={() => openTafsir(ayah)} aria-label="افتح تفسير هذه الآية">
              {ayah.ayahText}<span>اضغط للانتقال إلى التفسير والتدبّر</span>
            </button>}
        <div className="tadabbur-actions">
          <button type="button" onClick={() => moveAyah(-1)} disabled={!ayah || loadingAyah || (surahNumber === 1 && ayahNumber === 1)}>الآية السابقة</button>
          <button type="button" className="tadabbur-open-tafsir" onClick={() => openTafsir(ayah)} disabled={!ayah || loadingAyah}>تفسير الآية</button>
          <button type="button" onClick={() => moveAyah(1)} disabled={!ayah || loadingAyah || (surahNumber === 114 && ayahNumber === selectedSurah?.verseCount)}>الآية التالية</button>
        </div>
        <div className="tadabbur-share-actions">
          <button type="button" onClick={() => void copyAyah()} disabled={!ayah}>نسخ الآية</button>
          <button type="button" onClick={() => void shareAyah()} disabled={!ayah}>مشاركة</button>
          <span role="status">{notice}</span>
        </div>
      </article>
    </section>
  );
}
