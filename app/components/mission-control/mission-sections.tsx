import Link from "next/link";

import { HOME_FACTS as F, type EarnerCard, type EarningsRow } from "@/lib/mission-control/home-facts";
import { MISSION_CONTROL_WORDS as W } from "@/lib/mission-control/words";

import { LaunchDock } from "./launch-dock";
import styles from "./mission-sections.module.css";
import { SpaceBackdrop } from "./space-backdrop";
import { StarSky } from "./star-sky";

/* The flight the three acts sit on: from the pad on the planet's rim, up the curve, arriving along the orbit ring's
   front edge (a tangent, never a corner) and going on the same way round the ring — right along the front, left along
   the back, no turning back. The ring: centre (990, 118), radii 230 × 62. */
const ASCENT = "M 170 236 C 380 236 520 196 700 186 S 900 180 990 180";
const RING = "M 990 180 A 230 62 0 0 0 1220 118 A 230 62 0 0 0 990 56 A 230 62 0 0 0 760 118 A 230 62 0 0 0 990 180";
/* The checks on the ring, in the order the ship meets them: day 7 front-right, day 30 at the back, day 90 back-left;
   each label just above its point. */
const CHECKS = [
  { day: "D7", x: 1189, y: 149, lx: 1176, ly: 134, anchor: "end" },
  { day: "D30", x: 1069, y: 60, lx: 1069, ly: 42, anchor: "middle" },
  { day: "D90", x: 791, y: 87, lx: 791, ly: 66, anchor: "middle" },
] as const;

/** One fee's split: a thin glowing track per party, each as long as its share, the share written above it. */
function Gauge({ row }: { row: EarningsRow }) {
  const parts = [
    { key: "creator", label: "Creator", bps: row.bps.creator, value: row.creator },
    { key: "ryntra", label: "Ryntra", bps: row.bps.ryntra, value: row.ryntra },
    { key: "meteora", label: "Meteora", bps: row.bps.meteora, value: row.meteora },
    { key: "pool", label: "Pool", bps: row.bps.pool, value: `${row.bps.pool / 100}%` },
  ].filter((part) => part.bps > 0);
  return (
    <div className={styles.gauge} role="img" aria-label={parts.map((part) => `${part.label} ${part.value}`).join(", ")}>
      {parts.map((part) => (
        <span key={part.key} className={`${styles.part} ${styles[part.key]}`} style={{ flexGrow: part.bps }}>
          <span className={styles.partHead}>
            <b className={styles.partValue}>{part.value}</b>
            <span className={styles.partLabel}>{part.label}</span>
          </span>
          <span className={styles.track} />
        </span>
      ))}
    </div>
  );
}

