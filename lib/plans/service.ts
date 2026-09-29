/**
 * The Trading Plan's lifecycle — canon Part A §9.3–§9.5 (`RYN-STRATEGY-PLAN-001`).
 *
 * Create, edit as a new version, activate or cancel, read one or all — for
 * the wallet that proved itself and nobody else. Every write validates the
 * rules and sizes them the one way (`sizing.ts`); rules that do not make a
 * plan are refused with every failing field named. The asset is resolved by
 * mint — a confirmed stock representation of the universe, or (1.7.0,
 * `RYN-PLAN-CRYPTO-001`) a verified, tradable `crypto` or `meme` token of the
 * Spot catalogue, priced per token — so a plan never names a token nobody
 * confirms. Every version records the planning price the server read at the
 * write (context, never the quote, never invented). Every transition and
 * decision is a journal entry with its time and version.
 *
 * **Stage B — the plan joined to the deal.** The order route records the
 * Strategy block on the plan *before* the wallet signs (`recordPlanReview`,
 * a `reviewed` entry with the operation's id); the execute route appends the
 * execution *after* the History row (`recordPlanExecution`, keyed by the
 * signature so a second write of the same settlement changes nothing). The
 * History row carries the binding too, and it is the durable source: every
 * read of a plan reconciles the plan's executions against the wallet's
 * History (`reconcilePlanExecutions`) — an execution the plan missed is
 * appended, an outcome that moved is updated, and a write that still fails
 * is reported as `sync: pending`, never hidden and never retried by trading.
 *
 * The result types are the contract's; the routes turn them into the one
 * error shape. Nothing here reads a cookie or a header.
 */

import { randomBytes } from "node:crypto";

