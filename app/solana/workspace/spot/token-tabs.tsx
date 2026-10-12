"use client";

/**
 * The token page's tabs under the chart: «Угоди» — who bought, how much, who sells, the capitalisation at the
 * trade; «Холдери» — the largest holders, their share and how their holding
 * moved; «Ліквідність» — where the token trades; «Ризик» — the facts with
 * their reasons, never a verdict; «Соцмережі» — the creator's own addresses;
 * and for a tokenized stock «Актив» — the issuer, where it does not offer the
 * token, dividends and the multiplier, the price against the exchange.
 *
 * Each tab reads its part only while it is open (`useTokenPart`) and says
 * where its figures come from, with the attribution the source's terms ask
 * for (`TOKEN_PAGE_SOURCES`). A part the token has nothing for says so in a
 * sentence; a part that could not be read says that, beside the last answer
 * when there was one.
 */

import { ArrowSquareOut, Globe, TelegramLogo, XLogo } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";

import type { SpotMarket } from "@/lib/spot/markets";
import { linkFace } from "@/lib/spot/token-about";
import { TOKEN_PAGE_SOURCES, type RiskFact, type TokenFacts, type TokenHolder, type TokenPool, type TokenTrade, type TokenPageSource } from "@/lib/spot/token-page";
import { fairPriceOf, FAIR_PRICE_WORDS, ISSUER_TERMS } from "@/lib/stocks/issuer-terms";
import { SESSION_WORDS } from "@/lib/stocks/session";
import { truthLine } from "@/lib/stocks/truth";

import { RiskCard } from "../evidence/risk-card.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { formatAge, formatAmount, formatPercent, formatUsdCompact, shortAddress, toneOf } from "./spot-format.ts";
import { useStockAsset } from "./stock-context.tsx";
import { useTokenPart, type TokenPartRead } from "./use-spot-data.ts";

import styles from "./spot.module.css";

export type TokenTab = "asset" | "trades" | "holders" | "pools" | "risk" | "socials";

type TradesBody = Readonly<{ trades: readonly TokenTrade[]; pool: TokenPool; span: Readonly<{ from: string; to: string }> | null; capCounted: boolean; topHolders: readonly string[]; observedAt: string; stale: boolean }>;
type HoldersBody = Readonly<{ holders: readonly TokenHolder[]; programPct: number | null; supply: number | null; span: Readonly<{ from: string; to: string }> | null; observedAt: string; stale: boolean }>;
type PoolsBody = Readonly<{ pools: readonly TokenPool[]; observedAt: string }>;
type RiskBody = Readonly<{ facts: readonly RiskFact[]; observedAt: string; stale: boolean }>;

/** The market tabs a token has: a stock its issuer's, every listed token its trades, pools and risk, a token with holders worth listing its holders, and the creator's addresses only where there are some. */
export function tokenTabsOf(market: SpotMarket | null, facts: TokenFacts | null, native: boolean): TokenTab[] {
  if (!market) return [];
  const tabs: TokenTab[] = [];
  if (market.category === "stock") tabs.push("asset");
  tabs.push("trades");
  if (!native) tabs.push("holders");
  tabs.push("pools", "risk");
  const links = [market.links.website, market.links.twitter, market.links.telegram].filter(Boolean).length + (facts?.socials.length ?? 0);
  if (links > 0 && !native) tabs.push("socials");
  return tabs;
}

export const TOKEN_TAB_LABELS: Readonly<Record<TokenTab, string>> = {
  asset: "Asset",
  trades: "Trades",
  holders: "Holders",
  pools: "Liquidity",
  risk: "Risk",
  socials: "Socials",
};

/** A per cent in the reader's locale, a share under the smallest step said as «<». */
function pct(value: number | null, locale: string, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const tag = locale === "uk" ? "uk-UA" : "en-US";
  const floor = 1 / 10 ** digits;
  if (value > 0 && value < floor) return `<${new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(floor)}%`;
  return `${new Intl.NumberFormat(tag, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`;
}

/** Tokens in the reader's locale; an amount under a hundredth is «<0.01», never «0». */
function tokens(value: number, locale: string): string {
  if (value > 0 && value < 0.01) return `<${new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 2 }).format(0.01)}`;
  return formatAmount(value, locale, 2);
}

