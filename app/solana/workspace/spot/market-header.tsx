"use client";

import { ArrowSquareOut, CaretDown, Copy, Globe, Info, Star, TelegramLogo, XLogo } from "@phosphor-icons/react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

import type { SpotPool } from "@/lib/spot/candles";
import { isUnsupportedMarket, marketAgeDays, type SpotMarket } from "@/lib/spot/markets";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { MarketIcon } from "./market-list.tsx";
import { formatAge, formatCount, formatPercent, formatUsdCompact, formatUsdPrice, shortAddress, toneOf } from "./spot-format.ts";
import { StockHeaderLine } from "./stock-context.tsx";
import { ShareTrade } from "../rewards/share-trade.tsx";
import { AskRynLens } from "@/app/app/lens/ask-ryn-lens";
import { useTokenAbout, type MarketState } from "./use-spot-data.ts";
import { linkFace } from "@/lib/spot/token-about";

import { TOKEN_2022_PROGRAM_ID, WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";

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
 * figure; a stat the provider did not state is a dash, never a zero. Who this
 * is — the icon, the name and the arrow beside it — is the one press that
 * opens the markets.
 */
export function MarketHeader({
  state,
  fallback,
  starred,
  onStar,
  onOpenMarkets,
  marketsOpen,
  pro,
  pool,
}: {
  state: MarketState;
  /** What the list already knew, so the header never goes blank while the detail loads. */
  fallback: Readonly<{ mint: string; symbol: string; name: string; icon: string | null }> | null;
  starred: boolean;
  onStar: () => void;
  onOpenMarkets: () => void;
  /** Whether the markets are open from this header now. */
  marketsOpen: boolean;
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
    <section className={`${styles.panel} ${styles.header}`} aria-labelledby="spot-market-title" data-terminal-header>
      <div className={styles.headerTop}>
        <button type="button" className={styles.identity} onClick={onOpenMarkets} aria-expanded={marketsOpen} aria-haspopup="dialog" title={text("Markets")} data-spot-picker>
          {mint ? <MarketIcon mint={mint} icon={icon} symbol={symbol || "?"} size={36} /> : null}
          <span className={styles.identityText}>
            <span className={styles.identityTitle}>
              {/* A market is selected from the first paint; while the catalogue
                  answers it is loading, and a mint the catalogue cannot name
                  is shown by its address rather than as nothing chosen. */}
              <span id="spot-market-title" translate="no">{symbol || (!mint ? text("Pick a market") : state.status === "loading" ? text("Loading market…") : shortAddress(mint))}</span>
              <CaretDown className={styles.caret} size={16} weight="bold" aria-hidden="true" />
              <span className="sr-only"> · {text("Markets")}</span>
              {/* A token Ryntra no longer supports carries one state, not a green one beside it; the catalogue's word stays under the asset's details. */}
              {market?.verified && !isUnsupportedMarket(market) ? <span className={styles.chip} data-tone="verified">{text("Verified")}</span> : null}
              {market && !market.verified ? <span className={styles.chip} data-tone={market.audit.suspicious ? "risk" : "caution"}>{market.audit.suspicious ? text("Flagged") : text("Unverified")}</span> : null}
              {chip ? <span className={styles.chip}>{chip.label}</span> : null}
            </span>
            <span className={styles.identityName}>{name}</span>
          </span>
        </button>
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

      {market && !isUnsupportedMarket(market) ? <TokenAboutLine market={market} /> : null}

      {market ? <AssetDetails market={market} pool={pool} /> : null}
    </section>
  );
}

/**
 * «Що це за монета»: what the token's creator says it is — the description in
 * its metadata (`useTokenAbout`) — and where it lives: its site, X and
 * Telegram as Jupiter's catalogue states them, each named by what it opens.
 * Both are the creator's own words and addresses, and the line says so: Ryntra
 * checked neither. A token whose creator wrote nothing says that (B.11); a read
 * that failed says that instead. SOL is the network's own coin and has no
 * creator to quote — its line is the one fact about it.
 */
function TokenAboutLine({ market }: { market: SpotMarket }) {
  const { text } = useSolanaI18n();
  const native = market.mint === WRAPPED_SOL_MINT;
  const about = useTokenAbout(native ? null : market.mint, market.name, market.symbol);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const links = (
    [
      ["website", market.links.website],
      ["twitter", market.links.twitter],
      ["telegram", market.links.telegram],
    ] as const
  ).filter((entry): entry is readonly ["website" | "twitter" | "telegram", string] => typeof entry[1] === "string");
  const description = !native && about.status === "ready" ? about.about.description : null;
  const line = native
    ? text("The Solana network's own coin: every transaction's fee is paid in it.")
    : description ??
      (about.status === "loading"
        ? null
        : about.status === "unavailable" || about.about.state === "unread"
          ? text("What the token says about itself could not be read just now.")
          : text("The token's creator wrote no description."));
  /* «Ще» only where the description does not fit its line. An unverified or flagged coin's description is set quiet: the creator's words, not the page's. */
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || open) return;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [line, open]);
  const fromCreator = description !== null || links.length > 0;
  return (
    <div className={styles.about} data-dense data-token-about={native ? "native" : about.status === "ready" ? about.about.state : about.status}>
      <div className={styles.aboutBody}>
        {line === null ? (
          <span className={styles.aboutBone} aria-hidden="true" />
        ) : (
          <p ref={textRef} className={styles.aboutText} data-open={open ? "true" : undefined} data-quiet={(description === null && !native) || (description !== null && (!market.verified || market.audit.suspicious)) ? "true" : undefined}>
            {line}
          </p>
        )}
        {clipped || open ? (
          <button type="button" className={styles.aboutMore} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? text("Less") : text("More")}
          </button>
        ) : null}
      </div>
      {links.length > 0 || fromCreator ? (
        <div className={styles.aboutFoot}>
          {links.map(([kind, href]) => {
            const face = linkFace(kind, href);
            const kindWord = face.mark === "x" ? "X" : face.mark === "telegram" ? "Telegram" : text("Website");
            const Mark = face.mark === "x" ? XLogo : face.mark === "telegram" ? TelegramLogo : Globe;
            return (
              <a key={kind} className={styles.aboutLink} href={href} target="_blank" rel="noreferrer noopener nofollow ugc" data-about-link={kind} aria-label={`${kindWord}: ${face.label}`}>
                <Mark size={14} weight="bold" aria-hidden="true" />
                <span translate="no">{face.label}</span>
              </a>
            );
          })}
          {fromCreator ? (
            /* The mark is reachable by keyboard and says the whole of it to a reader of the screen; a mouse reads it on hover. */
            <span className={styles.aboutSource} data-unverified tabIndex={0} title={text("The description and the links are set by the token's creator; Ryntra has not checked them.")}>
              <Info size={12} weight="bold" aria-hidden="true" />
              <span aria-hidden="true">{text("From the creator · not checked")}</span>
              <span className="sr-only">{text("The description and the links are set by the token's creator; Ryntra has not checked them.")}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
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
