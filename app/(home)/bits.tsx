import type { Cap, Group, Meter, Status, Tone } from "./data";
import { LEGEND } from "./data";
import styles from "./landing.module.css";

/*
 * The parts every scene of the handoff repeats: a tone, a status word, a bar
 * strip, a meter, a capability group.
 *
 * TONE IS NEVER A COLOUR HERE. The prototype writes `var(--acc1)` straight into
 * its data; this maps a meaning to a class and the stylesheet decides the hue,
 * which is what lets the whole page be repainted from one palette block — and
 * what keeps `design-check` able to guard this directory at all.
 *
 * AND A STATUS IS ALWAYS A WORD. `LIVE`, `BUILDING`, `PLANNED`, `GATED` are
 * printed, not implied by colour: no state on this page may be readable only to
 * someone who can tell aurora from caution.
 */

export function toneClass(tone: Tone | undefined): string {
  switch (tone) {
    case "ok": return styles.toneOk;
    case "warn": return styles.toneWarn;
    case "bad": return styles.toneBad;
    case "unknown": return styles.toneUnknown;
    default: return styles.toneNeutral;
  }
}

export function statusClass(status: Status): string {
  switch (status) {
    case "LIVE": return styles.statusLive;
    case "BUILDING": return styles.statusBuilding;
    case "GATED": return styles.statusGated;
    default: return styles.statusPlanned;
  }
}

/** The handoff's bar strip. Fixed values, no clock, no fetch. */
export function Bars({ values, leadFrom, height }: {
  readonly values: readonly number[];
  readonly leadFrom: number;
  readonly height: "hero" | "tall" | "eco";
}) {
  const scale = height === "hero" ? styles.barsHero : height === "eco" ? styles.barsEco : styles.barsTall;
  return (
    <div className={`${styles.bars} ${scale}`} aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className={`${styles.barCol} ${index >= leadFrom ? styles.barColLead : ""}`}
          style={{ height: `${value}%` }}
        />
      ))}
    </div>
  );
}

/** Label, value, and a track whose fill is the same tone as its value. */
export function Meters({ rows }: { readonly rows: readonly Meter[] }) {
  return (
    <div className={styles.meterList}>
      {rows.map((row) => (
        <div key={row.label}>
          <div className={styles.meterHead}>
            <span className={styles.meterName}>{row.label}</span>
            <span className={`${styles.meterValue} ${toneClass(row.tone)}`}>{row.value}</span>
          </div>
          <div className={styles.meterTrack}>
            <span className={`${styles.meterFill} ${toneClass(row.tone)}`} style={{ width: `${row.width}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The same meters, laid out across the grid its parent defines rather than in
 * one column. The chain breakdown under the portfolio is six of these side by
 * side in the handoff, and wrapping them in the column list stacked all six.
 */
export function MeterGrid({ rows, className }: { readonly rows: readonly Meter[]; readonly className: string }) {
  return (
    <div className={className}>
      {rows.map((row) => (
        <div key={row.label}>
          <div className={styles.meterHead}>
            <span className={styles.meterName}>{row.label}</span>
            <span className={`${styles.meterValue} ${toneClass(row.tone)}`}>{row.value}</span>
          </div>
          <div className={styles.meterTrack}>
            <span className={`${styles.meterFill} ${toneClass(row.tone)}`} style={{ width: `${row.width}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Legend() {
  return (
    <div className={styles.legend}>
      {LEGEND.map((item) => (
        <span key={item.name} className={styles.legendItem}>
          <span className={`${styles.dot} ${statusClass(item.status)}`} aria-hidden="true" />
          {item.name}
        </span>
      ))}
    </div>
  );
}

export function CapabilityGroups({ groups, tight }: { readonly groups: readonly Group[]; readonly tight?: boolean }) {
  return (
    <div className={`${styles.groupGrid} ${tight ? styles.groupGridTight : ""}`}>
      {groups.map((group) => (
        <div key={group.title} className={`${styles.groupCard} ${styles.panelIn}`}>
          <h4 className={styles.groupTitle}>{group.title}</h4>
          <div className={styles.groupItems}>
            {group.items.map((item: Cap) => (
              <div key={item.name} className={styles.groupItem}>
                <span className={`${styles.dotSm} ${statusClass(item.status)}`} aria-hidden="true" />
                <span className={styles.groupItemName}>{item.name}</span>
                <span className={`${styles.groupItemStatus} ${statusClass(item.status)}`}>{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** SIMPLE | PRO. Default is PRO everywhere — the brief §85 is explicit. */
export function DepthSwitch({ pro, onChange, small, label, id }: {
  readonly pro: boolean;
  readonly onChange: (pro: boolean) => void;
  readonly small?: boolean;
  readonly label: string;
  readonly id: string;
}) {
  return (
    <div className={`${styles.segment} ${small ? styles.segmentSm : ""}`} role="group" aria-label={label}>
      <button
        type="button"
        className={`${styles.segmentBtn} ${pro ? "" : styles.segmentBtnOn}`}
        aria-pressed={!pro}
        aria-controls={id}
        onClick={() => onChange(false)}
      >
        SIMPLE
      </button>
      <button
        type="button"
        className={`${styles.segmentBtn} ${pro ? styles.segmentBtnOn : ""}`}
        aria-pressed={pro}
        aria-controls={id}
        onClick={() => onChange(true)}
      >
        PRO
      </button>
    </div>
  );
}

/**
 * The decision loop, with one node lit and the light walking.
 *
 * The prototype drives this from a timer in its runtime. Here the index is
 * owned by the caller so the whole page has one clock rather than three, and
 * `prefers-reduced-motion` stops it at the first node — the loop still reads
 * because every stage is printed, which is the point of drawing it as words.
 */
export function FlowNodes({ names, hot }: { readonly names: readonly string[]; readonly hot: number }) {
  return (
    <div className={styles.flowNodes}>
      {names.map((name, index) => (
        <div key={name} className={`${styles.flowNode} ${index === hot ? styles.flowNodeHot : ""}`}>
          <span className={styles.flowNum}>{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.flowName}>{name}</span>
        </div>
      ))}
    </div>
  );
}
