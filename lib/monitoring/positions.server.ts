/**
 * Reads what Нагляд over the wallet's positions stands on and composes it
 * (`positions.ts`; `RYN-PROTECT-SIGNAL-001`, subtask 1): what the chain says
 * the wallet holds, the universe's rows, the plans it bought under, the
 * positions «Ryntra попередить» watches, and whether a channel is connected.
 *
 * The chain is read here, not taken from a client: a phone and the web read
 * the same positions. Two short reads — the classic token program and
 * Token-2022 — each three seconds without a retry: Нагляд reads again next
 * time, and a page never waits on a slow host. A read that fails says so and
 * claims nothing: a position that could not be read is not «вихід не
 * налаштований», and a watch is closed only on a complete read that finds
 * none of its token.
 */

import type { GuardStore } from "../guard/store.ts";
import { reconcilePlanExecutions } from "../plans/service.ts";
import { currentVersionOf, listAllTradingPlans, projectedStatus, type TradingPlanRecord } from "../plans/store.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { createSolanaRpcHandle, withRpcDiscipline } from "../solana/rpc.ts";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../solana/send-kinds.ts";
import { isWatched, windowState } from "../stocks/conversion-watch.ts";
import { lifecycleEventFor } from "../stocks/lifecycle-events.ts";
import { isRetiredMint } from "../stocks/retired.ts";
import { companyDisplayName } from "../stocks/shelf.ts";
import type { StockRow, UniverseRead } from "../stocks/universe.server.ts";
import { competingOf, planIsWatched } from "./position.ts";
import { closePositionWatch, listPositionWatches, type PositionWatchRecord } from "./position-watch.ts";
import { composePositions, type PlanExit, type PositionRowFacts, type PositionView } from "./positions.ts";

/** What the chain says the wallet holds: raw units per mint, the mints any of whose accounts the issuer froze, and whether both programs answered; `decimals` per mint where the accounts carried it (the portfolio's risk values every token). */
export type HeldRead = Readonly<{ held: ReadonlyMap<string, bigint>; frozen: ReadonlySet<string>; complete: boolean; decimals?: ReadonlyMap<string, number> }>;
/** Null when neither program answered. Injected, so tests run without the chain. */
export type WalletHoldingsReader = (owner: string) => Promise<HeldRead | null>;

const RAW = /^\d+$/;

/** One program's `jsonParsed` token accounts, added up per mint; null for an answer of any other shape. */
export function heldFromAccounts(value: unknown): Readonly<{ held: Map<string, bigint>; frozen: Set<string>; decimals: Map<string, number> }> | null {
  if (!Array.isArray(value)) return null;
  const held = new Map<string, bigint>();
  const frozen = new Set<string>();
  const decimals = new Map<string, number>();
  for (const entry of value) {
    const info = (entry as { account?: { data?: { parsed?: { info?: { mint?: unknown; state?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } } } })?.account?.data?.parsed?.info;
    const mint = info?.mint;
    const amount = info?.tokenAmount?.amount;
    if (typeof mint !== "string" || typeof amount !== "string" || !RAW.test(amount)) return null;
    held.set(mint, (held.get(mint) ?? 0n) + BigInt(amount));
    if (info?.state === "frozen" && BigInt(amount) > 0n) frozen.add(mint);
    const scale = info?.tokenAmount?.decimals;
    if (typeof scale === "number" && Number.isInteger(scale) && scale >= 0 && scale <= 255) decimals.set(mint, scale);
  }
  return { held, frozen, decimals };
}

/** The production reader: mainnet, `confirmed`, both token programs at once. */
export const readWalletHoldingsOnChain: WalletHoldingsReader = async (owner) => {
  const reads = await Promise.allSettled(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(async (programId) => {
      const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 3_000, retries: 0 });
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getTokenAccountsByOwner(owner as never, { programId: programId as never }, { encoding: "jsonParsed", commitment: "confirmed" }).send({ abortSignal }),
      );
      return heldFromAccounts((response as { value?: unknown }).value);
    }),
  );
  const answered = reads.flatMap((read) => (read.status === "fulfilled" && read.value ? [read.value] : []));
  if (answered.length === 0) return null;
  const held = new Map<string, bigint>();
  const frozen = new Set<string>();
  const decimals = new Map<string, number>();
  for (const part of answered) {
    for (const [mint, raw] of part.held) held.set(mint, (held.get(mint) ?? 0n) + raw);
    for (const mint of part.frozen) frozen.add(mint);
    for (const [mint, scale] of part.decimals) decimals.set(mint, scale);
  }
  return { held, frozen, complete: answered.length === reads.length, decimals };
};

/** The universe's row as Нагляд reads it. */
export function rowFactsOf(row: StockRow): PositionRowFacts {
  const rep = row.representation;
  const privateCompany = rep.instrument?.class === "pre-ipo";
  return {
    mint: rep.mint,
    symbol: rep.symbol,
    name: companyDisplayName(rep.underlying.name ?? rep.name, privateCompany ? null : rep.underlying.symbol),
    privateCompany,
    company: rep.underlying.symbol ?? null,
    icon: row.market.icon,
    unitBasis: rep.instrument?.unitBasis === "token" ? "token" : "share",
    decimals: rep.decimals,
    multiplier: row.multiplier && row.multiplier.current > 0 ? row.multiplier.current : 1,
    price: row.market.priceUsd,
    observedAt: row.market.observedAt,
    deviationPct: row.reference.state === "current" && row.deviationPct !== null && Number.isFinite(row.deviationPct) ? row.deviationPct : null,
    exchangeClosed: row.session.period === "closed",
    closedUntil: row.session.period === "closed" ? (row.session.nextChangeAt ?? null) : null,
    halted: rep.tradingHalted === true || row.lifecycle.state === "paused",
  };
}

