import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRandomSpiritualMessage,
  readSpiritualMessageFavorites,
  SPIRITUAL_MESSAGE_AUTO_DELAY_SECONDS,
  SPIRITUAL_MESSAGE_REPEAT_SECONDS,
  SPIRITUAL_MESSAGE_STORAGE_KEYS,
  toggleSpiritualMessageFavorite,
  usableSpiritualMessages,
} from '../services/spiritualMessages.js';

function readSessionNumber(key) {
  try {
    const value = Number(window.sessionStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch { return 0; }
}

async function copyText(text) {
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
  if (!copied) throw new Error('Clipboard is unavailable');
}

export default function SpiritualMessageModal() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [favorites, setFavorites] = useState(readSpiritualMessageFavorites);
  const [copyStatus, setCopyStatus] = useState('');
  const openRef = useRef(open);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const returnFocusRef = useRef(null);
  const copyStatusTimerRef = useRef(null);

  useEffect(() => { openRef.current = open; }, [open]);

  const showMessage = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMessage((current) => getRandomSpiritualMessage(current?.id));
    setCopyStatus('');
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    let elapsed = readSessionNumber(SPIRITUAL_MESSAGE_STORAGE_KEYS.usageSeconds);
    let nextPromptAt = readSessionNumber(SPIRITUAL_MESSAGE_STORAGE_KEYS.nextPromptSeconds)
      || SPIRITUAL_MESSAGE_AUTO_DELAY_SECONDS;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      elapsed += 1;
      try {
        window.sessionStorage.setItem(SPIRITUAL_MESSAGE_STORAGE_KEYS.usageSeconds, String(elapsed));
      } catch { /* This session's timer continues even when storage is unavailable. */ }
      if (elapsed < nextPromptAt || openRef.current) return;
      nextPromptAt = elapsed + SPIRITUAL_MESSAGE_REPEAT_SECONDS;
      try {
        window.sessionStorage.setItem(SPIRITUAL_MESSAGE_STORAGE_KEYS.nextPromptSeconds, String(nextPromptAt));
      } catch { /* The current session still keeps its in-memory repeat timer. */ }
      showMessage();
    };
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [showMessage]);

  useEffect(() => {
    const onTriggerClick = (event) => {
      if (event.target instanceof Element && event.target.closest('[data-open-spiritual-message]')) {
        event.preventDefault();
        showMessage();
      }
    };
    document.addEventListener('click', onTriggerClick);
    return () => document.removeEventListener('click', onTriggerClick);
  }, [showMessage]);

  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('spiritual-message-open');
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
      document.body.classList.remove('spiritual-message-open');
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, open]);

  useEffect(() => () => window.clearTimeout(copyStatusTimerRef.current), []);

  const nextMessage = () => {
    setMessage((current) => getRandomSpiritualMessage(current?.id));
    setCopyStatus('');
  };

  const toggleFavorite = () => {
    if (!message) return;
    setFavorites(toggleSpiritualMessageFavorite(message.id));
  };

  const copyMessage = async () => {
    if (!message) return;
    try {
      await copyText(message.text);
      setCopyStatus('تم نسخ النص');
    } catch {
      setCopyStatus('تعذر النسخ على هذا الجهاز');
    }
    window.clearTimeout(copyStatusTimerRef.current);
    copyStatusTimerRef.current = window.setTimeout(() => setCopyStatus(''), 2200);
  };

  if (!open || !message || usableSpiritualMessages.length === 0) return null;
  const isFavorite = favorites.includes(message.id);

  return (
    <div
      className="spiritual-message-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <section
        ref={dialogRef}
        className="spiritual-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spiritual-message-title"
        aria-describedby="spiritual-message-text"
        dir="rtl"
      >
        <button ref={closeButtonRef} className="spiritual-message-close" type="button" onClick={close} aria-label="إغلاق الرسالة">×</button>
        <div className="spiritual-message-emblem" aria-hidden="true">♡</div>
        <p className="section-kicker">لحظة أُنس وطمأنينة</p>
        <h2 id="spiritual-message-title">خاطرة أُنس 🤍</h2>
        <p className="spiritual-message-category">{message.category}</p>
        <blockquote id="spiritual-message-text" className="spiritual-message-text">{message.text}</blockquote>
        <div className="spiritual-message-actions">
          <button className="spiritual-message-next" type="button" onClick={nextMessage}>رسالة أخرى <span aria-hidden="true">✧</span></button>
          <button className="spiritual-message-copy" type="button" onClick={copyMessage}>نسخ النص</button>
          <button
            className={`spiritual-message-favorite${isFavorite ? ' is-favorite' : ''}`}
            type="button"
            onClick={toggleFavorite}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
            title={isFavorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
          >
            {isFavorite ? '♥' : '♡'}
          </button>
        </div>
        <p className="spiritual-message-copy-status" role="status" aria-live="polite">{copyStatus}</p>
        <span className="spiritual-message-count">{usableSpiritualMessages.length} خاطرة متاحة دون اتصال</span>
      </section>
    </div>
  );
}
