import { useEffect, useMemo, useState } from 'react';
import { HEART_WORKS } from '../data/heartWorks.js';
import { readStorage, writeStorage } from '../services/storage.js';

const STORAGE_KEY = 'zad.heartWorks.v1';

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseHeartState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { days: {} };
  }
  const days = {};
  if (value.days && typeof value.days === 'object' && !Array.isArray(value.days)) {
    Object.entries(value.days).slice(-365).forEach(([date, ids]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Array.isArray(ids)) return;
      days[date] = [...new Set(ids.filter((id) => HEART_WORKS.some((item) => item.id === id)))];
    });
  }
  return { days };
}

export default function HeartWorks() {
  const [data, setData] = useState(() => parseHeartState(readStorage(STORAGE_KEY, null)));
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState(HEART_WORKS[0].id);
  const today = localDateKey();
  const practicedToday = new Set(data.days[today] ?? []);
  const todayCount = practicedToday.size;

  useEffect(() => {
    if (!writeStorage(STORAGE_KEY, data)) {
      setNotice('تعذر حفظ تعاهد أعمال القلوب على هذا الجهاز.');
    } else {
      setNotice('');
    }
  }, [data]);

  const streak = useMemo(() => {
    let count = 0;
    let cursor = today;
    while ((data.days[cursor] ?? []).length > 0) {
      count += 1;
      const previous = new Date(`${cursor}T12:00:00`);
      previous.setDate(previous.getDate() - 1);
      cursor = localDateKey(previous);
      if (count > 365) break;
    }
    return count;
  }, [data.days, today]);

  function togglePractice(id) {
    setData((current) => {
      const checked = new Set(current.days[today] ?? []);
      if (checked.has(id)) checked.delete(id);
      else checked.add(id);
      const days = { ...current.days, [today]: [...checked] };
      if (days[today].length === 0) delete days[today];
      const entries = Object.entries(days).sort(([left], [right]) => left.localeCompare(right));
      return { days: Object.fromEntries(entries.slice(-365)) };
    });
  }

  return (
    <section className="tab-pane fade hearts-panel" id="hearts-panel" role="tabpanel" aria-labelledby="hearts-tab" tabIndex="0">
      <header className="hearts-heading">
        <div>
          <p className="section-kicker">صلاح الباطن قبل الظاهر</p>
          <h1>أعمال القلوب</h1>
          <p className="section-description">
            مقامات يعالج بها القلب: نيّة، ومراقبة، وصبر، وشكر. تعاهد واحدة أو أكثر كل يوم، دون إطالة تقطع المداومة.
          </p>
        </div>
        <div className="hearts-today-summary" aria-live="polite">
          <strong>{todayCount}/{HEART_WORKS.length}</strong>
          <span>تعاهدت {todayCount} عملاً اليوم · سلسلة {streak} يوم</span>
        </div>
      </header>

      {notice && <p className="hearts-notice" role="status">{notice}</p>}

      <div className="hearts-grid">
        {HEART_WORKS.map((item) => {
          const isOpen = openId === item.id;
          const done = practicedToday.has(item.id);
          return (
            <article className={`hearts-card${done ? ' is-done' : ''}${isOpen ? ' is-open' : ''}`} key={item.id}>
              <button
                type="button"
                className="hearts-card-toggle"
                aria-expanded={isOpen}
                onClick={() => setOpenId((current) => (current === item.id ? '' : item.id))}
              >
                <span aria-hidden="true">♡</span>
                <strong>{item.title}</strong>
                <small>{done ? 'تعاهدت به اليوم' : 'اضغط للتدبّر'}</small>
              </button>
              {isOpen && (
                <div className="hearts-card-body">
                  <p>{item.summary}</p>
                  <p className="hearts-practice"><strong>عمل اليوم:</strong> {item.practice}</p>
                  <label className="hearts-check">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => togglePractice(item.id)}
                    />
                    <span>تعاهدت بهذا العمل اليوم</span>
                  </label>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
