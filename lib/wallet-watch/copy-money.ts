/**
 * «Повторюй за гаманцем» with money: the pure half. What one copy with money is (its record: the mandate she
 * signed — a buy's policy and a sale's policy for each group of her coins, `../mandate/terms.ts` `copyCoins` — and its
 * orders), and what it does next with the leader's trades: a buy, a sale, or a miss with its reason. The money half —
 * the pass that reads the chain, asks the signer and sends — is `./copy-money.server.ts`.
 *
 * The rules, each a line of `nextCopySteps`, on top of the paper copy's (`./copy-agent.ts`):
 * - **only her coins** — a buy of a coin outside the set she signed for is missed (`outside`): the chain lets the agent
 *   sell only a coin a policy of hers names a limit for, and only her signature writes one;
 * - **the leader's exit never becomes the copy's entry** (`exited`), **the term** (`ended`) and **the day's cap**
 *   (`budget`) — as on paper; the price bound (`drift`) needs the price now, so the server asks it before each buy;
 * - **a buy is her trade, at most a coin's share of her day** (`copyBuySize`), and the vault holds of a coin —
 *   with what it sold of it in the last day — no more than the coin's day lets out (`full`, the server's check with the
 *   balance): every exit then fits the chain's limit of the coin in one day;
 * - **a sale follows the leader's share** of what it held, from what the vault holds of the coin, within what the coin's
 *   day has left (`copyCoinRoom`) — never held back by the bound or the term; a sale older than the copy's ten minutes is
 *   not repeated (`late`);
 * - **one order a minute** (`COPY_ORDER_EVERY_MS`), and none while one is on its way (`unsettledOrder`): an order is
 *   written down with its signature before it is sent, and read back from the chain before the next;
 * - **a trade handled is never handled again** — the slot it is handled through (`throughSlot`) stands beside
 *   the keys of the newest trades (`seen`), so a leader with more trades than the keys kept repeats none.
 *
 * Pure: no clock unless given, no network.
 */

import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

import type { Mandate } from "../mandate/human.ts";
import { NATIVE_MINT } from "../mandate/ssa.ts";
import { COPY_COINS_MAX, copyBuySize, copyChunks, type CopyCoin, type MandateTerms } from "../mandate/terms.ts";
import { COPY_BOUNDS, COPY_SHARES, DAY_S, leaderLeft } from "./copy-agent.ts";
import { PAPER_LATE_S } from "./paper.ts";
import type { WalletTrade } from "./trades.ts";

/** At most one order a minute, for each copy. */
export const COPY_ORDER_EVERY_MS = 60_000;
/** Orders one copy keeps, newest first — a day's buys are at most ten (a trade is at least a tenth of the day). */
export const COPY_ORDERS_KEPT = 100;
/**
 * The copy's own orders of the last day (`COPY_SALE_WINDOW_MS`: signed, sent, landed, refused — never a miss)
 * are kept whatever the misses: the coin's day, her day's cap and the trades acted on are counted from them. At most this
 * many in a day; past it the copy builds no order until the day frees (`full`).
 */
export const COPY_DAY_ORDERS_MAX = 300;
/** The newest misses (and older orders) kept beside a full day of the copy's own orders, so a miss is always said. */
export const COPY_MISSES_MIN = 20;
/** The leader's trades already handled, kept by key. */
export const COPY_SEEN_KEPT = 600;
/** The slippage every swap of a copy goes with, basis points — the chain's ceiling for an agent's trade (1 %). */
export const COPY_SWAP_SLIPPAGE_BPS = 100;
/**
 * The window a coin's sales are counted in against its day, ms: the last 24 hours. The chain's day of a limit
 * is never longer, so what the engine counts in it is at least what the chain does, and no sale it builds is over the limit.
 */
