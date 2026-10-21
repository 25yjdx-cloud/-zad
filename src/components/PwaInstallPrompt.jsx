import { useCallback, useEffect, useRef, useState } from 'react';

// === بداية ذاكرة تلميح التثبيت / Install prompt memory ===
// تحفظ نافذة التذكير وقت اختيار المستخدم، وتنتهي الذاكرة بعد يوم واحد.
const DISMISSED_AT_KEYS = ['uns:pwa-install-dismissed-at', 'zad.pwa-install-dismissed-at'];
const DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;
const CLOSE_TRANSITION_MS = 240;
const PROMPT_DELAY_MS = 5000;

function wasRecentlyDismissed() {
  try {
    const now = Date.now();
    const dismissedAt = DISMISSED_AT_KEYS.map((key) => Number(window.localStorage.getItem(key)))
      .find((timestamp) => Number.isFinite(timestamp) && timestamp <= now && now - timestamp < DISMISSAL_TTL_MS);
    if (dismissedAt) return true;
    DISMISSED_AT_KEYS.forEach((key) => window.localStorage.removeItem(key));
    return false;
  } catch (error) {
    console.error('Could not read the install prompt preference:', error);
    return false;
  }
}
// === نهاية ذاكرة تلميح التثبيت / Install prompt memory ===

// === بداية تعليمات التثبيت حسب الجهاز / Device-specific install instructions ===
function getInstallInstructions() {
  const userAgent = window.navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/u.test(userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  if (isAppleMobile) {
    return 'على iPhone أو iPad: افتح هذه الصفحة في Safari، واضغط «مشاركة» ثم «إضافة إلى الشاشة الرئيسية».';
  }
  if (/Android/u.test(userAgent)) {
    return 'على Android: افتح قائمة Chrome (⋮) أو Edge، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».';
  }
  if (/Edg\//u.test(userAgent)) {
    return 'على الكمبيوتر: اختر «تطبيقات» ثم «تثبيت هذا الموقع كتطبيق» من قائمة Microsoft Edge.';
  }
  if (/Chrome\//u.test(userAgent)) {
    return 'على الكمبيوتر: اختر رمز التثبيت في شريط العنوان، أو افتح قائمة Chrome (⋮) ثم «تثبيت أُنْس».';
  }
  return 'للتثبيت يدوياً: افتح قائمة المتصفح أو قائمة المشاركة، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».';
}
// === نهاية تعليمات التثبيت حسب الجهاز / Device-specific install instructions ===

// === بداية مكون تلميح التثبيت / Install prompt component ===
export default function InstallPrompt() {
  const installEvent = useRef(null);
  const promptRef = useRef(null);
  const revealTimer = useRef(0);
  const closeTimer = useRef(0);
  // تحفظ هذه الحالات ظهور النافذة وانتقال إغلاقها ورسائل التثبيت اليدوي.
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  // تعرض هذه القيمة تعليمات التثبيت المناسبة لنظام المستخدم ومتصفحه.
  const [instructions] = useState(getInstallInstructions);

  const rememberChoice = useCallback(() => {
    try {
      DISMISSED_AT_KEYS.forEach((key) => window.localStorage.setItem(key, String(Date.now())));
    } catch (error) {
      console.error('Could not save the install prompt preference:', error);
    }
  }, []);

  const closePrompt = useCallback((remember = true) => {
    if (remember) rememberChoice();
    window.clearTimeout(closeTimer.current);
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
      setShowInstructions(false);
    }, CLOSE_TRANSITION_MS);
  }, [rememberChoice]);

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true || wasRecentlyDismissed()) return undefined;

    const revealPrompt = () => {
      setVisible(true);
    };
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      installEvent.current = event;
    };
    const onAppInstalled = () => {
      installEvent.current = null;
      closePrompt(true);
    };

    revealTimer.current = window.setTimeout(revealPrompt, PROMPT_DELAY_MS);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.clearTimeout(revealTimer.current);
      window.clearTimeout(closeTimer.current);
    };
  }, [closePrompt]);

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closePrompt(true);
    };
    const onPointerDown = (event) => {
      if (promptRef.current && !promptRef.current.contains(event.target)) closePrompt(true);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [closePrompt, visible]);

  async function installApp() {
    const promptEvent = installEvent.current;
    if (!promptEvent) {
      setShowInstructions(true);
      return;
    }

    installEvent.current = null;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        closePrompt(true);
      } else {
        setShowInstructions(true);
      }
    } catch (error) {
      console.error('Could not open the browser install prompt:', error);
      setShowInstructions(true);
    }
  }

  if (!visible) return null;

  return (
    <>
      <div
        className={`pwa-install-backdrop${closing ? ' is-closing' : ''}`}
        aria-hidden="true"
        aria-label="إغلاق نافذة تثبيت أُنْس"
      />
      <aside
        ref={promptRef}
        className={`pwa-install-prompt${closing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="pwa-install-title"
        aria-describedby="pwa-install-description"
      >
        <div className="pwa-install-prompt-heading">
          <h2 id="pwa-install-title">ثبّت أُنْس على جهازك</h2>
          <button
            className="pwa-install-prompt-close"
            type="button"
            onClick={() => closePrompt(true)}
            aria-label="إغلاق تلميح التثبيت"
          >
            ×
          </button>
        </div>
        <p id="pwa-install-description">أضف التطبيق إلى جهازك لفتح القرآن والأذكار بسرعة.</p>
        <p className="pwa-install-instructions">{instructions}</p>
        {showInstructions && <p className="pwa-install-instructions">يمكنك إكمال التثبيت بهذه الخطوات متى شئت.</p>}
        <div className="pwa-install-prompt-actions">
          <button
            className="btn btn-success btn-sm"
            type="button"
            onClick={showInstructions ? () => closePrompt(true) : installApp}
          >
            {showInstructions ? 'حسنًا' : 'تثبيت التطبيق'}
          </button>
        </div>
      </aside>
    </>
  );
}
// === نهاية مكون تلميح التثبيت / Install prompt component ===
