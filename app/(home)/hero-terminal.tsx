import { PRODUCT_ROUTES } from "@/app/shell/product-routes";
import { menuNavigation } from "@/app/shell/domains";
import { translateSolana } from "@/app/solana/workspace/i18n/catalog";
import type { PublicLocale } from "@/lib/site/locale";

import styles from "./hero-drawn.module.css";
import { FIGURES, TRADE } from "./workflow-trade";

/**
 * The product in the hero: the Spot workspace with NVDAx open, drawn in HTML
 * on a 900 × 560 canvas and scaled by the frame it sits in (`--u` is one canvas
 * pixel, so the picture stays crisp at every width and both pixel ratios —
 * a screenshot would blur and could not be translated).
 *
 * What is real and what is a snapshot. The rail is the product's own menu —
 * its sections over the page registry (`PRODUCT_ROUTES` through
 * `menuNavigation`, canon v5.4) — so it is the rail the cabinet draws and
 * nothing planned can render as open. The market header's words are the Spot page's own strings through the
 * workspace catalogue. The figures — the list, the market stats — are a
 * snapshot of `ryntra.io/app/spot` taken on 2026-09-13 with NVDAx open, not
 * invented and not live; the NVDAx price, its day's move, its liquidity and
 * volume are the page's one illustrative story (workflow-trade.ts), so the
 * hero, the workflow and the rewards never disagree about the same market;
 * the whole frame is `aria-hidden` and the copy beside it says so in words.
 */

type Row = Readonly<{ symbol: string; name: string; price: string; change: string; up: boolean; selected?: boolean }>;

/* The tokens' own logos, served from this site: the same discs the universe
   orbits (public/site/universe, fetched by scripts/site/fetch-universe-icons.mjs
   from each token's metadata image and cut round). A symbol without a file
   keeps its two letters, so the list can never show a broken picture. */
const LOGOS: ReadonlySet<string> = new Set(["NVDAx", "SPYx", "TSLAx", "AAPLx", "MSFTx", "GOOGLx", "QQQx", "METAx", "AMZNx"]);

function Tile({ symbol, large }: { symbol: string; large?: boolean }) {
  const className = large ? `${styles.tTile} ${styles.tTileLarge}` : styles.tTile;
  if (!LOGOS.has(symbol)) return <span className={className}>{symbol.slice(0, 1)}</span>;
  const size = large ? 28 : 22;
  // eslint-disable-next-line @next/next/no-img-element -- the token's own metadata image, served from this site at its drawn size
  return <img src={`/site/universe/${symbol}.png`} alt="" className={className} width={size} height={size} loading="lazy" decoding="async" />;
}

/* Snapshot 2026-09-13 — the Stocks/RWA category of /app/spot, in the order the
   list showed them, NVDAx brought to the top because it is the market open on
   the right. The NVDAx row carries the header's own figures so the picture
   agrees with itself. */
const MARKETS: readonly Row[] = [
  { symbol: TRADE.symbol, name: TRADE.name, price: FIGURES.quote, change: FIGURES.change24h, up: TRADE.change24h > 0, selected: true },
  { symbol: "SPYx", name: "SP500 xStock", price: "$759.95", change: "−0.68%", up: false },
  { symbol: "TSLAx", name: "Tesla xStock", price: "$362.76", change: "−0.83%", up: false },
  { symbol: "AAPLx", name: "Apple xStock", price: "$330.93", change: "−0.37%", up: false },
  { symbol: "MSFTx", name: "Microsoft xStock", price: "$490.71", change: "−0.51%", up: false },
  { symbol: "GOOGLx", name: "Alphabet xStock", price: "$337.42", change: "−0.82%", up: false },
  { symbol: "QQQx", name: "Nasdaq xStock", price: "$708.05", change: "−1.02%", up: false },
  { symbol: "METAx", name: "Meta xStock", price: "$641.36", change: "−1.17%", up: false },
  { symbol: "AMZNx", name: "Amazon xStock", price: "$253.43", change: "−1.44%", up: false },
];

/* The day the figures were read from the live page; the x-axis marks its start. */
const SNAPSHOT_DAY = "2026-09-13";
const LAST = TRADE.quote;
const STATS: readonly (readonly [string, string])[] = [
  ["Liquidity", TRADE.liquidity],
  ["Volume 24h", TRADE.volume24h],
  ["1h", "−0.57%"],
  ["Market cap", "$69.1M"],
  ["Holders", "90,137"],
];
const FRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
const AXIS = ["218.00", "217.00", "216.00", "215.00", "214.00", "213.00", "212.00"] as const;
const CLOCK = ["12:00", "15:00", "18:00", "21:00", SNAPSHOT_DAY.slice(-2), "03:00", "06:00", "09:00"] as const;

