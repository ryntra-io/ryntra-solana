"use client";

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { Check, ShieldCheck, Warning, WarningOctagon, X } from "@phosphor-icons/react";

import { readsAsProse } from "./reads-as-prose";
import { useShell } from "./shell-state";
import { StatusChip } from "./status-chip";
import { WorkspaceWidget } from "./widget";

import "./panel.css";

/**
 * The RWS panel — the single atomic component of the workspace canvas.
 *
 * A 42px header carrying a sentence-case title and an optional status badge; a
 * body composed of the standard primitives; an optional footer. Height comes
 * from the grid (`h2/h4/h6/h8` spans on `<PanelGrid>`), never from content —
 * data panels scroll inside, and an action panel takes a taller span rather
 * than hiding a critical control.
 *
 * **No per-panel settings menu.** The first pass put a `⋮` menu on every panel
 * — density override, section toggles, collapse, move, hide. Seen on
 * the rendered screen it was incomprehensible, and it is off until the surface itself is
 * good. So the panel renders no controls of its own. The mechanism underneath
 * is untouched — every panel still registers as a `WorkspaceWidget`, so the
 * shell's own Layout menu keeps working — and the per-panel preferences in
 * layout-store v2 are still read here (`density`), just never written by a
 * control this component draws. Turning the menu back on is re-rendering it,
 * not rebuilding it.
 *
 * Order is applied on the panel element itself: the widget wrapper is
 * `display: contents`, which generates no box, so a CSS `order` set there would
 * silently do nothing.
 */

export type PanelTone = "verified" | "evidence" | "caution" | "danger" | "muted";

/**
 * A panel's badge, in the product's one chip language.
 *
 * It was `.rw-badge` — its own class, its own five tints and its own 12px,
 * below the 14px floor the Brandbook sets. One of 63 chip families the audit
 * counted, and on Agent Control's Mission Control alone it painted nine
 * different kinds of statement in four tints: `SOURCE BOUNDED`, `BOUNDARIES`,
 * `AVAILABLE NOW`, `NOT AVAILABLE`, `REQUEST DRIVEN`, `READ ONLY`, `DEMO ONLY`,
 * `NOT OBSERVED`, `H0`.
 *
 * The mapping is where the honesty is. `verified`, `caution` and `danger` are
 * verdicts and become risk chips with the semantics locked; `evidence` and
 * `muted` are **facts about the data**, not judgements of it, so both become
 * descriptors. That is deliberately a demotion: `evidence` used to render in
 * the accent colour, which now means *action*, so a panel stating that its
 * numbers are read-only was drawing the eye like a button.
 *
 * Call sites are unchanged — 122 of them keep passing `tone` — and the ones
 * that should say maturity or environment rather than descriptor are a named
 * follow-up, per surface, not a rename hidden inside this mapping.
 */
function PanelBadge({ tone, children }: { tone: PanelTone; children: ReactNode }) {
  if (tone === "verified") return <StatusChip family="risk" tone="verified">{children}</StatusChip>;
  if (tone === "caution") return <StatusChip family="risk" tone="caution">{children}</StatusChip>;
  if (tone === "danger") return <StatusChip family="risk" tone="high">{children}</StatusChip>;
  return <StatusChip family="descriptor">{children}</StatusChip>;
}

export type PanelSectionDef = Readonly<{
  id: string;
  label: string;
  /** Sections default to visible unless declared otherwise. */
  defaultOn?: boolean;
}>;

type SectionsApi = { isOn: (id: string) => boolean };

const PanelSectionsContext = createContext<SectionsApi>({ isOn: () => true });

/** Renders its children only while the named section is switched on. */
export function PanelSection({ id, children }: { id: string; children: ReactNode }) {
  const { isOn } = useContext(PanelSectionsContext);
  return isOn(id) ? <>{children}</> : null;
}

/**
 * The grid, which also owns panel order.
 *
 * Reordering used to be a CSS `order` on each panel. That moves the box and
 * leaves the DOM alone, so the tab order and the screen-reader reading order
 * kept the original sequence while the eye saw a different one — WCAG 2.4.3,
 * and the kind of mismatch that is invisible to everyone who does not need it.
 * Sorting the children here moves the real thing, so focus, reading order and
 * layout cannot disagree.
 */
