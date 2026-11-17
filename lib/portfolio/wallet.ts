/**
 * The wallet's own coins and its liquid staking tokens, as positions.
 *
 * Two readings of the same facts, the first that answers wins:
 *
 * 1. **Helius DAS** `getAssetsByOwner` with fungible tokens and the native balance shown — one call for every coin, its
 *    symbol and, for the coins Helius prices, a price. Only where the deployment's mainnet node is Helius
 *    (`RYNTRA_SOLANA_RPC_MAINNET`, `docs/research/helius-2026-11-10/REPORT.md`: «Вузол проду — Helius»), because the key
 *    rides in that URL and nowhere else.
 * 2. **The engine's own reading** — the wallet's token accounts of both token programs (`getTokenAccountsByOwner`,
 *    `jsonParsed`) and its lamports; prices come from the engine's catalogue afterwards.
 *
 * An LST is a coin whose mint is in {@link LST_MINTS}: it is the same row, drawn as staking, and it leaves the same way —
 * one swap. NFTs (a pool position's own, among them) are left out: a balance of exactly one of a zero-decimal mint.
 *
 * Pure: the JSON in, positions out.
 */

import {
  NATIVE_SOL_MINT,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
  exitWhole,
  rawText,
  refs,
  unitsOf,
  type PortfolioPosition,
} from "./model.ts";

/**
 * Liquid staking tokens: staked SOL as a coin. Each mint here is one this repository already names
 * (`lib/solana/holdings-catalog.server.ts` `KNOWN_MINTS`) or one of the long-standing stake pools' own mints.
 */
export const LST_MINTS: Readonly<Record<string, string>> = Object.freeze({
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "JitoSOL",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "mSOL",
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: "bSOL",
  "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm": "INF",
  jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v: "JupSOL",
  he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A: "hSOL",
  Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ: "dSOL",
  BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs: "bonkSOL",
});

export const isLst = (mint: string): boolean => Object.hasOwn(LST_MINTS, mint);

/** One coin of the wallet before it is priced. `priceUsd` is the reading's own price, where it carried one. */
export type WalletCoin = Readonly<{
  mint: string;
  symbol: string | null;
  decimals: number;
  amountRaw: string;
  program: string;
  /** The token account it sits in; null for native SOL. */
  account: string | null;
  priceUsd: number | null;
}>;

export type WalletRead = Readonly<{
  coins: readonly WalletCoin[];
  /** Native SOL, lamports; null where it was not read. */
  lamports: string | null;
  /** SOL's price as the reading stated it; null where it did not. */
  solUsd: number | null;
}>;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const address = (value: unknown): string | null => {
  const clean = text(value);
  return clean && BASE58.test(clean) ? clean : null;
};

function decimalsOf(value: unknown): number | null {
  const n = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= 18 ? n : null;
}

function priceOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : typeof value === "bigint" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** An NFT — a pool position's among them — is one of a zero-decimal mint: never a coin. */
const isNft = (decimals: number, amountRaw: string): boolean => decimals === 0 && amountRaw === "1";

const programOf = (value: unknown): string => {
  const clean = text(value);
  return clean === TOKEN_2022_PROGRAM ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;
};

/**
 * The answer of DAS `getAssetsByOwner` (`displayOptions.showFungible`, `showNativeBalance`), parsed with big integers
 * so a raw balance past 2^53 stays exact. Fungible items only; an item without a mint, decimals or a positive balance
 * is dropped, not guessed.
 */
export function walletFromDas(result: unknown): WalletRead {
  const coins: WalletCoin[] = [];
  let lamports: string | null = null;
  let solUsd: number | null = null;
  if (isObject(result)) {
    const items = Array.isArray(result.items) ? result.items : [];
    for (const item of items) {
      if (!isObject(item)) continue;
      const kind = text(item.interface);
      if (kind !== "FungibleToken" && kind !== "FungibleAsset") continue;
      const info = isObject(item.token_info) ? item.token_info : null;
      const mint = address(item.id);
      if (!info || !mint) continue;
      const decimals = decimalsOf(info.decimals);
      const amountRaw = rawText(info.balance);
      if (decimals === null || amountRaw === null || amountRaw === "0" || isNft(decimals, amountRaw)) continue;
      const content = isObject(item.content) ? item.content : null;
      const metadata = content && isObject(content.metadata) ? content.metadata : null;
      const price = isObject(info.price_info) && text(info.price_info.currency)?.toUpperCase() !== "EUR" ? priceOf(info.price_info.price_per_token) : null;
      coins.push({
        mint,
        symbol: text(info.symbol) ?? (metadata ? text(metadata.symbol) : null),
        decimals,
        amountRaw,
        program: programOf(info.token_program),
        account: address(info.associated_token_address),
        priceUsd: price,
      });
    }
    const native = isObject(result.nativeBalance) ? result.nativeBalance : null;
    if (native) {
      lamports = rawText(native.lamports);
      solUsd = priceOf(native.price_per_sol);
    }
  }
  return { coins: mergeByMint(coins), lamports, solUsd };
}

