"use client";

import { ArrowSquareOut, CaretDown, Copy, Star } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";

import type { SpotPool } from "@/lib/spot/candles";
import { isUnsupportedMarket, marketAgeDays, type SpotMarket } from "@/lib/spot/markets";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { MarketIcon } from "./market-list.tsx";
import { formatAge, formatCount, formatPercent, formatUsdCompact, formatUsdPrice, shortAddress, toneOf } from "./spot-format.ts";
import { StockHeaderLine } from "./stock-context.tsx";
import { ShareTrade } from "../rewards/share-trade.tsx";
import { AskRynLens } from "@/app/app/lens/ask-ryn-lens";
import type { MarketState } from "./use-spot-data.ts";

import { TOKEN_2022_PROGRAM_ID } from "@/lib/solana/send-kinds";

import styles from "./spot.module.css";


function categoryChip(market: SpotMarket, text: (english: string) => string): { label: string } | null {
  /* A token Ryntra no longer supports names no issuer and wears no chip: its state is a line of its own under the name. */
  if (isUnsupportedMarket(market)) return null;
  if (market.category === "stock") return { label: market.issuer ? market.issuer.label : text("Tokenized asset") };
  if (market.category === "meme") return { label: text("Meme") };
  return null;
}

/**
 * The asset header — who this is, what it costs now, what moved today — and
 * Asset details one disclosure down. Everything printed is the provider's
 * figure; a stat the provider did not state is a dash, never a zero.
 */
