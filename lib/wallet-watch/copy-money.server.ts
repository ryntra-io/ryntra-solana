/**
 * «Повторюй за гаманцем» with money: the copy at work, its start and its stop. The decisions are the pure half's
 * (`./copy-money.ts`); here they meet the chain, the agent's signer and the book.
 *
 * One pass (`runCopyMoneyPass`), for each copy at work on the network, in this order:
 * 1. **the order on its way** — a trade signed and sent is read back from the chain first (`fateOf`); until the chain has
 *    answered, nothing new is built;
 * 2. **the freeze** — her own switch (`../mandate/freeze.server.ts`, the same key as every agent of hers): frozen, or a
 *    switch not read, and the copy starts nothing; the record carries her freeze too, and the compare-and-set
 *    that writes an order down reads it (`raceOf`) — a freeze written while an order was signed sends nothing;
 * 3. **the mandate** — a buy's policy gone from the chain is a stop: the copy is marked so and left;
 * 4. **the leader's trades** → misses written down, and at most **one order a minute**: a buy of her trade's size — when
 *    the price now (the venue's own quote of that size) is within her bound of the leader's, and what the
 *    vault holds of the coin with what it sold of it in the last day stays within the coin's day — or a sale of the
 *    leader's share of what the vault holds of the coin, within what the coin's day has left, under the sale's policy of
 *    that coin's group;
 * 5. **written before it is sent** — the order goes into the book with its signature before the network sees it
 *    (`agentTrade`'s `beforeSend`): a book that did not take it sends nothing, and neither does a book that has
 *    moved on meanwhile — the trade handled by another pass, an order on its way, the minute not over (`raceOf`). A trade
 *    the agent's signer refuses, or the chain, is written with its reason and never retried; **the day's cap** counts
 *    every buy signed that day.
 *
 * Every swap goes with the chain's ceiling for an agent's trade, 1 % (`COPY_SWAP_SLIPPAGE_BPS`): her bound (1, 5 or 15 %)
 * decides whether to buy at all, never how far the swap may slip — on a thin pool a copy may fail on chain, and is
 * written down so.
 *
 * One pass at a time over a network's book (`copyPassKey`), at most `COPY_PASS_MAX` turns
 * and none begun past `COPY_PASS_MS`; her bounds — one copy of a wallet, `COPY_MONEY_PER_OWNER` at most — kept where her
 * copy is written (`registerCopy`), under her own hold; a start that landed only in part kept as under way
 * (`copyPendingKey`) — to finish (`reviewCopyFinish`) or to take home — and what stands after a stop read (`copyStanding`).
 *
 * Nothing here reads an
 * environment or holds a key — the key is handed in, as the agent's own (`../mandate/agent-service.server.ts`).
 */

import { createHash, randomUUID } from "node:crypto";

import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createHarvestWithheldTokensToMintInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { PublicKey, VersionedTransaction, type Connection, type TransactionInstruction } from "@solana/web3.js";

import type { GuardStore, GuardVersionedRecord } from "../guard/store.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { AGENT_BOOK } from "../mandate/book.server.ts";
import { budgetFund, type AgentBudget } from "../mandate/budget.ts";
import { agentFeeAccount, agentFeeRaw, feeAccountRefusal, feeTransferInstruction, pairFeeBps, uncataloguedFacts, type FeeSides } from "../mandate/fee.ts";
import { freezeKey, isFrozen, type FreezeRow } from "../mandate/freeze.server.ts";
import { fits, planStop, planWithdraw, planEnable, tokenAccountOf, unsignedTransaction, type Mandate } from "../mandate/human.ts";
import { heldIn } from "../mandate/result.ts";
import { agentTrade, fateOf, policyOf, type TradeOutcome } from "../mandate/run.server.ts";
import { storeScreen, type AgentScreen, type CoinOrigin } from "../mandate/ryntra-coins.server.ts";
import { chainSeconds, coinForBudget, onNetwork, type DayCoins, type MandateGate } from "../mandate/service.server.ts";
import { mandateSigner, type AgentJournal } from "../mandate/signer.server.ts";
import { NATIVE_MINT, SSA_PROGRAM_ID, TOKEN_PROGRAM_ID, nextPolicySeed, ownerExecuteInstruction, readPolicyHead, readProgramConfig, readSettings, refusalOf, ssaAddress } from "../mandate/ssa.ts";
import { COPY_COINS_MAX, copyChunkOf, copyChunks, copyDailyMax, copyWorstDay, heldAccountOf, proceedsAccountOf, type CopyCoin } from "../mandate/terms.ts";
import { ALLOWED_MINT_EXTENSIONS, EXTENSION, STOCK_MINT_EXTENSIONS, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAMS, mintExtensions, pausedNow, type MintExtension } from "../mandate/token-2022.ts";
import type { VenueBuy } from "../mandate/tick.server.ts";
import { WALLET_WATCH_COLLECTION } from "./store.ts";
import type { WalletTrade } from "./trades.ts";
import {
  COPY_DAY_ORDERS_MAX,
  COPY_ORDER_EVERY_MS,
  COPY_SLOT_MARGIN,
  COPY_SWAP_SLIPPAGE_BPS,
  copyActedKeys,
  copyDayOrders,
  copyCoinRoom,
  copyCoinSold,
  copyDayOf,
  copyMandateOf,
  copyMoneyKey,
  copyRowOf,
  leaderLamportsPerUnit,
  leaderTradeKey,
  missedOrder,
  nextCopySteps,
  orderDue,
  parseCopyRow,
  pastCopyBound,
  unsettledOrder,
  withOrders,
  type CopyMoneyMiss,
  type CopyMoneyRow,
  type CopyOrder,
} from "./copy-money.ts";

type Row = GuardVersionedRecord & Record<string, unknown>;
const rows = (store: GuardStore) => store.versioned<Row>(WALLET_WATCH_COLLECTION);

/** The copies with money on a network. Throws when the store does not answer. */
export async function listCopyRows(store: GuardStore, cluster: string): Promise<readonly CopyMoneyRow[]> {
  return (await rows(store).valuesWithPrefix(`copy-money:${cluster}:`)).flatMap((row) => {
    const parsed = parseCopyRow(row);
    return parsed && parsed.cluster === cluster ? [parsed] : [];
  });
}

export async function readCopyRow(store: GuardStore, cluster: string, policy: string): Promise<CopyMoneyRow | null> {
  const parsed = parseCopyRow(await rows(store).get(copyMoneyKey(cluster, policy)));
  return parsed && parsed.cluster === cluster && parsed.mandate.policy === policy ? parsed : null;
}

/**
 * One change to a copy by compare-and-set, re-read and re-applied on a lost race. `change` — the next row, or null for
 * none; throws when the book does not take it: whoever wrote down an order to send learns it before the network does.
 */
export async function changeCopyRow(store: GuardStore, row: Pick<CopyMoneyRow, "cluster" | "mandate">, change: (current: CopyMoneyRow) => CopyMoneyRow | null): Promise<CopyMoneyRow> {
  const key = copyMoneyKey(row.cluster, row.mandate.policy);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readCopyRow(store, row.cluster, row.mandate.policy);
    if (!current) throw new Error("the copy is not in the book");
    const next = change(current);
    if (!next) return current;
    const written = { ...next, version: current.version + 1 };
    if (await rows(store).compareAndSet(key, current.version, written as unknown as Row)) return written;
  }
  throw new Error("the book did not take the copy's change");
}

/* ------------------------------------------------------------- One holder at a time */

/** A short hold on a key of the book: who holds it and until when, ms; a hold past its time is anyone's to take. */
type LeaseRecord = GuardVersionedRecord & Readonly<{ schema: "ryntra.wallet-watch.copy-lease"; holder: string; until: number }>;

/**
 * Take the hold on `key` for `ms`, by compare-and-set: false while another holder's hold stands. Throws when the
 * book does not answer — whoever asked does nothing it would have held the key for.
 */
export async function takeCopyLease(store: GuardStore, key: string, holder: string, nowMs: number, ms: number): Promise<boolean> {
  const current = (await rows(store).get(key)) as unknown as LeaseRecord | undefined;
  if (current && current.holder !== holder && current.until > nowMs) return false;
  const next: LeaseRecord = { schema: "ryntra.wallet-watch.copy-lease", version: (current?.version ?? 0) + 1, holder, until: nowMs + ms };
  return rows(store).compareAndSet(key, current?.version ?? null, next as unknown as Row);
}

/** Give the hold back, only when it is still this holder's. */
export async function dropCopyLease(store: GuardStore, key: string, holder: string): Promise<void> {
  const current = (await rows(store).get(key)) as unknown as LeaseRecord | undefined;
  if (!current || current.holder !== holder) return;
  await rows(store).compareAndSet(key, current.version, { ...current, version: current.version + 1, until: 0 } as unknown as Row);
}

/** The network's one pass at a time. Not under `copy-money:<cluster>:` — never read as a copy. */
export const copyPassKey = (cluster: string) => `copy-money-pass:${cluster}`;
/** One owner's start written at a time — her copies' bounds are read and kept under it. */
export const copyOwnerKey = (cluster: string, owner: string) => `copy-money-owner:${cluster}:${owner}`;

/* ------------------------------------------------------------- the venues */

