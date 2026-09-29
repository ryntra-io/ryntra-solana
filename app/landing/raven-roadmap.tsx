"use client";

import { useEffect, useRef, useState } from "react";

import type { RavenRoadmapCopy } from "./raven-copy";

/**
 * Roadmap.
 *
 * A list of sentences could not show sequence — every entry read as equally
 * real, with no way to tell what ships today from what is still ahead. This
 * draws the line: milestones on a rail, the shipped stretch lit and solid, the
 * rest dashed.
 *
 * The milestones are the product's own phases in public language, never
 * internal task ids. Their STATUS is not authored here: each one names a
 * capability, and that capability's registry maturity decides whether it
 * lights. A milestone cannot claim to ship before the registry says so, and
 * when the registry flips this diagram follows without a code change.
 *
 * Selecting a milestone opens what it is and — the part a roadmap usually
 * hides — what it is waiting for. The answer is always a dependency, never a
 * date: the plan is ordered by gates, and a milestone naming a month would make
 * a promise the product does not make. The filters are counts of the same
 * registry states, so filtering can narrow the view but never invent a status.
 */

/** Milestone → the capability whose maturity governs its light. */
const GOVERNED_BY: Record<string, string> = {
  trade: "arcus-spot-rfq",
  risk: "risk-read",
  scanner: "risk-readiness-scanner",
  workspace: "personal-workspace",
};

/** Registry maturities that count as shipped. */
const SHIPPED = new Set(["live", "beta"]);

type Status = "shipped" | "build" | "ahead";

export function RavenRoadmap({
  copy,
  maturityById,
  degraded,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenRoadmapCopy;
  /** capabilityId → registry maturity, resolved by the caller. */
  maturityById: Readonly<Record<string, string | undefined>>;
  /** True when any capability is awaiting re-verification. */
  degraded: boolean;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [filter, setFilter] = useState<Status | "all">("all");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setDrawn(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setDrawn(true);
        observer.disconnect();
      },
      { threshold: 0, rootMargin: "0px 0px -60px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const statusOf = (key: string): Status => {
    const capability = GOVERNED_BY[key];
    if (!capability) return "ahead";
    const maturity = maturityById[capability];
    if (!maturity || maturity === "unverified") return "ahead";
    return SHIPPED.has(maturity) ? "shipped" : "build";
  };

  const phases = copy.phases.map((phase) => ({ ...phase, status: statusOf(phase.key) }));
  const shipped = phases.filter((p) => p.status === "shipped").length;
  /** How far the lit stretch of rail reaches, as a share of its length. */
  const progress =
    phases.length > 1 ? Math.max(0, ((shipped - 0.5) / (phases.length - 1)) * 100) : 0;

  const stateLabel: Record<Status, string> = {
    shipped: copy.stateLive,
    build: copy.legendBuild,
    ahead: copy.stateAhead,
  };

  /** Counts come from the same resolved statuses the rail draws. */
  const filters: { key: Status | "all"; label: string; count: number }[] = [
    { key: "all", label: copy.filters.all, count: phases.length },
    { key: "shipped", label: copy.legendLive, count: shipped },
    { key: "build", label: copy.legendBuild, count: phases.filter((p) => p.status === "build").length },
    { key: "ahead", label: copy.legendAhead, count: phases.filter((p) => p.status === "ahead").length },
  ];

  const selected = phases.find((phase) => phase.key === open) ?? null;

  return (
    <section
      className="rv-section rv-roadmap"
      id="roadmap"
      ref={sectionRef}
      data-drawn={drawn ? "true" : undefined}
    >
      <div className="rv-section-inner">
        <header className="rv-section-head rv-reveal">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>
          <h2 className="rv-h2">{copy.title}</h2>
          <p className="rv-section-lead">{degraded ? copy.leadDegraded : copy.lead}</p>
        </header>

        {/* Filters. They narrow which milestones are shown; they cannot change
            what a milestone's status is, because both read the same resolution. */}
        <div className="rv-map-filters" role="group" aria-label={copy.eyebrow}>
          {filters.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="rv-map-filter mono"
              data-status={entry.key === "all" ? undefined : entry.key}
              data-active={filter === entry.key ? "true" : undefined}
              aria-pressed={filter === entry.key}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
              <span translate="no">{entry.count}</span>
            </button>
          ))}
        </div>

        <div className="rv-map">
          {/* The rail, drawn once. The lit stretch stops at the last shipped
              milestone, so the line itself reports progress. */}
          <div className="rv-map-line" aria-hidden>
            <span className="rv-map-line-done" style={{ ["--p" as string]: `${progress}%` }} />
          </div>

          <ol className="rv-map-rail">
            {phases.map((phase, i) => {
              const dimmed = filter !== "all" && phase.status !== filter;
              return (
                <li
                  key={phase.key}
                  className="rv-map-stage"
                  data-status={phase.status}
                  data-dimmed={dimmed ? "true" : undefined}
                  data-open={open === phase.key ? "true" : undefined}
                  style={{ ["--i" as string]: i }}
                >
                  <button
                    type="button"
                    className="rv-map-hit"
                    aria-expanded={open === phase.key}
                    onClick={() => setOpen((current) => (current === phase.key ? null : phase.key))}
                  >
                    <span className="rv-map-node" aria-hidden>
                      <span className="rv-map-dot" />
                    </span>
                    <span className="rv-map-body">
                      <span className="rv-map-state mono">{stateLabel[phase.status]}</span>
                      <b>{phase.label}</b>
                      <span className="rv-map-detail">{phase.detail}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* The detail panel. What it is, and what it is waiting for. */}
          {selected ? (
            <div className="rv-map-panel" data-status={selected.status}>
              <div className="rv-map-panel-head">
                <b>{selected.label}</b>
                <span className="rv-maturity mono" data-maturity={selected.status === "shipped" ? "live" : undefined}>
                  {stateLabel[selected.status]}
                </span>
              </div>
              <dl>
                <div>
                  <dt className="mono">{copy.detailLabels.what}</dt>
                  <dd>{selected.detail}</dd>
                </div>
                <div>
                  <dt className="mono">{copy.detailLabels.gate}</dt>
                  <dd>{selected.gate}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <p className="rv-map-legend mono">
            <span className="rv-map-key" data-status="shipped" aria-hidden />
            {copy.legendLive}
            <span className="rv-map-key" data-status="build" aria-hidden />
            {copy.legendBuild}
            <span className="rv-map-key" data-status="ahead" aria-hidden />
            {copy.legendAhead}
            <span className="rv-map-count">
              {shipped}/{phases.length}
            </span>
          </p>

          <p className="rv-map-nodates">{copy.noDates}</p>
        </div>
      </div>
    </section>
  );
}
