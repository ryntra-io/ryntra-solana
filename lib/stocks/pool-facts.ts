/**
 * The facts a pool page shows when one side of the pool is a stock: is it a stock, whose, is the exchange
 * open (and when that changes), whether new liquidity waits around a dividend or a split, and where the issuer's terms
 * are.
 * One pure read for the pool page, the Grid and the stock limits; the server's reader is
 * `pool-facts.server.ts`, the one public door `GET /api/v1/stocks/pool-facts`.
 *
 * Every fact comes from the stocks engine as it is: the session from the issuer's own trading period, or the feed
 * catalogue's market-hours record when the issuer says none (`session.ts`, `universe.server.ts`) — never from a
 * «Monday to Friday» rule; the guard from the chain's own scheduled step of the token's multiplier, judged by the Stock
 * Pier's rule (`city/lib/earn/stock-pier-hours.ts`); the terms from the issuer's document (`issuer-terms.ts`).
 * Ryntra blocks no country: the terms are shown, never enforced here.
 *
 * Pure and client-safe.
 */

import { dividendGuard, GUARD_BEFORE_MS, type StepKind, type StockStep } from "../../city/lib/earn/stock-pier-hours.ts";
import { ISSUER_TERMS } from "./issuer-terms.ts";
import { listedCompanyFor, type ListedCompany } from "./company-listings.ts";
import type { StockIssuerId } from "./representations.ts";
import type { Session } from "./session.ts";
import { ACTIVATION_WINDOW_MS } from "./units.ts";

/**
 * The exchange as a pool page reads it. `open` — the regular session; `pre` and `post` — the issuer's extended hours
 * before and after it; `closed` — no regular session (nights, weekends, holidays, the issuer's overnight period);
 * `unknown` — no source said, and nothing is guessed.
 */
export type PoolSession = "open" | "pre" | "post" | "closed" | "unknown";

export type PoolGuard = Readonly<{
  /** When new liquidity starts to wait, ISO. */
  from: string;
  /** When it may go in again, ISO. */
  to: string;
  /** What the step is: a reinvested dividend, a split, or a change of units that is neither. */
  step: StepKind;
  /** Whether the window is on now (`true`) or still ahead (`false`). */
  now: boolean;
}>;

export type PoolFacts = Readonly<{
  mint: string;
  isStock: boolean;
  issuer: Readonly<{ id: StockIssuerId; label: string }> | null;
  session: PoolSession;
  /** When the session next changes, ISO, when the source says and it is still ahead. */
  nextChangeAt: string | null;
  /** The window around a scheduled step of the multiplier, when one is in sight; null otherwise. */
  dividendGuard: PoolGuard | null;
  /** The issuer's own document on where its tokens are offered. */
  termsUrl: string | null;
  /** A listed company's share, or a private company's token before its IPO; null — no stock. */
  kind?: "listed-equity" | "pre-ipo" | null;
  /** What the issuer can do to every holder's token, as the mint's own extensions state it; null — nothing, or not read. */
  powers?: IssuerPowers | null;
  /** A private token whose company has gone public — the company, its ticker and its share's token on Solana. */
  listed?: ListedCompany | null;
}>;

/**
 * What the mint lets its issuer do to a holder's token (Token-2022's own extensions, read from the chain): `take` — a
 * permanent delegate that can move or burn any holder's balance; `pause` — a pause of every transfer; `paused` — whether
 * that pause is on now (null: the mint has no pause).
 */
export type IssuerPowers = Readonly<{ take: boolean; pause: boolean; paused: boolean | null }>;

/** The mint's facts the powers are read from — `OnchainMint` of the stocks engine satisfies it as it is. */
export type MintRights = Readonly<{ permanentDelegate: string | null; pausable: Readonly<{ paused: boolean }> | null }>;

/** The powers a mint gives its issuer; null when it gives none, or the mint was not read. */
export function issuerPowersOf(mint: MintRights | null | undefined): IssuerPowers | null {
  if (!mint) return null;
  const take = typeof mint.permanentDelegate === "string" && mint.permanentDelegate.length > 0;
  const pause = mint.pausable !== null && mint.pausable !== undefined;
  if (!take && !pause) return null;
  return { take, pause, paused: pause ? mint.pausable!.paused === true : null };
}

/**
 * The powers in one line a person reads — «Емітент може зупинити й забрати токен» — without the chain's words; a pause
 * that is on now is said as the state it is. Null when the mint gives its issuer neither.
 */
