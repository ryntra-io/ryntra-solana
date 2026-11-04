/**
 * The garage agent's budget for words (CITY-29). Its advice comes from Ryntra's assistant (CITY-10), whose guest seam
 * spends at most one model answer per question and counts the day's answers (`guest.day`). The agent counts the same
 * unit and always the worst case: before a question leaves, one whole answer is taken from the agent's day; a question
 * that failed or was cut off is not given back — the model may have been paid for it — and the count the seam
 * reports afterwards wins when it is higher. The agent never takes the last answer of the day the seam would give the
 * person for their own questions. When the budget is spent, the agent says so and asks nothing.
 *
 * The agent has no money: this is a count of model answers, never an amount of anyone's funds.
 */

/** Model answers the agent may spend on advice in one day. */
export const ADVICE_PER_DAY = 3;
/** The worst one question can cost, in model answers. */
export const WORST_PER_ASK = 1;
/** Answers of the seam's day the agent always leaves to the person. */
export const LEFT_FOR_PERSON = 1;

export type Ledger = Readonly<{
  /** The day the count is for, by the UTC calendar (the seam's day). */
  day: string;
  /** Answers the agent took today, worst case. */
  spent: number;
  /** The seam's own count, when a reply carried one. */
  seam: Readonly<{ used: number; allowance: number; resetsAt: number | null }> | null;
}>;

export const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

export const freshLedger = (now: number): Ledger => ({ day: dayOf(now), spent: 0, seam: null });

/** The ledger for today: yesterday's count is gone; the seam's count is kept only until its reset. */
export function today(ledger: Ledger | null, now: number): Ledger {
  if (!ledger || ledger.day !== dayOf(now)) return freshLedger(now);
  if (ledger.seam?.resetsAt !== null && ledger.seam?.resetsAt !== undefined && ledger.seam.resetsAt <= now) return { ...ledger, seam: null };
  return ledger;
}

/** What is left to the agent today, in answers: its own share, and never past what the seam leaves the person. */
export function left(ledger: Ledger | null, now: number): number {
  const l = today(ledger, now);
  const own = ADVICE_PER_DAY - l.spent;
  const seam = l.seam ? l.seam.allowance - l.seam.used - LEFT_FOR_PERSON : Infinity;
  return Math.max(0, Math.min(own, seam));
}

export type Reserved = Readonly<{ ok: true; ledger: Ledger }> | Readonly<{ ok: false; ledger: Ledger }>;

/** Takes the worst case of one question before it leaves, or refuses when it does not fit. */
export function reserve(ledger: Ledger | null, now: number): Reserved {
  const l = today(ledger, now);
  if (left(l, now) < WORST_PER_ASK) return { ok: false, ledger: l };
  return { ok: true, ledger: { ...l, spent: l.spent + WORST_PER_ASK } };
}

/** The seam's count after a reply: kept as it said it; the agent's own count never goes down. */
export function settle(ledger: Ledger | null, now: number, seam: Readonly<{ used: number; allowance: number; resetsAt?: string | null }> | null): Ledger {
  const l = today(ledger, now);
  if (!seam || !Number.isFinite(seam.used) || !Number.isFinite(seam.allowance)) return l;
  const resetsAt = seam.resetsAt ? Date.parse(seam.resetsAt) : NaN;
  return { ...l, seam: { used: Math.max(0, seam.used), allowance: Math.max(0, seam.allowance), resetsAt: Number.isFinite(resetsAt) ? resetsAt : null } };
}

/** A ledger read back from storage, or a fresh one. */
export function readLedger(raw: unknown, now: number): Ledger {
  const r = raw as Partial<Ledger> | null;
  if (!r || typeof r.day !== 'string' || typeof r.spent !== 'number' || !Number.isFinite(r.spent) || r.spent < 0) return freshLedger(now);
  const s = r.seam as Ledger['seam'] | undefined;
  const seam = s && Number.isFinite(s.used) && Number.isFinite(s.allowance) ? { used: s.used, allowance: s.allowance, resetsAt: typeof s.resetsAt === 'number' ? s.resetsAt : null } : null;
  return today({ day: r.day, spent: Math.min(r.spent, ADVICE_PER_DAY), seam }, now);
}
