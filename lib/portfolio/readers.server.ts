/**
 * The portfolio's readers wired to the deployment: the mainnet node, the engine's own reads, the keys the
 * server already holds. The only file of `lib/portfolio/` that reads `process.env` and opens a connection.
 *
 * | Source | Read | Needs |
 * |---|---|---|
 * | `wallet` | Helius DAS `getAssetsByOwner` where the mainnet node is Helius; else the token accounts of both programs and the lamports | `RYNTRA_SOLANA_RPC_MAINNET` (Helius) for DAS; nothing for the rest |
 * | `native-stake` | `getProgramAccounts` of the stake program, by staker and by withdrawer; the epoch | a node that serves indexed reads (Helius does) |
 * | `meteora-dlmm`, `meteora-damm-v2` | the pools reader of the engine (`readWalletPositions`) | — |
 * | `meteora-dlmm-pro` | earning's door (`earnProPositionsAnswer`, `earnProPiersAnswer`), mainnet only | |
 * | `jupiter-lend` | the Earn adapter (`lib/earn/jupiter-adapter.ts`), the shares counted from the wallet's own read | `RYNTRA_JUPITER_LEND_API_KEY` or `RYNTRA_JUPITER_API_KEY` |
 * | `kamino` | Kamino's public API: obligations in the main market and its reserves | — |
 * | `jupiter-portfolio` | `GET /portfolio/v1/positions/{owner}`, 100 credits; skipped while the key's window is low | `RYNTRA_JUPITER_API_KEY` |
 *
 * Nothing here signs, sends or writes. A reason a source gives is a code, never a body or a URL: a node's URL carries
 * its key.
 */

import "server-only";

import { parseJsonWithBigInts } from "@solana/rpc-spec-types";

import type { EarnProPier } from "../api/v1/contract.ts";
import { readHeld as readHeldFromChain } from "../earn/chain.server.ts";
import type { EarnChainRead } from "../earn/chain.ts";
import { jupiterLendAdapter } from "../earn/jupiter-adapter.ts";
import { KAMINO_API_ENV } from "../earn/kamino.ts";
import { JUPITER_KEY_ENV, jupiterLendKey } from "../earn/providers.ts";
import { earnProGate } from "../earn-pro/gate.ts";
import { earnProPiersAnswer, earnProPositionsAnswer } from "../earn-pro/service.server.ts";
import { readWalletPositions } from "../liquidity/catalog/chain.server.ts";
import { readHoldingsCatalog } from "../solana/holdings-catalog.server.ts";
import { jupiterBackgroundAllowed, noteJupiterResponse } from "../solana/jupiter-budget.ts";
import { createSolanaRpcHandle, readBoundedRpcResponse, resolveEndpoints, withRpcDiscipline, type SolanaEndpoint } from "../solana/rpc.ts";
import { KAMINO_API_BASE, KAMINO_MAIN_MARKET, jupiterLendPosition, kaminoPositions, kaminoReservesFrom, type KaminoReserve } from "./lend.ts";
import { dlmmProPosition, liquidityPosition } from "./meteora.ts";
import { STAKE_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, type PortfolioPosition, type SourceReason } from "./model.ts";
import { JUPITER_PORTFOLIO_BASE_URL, projectionPositions } from "./projection.ts";
import { minuteBudget, type PortfolioDeps, type PortfolioReader, type PriceRead, type SourceRead } from "./service.ts";
import { STAKER_OFFSET, WITHDRAWER_OFFSET, stakeAccountsFrom, stakePositions } from "./stake.ts";
import { walletFromAccounts, walletFromDas, walletPositions, type WalletRead } from "./wallet.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The engine's own ceiling for one answer (`lib/solana/rpc.ts`): a busy wallet's thousand coins with their metadata fit. */
const MAX_BYTES = 8 * 1024 * 1024;
const iso = () => new Date().toISOString();

/* ------------------------------------------------------------------ the wallet */

/** The mainnet node when it is Helius's: DAS is served on the same URL, with the key it already carries. */
export function heliusEndpoint(endpoints: readonly SolanaEndpoint[] = resolveEndpoints("mainnet")): SolanaEndpoint | null {
  return endpoints.find((endpoint) => endpoint.fromEnv && /(^|\.)helius-rpc\.com$/i.test(endpoint.host)) ?? null;
}

const DAS_LIMIT = 1_000;
const DAS_PAGES = 3;