export function issuerPowersLine(powers: IssuerPowers | null | undefined, lang: "en" | "uk"): string | null {
  if (!powers || (!powers.take && !powers.pause)) return null;
  const uk = lang === "uk";
  if (powers.paused === true) return uk ? (powers.take ? "Перекази зупинено емітентом · емітент може забрати токен" : "Перекази зупинено емітентом") : powers.take ? "Transfers paused by the issuer · the issuer can take the token" : "Transfers paused by the issuer";
  if (powers.take && powers.pause) return uk ? "Емітент може зупинити й забрати токен" : "The issuer can pause and take the token";
  if (powers.take) return uk ? "Емітент може забрати токен" : "The issuer can take the token";
  return uk ? "Емітент може зупинити перекази" : "The issuer can pause transfers";
}

/** The stock row's parts the facts read — a `StockRow` of the universe satisfies it as it is. */
export type PoolFactsRow = Readonly<{
  representation: Readonly<{
    mint: string;
    issuer: Readonly<{ id: StockIssuerId; label: string }>;
    exchange: Readonly<{ timezone: string }> | null;
    instrument?: Readonly<{ class: "listed-equity" | "pre-ipo" }>;
  }>;
  session: Session;
}>;

/** A mint the stocks engine does not know as a stock. */
export function notAStock(mint: string): PoolFacts {
  return { mint, isStock: false, issuer: null, session: "unknown", nextChangeAt: null, dividendGuard: null, termsUrl: null, kind: null, powers: null, listed: null };
}

/** The hour of the day at the exchange (0–23), in its own time zone; null when the zone is unknown. */
export function exchangeHour(nowMs: number, timezone: string | null): number | null {
  if (!timezone) return null;
  try {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(nowMs));
    return Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null;
  } catch {
    return null;
  }
}

/**
 * The session's period as a pool page reads it. Extended hours before noon at the exchange are the morning's
 * pre-market, after noon the evening's after-hours; with no time zone to tell them apart they read as `closed` — the
 * regular session is not on either way.
 */
export function poolSessionOf(session: Session, nowMs: number, timezone: string | null = null): PoolSession {
  switch (session.period) {
    case "market":
      return "open";
    case "extended": {
      const hour = exchangeHour(nowMs, session.exchange?.timezone ?? timezone);
      return hour === null ? "closed" : hour < 12 ? "pre" : "post";
    }
    case "overnight":
    case "closed":
      return "closed";
    default:
      return session.exchangeOpen === true ? "open" : session.exchangeOpen === false ? "closed" : "unknown";
  }
}

/** The guard's window as dates, from the Stock Pier's own rule. */
export function poolGuardOf(step: StockStep | null, nowMs: number): PoolGuard | null {
  const guard = dividendGuard(step, nowMs);
  if (guard.kind === "none") return null;
  const from = guard.at - (guard.step === "split" ? ACTIVATION_WINDOW_MS : GUARD_BEFORE_MS);
  const to = guard.at + ACTIVATION_WINDOW_MS;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), step: guard.step, now: guard.kind === "hold" };
}

/**
 * The facts of one mint: its stock row (null when the engine knows no such stock), the multiplier's scheduled step, and
 * the mint's own rights as the chain states them (null — not read).
 */
export function poolFactsOf(input: Readonly<{ mint: string; row: PoolFactsRow | null; step: StockStep | null; nowMs: number; rights?: MintRights | null }>): PoolFacts {
  const { mint, row, nowMs } = input;
  if (!row || row.representation.mint !== mint) return notAStock(mint);
  const next = row.session.nextChangeAt === null ? Number.NaN : Date.parse(row.session.nextChangeAt);
  const session = poolSessionOf(row.session, nowMs, row.representation.exchange?.timezone ?? null);
  const issuer = row.representation.issuer;
  return {
    mint,
    isStock: true,
    issuer: { id: issuer.id, label: issuer.label },
    session,
    nextChangeAt: session !== "unknown" && Number.isFinite(next) && next > nowMs ? new Date(next).toISOString() : null,
    dividendGuard: poolGuardOf(input.step, nowMs),
    termsUrl: ISSUER_TERMS[issuer.id]?.document.url ?? null,
    kind: row.representation.instrument?.class ?? "listed-equity",
    powers: issuerPowersOf(input.rights),
    listed: row.representation.instrument?.class === "pre-ipo" ? listedCompanyFor({ mint }) : null,
  };
}

/* ------------------------------------------------------------------ the risk line */

/** The line before a signature on a stock outside the regular session: the price stands, the open may jump. */
export const OFF_HOURS_RISK: Readonly<{ en: string; uk: string }> = {
  en: "Outside exchange hours the price stands still; at the open it may jump.",
  uk: "Поза годинами біржі ціна стоїть, на відкритті може стрибнути.",
};

/**
 * The risk line for the Grid and the limits on a stock: the words when the pool holds a stock and the
 * regular session is not on (closed, before or after it, or not stated); null when it is no stock or the exchange is
 * open.
 */
export function offHoursRiskLine(facts: PoolFacts | null | undefined, lang: "en" | "uk"): string | null {
  if (!facts?.isStock || facts.session === "open") return null;
  return OFF_HOURS_RISK[lang];
}
