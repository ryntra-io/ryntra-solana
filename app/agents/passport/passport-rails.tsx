import {
  CheckCircle,
  FileCode,
  MagnifyingGlass,
  Question,
  ShieldWarning,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import type {
  AgentPassport,
  AgentPassportSource,
} from "@/lib/agent-control/agent-passport";

import type { AgentPassportReadPhase } from "../types";

const SOURCE_COPY = {
  REGISTRY: {
    label: "Registry",
    detail: "Exact-address public Almanac resolution.",
    icon: FileCode,
  },
  SEARCH: {
    label: "Search record",
    detail: "Provider-declared profile and discovery metadata.",
    icon: MagnifyingGlass,
  },
  MANIFESTS: {
    label: "Protocol manifests",
    detail: "Bounded manifests named by returned protocol digests.",
    icon: FileCode,
  },
} as const;

function sourceTone(availability: AgentPassportSource["availability"]): "evidence" | "caution" | "danger" | "muted" {
  if (availability === "AVAILABLE") return "evidence";
  if (availability === "PARTIAL" || availability === "NOT_REQUESTED") return "caution";
  if (availability === "NOT_FOUND") return "muted";
  return "danger";
}

function placeholderStatus(phase: AgentPassportReadPhase): string {
  if (phase === "loading") return "READING";
  if (phase === "invalid") return "ADDRESS INVALID";
  if (phase === "error") return "NO PASSPORT";
  return "AWAITING REQUEST";
}

function observedAt(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}

export function AgentSourceLedger({
  passport,
  phase,
}: {
  passport: AgentPassport | null;
  phase: AgentPassportReadPhase;
}) {
  return (
    <aside className="ag-agent-source-ledger" aria-labelledby="agent-source-ledger-title">
      <header>
        <h2 id="agent-source-ledger-title">Three source families</h2>
        <span>Source ledger · point-in-time read</span>
      </header>

      <div className="ag-agent-source-list" aria-busy={phase === "loading"}>
        {(passport?.sources ?? Object.keys(SOURCE_COPY)).map((entry) => {
          const source = typeof entry === "string" ? null : entry;
          const kind = (source?.kind ?? entry) as keyof typeof SOURCE_COPY;
          const copy = SOURCE_COPY[kind];
          const Icon = copy.icon;
          const status = source?.availability ?? placeholderStatus(phase);
          return (
            <article className="ag-agent-source-card" key={kind}>
              <Icon size={18} weight="regular" aria-hidden />
              <div>
                <h3>{copy.label}</h3>
                <p>{copy.detail}</p>
              </div>
              <span
                className="ag-agent-source-status"
                data-tone={source ? sourceTone(source.availability) : phase === "loading" ? "evidence" : "muted"}
              >
                {status}
              </span>
              <small>{source ? `Observed ${observedAt(source.observedAt)}` : "No public read has run."}</small>
            </article>
          );
        })}
      </div>

      <p className="ag-agent-rail-note">
        Public provider records are point-in-time evidence. Availability says what this read returned, not whether an
        agent is trustworthy, reachable or endorsed.
      </p>
    </aside>
  );
}

function BoundaryCard({
  tone,
  title,
  children,
}: {
  tone: "evidence" | "caution" | "danger" | "muted";
  title: string;
  children: ReactNode;
}) {
  const Icon = tone === "danger" ? ShieldWarning : tone === "caution" ? Question : CheckCircle;
  return (
    <article className="ag-agent-boundary-card" data-tone={tone}>
      <Icon size={18} weight="bold" aria-hidden />
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </article>
  );
}

export function AgentEvidenceBoundary({ passport }: { passport: AgentPassport | null }) {
  const conflicts = passport?.conflicts ?? [];
  const unknowns = passport?.unknowns ?? [];

  return (
    <aside className="ag-agent-boundary" aria-labelledby="agent-boundary-title">
      <header>
        <h2 id="agent-boundary-title">No collapsed score</h2>
        <span>Evidence boundary · claims stay separate from observations</span>
      </header>

      <div className="ag-agent-boundary-list">
        <BoundaryCard tone="evidence" title="Provider-declared">
          <p>Profile, registration, metric and endpoint fields declared in public Agentverse records.</p>
        </BoundaryCard>
        <BoundaryCard tone="evidence" title="Ryntra-observed">
          <p>Source availability, exact address binding, public scope and observation time from this read.</p>
        </BoundaryCard>
        <BoundaryCard tone="danger" title={passport ? `Conflicts · ${conflicts.length}` : "Conflicts · awaiting read"}>
          {conflicts.length ? (
            <ul>
              {conflicts.slice(0, 4).map((conflict) => (
                <li key={conflict.id}>{conflict.field.replaceAll("_", " ")}: {conflict.reason}</li>
              ))}
            </ul>
          ) : (
            <p>
              {passport
                ? "No conflict was derived from the sources returned in this read."
                : "No public read has run, so no conflict count exists yet."}
            </p>
          )}
        </BoundaryCard>
        <BoundaryCard tone="caution" title={passport ? `Unknowns · ${unknowns.length}` : "Unknowns · awaiting read"}>
          {unknowns.length ? (
            <ul>
              {unknowns.slice(0, 4).map((unknown) => (
                <li key={unknown.id}>{unknown.field.replaceAll("_", " ")}: {unknown.reasonCode}</li>
              ))}
            </ul>
          ) : (
            <p>
              {passport
                ? "No unknown was derived from the sources returned in this read."
                : "No public read has run, so no unknown count exists yet."}
            </p>
          )}
        </BoundaryCard>
      </div>

      <section className="ag-agent-limitations" aria-labelledby="agent-limitations-title">
        <h3 id="agent-limitations-title">Important limitations</h3>
        <ul>
          <li>No trust, safety, reputation or quality score.</li>
          <li>Declared endpoints are text only and are not fetched.</li>
          <li>Endpoint liveness is <code>NOT_TESTED</code>.</li>
          <li>No account access, registration, chat or external write.</li>
        </ul>
      </section>
    </aside>
  );
}
