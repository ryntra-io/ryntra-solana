import type { ReactNode } from "react";

/**
 * The tile — the surface grammar this product was missing.
 *
 * Five packets shipped correct facts typed as sentences on a bare canvas, and
 * the founder's review named exactly why that fails: there is no card, so
 * nothing for an eye to land on; no edge and no ground, so a card is a
 * paragraph with a border; no number, so the subject of a tile is prose; and no
 * emphasis, so nothing is the answer.
 *
 * A tile has six parts and they always come in this order:
 *
 *   micro-label → number → state → chart → footer → the explanation, hidden
 *
 * The last one is working rule 6 as a component rather than as a good
 * intention: `note` renders behind a disclosure, so an explanation cannot be
 * printed on the page by forgetting to move it. There is no prop that puts it
 * inline.
 */

export type Tone = "neutral" | "good" | "warn" | "bad" | "evidence";

/* ------------------------------------------------------------------- chip */

export function Chip({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tl-chip tl-tone-${tone}`}>{children}</span>;
}

/* -------------------------------------------------------------------- note */

/**
 * The explanation, behind an icon.
 *
 * `<details>` rather than a popover, deliberately: it works with JavaScript
 * off, it is reachable by keyboard without any code, and a screen reader reads
 * it as what it is. The summary is the icon; the sentence never reaches the
 * page until someone asks for it.
 */
export function Note({ children, label = "What this means" }: { children: ReactNode; label?: string }) {
  return (
    <details className="tl-note">
      <summary aria-label={label} title={label}>
        <span aria-hidden>?</span>
      </summary>
      <div className="tl-note-body">{children}</div>
    </details>
  );
}

/* -------------------------------------------------------------------- tile */

export type TileProps = Readonly<{
  /** The dimension being reported. Uppercase micro-label. */
  label: string;
  /** The subject of the tile. A figure, not a sentence. */
  value: ReactNode;
  /** The figure's unit or denominator, beside it rather than inside it. */
  unit?: ReactNode;
  tone?: Tone;
  state?: ReactNode;
  chart?: ReactNode;
  /** At most two. A third is a paragraph pretending to be a fact. */
  facts?: readonly ReactNode[];
  /** Rendered behind the icon. There is no way to print it on the page. */
  note?: ReactNode;
  /** Draws the eye. Exactly one tile on a surface should carry it. */
  lead?: boolean;
}>;

export function Tile({ label, value, unit, tone = "neutral", state, chart, facts, note, lead }: TileProps) {
  const shown = facts?.slice(0, 2) ?? [];
  return (
    <article className={lead ? "tl tl-lead" : "tl"} data-tone={tone}>
      <header className="tl-head">
        <span className="tl-label">{label}</span>
        {note ? <Note>{note}</Note> : null}
      </header>

      <p className="tl-value">
        <span className="tl-num">{value}</span>
        {unit ? <span className="tl-unit">{unit}</span> : null}
      </p>

      {state ? <div className="tl-state">{state}</div> : null}
      {chart ? <div className="tl-chart">{chart}</div> : null}

      {shown.length ? (
        <ul className="tl-facts">
          {shown.map((fact, i) => (
            <li key={i}>{fact}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------------- panel */

/**
 * The container a set of tiles or a table sits in.
 *
 * It exists because the previous surfaces put content straight onto the canvas.
 * A panel is a ground with an edge — the two things whose absence made every
 * screen read as one undifferentiated column.
 */
export function Panel({
  title,
  note,
  actions,
  children,
}: {
  title?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="tl-panel">
      {title ? (
        <header className="tl-panel-head">
          <h2 className="tl-panel-title">{title}</h2>
          {note ? <Note>{note}</Note> : null}
          {actions ? <div className="tl-panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="tl-grid">{children}</div>;
}
