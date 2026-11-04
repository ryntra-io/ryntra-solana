import 'server-only';

import type { GuardStore } from '@/lib/guard/store';
import { readWalletPositions } from '@/lib/liquidity/catalog/chain.server';
import { peekPoolRecord, readPoolRecord } from '@/lib/liquidity/catalog/service.server';
import { LIQUIDITY_POOL_KINDS } from '@/lib/liquidity/model';
import type { LiquidityPosition } from '@/lib/liquidity/studio/contract';
import { deliverOutbox } from '@/lib/monitoring/service.server';
import { onlyRows } from '@/lib/assistant/watch/runtime.server';
import { createSolanaRpcHandle, withRpcDiscipline } from '@/lib/solana/rpc';
import { findStockRow } from '@/lib/stocks/universe.server';
import { LST_BY_MINT, SOL_MINT } from './lst';
import type { RangeRead, StockHeld } from './notes';
import { runEarnWatchPass, type EarnWalletRead } from './notes-watch';
import { MAX_STOCK_MINTS } from './stocks';
import { readScaledConfigs } from './stocks.server';

/**
 * The production side of Earn's server watch (CITY-100): the wallet's pool positions through SOL-2b's own chain read
 * (`readWalletPositions`, its short cache), the Token-2022 coins it holds and the Scaled UI configuration of each through
 * the stocks engine's mint read (`stocks.server.ts`), the tickers from the stocks universe, and the monitoring delivery
 * for the notes it writes (Telegram, the phone's push, the browser's push, quiet hours, retries). Loans join once Earn
 * reads one (`EARN_LOANS`, E10). Reading only; the watch's own record and the notes are the only writes.
 */

const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
/** The coins a pair is named by without asking the venue. */
const KNOWN: ReadonlyMap<string, string> = new Map([[SOL_MINT, 'SOL'], [USDC, 'USDC'], [USDT, 'USDT'], ...[...LST_BY_MINT.values()].map((lst) => [lst.mint, lst.symbol] as const)]);
const NOT_STOCKS: ReadonlySet<string> = new Set(KNOWN.keys());
/** Pool records asked for names in one read, at most. */
const NAMES_AT_MOST = 6;

const shortMint = (mint: string) => `${mint.slice(0, 4)}…`;

type Kinded = Readonly<{ kind: (typeof LIQUIDITY_POOL_KINDS)[number]; position: LiquidityPosition }>;

/** The pair's name: the known coins by their symbols, the rest from the venue's record of the pool when it is at hand. */
async function pairName(item: Kinded, ask: boolean): Promise<string> {
  const x = item.position.amounts.x.asset;
  const y = item.position.amounts.y.asset;
  if (KNOWN.has(x) && KNOWN.has(y)) return `${KNOWN.get(x)}–${KNOWN.get(y)}`;
  const record = peekPoolRecord(item.kind, item.position.pool) ?? (ask ? await readPoolRecord(item.kind, item.position.pool, { meteora: { timeoutMs: 3_000 } }).catch(() => null) : null);
  const pool = record?.pool ?? null;
  const name = (mint: string, side: 'x' | 'y') => KNOWN.get(mint) ?? (pool?.[side].mint === mint ? pool[side].symbol : null) ?? shortMint(mint);
  return `${name(x, 'x')}–${name(y, 'y')}`;
}

async function readPositions(owner: string): Promise<Readonly<{ reads: RangeRead[]; sides: string[] }> | null> {
  const read = await readWalletPositions(owner);
  if (LIQUIDITY_POOL_KINDS.every((kind) => !read[kind].ok)) return null;
  const items: Kinded[] = [];
  for (const kind of LIQUIDITY_POOL_KINDS) {
    const venue = read[kind];
    if (venue.ok) for (const position of venue.value) items.push({ kind, position });
  }
  let asked = 0;
  const reads: RangeRead[] = [];
  for (const item of items) {
    const inRange = item.position.rangeState === 'in_range';
    // Only a position out of range is named in a note: only it may cost a read of the venue's record.
    const pair = inRange ? '' : await pairName(item, asked++ < NAMES_AT_MOST);
    reads.push({ address: item.position.address, pair, inRange });
  }
  const sides = items.flatMap((item) => [item.position.amounts.x.asset, item.position.amounts.y.asset]).filter((mint) => !NOT_STOCKS.has(mint));
  return { reads, sides: [...new Set(sides)] };
}

type Token = Readonly<{ mint: string; raw: bigint; decimals: number }>;

/** The wallet's Token-2022 coins with a balance — where every xStock and its kin live. */
async function readToken2022(owner: string): Promise<Token[] | null> {
  const handle = createSolanaRpcHandle({ network: 'mainnet', timeoutMs: 4_000, retries: 0 });
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getTokenAccountsByOwner(owner as never, { programId: TOKEN_2022 as never }, { encoding: 'jsonParsed', commitment: 'confirmed' }).send({ abortSignal }),
    );
    const value = (response as { value?: unknown }).value;
    if (!Array.isArray(value)) return null;
    const out = new Map<string, Token>();
    for (const entry of value) {
      const info = (entry as { account?: { data?: { parsed?: { info?: { mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } } } } } })?.account?.data?.parsed?.info;
      const mint = typeof info?.mint === 'string' ? info.mint : null;
      const amount = typeof info?.tokenAmount?.amount === 'string' && /^\d+$/.test(info.tokenAmount.amount) ? BigInt(info.tokenAmount.amount) : null;
      const decimals = typeof info?.tokenAmount?.decimals === 'number' ? info.tokenAmount.decimals : null;
      if (!mint || amount === null || decimals === null || amount <= 0n) continue;
      const before = out.get(mint);
      out.set(mint, { mint, raw: (before?.raw ?? 0n) + amount, decimals });
    }
    return [...out.values()];
  } catch {
    return null;
  }
}

async function tickerOf(mint: string): Promise<string> {
  const found = await findStockRow(mint).catch(() => null);
  return found && found.ok && found.row ? found.row.representation.symbol : shortMint(mint);
}

/** One wallet, as Earn's notes need it. */
export async function readEarnWallet(owner: string): Promise<EarnWalletRead> {
  const [pools, tokens] = await Promise.all([readPositions(owner).catch(() => null), readToken2022(owner)]);
  let stocks: EarnWalletRead['stocks'] = null;
  if (tokens !== null) {
    const mints = [...new Set([...tokens.map((t) => t.mint), ...(pools?.sides ?? [])])].filter((mint) => !NOT_STOCKS.has(mint)).slice(0, MAX_STOCK_MINTS);
    const configs = await readScaledConfigs(mints).catch(() => null);
    if (configs !== null) {
      const held: StockHeld[] = [];
      const exposed: string[] = [];
      for (const config of configs) {
        const ticker = await tickerOf(config.mint);
        const token = tokens.find((t) => t.mint === config.mint);
        if (token) held.push({ mint: config.mint, ticker, raw: token.raw, decimals: token.decimals });
        if (token || pools?.sides.includes(config.mint)) exposed.push(ticker);
      }
      stocks = { configs, held, exposed };
    }
  }
  // No loan is read yet: E10 (CITY-101) brings Kamino's read, and with it `EARN_LOANS`.
  return { positions: pools?.reads ?? null, stocks, loans: null };
}

export function runEarnWatch(guard: GuardStore) {
  return runEarnWatchPass({
    guard,
    read: readEarnWallet,
    clock: Date.now,
    /* This pass's own deliveries, sent at once through the monitoring delivery — it sees only their rows. */
    deliver: (rows, atMs) => deliverOutbox(onlyRows(guard, rows), atMs),
  });
}