/** What a copy trades through: the agent's buy and sale, what landed, and how many of a coin a sum buys now. */
export type CopyVenue = Readonly<{
  /** The vault's buy of `coin` with `amount` of its budget into `receiver` — the vault's own account of the coin; built, not sent. */
  buy(mandate: Mandate, amount: bigint, receiver: PublicKey, coin: PublicKey): Promise<VenueBuy>;
  /** The vault's sale of `amount` of `coin` into her own account of the budget's token; built, not sent. */
  sell(mandate: Mandate, amount: bigint, coin: PublicKey): Promise<VenueBuy>;
  received(signature: string, receiver: PublicKey): Promise<bigint | null>;
  /** Base units of `coin` that `lamports` of the budget buy at the venue now; throws when not read. */
  unitsFor(mandate: Mandate, coin: PublicKey, lamports: bigint): Promise<bigint>;
}>;

/**
 * Mainnet: Jupiter's route for the vault (`../mandate/jupiter.server.ts`), its quote of her trade in the coin. `selection` —
 * Jupiter's endpoint and key, the deployment's own when not handed in (the fork rehearsal hands in the public one).
 */
export async function jupiterCopyVenue(
  connection: Connection,
  dependencies: Parameters<typeof import("../mandate/jupiter.server.ts").jupiterVenue>[2] & Readonly<{ selection?: import("../solana/quotes.ts").JupiterSwapEndpointSelection }> = {},
): Promise<CopyVenue> {
  const [{ jupiterVenue, jupiterWorth }, { resolveJupiterSwapEndpoint }] = await Promise.all([import("../mandate/jupiter.server.ts"), import("../solana/quotes.ts")]);
  const selection = dependencies.selection ?? resolveJupiterSwapEndpoint();
  const venue = jupiterVenue(connection, selection, dependencies);
  return {
    buy: venue.buy,
    sell: (mandate, amount, coin) => venue.sell!(mandate, amount, coin),
    received: venue.received,
    unitsFor: (mandate, coin, lamports) => jupiterWorth({ coin: mandate.terms.budgetMint, budgetMint: coin, amount: lamports }, selection, dependencies),
  };
}

/**
 * Devnet: each coin of her copy through its own pool (`CopyCoin.pool`), as the agent's devnet venue goes through the gate's
 * (`../mandate/agent-service.server.ts` `dlmmVenue`): Ryntra's fee the table's share, a transfer just before the swap — of
 * the budget on a buy, of the coin on a sale; a coin of Token only.
 */
export function dlmmCopyVenue(connection: Connection, dependencies: Readonly<{ DLMM?: unknown }> = {}): CopyVenue {
  const dlmm = () => import("../mandate/dlmm.server.ts");
  const poolOf = (mandate: Mandate, coin: PublicKey): PublicKey => {
    const pool = mandate.terms.copyCoins?.find((entry) => entry.mint.equals(coin))?.pool;
    if (!pool) throw new Error("the copy names no pool for this coin");
    return pool;
  };
  const deps = dependencies as Parameters<typeof import("../mandate/dlmm.server.ts").dlmmBuy>[2];
  const plainCoin = async (coin: PublicKey) => {
    const mint = await connection.getAccountInfo(coin, "confirmed");
    if (!mint || !mint.owner.equals(TOKEN_PROGRAM_ID) || mint.data.length <= 44) throw new Error("the agent does not trade this coin: on devnet's pools only a coin of Token");
    return mint.data[44]!;
  };
  return {
    async buy(mandate, amount, receiver, coin) {
      await plainCoin(coin);
      const budget = mandate.terms.budgetMint.toBase58();
      const feeSides: FeeSides = { input: uncataloguedFacts(budget), output: uncataloguedFacts(coin.toBase58()), nowMs: Date.now() };
      const feeBps = pairFeeBps(budget, coin.toBase58(), feeSides);
      if (feeBps === null) throw new Error("the agent does not trade this pair: Ryntra's table names no router fee for it");
      const feeAccount = feeAccountRefusal(await connection.getAccountInfo(agentFeeAccount(mandate.terms.budgetMint), "confirmed"), mandate.terms.budgetMint);
      if (feeAccount) throw new Error(feeAccount);
      const fee = agentFeeRaw(amount, feeBps);
      const swap = await (await dlmm()).dlmmBuy(connection, { pool: poolOf(mandate, coin), budgetMint: mandate.terms.budgetMint, vault: mandate.vault, budgetAccount: mandate.budgetAccount, receiver, amount: amount - fee, slippageBps: mandate.terms.slippageBps }, deps);
      const opened = (await connection.getAccountInfo(receiver, "confirmed")) !== null;
      return {
        instruction: swap.instruction,
        fee: feeTransferInstruction({ budgetMint: mandate.terms.budgetMint, budgetAccount: mandate.budgetAccount, vault: mandate.vault, fee, decimals: 9 }),
        feeSides,
        setup: opened ? [] : [createAssociatedTokenAccountIdempotentInstruction(mandate.terms.agent, receiver, mandate.vault, coin, TOKEN_PROGRAM_ID)],
        promisedOut: swap.quoteOut,
      };
    },
    async sell(mandate, amount, coin) {
      const decimals = await plainCoin(coin);
      const feeSides: FeeSides = { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(mandate.terms.budgetMint.toBase58()), nowMs: Date.now() };
      const feeBps = pairFeeBps(coin.toBase58(), mandate.terms.budgetMint.toBase58(), feeSides);
      if (feeBps === null) throw new Error("the agent does not trade this pair: Ryntra's table names no router fee for it");
      const feeAccount = feeAccountRefusal(await connection.getAccountInfo(agentFeeAccount(coin), "confirmed"), coin);
      if (feeAccount) throw new Error(feeAccount);
      const fee = agentFeeRaw(amount, feeBps);
      const coinAccount = heldAccountOf(mandate.vault, { mint: coin, program: TOKEN_PROGRAM_ID });
      const receiver = proceedsAccountOf(mandate.terms);
      const swap = await (await dlmm()).dlmmBuy(connection, { pool: poolOf(mandate, coin), budgetMint: coin, vault: mandate.vault, budgetAccount: coinAccount, receiver, amount: amount - fee, slippageBps: mandate.terms.slippageBps }, deps);
      const hers = (await connection.getAccountInfo(receiver, "confirmed")) !== null;
      return {
        instruction: swap.instruction,
        fee: feeTransferInstruction({ budgetMint: coin, budgetAccount: coinAccount, vault: mandate.vault, fee, decimals }),
        feeSides,
        setup: hers ? [] : [createAssociatedTokenAccountIdempotentInstruction(mandate.terms.agent, receiver, mandate.terms.human, mandate.terms.budgetMint, TOKEN_PROGRAM_ID)],
        promisedOut: swap.quoteOut,
      };
    },
    received: async (signature, receiver) => (await import("../mandate/tick.server.ts")).receivedIn(connection, signature, receiver),
    unitsFor: async (mandate, coin, lamports) => (await dlmm()).dlmmWorth(connection, { pool: poolOf(mandate, coin), budgetMint: coin, amount: lamports }, deps),
  };
}

/* ------------------------------------------------------------- the pass */

export type CopyPassDeps = Readonly<{
  store: GuardStore;
  cluster: "devnet" | "mainnet";
  connection: Connection;
  /** The agent's key, as every agent of Ryntra's (`KeySigner`): it signs bytes and never hands its key out. */
  key: KeySigner;
  /** The agent's address: the one signer of her policies. */
  agent: PublicKey;
  journal: AgentJournal;
  venue: CopyVenue;
  /** The leader's trades, newest first, as the wallet watch reads them; null — not read this pass. */
  readLeader: (leader: string) => Promise<readonly WalletTrade[] | null>;
  screen?: AgentScreen;
  now?: () => number;
  /** The one trade, end to end (`../mandate/run.server.ts` `agentTrade`); the tests hand in their own chain. */
  trade?: typeof agentTrade;
}>;

/** `later` — not this pass's turn (past its count or its time); the next minute's. */
export type CopyPassLine = Readonly<{ policy: string; did: "bought" | "sold" | "failed" | "refused" | "missed" | "settled" | "waited" | "frozen" | "unread" | "stopped" | "idle" | "later" }>;

/** What a sent order became, by the chain's answer. */
function settledOrder(order: CopyOrder, outcome: TradeOutcome, received: bigint | null): CopyOrder {
  switch (outcome.status) {
    case "landed":
      return outcome.ok ? { ...order, status: "ok", signature: outcome.signature, receivedRaw: received === null ? null : received.toString(), reason: null } : { ...order, status: "failed", signature: outcome.signature, reason: outcome.refusal?.reason ?? "failed on chain" };
    case "refused-in-simulation":
      return { ...order, status: "failed", reason: outcome.reason.slice(0, 240) };
    case "refused-by-agent":
      return { ...order, status: "refused", reason: outcome.reason.slice(0, 240) };
    case "unknown":
      return { ...order, status: "sent", signature: outcome.signature, validUntilHeight: outcome.validUntilHeight };
  }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 240);
/** A venue's refusal of the coin itself (its features, Ryntra's own launch, no fee) — not of a route that may come back. */
const coinRefused = (reason: string) => /does not trade (this coin|this pair)|not a coin|launched on Ryntra|own coin/.test(reason);

