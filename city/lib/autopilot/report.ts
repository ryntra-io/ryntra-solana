import { digits, pl, words } from '../i18n/dict.ts';
import { usdOf, type AgentDay } from '../../../lib/mandate/report.ts';
import { solText } from './plan.ts';

/**
 * The agent's day for the person: what it did while she was away — «3 trades, +0.012 SOL»
 * — from the agent's own trades in its book, priced now (`lib/mandate/report.ts`). In the city: one quiet line over the
 * agent's tower and one card on her return; in Telegram and the phone's push: one report a day at her hour, off in one
 * tap. Real trades only, never a promise: a figure that was not read is left out, never shown as zero.
 *
 * The switches: `NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT=open` shows it in the city; `RYNTRA_AGENT_REPORT=on` lets the
 * server tell it. Anything else keeps each shut. Pure, so the tests read it.
 */

export type Lang = 'en' | 'uk';

/** The city's switch: `open` shows the agent's day in the city. */
export function agentReportOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}
export const AGENT_REPORT_OPEN = agentReportOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_AGENT_REPORT);

/** The server's switch: `on` lets the cron tell the day to Telegram and the phone. */
export function agentReportSends(value: string | undefined): boolean {
  return value?.trim() === 'on';
}
export const AGENT_REPORT_SEND_ENV = 'RYNTRA_AGENT_REPORT';

/** Where the report's button opens: the city with the agent's card. */
export const AGENT_REPORT_HREF = '/?open=agent';

/** The trigger every report carries in the engine's inbox, so the delivery says it in its own words. */
export const AGENT_REPORT_TRIGGER = 'city-agent-report:';

export function isAgentReportNote(note: Readonly<{ triggerId: string }>): boolean {
  return typeof note.triggerId === 'string' && note.triggerId.startsWith(AGENT_REPORT_TRIGGER);
}

/** The Telegram button that turns the report off, and the one that turns it on again: `agr:off:<wallet>`. */
export const REPORT_CALLBACK = 'agr:';
export const reportCallback = (verb: 'off' | 'on', owner: string) => `${REPORT_CALLBACK}${verb}:${owner}`;
export function readReportCallback(data: string | undefined): Readonly<{ verb: 'off' | 'on'; owner: string }> | null {
  const match = /^agr:(off|on):([1-9A-HJ-NP-Za-km-z]{32,44})$/u.exec(data ?? '');
  return match ? { verb: match[1] as 'off' | 'on', owner: match[2]! } : null;
}

export const AGENT_REPORT = words(
  {
    away: 'While you were away',
    today: 'Today',
    trades: (n: number) => `${n} ${n === 1 ? 'trade' : 'trades'}`,
    /** «3 trades, +0.012 SOL». */
    summary: (trades: string, figure: string | null) => (figure ? `${trades}, ${figure}` : trades),
    spent: (amount: string) => `Spent ${amount} SOL`,
    bought: (symbol: string) => `bought ${symbol}`,
    worth: (amount: string) => `worth ${amount} SOL now`,
    /** CITY-197: every figure is after all fees; beside it, plain holding of the same SOL. */
    afterFees: 'after all fees',
    vsHold: (figure: string) => `holding: ${figure}`,
    total: (figure: string) => `since start ${figure}`,
    share: 'Share',
    later: 'Later',
    open: 'Open',
    daily: 'Daily report',
    dailyAt: (time: string) => `Daily report · ${time}`,
    dailyOff: 'Daily report off',
    // Telegram and push.
    noteTitle: (summary: string) => `Your agent today: ${summary}`,
    noteCta: 'Open my agent',
    noteOff: 'Turn off daily report',
    noteOn: 'Turn it back on',
    toldOff: 'Daily report off',
    toldOn: 'Daily report on',
    notYours: 'Connect this Telegram in Ryntra first',
    /** CITY-204: the money autopilot's week, and its hold. */
    pilotWeek: (figure: string) => `Autopilot this week ${figure}`,
    pilotHeld: 'trading paused: market fell',
  },
  {
    away: 'Поки тебе не було',
    today: 'Сьогодні',
    trades: (n) => `${n} ${pl(n, 'угода', 'угоди', 'угод')}`,
    summary: (trades, figure) => (figure ? `${trades}, ${figure}` : trades),
    spent: (amount) => `Витрачено ${amount} SOL`,
    bought: (symbol) => `куплено ${symbol}`,
    worth: (amount) => `зараз ${amount} SOL`,
    afterFees: 'після всіх комісій',
    vsHold: (figure) => `тримання: ${figure}`,
    total: (figure) => `від старту ${figure}`,
    share: 'Поділитись',
    later: 'Пізніше',
    open: 'Відкрити',
    daily: 'Щоденний звіт',
    dailyAt: (time) => `Щоденний звіт · ${time}`,
    dailyOff: 'Щоденний звіт вимкнено',
    noteTitle: (summary) => `Твій агент сьогодні: ${summary}`,
    noteCta: 'Відкрити агента',
    noteOff: 'Вимкнути щоденний звіт',
    noteOn: 'Увімкнути знову',
    toldOff: 'Щоденний звіт вимкнено',
    toldOn: 'Щоденний звіт увімкнено',
    notYours: 'Спершу підключи цей Telegram у Ryntra',
    pilotWeek: (figure) => `Автопілот за тиждень ${figure}`,
    pilotHeld: 'торгівля на паузі: ринок упав',
  },
);

