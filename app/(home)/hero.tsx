import Link from "next/link";
import { ArrowRight, ArrowsClockwise, Buildings, ChartLineUp, Clock, Gift, RocketLaunch } from "@phosphor-icons/react/dist/ssr";
import type { PublicLocale } from "@/lib/site/locale";
import { HOMEPAGE_COPY } from "@/lib/site/homepage-copy";
import { homepageModel, type HeroStripId } from "@/lib/site/homepage-model";
import { localizedPath } from "@/lib/site/localized";
import { HeroAtmosphere } from "./hero-atmosphere";
import { HeroTerminal } from "./hero-terminal";
import styles from "./hero.module.css";

/**
 * The hero, drawn in code — the Owner's render's composition, live.
 *
 * On 2026-09-14 the Owner asked whether the hero could stop being a picture
 * and still look the same, and said *«Роби»*. It can, because the render
 * held exactly one thing code cannot draw — its landscape — and everything
 * else was product: the words on the left, the Spot workspace with NVDAx
 * open in a tilted device, the Portfolio and Rewards cards grown out of its
 * lower corners, the rail of three proofs on the right, the strip of four
 * along the foot. All of that is HTML here, in the same places; the
 * landscape became the page's own light (hero-atmosphere.tsx) — the great
 * orange arc, the warm horizon behind the device, the dust — so the top of
 * the site and the blocks below are one fabric, and what the render gave up
 * (crisp type at 2560 px, a real button, selectable words, one set of
 * figures for the whole page) comes back.
 *
 * What is real. The words are `HOMEPAGE_COPY`; the device's rail is the
 * product's page registry and its labels the Spot catalogue's; the market
 * figures are the page's one illustrative NVDAx story (workflow-trade.ts),
 * marked as a snapshot in the note a screen reader gets instead of the
 * device; the strip's statuses come from the route registry, so a page
 * still being built says so; every destination is a real page. The
 * portfolio on the card is the Owner's own small position, not a staged
 * balance.
 *
 * Motion: one staggered entrance, the light breathing on long clocks while
 * the hero is on screen, a small turn of the device toward the pointer on
 * hover; still under `prefers-reduced-motion`. The render itself is parked
 * in hero-render.tsx and can be mounted again from there.
 */

/* The four ways in along the hero's foot (canon v5.5): a company from $1 in
   Markets, the rules in «Автоінвест», the private companies on Markets' own
   tab, the fee back on Rewards. */
const STRIP_HREF: Readonly<Record<HeroStripId, string>> = {
  invest: "/app/markets",
  autoinvest: "/app/autoinvest",
  private: "/app/markets?tab=private",
  rewards: "/app/rewards",
};

const STRIP_ICONS = {
  invest: <Buildings size={22} weight="regular" aria-hidden />,
  autoinvest: <ArrowsClockwise size={22} weight="regular" aria-hidden />,
  private: <RocketLaunch size={22} weight="regular" aria-hidden />,
  rewards: <Gift size={22} weight="regular" aria-hidden />,
} as const;

const ALLOCATION_TONES = [styles.toneBrand, styles.toneSteel, styles.toneHoney, styles.toneSlate] as const;

export function Hero({ locale }: { locale: PublicLocale }) {
  const c = HOMEPAGE_COPY[locale];
  const h = c.hero;
  const model = homepageModel(locale);

  return (
    <section className={styles.hero} aria-labelledby="homepage-title">
      <HeroAtmosphere />

      <div className={styles.scene}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{h.eyebrow}</p>
          <h1 id="homepage-title" className={styles.h1}>
            {/* A space between the lines for whoever reads the text rather than the page — a search engine, a screen reader; a block line drops it on screen. */}
            {c.titleLines.map((line, index) => (
              <span key={line} className={index === 1 ? styles.h1Accent : undefined}>{index > 0 ? " " : null}{line}</span>
            ))}
          </h1>
          <p className={styles.sub}>{h.sub}</p>
          <p className={styles.lead}>{h.lead}</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href={localizedPath("/app/home", locale)} prefetch={false}>
              {h.open}
              <ArrowRight size={20} weight="bold" aria-hidden />
            </Link>
          </div>
        </div>

        <div className={styles.visual}>
          {/* The device: a lid with the workspace on its screen, a rim of the
              brand's light, a foot, and its light on the floor beneath. */}
          <div className={styles.device}>
            <div className={styles.lid}>
              <span className={styles.rim} aria-hidden="true" />
              <div className={styles.screen}>
                <span className={styles.srOnly}>{h.productNote}</span>
                <HeroTerminal locale={locale} />
                <span className={styles.glass} aria-hidden="true" />
              </div>
            </div>
            <span className={styles.foot} aria-hidden="true" />
            <span className={styles.floorLight} aria-hidden="true" />
          </div>

          {/* The two cards grow out of the device's lower corners: the same
              dark surface, the same hairline, turned a little toward the
              reader like the device itself. */}
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
          <span className={styles.railItem}>
            {/* eslint-disable-next-line @next/next/no-img-element -- the network's own mark, an SVG served as it is */}
            <img src="/site/solana-mark.svg" alt="" width={26} height={20} className={styles.railMark} />
            <span>{h.builtOn} {h.solana}</span>
          </span>
          <span className={styles.railItem}>
            <ChartLineUp size={24} weight="regular" aria-hidden className={styles.railIcon} />
            <span>{h.rail[0]}</span>
          </span>
          <span className={styles.railItem}>
            <Clock size={24} weight="regular" aria-hidden className={styles.railIcon} />
            <span>{h.rail[1]}</span>
          </span>
        </aside>
      </div>

      <div className={styles.stripWrap}>
        <ul className={styles.strip} aria-label={h.eyebrow}>
          {h.strip.map((item) => {
            const status = model.hero.find((entry) => entry.id === item.id)?.status ?? "UNAVAILABLE";
            return (
              <li key={item.id}>
                <Link className={styles.stripItem} href={localizedPath(STRIP_HREF[item.id], locale)} prefetch={false}>
                  <span className={styles.stripGlyph}>{STRIP_ICONS[item.id]}</span>
                  <span className={styles.stripText}>
                    <span className={styles.stripTitle}>
                      {item.big ? `${item.big} ${item.title}` : item.title}
                      {status !== "AVAILABLE" ? <span className={styles.stripStatus}>{c.statuses[status]}</span> : null}
                    </span>
                    <span className={styles.stripBody}>{item.body}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <p className={styles.motto}><span className={styles.mottoLine} />{h.motto}</p>
      </div>
    </section>
  );
}
