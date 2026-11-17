/**
 * Deposits and borrows: Jupiter Lend and Kamino Lend, as positions.
 *
 * **Jupiter Lend (Earn)** is read by the engine's own adapter (`lib/earn/jupiter-adapter.ts`): the wallet's jlToken
 * shares from the chain, their worth at the exchange rate the Lend API states, what went in, net, from its earnings
 * read. A deposit leaves in one step — the Earn withdraw the engine already builds — unless the market can give back
 * only part of it now (`availableRaw` below the worth: `LIQUIDITY`).
 *
 * **Kamino Lend** is read from Kamino's public API: a wallet's obligations in a market
 * (`GET /kamino-market/{market}/users/{owner}/obligations`) and the market's reserves
 * (`GET /kamino-market/{market}/reserves/metrics`, the read recorded in
 * `docs/reviews/inputs/canon-v5-2026-09-23/FACTS-protocols.md`). An obligation's figures are Kamino's: what it supplied
 * and what it borrowed in dollars (`refreshedStats`, else each slot's `marketValueSf` — a fraction scaled by 2^60). The
 * reader takes the field names the API is known to use and the alternates beside them, and a figure it cannot read is
 * null, never zero. An obligation with a borrow is two rows — the deposit (it leaves only after the borrow, `DEBT`) and
 * the borrow (`REPAY`). The engine builds no Kamino exit yet (`lib/earn/kamino.ts`: read-only), so a deposit's exit is
 * `NO_ROUTE`.
 *
 * Pure: answers in, positions out.
 */

import type { EarnPosition } from "../earn/model.ts";
import { JUPITER_LEND_EARN_PROGRAM } from "../earn/jupiter.ts";
import { exitBlocked, exitWhole, rawText, refs, unitsOf, type PortfolioPosition, type PortfolioToken } from "./model.ts";

/* ------------------------------------------------------------------ Jupiter Lend */

/**
 * One Earn position. `priceUsd` is the asset's price as the Lend API stated it with the market, where it did; the
 * caller's prices fill the rest. Null for a position the chain says is empty, or whose shares were not read.
 */
export function jupiterLendPosition(position: EarnPosition, shareMint: string | null, priceUsd: number | null): PortfolioPosition | null {
  if (position.sharesRaw === null || position.sharesRaw === "0") return null;
  const { asset } = position;
  const underlying = position.underlyingRaw;
  const usd = underlying !== null && priceUsd !== null ? unitsOf(underlying, asset.decimals) * priceUsd : null;
  const earnedUsd = position.earnedRaw !== null && priceUsd !== null && BigInt(position.earnedRaw) > 0n ? unitsOf(position.earnedRaw, asset.decimals) * priceUsd : null;
  const tokens: PortfolioToken[] = [
    { mint: asset.mint, symbol: asset.symbol || null, decimals: asset.decimals, amountRaw: underlying, usd, role: "supplied" },
  ];
  if (shareMint) tokens.push({ mint: shareMint, symbol: null, decimals: null, amountRaw: position.sharesRaw, usd: null, role: "share" });
  /* What can leave now: all of it, or the part the market's liquidity allows. */
  const available = position.availableRaw;
  const partBps = underlying === null || available === null || BigInt(underlying) === 0n ? null : Number((BigInt(available) * 10_000n) / BigInt(underlying));
  const exit = partBps === null || partBps >= 10_000 ? exitWhole("lend-withdraw") : exitBlocked("lend-withdraw", "LIQUIDITY", { partBps });
  return {
    id: `jupiter-lend:${asset.mint}`,
    protocol: "jupiter-lend",
    platform: null,
    kind: "deposit",
    state: "read",
    origin: "provider",
    label: asset.symbol || null,
    value: { usd, sol: null },
    /* Earned here is interest already in the worth, not a claim to collect: it is shown, never added twice. */
    earned: earnedUsd === null ? null : { usd: earnedUsd, sol: null },
    tokens,
    inRange: null,
    exit,
    refs: refs({ program: JUPITER_LEND_EARN_PROGRAM, market: position.marketId }),
    readAt: position.readAt,
  };
}

/* ------------------------------------------------------------------ Kamino */

/** Kamino Lend's program, and its main market (the one the reader asks by default). */
export const KAMINO_LEND_PROGRAM = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
export const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
export const KAMINO_API_BASE = "https://api.kamino.finance";

/** The empty slot of an obligation's deposits or borrows names the system program as its reserve. */
const EMPTY_RESERVE = "11111111111111111111111111111111";
const SF = 2n ** 60n;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const address = (value: unknown): string | null => {
  const clean = text(value);
  return clean && BASE58.test(clean) ? clean : null;
};

