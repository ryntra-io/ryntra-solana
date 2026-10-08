/**
 * A launch's trade written the way every Ryntra trade is.
 *
 * A buy or a sale of a Ryntra launch — on its bonding curve, in the DAMM v2
 * pool it graduated into, and the creator's first purchase inside the launch's
 * own creation — becomes, like a swap:
 *
 * 1. **A History row** (`solanaWalletActions`, lane `SWAP`, origin `LAUNCH` with
 *    the side, the token and the venue): `IN_FLIGHT` before the signed bytes
 *    are sent, so a trade the network has not answered for is still found;
 *    `DONE` with the legs the chain shows, `FAILED` when nothing moved. Its fee
 *    is the trade's whole fee the person paid, with Ryntra's part of it beside.
 * 2. **A signed Outcome Receipt** from the trade's own transaction — the program's
 *    swap event and the chain's balances beside the quote the wallet was shown.
 *    It is minted once: the first settlement keeps it, every other reads it.
 * 3. **Ryntra's part of the fee** — on the curve the partner's part of the
 *    trading fee and Meteora's referral, in the pool the referral (and Ryntra's
 *    own fee where it is charged): the cashback's base, handed to the rewards
 *    core as a fee of its own mechanism (`METEORA_LAUNCH`). Which fees earn what
 *    is the rewards rules' to say; the core only calls — and calls again on each
 *    reconciliation while the rules have not counted it, so a trade made before
 *    they do loses nothing.
 * 4. **The points and the statistics**: the same row is what Rewards' points and
 *    `/stats` read — a launch trade is the product `LAUNCH` there.
 *
 * A trade is settled where its answer is: by the submit right after the send
 * when the chain confirmed it in time, by History when the person opens it, by
 * the reconciliation every ten minutes otherwise — the same settlement each
 * time, keyed by the signature. The record moves on only once its History row is
 * written, so a row is never left behind it. Rewards and points are recorded on
 * mainnet only; the devnet stand writes its rows and receipts.
 *
 * Server only.
 */

import { createHash } from "node:crypto";

import type { Connection } from "@solana/web3.js";