/** The order on its way, read back: settled, or still the chain's to answer. */
async function settle(deps: CopyPassDeps, row: CopyMoneyRow, order: CopyOrder, mandate: Mandate): Promise<"settled" | "waited"> {
  const fate = await fateOf(deps.connection, order.signature!);
  if (fate.state === "unread") return "waited";
  let next: CopyOrder;
  if (fate.state === "landed") {
    const receiver = order.side === "buy" ? heldAccountOf(mandate.vault, mandate.terms.copyCoins!.find((coin) => coin.mint.toBase58() === order.mint)!) : proceedsAccountOf(mandate.terms);
    const received = fate.ok ? await deps.venue.received(order.signature!, receiver).catch(() => null) : null;
    next = fate.ok ? { ...order, status: "ok", receivedRaw: received === null ? null : received.toString() } : { ...order, status: "failed", reason: refusalOf(fate.logs)?.reason ?? "failed on chain" };
  } else {
    /* None on chain: it may still land until its blockhash ends — then it never will. */
    const height = await deps.connection.getBlockHeight("confirmed").catch(() => null);
    if (height === null || order.validUntilHeight === undefined || height <= order.validUntilHeight) return "waited";
    next = { ...order, status: "failed", reason: "did not land" };
  }
  await changeCopyRow(deps.store, row, (current) => ({ ...current, orders: current.orders.map((entry) => (entry.signature === order.signature && entry.status === "sent" ? next : entry)), updatedAt: new Date((deps.now ?? Date.now)()).toISOString() }));
  return "settled";
}

/** The book moved on while the order was signed (`raceOf`) — nothing is sent, and the order is another pass's. */
class CopyRaceLost extends Error {}

/**
 * Why the book, as it stands now, no longer lets this order of the leader's trade go out; null when it does.
 * Read again inside the compare-and-set that writes the order down before it is sent, so two passes that raced for the same
 * trade, or for the same minute, never both send: the copy stopped, an order on its way, the minute not over, another order
 * out since the pass read the book (`lastOrderAt` — its numbers, the coin's day and her day's cap, are no longer the
 * book's), the trade handled already. And her freeze — the record's own mark (`setCopyFrozen` writes it by
 * compare-and-set before her stop is reviewed), so an order is either in the book her stop reads, or never sent.
 */
export function raceOf(current: CopyMoneyRow, trade: Pick<WalletTrade, "signature" | "mint" | "side" | "slot">, nowMs: number, readLastOrderAt?: number | null): string | null {
  if (current.status !== "working") return "the copy is stopped";
  if (current.frozen) return "the copy is frozen";
  if (unsettledOrder(current)) return "an order is on its way";
  if (!orderDue(current, nowMs)) return "the minute is not over";
  if (readLastOrderAt !== undefined && current.lastOrderAt !== readLastOrderAt) return "another order went out meanwhile";
  const key = leaderTradeKey(trade);
  if (current.seen.includes(key) || copyActedKeys(current).has(key) || trade.slot < (current.throughSlot ?? 0) - COPY_SLOT_MARGIN) return "the trade is handled";
  return null;
}

/** One copy's turn in a pass. */
async function copyTurn(deps: CopyPassDeps, row: CopyMoneyRow): Promise<CopyPassLine["did"]> {
  const now = deps.now ?? Date.now;
  const mandate = copyMandateOf(row, deps.agent);
  const policy = row.mandate.policy;
  const iso = () => new Date(now()).toISOString();
  const sent = unsettledOrder(row);
  if (sent) return settle(deps, row, sent, mandate);
  /* Her switch: frozen — or not read, which is never taken as off; or the record's own mark of her freeze. */
  if (row.frozen || (await isFrozen(deps.store, deps.cluster, policy).catch(() => true))) return "frozen";
  /* Her buy's policy gone from the chain: she stopped the copy — marked so and left. A read that failed says nothing. */
  const standing = await deps.connection.getAccountInfo(mandate.policy, "confirmed").then((info) => ({ info }), () => null);
  if (!standing) return "unread";
  if (!standing.info) {
    await changeCopyRow(deps.store, row, (current) => ({ ...current, status: "stopped", updatedAt: iso() }));
    return "stopped";
  }
  const trades = await deps.readLeader(row.leader).catch(() => null);
  if (!trades) return "unread";
  const steps = nextCopySteps(row, trades, now());
  if (!steps.length) return "idle";
  const misses: CopyOrder[] = [];
  const handled: string[] = [];
  /* The newest slot of the trades handled now — the book keeps the highest, and nothing under it is handled again. */
  let through: number | undefined;
  for (const step of steps) {
    if (step.kind === "miss") misses.push(missedOrder(step, row, now()));
    if (step.kind === "nothing") handled.push(leaderTradeKey(step.trade));
    if (step.kind === "miss" || step.kind === "nothing") through = Math.max(through ?? 0, step.trade.slot);
  }
  const order = steps.at(-1)!;
  /*
   * Every change is made to the book as it stands now: a miss another pass wrote already is not written twice,
   * and the order itself — `guard` — is refused (`CopyRaceLost`) once the book has moved on.
   */
  const write = (extra: readonly CopyOrder[] = [], more: readonly string[] = [], options: Readonly<{ stamp?: boolean; slot?: number; guard?: boolean }> = {}) =>
    changeCopyRow(deps.store, row, (current) => {
      if (options.guard) {
        const lost = raceOf(current, order.trade, now(), row.lastOrderAt);
        if (lost) throw new CopyRaceLost(lost);
      }
      const fresh = misses.filter((entry) => !current.seen.includes(entry.key));
      const slot = options.slot === undefined ? through : Math.max(through ?? 0, options.slot);
      return { ...withOrders(current, [...fresh, ...extra], iso(), [...handled, ...more], slot), ...(options.stamp ? { lastOrderAt: now() } : {}) };
    });
  if (order.kind !== "buy" && order.kind !== "sell") {
    await write();
    return misses.length ? "missed" : "idle";
  }
  /* One order a minute: the misses are written now, the order waits for its minute. */
  if (!orderDue(row, now())) {
    if (misses.length || handled.length) await write();
    return "waited";
  }
  const coin = order.coin;
  const vaultCoin = heldAccountOf(mandate.vault, coin);
  const slot = order.trade.slot;
  const base = { key: leaderTradeKey(order.trade), side: order.trade.side, mint: order.trade.mint, at: now(), leaderAt: order.trade.at ?? 0, dayN: copyDayOf(row, now()), signature: null, receivedRaw: null, reason: null } as const;
  const miss = async (missed: CopyMoneyMiss, reason: string | null) => {
    await write([missedOrder({ trade: order.trade, missed, reason }, row, now())], [], { slot });
    return "missed" as const;
  };
  /* The day's own orders are counted whatever the misses — at most so many in a day. */
  if (copyDayOrders(row, now()) >= COPY_DAY_ORDERS_MAX) return miss("full", "the copy's day of orders is full");
  /* What the vault holds of the coin now: a read that failed says nothing — never «none to sell». */
  const held = await deps.connection.getAccountInfo(vaultCoin, "confirmed").then((info) => heldIn(info?.data), () => null);
  if (held === null) return "unread";
  let amount: bigint;
  let built: VenueBuy;
  let salePolicy: PublicKey | undefined;
  if (order.kind === "buy") {
    amount = order.amount;
    /* Her bound: the price now — the venue's own quote of her trade — within it of the leader's own, or no buy. */
    const units = await deps.venue.unitsFor(mandate, coin.mint, amount).catch(() => null);
    if (units === null) return "unread";
    if (pastCopyBound(amount, units, leaderLamportsPerUnit(order.trade), row.boundPct)) return miss("drift", null);
    /*
     * What the vault holds of the coin, with what it sold of it in the last day, stays within the coin's day —
     * so every exit of the copy fits the chain's limit of the coin, in one day.
     */
    if (held + copyCoinSold(row, coin.mint.toBase58(), now()) + units > coin.dailyMax) return miss("full", "the vault holds what the coin's day lets out");
    try {
      built = await deps.venue.buy(mandate, amount, vaultCoin, coin.mint);
    } catch (error) {
      const reason = reasonOf(error);
      return miss(coinRefused(reason) ? "coin" : "route", reason);
    }
  } else {
    const share = order.shareBps >= 10_000 ? held : (held * BigInt(order.shareBps)) / 10_000n;
    /* Nothing of the coin in the vault: the leader's sale is handled, nothing to sell. */
    if (share <= 0n) {
      await write([], [base.key], { slot });
      return misses.length ? "missed" : "idle";
    }
    /* Within what the coin's day has left — what is over it stays in her vault, for the leader's next sale or her stop. */
    const room = copyCoinRoom(row, coin, now());
    if (room <= 0n) return miss("full", "the coin's day of sales is spent");
    amount = share < room ? share : room;
    salePolicy = mandate.salePolicies![copyChunkOf(mandate.terms.copyCoins!, coin.mint)!];
    try {
      built = await deps.venue.sell(mandate, amount, coin.mint);
    } catch (error) {
      const reason = reasonOf(error);
      return miss(coinRefused(reason) ? "coin" : "route", reason);
    }
  }
  const pending: CopyOrder = { ...base, amountRaw: amount.toString(), status: "sent" };
  const signer = mandateSigner(deps.key, { mandate, policy: policyOf(mandate), journal: deps.journal, screen: deps.screen ?? storeScreen(deps.store, deps.cluster) });
  let outcome: TradeOutcome;
  try {
    outcome = await (deps.trade ?? agentTrade)({
      connection: deps.connection,
      mandate,
      signer,
      venueInstruction: built.instruction,
      promisedOut: built.promisedOut,
      feeSides: built.feeSides,
      fee: built.fee,
      setup: built.setup,
      lookupTables: built.lookupTables ?? [],
      coin: built.coin,
      epoch: built.epoch,
      side: order.kind,
      ...(salePolicy ? { salePolicy } : {}),
      /* Written down with its signature before the network sees it — into the book as it stands then: a book that does not take it, or has moved on, sends nothing. */
      beforeSend: async ({ signature, validUntilHeight }) => void (await write([{ ...pending, signature, validUntilHeight }], [], { stamp: true, slot, guard: true })),
    });
  } catch (error) {
    /* Another pass took this trade, or the minute, while it was signed — nothing was sent. */
    if (error instanceof CopyRaceLost) return "waited";
    throw error;
  }
  const receiver = order.kind === "buy" ? vaultCoin : proceedsAccountOf(mandate.terms);
  const received = outcome.status === "landed" && outcome.ok ? await deps.venue.received(outcome.signature, receiver).catch(() => null) : null;
  const final = settledOrder(pending, outcome, received);
  await changeCopyRow(deps.store, row, (current) => {
    /* Written before it was sent: the chain's answer takes the place of «sent». */
    if (current.orders.some((entry) => entry.key === final.key && entry.at === final.at && entry.status === "sent")) {
      return { ...current, orders: current.orders.map((entry) => (entry.key === final.key && entry.at === final.at && entry.status === "sent" ? { ...final, validUntilHeight: entry.validUntilHeight ?? final.validUntilHeight } : entry)), updatedAt: iso() };
    }
    /* Another pass handled the trade meanwhile — its own record stands. */
    if (current.seen.includes(final.key)) return null;
    /* Refused before the network: written now, and the minute counts — no retry of a refusal in a loop. */
    const fresh = misses.filter((entry) => !current.seen.includes(entry.key));
    return { ...withOrders(current, [...fresh, final], iso(), handled, Math.max(through ?? 0, slot)), lastOrderAt: now() };
  });
  if (final.status === "refused") return "refused";
  if (final.status === "failed") return "failed";
  return order.kind === "buy" ? "bought" : "sold";
}

