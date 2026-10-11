/**
 * «Продати з позиції» — the pure half.
 *
 * What a sale of a company a person holds is decided here once and tested:
 * how much of the position a sum in dollars or a share of it sells — in the
 * mint's raw units, the one amount the execution path takes — what the
 * position is worth, and the company's facts the sale's sheet says, read the
 * same way whether the sheet opens on the company's page or on the position
 * in Portfolio. No fetch, no clock, no React: the page and the sheet hand the
 * facts in.
 */

import type { SpotMarket } from "../../../lib/spot/markets.ts";
import type { StockAsset } from "../../../lib/stocks/asset.server.ts";
import { buyCosts, unitsFromRaw, USDC_DECIMALS, type CheckBasis, type CheckOrderFigures, type SwapCheck } from "../../../lib/stocks/check.ts";
import { companyDisplayName } from "../../../lib/stocks/shelf.ts";
import { MIN_BUY_USD, truthLine } from "./company-model.ts";

type Lang = "en" | "uk";

/**
 * The least a sale typed in dollars is — a dollar, as for a purchase. Selling
 * the whole position is never held to it: a person may always leave a
 * position.
 */
export const MIN_SALE_USD = MIN_BUY_USD;

/** The quick choices are shares of the position — 25 %, 50 %, 75 % and 100 %, as the purchase's are shares of the wallet's USDC; 100 % is exactly what the wallet holds. */
export const SALE_SHARE_PRESETS_PCT = [25, 50, 75, 100] as const;

/** The sum a sale opens on when the position is worth at least that much — the purchase's $10, a default and never advice; a smaller position opens on no sum. */
export const DEFAULT_SALE_USD = 10;

/** A sum within half a cent of the position's value is the whole position: the last fraction of a share is never left behind by rounding. */
const WHOLE_TOLERANCE_USD = 0.005;

/** What the sale's sheet says about the company, read from the same facts its page draws. */
export type SaleAsset = Readonly<{
  mint: string;
  /** The token's symbol — the venue's key, never shown at rest. */
  symbol: string;
  /** The company as a person names it («Apple», never the token's ticker). */
  name: string;
  icon: string | null;
  /** The mint's decimals as the chain states them; null when unread. */
  decimals: number | null;
  /** The Scaled UI Amount multiplier in force; null where the mint carries none. */
  multiplier: number | null;
  /** What one unit is: a listed company's share, a private company's token, or a coin — said by its symbol («5,2 JUP»). */
  unit: "share" | "token" | "coin";
  preIpo: boolean;
  /** The one line of truth about what the token is. */
  truth: string;
  /** A coin the catalogue did not verify, or flags: its «Що це» is said with care. */
  truthCaution?: boolean;
  /** SOL itself: the wallet's own lamports, sold up to what leaves the network's fee behind. */
  nativeSol?: boolean;
  /** The fee the mint withholds on every transfer, basis points, as the chain states it — a PreStocks token's; null where it charges none. */
  issuerFeeBps: number | null;
  /** One token as the wallet shows it, in dollars — the venue's price; null when unpriced. */
  priceUsd: number | null;
  /** Whether a sale can be offered now: the issuer has not paused trading and there is a price. */
  sellable: boolean;
}>;

/**
 * The company's facts for its sale, from the stock asset the page and the
 * `/api/stocks/asset` read both carry — the name, the truth, the fee from the
 * chain, the multiplier and the decimals exactly as the company page reads
 * them (`company-view.tsx`).
 */
export function saleAssetOf(asset: StockAsset, lang: Lang): SaleAsset {
  const { row } = asset;
  const rep = row.representation;
  const preIpo = rep.instrument.class === "pre-ipo";
  const name = companyDisplayName(rep.underlying.name ?? rep.name, preIpo ? null : rep.underlying.symbol);
  const feeBps = row.transferFee?.basisPoints ?? null;
  const onchain = "error" in asset.onchain ? null : asset.onchain;
  const price = typeof row.market.priceUsd === "number" && Number.isFinite(row.market.priceUsd) && row.market.priceUsd > 0 ? row.market.priceUsd : null;
  return {
    mint: rep.mint,
    symbol: rep.symbol,
    name,
    icon: row.market.icon ?? null,
    decimals: onchain?.decimals ?? null,
    multiplier: asset.chainMultiplier?.current ?? row.multiplier?.current ?? null,
    unit: rep.instrument.unitBasis === "token" ? "token" : "share",
    preIpo,
    truth: truthLine(rep.issuer.id, name, lang, feeBps),
    issuerFeeBps: feeBps,
    priceUsd: price,
    sellable: rep.tradingHalted !== true && price !== null,
  };
}

const positiveMultiplier = (multiplier: number | null): number => (multiplier !== null && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1);

/** The position in the unit the wallet shows — shares for a listed company, tokens for a private one: raw × multiplier ÷ 10^decimals. */
export function unitsOf(raw: bigint, decimals: number, multiplier: number | null): number {
  if (raw <= 0n || !Number.isInteger(decimals) || decimals < 0) return 0;
  return (Number(raw) / 10 ** decimals) * positiveMultiplier(multiplier);
}