async function readDas(endpoint: SolanaEndpoint, owner: string, signal: AbortSignal): Promise<WalletRead> {
  const items: unknown[] = [];
  let first: Record<string, unknown> | null = null;
  for (let page = 1; page <= DAS_PAGES; page += 1) {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `portfolio-${page}`,
        method: "getAssetsByOwner",
        params: { ownerAddress: owner, page, limit: DAS_LIMIT, displayOptions: { showFungible: true, showNativeBalance: true, showZeroBalance: false } },
      }),
      signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`DAS answered HTTP ${response.status}`);
    /* Big integers stay exact: a raw balance past 2^53 is an ordinary memecoin's. */
    const body = parseJsonWithBigInts(await readBoundedRpcResponse(response, MAX_BYTES, endpoint.host)) as { result?: unknown; error?: unknown };
    if (body.error || typeof body.result !== "object" || body.result === null) throw new Error("DAS did not answer with a result");
    const result = body.result as Record<string, unknown>;
    first ??= result;
    const pageItems = Array.isArray(result.items) ? result.items : [];
    items.push(...pageItems);
    if (pageItems.length < DAS_LIMIT) break;
  }
  return walletFromDas({ ...first, items });
}

async function readAccounts(owner: string, signal: AbortSignal): Promise<WalletRead> {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 6_000, retries: 0 });
  const byProgram = async (program: string) =>
    withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getTokenAccountsByOwner(owner as never, { programId: program as never }, { encoding: "jsonParsed", commitment: "confirmed" }).send({ abortSignal: AbortSignal.any([abortSignal, signal]) }),
    );
  const [classic, extended, balance] = await Promise.all([
    byProgram(TOKEN_PROGRAM),
    byProgram(TOKEN_2022_PROGRAM),
    withRpcDiscipline(handle, (abortSignal) => handle.rpc.getBalance(owner as never, { commitment: "confirmed" }).send({ abortSignal: AbortSignal.any([abortSignal, signal]) })),
  ]);
  return walletFromAccounts({ [TOKEN_PROGRAM]: (classic as { value?: unknown }).value, [TOKEN_2022_PROGRAM]: (extended as { value?: unknown }).value }, (balance as { value?: unknown }).value);
}

/**
 * One wallet read shared by the coins and by Jupiter Lend's share count within one portfolio read — kept shorter than
 * «Ще раз» waits, so a read asked again after an action never shows the wallet as it was.
 */
const walletReads = new Map<string, Readonly<{ at: number; promise: Promise<Readonly<{ read: WalletRead; readAt: string }>> }>>();
const WALLET_TTL_MS = 4_000;

function readWalletOnce(owner: string, signal: AbortSignal): Promise<Readonly<{ read: WalletRead; readAt: string }>> {
  const hit = walletReads.get(owner);
  if (hit && Date.now() - hit.at < WALLET_TTL_MS) return hit.promise;
  const promise = (async () => {
    const helius = heliusEndpoint();
    if (helius) {
      try {
        return { read: await readDas(helius, owner, signal), readAt: iso() };
      } catch {
        /* The engine's own reading answers instead. */
      }
    }
    return { read: await readAccounts(owner, signal), readAt: iso() };
  })();
  if (walletReads.size > 500) walletReads.delete(walletReads.keys().next().value!);
  walletReads.set(owner, { at: Date.now(), promise });
  promise.catch(() => walletReads.delete(owner));
  return promise;
}

const walletReader: PortfolioReader = async (owner, signal) => {
  const { read, readAt } = await readWalletOnce(owner, signal);
  return { ok: true, positions: walletPositions(read, readAt), readAt, solUsd: read.solUsd };
};

/* ------------------------------------------------------------------ native stake */

const stakeReader: PortfolioReader = async (owner, signal) => {
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 8_000, retries: 0 });
  const by = (offset: number) =>
    withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getProgramAccounts(STAKE_PROGRAM as never, {
          encoding: "jsonParsed",
          commitment: "confirmed",
          filters: [{ memcmp: { offset: BigInt(offset), bytes: owner as never, encoding: "base58" } }],
        } as never)
        .send({ abortSignal: AbortSignal.any([abortSignal, signal]) }),
    );
  const [asStaker, asWithdrawer, epochInfo] = await Promise.all([
    by(STAKER_OFFSET),
    by(WITHDRAWER_OFFSET),
    withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo({ commitment: "confirmed" }).send({ abortSignal })).catch(() => null),
  ]);
  const unwrap = (value: unknown) => (Array.isArray(value) ? value : (value as { value?: unknown })?.value);
  const epoch = epochInfo && typeof (epochInfo as { epoch?: unknown }).epoch === "bigint" ? ((epochInfo as { epoch: bigint }).epoch) : null;
  const readAt = iso();
  const accounts = stakeAccountsFrom(unwrap(asStaker), unwrap(asWithdrawer));
  return { ok: true, positions: stakePositions(accounts, owner, epoch, BigInt(Math.floor(Date.now() / 1000)), readAt), readAt };
};

