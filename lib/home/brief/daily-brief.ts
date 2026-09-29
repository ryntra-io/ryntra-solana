import { createHash } from "node:crypto";

import { canonicalJson } from "../../guard/canonical-json.ts";
import { parseExplicitInstant } from "../portfolio/freshness.ts";
import { type BriefWindow } from "./window.ts";
import type { AttentionSeverity } from "../portfolio/attention.ts";

/**
 * The Daily Brief — what happened while nobody was looking.
 *
 * It is a **projection**. Every line is a fact another surface already owns,
 * carried here with a link back to it; nothing is re-derived and nothing new is
 * computed. The brief's only contribution is *order*, and that order is a
 * declared table rather than a score.
 *
 * The score is the thing this module deliberately does not have. A single
 * importance number is the most natural design here and the wrong one: it
 * collapses "a person has to decide something" and "a data source is late" onto
 * one axis, and the moment the weights are tuned the surface starts telling
 * readers the wrong thing is urgent. So a decision outranks a change outranks a
 * portfolio move outranks an operational state, always, and severity only
 * decides order *within* a section. A critical source failure never displaces a
 * low-severity decision, because those are not comparable quantities.
 *
 * The window is the other honest half. *Since you last looked* is a fact about
 * one browser on one device — the server cannot read it — so it is typed as
 * three separate states and never silently degraded into a default window that
 * looks like an observation.
 *
 * Pure: no clock, no fetch, no randomness. `asOf` arrives from the caller.
 */

export const BRIEF_SECTIONS = ["DECISIONS", "CHANGES", "PORTFOLIO", "MONITORING", "QUIET"] as const;

export type BriefSection = (typeof BRIEF_SECTIONS)[number];

/**
 * The priority table. It is the section order and it is the whole ranking rule.
 *
 * Written as a separate constant rather than "the order of BRIEF_SECTIONS"
 * because they are two different claims that happen to agree, and a test that
 * compares them catches the day somebody reorders one for presentation.
 */
export const BRIEF_SECTION_PRIORITY: readonly BriefSection[] = [
  "DECISIONS",
  "CHANGES",
  "PORTFOLIO",
  "MONITORING",
  "QUIET",
];

const SEVERITY_RANK: Readonly<Record<AttentionSeverity, number>> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export type BriefEntry = Readonly<{
  id: string;
  title: string;
  detail: string;
  severity: AttentionSeverity;
  observedAt: string | null;
  href: string;
  surface: string;
}>;

export type BriefOwner = Readonly<{ surface: string; href: string }>;

export type BriefLine = Readonly<{
  lineId: string;
  section: BriefSection;
  title: string;
  detail: string;
  severity: AttentionSeverity | "NONE";
  observedAt: string | null;
  owner: BriefOwner;
}>;

/**
 * A check that ran and found nothing, with the surface that ran it.
 *
 * It was a bare string, and the display layer had to invent an owner for it —
 * which it did, hard-coding Coverage under a line about portfolio valuation.
 * Every other line on this page names the surface that owns its fact; a quiet
 * line has exactly the same obligation.
 */
export type BriefQuietCheck = Readonly<{ title: string; surface: string; href: string }>;

export type BriefSectionProjection = Readonly<{
  section: BriefSection;
  title: string;
  lines: readonly BriefLine[];
  emptyReason: string | null;
}>;

export type { BriefWindow } from "./window.ts";
export { DEFAULT_BRIEF_WINDOW_SECONDS, briefWindow } from "./window.ts";

export type DailyBrief = Readonly<{
  briefId: string;
  asOf: string;
  window: BriefWindow;
  state: "EMPTY" | "CALM" | "ATTENTION" | "DEGRADED";
  sections: readonly BriefSectionProjection[];
  lines: readonly BriefLine[];
  counts: Readonly<{
    decisions: number;
    changes: number;
    portfolio: number;
    monitoring: number;
    quiet: number;
  }>;
}>;

const SECTION_TITLE: Readonly<Record<BriefSection, string>> = {
  DECISIONS: "Waiting on you",
  CHANGES: "Material changes",
  PORTFOLIO: "Portfolio",
  MONITORING: "Monitoring and sources",
  QUIET: "Checked and unchanged",
};