function pick(source: Json, names: readonly string[]): unknown {
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function dollars(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A Kamino scaled fraction (value × 2^60, as a decimal string) as a number; null for anything else. */
export function fromScaled(value: unknown): number | null {
  const raw = rawText(value);
  if (raw === null) return null;
  const whole = BigInt(raw) / SF;
  const part = BigInt(raw) % SF;
  return Number(whole) + Number((part * 1_000_000n) / SF) / 1_000_000;
}

export type KaminoReserve = Readonly<{ reserve: string; mint: string; symbol: string | null }>;

/** The reserves of a market, from `reserves/metrics`: the reserve's address, its coin's mint and symbol. */
export function kaminoReservesFrom(payload: unknown): ReadonlyMap<string, KaminoReserve> {
  const entries = Array.isArray(payload) ? payload : isObject(payload) && Array.isArray(payload.reserves) ? payload.reserves : [];
  const out = new Map<string, KaminoReserve>();
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const reserve = address(pick(entry, ["reserve", "reserveAddress", "address"]));
    const mint = address(pick(entry, ["liquidityTokenMint", "liquidityMint", "mintAddress", "mint"]));
    if (!reserve || !mint) continue;
    const symbol = text(pick(entry, ["liquidityToken", "symbol", "liquidityTokenSymbol"]));
    out.set(reserve, { reserve, mint, symbol: symbol && !BASE58.test(symbol) ? symbol : null });
  }
  return out;
}

type Slot = Readonly<{ reserve: string; usd: number | null }>;

function slotsOf(list: unknown, reserveNames: readonly string[], valueNames: readonly string[]): Slot[] {
  const out: Slot[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!isObject(entry)) continue;
    const reserve = address(pick(entry, reserveNames));
    if (!reserve || reserve === EMPTY_RESERVE) continue;
    const scaled = fromScaled(pick(entry, valueNames));
    out.push({ reserve, usd: scaled });
  }
  return out;
}

/**
 * The coins of the slots whose reserve the metrics named. A slot of a reserve it did not name stays in the row's worth
 * and out of its coins: a reserve's address is not a mint, and the exit reads the obligation itself (`refs.position`).
 */
function tokensOf(slots: readonly Slot[], reserves: ReadonlyMap<string, KaminoReserve>, role: "supplied" | "borrowed"): PortfolioToken[] {
  const out: PortfolioToken[] = [];
  for (const slot of slots) {
    const known = reserves.get(slot.reserve);
    if (known) out.push({ mint: known.mint, symbol: known.symbol, decimals: null, amountRaw: null, usd: slot.usd, role });
  }
  return out;
}

const sumOf = (slots: readonly Slot[]): number | null => (slots.some((slot) => slot.usd === null) ? null : slots.reduce((sum, slot) => sum + (slot.usd ?? 0), 0));

/** A wallet's obligations in one market, as rows: a deposit for each, a borrow beside it where one stands. */
export function kaminoPositions(payload: unknown, market: string, reserves: ReadonlyMap<string, KaminoReserve>, readAt: string): PortfolioPosition[] {
  const entries = Array.isArray(payload) ? payload : isObject(payload) && Array.isArray(payload.obligations) ? payload.obligations : [];
  const out: PortfolioPosition[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const obligation = address(pick(entry, ["obligationAddress", "address", "obligation"]));
    if (!obligation) continue;
    const state = isObject(entry.state) ? entry.state : {};
    const stats = isObject(entry.refreshedStats) ? entry.refreshedStats : {};
    const deposits = slotsOf(state.deposits, ["depositReserve", "reserve"], ["marketValueSf"]);
    const borrows = slotsOf(state.borrows, ["borrowReserve", "reserve"], ["marketValueSf"]);
    if (deposits.length === 0 && borrows.length === 0) continue;
    const supplied = dollars(pick(stats, ["userTotalDeposit", "totalDeposit"])) ?? sumOf(deposits);
    const owed = dollars(pick(stats, ["userTotalBorrow", "totalBorrow"])) ?? sumOf(borrows);
    const base = { protocol: "kamino" as const, platform: null, state: "read" as const, origin: "provider" as const, inRange: null, readAt, earned: null };
    const where = refs({ program: KAMINO_LEND_PROGRAM, position: obligation, market });
    const symbols = (slots: readonly Slot[]) => slots.map((slot) => reserves.get(slot.reserve)?.symbol).filter(Boolean).join(" · ") || null;
    if (deposits.length > 0) {
      out.push({
        id: `kamino:${obligation}:deposit`,
        ...base,
        kind: "deposit",
        label: symbols(deposits),
        value: { usd: supplied, sol: null },
        tokens: tokensOf(deposits, reserves, "supplied"),
        exit: borrows.length > 0 ? exitBlocked("lend-withdraw", "DEBT") : exitBlocked("lend-withdraw", "NO_ROUTE"),
        refs: where,
      });
    }
    if (borrows.length > 0) {
      out.push({
        id: `kamino:${obligation}:borrow`,
        ...base,
        kind: "borrow",
        label: symbols(borrows),
        value: { usd: owed === null ? null : -owed, sol: null },
        tokens: tokensOf(borrows, reserves, "borrowed"),
        exit: exitBlocked("repay", "REPAY"),
        refs: where,
      });
    }
  }
  return out;
}