import { METEORA_LAUNCH_ADAPTER_REF, METEORA_LAUNCH_TRADE_ACTION_REF } from "../agent-control/adapters/meteora-launch.ts";
import { createOutcomeReceipt, OutcomeReceiptArtifactSchema, type OutcomeReceiptArtifact } from "../agent-control/artifacts.ts";
import { attestArtifact, loadIssuerKey } from "../agent-control/issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "../agent-control/registry.ts";
import type { LaunchTrade } from "../core/venues/meteora-dbc/market.ts";
import type { LaunchMarketReader } from "../core/venues/meteora-dbc/market.server.ts";
import {
  LAUNCH_TRADE_RECEIPT_FACTS_SCHEMA,
  launchTradeFactsToEffects,
  parseLaunchTradeFactsFromEffects,
  ryntraShareBps,
  type LaunchTradeReceiptFacts,
} from "../core/venues/meteora-dbc/trade-receipt.ts";
import type { GuardStore } from "../guard/store.ts";
import { recordOperationPoints } from "../points/record.server.ts";
import { recordOperationRewards, type RecordRewardsOutcome } from "../rewards/record.server.ts";
import { actionFeeFromServiceFee, recordSolanaAction, type SolanaActionMovement, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { SOLANA_CAIP2 } from "../solana/chain-ids.ts";
import type { RyntraServiceFee } from "../swap/service-fee.ts";
import { launchWritesHere, type LaunchCluster, type LaunchNetwork } from "./config.server.ts";
import { readLaunchRecord, readSignature, type LaunchReadDeps, type SignatureRead } from "./flow.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";

export const LAUNCH_TRADE_RECORDS = "launchTradeRecords";
export const LAUNCH_TRADE_RECEIPTS = "launchTradeReceipts";

export type LaunchTradeQuoteFacts = LaunchTradeReceiptFacts["quote"];

/** What one sent trade is, and where its settlement stands. Keyed `<cluster>:<signature>`. */
export type LaunchTradeRecord = Readonly<{
  cluster: LaunchCluster;
  signature: string;
  wallet: string;
  side: "buy" | "sell";
  venue: "curve" | "pool";
  token: Readonly<{ mint: string; symbol: string; decimals: number }>;
  pair: Readonly<{ mint: string; symbol: string; decimals: number; dollar: boolean }>;
  curve: string;
  config: string;
  pool: string | null;
  /** The trade's own build, or the launch's whose creation carries the creator's first purchase. */
  buildId: string;
  /** SHA-256 of what the wallet reviewed — the unsigned bytes or the message as built — that the receipt answers. */
  reviewDigest: string;
  /** The last block height the signed bytes may land at. */
  validUntil: string;
  quote: LaunchTradeQuoteFacts;
  state: "SENT" | "DONE" | "FAILED";
  reason: string | null;
  receipt: OutcomeReceiptArtifact | null;
  /** What the rewards core answered last, for the operator and the next reconciliation: recorded, or skipped and why. */
  rewards: Readonly<{ state: string; reason: string | null; at: string }> | null;
  sentAt: string;
  settledAt: string | null;
  /** How many settlements found no answer yet, and when the last one was — the reconciliation waits longer each time. */
  tries?: number;
  triedAt?: string | null;
}>;

export type LaunchTradeStart = Omit<LaunchTradeRecord, "state" | "reason" | "receipt" | "rewards" | "sentAt" | "settledAt" | "tries" | "triedAt">;

/**
 * What settling reads: the network and its connection, the store, the clock. `reader` and `signatureRead` stand in for
 * the chain where a test gives them; the launch's market reader and the signature's status otherwise.
 */
export type SettleDeps = Readonly<{
  network: LaunchNetwork;
  connection: Connection;
  store: GuardStore;
  now: () => Date;
  reader?: Pick<LaunchMarketReader, "state" | "transaction">;
  signatureRead?: (signature: string, validUntil: number) => Promise<SignatureRead>;
}> &
  Pick<LaunchReadDeps, "second" | "adopt">;

type StoredReceipt = Readonly<{ cluster: string; signature: string; receipt: OutcomeReceiptArtifact }>;

const recordKey = (cluster: string, signature: string) => `${cluster}:${signature}`;
const records = (store: GuardStore) => store.collection<LaunchTradeRecord>(LAUNCH_TRADE_RECORDS);
const receipts = (store: GuardStore) => store.collection<StoredReceipt>(LAUNCH_TRADE_RECEIPTS);

/** The digest a receipt binds to: SHA-256 of the unsigned bytes as built — the wallet's review. */
export function reviewDigestOf(unsignedWireBase64: string): string {
  return `0x${createHash("sha256").update(Buffer.from(unsignedWireBase64, "base64")).digest("hex")}`;
}

const side = (value: "buy" | "sell") => (value === "buy" ? ("BUY" as const) : ("SELL" as const));
const tokenLeg = (record: Pick<LaunchTradeRecord, "token">, amountRaw: string): SolanaActionMovement => ({ mint: record.token.mint, amountRaw, decimals: record.token.decimals, symbol: record.token.symbol.slice(0, 24) });
const pairLeg = (record: Pick<LaunchTradeRecord, "pair">, amountRaw: string): SolanaActionMovement => ({ mint: record.pair.mint, amountRaw, decimals: record.pair.decimals, symbol: record.pair.symbol.slice(0, 24) });
const originOf = (record: Pick<LaunchTradeRecord, "side" | "token" | "venue">) => ({ surface: "LAUNCH" as const, side: side(record.side), token: record.token.mint, venue: record.venue });

/**
 * Before the send: the trade's record and its History row, `IN_FLIGHT`, with what the wallet spends. A second call for
 * the same signature changes nothing — the trade may already have settled.
 */
export async function beginLaunchTrade(deps: Readonly<{ store: GuardStore; now: () => Date }>, start: LaunchTradeStart): Promise<void> {
  const at = deps.now().toISOString();
  const record: LaunchTradeRecord = { ...start, state: "SENT", reason: null, receipt: null, rewards: null, sentAt: at, settledAt: null, tries: 0, triedAt: null };
  if (!(await records(deps.store).insertIfAbsent(recordKey(start.cluster, start.signature), record))) return;
  await recordSolanaAction(deps.store, {
    network: start.cluster,
    wallet: start.wallet,
    actionId: start.signature,
    lane: "SWAP",
    outcome: "IN_FLIGHT",
    out: start.side === "buy" ? pairLeg(start, start.quote.amountInRaw) : tokenLeg(start, start.quote.amountInRaw),
    in: null,
    signature: start.signature,
    origin: originOf(start),
    providerRef: null,
    now: at,
  });
}

/**
 * Nothing moved: the network refused the trade, or its signature can no longer land. The row is written first; the
 * record follows only once it is, so the next settlement writes a row the store refused.
 */
export async function failLaunchTrade(
  deps: Readonly<{ store: GuardStore; now: () => Date }>,
  cluster: string,
  signature: string,
  reason: string,
): Promise<Readonly<{ record: LaunchTradeRecord; row: SolanaWalletAction | null }> | null> {
  const collection = records(deps.store);
  const key = recordKey(cluster, signature);
  const record = await collection.get(key);
  if (!record) return null;
  if (record.state !== "SENT") return { record, row: null };
  const at = deps.now().toISOString();
  const row = await recordSolanaAction(deps.store, { network: record.cluster, wallet: record.wallet, actionId: signature, lane: "SWAP", outcome: "FAILED", signature, origin: originOf(record), now: at });
  if (!row.ok) return { record, row: null };
  const failed: LaunchTradeRecord = { ...record, state: "FAILED", reason: reason.slice(0, 300), settledAt: at };
  await collection.set(key, failed);
  return { record: failed, row: row.action };
}

/** The person's trade among the transaction's: the side they sent, their wallet as the one whose tokens moved or as the payer. */
export function tradeOfRecord(trades: readonly LaunchTrade[], record: Pick<LaunchTradeRecord, "side" | "wallet">): LaunchTrade | null {
  return trades.find((trade) => trade.side === record.side && (trade.trader === record.wallet || trade.payer === record.wallet)) ?? null;
}

/** The receipt's facts from the record and the trade the chain shows. */
export function launchTradeFacts(record: LaunchTradeRecord, trade: LaunchTrade & { ryntraRaw: string }, slot: number): LaunchTradeReceiptFacts {
  const received = BigInt(record.side === "buy" ? trade.tokensRaw : trade.pairRaw);
  return {
    schema: LAUNCH_TRADE_RECEIPT_FACTS_SCHEMA,
    network: record.cluster,
    signature: record.signature,
    slot,
    at: new Date(trade.at * 1000).toISOString(),
    wallet: record.wallet,
    side: record.side,
    venue: trade.venue,
    token: record.token,
    pair: record.pair,
    curve: record.curve,
    config: record.config,
    pool: trade.venue === "pool" ? record.pool : null,
    quote: record.quote,
    observed: { tokensRaw: trade.tokensRaw, pairRaw: trade.pairRaw, feeRaw: trade.feeRaw, ryntraRaw: trade.ryntraRaw, priceAfter: Number.isFinite(trade.priceAfter) && trade.priceAfter > 0 ? trade.priceAfter : 0 },
    minimumMet: received >= BigInt(record.quote.minimumOutRaw),
  };
}

/**
 * The trade's fee as the rewards core reads a fee: the whole fee the person paid (the curve's or the pool's own), of it
 * Ryntra's part — the cashback's base — and the rest, the creator's, Meteora's and the pool's liquidity's. Collected by
 * Meteora's own mechanism, observed on chain. Nothing where Ryntra's part is nothing.
 */
export function launchServiceFee(facts: LaunchTradeReceiptFacts): RyntraServiceFee {
  const total = BigInt(facts.observed.feeRaw);
  const ryntra = BigInt(facts.observed.ryntraRaw);
  const bps = ryntraShareBps({ ryntraRaw: total, pairRaw: BigInt(facts.observed.pairRaw), feeRaw: total, side: facts.side });
  const collected = ryntra > 0n;
  return {
    mechanism: "METEORA_LAUNCH",
    state: collected ? "COLLECTED" : "NONE",
    basisPoints: bps,
    requestedBasisPoints: bps,
    asset: facts.pair.mint,
    symbol: facts.pair.symbol,
    decimals: facts.pair.decimals,
    amountRaw: facts.observed.feeRaw,
    usd: null,
    accrual: "METEORA_PARTNER_VAULT",
    providerRetainedPercent: null,
    settlement: collected
      ? {
          userPaidRaw: facts.observed.feeRaw,
          providerRaw: (total - ryntra > 0n ? total - ryntra : 0n).toString(),
          ryntraRaw: facts.observed.ryntraRaw,
          asset: facts.pair.mint,
          symbol: facts.pair.symbol,
          decimals: facts.pair.decimals,
          basis: "OBSERVED",
          operationRef: facts.signature,
        }
      : null,
    note: collected ? null : "No part of this trade's fee went to Ryntra.",
  };
}

/** The signed Outcome Receipt of a launch trade: its facts, bound to what the wallet reviewed. */
export function mintLaunchTradeReceipt(record: LaunchTradeRecord, facts: LaunchTradeReceiptFacts, now: Date, environment?: Record<string, string | undefined>): OutcomeReceiptArtifact {
  const sourceRef = `solana:${record.cluster}:tx:${record.signature}`;
  const observedAt = facts.at;
  const verb = facts.side === "buy" ? "Bought" : "Sold";
  const headline = {
    description: `${verb} ${facts.observed.tokensRaw} raw of ${facts.token.mint} for ${facts.observed.pairRaw} raw of ${facts.pair.mint} on the launch's ${facts.venue}; fee ${facts.observed.feeRaw} raw, Ryntra's part ${facts.observed.ryntraRaw} (quoted ${facts.quote.amountOutRaw}, minimum ${facts.quote.minimumOutRaw}).`,
    sourceRef,
    observedAt,
  };
  const outcome = {
    status: facts.minimumMet ? ("MATCHED" as const) : ("DEVIATION_RECORDED" as const),
    chainRef: SOLANA_CAIP2[record.cluster],
    transactionHash: record.signature,
    observedEffects: [headline, ...launchTradeFactsToEffects({ facts, sourceRef, observedAt })],
    reconciledAt: now.toISOString(),
  };
  const registry = registryPin(AGENT_CONTROL_REGISTRY, [METEORA_LAUNCH_ADAPTER_REF, METEORA_LAUNCH_TRADE_ACTION_REF]);
  const base = { id: `launch-trade:${record.cluster}:${record.signature}`, actionPassportHash: record.reviewDigest, outcome, registry, now };
  const unsigned = createOutcomeReceipt(base);
  const key = loadIssuerKey(environment);
  return key ? createOutcomeReceipt({ ...base, issuer: attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key, now }) }) : unsigned;
}