import {
  PLAN_EXECUTIONS_LIMIT,
  PLAN_MEMORY_LIMIT,
  PLAN_VERSIONS_LIMIT,
  TOKEN_CONFIRMATION_ISSUER,
  isTokenPlanAsset,
  planUnitBasis,
  type PlanAsset,
  type PlanAssetRead,
  type PlanMemoryFact,
  type PlanNoTradeOutcome,
  type PlanPosition,
  type PlanPositionRow,
  type PlanResult,
  type PlanResultsSummary,
  type PlanReview,
  type PlanRules,
  type PlanStatusRequest,
  type PlanSync,
  type PlanningPrice,
  type TradingPlan,
} from "../api/v1/contract.ts";
import { validateEvidenceConditions } from "../evidence/conditions.ts";
import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { listSolanaWalletActions, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { planBindingOf } from "../solana/action-origin.ts";
import { readSpotMarket } from "../spot/markets.server.ts";
import type { SpotMarket } from "../spot/markets.ts";
import { isRetiredMint, RETIRED_REASON } from "../stocks/retired.ts";
import { findStockRow, type StockRow } from "../stocks/universe.server.ts";
import { startingPrice } from "./builder-defaults.ts";
import { memoryFactsOf, type MemoryInput, type MemoryNote } from "./memory.ts";
import { noTradeOutcomeOf } from "./outcomes.ts";
import { positionOf } from "./position.ts";
import { matchedExitResult, matchedExitRows, outcomeOfRow, planResultFor } from "./results.ts";
import { computePlanSizing, type PlanIssue, type PlanSizingContext } from "./sizing.ts";
import {
  PLAN_REVIEWS_KEPT,
  findStoredReview,
  insertTradingPlan,
  listTradingPlans,
  projectTradingPlan,
  projectedStatus,
  readTradingPlan,
  replaceTradingPlan,
  type StoredPlanExecution,
  type TradingPlanRecord,
} from "./store.ts";

export type PlanFailure =
  | Readonly<{ ok: false; code: "PLAN_INVALID"; message: string; issues: readonly PlanIssue[] }>
  | Readonly<{ ok: false; code: "ASSET_UNCONFIRMED" | "PLAN_NOT_FOUND" | "PLAN_VERSION_CONFLICT" | "PLAN_STATE_REFUSED" | "UNAVAILABLE"; message: string }>;

export type PlanWriteResult = Readonly<{ ok: true; plan: TradingPlan }> | PlanFailure;
export type PlanReadResult = Readonly<{ ok: true; plan: TradingPlan; sync: PlanSync }> | PlanFailure;

type Ledger = (store: GuardStore, owner: string) => Promise<readonly SolanaWalletAction[]>;
type Deps = Readonly<{ now?: () => Date; findRow?: typeof findStockRow; readMarket?: typeof readSpotMarket; planId?: () => string; ledger?: Ledger }>;

const JOURNAL_KEPT = 200;

function newPlanId(): string {
  return `plan_${randomBytes(16).toString("hex")}`;
}

function nowOf(deps: Deps): Date {
  return (deps.now ?? (() => new Date()))();
}

async function ledgerRows(store: GuardStore, owner: string, deps: Deps): Promise<readonly SolanaWalletAction[]> {
  if (deps.ledger) return deps.ledger(store, owner);
  try {
    return (await listSolanaWalletActions(store, { network: "mainnet", wallet: owner })).actions;
  } catch {
    /* A History that cannot be read leaves the plan as it is; the next read tries again. */
    return [];
  }
}

export function planAssetOf(row: StockRow): PlanAsset {
  const rep = row.representation;
  return {
    network: "solana:mainnet",
    mint: rep.mint,
    symbol: rep.symbol,
    issuer: { id: rep.issuer.id, label: rep.issuer.label },
    underlying: { symbol: rep.underlying.symbol, name: rep.underlying.name },
    decimals: rep.decimals,
    /* 1.4.0: the unit the plan's prices are in — a share for the listed issuers, a token for the pre-IPO ones. Stored on the plan, so a later change of the row's model never re-reads an old plan in a new unit. */
    unitBasis: rep.instrument?.unitBasis ?? "share",
  };
}

/**
 * A verified, tradable token of the Spot catalogue as a plan asset (1.7.0):
 * priced per token, its own underlying, the list that confirms it as the
 * issuer — no reference, session, mark or multiplier.
 */
export function planAssetOfMarket(market: SpotMarket): PlanAsset {
  const kind = market.category === "meme" ? "meme" : "crypto";
  return {
    network: "solana:mainnet",
    mint: market.mint,
    symbol: market.symbol,
    issuer: { id: TOKEN_CONFIRMATION_ISSUER.id, label: TOKEN_CONFIRMATION_ISSUER.label },
    underlying: { symbol: market.symbol.slice(0, 16), name: market.name || null },
    decimals: market.decimals,
    unitBasis: "token",
    kind,
  };
}

/** The planning price of a stock row, in the plan's unit: the same figure the builder starts from, with the time of its own source. */
function stockPlanningPrice(row: StockRow, observedAt: string): PlanningPrice | null {
  const start = startingPrice(row);
  if (!start) return null;
  const at = start.source === "reference" ? (row.reference.observedAt ?? row.reference.fetchedAt ?? observedAt) : (row.market.observedAt ?? observedAt);
  return {
    perUnit: start.perShare,
    source: start.source === "reference" ? "issuer-reference" : start.source === "token-per-share" ? "jupiter-per-share" : "jupiter-token-price",
    observedAt: at,
    state: start.source === "reference" && row.reference.state === "stale" ? "stale" : "current",
  };
}

export type ResolvedPlanAsset = Readonly<{ ok: true; asset: PlanAsset; planningPrice: PlanningPrice | null; liquidityUsd: number | null; observedAt: string }>;

/**
 * Any mint resolved the way a create resolves it: a confirmed stock
 * representation first (the universe by mint), else a verified `crypto` or
 * `meme` token of the Spot catalogue (1.7.0). Each with the planning price
 * read now — context, never the quote, never invented — and the venue's
 * liquidity. An unconfirmed, unverified, uncategorised or untradable mint is
 * `ASSET_UNCONFIRMED` with the reason; a source that did not answer is
 * `UNAVAILABLE`, never a refusal of the asset.
 */
export async function resolvePlanAsset(mint: string, deps: Deps = {}): Promise<ResolvedPlanAsset | PlanFailure> {
  /* A token Ryntra no longer supports (canon v5.2 В26) is named by no new plan, and no provider is asked about it. */
  if (isRetiredMint(mint)) return { ok: false, code: "ASSET_UNCONFIRMED", message: `No plan can name that token. ${RETIRED_REASON}` };
  const now = nowOf(deps).toISOString();
  const found = await (deps.findRow ?? findStockRow)(mint);
  if (found.ok && found.row && found.row.representation.mint === mint) {
    return { ok: true, asset: planAssetOf(found.row), planningPrice: stockPlanningPrice(found.row, now), liquidityUsd: found.row.market.liquidityUsd, observedAt: found.row.market.observedAt ?? now };
  }
  const read = await (deps.readMarket ?? readSpotMarket)(mint);
  if (!read.ok) {
    /* The catalogue did not answer and the universe either did not answer or does not carry the mint: nothing can be confirmed right now, which is not a refusal. */
    return { ok: false, code: "UNAVAILABLE", message: found.ok ? read.reason : `${found.reason} ${read.reason}` };
  }
  if (!read.market) {
    return { ok: false, code: "ASSET_UNCONFIRMED", message: found.ok ? "That mint is neither a confirmed stock representation nor a token the catalogue lists, so no plan can name it." : `That mint is not a token the catalogue lists, and the stock universe did not answer: ${found.reason}` };
  }
  const market = read.market;
  if (market.category === "stock") {
    /* A stock is confirmed by the issuer's catalogue, never by the venue's tag alone; when the universe did not answer that is unavailability, not a refusal. */
    if (!found.ok) return { ok: false, code: "UNAVAILABLE", message: found.reason };
    return { ok: false, code: "ASSET_UNCONFIRMED", message: "That mint carries a stock tag but is not a confirmed stock representation, so no plan can name it." };
  }
  if (!market.verified) {
    return { ok: false, code: "ASSET_UNCONFIRMED", message: `${market.symbol} is not on the venue's verified list, so no plan can name it.` };
  }
  if (market.category === null) {
    return { ok: false, code: "ASSET_UNCONFIRMED", message: `${market.symbol} has no category on the venue's list (neither crypto nor meme), so no plan can name it.` };
  }
  if (market.decimals === null) {
    return { ok: false, code: "ASSET_UNCONFIRMED", message: `${market.symbol} states no decimals on the venue's list, so its units cannot be counted and no plan can name it.` };
  }
  if (market.audit.suspicious) {
    return { ok: false, code: "ASSET_UNCONFIRMED", message: `${market.symbol} is flagged suspicious by the venue's own audit, so no plan can name it.` };
  }
  const price = market.price !== null && Number.isFinite(market.price) && market.price > 0 ? market.price : null;
  const planningPrice: PlanningPrice | null = price === null ? null : { perUnit: price, source: "jupiter-token-price", observedAt: market.updatedAt ?? read.observedAt, state: read.stale ? "stale" : "current" };
  return { ok: true, asset: planAssetOfMarket(market), planningPrice, liquidityUsd: market.liquidityUsd, observedAt: read.observedAt };
}

/** The read route's answer (1.7.0). */
export async function readPlanAsset(mint: string, deps: Deps = {}): Promise<Readonly<{ ok: true; read: PlanAssetRead }> | PlanFailure> {
  const resolved = await resolvePlanAsset(mint, deps);
  if (!resolved.ok) return resolved;
  return { ok: true, read: { asset: resolved.asset, planningPrice: resolved.planningPrice, liquidityUsd: resolved.liquidityUsd, observedAt: resolved.observedAt } };
}

/** The size's context from the asset: the unit word and whether the reference rules apply (1.7.0). */
export function sizingContextOf(asset: PlanAsset): PlanSizingContext {
  return { unitWord: planUnitBasis(asset), tokenAsset: isTokenPlanAsset(asset) };
}

/**
 * The rules judged as rules and sized: the money by `sizing.ts`, the evidence
 * conditions by the evidence layer's registry (`RYN-NANSEN-EVIDENCE-001`) —
 * one list of issues, every failing field named, before anything is stored.
 */
function sizeRules(rules: PlanRules, nowMs: number, context: PlanSizingContext): ReturnType<typeof computePlanSizing> {
  const conditionIssues = validateEvidenceConditions(rules.evidenceConditions);
  const sized = computePlanSizing(rules, nowMs, context);
  if (conditionIssues.length === 0) return sized;
  return { ok: false, issues: [...(sized.ok ? [] : sized.issues), ...conditionIssues] };
}

export async function createPlan(
  store: GuardStore,
  input: Readonly<{ owner: string; mint: string; rules: PlanRules; activate: boolean }>,
  deps: Deps = {},
): Promise<PlanWriteResult> {
  const now = nowOf(deps);
  /* The asset first (1.7.0): the size's context — the unit word, whether the
     reference rules apply — comes from what the asset is, so a token plan's
     refusals name the right rule. The money is still judged before any store. */
  const resolved = await resolvePlanAsset(input.mint, deps);
  if (!resolved.ok) return resolved;
  const sized = sizeRules(input.rules, now.getTime(), sizingContextOf(resolved.asset));
  if (!sized.ok) return { ok: false, code: "PLAN_INVALID", message: "The rules do not make a plan.", issues: sized.issues };
  const at = now.toISOString();
  const id = (deps.planId ?? newPlanId)();
  const record: TradingPlanRecord = {
    schema: "ryntra.trading-plan",
    schemaVersion: "1.1.0",
    id,
    owner: input.owner,
    network: "solana:mainnet",
    status: input.activate ? "active" : "draft",
    side: "BUY",
    asset: resolved.asset,
    version: 1,
    planVersion: 1,
    history: [{ version: 1, rules: input.rules, sizing: sized.sizing, createdAt: at, reason: null, planningPrice: resolved.planningPrice }],
    journal: [
      { at, event: "created", version: 1, note: null, ref: null },
      ...(input.activate ? [{ at, event: "activated" as const, version: 1, note: null, ref: null }] : []),
    ],
    executions: [],
    reviews: [],
    createdAt: at,
    updatedAt: at,
  };
  const inserted = await insertTradingPlan(store, record);
  if (!inserted) return { ok: false, code: "UNAVAILABLE", message: "The plan could not be stored; try again." };
  return { ok: true, plan: projectTradingPlan(record, now.getTime()) };
}

/** New rules make a new version; the version the client read must be the current one. */
export async function updatePlan(
  store: GuardStore,
  input: Readonly<{ owner: string; planId: string; rules: PlanRules; ifVersion: number; reason: string | null }>,
  deps: Deps = {},
): Promise<PlanWriteResult> {
  const now = nowOf(deps);
  const record = await readTradingPlan(store, input.owner, input.planId);
  if (!record) return { ok: false, code: "PLAN_NOT_FOUND", message: "No such plan for this wallet." };
  if (record.planVersion !== input.ifVersion) {
    return { ok: false, code: "PLAN_VERSION_CONFLICT", message: `The plan is on version ${record.planVersion}; the request named ${input.ifVersion}. Re-read it and decide again.` };
  }
  if (record.status === "executed" || record.status === "cancelled") {
    return { ok: false, code: "PLAN_STATE_REFUSED", message: `A ${record.status} plan is not edited; its rules are the rules that stood.` };
  }
  if (record.history.length >= PLAN_VERSIONS_LIMIT) {
    return { ok: false, code: "PLAN_STATE_REFUSED", message: `A plan keeps at most ${PLAN_VERSIONS_LIMIT} versions.` };
  }
  const sized = sizeRules(input.rules, now.getTime(), sizingContextOf(record.asset));
  if (!sized.ok) return { ok: false, code: "PLAN_INVALID", message: "The rules do not make a plan.", issues: sized.issues };
  /* The planning price at this write, as context on the new version (1.7.0); a source that does not answer leaves it null — the edit is the person's rules, not the market's. */
  const indication = await resolvePlanAsset(record.asset.mint, deps).catch(() => null);
  const at = now.toISOString();
  const version = record.planVersion + 1;
  const next = {
    ...record,
    planVersion: version,
    history: [...record.history, { version, rules: input.rules, sizing: sized.sizing, createdAt: at, reason: input.reason, planningPrice: indication?.ok ? indication.planningPrice : null }],
    journal: [...record.journal, { at, event: "edited" as const, version, note: input.reason, ref: null }].slice(-JOURNAL_KEPT),
    updatedAt: at,
  };
  const written = await replaceTradingPlan(store, record, next);
  if (!written) return { ok: false, code: "PLAN_VERSION_CONFLICT", message: "The plan changed while this edit was made; re-read it and decide again." };
  return { ok: true, plan: projectTradingPlan({ ...next, version: record.version + 1 }, now.getTime()) };
}

export async function setPlanStatus(
  store: GuardStore,
  input: Readonly<{ owner: string; planId: string; status: PlanStatusRequest["status"]; ifVersion: number; reason: string | null }>,
  deps: Deps = {},
): Promise<PlanWriteResult> {
  const now = nowOf(deps);
  const record = await readTradingPlan(store, input.owner, input.planId);
  if (!record) return { ok: false, code: "PLAN_NOT_FOUND", message: "No such plan for this wallet." };
  if (record.planVersion !== input.ifVersion) {
    return { ok: false, code: "PLAN_VERSION_CONFLICT", message: `The plan is on version ${record.planVersion}; the request named ${input.ifVersion}. Re-read it and decide again.` };
  }
  if (record.status === input.status) return { ok: true, plan: projectTradingPlan(record, now.getTime()) };
  if (record.status === "executed" || record.status === "cancelled") {
    return { ok: false, code: "PLAN_STATE_REFUSED", message: `A ${record.status} plan does not change status.` };
  }
  const at = now.toISOString();
  const event: TradingPlanRecord["journal"][number]["event"] = input.status === "active" ? "activated" : "cancelled";
  const next = {
    ...record,
    status: input.status,
    journal: [...record.journal, { at, event, version: record.planVersion, note: input.reason, ref: null }].slice(-JOURNAL_KEPT),
    updatedAt: at,
  };
  const written = await replaceTradingPlan(store, record, next);
  if (!written) return { ok: false, code: "PLAN_VERSION_CONFLICT", message: "The plan changed while this was decided; re-read it and decide again." };
  return { ok: true, plan: projectTradingPlan({ ...next, version: record.version + 1 }, now.getTime()) };
}

/* ------------------------------------------------------------ stage B: the Review, the execution, the reconciliation */

export type PlanReviewRecordResult = Readonly<{ ok: true; plan: TradingPlan }> | PlanFailure;

/**
 * The Strategy block the order route judged, written on the plan before any
 * bytes reach the wallet: a `reviewed` entry with the operation's id and the
 * verdict, the block kept for Plan vs Actual.
 *
 * **A refusal is recorded too (1.9.0, `RYN-RESULTS-MEMORY-001`).** Until
 * this row, only a Review that passed was written down, so a plan whose
 * maximum price was never met kept no trace of the three times it refused —
 * and the product could not answer the most useful question a careful person
 * asks, *why did I not buy?*, without inventing the reason. The refusal is
 * the record that answers it, and the caller writes it non-fatally: a write
 * that fails never turns a refusal into anything else.
 *
 * Refused when the plan is no longer the one judged.
 */
export async function recordPlanReview(store: GuardStore, input: Readonly<{ owner: string; review: PlanReview }>, deps: Deps = {}): Promise<PlanReviewRecordResult> {
  const now = nowOf(deps);
  const { review } = input;
  try {
    return await withBoundedCasRetry(async () => {
      const record = await readTradingPlan(store, input.owner, review.planId);
      if (!record) return { ok: false as const, code: "PLAN_NOT_FOUND" as const, message: "No such plan for this wallet." };
      if (record.planVersion !== review.version) {
        return { ok: false as const, code: "PLAN_VERSION_CONFLICT" as const, message: `The plan moved to version ${record.planVersion} while the Review judged version ${review.version}; ask for a fresh Review.` };
      }
      if (projectedStatus(record, now.getTime()) !== "active") {
        return { ok: false as const, code: "PLAN_STATE_REFUSED" as const, message: `The plan is ${projectedStatus(record, now.getTime())}; only an active plan is traded under.` };
      }
      if (record.reviews.some((kept) => kept.reviewId === review.reviewId)) return { ok: true as const, plan: projectTradingPlan(record, now.getTime()) };
      const at = now.toISOString();
      const next = {
        ...record,
        reviews: [...record.reviews, review].slice(-PLAN_REVIEWS_KEPT),
        journal: [...record.journal, { at, event: "reviewed" as const, version: record.planVersion, note: review.verdict, ref: review.reviewId }].slice(-JOURNAL_KEPT),
        updatedAt: at,
      };
      const written = await replaceTradingPlan(store, record, next);
      if (!written) return false;
      return { ok: true as const, plan: projectTradingPlan({ ...next, version: record.version + 1 }, now.getTime()) };
    });
  } catch (cause) {
    return { ok: false, code: "UNAVAILABLE", message: cause instanceof Error ? cause.message : "The plan could not record the Review." };
  }
}

export type PlanExecutionInput = Readonly<{
  signature: string;
  version: number;
  reviewId: string | null;
  review: PlanReview | null;
  reviewedAt: string;
  outcome: StoredPlanExecution["outcome"];
  /** 1.9.0: the side off the signed bundle's origin, so the plan knows a sell from a buy without reading it backwards off the legs; null where the caller has none. */
  side?: StoredPlanExecution["side"];
}>;

/**
 * Apply one execution to a record: append it, or move its outcome; on a
 * DONE fill the plan is `executed` and the journal says so once. Returns the
 * next record, or null when nothing changes.
 */
function applyExecution(record: TradingPlanRecord, execution: PlanExecutionInput, at: string): Omit<TradingPlanRecord, "version"> | null {
  const existing = record.executions.find((entry) => entry.signature === execution.signature);
  /* A side that has just become known is a change worth a write, the same way a Review arriving late is: the plan cannot tell an exit from an entry without it. */
  if (existing && existing.outcome === execution.outcome && (existing.review !== null || execution.review === null) && (existing.side !== null || (execution.side ?? null) === null)) return null;
  const review = execution.review ?? existing?.review ?? (execution.reviewId ? findStoredReview(record, execution.reviewId) : null);
  const entry: StoredPlanExecution = {
    signature: execution.signature,
    version: execution.version,
    reviewedAt: review?.checkedAt ?? existing?.reviewedAt ?? execution.reviewedAt,
    recordedAt: existing?.recordedAt ?? at,
    outcome: execution.outcome,
    reviewId: execution.reviewId ?? existing?.reviewId ?? review?.reviewId ?? null,
    side: execution.side ?? existing?.side ?? null,
    review,
  };
  const executions = existing ? record.executions.map((candidate) => (candidate.signature === execution.signature ? entry : candidate)) : [...record.executions, entry].slice(-PLAN_EXECUTIONS_LIMIT);
  const done = execution.outcome === "DONE";
  const alreadyJournaled = record.journal.some((line) => line.event === "executed" && line.ref === execution.signature);
  const status = done && (record.status === "active" || record.status === "expired") ? "executed" : record.status;
  const journal = done && !alreadyJournaled ? [...record.journal, { at, event: "executed" as const, version: execution.version, note: null, ref: execution.signature }].slice(-JOURNAL_KEPT) : record.journal;
  return { ...record, status, executions, journal, updatedAt: at };
}

/**
 * The execution after the History row. Never throws; a result object says
 * whether the plan holds it now. A swap that moved money is never reported
 * as failed because the plan's row was slow — the read-time reconciliation
 * writes the same execution from History, keyed by the same signature.
 */
export async function recordPlanExecution(
  store: GuardStore,
  input: Readonly<{ owner: string; planId: string; execution: PlanExecutionInput }>,
  deps: Deps = {},
): Promise<Readonly<{ ok: true; changed: boolean }> | Readonly<{ ok: false; reason: string }>> {
  const now = nowOf(deps);
  try {
    return await withBoundedCasRetry(async () => {
      const record = await readTradingPlan(store, input.owner, input.planId);
      if (!record) return { ok: false as const, reason: "PLAN_NOT_FOUND" };
      const next = applyExecution(record, input.execution, now.toISOString());
      if (!next) return { ok: true as const, changed: false };
      const written = await replaceTradingPlan(store, record, next);
      if (!written) return false;
      return { ok: true as const, changed: true };
    });
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : "PLAN_EXECUTION_UNAVAILABLE" };
  }
}