/** The copies one pass takes at most; the rest are the next minute's, the turn going round (`copyPassOrder`). */
export const COPY_PASS_MAX = 40;
/** Past this since its start, ms, a pass starts no new turn — the cron's minute is 60 s, and a turn under way ends. */
export const COPY_PASS_MS = 40_000;
/** How long a pass holds the network, ms — past the cron's own 60 s, so a pass cut off frees it a minute on. */
export const COPY_PASS_LEASE_MS = 90_000;

/**
 * The copies in the order a pass takes them: from a place that moves on by `max` every minute, so a book larger
 * than a pass is taken whole within a few minutes and no copy waits behind the same others every time.
 */
export function copyPassOrder<T>(list: readonly T[], nowMs: number, max: number = COPY_PASS_MAX): readonly T[] {
  if (!list.length) return [];
  const start = (Math.floor(nowMs / COPY_ORDER_EVERY_MS) * max) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}

/**
 * One pass over the copies with money on the network: each its turn, a copy that throws never stops the others.
 * One pass at a time (`copyPassKey`, held for `COPY_PASS_LEASE_MS`) — null while another holds it, and nothing is read; at
 * most `COPY_PASS_MAX` turns and none begun past `COPY_PASS_MS`, the rest said `later`.
 */
export async function runCopyMoneyPass(deps: CopyPassDeps): Promise<readonly CopyPassLine[] | null> {
  const now = deps.now ?? Date.now;
  const key = copyPassKey(deps.cluster);
  const holder = randomUUID();
  if (!(await takeCopyLease(deps.store, key, holder, now(), COPY_PASS_LEASE_MS))) return null;
  try {
    const started = now();
    const working = (await listCopyRows(deps.store, deps.cluster)).filter((row) => row.status === "working");
    const lines: CopyPassLine[] = [];
    let taken = 0;
    for (const row of copyPassOrder(working, started)) {
      if (taken >= COPY_PASS_MAX || now() - started >= COPY_PASS_MS) {
        lines.push({ policy: row.mandate.policy, did: "later" });
        continue;
      }
      taken += 1;
      const did = await copyTurn(deps, row).catch(() => "unread" as const);
      lines.push({ policy: row.mandate.policy, did });
    }
    return lines;
  } finally {
    await dropCopyLease(deps.store, key, holder).catch(() => undefined);
  }
}

/* ------------------------------------------------------------- her switches: freeze */

/**
 * Her freeze for the copy: on — the copy starts nothing new; off — it works again. The same switch as every agent of hers
 * (`../mandate/freeze.server.ts`, the key `f:<cluster>:<policy>`), for a copy of her own wallet. And the copy's
 * own record carries it (`frozen`), written by compare-and-set — the same that writes an order down before it is sent
 * (`raceOf`): once her freeze is in the record, no order of the copy goes out. Frozen while either says so; throws when the
 * book does not take it.
 */
export async function setCopyFrozen(store: GuardStore, input: Readonly<{ cluster: "devnet" | "mainnet"; owner: string; policy: string; frozen: boolean }>, now: () => number = Date.now): Promise<Readonly<{ ok: true; frozen: boolean }> | Readonly<{ ok: false; code: "NOT_FOUND" }>> {
  const row = await readCopyRow(store, input.cluster, input.policy);
  if (!row || row.owner !== input.owner) return { ok: false, code: "NOT_FOUND" };
  const switches = store.collection<FreezeRow>(AGENT_BOOK);
  const key = freezeKey(input.cluster, input.policy);
  const iso = new Date(now()).toISOString();
  if (input.frozen) {
    /* The switch first, then the record, each tried on its own (the lead's review of #1980): a record that lost its races
       never leaves the switch off, and either one frozen holds the copy. A write that failed is still thrown — after both. */
    let failed: unknown = null;
    await switches.set(key, { v: 1, kind: "freeze", cluster: input.cluster, policy: input.policy, owner: input.owner, at: now() }).catch((error: unknown) => {
      failed = error;
    });
    await changeCopyRow(store, row, (current) => (current.frozen ? null : { ...current, frozen: true, updatedAt: iso })).catch((error: unknown) => {
      failed ??= error;
    });
    if (failed !== null) throw failed;
  } else {
    await switches.delete(key);
    await changeCopyRow(store, row, ({ frozen, ...current }) => (frozen ? { ...current, updatedAt: iso } : null));
  }
  return { ok: true, frozen: input.frozen };
}

/* ------------------------------------------------------------- start: review, then the book */

const toBase64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");
const addressOf = (text: string | undefined | null): PublicKey | null => {
  try {
    return text ? new PublicKey(text) : null;
  } catch {
    return null;
  }
};

/**
 * How long a review is said as waiting for her signature, ms — her transactions' blockhash lives far less. A
 * review whose copy stands on chain is taken at any age; one whose copy does not, past this, is said as too old.
 */
export const COPY_REVIEW_KEPT_MS = 15 * 60_000;

/** Where the server keeps the copy it built for her signature, until `registerCopy` reads it back. */
export const copyReviewKey = (cluster: string, policy: string, review: string) => `copy-money-review:${cluster}:${policy}:${review}`;

/** The copy a review built, as the server keeps it: the record, and when it was built. */
type CopyReviewRecord = GuardVersionedRecord & Readonly<{ schema: "ryntra.wallet-watch.copy-review"; row: CopyMoneyRow; at: number }>;

export type CopyReview =
  | Readonly<{
      ok: true;
      /** The review's name — what her start hands back to `registerCopy`; the record itself stays with the server. */
      review: string;
      row: CopyMoneyRow;
      transactions: readonly string[];
      fundLamports: string;
      /** Her copy's worst day with a stolen agent key, lamports — `COPY_WORST_DAYS` × her day's cap, for one coin or ten. */
      worstLamports: string;
      skipped: readonly Readonly<{ mint: string; reason: string }>[];
    }>
  | Readonly<{ ok: false; code: string; reason: string }>;

/**
 * Turn her copy on with money: the person's unsigned transactions (one approval) — her account, the budget, the agent's
 * SOL, the buy's policy and a sale's policy for each group of her coins. Each coin she picked (the leader's, `leaderCoins`)
 * is asked first as every buy asks it (`coinForBudget`: a coin of the token programs with every feature on the agent's
 * list, a pair Ryntra's table names a fee for; not Ryntra's own launch, not hers) and its day read at the venue's quote:
 * a coin refused is left out and said, never signed for. None left — no copy. Each coin's day is its share of
 * the copy's (`copyDailyMax`), so the worst day with a stolen key stays three day's caps however many coins she keeps; the
 * record is kept by the server (`copyReviewKey`) and only that record ever goes into the book.
 */