/* The chart's vertical scale: 212–218 over the 240-unit canvas. */
const yOf = (price: number) => 6 + ((218 - price) / 6) * 190;

type Candle = Readonly<{ x: string; cx: string; y: string; h: string; hy: string; ly: string; up: boolean; vy: string; vh: string }>;

/**
 * Fifty-six candles from a seeded generator, so every build draws the same
 * day: a drift up, a longer leg down, a bounce and a fade — the shape of the
 * session the snapshot was taken in. The generator's own last close is then
 * carried to the header price by a warp that grows from nothing at the first
 * candle to the whole difference at the last, so the day ends on the figure
 * above the chart without a spike at the end: the dashed last-price line, the
 * axis tag and the price are one number.
 */
function candles(): readonly Candle[] {
  let seed = 7;
  let value = 216.4;
  const closes: number[] = [];
  const wicks: number[] = [];
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 56; i++) {
    const r1 = next() - 0.5;
    const r2 = next();
    const drift = i < 18 ? 0.05 : i < 34 ? -0.12 : i < 46 ? 0.04 : -0.06;
    value = Math.min(217.9, Math.max(212.4, value + r1 * 1.4 + drift));
    closes.push(value);
    wicks.push(r2);
  }
  const residual = LAST - closes[55];
  const warped = closes.map((close, i) => close + (residual * i) / 55);
  const out: Candle[] = [];
  for (let i = 0; i < 56; i++) {
    const open = i === 0 ? 216.4 : warped[i - 1];
    const close = warped[i];
    const r2 = wicks[i];
    const high = Math.min(218, Math.max(open, close) + r2 * 0.5);
    const low = Math.max(212.2, Math.min(open, close) - (1 - r2) * 0.5);
    const up = close >= open;
    const top = yOf(Math.max(open, close));
    const height = Math.max(1.5, yOf(Math.min(open, close)) - top);
    const x = 4 + i * 6.35;
    out.push({
      x: x.toFixed(1),
      cx: (x + 2).toFixed(1),
      y: top.toFixed(1),
      h: height.toFixed(1),
      hy: yOf(high).toFixed(1),
      ly: yOf(low).toFixed(1),
      up,
      vy: (238 - 8 - r2 * 22).toFixed(1),
      vh: (8 + r2 * 22).toFixed(1),
    });
  }
  return out;
}

const CANDLES = candles();
const GRID = [218, 217, 216, 215, 214, 213, 212].map((price) => yOf(price).toFixed(1));
const LAST_Y = yOf(LAST);

