'use client';

import { useEffect, useId, useState } from 'react';
import s from '@/city/components/hud/hud.module.css';
import { num, useWords } from '@/city/lib/i18n/dict';
import { useQuarter } from '@/city/lib/quarter/store';
import { dayOf, dayTasks } from './day.ts';
import { DAY_WORDS, taskWord } from './day-words.ts';
import { levelProgress } from './levels.ts';
import d from './day-panel.module.css';

/**
 * The day's tasks and the points, over my quarter while I build: folded to one row — «Today», a diamond a task, the
 * points — and, unfolded, each task, the level and its bar. How far the next level is opens from the level itself.
 * The tasks are the server's own (`me.tasks` of `GET /api/world/me`, `dayTasks` in `day.ts`); a task the server has
 * not seen today starts at zero, so the panel is right the moment the day turns.
 */
export function DayPanel() {
  const mode = useQuarter((st) => st.mode);
  const me = useQuarter((st) => st.me);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [toGo, setToGo] = useState(false);
  const body = useId();
  const w = useWords(DAY_WORDS);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  if (mode !== 'build' || !me) return null;

  const tasks = dayTasks(me.tasks, me.resident.id, dayOf(now));
  const done = tasks.filter((t) => t.done).length;
  const total = me.points.total;
  const level = levelProgress(total);

  return (
    <section className={`${s.panel} ${d.panel} ${open ? '' : d.folded}`} aria-label={w.region}>
      <button className={d.head} aria-expanded={open} aria-controls={body} aria-label={w.head(done, tasks.length, total)} onClick={() => setOpen(!open)}>
        <span className={d.kicker}>{w.today}</span>
        <span className={d.pips} aria-hidden="true">
          {tasks.map((t) => (
            <span key={t.kind} className={`${d.pip} ${t.done ? d.pipDone : ''}`} />
          ))}
        </span>
        <span className={d.total} aria-hidden="true">
          {num(total)}
          <span className={d.unit}>{w.pointsUnit(total)}</span>
        </span>
        <svg className={d.chevron} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={body} className={d.body} hidden={!open}>
        <ul className={d.tasks}>
          {tasks.map((t) => (
            <li key={t.kind} className={`${d.task} ${t.done ? d.done : ''}`}>
              <span className={`${d.pip} ${t.done ? d.pipDone : ''}`} aria-hidden="true" />
              {taskWord(w, t.kind, t.line)}
              {t.goal > 1 && (
                <span className={d.count}>
                  {t.progress}/{t.goal}
                </span>
              )}
            </li>
          ))}
        </ul>
        <button
          className={d.level}
          aria-expanded={toGo}
          aria-label={level.next ? w.levelLine(level.level, level.toGo, level.next.level) : w.levelTop(level.level)}
          onClick={() => setToGo(!toGo)}
        >
          <span className={d.levelLine}>
            <span>
              {w.level} <b>{level.level}</b>
            </span>
            {toGo && <span>{level.next ? w.toNext(num(level.toGo), level.next.level) : w.top}</span>}
          </span>
          <span className={d.bar} aria-hidden="true">
            <span className={d.fill} style={{ transform: `scaleX(${level.share})` }} />
          </span>
        </button>
      </div>
    </section>
  );
}
