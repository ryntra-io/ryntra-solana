/**
 * The exchange session and the state of a reference price.
 *
 * Five reference states, and the session never promotes one into another: a
 * closed session does not turn the last value of a feed into an official
 * close, and an open session does not make a stale fetch current. The
 * calendar comes from data — the issuer's own trading period and the feed's
 * market-hours record — never from a "Monday to Friday" rule.
 */

/** The issuer's own trading period for a representation. */
export type SessionPeriod = "market" | "extended" | "overnight" | "closed" | "unknown";

export type Session = Readonly<{
  period: SessionPeriod;
  /** Whether the reference exchange is open right now, when the source says. */
  exchangeOpen: boolean | null;
  /** ISO time the period next changes, when the source says. */
  nextChangeAt: string | null;
  exchange: Readonly<{ mic: string; name: string; timezone: string }> | null;
  /** Where the session facts came from. */
  source: "issuer" | "feed-catalogue" | "none";
}>;

export const UNKNOWN_SESSION: Session = { period: "unknown", exchangeOpen: null, nextChangeAt: null, exchange: null, source: "none" };

export type ReferenceState = "current" | "last-available" | "confirmed-close" | "stale" | "unavailable";

export type Reference = Readonly<{
  state: ReferenceState;
  /** Per underlying share, in `currency`. Null when unavailable. */
  perShare: number | null;
  currency: string;
  /** Who stated the figure — the issuer's reference feed, a market feed, or nobody. */
  source: Readonly<{ id: "issuer-xstocks" | "pyth" | "none"; label: string }>;
  /** When the source observed the figure, when it said; otherwise null. */
  observedAt: string | null;
  /** When Ryntra fetched it. */
  fetchedAt: string | null;
  /** One sentence for a person, when the state needs one. */
  note: string | null;
}>;

export const REFERENCE_UNAVAILABLE: Reference = {
  state: "unavailable",
  perShare: null,
  currency: "USD",
  source: { id: "none", label: "" },
  observedAt: null,
  fetchedAt: null,
  note: null,
};

/** A fetch older than this is stale whatever the session says. */
export const REFERENCE_STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * The state of a reference figure fetched at `fetchedAt`, judged at `nowMs`.
 *
 * - no figure → `unavailable`;
 * - fetched too long ago → `stale`, even if the exchange is open;
 * - exchange open → `current`;
 * - exchange closed or unknown → `last-available` — never `confirmed-close`,
 *   which only a source that states an official close may produce.
 */
export function referenceState(input: Readonly<{ perShare: number | null; fetchedAt: string | null; exchangeOpen: boolean | null; nowMs: number; staleAfterMs?: number }>): ReferenceState {
  if (input.perShare === null || !Number.isFinite(input.perShare) || input.perShare <= 0) return "unavailable";
  const fetched = input.fetchedAt === null ? Number.NaN : Date.parse(input.fetchedAt);
  if (!Number.isFinite(fetched) || input.nowMs - fetched > (input.staleAfterMs ?? REFERENCE_STALE_AFTER_MS)) return "stale";
  return input.exchangeOpen === true ? "current" : "last-available";
}

/**
 * The time a reference's freshness is judged from: the source's own
 * observation time where it states one (a feed's publish time), else the
 * fetch. A figure fetched a second ago that the feed published an hour ago
 * is an hour old — freshness is about the observation, never about the JSON.
 */
export function referenceJudgedAt(reference: Pick<Reference, "observedAt" | "fetchedAt">): string | null {
  return reference.observedAt ?? reference.fetchedAt;
}

/** The state of a reference judged now, from its own observation time. */
export function referenceStateOf(reference: Pick<Reference, "perShare" | "observedAt" | "fetchedAt">, exchangeOpen: boolean | null, nowMs: number): ReferenceState {
  return referenceState({ perShare: reference.perShare, fetchedAt: referenceJudgedAt(reference), exchangeOpen, nowMs });
}

/** The issuer's period words, as its API spells them, into a session. */
export function sessionFromIssuer(trading: Readonly<{ currentPeriod: string | null; openNow: boolean | null; nextChangeAt: string | null; exchange: Readonly<{ mic: string; name: string; timezone: string }> | null }> | null): Session {
  if (!trading) return UNKNOWN_SESSION;
  const period: SessionPeriod =
    trading.currentPeriod === "market" || trading.currentPeriod === "extended" || trading.currentPeriod === "overnight" || trading.currentPeriod === "closed"
      ? trading.currentPeriod
      : "unknown";
  return {
    period,
    exchangeOpen: trading.openNow,
    nextChangeAt: trading.nextChangeAt,
    exchange: trading.exchange,
    source: "issuer",
  };
}

/**
 * The words a person reads for a state. The English is the catalogue key
 * where a translated surface uses it; the Ukrainian is carried beside it so a
 * server page can print either without reaching a translator that throws.
 */
export const REFERENCE_STATE_WORDS: Readonly<Record<ReferenceState, Readonly<{ en: string; uk: string }>>> = {
  current: { en: "Current", uk: "Поточний" },
  "last-available": { en: "Last available", uk: "Останній доступний" },
  "confirmed-close": { en: "Confirmed close", uk: "Підтверджене закриття" },
  stale: { en: "Stale", uk: "Застарілий" },
  unavailable: { en: "Unavailable", uk: "Недоступно" },
};

export const SESSION_WORDS: Readonly<Record<SessionPeriod, Readonly<{ en: string; uk: string }>>> = {
  market: { en: "Market open", uk: "Сесія відкрита" },
  extended: { en: "Extended hours", uk: "Подовжені години" },
  overnight: { en: "Overnight", uk: "Нічна сесія" },
  closed: { en: "Closed", uk: "Закрито" },
  unknown: { en: "Session unknown", uk: "Сесія невідома" },
};