/** What the position is worth at the price, in dollars; null without a price. */
export function positionUsd(heldRaw: bigint, decimals: number, multiplier: number | null, priceUsd: number | null): number | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  return unitsOf(heldRaw, decimals, multiplier) * priceUsd;
}

/** A share of the position in raw units, never rounded up — 100 % is exactly what the wallet holds. */
export function shareRaw(heldRaw: bigint, pct: number): bigint {
  if (heldRaw <= 0n || !Number.isFinite(pct) || pct <= 0) return 0n;
  if (pct >= 100) return heldRaw;
  return (heldRaw * BigInt(Math.round(pct * 100))) / 10_000n;
}

/** Whether a sum in dollars reaches the whole position — within half a cent of its value. */
export function isWholePosition(usd: number, valueUsd: number | null): boolean {
  return valueUsd !== null && Number.isFinite(usd) && usd >= valueUsd - WHOLE_TOLERANCE_USD;
}

/** Whether a sum in dollars is more than the position is worth — beyond the half cent that still reads as all of it. */
export function isOverPosition(usd: number, valueUsd: number | null): boolean {
  return valueUsd !== null && Number.isFinite(usd) && usd > valueUsd + WHOLE_TOLERANCE_USD;
}

/**
 * The raw units a sum in dollars sells at the price: the whole position when
 * the sum reaches its value, never more than is held, never rounded up.
 * Null without a price, a positive sum or the mint's decimals.
 */
export function rawForUsd(usd: number, heldRaw: bigint, decimals: number | null, multiplier: number | null, priceUsd: number | null): bigint | null {
  if (!Number.isFinite(usd) || usd <= 0 || decimals === null || !Number.isInteger(decimals) || decimals < 0 || heldRaw <= 0n) return null;
  const value = positionUsd(heldRaw, decimals, multiplier, priceUsd);
  if (value === null || priceUsd === null) return null;
  if (isWholePosition(usd, value)) return heldRaw;
  const raw = BigInt(Math.floor(((usd / priceUsd) / positiveMultiplier(multiplier)) * 10 ** decimals));
  return raw > heldRaw ? heldRaw : raw;
}

/**
 * A share of the position in dollars and cents, never rounded up — the figure
 * a quick choice puts into the sum; null without a price.
 */
export function shareUsd(heldRaw: bigint, decimals: number, multiplier: number | null, priceUsd: number | null, pct: number): number | null {
  const value = positionUsd(shareRaw(heldRaw, pct), decimals, multiplier, priceUsd);
  return value === null ? null : Math.floor(value * 100 + 1e-6) / 100;
}

/** The sum a sale opens on: the purchase's $10 when the position is worth at least that, no sum otherwise (never a preselected sale of everything). */
export function openingSaleUsd(valueUsd: number | null): number | null {
  return valueUsd !== null && valueUsd >= DEFAULT_SALE_USD ? DEFAULT_SALE_USD : null;
}

/* ------------------------------------------------------------ a coin */

/**
 * What a sale of SOL leaves in the wallet: 0.01 SOL — the swap's own fee, the
 * wrapped-SOL account it opens and closes inside the transaction, a USDC
 * account the wallet may not have yet, and the wallet's own rent-exempt
 * minimum. «100 %» of SOL is everything above it, so the network never refuses
 * the sale for want of SOL to carry it.
 */
export const SOL_SALE_RESERVE_LAMPORTS = 10_000_000n;

/** The SOL a sale may take from a wallet's lamports: all of it above the reserve, never less than none. */
export function solForSale(lamports: bigint): bigint {
  return lamports > SOL_SALE_RESERVE_LAMPORTS ? lamports - SOL_SALE_RESERVE_LAMPORTS : 0n;
}

const COIN_WORDS = {
  coin: { en: "A Solana coin", uk: "Монета Solana" },
  meme: { en: "A Solana meme coin", uk: "Мем-монета Solana" },
  market: { en: "the market sets its price", uk: "ціну задає ринок" },
  verified: { en: "verified by Jupiter", uk: "перевірена Jupiter" },
  unverified: { en: "not verified by Jupiter — check the address", uk: "не перевірена Jupiter — звір адресу" },
  flagged: { en: "Jupiter flags it as suspicious", uk: "Jupiter позначив її як підозрілу" },
  sol: { en: "SOL, the Solana network's own coin · the market sets its price", uk: "SOL — рідна монета мережі Solana · ціну задає ринок" },
} as const;

type CoinFacts = Pick<SpotMarket, "mint" | "symbol" | "name" | "icon" | "decimals" | "price" | "verified" | "category"> & Readonly<{ audit: Pick<SpotMarket["audit"], "suspicious"> }>;

