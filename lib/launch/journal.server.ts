/**
 * A launch's flight log as its page and the phone read it — what happened to
 * the token, the newest first, each with its time, its amount and its
 * transaction — and the Fee-Funded Liquidity Ladder on it as it stands.
 *
 * Its entries come from the chain, never from a guess:
 * - Ryntra's record of the launch: the creation and the creator's first
 *   purchase, the creator's lock, the sharing of the creator's fees — each at
 *   the time of its own transaction's block;
 * - the token's market as read from the chain: every sale of the creator's
 *   («Творець продав»), with the share of what they bought sold by then;
 * - the executor's receipts: the graduation and who sent it, the Fee-Funded
 *   Liquidity Ladder opened, placed, emptied to move up, moved up, added to —
 *   each from its confirmed transaction;
 * - the executor's and its operator's marks, beside them: its first pass over
 *   the market, each new state of the market's cycle with the transaction it
 *   rests on, a stop or a resume of the executor, a failed graduation it sends
 *   again. A graduation without a receipt yet is read
 *   from the graduated pool's first transaction when the market's read found
 *   it and it is the curve's migration.
 *
 * Whatever could not be read is said: `complete` is false when the creator's
 * trades were read in part or a graduation is not known yet, and
 * `floorUnread` when the ladder is there but its position was not read
 * — never a missing entry passed off as nothing.
 */

import type { Connection } from "@solana/web3.js";

import type { LaunchFloorView, LaunchJournalEventView, LaunchJournalResponse } from "../api/v1/contract.ts";
import { FLOOR_RULE, JOURNAL_ENFORCEMENT, creatorSoldEvents, graduationActor, journal, journalEvent, priceOfBin, type JournalEvent } from "../core/launch/autopilot.ts";
import { autopilotReceipts, floorRecord, isMigration } from "./autopilot.server.ts";
import { launchExecutorAddress, launchPair } from "./config.server.ts";
import { journalMarks } from "./executor.server.ts";
import { readLaunchRecord } from "./flow.server.ts";
import { readLaunchMarketFacts, type MarketDeps } from "./market.server.ts";

const CACHE_MS = 10_000;
const CACHE = new Map<string, Readonly<{ at: number; value: Promise<LaunchJournalResponse | null> }>>();
/* A confirmed transaction's block time and fee payer never change: read once a process. */
const TRANSACTIONS = new Map<string, Readonly<{ at: string | null; feePayer: string; logs: readonly string[]; failed: boolean }>>();
const TRANSACTIONS_KEPT = 2_000;

export function readLaunchJournal(deps: MarketDeps, token: string): Promise<LaunchJournalResponse | null> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const hit = CACHE.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const value = assemble(deps, token);
  CACHE.set(key, { at: now, value });
  value.catch(() => CACHE.delete(key));
  return value;
}

async function transactionOf(connection: Connection, second: Connection | null, signature: string): Promise<Readonly<{ at: string | null; feePayer: string; logs: readonly string[]; failed: boolean }> | null> {
  const known = TRANSACTIONS.get(signature);
  if (known) return known;
  const read = (from: Connection) => from.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const tx = (await read(connection).catch(() => null)) ?? (second ? await read(second).catch(() => null) : null);
  if (!tx?.meta) return null;
  const facts = {
    at: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    feePayer: tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).staticAccountKeys[0]?.toBase58() ?? "",
    logs: tx.meta.logMessages ?? [],
    failed: tx.meta.err !== null,
  };
  if (TRANSACTIONS.size >= TRANSACTIONS_KEPT) TRANSACTIONS.delete(TRANSACTIONS.keys().next().value!);
  TRANSACTIONS.set(signature, facts);
  return facts;
}