/** The receipt a record holds, checked as an Outcome Receipt; null for none or one that does not parse. */
export function receiptOf(record: Pick<LaunchTradeRecord, "receipt"> | null): OutcomeReceiptArtifact | null {
  if (!record?.receipt) return null;
  const parsed = OutcomeReceiptArtifactSchema.safeParse(record.receipt);
  return parsed.success ? parsed.data : null;
}

/** The trade's receipt, minted once: the first settlement keeps the one it minted, every other reads that one. */
async function keepReceipt(store: GuardStore, record: LaunchTradeRecord, minted: OutcomeReceiptArtifact): Promise<OutcomeReceiptArtifact> {
  const key = recordKey(record.cluster, record.signature);
  if (await receipts(store).insertIfAbsent(key, { cluster: record.cluster, signature: record.signature, receipt: minted })) return minted;
  const kept = await receipts(store).get(key);
  return receiptOf(kept ?? null) ?? minted;
}

/** The rewards core's answer, as the record keeps it. */
function rewardsNote(outcome: RecordRewardsOutcome, at: string): NonNullable<LaunchTradeRecord["rewards"]> {
  return { state: outcome.state, reason: outcome.state === "SKIPPED" ? outcome.reason.slice(0, 300) : null, at };
}

export type SettleResult = Readonly<{ record: LaunchTradeRecord; row: SolanaWalletAction | null }> | null;