/**
 * The engine's own reading: the `value` of `getTokenAccountsByOwner` (`jsonParsed`) for each token program, and the
 * wallet's lamports. Several accounts of one mint are one coin.
 */
export function walletFromAccounts(byProgram: Readonly<Record<string, unknown>>, lamports: unknown): WalletRead {
  const coins: WalletCoin[] = [];
  for (const [program, value] of Object.entries(byProgram)) {
    const entries = Array.isArray(value) ? value : [];
    for (const entry of entries) {
      if (!isObject(entry)) continue;
      const account = isObject(entry.account) ? entry.account : null;
      const data = account && isObject(account.data) ? account.data : null;
      const parsed = data && isObject(data.parsed) ? data.parsed : null;
      const info = parsed && isObject(parsed.info) ? parsed.info : null;
      const amount = info && isObject(info.tokenAmount) ? info.tokenAmount : null;
      const mint = info ? address(info.mint) : null;
      if (!info || !amount || !mint) continue;
      if (text(info.state) === "frozen") continue;
      const decimals = decimalsOf(amount.decimals);
      const amountRaw = rawText(amount.amount);
      if (decimals === null || amountRaw === null || amountRaw === "0" || isNft(decimals, amountRaw)) continue;
      coins.push({ mint, symbol: null, decimals, amountRaw, program: programOf(program), account: address(entry.pubkey), priceUsd: null });
    }
  }
  return { coins: mergeByMint(coins), lamports: rawText(lamports), solUsd: null };
}

/** Several accounts of one mint: one coin, their amounts added; the first account named. */
function mergeByMint(coins: readonly WalletCoin[]): WalletCoin[] {
  const byMint = new Map<string, WalletCoin>();
  for (const coin of coins) {
    const seen = byMint.get(coin.mint);
    if (!seen) {
      byMint.set(coin.mint, coin);
      continue;
    }
    byMint.set(coin.mint, { ...seen, amountRaw: (BigInt(seen.amountRaw) + BigInt(coin.amountRaw)).toString(), symbol: seen.symbol ?? coin.symbol, priceUsd: seen.priceUsd ?? coin.priceUsd });
  }
  return [...byMint.values()];
}

/** Positions of a wallet read: native SOL first, then every coin; an LST is drawn as staking. Unpriced here. */
export function walletPositions(read: WalletRead, readAt: string): PortfolioPosition[] {
  const out: PortfolioPosition[] = [];
  if (read.lamports !== null && read.lamports !== "0") {
    out.push(coinPosition({ mint: NATIVE_SOL_MINT, symbol: "SOL", decimals: 9, amountRaw: read.lamports, program: SYSTEM_PROGRAM, account: null, priceUsd: read.solUsd }, readAt, "native"));
  }
  for (const coin of read.coins) out.push(coinPosition(coin, readAt, coin.mint === NATIVE_SOL_MINT ? "wrapped" : "coin"));
  return out;
}

function coinPosition(coin: WalletCoin, readAt: string, form: "native" | "wrapped" | "coin"): PortfolioPosition {
  const lst = isLst(coin.mint);
  const symbol = coin.symbol ?? LST_MINTS[coin.mint] ?? (form === "native" ? "SOL" : null);
  const usd = coin.priceUsd === null ? null : unitsOf(coin.amountRaw, coin.decimals) * coin.priceUsd;
  return {
    /* Native SOL and wrapped SOL share a mint, so the id names which one. */
    id: form === "native" ? "wallet:sol" : `wallet:${coin.mint}`,
    protocol: "wallet",
    platform: null,
    kind: lst ? "lst" : "coin",
    state: "read",
    origin: "chain",
    label: form === "wrapped" ? "wSOL" : symbol,
    value: { usd, sol: null },
    earned: null,
    tokens: [{ mint: coin.mint, symbol, decimals: coin.decimals, amountRaw: coin.amountRaw, usd, role: "held" }],
    inRange: null,
    exit: exitWhole("swap"),
    refs: refs({ program: coin.program, account: coin.account }),
    readAt,
  };
}