export async function reviewCopyEnable(
  input: Readonly<{ owner: string; leader: string; budget: AgentBudget; sharePct: number; boundPct: number; coins: readonly Readonly<{ mint: string; pool?: string }>[]; smartAccount?: string | null }>,
  gate: Extract<MandateGate, { open: true }>,
  connection: Connection,
  dependencies: Readonly<{ origin?: (mint: string) => Promise<CoinOrigin>; dayCoins: DayCoins; store: GuardStore; now?: () => number }> & Parameters<typeof coinForBudget>[3],
): Promise<CopyReview> {
  const owner = addressOf(input.owner);
  if (!owner || owner.equals(gate.agent) || !addressOf(input.leader) || input.leader === input.owner) return { ok: false, code: "VALIDATION_ERROR", reason: "Not the wallets of a copy." };
  if (!(await onNetwork(connection, gate.network))) return { ok: false, code: "WRONG_NETWORK", reason: `Not ${gate.network}.` };
  if (!input.coins.length || input.coins.length > COPY_COINS_MAX) return { ok: false, code: "VALIDATION_ERROR", reason: `Pick one to ${COPY_COINS_MAX} coins.` };
  const origin = dependencies.origin ?? storeScreen(dependencies.store, gate.network).origin;
  const read: (Omit<CopyCoin, "dailyMax"> & Readonly<{ units: bigint }>)[] = [];
  const skipped: { mint: string; reason: string }[] = [];
  for (const entry of input.coins) {
    const mint = addressOf(entry.mint);
    if (!mint || read.some((coin) => coin.mint.equals(mint))) continue;
    const seen = await origin(mint.toBase58()).catch(() => null);
    if (!seen) return { ok: false, code: "UNAVAILABLE", reason: "Ryntra's launch registry is not readable." };
    if (seen.launchedHere) {
      skipped.push({ mint: entry.mint, reason: seen.creator === input.owner ? "The agent does not buy your own coin." : "The agent does not buy coins launched on Ryntra." });
      continue;
    }
    const bought = await coinForBudget(mint, gate.network, connection, dependencies);
    if (!bought.ok) {
      if (bought.code === "UNAVAILABLE") return bought;
      skipped.push({ mint: entry.mint, reason: bought.reason });
      continue;
    }
    const units = await dependencies.dayCoins(mint, input.budget.perDay).catch(() => null);
    if (units === null || units <= 0n) {
      skipped.push({ mint: entry.mint, reason: "The coin's price is not readable." });
      continue;
    }
    const pool = gate.network === "devnet" ? addressOf(entry.pool ?? gate.pool.toBase58()) : null;
    read.push({ mint, program: bought.coin.program, units, ...(pool ? { pool } : {}) });
  }
  /* Each coin's day is its share of the copy's; a coin whose share buys none of it is left out — the rest's share only grows. */
  let kept = read;
  for (;;) {
    const short = kept.filter((coin) => (coin.units * 2n) / BigInt(kept.length) <= 0n);
    if (!short.length) break;
    for (const coin of short) skipped.push({ mint: coin.mint.toBase58(), reason: "The coin's price is not readable." });
    kept = kept.filter((coin) => !short.includes(coin));
  }
  if (!kept.length) return { ok: false, code: "REFUSED", reason: "None of these coins is one the agent trades." };
  const coins: CopyCoin[] = kept.map(({ units, ...coin }) => ({ ...coin, dailyMax: copyDailyMax(units, kept.length) }));
  const now = BigInt((await chainSeconds(connection)) ?? Math.floor((dependencies.now ?? Date.now)() / 1000));
  const known = addressOf(input.smartAccount);
  const settingsInfo = known ? await connection.getAccountInfo(known) : null;
  let account: Parameters<typeof planEnable>[0]["account"];
  if (known && settingsInfo && settingsInfo.owner.equals(SSA_PROGRAM_ID)) account = { kind: "present", settings: known, state: readSettings(settingsInfo.data) };
  else {
    const config = await connection.getAccountInfo(ssaAddress.programConfig());
    if (!config) return { ok: false, code: "UNAVAILABLE", reason: "The smart account program is not readable." };
    account = { kind: "absent", config: readProgramConfig(config.data) };
  }
  const fund = budgetFund(input.budget);
  let plan;
  try {
    plan = planEnable({
      cluster: gate.network,
      terms: {
        human: owner,
        agent: gate.agent,
        budgetMint: NATIVE_MINT,
        perTrade: input.budget.perTrade,
        perDay: input.budget.perDay,
        slippageBps: COPY_SWAP_SLIPPAGE_BPS,
        expiresAt: now + BigInt(input.budget.days) * 86_400n,
        venue: gate.network === "mainnet" ? { kind: "jupiter" } : { kind: "dlmm", pool: gate.pool },
        copyCoins: coins,
      },
      account,
      fund,
      nowSeconds: now,
      agentFeeLamports: 10_000_000n,
    });
  } catch (error) {
    return { ok: false, code: "REFUSED", reason: reasonOf(error) };
  }
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const at = (dependencies.now ?? Date.now)();
  const row = copyRowOf({ mandate: plan.mandate, leader: input.leader, sharePct: input.sharePct, boundPct: input.boundPct, nowIso: new Date(at).toISOString() });
  const review = createHash("sha256").update(JSON.stringify({ mandate: row.mandate, owner: row.owner, leader: row.leader, sharePct: row.sharePct, boundPct: row.boundPct, at })).digest("hex").slice(0, 32);
  /* The server keeps what it built; her start names it, and nothing she sends back becomes the record. */
  const record: CopyReviewRecord = { schema: "ryntra.wallet-watch.copy-review", version: 1, row, at };
  try {
    await rows(dependencies.store).set(copyReviewKey(row.cluster, row.mandate.policy, review), record as unknown as Row);
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "The copy's book is not writable." };
  }
  return {
    ok: true,
    review,
    row,
    transactions: plan.transactions.map((instructions) => toBase64(unsignedTransaction(owner, instructions, blockhash))),
    fundLamports: fund.toString(),
    worstLamports: copyWorstDay(input.budget.perDay).toString(),
    skipped,
  };
}

/**
 * Why the copy's record is not what stands on chain; null when it is. The buy's policy carries her trade cap,
 * her day's cap and the vault's own account of the budget's token — the one the record names — and each coin's mint is a
 * mint of the program the record names for it.
 */
export async function copyChainRefusal(row: CopyMoneyRow, agent: PublicKey, connection: Pick<Connection, "getMultipleAccountsInfo">): Promise<string | null> {
  const mandate = copyMandateOf(row, agent);
  const coins = mandate.terms.copyCoins!;
  const chunks = copyChunks(coins);
  if (mandate.salePolicies!.length !== chunks.length) return "the copy's sales do not match its coins";
  if (!mandate.budgetAccount.equals(tokenAccountOf(mandate.vault, mandate.terms.budgetMint))) return "the budget is not the vault's own account of its token";
  const policies = [mandate.policy, ...mandate.salePolicies!];
  const infos = await connection.getMultipleAccountsInfo([mandate.settings, ...policies, ...coins.map((coin) => coin.mint)], "confirmed");
  const settings = infos[0];
  if (!settings || !settings.owner.equals(SSA_PROGRAM_ID) || !readSettings(settings.data).signers.some((signer) => signer.key.equals(mandate.terms.human))) return "not the person's smart account";
  if (!ssaAddress.vault(mandate.settings, 0).equals(mandate.vault)) return "not the account's vault";
  for (const [at, policy] of policies.entries()) {
    const info = infos[at + 1];
    if (!info || !info.owner.equals(SSA_PROGRAM_ID)) return "a policy of the copy is not on chain";
    let head;
    try {
      head = readPolicyHead(info.data);
    } catch {
      return "a policy of the copy is not readable";
    }
    if (!head.settings.equals(mandate.settings) || head.seed !== mandate.policySeed + BigInt(at) || !ssaAddress.policy(mandate.settings, head.seed).equals(policy)) return "a policy of the copy is not at its seed";
    if (head.signers.length !== 1 || !head.signers[0]!.key.equals(agent)) return "a policy of the copy is not for this agent";
    const data = Buffer.from(info.data);
    if (at === 0) {
      if (!data.includes(u64Bytes(mandate.terms.perDay))) return "the buy's policy does not carry her day's cap";
      if (!data.includes(u64Bytes(mandate.terms.perTrade))) return "the buy's policy does not carry her trade cap";
      if (!data.includes(mandate.budgetAccount.toBuffer())) return "the buy's policy does not spend from her budget";
    }
    if (at > 0) {
      for (const coin of chunks[at - 1]!) if (!data.includes(coin.mint.toBuffer()) || !data.includes(u64Bytes(coin.dailyMax))) return "a sale's policy does not name its coin's day";
      if (!data.includes(proceedsAccountOf(mandate.terms).toBuffer())) return "a sale's policy does not pay her own account";
    }
  }
  for (const [at, coin] of coins.entries()) {
    const mint = infos[1 + policies.length + at];
    if (!mint || !mint.owner.equals(coin.program)) return "a coin of the copy is not a mint of the program it names";
  }
  return null;
}

