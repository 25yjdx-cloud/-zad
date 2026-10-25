import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const SHOWN_DATE_KEY = 'uns.app-share-prompt-shown-date.v1';
const SHOWN_SESSION_KEY = 'uns.app-share-prompt-shown-session.v1';
const ACTIVE_TIME_SECONDS = 105;
const IDLE_AFTER_MS = 60_000;
const SHARE_TEXT = 'شارك تطبيق أُنْس مع من تحب؛ لعلّه يكون سببًا في ذكرٍ أو تدبّرٍ أو طاعة. ساهم في نشر الخير واجعلها صدقة جارية بإذن الله.';

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function hasShownPrompt() {
  const today = todayKey();
  try {
    if (window.localStorage.getItem(SHOWN_DATE_KEY) === today) return true;
  } catch { /* Fall back to the current browser session. */ }
  try { return window.sessionStorage.getItem(SHOWN_SESSION_KEY) === 'true'; } catch { return false; }
}

function markPromptShown() {
  try { window.localStorage.setItem(SHOWN_DATE_KEY, todayKey()); } catch { /* Session storage still prevents repeats. */ }
  try { window.sessionStorage.setItem(SHOWN_SESSION_KEY, 'true'); } catch { /* In-memory timer fires only once per mount. */ }
}

async function copyLink(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Clipboard unavailable');
}

export default function AppSharePrompt() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [status, setStatus] = useState('');
  const lastActivityRef = useRef(Date.now());
  const activeSecondsRef = useRef(0);
  const shownRef = useRef(false);
  const closeButtonRef = useRef(null);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const closeTimerRef = useRef(null);

  const close = useCallback(() => {
    if (closeTimerRef.current) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
      setClosing(false);
      window.requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
      });
    }, 180);
  }, []);

  useEffect(() => {
    if (hasShownPrompt()) return undefined;

    const recordActivity = () => { lastActivityRef.current = Date.now(); };
    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));

    const timer = window.setInterval(() => {
      if (shownRef.current || document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current > IDLE_AFTER_MS) return;
      activeSecondsRef.current += 1;
      if (activeSecondsRef.current < ACTIVE_TIME_SECONDS) return;
      shownRef.current = true;
      markPromptShown();
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setClosing(false);
      setStatus('');
      setOpen(true);
    }, 1000);

    return () => {
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('app-share-prompt-open');
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.classList.remove('app-share-prompt-open');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  const shareApp = async () => {
    const url = window.location.href;
    const shareData = { title: 'تطبيق أُنْس', text: SHARE_TEXT, url };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        close();
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    const shareMessage = `${SHARE_TEXT}\n${url}`;
    try {
      await copyLink(shareMessage);
      setStatus('نُسخ رابط التطبيق، شاركه مع من تحب.');
    } catch {
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
      const popup = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      setStatus(popup ? 'يمكنك إرسال الرابط عبر واتساب.' : 'تعذّر فتح المشاركة. انسخ رابط التطبيق من شريط العنوان.');
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={`app-share-prompt-backdrop${closing ? ' is-closing' : ''}`} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section
        ref={dialogRef}
        className={`app-share-prompt-dialog${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-share-prompt-title"
        aria-describedby="app-share-prompt-message"
        dir="rtl"
      >
        <button ref={closeButtonRef} className="app-share-prompt-close" type="button" onClick={close} aria-label="إغلاق">×</button>
        <span className="app-share-prompt-emblem" aria-hidden="true">أُنْس</span>
        <p className="app-share-prompt-kicker">رسالة محبة من فريق أُنْس</p>
        <h2 id="app-share-prompt-title">بارك الله في وقتك 🌿</h2>
        <p id="app-share-prompt-message" className="app-share-prompt-copy">
          إن وجدت في أُنْس خيرًا، فشاركه مع أهلك وأصدقائك. لعلّ آيةً تُتلى أو ذِكرًا يُقال يكون لك أجر نشره، وصدقةً جارية بإذن الله.
        </p>
        <div className="app-share-prompt-actions">
          <button className="app-share-prompt-primary" type="button" onClick={shareApp}>مشاركة التطبيق الآن</button>
          <button className="app-share-prompt-later" type="button" onClick={close}>لاحقًا</button>
        </div>
        <p className="app-share-prompt-status" role="status" aria-live="polite">{status}</p>
      </section>
    </div>,
    document.body,
  );
}