/**
 * «Що це» for a coin, from the catalogue's own facts and nothing else: what
 * kind of coin it is, that the market sets its price, and whether Jupiter
 * verified it — an unverified or flagged coin is said with care. SOL is the
 * network's own coin.
 */
export function coinTruth(market: Pick<CoinFacts, "mint" | "verified" | "category" | "audit">, lang: Lang, nativeMint: string): Readonly<{ line: string; caution: boolean }> {
  if (market.mint === nativeMint) return { line: COIN_WORDS.sol[lang], caution: false };
  const kind = market.category === "meme" ? COIN_WORDS.meme[lang] : COIN_WORDS.coin[lang];
  const trust = market.audit.suspicious ? COIN_WORDS.flagged[lang] : market.verified ? COIN_WORDS.verified[lang] : COIN_WORDS.unverified[lang];
  return { line: `${kind} · ${COIN_WORDS.market[lang]} · ${trust}`, caution: market.audit.suspicious || !market.verified };
}

/**
 * A coin's facts for its sale, from the Spot market the catalogue states — the
 * same sheet as a company's, sold into USDC on the same execution path. No
 * multiplier (the wallet's own read carries one where a mint has it), no
 * issuer's fee; sellable while the catalogue prices it.
 */
export function coinSaleAssetOf(market: CoinFacts, lang: Lang, nativeMint: string): SaleAsset {
  const truth = coinTruth(market, lang, nativeMint);
  const price = typeof market.price === "number" && Number.isFinite(market.price) && market.price > 0 ? market.price : null;
  return {
    mint: market.mint,
    symbol: market.symbol,
    /* SOL by its own name, never the catalogue's «Wrapped SOL»: the wallet holds the coin itself. */
    name: market.mint === nativeMint ? "SOL" : market.name || market.symbol,
    icon: market.icon,
    decimals: market.decimals,
    multiplier: null,
    unit: "coin",
    preIpo: false,
    truth: truth.line,
    truthCaution: truth.caution,
    nativeSol: market.mint === nativeMint,
    issuerFeeBps: null,
    priceUsd: price,
    sellable: price !== null,
  };
}

/** The lines «Перевірка» draws for a sale — the server's `check` for a company, `coinSaleLines` for a coin. */
export type SaleLines = Pick<SwapCheck, "basis" | "spend" | "get" | "costs" | "reserve" | "what">;

/**
 * «Перевірка» for a coin sold into USDC, counted by the same rules the server
 * counts a company's by (`lib/stocks/check.ts`, contract 1.20.0): what leaves
 * at the venue's value, what arrives about and at least, «Усі витрати» — the
 * venue's values' difference, never less than the stated fees and impact, and
 * the network's fee at SOL's price — and the reserve the order's simulation
 * proved. The server counts these lines for a company only (`check` is a
 * company's in the contract), so a coin's are counted here, from the same
 * order the server answered; a figure that cannot be counted is null, never a
 * guess.
 */
export function coinSaleLines(input: Readonly<{ order: CheckOrderFigures; basis: CheckBasis; asset: Pick<SaleAsset, "mint" | "decimals" | "multiplier" | "truth" | "truthCaution">; solUsd: number | null; usdcMint: string }>): SaleLines | null {
  const { order, basis, asset } = input;
  if (asset.decimals === null) return null;
  const numeric = (value: string | null): number | null => {
    if (value === null || value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const solUsd = input.solUsd !== null && Number.isFinite(input.solUsd) && input.solUsd > 0 ? input.solUsd : null;
  const received = unitsFromRaw(order.outAmountRaw, USDC_DECIMALS, null);
  const spendUsd = numeric(order.inUsdValue);
  const counted =
    spendUsd === null || solUsd === null
      ? null
      : buyCosts({
          spendUsd,
          inUsdValue: order.inUsdValue,
          outUsdValue: order.outUsdValue,
          totalFeeBasisPoints: order.totalFeeBasisPoints,
          priceImpactPct: order.priceImpactPct,
          signatureFeeLamports: order.signatureFeeLamports,
          priorityFeeLamports: order.priorityFeeLamports,
          rentFeeLamports: null,
          solUsd,
        });
  const rent = basis === "order" && order.rentFeeLamports && /^\d+$/.test(order.rentFeeLamports) ? BigInt(order.rentFeeLamports) : 0n;
  const truth = { en: asset.truth, uk: asset.truth };
  return {
    basis,
    spend: { mint: asset.mint, unit: "token", amount: unitsFromRaw(order.inAmountRaw, asset.decimals, asset.multiplier), usd: spendUsd },
    get: { mint: input.usdcMint, unit: "usdc", amount: received, atLeast: unitsFromRaw(order.minReceivedRaw, USDC_DECIMALS, null), usd: received },
    costs: counted ? { usd: counted.totalUsd, issuerFee: null } : null,
    reserve: rent > 0n ? { lamports: rent.toString(), usd: solUsd === null ? null : (Number(rent) / 1e9) * solUsd, first: false } : null,
    what: { truth, note: null, caution: asset.truthCaution === true },
  };
}