/**
 * The trade as the chain answers it now: settled `DONE` with its receipt, its row, Ryntra's part handed to the rewards
 * core and the points; `FAILED` when the transaction failed or its signature expired unseen; left `SENT` while the chain
 * has no answer yet. Null when no such trade was sent here.
 */
export async function settleLaunchTrade(deps: SettleDeps, signature: string, options: Readonly<{ countTry?: boolean }> = {}): Promise<SettleResult> {
  const collection = records(deps.store);
  const key = recordKey(deps.network.cluster, signature);
  const record = await collection.get(key);
  if (!record) return null;
  /* Only the deployment that writes launches writes their trades' books: a preview or a local server reads them. */
  if (record.state !== "SENT" || !launchWritesHere(deps.network)) return { record, row: null };
  /* No answer yet. Only the reconciliation's own tries count toward its wait — a person reloading History never pushes it
     out — and a record another settlement moved on meanwhile is left as it is. */
  const unanswered = async (): Promise<SettleResult> => {
    if (!options.countTry) return { record, row: null };
    const latest = await collection.get(key);
    if (!latest || latest.state !== "SENT") return { record: latest ?? record, row: null };
    const tried: LaunchTradeRecord = { ...latest, tries: (latest.tries ?? 0) + 1, triedAt: deps.now().toISOString() };
    await collection.set(key, tried);
    return { record: tried, row: null };
  };
  /* Nothing read of the trade: the signature's own status says whether it failed, expired unseen, or may still land. */
  const byStatus = async (): Promise<SettleResult> => {
    const read = await (deps.signatureRead ?? ((sig, until) => readSignature(deps.connection, sig, until, deps.second ?? null)))(signature, Number(record.validUntil));
    if (read.outcome === "FAILED") return (await failLaunchTrade(deps, record.cluster, signature, "The network refused the trade on chain; nothing moved.")) ?? { record, row: null };
    if (read.outcome === "EXPIRED") return (await failLaunchTrade(deps, record.cluster, signature, "The trade never landed and can no longer land; nothing moved.")) ?? { record, row: null };
    return unanswered();
  };
  /* A launch the store no longer has — a creation that never landed is removed with its record — is read by the signature. */
  const launch = await readLaunchRecord(deps, deps.network.cluster, record.token.mint);
  if (!launch) return byStatus();
  const reader = deps.reader ?? launchMarketReader(deps);
  const state = await reader.state({ token: record.token.mint, pool: launch.pool });
  /* Read fresh: a decode cached before Ryntra's part was counted is read from the node again. */
  const trades = await reader.transaction({ token: record.token.mint, state, signature, fresh: true });
  const mine = trades ? tradeOfRecord(trades, record) : null;
  if (!mine || mine.ryntraRaw === undefined) return byStatus();
  const now = deps.now();
  const at = now.toISOString();
  const facts = launchTradeFacts(record, { ...mine, ryntraRaw: mine.ryntraRaw }, mine.slot);
  const receipt = await keepReceipt(deps.store, record, mintLaunchTradeReceipt(record, facts, now));
  const fee = launchServiceFee(facts);
  const row = await recordSolanaAction(deps.store, {
    network: record.cluster,
    wallet: record.wallet,
    actionId: signature,
    lane: "SWAP",
    outcome: "DONE",
    out: record.side === "buy" ? pairLeg(record, facts.observed.pairRaw) : tokenLeg(record, facts.observed.tokensRaw),
    in: record.side === "buy" ? tokenLeg(record, facts.observed.tokensRaw) : pairLeg(record, facts.observed.pairRaw),
    signature,
    receiptHash: receipt.contentHash,
    fee: actionFeeFromServiceFee(fee) ?? null,
    origin: originOf({ ...record, venue: facts.venue }),
    providerRef: null,
    now: at,
  });
  /* The record moves on only with its row: a row the store refused is written by the next settlement. */
  if (!row.ok) return unanswered();
  /* Rewards and points are Ryntra's books on mainnet; the stand's rows are for its eyes. */
  let rewards: LaunchTradeRecord["rewards"] = null;
  if (record.cluster === "mainnet") {
    /* A trade with no part for Ryntra has no base for a cashback: it is never asked again. */
    const outcome =
      fee.state === "COLLECTED"
        ? await recordOperationRewards(deps.store, { fee, trader: record.wallet, settledAt: facts.at, now: at }).catch(
            (error: unknown): RecordRewardsOutcome => ({ state: "SKIPPED", reason: error instanceof Error ? error.message : "unavailable", retryable: true }),
          )
        : null;
    rewards = outcome ? rewardsNote(outcome, at) : { state: "NONE", reason: null, at };
    await recordOperationPoints(deps.store, { action: row.action, settledAt: facts.at, now: at }).catch(() => undefined);
  }
  const done: LaunchTradeRecord = { ...record, venue: facts.venue, state: "DONE", reason: null, receipt, rewards, settledAt: at };
  await collection.set(key, done);
  return { record: done, row: row.action };
}

