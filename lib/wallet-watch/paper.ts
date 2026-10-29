/**
 * «Копіювання на папері» (SOL-R3) — a wallet copied without money: from the moment a person starts it, each trade of
 * the wallet that Ryntra reads is filled on paper at the price of the moment Ryntra saw it — the real delay — moved by
 * the person's own size in the token's pool, less Ryntra's fee and the network's, as `reality.ts` figures them; a
 * token-for-token leg, which has no price, is not copied. A buy
 * whose own impact passes the tolerance, or one seen too late, is missed and said so; a sale sells the leader's share.
 *
 * One record per person in the Guard collection `walletWatch`: `paper:solana:mainnet:<owner>` — up to five copies,
 * each with its holdings, its fills (the newest hundred) and the trades already handled. Versioned: the cron's fills
 * and a person's start or stop never lose each other.
 *
 * Paper only. Nothing here builds, signs or sends a transaction; live copying waits for the legal opinion (D12) and
 * the owner's canary within the spending limits of SOL-7 (decisions 58, 64) and is not built.
 */

import { z } from "zod";

import type { GuardStore, GuardVersionedRecord } from "../guard/store.ts";
import { COPY_ASSUMPTIONS, COPY_SIZES, COPY_SLIPPAGES, ryntraFeeBps } from "./reality.ts";
import { WALLET_WATCH_COLLECTION } from "./store.ts";
import type { WalletTrade } from "./trades.ts";

/** Wallets one person copies on paper at once. */
export const PAPER_LIMIT = 5;
/** Fills a copy keeps, newest first. */
export const PAPER_FILLS_KEPT = 100;
/** A trade Ryntra saw later than this after it happened is missed: a copy that late is not a copy. */
export const PAPER_LATE_S = 10 * 60;
/** Tokens one copy holds at once; a buy of another is missed until one is sold. */
export const PAPER_POSITIONS = 30;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const FillSchema = z
  .object({
    key: z.string().max(200),
    /** When Ryntra filled it, and when the leader traded — unix seconds. */
    at: z.number(),
    leaderAt: z.number(),
    side: z.enum(["buy", "sell"]),
    mint: z.string().regex(BASE58),
    symbol: z.string().max(24).nullable(),
    /** Whole tokens got or given; SOL paid (with fees) or got (after fees); the fees alone. */
    tokens: z.number().nonnegative(),
    sol: z.number().nonnegative(),
    feeSol: z.number().nonnegative(),
    missed: z.enum(["liquidity", "price", "late", "full"]).nullable(),
  })
  .strict();
export type PaperFill = z.infer<typeof FillSchema>;

const CopySchema = z
  .object({
    leader: z.string().regex(BASE58),
    name: z.string().min(1).max(32).nullable(),
    sizeSol: z.number().refine((value) => (COPY_SIZES as readonly number[]).includes(value)),
    slippagePct: z.number().refine((value) => (COPY_SLIPPAGES as readonly number[]).includes(value)),
    /** ISO time it was started: no trade from before is copied. */
    since: z.string(),
    /** Whole tokens held and what they cost, SOL, by mint. */
    positions: z.record(z.string().regex(BASE58), z.object({ tokens: z.number().nonnegative(), costSol: z.number().nonnegative() }).strict()),
    spentSol: z.number().nonnegative(),
    receivedSol: z.number().nonnegative(),
    feesSol: z.number().nonnegative(),
    fills: z.array(FillSchema).max(PAPER_FILLS_KEPT),
    /** Fills and misses over the copy's life — the kept list is only the newest hundred. */
    filledCount: z.number().int().nonnegative().optional(),
    missedCount: z.number().int().nonnegative().optional(),
    /** The leader's trades already handled, by key — filled, missed or nothing to sell. */
    seen: z.array(z.string().max(200)).max(300),
  })
  .strict();
export type PaperCopy = z.infer<typeof CopySchema>;

const PaperSchema = z
  .object({
    schema: z.literal("ryntra.wallet-watch.paper"),
    version: z.number().int().positive(),
    owner: z.string().regex(BASE58),
    copies: z.array(CopySchema).max(PAPER_LIMIT),
    updatedAt: z.string(),
  })
  .strict();
