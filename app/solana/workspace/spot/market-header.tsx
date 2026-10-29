"use client";

import { ArrowSquareOut, CaretDown, Copy, DotsThree, Globe, Info, Star, TelegramLogo, XLogo } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { SpotPool } from "@/lib/spot/candles";
import { isUnsupportedMarket, marketAgeDays, type SpotMarket } from "@/lib/spot/markets";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import type { TokenFacts } from "@/lib/spot/token-page";

import { useSolanaI18n } from "../i18n/provider.tsx";
import { MarketIcon } from "./market-list.tsx";
import { formatAge, formatCount, formatPercent, formatTerminalPrice, formatUsdCompact, shortAddress, toneOf } from "./spot-format.ts";
import { SourcesLine } from "./sources-line.tsx";
import { StockHeaderLine } from "./stock-context.tsx";
import { LaunchHeaderLine } from "./launch-line.tsx";
import { ShareTrade } from "../rewards/share-trade.tsx";
import { AskRynLens } from "@/app/app/lens/ask-ryn-lens";
import { ExplainMove } from "@/app/app/ryn/explain-move";
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
 * The instrument strip (B16; SOL-C12, the clean standard) — as a trader's terminal reads it: who this is, what it costs
 * now and how old that price is, what it moved over the day, the market's figures — first, wrapping to a second line
 * rather than hidden behind a scroll (UX-152) — and one «⋯» at the end with everything else: the assistant's three
 * presses, the watch, a trade's card and the layout's presets. Everything printed is the provider's figure; a stat the
 * provider did not state is a dash, never a zero. Who this is — the icon, the symbol and the arrow beside it — is the
 * one press that opens the markets; the chips beside it are facts, not part of the press, and none of them a verdict:
 * «Перевірено Jupiter» in a quiet chip, the minting and the freezing right each a chip of its own (UX-151). One interval
 * switch on the page — the chart's: the strip's change and volume are the day's. What the token says about itself and
 * its details stand in «Про токен» (`TokenAbout`); the sources are named once, under the chart.
 */
