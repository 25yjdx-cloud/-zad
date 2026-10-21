import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'uns.periodic-reminder-minutes.v1';
const INTERVALS = new Set([10, 25]);
const REMINDERS = [
  { heading: 'استراحة ذكر', text: 'سبحان الله، والحمد لله، ولا إله إلا الله، والله أكبر.' },
  { heading: 'ورد قصير', text: 'اللهم أعنّي على ذكرك وشكرك وحسن عبادتك.' },
  { heading: 'لحظة تدبّر', text: 'خذ نفسًا هادئًا، واختر آيةً تقرؤها بقلب حاضر.' },
];

function readInterval() {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return INTERVALS.has(value) ? value : 25;
  } catch {
    return 25;
  }
}

export default function PeriodicReminder() {
  const [intervalMinutes, setIntervalMinutes] = useState(readInterval);
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [reminderIndex, setReminderIndex] = useState(0);
  const dueWhileHidden = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') setOpen(true);
      else dueWhileHidden.current = true;
    }, intervalMinutes * 60 * 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && dueWhileHidden.current) {
        dueWhileHidden.current = false;
        setOpen(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMinutes, cycle]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') closeReminder();
    };
    document.body.classList.add('periodic-reminder-open');
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.classList.remove('periodic-reminder-open');
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function closeReminder() {
    setOpen(false);
    setReminderIndex((index) => (index + 1) % REMINDERS.length);
    setCycle((value) => value + 1);
  }

  function updateInterval(event) {
    const value = Number(event.target.value);
    if (!INTERVALS.has(value)) return;
    setIntervalMinutes(value);
    try { window.localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Keep this session's choice. */ }
  }

  if (!open) return null;
  const reminder = REMINDERS[reminderIndex];

  return (
    <div className="periodic-reminder-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeReminder();
    }}>
      <section className="periodic-reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="periodic-reminder-title" dir="rtl">
        <button className="periodic-reminder-close" type="button" onClick={closeReminder} aria-label="إغلاق التذكير">×</button>
        <span className="periodic-reminder-icon" aria-hidden="true">✧</span>
        <p className="section-kicker">أُنْس بذكر الله</p>
        <h2 id="periodic-reminder-title">{reminder.heading}</h2>
        <p className="periodic-reminder-text">{reminder.text}</p>
        <label className="periodic-reminder-frequency">
          <span>تكرار التذكير</span>
          <select value={intervalMinutes} onChange={updateInterval}>
            <option value="10">كل 10 دقائق</option>
            <option value="25">كل 25 دقيقة</option>
          </select>
        </label>
        <button className="periodic-reminder-confirm" type="button" onClick={closeReminder}>حسنًا، بارك الله فيك</button>
      </section>
    </div>
  );
}