async function assemble(deps: MarketDeps, token: string): Promise<LaunchJournalResponse | null> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return null;
  const pair = launchPair(deps.network, record.preset);
  const second = deps.second ?? null;
  const events: JournalEvent[] = [];
  events.push(
    journalEvent({
      kind: "LAUNCHED",
      at: record.launchedAt,
      signature: record.signature,
      actor: "creator",
      pairRaw: BigInt(record.firstBuyInRaw) > 0n ? record.firstBuyInRaw : null,
      tokensRaw: BigInt(record.firstBuyOutRaw) > 0n ? record.firstBuyOutRaw : null,
    }),
  );
  /* The lock and the sharing at their own block's time; unread, the launch's — they were signed in its window. */
  if (record.lock?.state === "LOCKED" && record.lock.signature) {
    const at = (await transactionOf(deps.connection, second, record.lock.signature))?.at ?? record.launchedAt;
    events.push(journalEvent({ kind: "CREATOR_LOCKED", at, signature: record.lock.signature, actor: "creator", tokensRaw: record.firstBuyOutRaw }));
  }
  if (record.feeSharing?.state === "SHARED" && record.feeSharing.signature) {
    const at = (await transactionOf(deps.connection, second, record.feeSharing.signature))?.at ?? record.launchedAt;
    events.push(journalEvent({ kind: "FEES_SHARED", at, signature: record.feeSharing.signature, actor: "creator" }));
  }

  /* The creator's sales, from the same read the market uses; unread is said, never zero. */
  const facts = await readLaunchMarketFacts(deps, token).catch(() => null);
  let complete = facts !== null && facts.creatorTradesComplete;
  const tokenDecimals = facts?.response.tokenDecimals ?? 6;
  if (facts) events.push(...creatorSoldEvents(facts.creatorTrades.map((trade) => ({ signature: trade.signature, at: trade.at, side: trade.side, tokensRaw: trade.tokensRaw, pairRaw: trade.pairRaw })), BigInt(facts.supplyRaw)));

  const receipts = await autopilotReceipts(deps.store, deps.network.cluster, token);
  for (const receipt of receipts) {
    events.push(journalEvent({ kind: receipt.kind, at: receipt.at, signature: receipt.signature, actor: receipt.actor, pairRaw: receipt.pairRaw, tokensRaw: receipt.tokensRaw, priceLow: receipt.priceLow, priceHigh: receipt.priceHigh }));
  }

  /* A graduation without a receipt yet: the graduated pool's first transaction, when the market found it and it is the curve's migration. */
  const migrated = facts?.response.progress.migrated ?? false;
  if (migrated && !receipts.some((receipt) => receipt.kind === "GRADUATED")) {
    const first = facts?.graduated ?? null;
    const read = first ? await transactionOf(deps.connection, second, first.signature) : null;
    if (first && read && !read.failed && isMigration(read.logs)) {
      const threshold = facts?.response.progress.thresholdRaw ?? null;
      events.push(journalEvent({ kind: "GRADUATED", at: read.at ?? new Date(first.at * 1000).toISOString(), signature: first.signature, actor: graduationActor(read.feePayer, launchExecutorAddress(deps.network)), pairRaw: threshold }));
    } else complete = false;
  }

  /* The ladder as it stands, read from its position now; there but unread is said, never hidden. */
  let floor: LaunchFloorView | null = null;
  let floorUnread = false;
  const stored = await floorRecord(deps.store, deps.network.cluster, token);
  if (stored?.state === "PLACED" && stored.pool && stored.position) {
    /* The DLMM client is loaded only for a token that has the liquidity. */
    const { createFloorVenue } = await import("../core/venues/meteora-dlmm/floor.server.ts");
    const steps = await createFloorVenue({ connection: deps.connection, cluster: deps.network.cluster })
      .readSteps(stored.pool, stored.position)
      .catch(() => null);
    if (!steps) floorUnread = true;
    else if (BigInt(steps.pairRaw) > 0n || BigInt(steps.tokenRaw) > 0n) {
      floor = {
        pool: stored.pool,
        position: stored.position,
        pairRaw: steps.pairRaw,
        tokensRaw: steps.tokenRaw,
        priceLow: priceOfBin(steps.lowerBinId, FLOOR_RULE.binStep, tokenDecimals, pair.decimals),
        priceHigh: priceOfBin(steps.upperBinId, FLOOR_RULE.binStep, tokenDecimals, pair.decimals),
        placedRaw: stored.placedRaw,
        observedAt: deps.now().toISOString(),
      };
    }
  }

  /* The newest first; an answer gives the newest 200 and says how many the log holds. The marks: the oldest first, the newest 200. */
  const entries = journal(events);
  /* Marks not read now: the log says it is incomplete rather than show none. */
  const read = await journalMarks(deps.store, deps.network.cluster, token).catch(() => null);
  if (read === null) complete = false;
  const marks = (read ?? []).slice(-200);
  return {
    network: deps.network.chain,
    token,
    pair: { mint: record.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
    tokenDecimals,
    executor: launchExecutorAddress(deps.network),
    events: entries.slice(0, 200).map((entry): LaunchJournalEventView => ({ ...entry, enforcement: JOURNAL_ENFORCEMENT[entry.kind] })),
    total: entries.length,
    complete,
    floor,
    floorUnread,
    marks: [...marks],
    observedAt: deps.now().toISOString(),
  };
}
