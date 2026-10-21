import { useEffect, useMemo, useState } from 'react';
import { getQuranAyah, getSurahMetadata, getTafsir, TAFSIR_SOURCES } from '../services/tafsir.js';

function copyText(text) {
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
  return copied ? Promise.resolve() : Promise.reject(new Error('Clipboard unavailable'));
}

function normalizeAyah(value) {
  if (!value || typeof value !== 'object') return null;
  const surahNumber = Number(value.surahNumber ?? value.surah);
  const ayahNumber = Number(value.ayahNumber ?? value.ayah);
  const ayahText = value.ayahText ?? value.text;
  if (!Number.isInteger(surahNumber) || !Number.isInteger(ayahNumber) || typeof ayahText !== 'string') return null;
  return { surahNumber, ayahNumber, ayahText, surahName: value.surahName || `السورة ${surahNumber}` };
}

export default function TafsirModal() {
  const [ayah, setAyah] = useState(null);
  const [source, setSource] = useState(TAFSIR_SOURCES[0].id);
  const [activeTab, setActiveTab] = useState(TAFSIR_SOURCES[0].id);
  const [surahs, setSurahs] = useState([]);
  const [ayahInput, setAyahInput] = useState('1');
  const [commentary, setCommentary] = useState('');
  const [loading, setLoading] = useState(false);
  const [verseLoading, setVerseLoading] = useState(false);
  const [error, setError] = useState('');
  const [surahError, setSurahError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [textSize, setTextSize] = useState(1.08);

  useEffect(() => {
    const open = (event) => {
      const selected = normalizeAyah(event.detail);
      if (!selected) return;
      setAyah(selected);
      setAyahInput(String(selected.ayahNumber));
      setSource(TAFSIR_SOURCES[0].id);
      setActiveTab(TAFSIR_SOURCES[0].id);
      setNotice('');
    };
    window.addEventListener('uns:open-tafsir', open);
    return () => window.removeEventListener('uns:open-tafsir', open);
  }, []);

  useEffect(() => {
    if (!ayah) return undefined;
    const controller = new AbortController();
    setSurahError('');
    getSurahMetadata(controller.signal)
      .then(setSurahs)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setSurahError('تعذر تحميل معلومات السور المحفوظة على هذا الجهاز.');
      });
    return () => controller.abort();
  }, [Boolean(ayah)]);

  useEffect(() => {
    if (!ayah || activeTab === 'surah') return undefined;
    const controller = new AbortController();
    setCommentary('');
    setError('');
    setUnavailable(false);
    setLoading(true);
    getTafsir(source, ayah.surahNumber, ayah.ayahNumber, controller.signal)
      .then(({ text, unavailable: isUnavailable }) => {
        setCommentary(text);
        setUnavailable(Boolean(isUnavailable));
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError('تعذر قراءة ملف التفسير المحلي. أغلق النافذة ثم حاول مرة أخرى.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ayah?.surahNumber, ayah?.ayahNumber, source, activeTab]);

  useEffect(() => {
    if (!ayah) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setAyah(null); };
    document.addEventListener('keydown', closeOnEscape);
    document.body.classList.add('tafsir-open');
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.classList.remove('tafsir-open');
    };
  }, [ayah]);

  const selectedSurah = useMemo(
    () => surahs.find((item) => item.surah === ayah?.surahNumber),
    [surahs, ayah?.surahNumber],
  );

  if (!ayah) return null;
  const sourceInfo = TAFSIR_SOURCES.find((item) => item.id === source);
  const surahName = selectedSurah?.name || ayah.surahName;
  const citation = `${surahName} · الآية ${ayah.ayahNumber}`;
  const shareText = `${citation}\n${ayah.ayahText}\n\n${commentary}\n\n${sourceInfo?.label || ''}`.trim();

  async function selectAyah(surahNumber, ayahNumber) {
    const surah = surahs.find((item) => item.surah === surahNumber);
    if (!surah || !Number.isInteger(ayahNumber) || ayahNumber < 1 || ayahNumber > surah.verseCount) {
      setNotice(`اختر آية من ١ إلى ${surah?.verseCount || 'عدد آيات السورة'}.`);
      return;
    }
    setNotice('');
    setAyahInput(String(ayahNumber));
    if (surahNumber === ayah.surahNumber && ayahNumber === ayah.ayahNumber) return;
    setVerseLoading(true);
    try {
      const ayahText = await getQuranAyah(surahNumber, ayahNumber);
      setAyah({ surahNumber, ayahNumber, ayahText, surahName: surah.name });
    } catch {
      setNotice('تعذر تحميل نص الآية من ملف القرآن المحلي.');
    } finally {
      setVerseLoading(false);
    }
  }

  async function moveAyah(offset) {
    if (!ayah || !surahs.length) return;
    let surahNumber = ayah.surahNumber;
    let ayahNumber = ayah.ayahNumber + offset;
    const surah = surahs.find((item) => item.surah === surahNumber);
    if (ayahNumber < 1) {
      surahNumber -= 1;
      const previousSurah = surahs.find((item) => item.surah === surahNumber);
      if (!previousSurah) return;
      ayahNumber = previousSurah.verseCount;
    } else if (ayahNumber > (surah?.verseCount ?? 0)) {
      surahNumber += 1;
      if (!surahs.some((item) => item.surah === surahNumber)) return;
      ayahNumber = 1;
    }
    await selectAyah(surahNumber, ayahNumber);
  }

  async function share() {
    setNotice('');
    try {
      if (navigator.share) await navigator.share({ title: `تدبّر ${citation}`, text: shareText });
      else { await copyText(shareText); setNotice('تم نسخ الآية والتفسير للمشاركة.'); }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') setNotice('تعذرت المشاركة على هذا الجهاز.');
    }
  }

  async function copy() {
    try {
      await copyText(shareText);
      setNotice('تم نسخ الآية والتفسير.');
    } catch { setNotice('تعذر النسخ على هذا الجهاز.'); }
  }

  const commentaryStyle = { fontSize: `${textSize}rem` };

  return (
    <div className="tafsir-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setAyah(null);
    }}>
      <section className="tafsir-sheet" role="dialog" aria-modal="true" aria-labelledby="tafsir-title" dir="rtl">
        <div className="tafsir-sheet-handle" aria-hidden="true" />
        <header className="tafsir-header">
          <div><p className="tafsir-kicker">تدبّر الآية</p><h2 id="tafsir-title">{surahName}</h2><p>الآية {ayah.ayahNumber}</p></div>
          <nav className="tafsir-ayah-navigation" aria-label="التنقل بين الآيات">
            <button type="button" onClick={() => void moveAyah(-1)} disabled={!surahs.length || verseLoading} aria-label="الآية السابقة" title="الآية السابقة">السابق</button>
            <button type="button" onClick={() => void moveAyah(1)} disabled={!surahs.length || verseLoading} aria-label="الآية التالية" title="الآية التالية">التالي</button>
          </nav>
          <button className="tafsir-close" type="button" onClick={() => setAyah(null)} aria-label="إغلاق التفسير">×</button>
        </header>

        <div className="tafsir-location-controls">
          <label>
            <span>السورة</span>
            <select value={ayah.surahNumber} onChange={(event) => {
              const nextSurah = Number(event.target.value);
              const nextInfo = surahs.find((item) => item.surah === nextSurah);
              void selectAyah(nextSurah, Math.min(ayah.ayahNumber, nextInfo?.verseCount || 1));
            }} disabled={!surahs.length || verseLoading}>
              {(surahs.length ? surahs : [{ surah: ayah.surahNumber, name: ayah.surahName }])
                .map((item) => <option key={item.surah} value={item.surah}>{item.surah}. {item.name}</option>)}
            </select>
          </label>
          <label>
            <span>رقم الآية</span>
            <input type="number" min="1" max={selectedSurah?.verseCount || undefined} inputMode="numeric"
              value={ayahInput} disabled={verseLoading}
              onChange={(event) => setAyahInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void selectAyah(ayah.surahNumber, Number(ayahInput)); }} />
          </label>
          <button type="button" className="tafsir-go-button" disabled={verseLoading || !surahs.length}
            onClick={() => void selectAyah(ayah.surahNumber, Number(ayahInput))}>{verseLoading ? 'جارٍ التحميل…' : 'انتقال'}</button>
        </div>

        <blockquote className="tafsir-ayah" style={{ fontSize: `${textSize + 0.22}rem` }}>{ayah.ayahText}</blockquote>

        <div className="tafsir-tabs" role="tablist" aria-label="أقسام التدبّر">
          {TAFSIR_SOURCES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id}
            className={activeTab === item.id ? 'is-active' : ''} onClick={() => { setSource(item.id); setActiveTab(item.id); }}>{item.label}</button>)}
          <button type="button" role="tab" aria-selected={activeTab === 'surah'}
            className={activeTab === 'surah' ? 'is-active' : ''} onClick={() => setActiveTab('surah')}>عن السورة</button>
        </div>

        <div className="tafsir-reading-tools" aria-label="حجم الخط">
          <span>حجم الخط</span>
          <button type="button" aria-label="تصغير الخط" disabled={textSize <= 0.88}
            onClick={() => setTextSize((size) => Math.max(0.88, Number((size - 0.1).toFixed(2))))}>A−</button>
          <button type="button" aria-label="تكبير الخط" disabled={textSize >= 1.52}
            onClick={() => setTextSize((size) => Math.min(1.52, Number((size + 0.1).toFixed(2))))}>A+</button>
        </div>

        {activeTab === 'surah' ? (
          <section className="tafsir-surah-info" aria-live="polite" style={commentaryStyle}>
            <h3>مقاصد سورة {surahName}</h3>
            <dl className="tafsir-surah-facts">
              <div><dt>مكان النزول</dt><dd>{selectedSurah?.revelationPlace || '—'}</dd></div>
              <div><dt>عدد الآيات</dt><dd>{selectedSurah?.verseCount || '—'}</dd></div>
              <div><dt>ترتيب النزول</dt><dd>{selectedSurah?.revelationOrder || '—'}</dd></div>
            </dl>
            <h4>مقاصد السورة</h4>
            {selectedSurah
              ? <p>{selectedSurah.purposes || 'لم يذكر المصدر مقاصد مستقلة لهذه السورة.'}</p>
              : <p className="tafsir-status">{surahError || 'جارٍ تحميل معلومات السورة…'}</p>}
            {selectedSurah?.topics && <><h4>موضوعات السورة</h4><p>{selectedSurah.topics}</p></>}
            {selectedSurah?.introduction && <><h4>نبذة عن السورة</h4><p>{selectedSurah.introduction}</p></>}
          </section>
        ) : (
          <div className="tafsir-commentary" aria-live="polite" aria-busy={loading} style={commentaryStyle}>
            {loading ? <div className="tafsir-loading" role="status"><span className="tafsir-spinner" aria-hidden="true" />جارٍ تحميل التفسير المحلي…</div>
              : commentary ? <p className={unavailable ? 'tafsir-status' : undefined}>{commentary}</p>
                : <p className="tafsir-status" role="status">{error || 'تعذر تحميل التفسير.'}</p>}
          </div>
        )}

        <footer className="tafsir-footer">
          <span className="tafsir-notice" role="status">{notice}</span>
          <button type="button" onClick={copy}>نسخ الآية والتفسير</button>
          <button type="button" className="tafsir-share-button" onClick={share}>مشاركة</button>
        </footer>
      </section>
    </div>
  );
}
