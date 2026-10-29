/**
 * When the city posts: 3 to 5 times of day in one time zone (`RYNTRA_X_SLOTS`, `RYNTRA_X_TZ`). Each time opens a
 * window of 45 minutes; the cron (every 10 minutes) posts the next approved draft in an open window, once. A slot is
 * named by its local day and time (`2026-10-27 18:00`), and the ledger takes each name once, so a slot is one post
 * however many crons run. A window the cron missed is not made up later: posts never bunch.
 */

export const SLOTS_MIN = 3;
export const SLOTS_MAX = 5;
export const SLOT_WINDOW_MIN = 45;
/** Times closer than this would post twice within the hour. */
export const SLOT_GAP_MIN = 60;

export type Slots = { times: number[]; tz: string };
export type Slot = { key: string; day: string; time: string };

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function parseSlots(spec: string, tz: string): { ok: true; slots: Slots } | { ok: false; error: string } {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    return { ok: false, error: `RYNTRA_X_TZ "${tz}" is not a time zone` };
  }
  const times: number[] = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { ok: false, error: `RYNTRA_X_SLOTS has "${part}", not HH:MM` };
    times.push(Number(m[1]) * 60 + Number(m[2]));
  }
  times.sort((a, b) => a - b);
  if (times.length < SLOTS_MIN || times.length > SLOTS_MAX) return { ok: false, error: `RYNTRA_X_SLOTS needs ${SLOTS_MIN} to ${SLOTS_MAX} times, has ${times.length}` };
  for (let i = 0; i < times.length; i += 1) {
    const next = i + 1 < times.length ? times[i + 1]! : times[0]! + 24 * 60;
    if (next - times[i]! < SLOT_GAP_MIN) return { ok: false, error: `RYNTRA_X_SLOTS has ${hhmm(times[i]!)} and ${hhmm(next % (24 * 60))} under ${SLOT_GAP_MIN} minutes apart` };
  }
  return { ok: true, slots: { times, tz } };
}

/** The local day (`YYYY-MM-DD`) and minute of the day of an instant in a zone. */
export function localTime(at: Date, tz: string): { day: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at).map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function dayBefore(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export const slotKey = (day: string, minutes: number) => `${day} ${hhmm(minutes)}`;

/** The slot whose window is open at this instant, or null. */
export function dueSlot(at: Date, slots: Slots): Slot | null {
  const { day, minutes } = localTime(at, slots.tz);
  for (const t of slots.times) {
    if (minutes >= t && minutes < t + SLOT_WINDOW_MIN) return { key: slotKey(day, t), day, time: hhmm(t) };
    // A window that opened before midnight and is still open after it belongs to the day before.
    if (minutes + 24 * 60 < t + SLOT_WINDOW_MIN) {
      const prev = dayBefore(day);
      return { key: slotKey(prev, t), day: prev, time: hhmm(t) };
    }
  }
  return null;
}

/** The slots of a local day, with whether each window is still ahead, open or over at this instant. */
export function daySlots(day: string, at: Date, slots: Slots): { key: string; time: string; window: 'ahead' | 'open' | 'over' }[] {
  const local = localTime(at, slots.tz);
  return slots.times.map((t) => {
    const key = slotKey(day, t);
    const open = dueSlot(at, slots)?.key === key;
    const over = day < local.day || (day === local.day && local.minutes >= t + SLOT_WINDOW_MIN);
    return { key, time: hhmm(t), window: open ? 'open' : over ? 'over' : 'ahead' };
  });
}