export function PanelGrid({
  children,
  label,
  fill = false,
}: {
  children: ReactNode;
  label?: string;
  /** Stretch the panels to the canvas. For a page that is one panel. */
  fill?: boolean;
}) {
  const { prefs } = useShell();

  const ordered = useMemo(() => {
    const items = Children.toArray(children);
    if (!prefs.order.length) return items;
    const rank = new Map(prefs.order.map((id, index) => [id, index]));
    const positionOf = (node: unknown): number | undefined => {
      if (!isValidElement(node)) return undefined;
      const id = (node.props as { id?: unknown }).id;
      return typeof id === "string" ? rank.get(id) : undefined;
    };
    /* Panels the saved order has never seen keep their declared position at the
       end rather than jumping to the front, so adding one cannot silently
       rearrange a workspace someone had already customised. */
    return items
      .map((node, index) => ({ node, index, rank: positionOf(node) }))
      .sort((a, b) => {
        if (a.rank === undefined && b.rank === undefined) return a.index - b.index;
        if (a.rank === undefined) return 1;
        if (b.rank === undefined) return -1;
        return a.rank - b.rank;
      })
      .map((entry) => entry.node);
  }, [children, prefs.order]);

  return (
    <div
      className={fill ? "rw-grid rw-grid--fill" : "rw-grid"}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {ordered}
    </div>
  );
}