/* ------------------------------------------------------------------ Meteora */

function meteoraReader(kind: "dlmm" | "damm-v2"): PortfolioReader {
  return async (owner) => {
    const read = (await readWalletPositions(owner))[kind];
    if (!read.ok) return { ok: false, reason: /did not answer within/.test(read.reason) ? "TIMEOUT" : "REFUSED" };
    const positions = read.value.map((position) => liquidityPosition(position));
    return { ok: true, positions, readAt: iso() };
  };
}

/** DLMM Pro, through earning's door — and only on mainnet: a devnet stand's positions are not anybody's money. */
function dlmmProReader(env: Env): PortfolioReader | undefined {
  const gate = earnProGate(env);
  if (!gate.open || gate.network !== "mainnet") return undefined;
  return async (owner) => {
    const [answer, piers] = await Promise.all([earnProPositionsAnswer(owner, env), earnProPiersAnswer(env).catch(() => null)]);
    if (!answer || answer.network !== "mainnet") return { ok: false, reason: "CLOSED" };
    const pierOf = new Map<string, EarnProPier>((piers?.piers ?? []).map((pier) => [pier.address, pier]));
    const readAt = iso();
    const positions = answer.positions.map((position) => dlmmProPosition(position, pierOf.get(position.pool) ?? null, readAt)).filter((p): p is PortfolioPosition => p !== null);
    return { ok: true, positions, readAt };
  };
}

/* ------------------------------------------------------------------ Jupiter Lend */

let lendMarkets: Readonly<{ at: number; read: Extract<Awaited<ReturnType<ReturnType<typeof jupiterLendAdapter>["markets"]>>, { ok: true }> }> | null = null;
const LEND_MARKETS_TTL_MS = 5 * 60_000;

function jupiterLendReader(env: Env): PortfolioReader {
  const key = jupiterLendKey(env);
  if (!key) return async () => ({ ok: false, reason: "NO_KEY" });
  return async (owner, signal) => {
    /* The shares are counted from the wallet's own read when it answered; else the Earn reader asks the chain itself. */
    const readHeld = async (who: string, mints: readonly string[]): Promise<EarnChainRead> => {
      try {
        const { read, readAt } = await readWalletOnce(who, signal);
        const held = new Map<string, bigint | null>(mints.map((mint) => [mint, 0n]));
        for (const coin of read.coins) if (held.has(coin.mint)) held.set(coin.mint, BigInt(coin.amountRaw));
        return { held, host: "wallet", readAt };
      } catch {
        return readHeldFromChain(who, mints);
      }
    };
    const adapter = jupiterLendAdapter({ key, readHeld });
    /* The markets are the same for every wallet: one read serves them all for a few minutes. */
    const kept = lendMarkets && Date.now() - lendMarkets.at < LEND_MARKETS_TTL_MS ? lendMarkets.read : null;
    const markets = kept ?? (await adapter.markets());
    if (!markets.ok) return { ok: false, reason: markets.code === "NO_KEY" ? "NO_KEY" : markets.code === "UNREADABLE" ? "UNREADABLE" : "REFUSED" };
    if (!kept) lendMarkets = { at: Date.now(), read: markets };
    const read = await adapter.positions(owner, markets.markets);
    if (!read.ok) return { ok: false, reason: read.code === "NO_KEY" ? "NO_KEY" : "REFUSED" };
    const marketOf = new Map(markets.markets.map((market) => [market.id, market]));
    const positions = read.positions
      .map((position) => {
        const market = marketOf.get(position.marketId);
        return jupiterLendPosition(position, market?.share.mint ?? null, market?.priceUsd ?? null);
      })
      .filter((p): p is PortfolioPosition => p !== null);
    return { ok: true, positions, readAt: iso() };
  };
}

/* ------------------------------------------------------------------ Kamino */

type Fetched = Readonly<{ ok: true; value: unknown; headers: Headers }> | Readonly<{ ok: false; reason: SourceReason }>;