/** The History rows made under this plan, by the binding on the row. */
export function rowsUnderPlan(rows: readonly SolanaWalletAction[], planId: string): readonly SolanaWalletAction[] {
  return rows.filter((row) => planBindingOf(row.origin)?.planId === planId && row.signature !== null);
}

/**
 * Bring the plan's executions level with History: every row bound to this
 * plan is on the plan with History's outcome. Idempotent by signature; the
 * writes that fail are counted, never hidden. Returns the record as it now
 * stands (the written one, or the read one when a write failed).
 */
export async function reconcilePlanExecutions(
  store: GuardStore,
  record: TradingPlanRecord,
  rows: readonly SolanaWalletAction[],
  deps: Deps = {},
): Promise<Readonly<{ record: TradingPlanRecord; sync: PlanSync }>> {
  const now = nowOf(deps);
  let current = record;
  let pending = 0;
  for (const row of rowsUnderPlan(rows, record.id)) {
    const binding = planBindingOf(row.origin);
    if (!binding || row.signature === null) continue;
    const execution: PlanExecutionInput = {
      signature: row.signature,
      version: binding.version,
      reviewId: binding.reviewId,
      review: null,
      reviewedAt: row.startedAt,
      outcome: outcomeOfRow(row),
      /* The row's own origin is the durable statement of the side; a plan that missed the write finds it here, never by guessing from the legs. */
      side: row.origin?.side ?? null,
    };
    if (!applyExecution(current, execution, now.toISOString())) continue;
    const written = await recordPlanExecution(store, { owner: record.owner, planId: record.id, execution }, deps);
    if (!written.ok) {
      pending += 1;
      continue;
    }
    const reread = await readTradingPlan(store, record.owner, record.id);
    if (reread) current = reread;
  }
  return { record: current, sync: { state: pending > 0 ? "pending" : "complete", pending } };
}

