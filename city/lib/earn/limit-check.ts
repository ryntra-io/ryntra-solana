/**
 * Every mint checked before Sell Higher offers it (CITY-97; spec: «лише перевірені mint», «сумісність перевіряємо до
 * запуску»). Three gates, all of them, for every market:
 *
 * 1. **Who it is.** SOL and USDC are named by their mints. A stock must be a row of the stock universe
 *    (`lib/stocks/universe.server.ts`): named by its issuer's own catalogue, a listed share (never a pre-IPO token,
 *    which is never income and never collateral), verified by the venue, not halted by its issuer, and still one the
 *    issuer supports buying.
 * 2. **What the mint can do.** Read from the chain: the token program, and every Token-2022 extension on the mint must
 *    be one a limit order is known to be safe with. A transfer hook, a transfer fee, a non-transferable or an
 *    interest-bearing mint is refused; so is a paused mint, or one whose new accounts start frozen. An extension this
 *    list does not know is refused too — a new one is added here after it is checked, never assumed.
 * 3. **Where it trades.** The pool is the program's own and takes limit orders now (`LimitPool.limitOrders`), its two
 *    mints are exactly the asset and the quote, and each under the token program its mint lives in.
 *
 * Pure: the facts come in, the verdict goes out with its reason (for the server's log, never the screen).
 */

import { SOLANA_MAINNET_USDC_MINT } from '../../../lib/solana/send-kinds.ts';
import { SOL_MINT } from './lst.ts';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** The quotes an order is paid in. */
export const LIMIT_QUOTES: ReadonlyMap<string, Readonly<{ symbol: string; decimals: number }>> = new Map([
  [SOL_MINT, { symbol: 'SOL', decimals: 9 }],
  [SOLANA_MAINNET_USDC_MINT, { symbol: 'USDC', decimals: 6 }],
]);

/**
 * Token-2022 extensions a limit order is safe with on a stock's mint: the metadata and group pointers, the Scaled UI
 * multiplier (handled by `limit.ts`), the issuer's permanent delegate and pause (an issuer's power, said in Details),
 * the default account state when not frozen, a close authority, and confidential transfers (inactive for plain ones).
 */
export const SAFE_EXTENSIONS: ReadonlySet<string> = new Set([
  'MetadataPointer',
  'TokenMetadata',
  'GroupPointer',
  'TokenGroup',
  'GroupMemberPointer',
  'TokenGroupMember',
  'ScaledUiAmountConfig',
  'PermanentDelegate',
  'PausableConfig',
  'DefaultAccountState',
  'MintCloseAuthority',
  'ConfidentialTransferMint',
]);

/** The mint facts the check reads — `lib/stocks/asset.server.ts`'s `OnchainMint`, the fields it needs. */
export type MintFacts = Readonly<{
  programKind: string;
  extensions: readonly string[];
  transferFeeConfig: Readonly<{ older: Readonly<{ basisPoints: number }>; newer: Readonly<{ basisPoints: number }> }> | null;
  pausable: Readonly<{ paused: boolean }> | null;
  defaultAccountFrozen: boolean | null;
}>;

/** A stock row's facts the check reads — `lib/stocks/universe.server.ts`'s `StockRow`, the fields it needs. */
export type StockFacts = Readonly<{
  representation: Readonly<{
    mint: string;
    issuerConfirmation: string;
    instrument: Readonly<{ class: string; unitBasis: string }>;
    tradingHalted: boolean | null;
  }>;
  market: Readonly<{ verified: boolean }>;
  lifecycle: Readonly<{ tradable: boolean }>;
}>;

export type Verdict = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

const ok: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** Gate 1 for a stock: who it is. */
export function checkStockRow(row: StockFacts | null, mint: string): Verdict {
  if (!row) return no('not in the stock universe');
  const r = row.representation;
  if (r.mint !== mint) return no('the row names another mint');
  if (r.issuerConfirmation !== 'issuer-catalogue') return no('not named by its issuer');
  if (r.instrument.class !== 'listed-equity' || r.instrument.unitBasis !== 'share') return no('not a listed share');
  if (r.tradingHalted === true) return no('halted by its issuer');
  if (!row.market.verified) return no('not verified by the venue');
  if (!row.lifecycle.tradable) return no('the issuer no longer supports buying it');
  return ok;
}

/** Gate 2: what the mint can do. */
export function checkMintFacts(facts: MintFacts | null): Verdict {
  if (!facts) return no('the mint was not read');
  if (facts.programKind !== 'SPL_TOKEN' && facts.programKind !== 'TOKEN_2022') return no(`unknown token program ${facts.programKind}`);
  for (const extension of facts.extensions) if (!SAFE_EXTENSIONS.has(extension) && extension !== 'TransferFeeConfig') return no(`extension ${extension}`);
  if (facts.transferFeeConfig && (facts.transferFeeConfig.older.basisPoints > 0 || facts.transferFeeConfig.newer.basisPoints > 0)) return no('a transfer fee');
  if (facts.pausable?.paused) return no('paused');
  if (facts.defaultAccountFrozen === true) return no('new accounts start frozen');
  return ok;
}

/** The pool's facts the check reads — `LimitPool` from the engine. */
export type PoolFacts = Readonly<{
  enabled: boolean;
  limitOrders: boolean;
  tokenX: Readonly<{ mint: string; program: string }>;
  tokenY: Readonly<{ mint: string; program: string }>;
}>;

/** Gate 3: where it trades — and which side of the pool the asset is. */
export function checkLimitPool(pool: PoolFacts | null, asset: string, quote: string): Readonly<{ ok: true; assetIsX: boolean }> | Readonly<{ ok: false; reason: string }> {
  if (!pool) return { ok: false, reason: 'the pool was not read' };
  if (!pool.enabled) return { ok: false, reason: 'the pool is disabled' };
  if (!pool.limitOrders) return { ok: false, reason: 'the pool takes no limit orders' };
  const pair = [pool.tokenX.mint, pool.tokenY.mint];
  if (!(pair.includes(asset) && pair.includes(quote)) || asset === quote) return { ok: false, reason: 'the pool is another pair' };
  for (const token of [pool.tokenX, pool.tokenY]) if (token.program !== TOKEN && token.program !== TOKEN_2022) return { ok: false, reason: 'unknown token program' };
  return { ok: true, assetIsX: pool.tokenX.mint === asset };
}