export const COPY_SALE_WINDOW_MS = 86_400_000;
/**
 * How far under the slot it is handled through a trade is still read against the keys kept (`seen`) and the
 * day's orders, slots: twelve minutes at 0.4 s a slot — past the copy's ten (`PAPER_LATE_S`), so a trade the wallet watch
 * hands in late is still handled while it could be copied; under it, a trade is history — late whatever it was — and is
 * never handled again.
 */
export const COPY_SLOT_MARGIN = 1_800;

/**
 * Why a trade of the leader was not repeated with money: the paper copy's (`exited`, `drift`, `budget`, `ended`, `late`)
 * and the money's own.
 */
export const COPY_MONEY_MISSES = ["late", "outside", "exited", "ended", "budget", "drift", "coin", "route", "full"] as const;
export type CopyMoneyMiss = (typeof COPY_MONEY_MISSES)[number];

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW = /^\d{1,20}$/;

const CoinSchema = z.object({ mint: z.string().regex(BASE58), program: z.string().regex(BASE58), dailyMax: z.string().regex(RAW), pool: z.string().regex(BASE58).optional() }).strict();

const OrderSchema = z
  .object({
    /** The leader's trade it repeats (`signature:mint:side`). */
    key: z.string().max(200),
    side: z.enum(["buy", "sell"]),
    mint: z.string().regex(BASE58),
    /** When the copy acted, ms; when the leader traded, s; the day of the term it falls in (0 — the first). */
    at: z.number(),
    leaderAt: z.number(),
    dayN: z.number().int().nonnegative(),
    /** A buy: lamports of the budget; a sale: base units of the coin. */
    amountRaw: z.string().regex(RAW),
    /** `sent` — signed and written down, its fate not read yet; `missed` — never built. */
    status: z.enum(["sent", "ok", "failed", "refused", "missed"]),
    signature: z.string().max(100).nullable(),
    validUntilHeight: z.number().int().optional(),
    receivedRaw: z.string().regex(RAW).nullable(),
    reason: z.string().max(240).nullable(),
    missed: z.enum(COPY_MONEY_MISSES).optional(),
  })
  .strict();
export type CopyOrder = z.infer<typeof OrderSchema>;

const RowSchema = z
  .object({
    schema: z.literal("ryntra.wallet-watch.copy-money"),
    version: z.number().int().positive(),
    cluster: z.enum(["devnet", "mainnet"]),
    owner: z.string().regex(BASE58),
    leader: z.string().regex(BASE58),
    sharePct: z.number().refine((value) => (COPY_SHARES as readonly number[]).includes(value)),
    boundPct: z.number().refine((value) => (COPY_BOUNDS as readonly number[]).includes(value)),
    /** The mandate she signed: public addresses and the terms' numbers. */
    mandate: z
      .object({
        settings: z.string().regex(BASE58),
        vault: z.string().regex(BASE58),
        policy: z.string().regex(BASE58),
        policySeed: z.string().regex(RAW),
        budget: z.string().regex(BASE58),
        budgetMint: z.string().regex(BASE58),
        salePolicies: z.array(z.string().regex(BASE58)).min(1).max(COPY_COINS_MAX),
        perTrade: z.string().regex(RAW),
        perDay: z.string().regex(RAW),
        expiresAt: z.string().regex(RAW),
        /** Devnet's gate pool; absent — Jupiter. */
        pool: z.string().regex(BASE58).optional(),
        coins: z.array(CoinSchema).min(1).max(COPY_COINS_MAX),
      })
      .strict(),
    status: z.enum(["working", "stopped"]),
    /** ISO: no trade of the leader's from before is copied; the term's days count from here. */
    since: z.string(),
    seen: z.array(z.string().max(200)).max(COPY_SEEN_KEPT),
    orders: z.array(OrderSchema).max(COPY_ORDERS_KEPT + COPY_DAY_ORDERS_MAX),
    /** When the last order was built and signed, ms; null — never. */
    lastOrderAt: z.number().nullable(),
    /** The newest slot of the leader's trades handled; absent — none yet. */
    throughSlot: z.number().int().nonnegative().optional(),
    /**
     * Her freeze, as the copy's own record carries it beside her switch (`setCopyFrozen`): the compare-and-set
     * that writes an order down before it is sent reads it (`raceOf`), so no order goes out once her freeze is written.
     */
    frozen: z.literal(true).optional(),
    /**
     * Her last stop left something in her vault, or its check did not read — the screen offers «Take the rest»
     * while it stands, after a reload too; cleared once a check reads the vault empty (`copyStanding`).
     */
    rest: z.literal(true).optional(),
    updatedAt: z.string(),
  })
  .strict();