export function MarketHeader({
  state,
  fallback,
  starred,
  onStar,
  onOpenMarkets,
  marketsOpen,
  pro,
  facts = null,
  selectedMint = null,
  tools = null,
  launched = false,
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
  /** The token page's facts (Jupiter's four windows), when read. */
  facts?: TokenFacts | null;
  /** The market chosen, known before its read answers: the strip says it is loading rather than «Pick a market». */
  selectedMint?: string | null;
  /** The workplace's own controls, under «⋯» (B16 on a desk: the terminal's presets). */
  tools?: ReactNode;
  /** The market is a token launched on Ryntra: a line under the strip leads to its launch page (SOL-C10). */
  launched?: boolean;
}) {
  const { text, locale } = useSolanaI18n();
  const lang = locale === "uk" ? "uk" : "en";
  const numberLocale = lang === "uk" ? "uk-UA" : "en-US";
  const market = state.value;
  /* The day's change and volume: Jupiter's own day once read; before that the day the market already carries. */
  const day = facts?.windows.h24 ?? null;
  const change = day?.priceChangePct ?? market?.change24hPct ?? null;
  const volume = day?.volumeUsd ?? market?.volume24hUsd ?? null;
  const symbol = market?.symbol ?? fallback?.symbol ?? "";
  const name = market?.name ?? fallback?.name ?? "";
  const icon = market?.icon ?? fallback?.icon ?? null;
  const mint = market?.mint ?? fallback?.mint ?? selectedMint;
  const chip = market ? categoryChip(market, text) : null;
  const age = market ? marketAgeDays(market, Date.now()) : null;
  const priceAge = usePriceAge(state.status === "ready" ? state.observedAt : null);
  /* The issuer's rights as facts beside the name — not for SOL, which has none, nor for a tokenized stock, whose issuer
     mints by design and whose own line says so (SOL-C4), nor for a token Ryntra no longer supports. */
  const rights = market !== null && market.category !== "stock" && market.mint !== WRAPPED_SOL_MINT && !isUnsupportedMarket(market);

  const stat: Readonly<Record<StatKey, { label: string; value: string } | null>> = market
    ? {
        volume: { label: text("Volume 24h"), value: formatUsdCompact(volume, locale) },
        liquidity: { label: text("Liquidity"), value: formatUsdCompact(market.liquidityUsd, locale) },
        cap: pro ? { label: text("Market cap"), value: formatUsdCompact(market.marketCapUsd, locale) } : null,
        holders: pro ? { label: text("Holders"), value: formatCount(market.holders, locale) } : null,
        age: (pro || market.category === "meme") && market.category !== "stock" && market.mint !== WRAPPED_SOL_MINT ? { label: text("Age"), value: formatAge(age, lang === "uk") } : null,
        top:
          pro && market.category !== "stock" && market.mint !== WRAPPED_SOL_MINT
            ? { label: text("Top holders"), value: market.audit.topHoldersPct === null ? "—" : `${new Intl.NumberFormat(numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(market.audit.topHoldersPct)}%` }
            : null,
      }
    : { volume: null, liquidity: null, cap: null, holders: null, age: null, top: null };
  /* A meme's figures in the order its risk reads — the depth, the size, who holds it and since when — the volume last. */
  const order = market?.category === "meme" ? MEME_ORDER : PLAIN_ORDER;

  return (
    <section className={`${styles.panel} ${styles.header}`} aria-labelledby="spot-market-title" data-terminal-header>
      <button type="button" className={styles.identity} onClick={onOpenMarkets} aria-expanded={marketsOpen} aria-haspopup="dialog" title={text("Markets")} data-spot-picker>
        {mint ? <MarketIcon mint={mint} icon={icon} symbol={symbol || "?"} size={28} /> : null}
        <span className={styles.identityTitle}>
          {/* A market is selected from the first paint; while the catalogue
              answers it is loading, and a mint the catalogue cannot name
              is shown by its address rather than as nothing chosen. */}
          <span id="spot-market-title" translate="no">{symbol || (!mint ? text("Pick a market") : state.status === "loading" ? text("Loading market…") : shortAddress(mint))}</span>
          <CaretDown className={styles.caret} size={14} weight="bold" aria-hidden="true" />
          <span className="sr-only">{name ? ` · ${name}` : ""} · {text("Markets")}</span>
        </span>
      </button>

      {/* The facts beside the name — never a verdict, never the colour of «good» (UX-151); on a phone a line of their
          own under the name, so no press lies over them (UX-153). A token Ryntra no longer supports carries one state,
          not a chip beside it; nor does a token its issuer set a swap deadline for — its red line stands by «Купити»
          (UX-504). The catalogue's word stays under the asset's details. */}
      {market ? (
        <span className={styles.chips} data-header-chips>
          {market.verified && !isUnsupportedMarket(market) && !lifecycleEventFor(market.mint) ? (
            <span className={styles.chip} data-verify-chip data-tone="plain">
              {text("Verified by Jupiter")}
            </span>
          ) : null}
          {!market.verified ? (
            <span className={styles.chip} data-verify-chip data-tone={market.audit.suspicious ? "risk" : "caution"}>
              {market.audit.suspicious ? text("Flagged") : text("Not verified by Jupiter")}
            </span>
          ) : null}
          {rights && market.audit.mintAuthorityDisabled === false ? (
            <span className={styles.chip} data-tone="caution" data-authority-chip="mint" title={text("The issuer can still mint more of this token.")}>
              {text("Minting on")}
            </span>
          ) : null}
          {rights && market.audit.freezeAuthorityDisabled === false ? (
            <span className={styles.chip} data-tone="caution" data-authority-chip="freeze" title={text("The issuer can still freeze this token in any wallet.")}>
              {text("Freeze on")}
            </span>
          ) : null}
          {chip ? <span className={styles.chip}>{chip.label}</span> : null}
        </span>
      ) : null}

      <div className={styles.priceRow}>
        {/* The page's one last price, with its age and its source (UX-254) — the chart's last bar closes at the same
            figure while it is fresh (B15); the ticket prints none of its own. */}
        <span className={styles.price} aria-live="polite" data-last-price>
          {market?.price == null ? "—" : `$${formatTerminalPrice(market.price, locale)}`}
        </span>
        <span className={`${styles.change} ${toneOf(change) === "up" ? styles.up : toneOf(change) === "down" ? styles.down : styles.flat}`} data-header-change title={text("Change over 24 hours")}>
          {formatPercent(change, locale)}
          <span className={styles.changeWindow}> · {text("24h")}</span>
        </span>
        {state.status === "unavailable" ? <span className={styles.priceMeta}>{text("Price feed unavailable")}</span> : null}
        {state.status === "ready" && (state.stale || priceAge !== null) ? (
          <span className={styles.priceMeta} data-price-age data-stale={state.stale ? "true" : undefined}>
            {state.stale ? `${text("Last known price")}${priceAge === null ? "" : ` · ${priceAge}`}` : `Jupiter · ${priceAge}`}
          </span>
        ) : null}
      </div>

      {/* The market's figures — first, in one strip that wraps rather than scrolls (UX-152). */}
      {market ? (
        <dl className={styles.stats} data-header-stats>
          {order.map((key) => {
            const entry = stat[key];
            return entry ? (
              <div key={key} data-stat={key}>
                <dt>{entry.label}</dt>
                <dd>{entry.value}</dd>
              </div>
            ) : null;
          })}
        </dl>
      ) : null}

      {/* Everything else under one «⋯» (UX-152, UX-153). */}
      {mint ? (
        <MoreMenu label={text("More actions")}>
          {/* AI-06a: what moved this token's price, «Стежити» and «План» — the assistant's side panel (the Assistant line). */}
          <ExplainMove mint={mint} symbol={market?.symbol ?? fallback?.symbol ?? null} locale={locale} className={styles.moreItem} />
          <button type="button" className={styles.moreItem} aria-pressed={starred} onClick={onStar} data-more-close>
            <Star size={14} weight={starred ? "fill" : "bold"} aria-hidden="true" />
            <span>{starred ? text("Remove from watchlist") : text("Add to watchlist")}</span>
          </button>
          {/* «Поділитися»: a card of this wallet's trade of this token (from Rewards); nothing without a trade. */}
          <span className={styles.moreShare} title={text("Share a trade")}>
            <ShareTrade mint={mint} align="end" />
          </span>
          {tools}
        </MoreMenu>
      ) : null}

      {/* The state of a token Ryntra no longer supports: a line of its own under the strip, as wide as it. */}
      {market && isUnsupportedMarket(market) ? (
        <p className={styles.retiredState} data-retired-state>
          {text("No longer supported in Ryntra")}
        </p>
      ) : null}

      {/* A tokenized stock carries its reference, its session and its deviation
          on a line of its own under the strip, and the way into its research page. */}
      {market?.category === "stock" && !isUnsupportedMarket(market) ? <StockHeaderLine mint={market.mint} symbol={market.symbol} /> : null}
      {launched && selectedMint ? <LaunchHeaderLine mint={selectedMint} /> : null}
    </section>
  );
}

