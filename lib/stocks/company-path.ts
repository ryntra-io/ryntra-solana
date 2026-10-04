/**
 * «Шлях компанії» — where a company stands on its way from a private token to
 * its stock on Solana, and which step this token is.
 *
 * Four steps, always in this order: **private** (the company's token through
 * PreStocks) → **ipo** (the day its shares first traded, at the price they
 * were offered) → **exchange** (the exchange and the ticker) → **solana** (the
 * listed share's token on Solana). A company that went public has every step
 * passed and stands at the last; its private token and its listed token are
 * the same company at two steps, each pointing at the other, with the private
 * token's swap deadline beside them. A PreStocks company that has announced
 * nothing stands at the first step; the rest are not announced, and the
 * issuer's rule says what an IPO would bring — up to nine months to swap.
 *
 * The facts are the registry's only (`lifecycle-events.ts`): the IPO, the
 * exchange and the listed token from the company's filings, the swap window
 * from the issuer's notice, the private step's date from the token's first
 * pool. No judgement, no target, no forecast. Pure: no fetch, no React; the
 * clock is handed in, so a deadline the clock has passed reads as closed.
 */

import type { StockIssuerId } from "./representations.ts";
import { eventStateAt, type LifecycleEvent } from "./instrument.ts";
import { COMPANY_PATHS, LIFECYCLE_EVENTS_VERSION, PRESTOCKS_SWAP_RULE, PRIVATE_SINCE, companyPathRecordFor, lifecycleEventFor, privateSinceSource, type CompanyPathRecord, type PathSource } from "./lifecycle-events.ts";

export const COMPANY_PATH_STEPS = ["private", "ipo", "exchange", "solana"] as const;
export type CompanyPathStepId = (typeof COMPANY_PATH_STEPS)[number];

/** A step the company has left behind, the one it stands at now, or one nobody has announced. */
export const COMPANY_PATH_STEP_STATES = ["passed", "current", "unannounced"] as const;
export type CompanyPathStepState = (typeof COMPANY_PATH_STEP_STATES)[number];

type Token = Readonly<{ mint: string; symbol: string }>;

export type CompanyPathStep = Readonly<{
  step: CompanyPathStepId;
  state: CompanyPathStepState;
  /** The step's day, ISO `YYYY-MM-DD`: the private token's first pool, the first trading day, the listing, the listed token on Solana; null where none is recorded. */
  date: string | null;
  /** The IPO's offering price per share, USD; the `ipo` step only. */
  priceUsd: number | null;
  /** The exchange and the ticker; the `exchange` step only. */
  exchange: string | null;
  ticker: string | null;
  /** The token at this step — the private token, or the listed share's token on Solana; null on the steps between. */
  token: Token | null;
}>;

export type CompanyPath = Readonly<{
  /** The step this token stands at. */
  at: "private" | "solana";
  steps: readonly CompanyPathStep[];
  /** The private token's swap window, when the company has gone public and the issuer states a cut-off; null otherwise. */
  swap: Readonly<{ from: Token; into: Token | null; deadline: string; open: boolean }> | null;
  /** The issuer's rule for a company still at the private step: after an IPO, up to this many months to swap; null once the company has gone public. */
  swapMonths: number | null;
  /** Where each step was read, dated. */
  sources: readonly PathSource[];
  /** The registry's version the path was read from. */
  version: string;
}>;

export type CompanyPathInput = Readonly<{
  mint: string;
  symbol: string;
  issuerId: StockIssuerId;
  instrumentClass: "listed-equity" | "pre-ipo";
}>;

export type CompanyPathRegistry = Readonly<{
  paths: readonly CompanyPathRecord[];
  eventFor: (mint: string) => LifecycleEvent | null;
  privateSince: Readonly<Record<string, string>>;
}>;

const REGISTRY: CompanyPathRegistry = { paths: COMPANY_PATHS, eventFor: (mint) => lifecycleEventFor(mint), privateSince: PRIVATE_SINCE };

function step(id: CompanyPathStepId, state: CompanyPathStepState, fields: Partial<Omit<CompanyPathStep, "step" | "state">> = {}): CompanyPathStep {
  return { step: id, state, date: fields.date ?? null, priceUsd: fields.priceUsd ?? null, exchange: fields.exchange ?? null, ticker: fields.ticker ?? null, token: fields.token ?? null };
}

/**
 * The path of the company behind a token, or null where the strip has
 * nothing to say: a listed token whose company never had a private token
 * here, or a private token whose company was bought rather than listed.
 */
export function companyPathFor(input: CompanyPathInput, nowMs: number, registry: CompanyPathRegistry = REGISTRY): CompanyPath | null {
  const record = companyPathRecordFor(input.mint, registry.paths);
  if (record) return listedPath(record, input.mint === record.privateMint ? "private" : "solana", nowMs, registry);
  if (input.issuerId !== "prestocks" || input.instrumentClass !== "pre-ipo") return null;
  /* A private token with an event of its own that is not an IPO on record (an acquisition, a window closed) has no path to draw. */
  if (registry.eventFor(input.mint)) return null;
  const since = registry.privateSince[input.mint] ?? null;
  return {
    at: "private",
    steps: [step("private", "current", { date: since, token: { mint: input.mint, symbol: input.symbol } }), step("ipo", "unannounced"), step("exchange", "unannounced"), step("solana", "unannounced")],
    swap: null,
    swapMonths: PRESTOCKS_SWAP_RULE.months,
    sources: since ? [PRESTOCKS_SWAP_RULE.source, privateSinceSource(input.mint)] : [PRESTOCKS_SWAP_RULE.source],
    version: LIFECYCLE_EVENTS_VERSION,
  };
}

function listedPath(record: CompanyPathRecord, at: "private" | "solana", nowMs: number, registry: CompanyPathRegistry): CompanyPath {
  const event = registry.eventFor(record.privateMint);
  const privateSymbol = event?.watch?.symbol ?? null;
  const privateToken = privateSymbol ? { mint: record.privateMint, symbol: privateSymbol } : null;
  const listed = { mint: record.solana.mint, symbol: record.solana.symbol };
  const since = registry.privateSince[record.privateMint] ?? null;
  const into = event?.watch?.into ? { mint: event.watch.into.mint, symbol: event.watch.into.symbol } : null;
  return {
    at,
    steps: [
      step("private", "passed", { date: since, token: privateToken }),
      step("ipo", "passed", { date: record.ipo.date, priceUsd: record.ipo.priceUsd }),
      step("exchange", "passed", { date: record.exchange.since, exchange: record.exchange.name, ticker: record.exchange.ticker }),
      step("solana", "current", { date: record.solana.since, token: listed }),
    ],
    swap:
      event && privateToken && event.deadline && (event.state === "conversion-open" || event.state === "expired")
        ? { from: privateToken, into, deadline: event.deadline, open: eventStateAt(event, nowMs) === "conversion-open" }
        : null,
    swapMonths: null,
    sources: since ? [...record.sources, privateSinceSource(record.privateMint)] : record.sources,
    version: LIFECYCLE_EVENTS_VERSION,
  };
}