const EMPTY_REASON: Readonly<Record<BriefSection, string>> = {
  DECISIONS: "Nothing is waiting on a person in this window.",
  CHANGES: "No monitor rule reported a material change in this window.",
  PORTFOLIO: "No position, valuation or risk category moved past its declared threshold.",
  MONITORING: "Every declared source answered and every enrolled rule is scheduled.",
  QUIET: "Nothing was checked, so nothing can be reported as unchanged.",
};

function line(section: BriefSection, entry: BriefEntry): BriefLine {
  if (!entry.surface || !entry.href) {
    throw new TypeError(
      "Brief line " + entry.id + " has no owner: every line names the surface that owns its fact and links to it.",
    );
  }
  return {
    lineId: entry.id,
    section,
    title: entry.title,
    detail: entry.detail,
    severity: entry.severity,
    observedAt: entry.observedAt,
    owner: { surface: entry.surface, href: entry.href },
  };
}

/** Severity, then most recently observed, then id. Total and deterministic. */
function ordered(entries: readonly BriefEntry[]): readonly BriefEntry[] {
  return [...entries].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const at = a.observedAt === null ? -1 : (parseExplicitInstant(a.observedAt) ?? -1);
    const bt = b.observedAt === null ? -1 : (parseExplicitInstant(b.observedAt) ?? -1);
    if (at !== bt) return bt - at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type DailyBriefInput = Readonly<{
  asOf: string;
  window: BriefWindow;
  decisions: readonly BriefEntry[];
  changes: readonly BriefEntry[];
  portfolio: readonly BriefEntry[];
  monitoring: readonly BriefEntry[];
  /** What was checked and found unchanged, each with the surface that checked. */
  quiet?: readonly BriefQuietCheck[];
}>;

export function buildDailyBrief(input: DailyBriefInput): DailyBrief {
  const quiet = input.quiet ?? [];

  const bySection: Readonly<Record<Exclude<BriefSection, "QUIET">, readonly BriefEntry[]>> = {
    DECISIONS: input.decisions,
    CHANGES: input.changes,
    PORTFOLIO: input.portfolio,
    MONITORING: input.monitoring,
  };

  const sections: BriefSectionProjection[] = BRIEF_SECTION_PRIORITY.map((section) => {
    if (section === "QUIET") {
      const lines = quiet.map<BriefLine>((check, index) => {
        if (!check.surface || !check.href) {
          throw new TypeError("Quiet check " + check.title + " has no owner: a line that found nothing still names who looked.");
        }
        return {
          lineId: "quiet-" + String(index),
          section,
          title: check.title,
          detail: "Checked in this window and unchanged.",
          severity: "NONE",
          observedAt: null,
          owner: { surface: check.surface, href: check.href },
        };
      });
      return {
        section,
        title: SECTION_TITLE[section],
        lines,
        emptyReason: lines.length === 0 ? EMPTY_REASON[section] : null,
      };
    }
    const lines = ordered(bySection[section]).map((entry) => line(section, entry));
    return {
      section,
      title: SECTION_TITLE[section],
      lines,
      emptyReason: lines.length === 0 ? EMPTY_REASON[section] : null,
    };
  });

  const lines = sections.flatMap((section) => (section.section === "QUIET" ? [] : section.lines));

  const counts = {
    decisions: input.decisions.length,
    changes: input.changes.length,
    portfolio: input.portfolio.length,
    monitoring: input.monitoring.length,
    quiet: quiet.length,
  } as const;

  /* State is decided by *what kind* of line exists, in the same priority the
     table declares. An operational line alone is DEGRADED rather than CALM:
     nothing was found because something was not looked at. */
  const state: DailyBrief["state"] =
    counts.decisions > 0 || counts.changes > 0 || counts.portfolio > 0
      ? "ATTENTION"
      : counts.monitoring > 0
        ? "DEGRADED"
        : counts.quiet > 0
          ? "CALM"
          : "EMPTY";

  const briefId = createHash("sha256")
    .update(canonicalJson({ asOf: input.asOf, window: input.window, sections, counts, state }))
    .digest("hex")
    .slice(0, 32);

  return { briefId, asOf: input.asOf, window: input.window, state, sections, lines, counts };
}