export async function getPlan(store: GuardStore, owner: string, planId: string, deps: Deps = {}): Promise<PlanReadResult> {
  const now = nowOf(deps);
  const record = await readTradingPlan(store, owner, planId);
  if (!record) return { ok: false, code: "PLAN_NOT_FOUND", message: "No such plan for this wallet." };
  const reconciled = await reconcilePlanExecutions(store, record, await ledgerRows(store, owner, deps), deps);
  return { ok: true, plan: projectTradingPlan(reconciled.record, now.getTime()), sync: reconciled.sync };
}

export async function getPlanVersion(store: GuardStore, owner: string, planId: string, version: number): Promise<Readonly<{ ok: true; version: TradingPlanRecord["history"][number] }> | PlanFailure> {
  const record = await readTradingPlan(store, owner, planId);
  if (!record) return { ok: false, code: "PLAN_NOT_FOUND", message: "No such plan for this wallet." };
  const entry = record.history.find((candidate) => candidate.version === version);
  if (!entry) return { ok: false, code: "PLAN_NOT_FOUND", message: `The plan has no version ${version}.` };
  return { ok: true, version: entry };
}

export async function listPlans(store: GuardStore, owner: string, deps: Deps = {}): Promise<Readonly<{ plans: readonly TradingPlan[]; total: number; sync: PlanSync }>> {
  const now = nowOf(deps);
  const { records, total } = await listTradingPlans(store, owner);
  const rows = records.length > 0 ? await ledgerRows(store, owner, deps) : [];
  const plans: TradingPlan[] = [];
  let pending = 0;
  for (const record of records) {
    const reconciled = await reconcilePlanExecutions(store, record, rows, deps);
    pending += reconciled.sync.pending;
    plans.push(projectTradingPlan(reconciled.record, now.getTime()));
  }
  return { plans, total, sync: { state: pending > 0 ? "pending" : "complete", pending } };
}