export type PaperRecord = z.infer<typeof PaperSchema>;

type Row = GuardVersionedRecord & Record<string, unknown>;
const rows = (store: GuardStore) => store.versioned<Row>(WALLET_WATCH_COLLECTION);
export const paperKey = (owner: string) => `paper:solana:mainnet:${owner}`;

export async function readPaper(store: GuardStore, owner: string): Promise<PaperRecord | null> {
  const parsed = PaperSchema.safeParse(await rows(store).get(paperKey(owner)));
  return parsed.success && parsed.data.owner === owner ? parsed.data : null;
}

export async function listPapers(store: GuardStore): Promise<PaperRecord[]> {
  return (await rows(store).valuesWithPrefix("paper:solana:mainnet:")).flatMap((row) => {
    const parsed = PaperSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export type PaperOutcome = Readonly<{ ok: true; record: PaperRecord }> | Readonly<{ ok: false; code: "LIMIT" | "NOT_FOUND" | "CONFLICT" }>;

/** One change to the person's copies by compare-and-set, re-read and re-applied on a lost race (the cron's fills); a change that changed no copy writes nothing. */
export async function changePaper(store: GuardStore, owner: string, change: (copies: PaperCopy[]) => PaperCopy[] | "LIMIT" | "NOT_FOUND", nowIso: string): Promise<PaperOutcome> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = await readPaper(store, owner);
    const copies = found?.copies ?? [];
    const next = change([...copies]);
    if (next === "LIMIT" || next === "NOT_FOUND") return { ok: false, code: next };
    if (found && next.length === copies.length && next.every((copy, index) => copy === copies[index])) return { ok: true, record: found };
    const record = PaperSchema.parse({ schema: "ryntra.wallet-watch.paper", version: (found?.version ?? 0) + 1, owner, copies: next, updatedAt: nowIso });
    if (await rows(store).compareAndSet(paperKey(owner), found?.version ?? null, record as unknown as Row)) return { ok: true, record };
  }
  return { ok: false, code: "CONFLICT" };
}

/** A new copy, from now; started again — the same copy, the newer size and tolerance for what comes next. */
export function startCopy(copies: PaperCopy[], leader: string, settings: Readonly<{ sizeSol: number; slippagePct: number; name: string | null }>, nowIso: string): PaperCopy[] | "LIMIT" {
  const at = copies.findIndex((copy) => copy.leader === leader);
  if (at >= 0) {
    copies[at] = { ...copies[at]!, sizeSol: settings.sizeSol, slippagePct: settings.slippagePct, name: settings.name ?? copies[at]!.name };
    return copies;
  }
  if (copies.length >= PAPER_LIMIT) return "LIMIT";
  return [{ leader, name: settings.name, sizeSol: settings.sizeSol, slippagePct: settings.slippagePct, since: nowIso, positions: {}, spentSol: 0, receivedSol: 0, feesSol: 0, fills: [], seen: [] }, ...copies];
}

export function stopCopy(copies: PaperCopy[], leader: string): PaperCopy[] | "NOT_FOUND" {
  const next = copies.filter((copy) => copy.leader !== leader);
  return next.length === copies.length ? "NOT_FOUND" : next;
}

/* ------------------------------------------------------------- filling */

/** What is known of a token at the moment of a fill: its price and liquidity, dollars, and its ticker. */
export type FillFacts = Readonly<{ priceUsd: number | null; liquidityUsd: number | null; symbol: string | null }>;

const tradeKey = (trade: WalletTrade) => `${trade.signature}:${trade.mint}:${trade.side}`;
const perAttempt = COPY_ASSUMPTIONS.networkFeeSol + COPY_ASSUMPTIONS.priorityFeeSol;

/**
 * The copy after the leader's trades it has not handled yet, oldest first: each filled at the price now, the seconds
 * since the leader's trade its delay. `trades` — the leader's record (newest first, as kept); `facts` — by mint;
 * `solUsd` — SOL's price now. A trade from before the copy started, or one another wallet paid for, is not copied.
 */
export function fillCopy(copy: PaperCopy, trades: readonly WalletTrade[], facts: ReadonlyMap<string, FillFacts>, solUsd: number | null, nowS: number): PaperCopy {
  const since = Math.floor(Date.parse(copy.since) / 1000);
  const seen = new Set(copy.seen);
  const ordered = [...trades].sort((a, b) => a.slot - b.slot);
  /* As the estimate: a token-for-token leg has no price to copy at — not copied on paper either. */
  const todo = ordered.filter((trade) => trade.at !== null && trade.at >= since && trade.paidBy === null && trade.quote !== null && !seen.has(tradeKey(trade)));
  if (todo.length === 0) return copy;
  const positions = { ...copy.positions };
  const fills: PaperFill[] = [];
  let { spentSol, receivedSol, feesSol } = copy;
  /* A token whose trade waits for a price: its later trades wait too — a sale is never skipped before its buy is filled. */
  const waiting = new Set<string>();
  const wait = (trade: WalletTrade) => {
    seen.delete(tradeKey(trade));
    waiting.add(trade.mint);
  };
  for (const trade of todo) {
    seen.add(tradeKey(trade));
    if (waiting.has(trade.mint)) {
      seen.delete(tradeKey(trade));
      continue;
    }
    const fact = facts.get(trade.mint);
    const symbol = fact?.symbol?.slice(0, 24) ?? null;
    const base = { key: tradeKey(trade), at: nowS, leaderAt: trade.at!, side: trade.side, mint: trade.mint, symbol } as const;
    const held = positions[trade.mint];
    /* A sale of what the copy does not hold: nothing to do, nothing to say. */
    if (trade.side === "sell" && (!held || held.tokens <= 0)) continue;
    const priceSol = fact?.priceUsd && solUsd && solUsd > 0 ? fact.priceUsd / solUsd : null;
    const depthSol = fact?.liquidityUsd && fact.liquidityUsd > 0 && solUsd && solUsd > 0 ? fact.liquidityUsd / 2 / solUsd : null;
    const feeShare = ryntraFeeBps(trade.mint) / 10_000;
    const networkSol = perAttempt * (1 + COPY_ASSUMPTIONS.failRate);
    if (trade.side === "buy") {
      /* The pool's depth this moment, when Jupiter gives it: a known pool too thin for the size fails as sent; an unknown one moves nothing, as in the estimate. */
      const impact = depthSol !== null ? copy.sizeSol / depthSol : 0;
      const full = !held && Object.keys(positions).length >= PAPER_POSITIONS;
      const missed = nowS - trade.at! > PAPER_LATE_S ? "late" : full ? "full" : priceSol === null ? "price" : impact > copy.slippagePct / 100 ? "liquidity" : null;
      /* No price this pass (a source down for a minute): tried again while fresh — an outage is never a miss. */
      if (missed === "price") {
        wait(trade);
        continue;
      }
      if (missed || priceSol === null) {
        fills.push({ ...base, tokens: 0, sol: 0, feeSol: 0, missed: missed ?? "price" });
        continue;
      }
      const tokens = (copy.sizeSol * (1 - feeShare)) / (priceSol * (1 + impact));
      const fee = copy.sizeSol * feeShare + networkSol;
      positions[trade.mint] = { tokens: (held?.tokens ?? 0) + tokens, costSol: (held?.costSol ?? 0) + copy.sizeSol + networkSol };
      spentSol += copy.sizeSol + networkSol;
      feesSol += fee;
      fills.push({ ...base, tokens, sol: copy.sizeSol + networkSol, feeSol: fee, missed: null });
      continue;
    }
    /* The leader's share of what it held before the sale, read from its own record; not known — all of it. */
    const before = leaderHeldBefore(ordered, trade);
    const tokensSold = Number(trade.tokensRaw) / 10 ** trade.decimals;
    const share = before !== null && before > 0 ? Math.min(1, tokensSold / before) : 1;
    const amount = share >= 1 - 1e-9 ? held!.tokens : held!.tokens * share;
    if (priceSol === null) {
      /* No price now: the sale is tried again next pass while it is fresh; past that, missed — the tokens stay held. */
      if (nowS - trade.at! <= PAPER_LATE_S) {
        wait(trade);
        continue;
      }
      fills.push({ ...base, tokens: 0, sol: 0, feeSol: 0, missed: "price" });
      continue;
    }
    const value = amount * priceSol;
    const impact = depthSol !== null ? value / depthSol : 0;
    const gross = value / (1 + impact);
    const got = Math.max(0, gross * (1 - feeShare) - networkSol);
    const costShare = held!.costSol * (amount / held!.tokens);
    const left = held!.tokens - amount;
    if (left > 1e-12) positions[trade.mint] = { tokens: left, costSol: Math.max(0, held!.costSol - costShare) };
    else delete positions[trade.mint];
    receivedSol += got;
    feesSol += gross * feeShare + networkSol;
    fills.push({ ...base, tokens: amount, sol: got, feeSol: gross * feeShare + networkSol, missed: null });
  }
  /* Nothing filled and nothing newly handled (a sale waiting for a price): the copy as it was — no write. */
  if (fills.length === 0 && seen.size === new Set(copy.seen).size) return copy;
  return {
    ...copy,
    positions,
    spentSol,
    receivedSol,
    feesSol,
    filledCount: (copy.filledCount ?? copy.fills.filter((fill) => fill.missed === null).length) + fills.filter((fill) => fill.missed === null).length,
    missedCount: (copy.missedCount ?? copy.fills.filter((fill) => fill.missed !== null).length) + fills.filter((fill) => fill.missed !== null).length,
    fills: [...fills.reverse(), ...copy.fills].slice(0, PAPER_FILLS_KEPT),
    seen: [...seen].slice(-300),
  };
}

/** What the leader held of a token just before a sale, from its trades read — null when its buys are not all there. */
function leaderHeldBefore(ordered: readonly WalletTrade[], sale: WalletTrade): number | null {
  let held = 0;
  for (const trade of ordered) {
    if (trade === sale) break;
    if (trade.mint !== sale.mint) continue;
    const amount = Number(trade.tokensRaw) / 10 ** trade.decimals;
    held += trade.side === "buy" ? amount : -amount;
  }
  return held > 0 ? held : null;
}

export type PaperSummary = Readonly<{
  spentSol: number;
  /** What came back, and what is held now at the price now (null when a held token has no price). */
  receivedSol: number;
  heldSol: number | null;
  /** Held tokens with no price now — counted at zero. */
  unpriced: number;
  resultSol: number | null;
  pct: number | null;
  feesSol: number;
  filled: number;
  missed: number;
}>;

/** The copy at the price now. */
export function paperSummary(copy: PaperCopy, prices: ReadonlyMap<string, number | null>, solUsd: number | null): PaperSummary {
  /* Without SOL's price nothing is in SOL; a held token with no price (dead, mostly) counts at zero — said, never hidden. */
  let heldSol: number | null = solUsd && solUsd > 0 ? 0 : Object.keys(copy.positions).length > 0 ? null : 0;
  let unpriced = 0;
  for (const [mint, position] of Object.entries(copy.positions)) {
    const usd = prices.get(mint) ?? null;
    if (heldSol === null) break;
    if (usd === null || !(usd > 0)) {
      unpriced += 1;
      continue;
    }
    heldSol += position.tokens * (usd / solUsd!);
  }
  const resultSol = heldSol === null ? null : copy.receivedSol + heldSol - copy.spentSol;
  return {
    spentSol: copy.spentSol,
    receivedSol: copy.receivedSol,
    heldSol,
    unpriced,
    resultSol,
    pct: resultSol !== null && copy.spentSol > 0 ? (resultSol / copy.spentSol) * 100 : null,
    feesSol: copy.feesSol,
    filled: copy.filledCount ?? copy.fills.filter((fill) => fill.missed === null).length,
    missed: copy.missedCount ?? copy.fills.filter((fill) => fill.missed !== null).length,
  };
}