/** A sent trade's record as stored, by its signature. */
export async function readLaunchTradeRecord(store: GuardStore, cluster: string, signature: string): Promise<LaunchTradeRecord | null> {
  return (await records(store).get(recordKey(cluster, signature))) ?? null;
}

/** A trade younger than this may still be settling by its own submit; the reconciliation leaves it. */
export const LAUNCH_RECONCILE_MIN_AGE_MS = 60_000;
/** The longest the reconciliation waits between two tries of a trade the chain has not answered for. */
const RECONCILE_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

/** Whether a trade without an answer is due again: a minute after its first try, then twice as long each time, at most six hours. */
export function launchTradeDue(record: Pick<LaunchTradeRecord, "sentAt" | "tries" | "triedAt">, now: number): boolean {
  if (now - Date.parse(record.sentAt) < LAUNCH_RECONCILE_MIN_AGE_MS) return false;
  if (!record.triedAt) return true;
  const wait = Math.min(RECONCILE_MAX_BACKOFF_MS, LAUNCH_RECONCILE_MIN_AGE_MS * 2 ** Math.min(20, record.tries ?? 0));
  return now - Date.parse(record.triedAt) >= wait;
}

/**
 * The reconciliation's pass on this network, inside `budgetMs`: every trade left `SENT` and due, oldest first, settled
 * from the chain; then every mainnet trade whose fee the rewards core has not recorded, handed to it again — the core
 * keys a fee by its mechanism and signature, so a second call never counts it twice. Each answer is reported; nothing is
 * guessed for a trade the chain has not answered.
 */