/* ------------------------------------------------------------ Plan vs Actual, the position and the no-trade outcome */

/**
 * One plan's results: every execution the plan declared, plus the exits
 * History holds for this plan's own mint that no plan declared (`competing`
 * is how many other plans of the wallet name the same mint — with any, none
 * is paired). A matched exit is a projection: nothing is written onto the
 * plan for it, so a read undoes it.
 */
function resultsOf(record: TradingPlanRecord, rows: readonly SolanaWalletAction[], nowMs: number, competing = 0): PlanResult[] {
  const declared = record.executions.map((execution) => planResultFor(record, execution, rows.find((row) => row.signature === execution.signature) ?? null, nowMs));
  const matched = matchedExitRows(record, rows, competing).map((row) => matchedExitResult(record, row, nowMs));
  return [...declared, ...matched];
}

function newestFirst(results: PlanResult[]): PlanResult[] {
  return results.sort((a, b) => Date.parse(b.actual.settledAt) - Date.parse(a.actual.settledAt));
}

/**
 * One plan projected every way Results reads it: the executions as Plan vs
 * Actual, what they add up to as a position, and — only when none of them
 * settled — why no trade was made. A plan is never both, so the two feeds
 * never tell the same plan's story twice.
 */
function feedOf(record: TradingPlanRecord, rows: readonly SolanaWalletAction[], nowMs: number, competing = 0): MemoryInput {
  const results = resultsOf(record, rows, nowMs, competing);
  return { record, results, outcome: noTradeOutcomeOf(record, nowMs), position: positionOf(results) };
}