function u64Bytes(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

/**
 * The copy she just signed, into the book — only the record the server built for her signature (`reviewCopyEnable`,
 * named by `review`), only hers, and only once what it names stands on chain for this agent. Its days count from here.
 */
export async function registerCopy(
  input: Readonly<{ cluster: "devnet" | "mainnet"; owner: string; policy: string; review: string }>,
  agent: PublicKey,
  deps: Readonly<{ store: GuardStore; connection: Pick<Connection, "getMultipleAccountsInfo">; now?: () => number }>,
): Promise<Readonly<{ ok: true; row: CopyMoneyRow }> | Readonly<{ ok: false; code: "REFUSED" | "ALREADY" | "LIMIT" | "BUSY"; reason: string }>> {
  const now = (deps.now ?? Date.now)();
  const reviewed = await readCopyReview(deps.store, input);
  if (!reviewed) return { ok: false, code: "REFUSED", reason: "No such copy to start — review it again." };
  const kept = reviewed.row;
  /*
   * The chain first (the review of this branch): what stands on chain is what she signed, however late her start comes back
   * — a wallet on her phone, a page opened again — and a funded copy is never left out of the book for its age. Only a
   * review whose copy is not on chain is too old.
   */
  const refusal = await copyChainRefusal(kept, agent, deps.connection);
  if (refusal) return { ok: false, code: "REFUSED", reason: now - reviewed.at > COPY_REVIEW_KEPT_MS ? "The review is too old — review it again." : `Not a copy for this agent: ${refusal}.` };
  /*
   * Her bounds are kept where the copy is written, not only where it was reviewed — one
   * copy of a wallet, `COPY_MONEY_PER_OWNER` at most — read and written under her own hold (`copyOwnerKey`), so two starts
   * of hers at once never both pass. A start refused here leaves what she signed on chain: her stop from the review takes it
   * home (`../wallet-watch/copy-money-door.server.ts`).
   */
  const ownerKey = copyOwnerKey(input.cluster, input.owner);
  const holder = randomUUID();
  if (!(await takeCopyLease(deps.store, ownerKey, holder, now, COPY_OWNER_LEASE_MS))) return { ok: false, code: "BUSY", reason: "Another start of yours is being written — try again." };
  try {
    const working = (await listCopyRows(deps.store, input.cluster)).filter((row) => row.owner === input.owner && row.status === "working" && row.mandate.policy !== input.policy);
    if (working.some((row) => row.leader === kept.leader)) return { ok: false, code: "ALREADY", reason: "This wallet is copied with money already." };
    if (working.length >= COPY_MONEY_PER_OWNER) return { ok: false, code: "LIMIT", reason: `${COPY_MONEY_PER_OWNER} copies with money at most.` };
    const nowIso = new Date(now).toISOString();
    const row: CopyMoneyRow = { ...kept, since: nowIso, updatedAt: nowIso };
    const written = await rows(deps.store).compareAndSet(copyMoneyKey(row.cluster, row.mandate.policy), null, row as unknown as Row);
    if (!written) return { ok: false, code: "REFUSED", reason: "The copy is in the book already." };
    await rows(deps.store).delete(copyReviewKey(input.cluster, input.policy, input.review)).catch(() => undefined);
    return { ok: true, row };
  } finally {
    await dropCopyLease(deps.store, ownerKey, holder).catch(() => undefined);
  }
}

/** Copies with money one wallet keeps at work at once — the paper copies' own bound. */
export const COPY_MONEY_PER_OWNER = 5;
/** How long her start holds her bounds, ms — a hold left by a start cut off frees itself. */
export const COPY_OWNER_LEASE_MS = 20_000;

/**
 * The copy a review built, as the server keeps it, when it is hers: the record and when it was built; null — no
 * such review of hers. Throws when the book does not answer.
 */
export async function readCopyReview(store: GuardStore, input: Readonly<{ cluster: string; owner: string; policy: string; review: string }>): Promise<Readonly<{ row: CopyMoneyRow; at: number }> | null> {
  const record = (await rows(store).get(copyReviewKey(input.cluster, input.policy, input.review))) as unknown as CopyReviewRecord | undefined;
  const kept = record?.schema === "ryntra.wallet-watch.copy-review" ? parseCopyRow(record.row) : null;
  if (!record || !kept || kept.owner !== input.owner || kept.cluster !== input.cluster || kept.mandate.policy !== input.policy) return null;
  return { row: kept, at: record.at };
}

/* ------------------------------------------------------------- A start that landed only in part */

/**
 * Her start under way, by the server's own hand: written before her signed transactions are relayed, removed
 * once her copy is in the book or nothing of it stands on chain. While it stands, «My bots» lists her start as unfinished —
 * to finish (`reviewCopyFinish`) or to take home (her stop from the review) — whatever the switch: a start whose first
 * transaction landed and whose next did not has its budget in her vault, and no copy in the book.
 */
export const copyPendingKey = (cluster: string, owner: string, policy: string) => `copy-money-pending:${cluster}:${owner}:${policy}`;

export type CopyPending = GuardVersionedRecord &
  Readonly<{
    schema: "ryntra.wallet-watch.copy-pending";
    cluster: "devnet" | "mainnet";
    owner: string;
    policy: string;
    /** The review's name: the server's record of what she signed (`copyReviewKey`). */
    review: string;
    /** Her new smart account: what her first transaction creates — its absence says nothing of hers landed. */
    settings: string;
    /** When the relay began, ms. */
    at: number;
    /** Her stop from the review landed its first transaction: no finishing it any more. */
    stopped?: true;
  }>;

/**
 * How long after her review a transaction she signed for it may still land, ms — her transactions' blockhash is
 * the review's, and lives far less (≈ 150 slots). Past it, a start whose smart account is not hers on chain never will be.
 */
export const COPY_PENDING_SETTLE_MS = 5 * 60_000;

/** Her starts under way on a network. Throws when the book does not answer. */
export async function listCopyPending(store: GuardStore, cluster: string, owner: string): Promise<readonly CopyPending[]> {
  return ((await rows(store).valuesWithPrefix(`copy-money-pending:${cluster}:${owner}:`)) as unknown as CopyPending[]).filter(
    (entry) => entry?.schema === "ryntra.wallet-watch.copy-pending" && entry.owner === owner && entry.cluster === cluster,
  );
}

export async function readCopyPending(store: GuardStore, cluster: string, owner: string, policy: string): Promise<CopyPending | null> {
  const entry = (await rows(store).get(copyPendingKey(cluster, owner, policy))) as unknown as CopyPending | undefined;
  return entry?.schema === "ryntra.wallet-watch.copy-pending" && entry.owner === owner && entry.policy === policy ? entry : null;
}

/** Written before her transactions are relayed: throws when the book does not take it — and then nothing is relayed. */
export async function writeCopyPending(store: GuardStore, row: CopyMoneyRow, review: string, nowMs: number): Promise<void> {
  const entry: CopyPending = { schema: "ryntra.wallet-watch.copy-pending", version: 1, cluster: row.cluster, owner: row.owner, policy: row.mandate.policy, review, settings: row.mandate.settings, at: nowMs };
  await rows(store).set(copyPendingKey(row.cluster, row.owner, row.mandate.policy), entry as unknown as Row);
}

export async function markCopyPending(store: GuardStore, entry: CopyPending, change: Partial<Pick<CopyPending, "stopped">>): Promise<void> {
  await rows(store).set(copyPendingKey(entry.cluster, entry.owner, entry.policy), { ...entry, ...change, version: entry.version + 1 } as unknown as Row);
}

/** Her start under way, done with: its mark, and — when `withReview` — the server's record of what she signed. */
export async function dropCopyPending(store: GuardStore, entry: Pick<CopyPending, "cluster" | "owner" | "policy" | "review">, withReview: boolean): Promise<void> {
  await rows(store).delete(copyPendingKey(entry.cluster, entry.owner, entry.policy));
  if (withReview) await rows(store).delete(copyReviewKey(entry.cluster, entry.policy, entry.review));
}

/**
 * Whether her copy's smart account stands on chain as hers: true; not there, or not hers (another took the
 * account's number before her first transaction landed) — false; null — not read.
 */
export async function copyAccountHers(row: Pick<CopyMoneyRow, "owner" | "mandate">, connection: Pick<Connection, "getAccountInfo">): Promise<boolean | null> {
  const info = await connection.getAccountInfo(new PublicKey(row.mandate.settings), "confirmed").then(
    (found) => ({ found }),
    () => null,
  );
  if (!info) return null;
  return copySettingsHers(info.found, new PublicKey(row.owner));
}

export function copySettingsHers(info: Readonly<{ owner: PublicKey; data: Uint8Array }> | null | undefined, human: PublicKey): boolean {
  if (!info || !info.owner.equals(SSA_PROGRAM_ID)) return false;
  try {
    return readSettings(info.data).signers.some((signer) => signer.key.equals(human));
  } catch {
    return false;
  }
}

/**
 * The rest of her start, once more (the review of #1985's MAJOR): her transactions for what of her copy is not
 * on chain yet, from the server's own record of the review — never a row of hers. Her start lands in order and stops at the
 * first that fails, so what is missing is the last of her policies, at the seeds that follow her smart account's own count:
 * the very instructions her review built (`planEnable` on her account as it stands, nothing moved in), checked to name the
 * same policies. Every policy there — no transaction: her start only writes the book. Nothing of hers on chain — `NOTHING`:
 * she reviews it again.
 */
export async function reviewCopyFinish(
  row: CopyMoneyRow,
  gate: Extract<MandateGate, { open: true }>,
  connection: Pick<Connection, "getMultipleAccountsInfo" | "getLatestBlockhash" | "getSlot" | "getBlockTime">,
): Promise<Readonly<{ ok: true; transactions: readonly string[] }> | Readonly<{ ok: false; code: "UNAVAILABLE" | "NOTHING" | "REFUSED"; reason: string }>> {
  const mandate = copyMandateOf(row, gate.agent);
  const human = mandate.terms.human;
  const policies = [mandate.policy, ...mandate.salePolicies!];
  let infos: readonly (Readonly<{ owner: PublicKey; data: Uint8Array }> | null)[];
  try {
    infos = await connection.getMultipleAccountsInfo([mandate.settings, ...policies], "confirmed");
  } catch {
    return { ok: false, code: "UNAVAILABLE", reason: "Your copy's accounts did not read — try again." };
  }
  if (!copySettingsHers(infos[0], human)) return { ok: false, code: "NOTHING", reason: "Nothing of this start is on chain — review it again." };
  const state = readSettings(infos[0]!.data);
  const standing = policies.map((_policy, at) => infos[at + 1] !== null && infos[at + 1] !== undefined);
  const first = standing.indexOf(false);
  if (first < 0) return { ok: true, transactions: [] };
  if (standing.slice(first).some(Boolean) || nextPolicySeed(state) !== mandate.policySeed + BigInt(first)) return { ok: false, code: "REFUSED", reason: "Your copy's policies are not in order — take it back." };
  const now = BigInt((await chainSeconds(connection)) ?? Math.floor(Date.now() / 1000));
  let plan;
  try {
    plan = planEnable({ cluster: mandate.cluster, terms: mandate.terms, account: { kind: "present", settings: mandate.settings, state: { ...state, policySeed: mandate.policySeed - 1n } }, fund: 0n, nowSeconds: now });
  } catch (error) {
    return { ok: false, code: "REFUSED", reason: reasonOf(error) };
  }
  const sales = mandate.salePolicies!;
  if (!plan.mandate.policy.equals(mandate.policy) || plan.mandate.salePolicies?.length !== sales.length || plan.mandate.salePolicies.some((policy, at) => !policy.equals(sales[at]!))) {
    return { ok: false, code: "REFUSED", reason: "Your copy's policies are not the review's — take it back." };
  }
  /* The buy's policy, with what goes before it (nothing moved in: only her budget's account, opened already), then a sale's each. */
  const head = plan.transactions.slice(0, plan.transactions.length - sales.length);
  const tail = plan.transactions.slice(plan.transactions.length - sales.length);
  const missing = first === 0 ? [...head, ...tail] : tail.slice(first - 1);
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return { ok: true, transactions: missing.map((instructions) => toBase64(unsignedTransaction(human, instructions, blockhash))) };
}

/**
 * What of her copy still stands on chain after a stop: its policies, the budget's account, every token account
 * of the vault (a coin left, or only an account its close did not empty); null — not read. Read once her stop is relayed,
 * each of its transactions confirmed: what it says is what «Take the rest» is for.
 */
export async function copyStanding(
  row: CopyMoneyRow,
  agent: PublicKey,
  connection: Pick<Connection, "getMultipleAccountsInfo" | "getTokenAccountsByOwner">,
): Promise<Readonly<{ buy: boolean; policies: number; budget: boolean; accounts: number; rest: boolean }> | null> {
  const mandate = copyMandateOf(row, agent);
  try {
    const policies = [mandate.policy, ...(mandate.salePolicies ?? [])];
    const [infos, held] = await Promise.all([
      connection.getMultipleAccountsInfo([...policies, mandate.budgetAccount], "confirmed"),
      Promise.all(TOKEN_PROGRAMS.map((programId) => connection.getTokenAccountsByOwner(mandate.vault, { programId }, "confirmed"))),
    ]);
    const standing = policies.filter((_policy, at) => infos[at] !== null && infos[at] !== undefined).length;
    const budget = infos[policies.length] !== null && infos[policies.length] !== undefined;
    const accounts = held.reduce((sum, read) => sum + read.value.filter(({ pubkey }) => !pubkey.equals(mandate.budgetAccount)).length, 0);
    return { buy: infos[0] !== null && infos[0] !== undefined, policies: standing, budget, accounts, rest: standing > 0 || budget || accounts > 0 };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- stop: every policy off, every coin home */

/** How many transactions of coins one stop asks of her at most — her own coins first; the rest, her next stop. */
export const COPY_STOP_COIN_TRANSACTIONS = 10;

/** A coin her stop leaves in her vault, and why: it cannot be moved now. */
export type CopyStopSkip = Readonly<{ mint: string; reason: string }>;

export type CopyStopReview =
  /* `left` — coins her next stop takes home; `unclosed` — emptied accounts it closes (only their rent waits). */
  | Readonly<{ ok: true; transactions: readonly string[]; skipped: readonly CopyStopSkip[]; left: number; unclosed: number }>
  | Readonly<{ ok: false; code: string; reason: string; skipped?: readonly CopyStopSkip[] }>;

/* A token account: its mint, its owner, its amount; its state after the delegate — 2 is frozen. */
const ACCOUNT_BYTES = 165;
const ACCOUNT_STATE_AT = 108;
const STATE_FROZEN = 2;
/* A mint: its decimals, then whether it is initialized, then whether it names a freeze authority. */
const MINT_DECIMALS_AT = 44;
const MINT_INITIALIZED_AT = 45;
const MINT_FREEZE_AT = 46;

const notRead = (what: string): CopyStopReview => ({ ok: false, code: "UNAVAILABLE", reason: `${what} did not read — tap stop again.` });

const FROZEN = "its issuer froze it in your vault";
const UNKNOWN_FEATURE = "it carries a Token-2022 feature the agent does not know";
/** Why a coin's own feature keeps it from moving, or why the agent does not touch one with it — the strict list's own words. */
const FEATURE_REASONS: ReadonlyMap<number, string> = new Map([
  [EXTENSION.NonTransferable, "the coin cannot be moved"],
  [EXTENSION.TransferHook, "the coin runs its issuer's own program on every transfer"],
  [EXTENSION.PausableConfig, "its issuer can stop every transfer of the coin"],
  [EXTENSION.PermanentDelegate, "its issuer can take the coin out of any wallet"],
  [EXTENSION.DefaultAccountState, "its issuer can make new wallets of this coin start frozen"],
  [EXTENSION.ConfidentialTransferMint, "the coin can hide its amounts"],
  [EXTENSION.ConfidentialTransferFeeConfig, "the coin can hide its amounts"],
  [EXTENSION.ConfidentialMintBurn, "the coin can hide its amounts"],
  [EXTENSION.InterestBearingConfig, "the coin's shown amount changes on its own"],
  [EXTENSION.ScaledUiAmountConfig, "the coin's shown amount changes on its own"],
  [EXTENSION.MintCloseAuthority, "its issuer can close the coin itself"],
]);

/**
 * Whether one of her own coins' features, as its bytes stand now, lets the coin move: a coin she signed for passed the
 * agent's list then, a stock of the shelf with its issuer's rights among them — so here a right counts only when it is in
 * use against a transfer. A program on transfers, every transfer paused, new wallets frozen: no.
 */
function ownFeatureMoves(extension: MintExtension, mint: Readonly<{ owner: PublicKey; data: Uint8Array }>): boolean {
  switch (extension.type) {
    case EXTENSION.TransferHook:
      return extension.data.length === 64 && extension.data.subarray(32).every((byte) => byte === 0);
    case EXTENSION.PausableConfig:
      return pausedNow(mint) === false;
    case EXTENSION.DefaultAccountState:
      return extension.data.length === 1 && extension.data[0] === 1;
    default:
      return STOCK_MINT_EXTENSIONS.includes(extension.type);
  }
}

/**
 * One coin of her vault as her stop takes it home: `move` — what the vault holds of it, from the vault's account
 * where it is (any account of the vault — a stolen key's buy could have put it in one that is not the vault's own), to her
 * own account of it; `close` — that account closed to her afterwards, in a transaction of its own (`closeTransactions`).
 * Moving no more than the balance read, and closing apart, keep the move standing whatever anyone sends to the account in
 * the meantime: a close that meets a fresh grain fails alone, and only the account's rent waits for her next stop.
 * `native` — an account of wrapped SOL, which closes whatever it holds (its SOL goes to her with the rent): no grain fails it.
 * `sure` — nothing an issuer or anyone else holds can stop the move (no freeze authority, nothing but the agent's list):
 * such coins may share a transaction; any other goes alone, so that whatever stops it stops nothing else. A reason instead —
 * the coin cannot be moved now, or carries a feature off the agent's list (on a coin she did not sign for, the strict list;
 * on hers, a right in use against a transfer): it stays.
 */
type CoinHome = Readonly<{ move: readonly TransactionInstruction[]; close: Readonly<{ account: PublicKey; program: PublicKey; sweep: TransactionInstruction | null; native: boolean }>; sure: boolean }>;

function coinHome(
  mandate: Mandate,
  vaultAccount: Readonly<{ pubkey: PublicKey; program: PublicKey; data: Uint8Array }>,
  mint: Readonly<{ owner: PublicKey; data: Uint8Array }> | null,
  hers: boolean,
): CoinHome | Readonly<{ reason: string }> {
  const { pubkey, program, data } = vaultAccount;
  if (data[ACCOUNT_STATE_AT] === STATE_FROZEN) return { reason: FROZEN };
  if (!mint || !mint.owner.equals(program) || mint.data.length < 82 || mint.data[MINT_INITIALIZED_AT] !== 1) return { reason: "its mint does not read" };
  let extensions: readonly MintExtension[] = [];
  if (program.equals(TOKEN_2022_PROGRAM_ID)) {
    try {
      extensions = mintExtensions(mint.data);
    } catch {
      return { reason: "its mint does not read whole" };
    }
  }
  let plain = true;
  for (const extension of extensions) {
    if (ALLOWED_MINT_EXTENSIONS.includes(extension.type)) continue;
    plain = false;
    if (extension.type === EXTENSION.NonTransferable) return { reason: FEATURE_REASONS.get(extension.type)! };
    if (hers && ownFeatureMoves(extension, mint)) continue;
    return { reason: FEATURE_REASONS.get(extension.type) ?? UNKNOWN_FEATURE };
  }
  const mintAddress = new PublicKey(data.subarray(0, 32));
  const human = mandate.terms.human;
  const balance = heldIn(data);
  const mine = tokenAccountOf(human, mintAddress, program);
  const move =
    balance > 0n
      ? [
          createAssociatedTokenAccountIdempotentInstruction(human, mine, human, mintAddress, program),
          ownerExecuteInstruction({ settings: mandate.settings, signer: human, instructions: [createTransferCheckedInstruction(pubkey, mintAddress, mine, mandate.vault, balance, mint.data[MINT_DECIMALS_AT]!, [], program)] }),
        ]
      : [];
  /* What a coin with a transfer fee withheld in the account: swept to its mint first, or the program closes no such account. */
  const sweep = extensions.some((extension) => extension.type === EXTENSION.TransferFeeConfig) ? createHarvestWithheldTokensToMintInstruction(mintAddress, [pubkey], program) : null;
  const native = program.equals(TOKEN_PROGRAM_ID) && mintAddress.equals(NATIVE_MINT);
  return { move, close: { account: pubkey, program, sweep, native }, sure: plain && mint.data[MINT_FREEZE_AT] === 0 };
}

/** How many transactions of closes one stop asks of her at most — her own coins' accounts first; the rest, her next stop. */
export const COPY_STOP_CLOSE_TRANSACTIONS = 10;

/**
 * The emptied accounts of her vault closed to her, after every coin's move. A close
 * fails when anything is in the account as it runs, and anyone may send a grain of a coin to any account (its issuer may
 * freeze one): so each such close is a transaction of its own, and a grain fails that close alone — never the others' in
 * one transaction with it. Only accounts of wrapped SOL, which close whatever they hold, share one. At most
 * `COPY_STOP_CLOSE_TRANSACTIONS`, in the order given (her own coins' accounts first); `left` — the accounts that wait for her
 * next stop (only their rent).
 */
function closeTransactions(mandate: Mandate, closes: readonly CoinHome["close"][]): Readonly<{ transactions: TransactionInstruction[][]; left: number }> {
  const human = mandate.terms.human;
  const build = (part: readonly CoinHome["close"][]) => [
    ...part.flatMap((entry) => (entry.sweep ? [entry.sweep] : [])),
    ownerExecuteInstruction({ settings: mandate.settings, signer: human, instructions: part.map((entry) => createCloseAccountInstruction(entry.account, human, mandate.vault, [], entry.program)) }),
  ];
  const parts: CoinHome["close"][][] = [];
  let shared: CoinHome["close"][] | null = null;
  let left = 0;
  for (const entry of closes) {
    if (entry.native && shared && fits(human, build([...shared, entry]))) shared.push(entry);
    else if (parts.length >= COPY_STOP_CLOSE_TRANSACTIONS) left += 1;
    else {
      const part = [entry];
      parts.push(part);
      if (entry.native) shared = part;
    }
  }
  return { transactions: parts.map(build), left };
}

/**
 * Stop her copy and take everything back, one approval (the review of #1974's MAJOR: no coin anyone can drop in
 * her vault can hold the stop up):
 * 1. **the stop itself** — the buy's policy and every sale's policy removed, the rest of the budget to her wallet — its
 *    own first transaction, which names nothing but her account, its policies and the budget's account;
 * 2. **every coin of the vault home** — hers, and any other a stolen key bought or anyone sent, from every token account of
 *    the vault — each in its own transaction, or a few together when nothing can stop them moving (`coinHome`); her own
 *    coins first, at most `COPY_STOP_COIN_TRANSACTIONS`, the rest (`left`) for her next stop; a coin of hers with an order
 *    of the copy on its way goes alone;
 * 3. **the emptied accounts closed to her** — last, apart from the moves, each in a transaction of its own
 *    (`closeTransactions`): a grain sent to one fails only its close;
 * 4. a coin that cannot move now — its account frozen, a coin that never moves, transfers paused or run through its issuer's
 *    program, a feature off the agent's list — stays in her vault, and is said with its reason (`skipped`).
 * A read that failed — her policies, the budget, the vault's accounts, their mints — is no stop: she taps again, and is
 * never handed a stop that leaves a coin behind unsaid. `store` — the copy is frozen first (her switch, the same as every
 * agent of hers, and the record's own mark), so it starts no order that could land before her stop; if she does not sign,
 * it stays frozen until she turns it back on. The record is read again after her freeze is in it — an order
 * written before is there, and none is written after (`raceOf`) — and the coin of an order on its way goes alone; a freeze
 * or a record not read, and every coin of hers goes alone.
 */
export async function reviewCopyStop(
  row: CopyMoneyRow,
  agent: PublicKey,
  connection: Pick<Connection, "getMultipleAccountsInfo" | "getAccountInfo" | "getTokenAccountsByOwner" | "getLatestBlockhash">,
  deps: Readonly<{ store?: GuardStore; now?: () => number }> = {},
): Promise<CopyStopReview> {
  const mandate = copyMandateOf(row, agent);
  const human = mandate.terms.human;
  /* The book as it stands once her freeze is in it: without a store, the record handed in is the book. */
  let book: CopyMoneyRow | null = row;
  if (deps.store) {
    const store = deps.store;
    const frozen = await setCopyFrozen(store, { cluster: row.cluster, owner: row.owner, policy: row.mandate.policy, frozen: true }, deps.now).then((done) => done.ok, () => false);
    book = frozen ? await readCopyRow(store, row.cluster, row.mandate.policy).catch(() => null) : null;
  }
  /* The coin of an order on its way may still move: it goes alone — and every coin of hers, when the book is not known. */
  const moving = book ? unsettledOrder(book)?.mint ?? null : null;
  const alone = (mint: string) => mint === moving || (book === null && (mandate.terms.copyCoins ?? []).some((coin) => coin.mint.toBase58() === mint));
  const policies = [mandate.policy, ...(mandate.salePolicies ?? [])];
  let live: readonly unknown[];
  let budget: Readonly<{ data: Uint8Array }> | null;
  try {
    [live, budget] = await Promise.all([connection.getMultipleAccountsInfo(policies, "confirmed"), connection.getAccountInfo(mandate.budgetAccount, "confirmed")]);
  } catch {
    return notRead("Your copy's policies");
  }
  const standing = policies.filter((_policy, at) => live[at] !== null);
  const first = [...(standing.length ? planStop({ ...mandate, policy: standing[0]!, salePolicies: standing.slice(1) }) : []), ...(budget ? planWithdraw(mandate, heldIn(budget.data)) : [])];
  let accounts: Readonly<{ pubkey: PublicKey; program: PublicKey; data: Uint8Array }>[];
  try {
    const reads = await Promise.all(TOKEN_PROGRAMS.map((programId) => connection.getTokenAccountsByOwner(mandate.vault, { programId }, "confirmed")));
    accounts = reads.flatMap((read, at) => read.value.map(({ pubkey, account }) => ({ pubkey, program: TOKEN_PROGRAMS[at]!, data: account.data })));
  } catch {
    return notRead("The coins in your vault");
  }
  accounts = accounts.filter((account) => !account.pubkey.equals(mandate.budgetAccount) && account.data.length >= ACCOUNT_BYTES);
  const mintOf = (account: Readonly<{ data: Uint8Array }>) => new PublicKey(account.data.subarray(0, 32));
  const own = new Set((mandate.terms.copyCoins ?? []).map((coin) => coin.mint.toBase58()));
  /* Her own coins first, then any other — each group in the order the chain listed them. */
  accounts.sort((a, b) => Number(!own.has(mintOf(a).toBase58())) - Number(!own.has(mintOf(b).toBase58())));
  const mints = [...new Set(accounts.map((account) => mintOf(account).toBase58()))].map((mint) => new PublicKey(mint));
  const mintInfo = new Map<string, Readonly<{ owner: PublicKey; data: Uint8Array }> | null>();
  try {
    for (let at = 0; at < mints.length; at += 100) {
      const part = mints.slice(at, at + 100);
      const infos = await connection.getMultipleAccountsInfo(part, "confirmed");
      part.forEach((mint, index) => mintInfo.set(mint.toBase58(), infos[index] ?? null));
    }
  } catch {
    return notRead("The coins in your vault");
  }
  const skipped: CopyStopSkip[] = [];
  const groups: TransactionInstruction[][] = [];
  const closes: CoinHome["close"][] = [];
  let shared: TransactionInstruction[] | null = null;
  let left = 0;
  for (const account of accounts) {
    const mint = mintOf(account).toBase58();
    const home = coinHome(mandate, account, mintInfo.get(mint) ?? null, own.has(mint));
    if ("reason" in home) {
      skipped.push({ mint, reason: home.reason });
      continue;
    }
    const sure = home.sure && !alone(mint);
    if (!home.move.length) closes.push(home.close);
    else if (sure && shared && fits(human, [...shared, ...home.move])) {
      shared.push(...home.move);
      closes.push(home.close);
    } else if (groups.length >= COPY_STOP_COIN_TRANSACTIONS) left += 1;
    else {
      const group = [...home.move];
      groups.push(group);
      closes.push(home.close);
      shared = sure ? group : shared;
    }
  }
  const closing = closeTransactions(mandate, closes);
  const transactions = [...(first.length ? [first] : []), ...groups, ...closing.transactions];
  if (!transactions.length) return { ok: false, code: "NOTHING", reason: "Nothing left to stop.", skipped };
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return { ok: true, transactions: transactions.map((instructions) => toBase64(unsignedTransaction(human, instructions, blockhash))), skipped, left, unclosed: closing.left };
}