/** The exit a watched plan gives each mint: the loss limit and the target of the plan written last among those still watched as a position. */
export function planExitsOf(records: readonly TradingPlanRecord[], rows: readonly SolanaWalletAction[], nowMs: number): Map<string, PlanExit> {
  const exits = new Map<string, PlanExit>();
  for (const record of records) {
    if (projectedStatus(record, nowMs) !== "executed") continue;
    if (!planIsWatched(record, "executed", rows, competingOf(records, record), nowMs)) continue;
    const rules = currentVersionOf(record).rules;
    const exit: PlanExit = { planId: record.id, limit: rules.risk.invalidationPerShare, target: rules.exit.targetPerShare ?? null, writtenAt: record.updatedAt };
    const before = exits.get(record.asset.mint);
    if (!before || Date.parse(exit.writtenAt) > Date.parse(before.writtenAt)) exits.set(record.asset.mint, exit);
  }
  return exits;
}

export type PositionsRead = Readonly<{
  positions: readonly PositionView[];
  /** A Telegram chat is connected: the channel «Ryntra попередить» warns through. */
  telegram: boolean;
  /** `complete` both programs answered · `partial` one did · `failed` none; `market` whether the universe answered. */
  holdings: "complete" | "partial" | "failed";
  market: "ok" | "failed";
  /** Whether the exits were read — every plan and every «Ryntra попередить» — or the store did not answer (`failed`): a position's missing exit is then unknown, not absent. Not in the route's answer. */
  exits: "complete" | "failed";
  at: string;
  /** What the chain said the wallet holds — every token, not only the companies — for the portfolio's risk; null when neither program answered. Not in the route's answer. */
  wallet: HeldRead | null;
  /** The universe's facts per held company, as the positions were judged on them. Not in the route's answer. */
  facts: ReadonlyMap<string, PositionRowFacts>;
}>;

export type PositionsDeps = Readonly<{
  readHeld: WalletHoldingsReader;
  readUniverse: () => Promise<UniverseRead>;
  /** Whether a Telegram chat is connected; null when the account store did not answer. */
  readTelegram: (owner: string) => Promise<boolean | null>;
  /** The wallet's History, for telling an open position from a sold one. */
  readRows: (owner: string) => Promise<readonly SolanaWalletAction[]>;
}>;

export async function readPositions(store: GuardStore, owner: string, nowMs: number, deps: PositionsDeps): Promise<PositionsRead> {
  const at = new Date(nowMs).toISOString();
  const [held, universe, plansRead, watchesRead, telegram] = await Promise.all([
    deps.readHeld(owner).catch(() => null),
    deps.readUniverse().catch((): UniverseRead => ({ ok: false, code: "UNAVAILABLE", reason: "The universe did not answer." })),
    /* Every plan, not a page of them: the fifty-first purchase with a loss limit keeps its exit. */
    listAllTradingPlans(store, owner).then(
      (records) => ({ ok: true, records }),
      () => ({ ok: false, records: [] as readonly TradingPlanRecord[] }),
    ),
    listPositionWatches(store, owner).then(
      (rows) => ({ ok: true, rows }),
      () => ({ ok: false, rows: [] as readonly PositionWatchRecord[] }),
    ),
    deps.readTelegram(owner).catch(() => null),
  ]);
  const plans = plansRead.records;
  const watches = watchesRead.rows;
  const holdings = held === null ? "failed" : held.complete ? "complete" : "partial";
  const market = universe.ok ? "ok" : "failed";
  /* Whether every exit was read: a store that did not answer leaves a position's exit unknown — never «none». */
  const exits = plansRead.ok && watchesRead.ok ? "complete" : "failed";
  if (held === null || !universe.ok) return { positions: [], telegram: telegram === true, holdings, market, exits, at, wallet: held, facts: new Map() };

  /* A watch whose token a complete read no longer finds is a position sold in full: closed, so a new purchase starts afresh. */
  const open: PositionWatchRecord[] = [];
  for (const watch of watches) {
    if (watch.closedAt !== null) continue;
    if (held.complete && (held.held.get(watch.mint) ?? 0n) <= 0n) {
      await closePositionWatch(store, owner, watch.mint, nowMs).catch(() => false);
      continue;
    }
    open.push(watch);
  }

  const rows = new Map<string, PositionRowFacts>();
  for (const row of universe.universe.rows) {
    const mint = row.representation.mint;
    if (!held.held.has(mint) || isRetiredMint(mint)) continue;
    const facts = rowFactsOf(row);
    rows.set(mint, held.frozen.has(mint) ? { ...facts, halted: true } : facts);
  }
  /* A plan on a held company whose purchase History holds but the plan missed (its execution's write failed) is brought level first — or it would read «expired», and the position unprotected. */
  const onHeld = plans.filter((record) => rows.has(record.asset.mint) && (record.status === "executed" || record.status === "active"));
  const history = onHeld.length > 0 ? await deps.readRows(owner) : [];
  const levelled = await Promise.all(
    plans.map((record) => (record.status === "active" && rows.has(record.asset.mint) ? reconcilePlanExecutions(store, record, history).then((read) => read.record, () => record) : Promise.resolve(record))),
  );
  const planExits = planExitsOf(levelled, history, nowMs);
  const positions = composePositions({
    held: held.held,
    rows,
    planExits,
    watches: open,
    eventOpen: (mint) => {
      const event = lifecycleEventFor(mint);
      return isWatched(event) && windowState(event, nowMs) === "open";
    },
    channel: telegram === true,
    nowMs,
  });
  return { positions, telegram: telegram === true, holdings, market, exits, at, wallet: held, facts: rows };
}