/** How many of the wallet's other plans name the same mint — the figure that decides whether an undeclared sell may be paired at all. */
function competingOf(record: TradingPlanRecord, records: readonly TradingPlanRecord[]): number {
  return records.filter((candidate) => candidate.id !== record.id && candidate.asset.mint === record.asset.mint).length;
}

function summaryOf(entries: readonly MemoryInput[]): PlanResultsSummary {
  const settled = entries.flatMap((entry) => entry.results.filter((result) => result.actual.outcome === "DONE"));
  return {
    plans: entries.length,
    trades: settled.length,
    entries: settled.filter((result) => result.actual.leg === "entry").length,
    exits: settled.filter((result) => result.actual.leg === "exit").length,
    noTrade: entries.filter((entry) => entry.outcome !== null).length,
    openPositions: entries.filter((entry) => entry.position.state === "open").length,
    closedPositions: entries.filter((entry) => entry.position.state === "closed").length,
  };
}

function positionRowsOf(entries: readonly MemoryInput[]): PlanPositionRow[] {
  return entries
    .filter((entry) => entry.position.state !== "none")
    .map((entry) => ({ planId: entry.record.id, asset: entry.record.asset, status: projectedStatus(entry.record, Date.now()), version: entry.record.planVersion, position: entry.position }));
}

