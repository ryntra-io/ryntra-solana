/**
 * The words of the exchange's hours (SOL-K1) — the state the issuer's
 * calendar states and when it changes, on the reader's clock — kept apart
 * from the component (`market-hours.tsx`) so they are tested as they read.
 */

import type { WorkspaceLocale } from "@/app/shell/locale";
import type { SessionPeriod } from "@/lib/stocks/session";

export type HoursSession = Readonly<{ period: SessionPeriod; exchangeOpen: boolean | null; nextChangeAt: string | null }>;

export type State = "open" | "extended" | "overnight" | "closed";
type Bi = Readonly<{ en: string; uk: string }>;

const STATE_WORDS: Readonly<Record<State, Bi>> = {
  open: { en: "Exchange open", uk: "Біржа відкрита" },
  extended: { en: "Extended hours", uk: "Подовжені торги" },
  overnight: { en: "Overnight trading", uk: "Нічні торги" },
  closed: { en: "Exchange closed", uk: "Біржа зачинена" },
};
const DRIFT: Bi = { en: "the token's price may differ from the last close", uk: "ціна токена може відрізнятися від ціни закриття" };

/** The state's own word — «Біржа відкрита», «Подовжені торги» — the same wherever the page names the session. */
export function hoursWord(state: State, locale: WorkspaceLocale): string {
  return STATE_WORDS[state][locale === "uk" ? "uk" : "en"];
}

export function hoursState(session: HoursSession): State | null {
  switch (session.period) {
    case "market":
      return "open";
    case "extended":
      return "extended";
    case "overnight":
      return "overnight";
    case "closed":
      return "closed";
    case "unknown":
      return session.exchangeOpen === true ? "open" : session.exchangeOpen === false ? "closed" : null;
  }
}

/** The tone of the dot: green open, blue extended or overnight — information, never a caution — grey closed. */
export function hoursTone(state: State): "open" | "extended" | "closed" {
  return state === "open" ? "open" : state === "closed" ? "closed" : "extended";
}

/** When the session changes on the reader's clock: its time, and its weekday when that is not today. */
export type ChangeMoment = Readonly<{ weekday: string | null; time: string }>;

/**
 * The moment the session changes — «23:00» today, «пн» and «15:30» another
 * day — or null for a time that has passed or is not a time.
 */
export function changeMoment(iso: string | null, nowMs: number, locale: WorkspaceLocale, timeZone?: string): ChangeMoment | null {
  const when = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(when) || when <= nowMs) return null;
  const numbers = locale === "uk" ? "uk-UA" : "en-US";
  const zone = timeZone ? { timeZone } : {};
  const time = new Intl.DateTimeFormat(numbers, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...zone }).format(new Date(when));
  const dayOf = (ms: number) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...zone }).format(new Date(ms));
  const weekday = dayOf(when) === dayOf(nowMs) ? null : new Intl.DateTimeFormat(numbers, { weekday: "short", ...zone }).format(new Date(when));
  return { weekday, time };
}

/**
 * What the time after the state means: the regular session closes; extended
 * and overnight trading last until; a closed exchange names its next session
 * — on Solana the token itself still trades.
 */
export function changePhrase(state: State, moment: ChangeMoment, locale: WorkspaceLocale): string {
  const uk = locale === "uk";
  const at = moment.weekday ? (uk ? `${moment.weekday} о ${moment.time}` : `${moment.weekday} at ${moment.time}`) : uk ? `о ${moment.time}` : `at ${moment.time}`;
  if (state === "open") return uk ? `закриється ${at}` : `closes ${at}`;
  if (state === "closed") return uk ? `наступна сесія ${at}` : `next session ${at}`;
  const until = moment.weekday ? `${moment.weekday} ${moment.time}` : moment.time;
  return uk ? `до ${until}` : `until ${until}`;
}

/** The line itself: the state, its change on the reader's clock, and the drift outside the regular session. */
export function hoursLine(session: HoursSession, locale: WorkspaceLocale, moment: ChangeMoment | null): string | null {
  const state = hoursState(session);
  if (!state) return null;
  const lang = locale === "uk" ? "uk" : "en";
  const parts = [STATE_WORDS[state][lang]];
  if (moment) parts[0] = `${parts[0]} · ${changePhrase(state, moment, locale)}`;
  if (state !== "open") parts.push(DRIFT[lang]);
  return parts.join(" · ");
}
