"use client";

import type { SwapNetwork } from "@/lib/swap/catalog";
import { MarketIcon } from "../spot/market-list.tsx";

import styles from "./marks.module.css";

/**
 * The marks of the networks and the coins money moves in (B18, the B13 review's item 12).
 *
 * The review found «B Base», «U USDC» and «S Solana» beside «S SOL» — first letters in grey circles, two networks
 * sharing a «B» and two an «A» — in the one form where picking the wrong network loses the money, while «Обмін» in the
 * same app drew the real logos. Every mark here is a file of this site: the coins people know by sight from
 * `public/site/universe/`, the networks and the other coins as small drawings in `public/marks/` — never a picture
 * waiting on a third host, so a slow or closed host can never turn a network back into a letter. A drawing is replaced
 * by putting another file in its place. Only an arbitrary Solana token, which nobody can draw in advance, goes through
 * the catalogue's icon (`MarketIcon`), and only it can fall back to its letters.
 */

/** The Solana mints the site carries a picture of. */
const MINT_PICTURE: Readonly<Record<string, string>> = {
  So11111111111111111111111111111111111111112: "/site/universe/SOL.png",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "/site/universe/USDC.png",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "/site/universe/JUP.png",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "/site/universe/BONK.png",
};

/** The coins drawn by ticker — on any network: USDC is USDC on Base too. */
const TICKER_PICTURE: Readonly<Record<string, string>> = {
  USDC: "/site/universe/USDC.png",
  ETH: "/marks/coins/eth.svg",
  WETH: "/marks/coins/eth.svg",
  BNB: "/marks/coins/bnb.svg",
  POL: "/marks/coins/pol.svg",
  MATIC: "/marks/coins/pol.svg",
  USDT: "/marks/coins/usdt.svg",
  USDG: "/marks/coins/usdg.svg",
};

function Picture({ src, size, className }: { src: string; size: number; className?: string }) {
  /* A file of this site at a mark's size; nothing for the optimiser to do, and an SVG it would refuse anyway. */
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt="" width={size} height={size} decoding="async" draggable={false} />;
}

/** A network's mark, for a menu row, a pill or the corner of a coin. */
export function NetworkMark({ network, size = 20, className }: { network: SwapNetwork; size?: number; className?: string }) {
  return (
    <span className={[styles.mark, className].filter(Boolean).join(" ")} style={{ width: size, height: size }} data-network-mark={network}>
      <Picture className={styles.picture} src={`/marks/networks/${network}.svg`} size={size} />
    </span>
  );
}

export type AssetMarkProps = Readonly<{
  /** The ticker people know it by. */
  symbol: string;
  /** A Solana mint, when the coin is one. */
  mint?: string | null;
  /** The catalogue's own icon address, for a Solana token the site carries no picture of. */
  icon?: string | null;
  size?: number;
  /** The network the coin is on, drawn small on its corner — where the same coin lives on several networks. */
  network?: SwapNetwork | null;
  className?: string;
}>;

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * A coin's mark: the site's own picture for the coins people know by sight and for a network's coin and the dollars,
 * the catalogue's icon for any other Solana token, and — only for a token nobody has a picture of — its first letters,
 * which is what such a token has.
 *
 * A token with an address is known by its address, never by its ticker: anybody can mint a «USDC», and a look-alike
 * must never wear the real coin's picture. A ticker alone names a coin of the networks' own catalogue (`lib/swap/catalog`).
 */
export function AssetMark({ symbol, mint = null, icon = null, size = 24, network = null, className }: AssetMarkProps) {
  const upper = symbol.trim().toUpperCase();
  const local = mint ? MINT_PICTURE[mint] : (TICKER_PICTURE[upper] ?? (upper === "SOL" && (network === null || network === "solana") ? MINT_PICTURE.So11111111111111111111111111111111111111112 : undefined));
  const face = local ? (
    <Picture className={styles.picture} src={local} size={size} />
  ) : mint && BASE58_MINT.test(mint) ? (
    <MarketIcon mint={mint} icon={icon} symbol={symbol} size={size} className={styles.picture} />
  ) : (
    <span className={styles.letters} style={{ fontSize: Math.max(9, Math.round(size * 0.38)) }}>{symbol.slice(0, 2)}</span>
  );
  return (
    <span className={[styles.mark, className].filter(Boolean).join(" ")} style={{ width: size, height: size }} data-asset-mark={upper}>
      {face}
      {network && network !== "solana" ? (
        <span className={styles.corner}>
          <NetworkMark network={network} size={Math.max(10, Math.round(size * 0.5))} />
        </span>
      ) : null}
    </span>
  );
}