export function MarketHeader({
  state,
  fallback,
  starred,
  onStar,
  onOpenMarkets,
  showPicker,
  pro,
  pool,
}: {
  state: MarketState;
  /** What the list already knew, so the header never goes blank while the detail loads. */
  fallback: Readonly<{ mint: string; symbol: string; name: string; icon: string | null }> | null;
  starred: boolean;
  onStar: () => void;
  onOpenMarkets: () => void;
  showPicker: boolean;
  pro: boolean;
  pool: SpotPool | null;
}) {
  const { text, locale } = useSolanaI18n();
  const market = state.value;
  const symbol = market?.symbol ?? fallback?.symbol ?? "";
  const name = market?.name ?? fallback?.name ?? "";
  const icon = market?.icon ?? fallback?.icon ?? null;
  const mint = market?.mint ?? fallback?.mint ?? null;
  const change = market?.change24hPct ?? null;
  const tone = toneOf(change);
  const chip = market ? categoryChip(market, text) : null;
  const age = market ? marketAgeDays(market, Date.now()) : null;

  return (
    <section className={`${styles.panel} ${styles.header}`} aria-label={text("Market")}>
      <div className={styles.headerTop}>
        <div className={styles.identity}>
          {mint ? <MarketIcon mint={mint} icon={icon} symbol={symbol || "?"} size={36} /> : null}
          <div className={styles.identityText}>
            <h2>
              {/* A market is selected from the first paint; while the catalogue
                  answers it is loading, and a mint the catalogue cannot name
                  is shown by its address rather than as nothing chosen. */}
              {symbol || (!mint ? text("Pick a market") : state.status === "loading" ? text("Loading market…") : shortAddress(mint))}
              {/* A token Ryntra no longer supports carries one state, not a green one beside it; the catalogue's word stays under the asset's details. */}
              {market?.verified && !isUnsupportedMarket(market) ? <span className={styles.chip} data-tone="verified">{text("Verified")}</span> : null}
              {market && !market.verified ? <span className={styles.chip} data-tone={market.audit.suspicious ? "risk" : "caution"}>{market.audit.suspicious ? text("Flagged") : text("Unverified")}</span> : null}
              {chip ? <span className={styles.chip}>{chip.label}</span> : null}
            </h2>
            <span>{name}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          {mint ? (
            <button
              type="button"
              className={styles.star}
              aria-pressed={starred}
              aria-label={starred ? text("Remove from watchlist") : text("Add to watchlist")}
              onClick={onStar}
            >
              <Star size={18} weight={starred ? "fill" : "regular"} aria-hidden="true" />
            </button>
          ) : null}
          {showPicker ? (
            <button type="button" className={styles.pickerButton} onClick={onOpenMarkets} data-spot-picker>
              {text("Markets")}
              <CaretDown size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {/* The state of a token Ryntra no longer supports: a line of its own under the name, as wide as the header — on a phone it never runs under the star or «Ринки». */}
      {market && isUnsupportedMarket(market) ? (
        <p className={styles.retiredState} data-retired-state>
          {text("No longer supported in Ryntra")}
        </p>
      ) : null}

      <div className={styles.priceRow}>
        <span className={styles.price} aria-live="polite">{formatUsdPrice(market?.price ?? null, locale)}</span>
        <span className={`${styles.change} ${tone === "up" ? styles.up : tone === "down" ? styles.down : styles.flat}`}>
          {formatPercent(change, locale)}
          {change !== null ? <span className={styles.flat}> · 24h</span> : null}
        </span>
        {state.status === "unavailable" ? <span className={styles.priceMeta}>{text("Price feed unavailable")}</span> : null}
        {state.status === "ready" && state.stale ? <span className={styles.priceMeta}>{text("Last known price")}</span> : null}
        {/* «Поділитися»: a card of this wallet's trade of this token (from Rewards), in the price line (the end of it on a desk, a line of its own under the price on a phone), so the name keeps its room; nothing without a trade. */}
        {mint ? <ShareTrade mint={mint} align="end" /> : null}
      </div>

      {/* A tokenized stock carries its reference, its session and its deviation
          under the price, and the way into its research page. */}
      {market?.category === "stock" && !isUnsupportedMarket(market) ? <StockHeaderLine mint={market.mint} symbol={market.symbol} /> : null}

      {market ? (
        <dl className={styles.stats}>
          <div>
            <dt>{text("Liquidity")}</dt>
            <dd>{formatUsdCompact(market.liquidityUsd, locale)}</dd>
          </div>
          <div>
            <dt>{text("Volume 24h")}</dt>
            <dd>{formatUsdCompact(market.volume24hUsd, locale)}</dd>
          </div>
          {pro ? (
            <>
              <div>
                <dt>{text("1h")}</dt>
                <dd data-tone={toneOf(market.change1hPct)}>{formatPercent(market.change1hPct, locale)}</dd>
              </div>
              <div>
                <dt>{text("Market cap")}</dt>
                <dd>{formatUsdCompact(market.marketCapUsd, locale)}</dd>
              </div>
              <div>
                <dt>{text("Holders")}</dt>
                <dd>{formatCount(market.holders, locale)}</dd>
              </div>
              {market.category === "meme" ? (
                <>
                  <div>
                    <dt>{text("Age")}</dt>
                    <dd>{formatAge(age, locale === "uk")}</dd>
                  </div>
                  <div>
                    <dt>{text("Top holders")}</dt>
                    <dd>{market.audit.topHoldersPct === null ? "—" : `${Math.round(market.audit.topHoldersPct)}%`}</dd>
                  </div>
                </>
              ) : null}
              {market.category === "stock" ? (
                <div>
                  <dt>{text("Trades")}</dt>
                  <dd>{text("On-chain, 24/7")}</dd>
                </div>
              ) : null}
            </>
          ) : market.category === "meme" ? (
            <div>
              <dt>{text("Age")}</dt>
              <dd>{formatAge(age, locale === "uk")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {market ? <AssetDetails market={market} pool={pool} /> : null}
    </section>
  );
}

function AssetDetails({ market, pool }: { market: SpotMarket; pool: SpotPool | null }) {
  const { text, locale } = useSolanaI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(market.mint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* A denied clipboard leaves the address on screen to select. */
    }
  };
  const program = market.tokenProgram === TOKEN_2022_PROGRAM_ID ? "Token-2022" : market.tokenProgram ? "SPL Token" : "—";
  const links = [
    market.links.website ? { label: text("Website"), href: market.links.website } : null,
    market.links.twitter ? { label: "X", href: market.links.twitter } : null,
    market.links.telegram ? { label: "Telegram", href: market.links.telegram } : null,
  ].filter((link): link is { label: string; href: string } => link !== null);

  return (
    <details className={styles.details}>
      <summary>{text("Asset details")}</summary>
      <dl className={styles.detailGrid}>
        <div>
          <dt>{text("Mint address")}</dt>
          <dd data-mono="true">
            <span title={market.mint}>{shortAddress(market.mint)}</span>
            <button type="button" className={styles.copyButton} onClick={() => void copy()} aria-label={text("Copy address")}>
              <Copy size={12} aria-hidden="true" /> {copied ? text("Copied") : text("Copy")}
            </button>
          </dd>
        </div>
        <div>
          <dt>{text("Token program")}</dt>
          <dd>{program}{market.decimals !== null ? ` · ${market.decimals} ${text("decimals")}` : ""}</dd>
        </div>
        <div>
          <dt>{text("Verification")}</dt>
          <dd>{market.verified ? text("Verified by Jupiter") : text("Not verified by Jupiter")}{market.organicScoreLabel ? ` · ${text("organic score")} ${market.organicScoreLabel}` : ""}</dd>
        </div>
        {market.issuer ? (
          <div>
            <dt>{text("Issuer")}</dt>
            <dd>{isUnsupportedMarket(market) ? text("No longer supported in Ryntra") : market.issuer.label}</dd>
          </div>
        ) : null}
        <div>
          <dt>{text("Authorities")}</dt>
          <dd>
            {market.audit.mintAuthorityDisabled === null && market.audit.freezeAuthorityDisabled === null
              ? "—"
              : `${text("Mint")}: ${market.audit.mintAuthorityDisabled ? text("revoked") : text("active")} · ${text("Freeze")}: ${market.audit.freezeAuthorityDisabled ? text("revoked") : text("active")}`}
          </dd>
        </div>
        <div>
          <dt>{text("Market data")}</dt>
          <dd>{text("Jupiter")}{market.updatedAt ? ` · ${new Date(market.updatedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}` : ""}</dd>
        </div>
        {pool ? (
          <div>
            <dt>{text("Chart")}</dt>
            <dd>
              <a href={`https://www.geckoterminal.com/solana/pools/${pool.address}`} target="_blank" rel="noreferrer noopener">
                {pool.name}{pool.dex ? ` · ${pool.dex}` : ""} · GeckoTerminal <ArrowSquareOut size={12} aria-hidden="true" />
              </a>
            </dd>
          </div>
        ) : null}
        {links.length > 0 ? (
          <div>
            <dt>{text("Links")}</dt>
            <dd>
              {links.map((link, index) => (
                <span key={link.href}>
                  {index > 0 ? " · " : ""}
                  <a href={link.href} target="_blank" rel="noreferrer noopener">{link.label} <ArrowSquareOut size={12} aria-hidden="true" /></a>
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{text("Explorer")}</dt>
          <dd>
            <a href={`https://solscan.io/token/${market.mint}`} target="_blank" rel="noreferrer noopener">Solscan <ArrowSquareOut size={12} aria-hidden="true" /></a>
          </dd>
        </div>
        {market.category === "stock" ? (
          <div>
            <dt>{text("Strategy")}</dt>
            <dd>
              <Link href={`/app/strategies/new?mint=${market.mint}`}>{text("Create strategy")} →</Link>
            </dd>
          </div>
        ) : null}
        {/* Ryntra on this asset: the press opens the Brief and the Critic on this page, closed until asked; the conversation is one press further inside. */}
        <div>
          <dt>Ryntra</dt>
          <dd>
            <AskRynLens subject={{ kind: "asset", mint: market.mint, symbol: market.symbol }} locale={locale} variant="link" className={styles.linkButton} />
          </dd>
        </div>
      </dl>
      {market.category === "stock" ? (
        <p className={styles.disclosure}>
          {text("A tokenized asset: a Solana token issued against the underlying by its issuer, not a brokerage share. Trading is on-chain, 24/7, at the token's own price; the issuer's terms and eligibility rules apply.")}
        </p>
      ) : null}
      {!market.verified ? (
        <p className={styles.disclosure}>{text("Not verified by the catalogue. Check the address before trading; a copy can borrow a name.")}</p>
      ) : null}
    </details>
  );
}