async function getJson(url: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Fetched> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json", ...headers }, signal, cache: "no-store" });
    if (!response.ok) return { ok: false, reason: "REFUSED" };
    const text = await readBoundedRpcResponse(response, MAX_BYTES, new URL(url).host);
    return { ok: true, value: JSON.parse(text) as unknown, headers: response.headers };
  } catch (failure) {
    const timedOut = failure instanceof Error && /timeout|abort/i.test(failure.name + failure.message);
    return { ok: false, reason: timedOut ? "TIMEOUT" : failure instanceof SyntaxError ? "UNREADABLE" : "REFUSED" };
  }
}

const reserveMemory = new Map<string, Readonly<{ at: number; reserves: ReadonlyMap<string, KaminoReserve> }>>();
const RESERVES_TTL_MS = 10 * 60_000;

function kaminoReader(env: Env): PortfolioReader {
  const base = (env[KAMINO_API_ENV]?.trim() || KAMINO_API_BASE).replace(/\/+$/, "");
  return async (owner, signal) => {
    const market = KAMINO_MAIN_MARKET;
    const kept = reserveMemory.get(market);
    const [obligations, reservesRead] = await Promise.all([
      getJson(`${base}/kamino-market/${market}/users/${owner}/obligations`, signal),
      kept && Date.now() - kept.at < RESERVES_TTL_MS ? Promise.resolve(null) : getJson(`${base}/kamino-market/${market}/reserves/metrics`, signal),
    ]);
    if (!obligations.ok) return { ok: false, reason: obligations.reason };
    let reserves = kept?.reserves ?? new Map<string, KaminoReserve>();
    if (reservesRead?.ok) {
      reserves = kaminoReservesFrom(reservesRead.value);
      reserveMemory.set(market, { at: Date.now(), reserves });
    }
    const readAt = iso();
    return { ok: true, positions: kaminoPositions(obligations.value, market, reserves, readAt), readAt };
  };
}

/* ------------------------------------------------------------------ Jupiter Portfolio */

/** This process's share of the key's window for the projection: it is background work beside a person's own quotes. */
const portfolioBudget = minuteBudget(20);
const projections = new Map<string, Readonly<{ at: number; read: SourceRead }>>();
const PROJECTION_TTL_MS = 2 * 60_000;

function jupiterPortfolioReader(env: Env): PortfolioReader {
  const key = env[JUPITER_KEY_ENV]?.trim();
  if (!key) return async () => ({ ok: false, reason: "NO_KEY" });
  return async (owner, signal) => {
    const hit = projections.get(owner);
    if (hit && Date.now() - hit.at < PROJECTION_TTL_MS) return hit.read;
    if (!jupiterBackgroundAllowed() || !portfolioBudget()) return { ok: false, reason: "BUDGET" };
    const answer = await getJson(`${JUPITER_PORTFOLIO_BASE_URL}/positions/${owner}`, signal, { "x-api-key": key });
    if (answer.ok) noteJupiterResponse(answer.headers);
    if (!answer.ok) return { ok: false, reason: answer.reason };
    const readAt = iso();
    const read: SourceRead = { ok: true, positions: projectionPositions(answer.value, readAt), readAt };
    if (projections.size > 500) projections.delete(projections.keys().next().value!);
    projections.set(owner, { at: Date.now(), read });
    return read;
  };
}

/* ------------------------------------------------------------------ prices */

/** Dollars and symbols from the engine's catalogue — its memory, its keyed host and its keyless one (`readHoldingsCatalog`). */
async function readPrices(mints: readonly string[], signal: AbortSignal): Promise<PriceRead> {
  const catalog = await readHoldingsCatalog(mints, mints, signal);
  const out = new Map<string, Readonly<{ usd: number | null; symbol: string | null }>>();
  for (const [mint, entry] of Object.entries(catalog.byMint)) {
    const usd = entry.usdPrice === null ? null : Number(entry.usdPrice);
    out.set(mint, { usd: usd !== null && Number.isFinite(usd) && usd > 0 ? usd : null, symbol: entry.symbol });
  }
  return out;
}

/** Every reader the deployment serves; one it does not is left out, which the portfolio reads as `CLOSED`. */
export function portfolioDeps(env: Env = process.env): PortfolioDeps {
  const readers: Partial<Record<string, PortfolioReader>> = {
    wallet: walletReader,
    "native-stake": stakeReader,
    "meteora-dlmm": meteoraReader("dlmm"),
    "meteora-damm-v2": meteoraReader("damm-v2"),
    "jupiter-lend": jupiterLendReader(env),
    kamino: kaminoReader(env),
    "jupiter-portfolio": jupiterPortfolioReader(env),
  };
  const pro = dlmmProReader(env);
  if (pro) readers["meteora-dlmm-pro"] = pro;
  return { readers, prices: readPrices };
}