/** A title given as sentences sets each on its own line; a plain one as it is. */
function Title({ text }: { text: string | readonly string[] }) {
  if (typeof text === "string") return <>{text}</>;
  return (
    <>
      {text.map((sentence, index) => (
        <span key={sentence} className={styles.sentence}>
          {sentence}
          {index < text.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

/** One party on board: who, what they are paid for, how much — and whether it is on mainnet now or next on the flight plan. */
function Earner({ card }: { card: EarnerCard }) {
  return (
    <li className={styles.earner}>
      <p className={styles.earnerTop}>
        <span className={styles.earnerWho}>{card.who.toUpperCase()}</span>
        <span className={styles.chipLive}>{F.earn.live}</span>
      </p>
      <h3 className={styles.earnerFor}>{card.forWhat}</h3>
      <p className={styles.earnerText}>{card.text}</p>
    </li>
  );
}

/**
 * The home page below Mission Control's scene (MC-0), in the scene's own language: the same sky carried on without a
 * seam, the same gutters, glass and mono labels as its HUD, the flight path the three acts sit on, the split of every
 * fee as telemetry, Meteora's engine as modules and the planet's horizon at the end. Server-rendered words — a reader
 * and the index get them without the 3D; every share is the Classic preset's (`lib/mission-control/home-facts.ts`).
 * The one orange action stays the hero's alone.
 */
export function MissionSections({ launchOpen = false }: { launchOpen?: boolean }) {
  return (
    <div className={styles.space}>
      <SpaceBackdrop className={styles.sky} />

      {launchOpen ? (
        <section className={`${styles.section} ${styles.launch}`} id="launch" tabIndex={-1} aria-labelledby="launch-title">
          <header className={styles.head} data-reveal>
            <p className={styles.eyebrow}>
              <i className={`${styles.dot} ${styles.dotFire}`} aria-hidden="true" />
              {F.launch.eyebrow}
            </p>
            <h2 id="launch-title" className={styles.title}>
              {F.launch.title}
            </h2>
            <p className={styles.lede}>{F.launch.lede}</p>
          </header>
          <LaunchDock />
        </section>
      ) : null}

      <section className={`${styles.section} ${styles.why}`} aria-labelledby="why-title">
        <header className={styles.head} data-reveal>
          <p className={styles.eyebrow}>
            <i className={styles.dot} aria-hidden="true" />
            {F.why.eyebrow}
          </p>
          <h2 id="why-title" className={styles.title}>
            <Title text={F.why.title} />
          </h2>
          <p className={styles.lede}>{F.why.lede}</p>
        </header>
        <div className={`${styles.console} ${styles.compare}`} data-reveal>
          <div className={styles.compareHead} aria-hidden="true">
            <span />
            <span>{F.why.diy}</span>
            <span className={styles.compareUs}>{F.why.ryntra}</span>
          </div>
          <dl className={styles.compareRows}>
            {F.why.rows.map((row) => (
              <div key={row.topic} className={styles.compareRow}>
                <dt className={styles.compareTopic}>{row.topic}</dt>
                <dd className={styles.compareDiy}>{row.diy}</dd>
                <dd className={styles.compareRyntra}>
                  <b className={styles.compareLead}>{row.lead}</b> {row.ryntra}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className={`${styles.section} ${styles.how}`} id="how" tabIndex={-1} aria-labelledby="how-title">
        <header className={styles.head} data-reveal>
          <p className={styles.eyebrow}>
            <i className={styles.dot} aria-hidden="true" />
            {F.how.eyebrow}
          </p>
          <h2 id="how-title" className={styles.title}>
            {F.how.title}
          </h2>
          <p className={styles.lede}>{F.how.lede}</p>
        </header>

        <div className={styles.flight} data-reveal>
          <svg className={styles.path} viewBox="0 0 1240 340" aria-hidden="true">
            <defs>
              <radialGradient id="mc-planet" cx="0.5" cy="0" r="0.9">
                <stop offset="0" className={styles.planetLit} />
                <stop offset="0.35" className={styles.planetMid} />
                <stop offset="1" className={styles.planetDark} />
              </radialGradient>
              <linearGradient id="mc-planet-fade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0.8" stopColor="#fff" />
                <stop offset="1" stopColor="#000" />
              </linearGradient>
              <linearGradient id="mc-planet-side" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#000" />
                <stop offset="0.14" stopColor="#fff" />
              </linearGradient>
              {/* The planet fades out downwards and towards the left edge: no straight cut on either side. */}
              <mask id="mc-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="1240" height="340">
                <rect x="0" y="0" width="1240" height="340" fill="url(#mc-planet-fade)" />
              </mask>
              <mask id="mc-side" maskUnits="userSpaceOnUse" x="0" y="0" width="1240" height="340">
                <rect x="0" y="0" width="1240" height="340" fill="url(#mc-planet-side)" />
              </mask>
              <radialGradient id="mc-pad-glow">
                <stop offset="0" className={styles.fireCore} />
                <stop offset="1" className={styles.fireEdge} />
              </radialGradient>
            </defs>
            <g mask="url(#mc-side)">
              <g mask="url(#mc-fade)">
                <circle className={styles.planet} cx="170" cy="656" r="420" fill="url(#mc-planet)" />
                <ellipse cx="170" cy="236" rx="80" ry="30" fill="url(#mc-pad-glow)" />
                <ellipse className={styles.pad} cx="170" cy="236" rx="20" ry="6" />
              </g>
            </g>
            <path className={styles.ringBack} d={RING} />
            <path className={styles.ascentTrack} d={ASCENT} />
            <path className={styles.ascent} d={ASCENT} pathLength={1}>
              {/* Drawn on the ship's own clock: started in the same call, so the line's tip is always the ship. */}
              <animate attributeName="stroke-dashoffset" from="1" to="0" data-begin-on-reveal="" data-delay="0.4" dur="3.6s" begin="indefinite" fill="freeze" />
            </path>
            {CHECKS.map((check) => (
              <g key={check.day}>
                {check.day === "D90" ? <circle cx={check.x} cy={check.y} r="30" fill="url(#mc-pad-glow)" /> : null}
                <circle className={check.day === "D90" ? styles.checkStar : styles.check} cx={check.x} cy={check.y} r={check.day === "D90" ? 7 : 6} />
                <text className={styles.checkLabel} x={check.lx} y={check.ly} textAnchor={check.anchor}>
                  {check.day}
                </text>
              </g>
            ))}
            <g className={styles.ship}>
              <circle r="12" className={styles.shipHalo} />
              <circle r="5" className={styles.shipCore} />
              <animateMotion data-begin-on-reveal="" data-delay="0.4" dur="3.6s" begin="indefinite" fill="freeze" path={ASCENT} />
              {/* Round the ring the moment the climb ends: both are started on arrival, the ring 0.4 + 3.6 s in (a syncbase on
                  the climb's end never fires after a scripted start). The ring's ~995 units in 4.5 s keep the climb's speed. */}
              <animateMotion data-begin-on-reveal="" data-delay="4" dur="4.5s" begin="indefinite" repeatCount="indefinite" path={RING} />
            </g>
            <circle className={styles.shipStill} cx="990" cy="180" r="5" />
          </svg>
          <ol className={styles.acts}>
            {F.how.acts.map((act) => (
              <li key={act.n} className={styles.act}>
                <p className={styles.actLabel}>
                  {act.n} · {act.name.toUpperCase()}
                </p>
                <p className={styles.actText}>{act.text}</p>
              </li>
            ))}
          </ol>
        </div>
        {/* MC-3: the Day 90 sky the scene above draws, with its crews' names — from the scene's live snapshots. */}
        <div data-reveal>
          <StarSky scene="orbit" variant="section" />
        </div>
      </section>

      <section className={`${styles.section} ${styles.earn}`} aria-labelledby="earn-title">
        <header className={styles.head} data-reveal>
          <p className={styles.eyebrow}>
            <i className={styles.dot} aria-hidden="true" />
            {F.earn.eyebrow}
          </p>
          <h2 id="earn-title" className={styles.title}>
            {F.earn.title}
          </h2>
          <p className={styles.lede}>{F.earn.lede}</p>
        </header>

        <div className={styles.console} data-reveal>
          <p className={styles.consoleHead}>SPLIT OF EACH FEE · CLASSIC AND PROTECTED</p>
          {F.earn.rows.map((row) => (
            <div key={row.moment} className={styles.feeRow}>
              <div className={styles.feeLabel}>
                <h3 className={styles.moment}>{row.moment}</h3>
                <p className={styles.detail}>{row.detail}</p>
              </div>
              <Gauge row={row} />
            </div>
          ))}
          <details className={styles.more}>
            <summary className={styles.moreSummary}>{F.details}</summary>
            <div className={styles.notes}>
              <p>{F.earn.pool}</p>
              <p>{F.earn.traders}</p>
              <p>{F.earn.referral}</p>
            </div>
          </details>
        </div>

        <p className={styles.subhead} data-reveal>
          <i className={styles.dot} aria-hidden="true" />
          {F.earn.onBoard}
        </p>
        <ul className={styles.earners} data-reveal>
          {F.earn.earners
            .filter((card) => card.live)
            .map((card) => (
              <Earner key={card.who} card={card} />
            ))}
        </ul>
        <div className={styles.nextPanel} data-reveal>
          <p className={styles.nextHead}>
            <span>{F.earn.nextHead}</span>
            <span className={styles.chipNext}>{F.earn.next}</span>
          </p>
          <ul className={styles.nextRows}>
            {F.earn.earners
              .filter((card) => !card.live)
              .map((card) => (
                <li key={card.who} className={styles.nextRow}>
                  <p className={styles.earnerWho}>{card.who.toUpperCase()}</p>
                  <h3 className={styles.nextFor}>{card.forWhat}</h3>
                  <p className={styles.nextText}>{card.text}</p>
                </li>
              ))}
          </ul>
        </div>
        <p className={styles.buyers} data-reveal>
          {F.earn.buyers}
        </p>
      </section>

      <section className={`${styles.section} ${styles.engine}`} aria-labelledby="meteora-title">
        <header className={styles.head} data-reveal>
          <p className={styles.eyebrow}>
            <i className={styles.dot} aria-hidden="true" />
            {F.meteora.eyebrow}
          </p>
          <h2 id="meteora-title" className={styles.title}>
            <Title text={F.meteora.title} />
          </h2>
        </header>
        <ul className={styles.modules} data-reveal>
          {F.meteora.parts.map((part, index) => (
            <li key={part.name} className={styles.module}>
              <svg className={styles.moduleIcon} viewBox="0 0 64 40" aria-hidden="true">
                {index === 0 ? <path d="M4 36 C 22 36 30 30 38 18 S 52 4 60 4" /> : null}
                {index === 1 ? (
                  <>
                    <ellipse cx="32" cy="22" rx="26" ry="10" />
                    <path d="M8 22 C 18 12 26 30 32 22 S 46 12 56 22" />
                  </>
                ) : null}
                {index === 2 ? (
                  <>
                    <rect x="18" y="18" width="28" height="18" rx="4" />
                    <path d="M24 18 V 12 a 8 8 0 0 1 16 0 V 18" />
                  </>
                ) : null}
              </svg>
              <p className={styles.moduleChip}>{["DBC", "DAMM V2", "LP LOCK"][index]}</p>
              <h3 className={styles.moduleName}>{part.name}</h3>
              <p className={styles.moduleText}>{part.text}</p>
            </li>
          ))}
        </ul>
        <p className={styles.docsRow} data-reveal>
          <a href={F.meteora.docs} target="_blank" rel="noopener noreferrer" className={styles.docs}>
            METEORA DOCS ↗
          </a>
        </p>
      </section>

      <section className={`${styles.section} ${styles.end}`} aria-labelledby="end-title">
        <div className={styles.horizon} aria-hidden="true" />
        <div className={styles.endBody} data-reveal>
          <h2 id="end-title" className={styles.endTitle}>
            {F.end.title}
          </h2>
          <div className={styles.cta}>
            {launchOpen ? (
              <a className={styles.btn} href="#launch">
                {W.launch}
              </a>
            ) : null}
            <Link className={styles.btn} href="/live">
              {W.watch}
            </Link>
            <Link className={styles.btn} href="/app/home">
              {W.openApp}
            </Link>
          </div>
        </div>
        <nav className={styles.foot} aria-label="Ryntra">
          <span>{W.meteora}</span>
          <Link href="/docs">Docs</Link>
          <Link href="/legal/terms">Terms</Link>
        </nav>
      </section>
    </div>
  );
}