export function HeroTerminal({ locale }: { locale: PublicLocale }) {
  const text = (english: string) => translateSolana(locale, english);
  /* The menu you can see (canon v5.4 В30): every section with its caption,
     nothing behind «Ще». The picture is Spot, so Spot is the lit row. */
  const menu = menuNavigation(PRODUCT_ROUTES, locale);

  return (
    <div className={styles.terminal} aria-hidden="true">
      <div className={styles.tBar}>
        <span className={styles.tBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the lockup is an SVG served as it is */}
          <img src="/brand/ryntra-wordmark-dark.svg" alt="" className={styles.tWordmark} />
          <span className={styles.tBeta}>BETA</span>
          <span className={styles.tNet}>Solana Mainnet</span>
        </span>
        {/* A connected wallet, said as a word: no real address is ever drawn on the public page (RYN-FIRST-SCREEN-001). */}
        <span className={styles.tWallet}><span className={styles.tDotLive} />{text("Wallet")}</span>
      </div>

      <div className={styles.tBody}>
        <nav className={styles.tRail}>
          {menu.sections.map((section) => (
            <div key={section.id} className={styles.tGroup}>
              {section.title ? <span className={styles.tGroupTitle}>{section.title}</span> : null}
              {section.rows.map((row) => (
                /* The cabinet's menu draws only pages that are ready; a page being built reads as a page. */
                <span key={row.id} className={styles.tNavRow} data-active={row.id === "spot" || undefined}>
                  <span className={styles.tNavName}><span className={styles.tNavDot} />{row.label}</span>
                </span>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.tMarkets}>
          <span className={styles.tPageTitle}>{text("Spot")}</span>
          <span className={styles.tSearch}>{text("Search by name, ticker or address")}</span>
          <span className={styles.tViews}>
            <span>ALL</span><span>CRYPTO</span><span>MEMES</span><span data-active="">STOCKS/RWA</span>
          </span>
          <div className={styles.tList}>
            {MARKETS.map((row) => (
              <span key={row.symbol} className={styles.tMarketRow} data-selected={row.selected || undefined}>
                <Tile symbol={row.symbol} />
                <span className={styles.tMarketName}><strong>{row.symbol}</strong><span>{row.name}</span></span>
                <span className={styles.tMarketPrice}><strong>{row.price}</strong><span data-tone={row.up ? "up" : "down"}>{row.change}</span></span>
              </span>
            ))}
          </div>
        </div>

        <div className={styles.tChart}>
          <div className={styles.tHead}>
            <span className={styles.tIdentity}>
              <Tile symbol={TRADE.symbol} large />
              <span className={styles.tIdentityText}>
                <span className={styles.tSymbol}>NVDAx <span className={styles.tVerified}>{text("Verified")}</span></span>
                <span className={styles.tIssuer}>xStocks · Backed Finance</span>
                <span className={styles.tName}>NVIDIA xStock</span>
              </span>
            </span>
            <span className={styles.tStar}>☆</span>
          </div>
          <div className={styles.tPrice}><strong>{FIGURES.quote}</strong><span data-tone={TRADE.change24h > 0 ? "up" : "down"}>{FIGURES.change24h}</span><span>· 24h</span></div>
          <div className={styles.tStats}>
            {STATS.map(([label, value]) => (
              <span key={label} className={styles.tStat}><span>{text(label)}</span><strong data-tone={label === "1h" ? "down" : undefined}>{value}</strong></span>
            ))}
            <span className={styles.tStat}><span>{text("Trades")}</span><strong>{text("On-chain, 24/7")}</strong></span>
          </div>
          <div className={styles.tFrames}>
            {FRAMES.map((frame) => <span key={frame} data-active={frame === "1h" || undefined}>{frame}</span>)}
          </div>
          <div className={styles.tPlot}>
            <svg viewBox="0 0 400 240" preserveAspectRatio="none" className={styles.tSvg}>
              {GRID.map((y) => <line key={y} x1="0" x2="360" y1={y} y2={y} className={styles.tGridLine} />)}
              {CANDLES.map((candle, i) => (
                <g key={candle.x} className={styles.tCandle} data-tone={candle.up ? "up" : "down"} style={{ animationDelay: `${520 + i * 12}ms` }}>
                  <line x1={candle.cx} x2={candle.cx} y1={candle.hy} y2={candle.ly} strokeWidth="1" />
                  <rect x={candle.x} y={candle.y} width="4" height={candle.h} />
                  <rect x={candle.x} y={candle.vy} width="4" height={candle.vh} opacity=".35" />
                </g>
              ))}
              <line x1="0" x2="360" y1={LAST_Y.toFixed(1)} y2={LAST_Y.toFixed(1)} className={styles.tLastLine} strokeDasharray="3 3" />
            </svg>
            <span className={styles.tAxis}>{AXIS.map((tick) => <span key={tick}>{tick}</span>)}</span>
            <span className={styles.tLastTag} style={{ top: `${((LAST_Y / 240) * 100).toFixed(1)}%` }}>{LAST.toFixed(2)}</span>
          </div>
          <span className={styles.tClock}>{CLOCK.map((tick) => <span key={tick}>{tick}</span>)}</span>
        </div>

        <div className={styles.tTicket}>
          <span className={styles.tSide}><span data-active="">{text("Buy")}</span><span>{text("Sell")}</span></span>
          <span className={styles.tTicketRow}><span className={styles.tChip}>{text("Market")} ▾</span><span>{text("You hold")} <strong>0.0174 NVDAx</strong></span></span>
          <span className={styles.tSpend}>
            <span className={styles.tSpendLabel}>{text("Spend")} (USDC)</span>
            <span className={styles.tSpendRow}><span className={styles.tAmount}>0.0</span><span className={styles.tAsset}><span className={styles.tUsdc} />USDC ▾</span></span>
            <span className={styles.tQuick}><span>25%</span><span>50%</span><span>75%</span><span>MAX</span></span>
          </span>
          <span className={styles.tBuy}>{text("Buy")} NVDAx</span>
          <span className={styles.tFine}>Tokenized by xStocks · Backed Finance · the issuer’s terms apply</span>
        </div>
      </div>
    </div>
  );
}