export function Panel({
  id,
  title,
  w = 12,
  h,
  badge,
  tone = "muted",
  essential,
  advanced,
  sections,
  scroll = false,
  active = false,
  metric = false,
  stretch = false,
  headerExtra,
  actions,
  footer,
  bare = false,
  children,
}: {
  id: string;
  title: string;
  /** Render the children with no frame, header or grid cell — for an engine hosted inside another panel. */
  bare?: boolean;
  /** Grid width token: 3 · 4 · 6 · 8 · 9 · 12. */
  w?: 3 | 4 | 6 | 8 | 9 | 12;
  /** Grid height token: 2 · 4 · 6 · 8. Omit for auto flow rows. */
  /**
   * Row span. Every step from 2 to 8, then in pairs to 16.
   *
   * `2 | 4 | 6 | 8` was the ramp until the rendered pages were measured, and it
   * was cutting content off at the top of the range and leaving panels a fifth
   * full at the bottom of it. `panel.css` carries the finding.
   */
  h?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 14 | 16;
  badge?: ReactNode;
  tone?: PanelTone;
  essential?: boolean;
  advanced?: boolean;
  sections?: readonly PanelSectionDef[];
  /** Data panels (tables, journals, lists) may scroll inside. Action panels must not. */
  scroll?: boolean;
  active?: boolean;
  /** Marks a small KPI tile so mobile gives it a short min-height. */
  metric?: boolean;
  /**
   * This panel is the whole page right now, so the grid hands it the canvas.
   *
   * `PanelGrid`'s own `fill` is set by the page, which cannot know: a surface
   * whose content depends on a connected wallet is one composed gate in a
   * browser without one and three panels in a browser with one. Measured
   * disconnected, Portfolio drew a 752px panel and left 404px of dead page
   * under it. The flag travels with the state that decides it.
   */
  stretch?: boolean;
  headerExtra?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { prefs, panelPrefs } = useShell();
  const pp = panelPrefs(id);
  const density = pp.density ?? prefs.density;

  const sectionsApi = useMemo<SectionsApi>(
    () => ({
      isOn: (sectionId: string) => {
        const stored = pp.sections[sectionId];
        if (typeof stored === "boolean") return stored;
        const declared = sections?.find((section) => section.id === sectionId);
        return declared?.defaultOn ?? true;
      },
    }),
    [pp.sections, sections],
  );

  const classes = ["rw", `rw-w${w}`, h ? `rw-h${h}` : ""].filter(Boolean).join(" ");

  /* Embedded under another panel, a card keeps its content and drops its frame:
     the unified Swap surface hosts the Swap and Bridge engines this way. */
  if (bare) return <>{children}</>;

  return (
    <WorkspaceWidget id={id} title={title} essential={essential} advanced={advanced}>
      <section
        className={classes}
        data-density={density}
        data-active={active ? "true" : "false"}
        data-metric={metric ? "true" : "false"}
        data-stretch={stretch ? "true" : undefined}
        data-panel={id}
        role="group"
        aria-label={title}
      >
        <header className="rw-h">
          <h2>{title}</h2>
          {badge ? <PanelBadge tone={tone}>{badge}</PanelBadge> : null}
          {headerExtra}
          <span className="rw-hsp" />
          {actions}
        </header>

        {/* A scrollport that only a mouse wheel can reach is content a keyboard
            user cannot read. WCAG 2.1.1: give it a tab stop and a name, and
            only when it actually scrolls — a tabindex on every panel body would
            be noise in the tab order. */}
        <div
          className="rw-b"
          data-scroll={scroll ? "true" : "false"}
          tabIndex={scroll ? 0 : undefined}
          role={scroll ? "region" : undefined}
          aria-label={scroll ? title : undefined}
        >
          <PanelSectionsContext.Provider value={sectionsApi}>{children}</PanelSectionsContext.Provider>
        </div>

        {footer ? <footer className="rw-f">{footer}</footer> : null}
      </section>
    </WorkspaceWidget>
  );
}

/* ------------------------------------------------------------ primitives -- */

export function Metric({
  label,
  value,
  sub,
  size,
  dot,
  live,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  size?: "lg";
  dot?: "up" | "down" | "warn" | "idle";
  live?: boolean;
}) {
  return (
    <div className="rw-metric">
      <span className="rw-metric-l">{label}</span>
      <span className="rw-metric-v" data-size={size} data-prose={readsAsProse(value) ? "true" : undefined}>
        {dot ? (
          <span
            className="rw-dot"
            data-tone={dot === "up" ? undefined : dot}
            data-live={live ? "true" : "false"}
            aria-hidden
          />
        ) : null}
        {value}
      </span>
      {sub ? <span className="rw-metric-s">{sub}</span> : null}
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="rw-metricrow">{children}</div>;
}

/**
 * A labelled fact, and — new — somewhere to explain it.
 *
 * `hint` exists because the audit found the same shape on every surface: the
 * two values a person most needs explained were the two with nothing beside
 * them. `Integrity hash` next to `Receipt hash` on the verifier, `Deviations`
 * next to `Recovery` on the journal, `Persistence` and `Adapter` in settings —
 * each a label, a value, and no way to ask what it means. The answer was
 * usually printed somewhere else on the page as a paragraph, which is what
 * makes a workspace read as documentation with controls attached.
 *
 * One optional slot here gives every one of those a home, and it renders
 * nothing at all when nobody passes it, so no existing row moves.
 */
export function KeyValue({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  /** Usually an `InfoControl`. Rendered beside the label, never in the value. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rw-kv">
      <span>
        {label}
        {hint ? <span className="rw-kv-hint">{hint}</span> : null}
      </span>
      <b data-prose={readsAsProse(children) ? "true" : undefined}>{children}</b>
    </div>
  );
}

export function EmptyState({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rw-empty">
      <b>{title}</b>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function AuthNote({ children }: { children: ReactNode }) {
  return (
    <div className="rw-auth">
      <ShieldCheck size={16} weight="bold" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function AlertStrip({
  tone,
  children,
}: {
  tone: "warn" | "danger";
  children: ReactNode;
}) {
  return (
    <div className="rw-alert" data-tone={tone} role="status">
      {tone === "danger" ? (
        <WarningOctagon size={16} weight="bold" aria-hidden />
      ) : (
        <Warning size={16} weight="bold" aria-hidden />
      )}
      <div>{children}</div>
    </div>
  );
}

export type StepState = "done" | "active" | "blocked" | "idle";

export function Stepper({
  steps,
}: {
  steps: ReadonlyArray<{ id: string; label: string; state: StepState; detail?: ReactNode }>;
}) {
  return (
    <ol className="rw-steps">
      {steps.map((step) => (
        <li className="rw-step" key={step.id} data-state={step.state}>
          <span className="rw-step-m" aria-hidden>
            {step.state === "done" ? <Check size={11} weight="bold" /> : null}
            {step.state === "blocked" ? <X size={10} weight="bold" /> : null}
          </span>
          <span>
            <b>{step.label}</b>
            {step.detail ? <small>{step.detail}</small> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
