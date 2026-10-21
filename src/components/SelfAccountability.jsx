import { useEffect, useMemo, useState } from 'react';
import { readStorage, writeStorage } from '../services/storage.js';

const STORAGE_KEY = 'zad.selfAccountability.v1';
const WORSHIP_STORAGE_KEY = 'zad.worshipTracking.v1';
const CATEGORIES = [
  { id: 'prayer', title: 'الصلاة', tasks: ['الفجر', 'الضحى', 'الظهر', 'العصر', 'المغرب', 'العشاء', 'القيام', 'السنن', 'المسجد'] },
  { id: 'quran', title: 'القرآن الكريم', tasks: ['حفظ', 'تسميع', 'ورد'] },
  { id: 'adhkar', title: 'الأذكار', tasks: ['الصباح', 'المساء'] },
  { id: 'daily', title: 'الطاعات اليومية', tasks: ['صدقة', 'حفظ حديث', 'دعاء للمسلمين', 'تسابيح', 'زيارة مريض', 'قراءة وإطلاع'] },
];
const DEFAULT_TASKS = CATEGORIES.flatMap((category) => category.tasks.map((title, index) => ({
  id: `default-${category.id}-${index}`,
  title,
  category: category.id,
  custom: false,
})));
const BADGES = [
  { id: 'first-day', title: 'بداية الاستمرار', description: 'أكمل يوماً واحداً', days: 1 },
  { id: 'week', title: 'أسبوع من الثبات', description: 'حافظ على وردك سبعة أيام متتابعة', days: 7 },
  { id: 'month', title: 'شهر من المواظبة', description: 'واصل المحاسبة ثلاثين يوماً', days: 30 },
  { id: 'year', title: 'عام كامل', description: 'عام من الثبات والمداومة', days: 365 },
];

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseTrackerState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { tasks: DEFAULT_TASKS, days: {} };
  }
  const customTasks = Array.isArray(value.tasks)
    ? value.tasks.filter((task) => task && task.custom === true
      && typeof task.id === 'string' && /^custom-[\w-]{1,80}$/u.test(task.id)
      && typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 80
      && typeof task.category === 'string' && CATEGORIES.some((category) => category.id === task.category))
      .slice(0, 80)
    : [];
  const availableTasks = new Map([...DEFAULT_TASKS, ...customTasks].map((task) => [task.id, task]));
  const orderedTasks = Array.isArray(value.tasks)
    ? [...new Set(value.tasks.map((task) => task?.id).filter((id) => availableTasks.has(id)))].map((id) => availableTasks.get(id))
    : [];
  const taskOrder = [...orderedTasks, ...DEFAULT_TASKS.filter((task) => !orderedTasks.some((item) => item.id === task.id)), ...customTasks.filter((task) => !orderedTasks.some((item) => item.id === task.id))];
  const days = {};
  if (value.days && typeof value.days === 'object' && !Array.isArray(value.days)) {
    Object.entries(value.days).slice(-730).forEach(([date, record]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !record || typeof record !== 'object'
        || !Array.isArray(record.checked) || !Number.isInteger(record.total) || record.total < 0) return;
      days[date] = {
        checked: [...new Set(record.checked.filter((id) => typeof id === 'string').slice(0, 200))],
        total: record.total,
      };
    });
  }
  return { tasks: taskOrder, days };
}

function completionPercent(record) {
  if (!record || record.total <= 0) return 0;
  return Math.round((Math.min(record.checked.length, record.total) / record.total) * 100);
}

function calculateTrackerAnalytics(days, today) {
  const activeDays = Object.entries(days)
    .filter(([, record]) => record.total > 0 && record.checked.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  let longestStreak = 0;
  let currentStreak = 0;
  let previousDate = '';
  for (const [date] of activeDays) {
    currentStreak = previousDate && moveDay(previousDate, 1) === date ? currentStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    previousDate = date;
  }
  const percentages = Object.values(days)
    .filter((record) => record.total > 0)
    .map(completionPercent);
  const bestDay = Object.entries(days)
    .filter(([, record]) => record.total > 0)
    .sort((left, right) => completionPercent(right[1]) - completionPercent(left[1]))[0];
  return {
    longestStreak,
    currentStreak: activeDays.some(([date]) => date === today) ? currentStreak : 0,
    average: percentages.length
      ? Math.round(percentages.reduce((total, percent) => total + percent, 0) / percentages.length)
      : 0,
    bestDay: bestDay ? { date: bestDay[0], percent: completionPercent(bestDay[1]) } : null,
  };
}

function moveDay(date, amount) {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + amount);
  return localDateKey(next);
}