/**
 * Lamports as SOL, signed: «+0.012 SOL», «−0,003 SOL». Counted in whole lamports, never in floats, and never flattering
 * (CITY-197): a gain is rounded down, a loss up.
 */
export function solFigure(raw: string, lang: Lang): string {
  const value = BigInt(raw);
  const sign = value > 0n ? '+' : value < 0n ? '−' : '';
  const abs = value < 0n ? -value : value;
  const places = abs >= 10_000_000_000n ? 2 : abs >= 1_000_000_000n ? 3 : 4;
  const step = 10n ** BigInt(9 - places);
  const units = value < 0n ? (abs + step - 1n) / step : abs / step;
  const whole = units / 10n ** BigInt(places);
  const fraction = (units % 10n ** BigInt(places)).toString().padStart(places, '0').replace(/0+$/u, '');
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  return `${units === 0n ? '' : sign}${lang === 'uk' ? text.replace('.', ',') : text} SOL`;
}

/** Dollars, signed, to the cent: «+$1.80», «−$0,40». */
export function usdFigure(usd: number, lang: Lang): string {
  const sign = usd > 0 ? '+' : usd < 0 ? '−' : '';
  return digits(`${sign}$${Math.abs(usd).toFixed(2)}`, lang);
}

/**
 * What the span did for her, lamports: after every fee when the book counted them (CITY-197), else what the trades did
 * at the price now; null — not read. A span without its fees counted is never shown as after them.
 */
export const resultRaw = (day: Pick<AgentDay, 'earnedRaw' | 'netRaw'>): string | null => (day.netRaw !== undefined ? day.netRaw : day.earnedRaw);

/** The result of the span: in SOL, with dollars when the price was read; null when the worth was not. */
export function resultFigure(day: AgentDay, lang: Lang, solUsd: number | null, withUsd = true): string | null {
  const raw = resultRaw(day);
  if (raw === null) return null;
  const sol = solFigure(raw, lang);
  const usd = withUsd ? usdOf(raw, solUsd) : null;
  return usd === null ? sol : `${sol} (${usdFigure(usd, lang)})`;
}

/** What a share card prices the span at: what it spent plus its result after every fee — the card's «x» is honest too. */
export function shareWorth(day: Pick<AgentDay, 'spentRaw' | 'worthRaw' | 'earnedRaw' | 'netRaw'>): string | null {
  if (day.netRaw === undefined) return day.worthRaw;
  return day.netRaw === null ? null : (BigInt(day.spentRaw) + BigInt(day.netRaw)).toString();
}

/** The tone of a signed figure: up, down or none. */
export const toneOf = (raw: string | null | undefined): 'up' | 'down' | undefined => (raw === null || raw === undefined ? undefined : BigInt(raw) > 0n ? 'up' : BigInt(raw) < 0n ? 'down' : undefined);

