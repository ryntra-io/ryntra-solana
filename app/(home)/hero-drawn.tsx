import Link from "next/link";
import { ArrowRight, ArrowsClockwise, Buildings, Gift, RocketLaunch } from "@phosphor-icons/react/dist/ssr";
import type { PublicLocale } from "@/lib/site/locale";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { homepageModel, type HeroStripId } from "@/lib/site/homepage-model";
import { HeroTerminal } from "./hero-terminal";
import styles from "./hero-drawn.module.css";

/**
 * PARKED — not mounted on any route since the same evening it was built.
 *
 * An hour after it was merged it was
 * replaced with a finished render of the same composition (`hero-art.png`,
 * mounted by `hero.tsx`). Superseded work is kept in source rather than
 * deleted: everything here — the registry-read rail of the drawn terminal,
 * the catalogue-read words, the registry-read strip — still passes its own
 * tests and can be mounted again by pointing `homepage.tsx` back at `Hero`
 * from this file.
 *
 * What it was. One dominant focal point: the real product.
 * The eye is meant to travel TRADE WITH A PLAN → the Spot workspace → NVDAx
 * and the stock list → Solana → Open App, and nothing on the surface competes
 * with that path. No copy was added; the pieces that were already here were
 * made stronger — a larger product, a readable stock list, light behind the
 * frame instead of a glow on it, two cards that grow out of the workspace, a
 * rail of three proof lines and a strip of four.
 *
 * Every destination is a real page: the primary action opens the front door
 * chosen for it then (Swap); *Explore Stocks* opens the stock desk, where Buy
 * comes first; the strip's items open the page they name, and *Strategy & Risk*
 * goes to the worked example below because that page is still being built —
 * which the item says, from the registry, rather than pretending otherwise.
 */

const STRIP_HREF: Readonly<Record<HeroStripId, string>> = {
  invest: "/app/markets",
  autoinvest: "/app/autoinvest",
  private: "/app/markets?tab=private",
  rewards: "/app/rewards",
};

const ICONS = {
  invest: <Buildings size={20} weight="bold" aria-hidden />,
  autoinvest: <ArrowsClockwise size={20} weight="bold" aria-hidden />,
  private: <RocketLaunch size={20} weight="bold" aria-hidden />,
  rewards: <Gift size={20} weight="bold" aria-hidden />,
} as const;

/* The parked features list keeps its own three glyphs. */
const FEATURE_ICONS = {
  stocks: <Buildings size={20} weight="bold" aria-hidden />,
  strategies: <ArrowsClockwise size={20} weight="bold" aria-hidden />,
  rewards: <Gift size={20} weight="bold" aria-hidden />,
} as const;

const ALLOCATION_TONES = [styles.toneBrand, styles.toneSteel, styles.toneHoney, styles.toneSlate] as const;

export function Hero({ locale }: { locale: PublicLocale }) {
  const c = HOMEPAGE_COPY[locale];
  const h = c.hero;
  const model = homepageModel(locale);

  return (
    <section className={styles.hero} aria-labelledby="homepage-title">
      <div className={styles.backdrop} aria-hidden="true">
        <span className={styles.wash} />
        <span className={styles.gridLines} />
        <span className={styles.seamGlow} />
        <span className={styles.seam} />
      </div>

      <div className={styles.frame}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{h.eyebrow}</p>
          <h1 id="homepage-title" className={styles.h1}>
            {c.titleLines.map((line, index) => (
              <span key={line} className={index === 1 ? styles.h1Accent : undefined}>{line}</span>
            ))}
          </h1>
          <p className={styles.sub}>{h.sub}</p>
          <p className={styles.lead}>{h.lead}</p>
          <ul className={styles.features}>
            {h.features.map((feature) => (
              <li key={feature.id}>
                <span className={styles.glyph}>{FEATURE_ICONS[feature.id]}</span>
                <span className={styles.featureText}>
                  <strong>{feature.title}</strong>
                  <span>{feature.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/app/swap" prefetch={false}>
              {h.open}
              <ArrowRight size={18} weight="bold" aria-hidden />
            </Link>
            <Link className={styles.secondary} href="/app/stocks" prefetch={false}>{h.explore}</Link>
          </div>
          <p className={styles.tag}>{h.tag}</p>
        </div>

        <div className={styles.visual}>
          <div className={styles.stage}>
            <span className={styles.ambient} aria-hidden="true" />
            <div className={styles.terminalFrame}>
              <span className={styles.srOnly}>{h.productNote}</span>
              <HeroTerminal locale={locale} />
            </div>

            {/* The two cards grow out of the workspace: the same dark surface,
                the same hairline, overlapping the frame rather than floating
                beside it. */}
            <div className={`${styles.card} ${styles.portfolioCard}`}>
              <span className={styles.cardHead}>
                <span className={styles.cardTitle}><span className={styles.cardMark} />{h.portfolio.title}</span>
                <span className={styles.cardView}>{h.portfolio.view} →</span>
              </span>
              <span className={styles.cardValue}>
                <strong>{h.portfolio.value}</strong>
                <span className={styles.cardChange}>{h.portfolio.change}</span>
                <span className={styles.cardToday}>{h.portfolio.today}</span>
              </span>
              <ul className={styles.allocation}>
                {h.portfolio.rows.map(([name, share], index) => (
                  <li key={name} className={ALLOCATION_TONES[index]}>
                    <span className={styles.allocationName}><span className={styles.allocationDot} />{name}</span>
                    <span className={styles.allocationTrack}><span className={styles.allocationBar} style={{ width: `${Math.min(100, share * 1.6).toFixed(1)}%` }} /></span>
                    <span className={styles.allocationShare}>{share}%</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className={`${styles.card} ${styles.rewardsCard}`}>
              <span className={styles.cardHead}>
                <span className={styles.cardTitle}><span className={styles.cardStar} />{h.rewards.title}</span>
                <span className={styles.cardView}>{h.rewards.view} →</span>
              </span>
              <ul className={styles.rewardRows}>
                {h.rewards.rows.map(([figure, title, detail]) => (
                  <li key={title}>
                    <strong className={styles.rewardFigure}>{figure}</strong>
                    <span className={styles.rewardText}><span>{title}</span><span>{detail}</span></span>
                    <span className={styles.rewardCaret}>›</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <aside className={styles.rail} aria-label={`${h.builtOn} ${h.solana}`}>
            <div className={styles.railTop}>
              <span className={styles.railLabel}>{h.builtOn}</span>
              <span className={styles.solana}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the network's own mark, an SVG served as it is */}
                <img src="/site/solana-mark.svg" alt="" width={26} height={20} />
                {h.solana}
              </span>
            </div>
            <ul className={styles.railProof}>
              {h.rail.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </aside>
        </div>
      </div>

      <ul className={styles.strip} aria-label={h.eyebrow}>
        {h.strip.map((item) => {
          const status = model.hero.find((entry) => entry.id === item.id)?.status ?? "UNAVAILABLE";
          return (
            <li key={item.id}>
              <Link className={styles.stripItem} href={STRIP_HREF[item.id]} prefetch={false}>
                <span className={styles.glyph}>{ICONS[item.id]}</span>
                <span className={styles.stripText}>
                  <span className={styles.stripBig}>{item.big}</span>
                  <span className={styles.stripTitle}>
                    {item.title}
                    {status !== "AVAILABLE" ? <span className={styles.stripStatus}>{c.statuses[status]}</span> : null}
                  </span>
                  <span className={styles.stripBody}>{item.body}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
