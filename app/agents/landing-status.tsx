"use client";

import { useEffect, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";

import { loadAgentDemo } from "./agent-control-client";
import type { AgentDemoData } from "./types";

function shortHash(value: string): string {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}

export function LandingDemoStatus({
  capabilityLabels,
}: {
  /** Registry-resolved maturity labels, passed in so this surface cannot hand-author a status. */
  capabilityLabels: {
    agentverse: string;
    agentLaunch: string;
    bnbApex: string;
    actionPassport: string;
  };
}) {
  const [data, setData] = useState<AgentDemoData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setProblem(null);
    loadAgentDemo(controller.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProblem(error instanceof Error ? error.message : "The sample could not be loaded.");
      });
    return () => controller.abort();
  }, [attempt]);

  if (problem) {
    return (
      <div className="ag-api-state" data-tone="danger" role="status">
        <b>Sample unavailable</b>
        <span>{problem}</span>
        <button className="ag-btn ag-btn--ghost" type="button" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ag-api-state" data-tone="evidence" role="status">
        <b>Loading the bounded sample</b>
        <span>No wallet or provider connection is requested.</span>
      </div>
    );
  }

  return (
    <div className="ag-api-proof">
      <article className="ag-mini-passport">
        <header>
          <div>
            <span>Action Passport Preview</span>
            <strong>{data.passport.id}</strong>
          </div>
          <span className="ag-status" data-tone="evidence">SAMPLE</span>
        </header>
        <dl>
          <div>
            <dt>Policy</dt>
            <dd>{data.preflight.policyResult.decision}</dd>
          </div>
          <div>
            <dt>Human decision</dt>
            <dd>{data.passport.authorization.status}</dd>
          </div>
          <div>
            <dt>Execution</dt>
            <dd>{data.passport.execution.status}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{data.passport.outcome.status}</dd>
          </div>
        </dl>
        <div className="ag-mini-hash">
          <span>SHA-256 integrity</span>
          <code title={data.passport.integrity.hash}>{shortHash(data.passport.integrity.hash)}</code>
        </div>
        <p>NOT FINALIZED · NOT ONCHAIN</p>
      </article>

      <aside className="ag-source-register" aria-label="External source boundaries">
        {/* Maturity halves come from the Capability Registry via props; only
            the boundary descriptors after the dot are copy. */}
        <div className="ag-source-state">
          <span>Agentverse Agent Passport</span>
          <b>{capabilityLabels.agentverse.toUpperCase()} · PUBLIC READ</b>
        </div>
        <div className="ag-source-state">
          <span>Agent Launch adapter</span>
          <b>{capabilityLabels.agentLaunch.toUpperCase()} · READ ONLY</b>
        </div>
        <div className="ag-source-state">
          <span>BNB APEX observer</span>
          <b>{capabilityLabels.bnbApex.toUpperCase()} · KNOWN REFERENCES</b>
        </div>
        <div className="ag-source-state">
          <span>Current Action Passport flow</span>
          <b>{capabilityLabels.actionPassport.toUpperCase()} · NO EXECUTION</b>
        </div>
        <div className="ag-source-state">
          <span>Ryntra-created BNB job</span>
          <b>{data.externalState.bnbApexJob}</b>
        </div>
        <ul>
          {data.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer noopener">
                {source.label}
                <ArrowSquareOut size={13} weight="bold" aria-hidden />
              </a>
              <span>{source.status}</span>
              <small>{source.limitation}</small>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