/* === Start Section === */
let notificationPermissionRequest;
function requestDailyNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  if (!notificationPermissionRequest) {
    notificationPermissionRequest = Notification.requestPermission().then((permission) => {
      if (permission === 'granted') window.dispatchEvent(new Event('zad:notifications-enabled'));
      return permission;
    }).catch(() => 'denied');
  }
}
/* === End Section === */
/* === Start Section === */
function scheduleLocalDailyReminder() {
  let timeoutId;
  let active = true;
  async function scheduleNext() {
    if (!active || !('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(22, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    timeoutId = window.setTimeout(async () => {
      if (!active) return;
      const registration = await navigator.serviceWorker.ready;
      try { await registration.showNotification('مراقبة الذات', {
        body: 'طَمنّا على يومك 🌿 | حان موعد مراجعة أفعالك اليومية في قسم مراقبة الذات',
        icon: './assets/icons/icon-192x192.png',
        tag: 'zad-daily-self-review',
      }); } catch { }
      scheduleNext();
    }, next.getTime() - now.getTime());
  }
  scheduleNext();
  return () => { active = false; window.clearTimeout(timeoutId); };
}
/* === End Section === */
function SelfAccountability() {
  const [data, setData] = useState(() => parseTrackerState(readStorage(STORAGE_KEY, null)));
  const [worshipData, setWorshipData] = useState(() => parseTrackerState(readStorage(WORSHIP_STORAGE_KEY, null)));
  const [view, setView] = useState('today');
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customCategory, setCustomCategory] = useState('daily');
  const [notice, setNotice] = useState('');
  const today = localDateKey();
  const todayRecord = data.days[today];
  const worshipTodayRecord = worshipData.days[today];
  const checkedToday = new Set(todayRecord?.checked ?? []);
  const worshipCheckedToday = new Set(worshipTodayRecord?.checked ?? []);
  const completedToday = data.tasks.filter((task) => checkedToday.has(task.id)).length;
  const completedWorshipToday = worshipData.tasks.filter((task) => worshipCheckedToday.has(task.id)).length;
  const accountabilityPercent = data.tasks.length ? Math.round((completedToday / data.tasks.length) * 100) : 0;
  const worshipPercent = worshipData.tasks.length ? Math.round((completedWorshipToday / worshipData.tasks.length) * 100) : 0;
  const totalCompletedToday = completedToday + completedWorshipToday;
  const totalTasksToday = data.tasks.length + worshipData.tasks.length;
  const overallPercent = totalTasksToday ? Math.round((totalCompletedToday / totalTasksToday) * 100) : 0;
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);
  const selectedRecord = data.days[selectedDate];

  useEffect(() => {
    const start = () => scheduleLocalDailyReminder();
    let cleanup = start();
    const enabled = () => { cleanup?.(); cleanup = start(); };
    window.addEventListener('zad:notifications-enabled', enabled);
    return () => { cleanup?.(); window.removeEventListener('zad:notifications-enabled', enabled); };
  }, []);
  useEffect(() => {
    const tab = document.querySelector('#accountability-tab');
    if (!tab) return undefined;
    const handleOpen = () => {
      setView('today');
      setSelectedDate(localDateKey());
      requestDailyNotificationPermission();
    };
    tab.addEventListener('shown.bs.tab', handleOpen);
    return () => tab.removeEventListener('shown.bs.tab', handleOpen);
  }, []);

  useEffect(() => {
    if (!writeStorage(STORAGE_KEY, data)) {
      setNotice('تعذر حفظ التغييرات على هذا الجهاز. تحقّق من مساحة التخزين المتاحة.');
    } else {
      setNotice('');
    }
  }, [data]);

  useEffect(() => {
    if (!writeStorage(WORSHIP_STORAGE_KEY, worshipData)) {
      setNotice('تعذر حفظ قائمة عباداتي على هذا الجهاز. تحقق من مساحة التخزين المتاحة.');
    } else {
      setNotice('');
    }
  }, [worshipData]);

  useEffect(() => {
    const restoreCloudData = (event) => {
      const keys = event.detail?.keys ?? [];
      if (keys.includes(STORAGE_KEY)) setData(parseTrackerState(readStorage(STORAGE_KEY, null)));
      if (keys.includes(WORSHIP_STORAGE_KEY)) setWorshipData(parseTrackerState(readStorage(WORSHIP_STORAGE_KEY, null)));
    };
    window.addEventListener('uns:cloud-data-restored', restoreCloudData);
    return () => window.removeEventListener('uns:cloud-data-restored', restoreCloudData);
  }, []);

  useEffect(() => {
    if (!customDialogOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setCustomDialogOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [customDialogOpen]);

  const analytics = useMemo(() => calculateTrackerAnalytics(data.days, today), [data.days, today]);
  const worshipAnalytics = useMemo(() => calculateTrackerAnalytics(worshipData.days, today), [worshipData.days, today]);

  const monthDates = useMemo(() => {
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    const offset = (first.getDay() + 1) % 7;
    return [
      ...Array.from({ length: offset }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) => localDateKey(
        new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index + 1),
      )),
    ];
  }, [calendarMonth]);

  function updateTracker(update) {
    setData((current) => {
      const next = update(current);
      const dayEntries = Object.entries(next.days).sort(([left], [right]) => left.localeCompare(right));
      if (dayEntries.length > 730) {
        next.days = Object.fromEntries(dayEntries.slice(-730));
      }
      return next;
    });
  }

  function updateWorshipTracker(update) {
    setWorshipData((current) => {
      const next = update(current);
      const dayEntries = Object.entries(next.days).sort(([left], [right]) => left.localeCompare(right));
      if (dayEntries.length > 730) {
        next.days = Object.fromEntries(dayEntries.slice(-730));
      }
      return next;
    });
  }

  function toggleTask(taskId) {
    requestDailyNotificationPermission();
    updateTracker((current) => {
      const record = current.days[today] ?? { checked: [], total: current.tasks.length };
      const checked = new Set(record.checked);
      if (checked.has(taskId)) checked.delete(taskId);
      else checked.add(taskId);
      return {
        ...current,
        days: {
          ...current.days,
          [today]: { checked: [...checked], total: current.tasks.length },
        },
      };
    });
  }

  function toggleWorshipTask(taskId) {
    requestDailyNotificationPermission();
    updateWorshipTracker((current) => {
      const record = current.days[today] ?? { checked: [], total: current.tasks.length };
      const checked = new Set(record.checked);
      if (checked.has(taskId)) checked.delete(taskId);
      else checked.add(taskId);
      return {
        ...current,
        days: {
          ...current.days,
          [today]: { checked: [...checked], total: current.tasks.length },
        },
      };
    });
  }

  function addCustomTask(event) {
    event.preventDefault();
    const title = customTitle.trim();
    if (title.length < 2 || title.length > 80) {
      setNotice('اكتب اسم عبادة يتراوح بين حرفين و80 حرفاً.');
      return;
    }
    const task = {
      id: `custom-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      title,
      category: customCategory,
      custom: true,
    };
    updateWorshipTracker((current) => ({ ...current, tasks: [...current.tasks, task] }));
    setCustomTitle('');
    setCustomDialogOpen(false);
  }

  function moveTask(taskId, offset) {
    updateWorshipTracker((current) => {
      const task = current.tasks.find((item) => item.id === taskId);
      if (!task) return current;
      const categoryTasks = current.tasks.filter((item) => item.category === task.category);
      const categoryIndex = categoryTasks.findIndex((item) => item.id === taskId);
      const destinationTask = categoryTasks[categoryIndex + offset];
      if (!destinationTask) return current;
      const index = current.tasks.findIndex((item) => item.id === taskId);
      const destination = current.tasks.findIndex((item) => item.id === destinationTask.id);
      const tasks = [...current.tasks];
      [tasks[index], tasks[destination]] = [tasks[destination], tasks[index]];
      return { ...current, tasks };
    });
  }

  function renderTaskGroups(date, record, editable, canToggle = true, tracker = data, toggle = toggleTask) {
    const completed = new Set(record?.checked ?? []);
    return CATEGORIES.map((category) => {
      const tasks = tracker.tasks.filter((task) => task.category === category.id);
      if (!tasks.length) return null;
      return (
        <section className="worship-category" key={category.id} aria-labelledby={`worship-category-${category.id}`}>
          <div className="worship-category-heading">
            <h3 id={`worship-category-${category.id}`}>{category.title}</h3>
            <span>{tasks.filter((task) => completed.has(task.id)).length} / {tasks.length}</span>
          </div>
          <div className="worship-task-list">
            {tasks.map((task) => {
              const index = tracker.tasks.findIndex((item) => item.id === task.id);
              return (
                <label className={`worship-task${completed.has(task.id) ? ' is-complete' : ''}`} key={task.id}>
                  <input
                    type="checkbox"
                    checked={completed.has(task.id)}
                    disabled={!canToggle}
                    onChange={() => {
                      if (date === today) toggle(task.id);
                    }}
                    aria-label={`${task.title} ${completed.has(task.id) ? 'مكتمل' : 'غير مكتمل'}`}
                  />
                  <span>{task.title}</span>
                  {task.custom && <span className="worship-custom-tag">مخصص</span>}
                  {editable && (
                    <span className="worship-task-order">
                      <button type="button" disabled={index === 0} onClick={() => moveTask(task.id, -1)} aria-label={`تقديم ${task.title}`}>↑</button>
                      <button type="button" disabled={index === tracker.tasks.length - 1} onClick={() => moveTask(task.id, 1)} aria-label={`تأخير ${task.title}`}>↓</button>
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </section>
      );
    });
  }

  function renderCalendar() {
    return (
      <section className="worship-calendar" aria-label="سجل العبادات الشهري">
        <div className="worship-calendar-toolbar">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="الشهر السابق">‹</button>
          <h3>{new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(calendarMonth)}</h3>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setCalendarMonth((month) => {
            const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
            return next <= new Date(new Date().getFullYear(), new Date().getMonth(), 1) ? next : month;
          })} aria-label="الشهر التالي" disabled={calendarMonth.getFullYear() === new Date().getFullYear() && calendarMonth.getMonth() === new Date().getMonth()}>›</button>
        </div>
        <div className="worship-calendar-grid" role="grid" aria-label="أيام الشهر">
          {['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map((day) => <span className="worship-weekday" role="columnheader" key={day}>{day}</span>)}
          {monthDates.map((date, index) => {
            if (!date) return <span className="worship-calendar-empty" aria-hidden="true" key={`empty-${index}`} />;
            const record = data.days[date];
            const percent = completionPercent(record);
            return (
              <button
                type="button"
                role="gridcell"
                className={`worship-calendar-day${percent ? ' has-progress' : ''}${date === selectedDate ? ' is-selected' : ''}`}
                key={date}
                onClick={() => setSelectedDate(date)}
                aria-label={`${date}: تم إتمام ${record?.checked.length ?? 0} من ${record?.total ?? data.tasks.length} عبادة، ${percent}%`}
                aria-pressed={date === selectedDate}
                title={`${percent}% مكتمل`}
              >
                <span>{Number(date.slice(-2))}</span>
                <small>{percent}%</small>
              </button>
            );
          })}
        </div>
        <p className="worship-calendar-summary">
          {selectedDate}: تم إتمام {selectedRecord?.checked.length ?? 0} من {selectedRecord?.total ?? data.tasks.length} عبادة - {completionPercent(selectedRecord)}%
        </p>
      </section>
    );
  }

  function renderStatistics(title, trackerDays, trackerAnalytics) {
    const highEffort = Object.values(trackerDays).some((record) => completionPercent(record) >= 80);
    return (
      <section className="accountability-stats" aria-label={title}>
        <h2>{title}</h2>
        <div className="accountability-stat-grid">
          <article><span>السلسلة الحالية</span><strong>{trackerAnalytics.currentStreak} يوم</strong></article>
          <article><span>أطول سلسلة ثبات</span><strong>{trackerAnalytics.longestStreak} يوم</strong></article>
          <article><span>متوسط الإنجاز</span><strong>{trackerAnalytics.average}%</strong></article>
          <article><span>أفضل يوم إنجاز</span><strong>{trackerAnalytics.bestDay ? `${trackerAnalytics.bestDay.percent}% · ${trackerAnalytics.bestDay.date}` : 'ابدأ أول يوم'}</strong></article>
        </div>
        <section className="worship-badges">
          <h3>أوسمة الثبات</h3>
          <div className="worship-badge-grid">
            {BADGES.map((badge) => {
              const unlocked = trackerAnalytics.longestStreak >= badge.days;
              return (
                <article className={`worship-badge${unlocked ? ' is-unlocked' : ''}`} key={badge.id} aria-label={`${badge.title}: ${unlocked ? 'مفتوح' : 'مقفل'}`}>
                  <span aria-hidden="true">{unlocked ? '✦' : '◇'}</span>
                  <strong>{badge.title}</strong>
                  <small>{badge.description}</small>
                </article>
              );
            })}
            <article className={`worship-badge${highEffort ? ' is-unlocked' : ''}`}>
              <span aria-hidden="true">{highEffort ? '✦' : '◇'}</span>
              <strong>همة عالية</strong>
              <small>أتمم 80% من القائمة في يوم واحد</small>
            </article>
          </div>
        </section>
      </section>
    );
  }

  return (
    <>
      <section className="tab-pane fade accountability-panel" id="accountability-panel" role="tabpanel" aria-labelledby="accountability-tab" tabIndex="0">
        <header className="accountability-heading">
          <div>
            <p className="section-kicker">خطوةٌ صغيرة كل يوم</p>
            <h1>مراقبة الذات</h1>
            <p className="section-description">واجعل للطاعة في يومك أثراً تراه وتستمر عليه.</p>
          </div>
          <div className="accountability-today-summary" aria-live="polite">
            <strong>{overallPercent}%</strong>
            <span>المجموع: {totalCompletedToday} من {totalTasksToday} · حاسب نفسك {accountabilityPercent}% · عباداتي {worshipPercent}%</span>
          </div>
        </header>

        <nav className="accountability-tabs" aria-label="صفحات مراقبة الذات">
          {[
            ['today', 'حاسب نفسك'],
            ['worships', 'عباداتي'],
            ['calendar', 'التقويم الإحصائي'],
          ].map(([value, label]) => (
            <button type="button" className={view === value ? 'is-active' : ''} aria-current={view === value ? 'page' : undefined} onClick={() => setView(value)} key={value}>{label}</button>
          ))}
        </nav>
        {view === 'today' && (
          <>
            <blockquote className="accountability-quote">«أحب الأعمال إلى الله أدومها وإن قل»</blockquote>
            {notice && <p className="accountability-notice" role="status">{notice}</p>}
            <div className="worship-categories">{renderTaskGroups(today, todayRecord, false)}</div>
            {renderStatistics('إحصائيات الثبات والسمات · حاسب نفسك', data.days, analytics)}
          </>
        )}

        {view === 'worships' && (
          <section className="worships-daily-view">
            <h2>عباداتي اليومية</h2>
            <div className="worship-progress-ring" role="img" aria-label={`${worshipPercent}% مكتمل`} style={{ '--progress': `${worshipPercent * 3.6}deg` }}><strong>{worshipPercent}%</strong></div>
            <div className="worship-categories">{renderTaskGroups(today, worshipTodayRecord, true, true, worshipData, toggleWorshipTask)}</div>
            <button type="button" className="worship-add-button" onClick={() => setCustomDialogOpen(true)} aria-label="إضافة عبادة">+</button>
            {renderStatistics('إحصائيات الثبات والسمات · عباداتي', worshipData.days, worshipAnalytics)}
          </section>
        )}
        {view === 'calendar' && (
          <div className="accountability-review">
            <h2>سجل العبادات</h2>
            {renderCalendar()}
            <h3 className="accountability-review-title">إنجاز يوم {selectedDate}</h3>
            <div className="worship-categories">{renderTaskGroups(selectedDate, selectedRecord, false, false)}</div>
          </div>
        )}

        {view === 'calendar' && renderStatistics('إحصائيات الثبات والأوسمة', data.days, analytics)}
      </section>

      <button
        type="button"
        className="accountability-floating-badge"
        aria-label={`افتح عباداتي، ${worshipPercent}% مكتمل اليوم`}
        onClick={() => {
          const tab = document.querySelector('#accountability-tab');
          if (!tab) throw new Error('تعذر العثور على تبويب حاسب نفسك.');
          if (tab.classList.contains('active')) setView('worships');
          else tab.click();
        }}
      >
        <span aria-hidden="true">✦</span><strong>عباداتي</strong><small>{worshipPercent}% مكتمل</small>
      </button>

      {customDialogOpen && (
        <div className="accountability-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCustomDialogOpen(false);
        }}>
          <form className="accountability-dialog accountability-custom-form" onSubmit={addCustomTask} aria-labelledby="custom-worship-title">
            <button type="button" className="accountability-dialog-close" onClick={() => setCustomDialogOpen(false)} aria-label="إغلاق">×</button>
            <p className="section-kicker">عبادة على خطتك</p>
            <h2 id="custom-worship-title">إضافة عبادة</h2>
            <label htmlFor="custom-worship-name">اسم العبادة</label>
            <input id="custom-worship-name" className="form-control" value={customTitle} maxLength={80} required minLength={2} onChange={(event) => setCustomTitle(event.target.value)} autoFocus />
            <label htmlFor="custom-worship-category">القسم</label>
            <select id="custom-worship-category" className="form-select" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)}>
              {CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
            </select>
            {notice && <p className="accountability-notice" role="status">{notice}</p>}
            <button type="submit" className="btn btn-success">إضافة إلى قائمتي</button>
          </form>
        </div>
      )}
    </>
  );
}

export default SelfAccountability;