export async function reconcileLaunchTrades(
  deps: SettleDeps,
  options: Readonly<{ limit?: number; budgetMs?: number }> = {},
): Promise<readonly Readonly<{ signature: string; before: string; after: string; rewards?: string }>[]> {
  const started = deps.now().getTime();
  const budget = options.budgetMs ?? 20_000;
  const inTime = () => deps.now().getTime() - started < budget;
  const all = await records(deps.store).valuesWithPrefix(`${deps.network.cluster}:`);
  const now = deps.now().getTime();
  const open = all
    .filter((record) => record.state === "SENT" && launchTradeDue(record, now))
    .sort((a, b) => (a.triedAt ?? a.sentAt).localeCompare(b.triedAt ?? b.sentAt))
    .slice(0, options.limit ?? 10);
  const report: { signature: string; before: string; after: string; rewards?: string }[] = [];
  for (const record of open) {
    if (!inTime()) break;
    try {
      const settled = await settleLaunchTrade(deps, record.signature, { countTry: true });
      report.push({ signature: record.signature, before: record.state, after: settled?.record.state ?? record.state });
    } catch {
      report.push({ signature: record.signature, before: record.state, after: record.state });
    }
  }
  if (deps.network.cluster !== "mainnet" || !launchWritesHere(deps.network)) return report;
  /* The fees the rewards core skipped, the longest unasked first, so none waits behind another for ever. */
  const unrewarded = all
    .filter((record) => record.state === "DONE" && record.receipt !== null && record.rewards?.state === "SKIPPED")
    .sort((a, b) => (a.rewards?.at ?? "").localeCompare(b.rewards?.at ?? ""))
    .slice(0, options.limit ?? 10);
  for (const record of unrewarded) {
    if (!inTime()) break;
    const outcome = await replayRewards(deps, record).catch(() => null);
    if (outcome) report.push({ signature: record.signature, before: record.state, after: record.state, rewards: outcome.state });
  }
  return report;
}

/** A settled trade's fee handed to the rewards core again, from the facts its own receipt carries. */
async function replayRewards(deps: SettleDeps, record: LaunchTradeRecord): Promise<RecordRewardsOutcome | null> {
  const receipt = receiptOf(record);
  const facts = receipt ? parseLaunchTradeFactsFromEffects(receipt.outcome.observedEffects) : null;
  if (!facts) return null;
  const at = deps.now().toISOString();
  const outcome = await recordOperationRewards(deps.store, { fee: launchServiceFee(facts), trader: record.wallet, settledAt: facts.at, now: at });
  const latest = await records(deps.store).get(recordKey(record.cluster, record.signature));
  if (latest && latest.state === "DONE") await records(deps.store).set(recordKey(record.cluster, record.signature), { ...latest, rewards: rewardsNote(outcome, at) });
  return outcome;
}

/**
 * A trade's receipt for the wallet that sent it: settled from the chain first when it is still in flight. Null when no
 * such trade of this token was sent here by this wallet.
 */
export async function readLaunchTradeReceipt(
  deps: SettleDeps,
  token: string,
  input: Readonly<{ wallet: string; signature: string }>,
): Promise<Readonly<{ signature: string; state: LaunchTradeRecord["state"]; receipt: OutcomeReceiptArtifact | null }> | null> {
  let record = await readLaunchTradeRecord(deps.store, deps.network.cluster, input.signature);
  if (!record || record.wallet !== input.wallet || record.token.mint !== token) return null;
  if (record.state === "SENT") record = (await settleLaunchTrade(deps, input.signature).catch(() => null))?.record ?? record;
  return { signature: record.signature, state: record.state, receipt: receiptOf(record) };
}