/** Dollars of a trade; under a cent «<$0.01», never «$0». */
function dollars(value: number | null, locale: string): string {
  if (value !== null && value > 0 && value < 0.01) return `<${formatUsdCompact(0.01, locale)}`;
  return formatUsdCompact(value, locale);
}

/** A count in the reader's locale, its thousands grouped. */
function count(value: number | null, locale: string): string {
  return value === null ? "—" : new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US").format(value);
}

/** A DEX as people name it, from GeckoTerminal's id: «pancakeswap-v3-solana» → «Pancakeswap v3». */
function dexName(id: string): string {
  const words = id.replace(/-solana$/, "").split("-").filter(Boolean);
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

function ago(iso: string, uk: boolean, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return uk ? `${seconds} с` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return uk ? `${minutes} хв` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return uk ? `${hours} год` : `${hours}h`;
  return uk ? `${Math.floor(hours / 24)} д` : `${Math.floor(hours / 24)}d`;
}

function clock(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** Where a tab's figures come from, with the attribution the source's terms ask for, and the time of the read. */
function SourceLine({ sources, observedAt, stale, children }: { sources: readonly TokenPageSource[]; observedAt?: string | null; stale?: boolean; children?: ReactNode }) {
  const { text, locale } = useSolanaI18n();
  return (
    <p className={styles.tokenSource} data-token-source>
      {children ? <span>{children}</span> : null}
      {sources.map((source) => {
        const entry = TOKEN_PAGE_SOURCES[source];
        return entry.attribution ? (
          <a key={source} href={entry.href} target="_blank" rel="noreferrer noopener" data-attribution={source}>
            {entry.attribution}
          </a>
        ) : (
          <span key={source}>{text("Solana chain")}</span>
        );
      })}
      {observedAt ? <span>{stale ? text("Last read") : text("Read")} {clock(observedAt, locale)}</span> : null}
    </p>
  );
}

/** The states every part shares: reading, nothing for this token, could not be read. */
function PartState<T>({ read, children }: { read: TokenPartRead<T> & { retry: () => void }; children: (value: T) => ReactNode }) {
  const { text } = useSolanaI18n();
  if (read.status === "ready") return <>{children(read.value)}</>;
  if (read.status === "none") return <div className={styles.empty}><span>{text(noneSentence(read.code))}</span></div>;
  if ((read.status === "loading" || read.status === "unavailable") && read.value) {
    return (
      <>
        {read.status === "unavailable" ? (
          <p className={styles.note}>
            {text("Could not refresh — showing the last read.")} <button type="button" className={styles.ghost} onClick={read.retry}>{text("Read again")}</button>
          </p>
        ) : null}
        {children(read.value)}
      </>
    );
  }
  if (read.status === "unavailable") {
    return (
      <div className={styles.empty}>
        <span>{text("This could not be read just now.")}</span>
        <button type="button" className={styles.ghost} onClick={read.retry}>{text("Read again")}</button>
      </div>
    );
  }
  return <div className={styles.empty}><span className={styles.tokenBone} aria-hidden="true" /><span className="sr-only">{text("Reading…")}</span></div>;
}

function noneSentence(code: string): string {
  if (code === "NO_POOL") return "No pool of this token traded in the last day.";
  if (code === "NOT_LISTED") return "The catalogue does not list this token.";
  return "SOL is held by every wallet on the network; its holders are not listed.";
}

function Wallet({ address, labels, you }: { address: string; labels: readonly string[]; you: boolean }) {
  const { text } = useSolanaI18n();
  return (
    <span className={styles.tokenWallet}>
      <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noreferrer noopener" title={address} translate="no" data-mono="true">
        {shortAddress(address)}
      </a>
      {you ? <span className={styles.tokenTag} data-tag="you">{text("You")}</span> : null}
      {labels.map((label) => (
        <span key={label} className={styles.tokenTag} data-tag={label}>
          {label === "creator" ? text("Creator") : label === "pool" ? text("Pool") : label === "program" ? text("Program") : label === "top10" ? text("Top 10") : label}
        </span>
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------- trades */

type TradeFilter = "all" | "buy" | "sell" | "big";
/** How many trades the tab shows at first, and adds on each «more». */
const TRADES_PAGE = 20;

function TradesTab({ market, facts, owner }: { market: SpotMarket; facts: TokenFacts | null; owner: string | null }) {
  const { text, locale } = useSolanaI18n();
  const uk = locale === "uk";
  const read = useTokenPart<TradesBody>(market.mint, "trades", true);
  const [filter, setFilter] = useState<TradeFilter>("all");
  const [shown, setShown] = useState(TRADES_PAGE);
  const top10 = useMemo(() => new Set(read.status === "ready" ? read.value.topHolders : []), [read]);
  const now = Date.now();
  return (
    <PartState read={read}>
      {(body) => {
        const matching = body.trades.filter((trade) => (filter === "all" ? true : filter === "big" ? (trade.usd ?? 0) >= 1_000 : trade.side === filter));
        const rows = matching.slice(0, shown);
        const buys = body.trades.filter((trade) => trade.side === "buy");
        const buyUsd = buys.reduce((sum, trade) => sum + (trade.usd ?? 0), 0);
        const sellUsd = body.trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + (trade.usd ?? 0), 0);
        return (
          <div className={styles.tokenTab} data-token-tab="trades">
            <div className={styles.tokenBar}>
              <div className={styles.tokenFilters} role="group" aria-label={text("Show trades")} data-dense>
                {(["all", "buy", "sell", "big"] as const).map((entry) => (
                  <button key={entry} type="button" aria-pressed={filter === entry} className={filter === entry ? "on" : ""} onClick={() => { setFilter(entry); setShown(TRADES_PAGE); }}>
                    {entry === "all" ? text("All") : entry === "buy" ? text("Buys") : entry === "sell" ? text("Sells") : text("$1K+")}
                  </button>
                ))}
              </div>
              {body.trades.length > 0 ? (
                <p className={styles.tokenSummary} data-mono="true">
                  <span className={styles.up}>{text("Bought")} {formatUsdCompact(buyUsd, locale)}</span>
                  <span className={styles.down}>{text("Sold")} {formatUsdCompact(sellUsd, locale)}</span>
                </p>
              ) : null}
            </div>
            {rows.length === 0 ? (
              <div className={styles.empty}><span>{body.trades.length === 0 ? text("No trades in this pool lately.") : text("No trades of this kind among the last read.")}</span></div>
            ) : (
              <div className={styles.tokenScroll}>
                <table className={`${styles.fills} ${styles.tokenTable}`}>
                  <thead>
                    <tr>
                      <th scope="col">{text("When")}</th>
                      <th scope="col">{text("Who")}</th>
                      <th scope="col" data-narrow-hide>{text("Side")}</th>
                      <th scope="col" data-num>{market.symbol}</th>
                      <th scope="col" data-num>USD</th>
                      {body.capCounted ? <th scope="col" data-num data-optional>{text("Market cap then")}</th> : null}
                      <th scope="col"><span className="sr-only">{text("Explorer")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((trade) => (
                      <tr key={`${trade.signature}:${trade.side}`} data-side={trade.side}>
                        <td data-mono="true" title={new Date(trade.at).toLocaleString(locale)}>{ago(trade.at, uk, now)}</td>
                        <td>
                          <Wallet
                            address={trade.wallet}
                            you={owner === trade.wallet}
                            labels={[...(facts?.dev === trade.wallet ? ["creator"] : []), ...(top10.has(trade.wallet) && facts?.dev !== trade.wallet ? ["top10"] : [])]}
                          />
                        </td>
                        <td data-side-cell={trade.side} data-narrow-hide>{trade.side === "buy" ? text("Bought") : text("Sold")}</td>
                        {/* The amount in the side's colour, so a phone without the side's column still reads who bought and who sold. */}
                        <td data-mono="true" data-num data-side-cell={trade.side}>
                          <span className="sr-only">{trade.side === "buy" ? text("Bought") : text("Sold")} </span>
                          {tokens(trade.tokenAmount, locale)}
                        </td>
                        <td data-mono="true" data-num>{dollars(trade.usd, locale)}</td>
                        {body.capCounted ? <td data-mono="true" data-num data-optional>{formatUsdCompact(trade.capUsd, locale)}</td> : null}
                        <td><a href={`https://solscan.io/tx/${trade.signature}`} target="_blank" rel="noreferrer noopener" aria-label={text("Open in the explorer")}><ArrowSquareOut size={12} aria-hidden="true" /></a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {matching.length > rows.length ? (
              <button type="button" className={styles.ghost} onClick={() => setShown((count) => count + TRADES_PAGE)} data-trades-more>
                {text("Show more")} · {Math.min(TRADES_PAGE, matching.length - rows.length)}
              </button>
            ) : null}
            <SourceLine sources={["geckoterminal"]} observedAt={body.observedAt} stale={body.stale}>
              {text("The last trades of")} <b translate="no">{body.pool.name}{body.pool.dex ? ` · ${dexName(body.pool.dex)}` : ""}</b>
              {body.span ? ` · ${clock(body.span.from, locale)}–${clock(body.span.to, locale)}` : ""}
              {body.capCounted ? ` · ${text("market cap at the trade's price and today's supply")}` : ""}
              {` · ${text("on the chart, arrows mark the three largest trades read")}`}
            </SourceLine>
          </div>
        );
      }}
    </PartState>
  );
}

/* --------------------------------------------------------------- holders */

function HoldersTab({ market, owner }: { market: SpotMarket; owner: string | null }) {
  const { text, locale } = useSolanaI18n();
  const read = useTokenPart<HoldersBody>(market.mint, "holders", true);
  return (
    <PartState read={read}>
      {(body) => (
        <div className={styles.tokenTab} data-token-tab="holders">
          <div className={styles.tokenBar}>
            <p className={styles.tokenSummary}>
              <span>{text("Top holders, as Jupiter counts them")} <b data-mono="true">{pct(market.audit.topHoldersPct, locale)}</b></span>
              <span>{text("Program accounts among these 20")} <b data-mono="true">{pct(body.programPct, locale)}</b></span>
              <span>{text("Holders")} <b data-mono="true">{count(market.holders, locale)}</b></span>
            </p>
          </div>
          {body.holders.length === 0 ? (
            <div className={styles.empty}><span>{text("No holder could be read.")}</span></div>
          ) : (
            <div className={styles.tokenScroll}>
              <table className={`${styles.fills} ${styles.tokenTable}`}>
                <thead>
                  <tr>
                    <th scope="col" data-num>#</th>
                    <th scope="col">{text("Holder")}</th>
                    <th scope="col" data-num data-narrow-hide>{market.symbol}</th>
                    <th scope="col" data-num>{text("Of supply")}</th>
                    <th scope="col" data-num>{text("Change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {body.holders.map((holder, index) => (
                    <tr key={holder.owner}>
                      <td data-mono="true" data-num>{index + 1}</td>
                      <td><Wallet address={holder.owner} labels={holder.labels} you={owner === holder.owner} /></td>
                      <td data-mono="true" data-num data-narrow-hide>{tokens(holder.amount, locale)}</td>
                      <td data-num>
                        <span className={styles.tokenShare}>
                          <span className={styles.tokenShareTrack} aria-hidden="true">
                            <span className={styles.tokenShareBar} style={{ inlineSize: `${Math.min(100, Math.max(2, ((holder.sharePct ?? 0) / Math.max(1e-9, body.holders[0]?.sharePct ?? 1)) * 100))}%` }} />
                          </span>
                          <span data-mono="true">{pct(holder.sharePct, locale, 2)}</span>
                        </span>
                      </td>
                      <td data-mono="true" data-num className={holder.change === null ? undefined : holder.change > 0 ? styles.up : holder.change < 0 ? styles.down : undefined}>
                        {holder.change === null ? "—" : `${holder.change > 0 ? "+" : holder.change < 0 ? "−" : ""}${formatAmount(Math.abs(holder.change), locale, 2)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <SourceLine sources={body.span ? ["chain", "jupiter", "geckoterminal"] : ["chain", "jupiter"]} observedAt={body.observedAt} stale={body.stale}>
            {text("The 20 largest accounts on the chain, by owner")}
            {body.span
              ? ` · ${text("change: the holder's own buys and sells in the main pool")} ${clock(body.span.from, locale)}–${clock(body.span.to, locale)}, ${text("transfers not counted")}`
              : ` · ${text("change: no trades read")}`}
          </SourceLine>
        </div>
      )}
    </PartState>
  );
}

/* ----------------------------------------------------------------- pools */

function PoolsTab({ market }: { market: SpotMarket }) {
  const { text, locale } = useSolanaI18n();
  const read = useTokenPart<PoolsBody>(market.mint, "pools", true);
  return (
    <PartState read={read}>
      {(body) => (
        <div className={styles.tokenTab} data-token-tab="pools">
          <div className={styles.tokenBar}>
            <p className={styles.tokenSummary}>
              <span>{text("Liquidity")} <b data-mono="true">{formatUsdCompact(market.liquidityUsd, locale)}</b></span>
            </p>
          </div>
          {body.pools.length === 0 ? (
            <div className={styles.empty}><span>{text("No pool of this token is listed.")}</span></div>
          ) : (
            <div className={styles.tokenScroll}>
              <table className={`${styles.fills} ${styles.tokenTable}`}>
                <thead>
                  <tr>
                    <th scope="col">{text("Pool")}</th>
                    <th scope="col" data-num>{text("Liquidity")}</th>
                    <th scope="col" data-num>{text("Volume 24h")}</th>
                    <th scope="col" data-num data-optional>{text("Trades 24h")}</th>
                    <th scope="col" data-num data-optional>{text("Age")}</th>
                  </tr>
                </thead>
                <tbody>
                  {body.pools.map((pool) => (
                    <tr key={pool.address}>
                      <td>
                        <a href={`https://www.geckoterminal.com/solana/pools/${pool.address}`} target="_blank" rel="noreferrer noopener" translate="no">
                          {pool.name}
                        </a>
                        {pool.dex ? <span className={styles.tokenDex}> · {dexName(pool.dex)}</span> : null}
                      </td>
                      <td data-mono="true" data-num>{formatUsdCompact(pool.reserveUsd, locale)}</td>
                      <td data-mono="true" data-num>{formatUsdCompact(pool.volume24hUsd, locale)}</td>
                      <td data-mono="true" data-num data-optional>{pool.buys24h === null && pool.sells24h === null ? "—" : `${count(pool.buys24h ?? 0, locale)} / ${count(pool.sells24h ?? 0, locale)}`}</td>
                      <td data-num data-optional>{pool.createdAt ? formatAge(Math.floor((Date.now() - Date.parse(pool.createdAt)) / 86_400_000), locale === "uk") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <SourceLine sources={["jupiter", "geckoterminal"]} observedAt={body.observedAt}>
            {text("Total liquidity from Jupiter; pools by depth; trades 24h are buys / sells")}
          </SourceLine>
        </div>
      )}
    </PartState>
  );
}

/* ------------------------------------------------------------------ risk */

const RISK_TITLES: Readonly<Record<RiskFact["code"], string>> = {
  MINT_AUTHORITY: "Minting right",
  FREEZE_AUTHORITY: "Freezing right",
  FLAGGED: "Flagged by Jupiter",
  VERIFIED: "Jupiter verification",
  ORGANIC: "Organic activity",
  TOP10: "Top holders",
  CREATOR_HOLDS: "The creator holds",
  CREATOR_TOKENS: "Tokens the creator made",
  LIQUIDITY: "Liquidity",
  LIQUIDITY_CHANGE: "Liquidity, 24h",
  AGE: "Age",
  HONEYPOT: "Honeypot check",
};

function riskValue(fact: RiskFact, text: (english: string) => string, locale: string): string {
  switch (fact.code) {
    case "MINT_AUTHORITY":
    case "FREEZE_AUTHORITY":
      return fact.state === "active" ? text("Active") : text("Revoked");
    case "FLAGGED":
      return text("Yes");
    case "VERIFIED":
      return fact.state === "yes" ? text("Verified") : text("Not verified");
    case "ORGANIC":
      return fact.state === "high" ? text("High") : fact.state === "medium" ? text("Medium") : fact.state === "low" ? text("Low") : (fact.state ?? "—");
    case "TOP10":
    case "CREATOR_HOLDS":
      return pct(fact.value, locale, fact.value !== null && fact.value < 1 ? 2 : 1);
    case "CREATOR_TOKENS":
      return count(fact.value, locale);
    case "LIQUIDITY":
      return formatUsdCompact(fact.value, locale);
    case "LIQUIDITY_CHANGE":
      return formatPercent(fact.value, locale);
    case "AGE":
      return fact.value === null ? "—" : fact.value < 1 ? `${Math.max(1, Math.round(fact.value * 24))} ${locale === "uk" ? "год" : "h"}` : formatAge(Math.floor(fact.value), locale === "uk");
    case "HONEYPOT":
      return fact.state === "yes" ? text("Selling looks blocked") : fact.state === "unread" ? text("Not read") : text("Selling not blocked");
  }
}

/** Why the fact matters, in one sentence — the same for every token, so the figure speaks, not a verdict. */
function riskReason(fact: RiskFact, stock: boolean): string | null {
  switch (fact.code) {
    case "MINT_AUTHORITY":
      if (stock) return "The issuer creates tokens against the shares it holds.";
      return fact.state === "active" ? "Whoever holds it can create new tokens and dilute every holder." : "No one can create more of this token.";
    case "FREEZE_AUTHORITY":
      if (stock) return "The issuer can freeze an account, as its terms describe.";
      return fact.state === "active" ? "Whoever holds it can freeze any holder's tokens." : "No one can freeze holders' tokens.";
    case "FLAGGED":
      return "Jupiter's own checks marked this token as suspicious; it does not say why.";
    case "VERIFIED":
      return fact.state === "yes" ? "Jupiter checked that this address is the token it names." : "Jupiter has not checked this address; a copy can borrow a name.";
    case "ORGANIC":
      return "How much of the trading Jupiter counts as real people rather than bots.";
    case "TOP10":
      return "The share of the supply in the largest wallets, as Jupiter counts them.";
    case "CREATOR_HOLDS":
      return "The share of the supply in the wallet Jupiter names as the creator.";
    case "CREATOR_TOKENS":
      return "How many tokens the creator's wallet has launched, as Jupiter counts them.";
    case "LIQUIDITY":
      return "Money in the pools; the smaller it is, the more one sale moves the price.";
    case "LIQUIDITY_CHANGE":
      return "How the money in the pools changed over the last day.";
    case "AGE":
      return "Since the token's first pool.";
    case "HONEYPOT":
      return fact.state === "yes" ? "GeckoTerminal's check says the token may not let holders sell." : fact.state === "unread" ? "GeckoTerminal's check could not be read just now; that is not a «no»." : "GeckoTerminal's check found no block on selling.";
  }
}

function RiskTab({ market }: { market: SpotMarket }) {
  const { text, locale } = useSolanaI18n();
  const read = useTokenPart<RiskBody>(market.mint, "risk", true);
  const stock = market.category === "stock";
  return (
    <div className={styles.tokenTab} data-token-tab="risk">
      <PartState read={read}>
        {(body) => (
          <>
            <p className={styles.tokenLead}>{text("Facts about how the token is built and traded, each with its source. Ryntra gives no verdict.")}</p>
            <ul className={styles.riskFacts}>
              {body.facts.map((fact) => {
                const reason = riskReason(fact, stock);
                return (
                  <li key={`${fact.code}:${fact.state ?? ""}`} data-risk-fact={fact.code} data-tone={fact.tone}>
                    <span className={styles.riskTitle}>{text(RISK_TITLES[fact.code])}</span>
                    <b className={styles.riskValue} data-mono={fact.value !== null ? "true" : undefined}>{riskValue(fact, text, locale)}</b>
                    {reason ? <span className={styles.riskReason}>{text(reason)}</span> : null}
                    <span className={styles.riskSource}>{fact.source === "chain" ? text("Solana chain") : TOKEN_PAGE_SOURCES[fact.source].label}</span>
                  </li>
                );
              })}
            </ul>
            <SourceLine sources={body.facts.some((fact) => fact.source === "geckoterminal") ? ["jupiter", "geckoterminal"] : ["jupiter"]} observedAt={body.observedAt} stale={body.stale} />
          </>
        )}
      </PartState>
      {/* The deeper check on request — who holds the early supply, taxes, and the change since this browser's last look. */}
      <div className={styles.riskDeeper}>
        <RiskCard
          key={`risk-${market.mint}`}
          mint={market.mint}
          locale={locale}
          planHref={stock ? `/app/strategies/new?mint=${encodeURIComponent(market.mint)}` : null}
          assetKind={stock ? "issuer-backed" : market.category === "meme" ? "meme" : market.category === "crypto" ? "crypto" : "unknown"}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- socials */

function SocialsTab({ market, facts }: { market: SpotMarket; facts: TokenFacts | null }) {
  const { text } = useSolanaI18n();
  const links: { key: string; kind: string; href: string; label: string; mark: "x" | "telegram" | "web" }[] = [];
  for (const [kind, href] of [["website", market.links.website], ["twitter", market.links.twitter], ["telegram", market.links.telegram]] as const) {
    if (!href) continue;
    const face = linkFace(kind, href);
    links.push({ key: kind, kind: face.mark === "x" ? "X" : face.mark === "telegram" ? "Telegram" : text("Website"), href, label: face.label, mark: face.mark === "x" ? "x" : face.mark === "telegram" ? "telegram" : "web" });
  }
  for (const social of facts?.socials ?? []) {
    let host = social.url;
    try {
      host = new URL(social.url).host;
    } catch {
      /* The address as given. */
    }
    links.push({ key: social.kind, kind: social.kind === "discord" ? "Discord" : social.kind === "instagram" ? "Instagram" : social.kind === "tiktok" ? "TikTok" : text("Link"), href: social.url, label: host, mark: "web" });
  }
  return (
    <div className={styles.tokenTab} data-token-tab="socials">
      <p className={styles.tokenLead}>{text("The creator's own addresses, as the token's catalogue lists them. Ryntra has not checked them.")}</p>
      <ul className={styles.socialList}>
        {links.map((link) => {
          const Mark = link.mark === "x" ? XLogo : link.mark === "telegram" ? TelegramLogo : Globe;
          return (
            <li key={link.key}>
              <a href={link.href} target="_blank" rel="noreferrer noopener nofollow ugc" data-social={link.key}>
                <Mark size={16} weight="bold" aria-hidden="true" />
                <span>{link.kind}</span>
                <span className={styles.socialHost} translate="no">{link.label}</span>
                <ArrowSquareOut size={12} aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
      <SourceLine sources={["jupiter"]} />
    </div>
  );
}

/* ----------------------------------------------------------------- asset */

/**
 * «Правда про актив» and «Ціна чесна» for a tokenized stock: what the token
 * is in the issuer's words, the price against the exchange in one word, where
 * the issuer does not offer it, and what happens to dividends — each with the
 * issuer's document and its date.
 */
function AssetTab({ market }: { market: SpotMarket }) {
  const { text, locale } = useSolanaI18n();
  const uk = locale === "uk";
  const asset = useStockAsset(market.mint);
  const [allPlaces, setAllPlaces] = useState(false);
  if (asset === undefined) return <div className={styles.empty}><span className={styles.tokenBone} aria-hidden="true" /><span className="sr-only">{text("Reading…")}</span></div>;
  if (asset === null) return <div className={styles.empty}><span>{text("The issuer's facts could not be read just now.")}</span></div>;
  const { row } = asset;
  const issuer = row.representation.issuer.id;
  const terms = ISSUER_TERMS[issuer];
  const company = row.representation.underlying.name ?? row.representation.underlying.symbol;
  const preIpo = row.representation.instrument.class === "pre-ipo";
  const deviation = preIpo ? row.markPremiumPct : row.deviationPct;
  const word = fairPriceOf(deviation);
  const closed = !preIpo && row.session.period !== "market";
  const multiplier = asset.chainMultiplier?.current ?? row.multiplier?.current ?? null;
  const places = allPlaces ? terms.excluded : terms.excluded.slice(0, 6);
  const dated = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : text("undated"));
  return (
    <div className={styles.tokenTab} data-token-tab="asset">
      <p className={styles.assetTruth} data-asset-truth>{truthLine(issuer, company, uk ? "uk" : "en", row.transferFee?.basisPoints ?? null)}</p>
      <dl className={styles.assetGrid}>
        <div data-fair-price={word}>
          <dt>{preIpo ? text("Price against the issuer's mark") : text("Price against the exchange")}</dt>
          <dd>
            <span className={styles.chip} data-tone={word === "fair" ? "verified" : word === "no-reference" || word === "cheaper" ? undefined : "caution"}>{FAIR_PRICE_WORDS[word][uk ? "uk" : "en"]}</span>
            {deviation !== null ? <span data-mono="true" className={toneOf(deviation) === "up" ? styles.up : toneOf(deviation) === "down" ? styles.down : undefined}> {formatPercent(deviation, locale)}</span> : null}
            {closed ? <span className={styles.assetNote}> · {SESSION_WORDS[row.session.period][uk ? "uk" : "en"]} · {text("the price may drift from the exchange")}</span> : null}
          </dd>
        </div>
        <div>
          <dt>{text("The issuer")}</dt>
          <dd>{row.representation.issuer.label}</dd>
        </div>
        <div>
          <dt>{text("Dividends")}</dt>
          <dd>
            {terms.dividends.words[uk ? "uk" : "en"]}
            {terms.dividends.kind === "reinvested" && multiplier !== null ? <span data-mono="true"> · 1 {row.representation.symbol} = {new Intl.NumberFormat(uk ? "uk-UA" : "en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 }).format(multiplier)} {row.representation.underlying.symbol}</span> : null}{" "}
            <a href={terms.dividends.document.url} target="_blank" rel="noreferrer noopener" className={styles.assetDoc}>{text("Source")} <ArrowSquareOut size={11} aria-hidden="true" /></a>
          </dd>
        </div>
        <div data-geo>
          <dt>{text("Where the issuer does not offer it")}</dt>
          <dd>
            <span className={styles.placeList}>
              {places.map((place) => <span key={place.en}>{place[uk ? "uk" : "en"]}</span>)}
              {terms.excluded.length > 6 ? (
                <button type="button" className={styles.linkButton} aria-expanded={allPlaces} onClick={() => setAllPlaces((value) => !value)}>
                  {allPlaces ? text("Less") : `+${terms.excluded.length - 6}`}
                </button>
              ) : null}
            </span>
            {terms.also ? <span className={styles.assetNote}> {terms.also[uk ? "uk" : "en"]}</span> : null}
            {terms.limited.length > 0 ? (
              <span className={styles.assetNote}>
                {" "}· {text("Only for investors who pass the issuer's tests:")} {terms.limited.map((place) => place[uk ? "uk" : "en"]).join(", ")}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className={styles.tokenLead}>
        {text("Ryntra blocks no country: these are the issuer's own terms, so you can check your case.")}{" "}
        {terms.issuerOwn ? null : text("The issuer's own terms for the token were not found; the list is its platform's.")}
      </p>
      <p className={styles.tokenSource}>
        <a href={terms.document.url} target="_blank" rel="noreferrer noopener">{terms.document.title} <ArrowSquareOut size={11} aria-hidden="true" /></a>
        <span>{dated(terms.document.dated)}</span>
        <span>{text("read")} {dated(terms.document.readOn)}</span>
        {!preIpo && row.reference.source.id !== "none" ? <span>{text("Exchange price")}: {row.reference.source.label}</span> : null}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ body */

export function TokenTabBody({ tab, market, facts, owner }: { tab: TokenTab; market: SpotMarket; facts: TokenFacts | null; owner: string | null }) {
  switch (tab) {
    case "asset":
      return <AssetTab market={market} />;
    case "trades":
      return <TradesTab market={market} facts={facts} owner={owner} />;
    case "holders":
      return <HoldersTab market={market} owner={owner} />;
    case "pools":
      return <PoolsTab market={market} />;
    case "risk":
      return <RiskTab market={market} />;
    case "socials":
      return <SocialsTab market={market} facts={facts} />;
  }
}