type StatKey = "volume" | "liquidity" | "cap" | "holders" | "age" | "top";
const PLAIN_ORDER: readonly StatKey[] = ["volume", "liquidity", "cap", "holders", "age", "top"];
const MEME_ORDER: readonly StatKey[] = ["liquidity", "cap", "holders", "age", "top", "volume"];

/**
 * «⋯» — one quiet button at the strip's end and, under it, what the strip used to carry as five buttons. A press of an
 * act inside closes it (the assistant's three, the watch, a preset); Esc and a press outside close it too, and the focus
 * goes back to the button.
 */
function MoreMenu({ label, children }: { label: string; children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = (focus: boolean) => {
    if (!menu.current?.open) return;
    menu.current.open = false;
    if (focus) menu.current.querySelector("summary")?.focus();
  };
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return (
    <details
      ref={menu}
      className={styles.more}
      data-header-more
      onKeyDown={(event) => {
        /* A sheet opened from the menu (a trade's card) closes itself first. */
        if (event.key !== "Escape" || !menu.current?.open || event.defaultPrevented || (event.target as Element).closest("dialog")) return;
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }}
      onClick={(event) => {
        /* The assistant's presses move the focus to its panel; the watch and a preset give it back to «⋯». */
        const target = event.target as HTMLElement;
        if (target.closest("[data-assistant-action]")) close(false);
        else if (target.closest("[data-more-close], [data-preset]")) close(true);
      }}
    >
      <summary className={styles.moreButton} aria-label={label} title={label}>
        <DotsThree size={20} weight="bold" aria-hidden="true" />
      </summary>
      <div className={styles.moreMenu} role="group" aria-label={label}>
        {children}
      </div>
    </details>
  );
}

/**
 * «Про токен» — under the ticket (B16): who the token is, what its creator says about it with its own addresses, and
 * Asset details one disclosure down. It was the header's second half; the strip keeps one line for the price and the
 * figures, and the facts a person reads before an order stand beside the order.
 */
export function TokenAbout({ market, fallbackName, pool }: { market: SpotMarket | null; fallbackName: string; pool: SpotPool | null }) {
  const { text } = useSolanaI18n();
  const name = market?.name ?? fallbackName;
  return (
    <section className={`${styles.panel} ${styles.aboutCard}`} aria-labelledby="spot-about-title" data-token-about-card>
      <h2 id="spot-about-title" className={styles.aboutTitle}>
        {text("About the token")}
        {name ? <span className={styles.aboutName}>{name} · Solana</span> : null}
      </h2>
      {market && !isUnsupportedMarket(market) ? <TokenAboutLine market={market} /> : null}
      {market ? <AssetDetails market={market} pool={pool} /> : <span className={styles.aboutBone} aria-hidden="true" />}
      <SourcesLine place="about" />
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

/** How old the price is — «13 с тому», «3 хв тому» — on a clock that ticks while the page is open; null before it is read. */
function usePriceAge(observedAt: string | null): string | null {
  const { text } = useSolanaI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!observedAt) return null;
  const seconds = Math.max(0, Math.round((now - Date.parse(observedAt)) / 1000));
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${seconds} ${text("s ago")}`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} ${text("min ago")}`;
  return `${Math.floor(seconds / 3600)} ${text("h ago")}`;
}