function outcomesOf(entries: readonly MemoryInput[]): PlanNoTradeOutcome[] {
  return entries
    .map((entry) => entry.outcome)
    .filter((outcome): outcome is PlanNoTradeOutcome => outcome !== null)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

export type PlanResultsRead = Readonly<{ ok: true; results: readonly PlanResult[]; outcomes: readonly PlanNoTradeOutcome[]; positions: readonly PlanPositionRow[]; summary: PlanResultsSummary; sync: PlanSync }>;

export async function getPlanResults(store: GuardStore, owner: string, planId: string, deps: Deps = {}): Promise<PlanResultsRead | PlanFailure> {
  const record = await readTradingPlan(store, owner, planId);
  if (!record) return { ok: false, code: "PLAN_NOT_FOUND", message: "No such plan for this wallet." };
  const rows = await ledgerRows(store, owner, deps);
  const reconciled = await reconcilePlanExecutions(store, record, rows, deps);
  /* The sibling plans are read but not reconciled: the only thing needed from them is whether another plan names this mint. */
  const siblings = await listTradingPlans(store, owner);
  const entry = feedOf(reconciled.record, rows, nowOf(deps).getTime(), competingOf(reconciled.record, siblings.records));
  return { ok: true, results: newestFirst([...entry.results]), outcomes: outcomesOf([entry]), positions: positionRowsOf([entry]), summary: summaryOf([entry]), sync: reconciled.sync };
}

/** Every plan of the wallet projected: the results newest settled first, the no-trade outcomes, the positions and the counts. */
export async function listPlanResults(store: GuardStore, owner: string, deps: Deps = {}): Promise<Omit<PlanResultsRead, "ok">> {
  const { entries, sync } = await planFeed(store, owner, deps);
  return { results: newestFirst(entries.flatMap((entry) => [...entry.results])), outcomes: outcomesOf(entries), positions: positionRowsOf(entries), summary: summaryOf(entries), sync };
}

/** The wallet's plans, reconciled once and projected once — the one read both Results and memory are built from. */
async function planFeed(store: GuardStore, owner: string, deps: Deps): Promise<Readonly<{ entries: readonly MemoryInput[]; sync: PlanSync }>> {
  const { records } = await listTradingPlans(store, owner);
  const rows = records.length > 0 ? await ledgerRows(store, owner, deps) : [];
  const entries: MemoryInput[] = [];
  let pending = 0;
  for (const record of records) {
    const reconciled = await reconcilePlanExecutions(store, record, rows, deps);
    pending += reconciled.sync.pending;
    entries.push(feedOf(reconciled.record, rows, nowOf(deps).getTime(), competingOf(record, records)));
  }
  return { entries, sync: { state: pending > 0 ? "pending" : "complete", pending } };
}

/* ------------------------------------------------------------ strategy memory */

/**
 * The wallet's strategy memory, derived from the same records Results reads
 * and carrying the citation of each one. `notes` are the monitoring notes
 * the caller already read for this wallet; without them the memory is the
 * plans' own facts, which is a smaller memory and never a wrong one.
 */
export async function listPlanMemory(store: GuardStore, owner: string, notes: readonly MemoryNote[] = [], deps: Deps = {}): Promise<Readonly<{ facts: readonly PlanMemoryFact[]; sync: PlanSync }>> {
  const { entries, sync } = await planFeed(store, owner, deps);
  return { facts: memoryFactsOf(entries, notes).slice(0, PLAN_MEMORY_LIMIT), sync };
}

/** The position of one plan, for a surface that has the plan and wants no second calculation. */
export function planPositionOf(record: TradingPlanRecord, rows: readonly SolanaWalletAction[], nowMs: number, competing = 0): PlanPosition {
  return positionOf(resultsOf(record, rows, nowMs, competing));
}