export type CopyMoneyRow = z.infer<typeof RowSchema>;

export const parseCopyRow = (value: unknown): CopyMoneyRow | null => {
  const parsed = RowSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
export const COPY_ROW_SCHEMA = RowSchema;

/** The key of one copy with money in the `walletWatch` collection: by network and the buy's policy. */
export const copyMoneyKey = (cluster: string, policy: string) => `copy-money:${cluster}:${policy}`;

/** Her copy's coins as the terms hold them. */
export function copyCoinsOf(row: Pick<CopyMoneyRow, "mandate">): readonly CopyCoin[] {
  return row.mandate.coins.map((coin) => ({ mint: new PublicKey(coin.mint), program: new PublicKey(coin.program), dailyMax: BigInt(coin.dailyMax), ...(coin.pool ? { pool: new PublicKey(coin.pool) } : {}) }));
}

/** The mandate a copy's record names, with the agent's key: what the signer and the venue judge by. */
export function copyMandateOf(row: CopyMoneyRow, agent: PublicKey): Mandate {
  const m = row.mandate;
  const terms: MandateTerms = {
    human: new PublicKey(row.owner),
    agent,
    budgetMint: new PublicKey(m.budgetMint),
    perTrade: BigInt(m.perTrade),
    perDay: BigInt(m.perDay),
    slippageBps: COPY_SWAP_SLIPPAGE_BPS,
    expiresAt: BigInt(m.expiresAt),
    venue: m.pool ? { kind: "dlmm", pool: new PublicKey(m.pool) } : { kind: "jupiter" },
    copyCoins: copyCoinsOf(row),
  };
  return {
    cluster: row.cluster,
    terms,
    settings: new PublicKey(m.settings),
    vault: new PublicKey(m.vault),
    policy: new PublicKey(m.policy),
    policySeed: BigInt(m.policySeed),
    budgetAccount: new PublicKey(m.budget),
    salePolicies: m.salePolicies.map((policy) => new PublicKey(policy)),
  };
}

/** The record of a mandate she just signed, as a copy keeps it. */
export function copyRowOf(input: Readonly<{ mandate: Mandate; leader: string; sharePct: number; boundPct: number; nowIso: string }>): CopyMoneyRow {
  const { mandate } = input;
  const terms = mandate.terms;
  const coins = terms.copyCoins ?? [];
  if (!coins.length || !mandate.salePolicies || mandate.salePolicies.length !== copyChunks(coins).length) throw new Error("Not a copy's mandate.");
  return RowSchema.parse({
    schema: "ryntra.wallet-watch.copy-money",
    version: 1,
    cluster: mandate.cluster,
    owner: terms.human.toBase58(),
    leader: input.leader,
    sharePct: input.sharePct,
    boundPct: input.boundPct,
    mandate: {
      settings: mandate.settings.toBase58(),
      vault: mandate.vault.toBase58(),
      policy: mandate.policy.toBase58(),
      policySeed: mandate.policySeed.toString(),
      budget: mandate.budgetAccount.toBase58(),
      budgetMint: terms.budgetMint.toBase58(),
      salePolicies: mandate.salePolicies.map(String),
      perTrade: terms.perTrade.toString(),
      perDay: terms.perDay.toString(),
      expiresAt: terms.expiresAt.toString(),
      ...(terms.venue.kind === "dlmm" ? { pool: terms.venue.pool.toBase58() } : {}),
      coins: coins.map((coin) => ({ mint: coin.mint.toBase58(), program: coin.program.toBase58(), dailyMax: coin.dailyMax.toString(), ...(coin.pool ? { pool: coin.pool.toBase58() } : {}) })),
    },
    status: "working",
    since: input.nowIso,
    seen: [],
    orders: [],
    lastOrderAt: null,
    updatedAt: input.nowIso,
  });
}

/* ------------------------------------------------------------- the day, the order on its way */

/** The day of the term a moment falls in, from the copy's start: 0 — the first. */
export const copyDayOf = (row: Pick<CopyMoneyRow, "since">, nowMs: number): number => Math.max(0, Math.floor((nowMs - Date.parse(row.since)) / 1000 / DAY_S));

/** What the copy's buys of that day spent or hold on their way, lamports: a buy refused or failed spent nothing. */
export function copyDaySpent(row: Pick<CopyMoneyRow, "orders">, dayN: number): bigint {
  return row.orders.filter((order) => order.side === "buy" && order.dayN === dayN && (order.status === "ok" || order.status === "sent")).reduce((sum, order) => sum + BigInt(order.amountRaw), 0n);
}

/**
 * What the copy's sales of a coin let out of the vault in the last day (`COPY_SALE_WINDOW_MS`), base units:
 * every sale signed and sent or landed; one the chain refused moved nothing.
 */
export function copyCoinSold(row: Pick<CopyMoneyRow, "orders">, mint: string, nowMs: number): bigint {
  return row.orders.filter((order) => order.side === "sell" && order.mint === mint && order.at > nowMs - COPY_SALE_WINDOW_MS && (order.status === "ok" || order.status === "sent")).reduce((sum, order) => sum + BigInt(order.amountRaw), 0n);
}

/** What the coin's day still lets the copy sell of it now, base units: its day less what it sold in the last day. */
export function copyCoinRoom(row: Pick<CopyMoneyRow, "orders">, coin: Pick<CopyCoin, "mint" | "dailyMax">, nowMs: number): bigint {
  const room = coin.dailyMax - copyCoinSold(row, coin.mint.toBase58(), nowMs);
  return room > 0n ? room : 0n;
}

/** Whether an order is one of the copy's own of the last day: never a miss, never pushed out by misses. */
const dayOrder = (order: Pick<CopyOrder, "status" | "at">, nowMs: number): boolean => order.status !== "missed" && order.at > nowMs - COPY_SALE_WINDOW_MS;

/** How many orders of its own the copy built in the last day. */
export const copyDayOrders = (row: Pick<CopyMoneyRow, "orders">, nowMs: number): number => row.orders.filter((order) => dayOrder(order, nowMs)).length;

/** The leader's trades the copy acted on (an order of its own, not a miss): never acted on twice. */
export const copyActedKeys = (row: Pick<CopyMoneyRow, "orders">): ReadonlySet<string> => new Set(row.orders.filter((order) => order.status !== "missed").map((order) => order.key));

/** The order signed and sent whose fate is not read yet: while there is one, no new order. */
export const unsettledOrder = (row: Pick<CopyMoneyRow, "orders">): CopyOrder | null => row.orders.find((order) => order.status === "sent") ?? null;

/** Whether the minute since the last order has passed. */
export const orderDue = (row: Pick<CopyMoneyRow, "lastOrderAt">, nowMs: number): boolean => row.lastOrderAt === null || nowMs - row.lastOrderAt >= COPY_ORDER_EVERY_MS;

/* ------------------------------------------------------------- the leader's trades → the copy's steps */

export const leaderTradeKey = (trade: Pick<WalletTrade, "signature" | "mint" | "side">) => `${trade.signature}:${trade.mint}:${trade.side}`;

/** What the leader held of a coin just before a sale, from its trades read; null when its buys are not all there. */
function leaderHeldBefore(ordered: readonly WalletTrade[], sale: WalletTrade): bigint | null {
  let held = 0n;
  for (const trade of ordered) {
    if (trade === sale) break;
    if (trade.mint !== sale.mint) continue;
    held += trade.side === "buy" ? BigInt(trade.tokensRaw) : -BigInt(trade.tokensRaw);
  }
  return held > 0n ? held : null;
}

/** The share of what it held the leader sold, basis points (10 000 — all of it, or not known). */
export function leaderShareBps(ordered: readonly WalletTrade[], sale: WalletTrade): number {
  const before = leaderHeldBefore(ordered, sale);
  if (before === null) return 10_000;
  const sold = BigInt(sale.tokensRaw);
  return sold >= before ? 10_000 : Math.max(1, Number((sold * 10_000n) / before));
}

/** The leader's own price of a trade, lamports a base unit of the coin, when it paid in SOL; null — another quote. */
export function leaderLamportsPerUnit(trade: Pick<WalletTrade, "tokensRaw" | "quote" | "quoteAmount">): number | null {
  const units = Number(trade.tokensRaw);
  if (trade.quote !== "SOL" || trade.quoteAmount === null || !(trade.quoteAmount > 0) || !(units > 0)) return null;
  return (trade.quoteAmount * 1e9) / units;
}

/**
 * Whether a buy of `lamports` for `units` of the coin now is past the bound above the leader's own price. A leader's
 * price not known (a dollar leg) is past it: the copy does not buy blind.
 */
export function pastCopyBound(lamports: bigint, units: bigint, leader: number | null, boundPct: number): boolean {
  if (leader === null || units <= 0n) return true;
  return Number(lamports) / Number(units) > leader * (1 + boundPct / 100) * (1 + 1e-9);
}

export type CopyStep =
  | Readonly<{ kind: "miss"; trade: WalletTrade; missed: CopyMoneyMiss; reason: string | null }>
  | Readonly<{ kind: "buy"; trade: WalletTrade; amount: bigint; coin: CopyCoin }>
  | Readonly<{ kind: "sell"; trade: WalletTrade; shareBps: number; coin: CopyCoin }>
  /* A sale of a coin outside her set: the copy holds none of it — nothing to do, nothing to say. */
  | Readonly<{ kind: "nothing"; trade: WalletTrade }>;

/**
 * The copy's next steps with the leader's trades it has not handled, oldest first: every miss and nothing up to the first
 * trade that is an order — a buy or a sale — and that order last; none when nothing is left. A trade from before the copy
 * started, one another wallet paid for, or a token-for-token leg is not copied, as on paper.
 */
export function nextCopySteps(row: CopyMoneyRow, trades: readonly WalletTrade[], nowMs: number): readonly CopyStep[] {
  const since = Math.floor(Date.parse(row.since) / 1000);
  const nowS = Math.floor(nowMs / 1000);
  /* A trade acted on is known by the day's orders too — never pushed out by misses — not by the keys alone. */
  const seen = new Set([...row.seen, ...copyActedKeys(row)]);
  const ordered = [...trades].sort((a, b) => a.slot - b.slot);
  const coins = copyCoinsOf(row);
  const perDay = BigInt(row.mandate.perDay);
  /* Her trade, at most a coin's share of her day — what one buy brings in fits the coin's day. */
  const size = copyBuySize(BigInt(row.mandate.perTrade), perDay, coins.length);
  const ends = Number(row.mandate.expiresAt);
  const spent = copyDaySpent(row, copyDayOf(row, nowMs));
  /* Under the slot handled through, less a minute's margin the keys kept still cover, a trade is history. */
  const history = (row.throughSlot ?? 0) - COPY_SLOT_MARGIN;
  const steps: CopyStep[] = [];
  for (const trade of ordered) {
    if (trade.at === null || trade.at < since || trade.paidBy !== null || trade.quote === null || trade.slot < history || seen.has(leaderTradeKey(trade))) continue;
    const coin = coins.find((entry) => entry.mint.toBase58() === trade.mint) ?? null;
    const late = nowS - trade.at > PAPER_LATE_S;
    if (trade.side === "sell") {
      /* An old sale is not repeated — said as late; the coin stays until the leader's next sale or her stop. */
      if (coin && late) {
        steps.push({ kind: "miss", trade, missed: "late", reason: null });
        continue;
      }
      steps.push(coin ? { kind: "sell", trade, shareBps: leaderShareBps(ordered, trade), coin } : { kind: "nothing", trade });
      if (coin) return steps;
      continue;
    }
    const missed: CopyMoneyMiss | null = late ? "late" : !coin ? "outside" : leaderLeft(ordered, trade) ? "exited" : nowS >= ends ? "ended" : spent + size > perDay ? "budget" : null;
    if (missed || !coin) {
      steps.push({ kind: "miss", trade, missed: missed ?? "outside", reason: null });
      continue;
    }
    steps.push({ kind: "buy", trade, amount: size, coin });
    return steps;
  }
  return steps;
}

/** A miss written down: the leader's trade handled, nothing built or sent. */
export function missedOrder(step: Readonly<{ trade: WalletTrade; missed: CopyMoneyMiss; reason: string | null }>, row: Pick<CopyMoneyRow, "since">, nowMs: number): CopyOrder {
  return {
    key: leaderTradeKey(step.trade),
    side: step.trade.side,
    mint: step.trade.mint,
    at: nowMs,
    leaderAt: step.trade.at ?? 0,
    dayN: copyDayOf(row, nowMs),
    amountRaw: "0",
    status: "missed",
    signature: null,
    receivedRaw: null,
    reason: step.reason?.slice(0, 240) ?? null,
    missed: step.missed,
  };
}

/**
 * The row with these orders on top and their trades handled, the newest kept. `throughSlot` — the newest slot
 * of the trades handled now; the row keeps the highest it has seen.
 */
export function withOrders(row: CopyMoneyRow, orders: readonly CopyOrder[], nowIso: string, handled: readonly string[] = [], throughSlot?: number): CopyMoneyRow {
  const seen = [...new Set([...row.seen, ...handled, ...orders.map((order) => order.key)])].slice(-COPY_SEEN_KEPT);
  const all = [...[...orders].reverse(), ...row.orders.filter((old) => !orders.some((order) => order.key === old.key && order.at === old.at))];
  /*
   * The day's own orders stay whatever the misses — the coin's day, her day's cap and the trades acted on are
   * counted from them (the review of this branch: a busy leader's misses pushed the day's sales out and the coin's room grew
   * back); the rest, newest first, fill what is left of `COPY_ORDERS_KEPT`.
   */
  const nowMs = Date.parse(nowIso);
  const day = all.filter((order) => dayOrder(order, nowMs)).slice(0, COPY_DAY_ORDERS_MAX);
  let room = Math.max(COPY_MISSES_MIN, COPY_ORDERS_KEPT - day.length);
  const kept = all.filter((order) => (day.includes(order) ? true : room-- > 0));
  const through = throughSlot === undefined ? row.throughSlot : Math.max(row.throughSlot ?? 0, throughSlot);
  return { ...row, seen, orders: kept, ...(through === undefined ? {} : { throughSlot: through }), updatedAt: nowIso };
}

/** The leader's coins, the newest buy first — what the screen offers her to sign for: no SOL, no dollars, at most ten. */
export function leaderCoins(trades: readonly Pick<WalletTrade, "side" | "mint" | "slot" | "quote" | "paidBy">[]): readonly string[] {
  const money = new Set([NATIVE_MINT.toBase58(), "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
  const out: string[] = [];
  for (const trade of [...trades].sort((a, b) => b.slot - a.slot)) {
    if (trade.side !== "buy" || trade.paidBy !== null || trade.quote === null || money.has(trade.mint) || out.includes(trade.mint)) continue;
    out.push(trade.mint);
    if (out.length >= COPY_COINS_MAX) break;
  }
  return out;
}