/** «holding: +0.002 SOL» — plain holding of the same SOL beside the agent's result; null when it cannot be priced. */
export function holdFigure(raw: string | null | undefined, lang: Lang): string | null {
  return raw === null || raw === undefined ? null : AGENT_REPORT[lang].vsHold(solFigure(raw, lang));
}

/** «3 trades, +0.012 SOL» — what the line over the tower, the return card and the report's title say. */
export function daySummary(day: AgentDay, lang: Lang, solUsd: number | null = null, withUsd = false): string {
  const w = AGENT_REPORT[lang];
  return w.summary(w.trades(day.trades), resultFigure(day, lang, solUsd, withUsd));
}

/**
 * «Spent 0.3 SOL · bought BONK · after all fees · holding: +0.004 SOL · since start −0.001 SOL» — the quiet line under
 * it. CITY-197: once the fees are counted, the line says so and puts plain holding beside the result, and the whole
 * mandate's result after them when given; before, the worth now. A figure not read is left out.
 */
export function dayDetail(day: AgentDay, lang: Lang, symbol: string | null, total: Readonly<{ netRaw: string | null }> | null = null): string {
  const w = AGENT_REPORT[lang];
  const parts = [w.spent(solText(Number(BigInt(day.spentRaw)) / 1e9, lang))];
  if (symbol) parts.push(w.bought(symbol));
  if (day.netRaw !== undefined) {
    if (day.netRaw !== null) parts.push(w.afterFees);
    const hold = holdFigure(day.holdRaw, lang);
    if (hold) parts.push(hold);
    if (total && total.netRaw !== null) parts.push(w.total(solFigure(total.netRaw, lang)));
  } else if (day.worthRaw !== null) parts.push(w.worth(solText(Number(BigInt(day.worthRaw)) / 1e9, lang)));
  return parts.join(' · ');
}

/** Whether a span is worth telling: the agent traded in it. */
export const worthTelling = (day: AgentDay | null | undefined): day is AgentDay => Boolean(day && day.trades > 0);

/* ------------------------------------------------------------------------------------------------ the person's hour */

/** The hour a new report goes out, the person's own clock. */
export const REPORT_HOUR = 20;

export type ReportSettings = Readonly<{
  version: number;
  owner: string;
  on: boolean;
  /** The hour of her day it goes out, 0–23. */
  hour: number;
  /** Her clock (IANA), as her browser said it. */
  timezone: string;
  locale: Lang;
  /** Her day it was last told, `YYYY-MM-DD` on her clock; null before the first. */
  toldDay: string | null;
  /** When it was last told, ms; the next report counts from it. */
  toldAt: number | null;
  updatedAt: string;
}>;

/** A clock the city can keep: an IANA name `Intl` reads; anything else is UTC. */
export function clockOf(timezone: unknown): string {
  if (typeof timezone !== 'string' || timezone.length === 0 || timezone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/u.test(timezone)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

/** Her day and hour on her clock at a moment. */
export function localClock(nowMs: number, timezone: string): Readonly<{ day: string; hour: number }> {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: clockOf(timezone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

/** Whether her report is due: on, her hour has come today on her clock, and today was not told yet. */
export function reportDue(settings: ReportSettings, nowMs: number): boolean {
  if (!settings.on) return false;
  const clock = localClock(nowMs, settings.timezone);
  return clock.hour >= settings.hour && settings.toldDay !== clock.day;
}

/** «20:00». */
export const hourText = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** The report's buttons in Telegram: the link to the agent, and «Turn off daily report» in one tap. */
export function reportKeyboard(
  note: Readonly<{ owner: string; locale: Lang }>,
  link: Readonly<{ text: string; url: string }>,
): readonly (readonly Readonly<{ text: string; url?: string; callback_data?: string }>[])[] {
  return [[link], [{ text: AGENT_REPORT[note.locale === 'uk' ? 'uk' : 'en'].noteOff, callback_data: reportCallback('off', note.owner) }]];
}

/** The coin the agent buys, as a card writes it: its ticker when the book named it, else its short address. */
export function agentSymbol(view: Readonly<{ symbol?: string | null; receiveMint: string }>): string {
  const named = view.symbol;
  return typeof named === 'string' && /^[A-Za-z0-9]{1,10}$/u.test(named) ? named : view.receiveMint.slice(0, 4);
}
