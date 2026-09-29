"use client";

import {
  Copy,
  DownloadSimple,
  FileCode,
  MagnifyingGlass,
  ShieldWarning,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";

import type { AgentPassport } from "@/lib/agent-control/agent-passport";

import { AgentApiError, loadAgentPassport } from "../agent-control-client";
import type { AgentPassportReadPhase } from "../types";
import { AgentPassportDocument } from "./passport-document";
import { AgentEvidenceBoundary, AgentSourceLedger } from "./passport-rails";

export const SAFE_AGENTVERSE_EXAMPLE = "agent1q2d0n5tp563wr0ugj9cmcqms9jfv5ks63xy5vg3evy5gy0z52e66xmeyyw9";

const AGENTVERSE_ADDRESS = /^agent1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{59}$/;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorCopy(error: unknown): { title: string; detail: string } {
  if (error instanceof AgentApiError) {
    if (error.code === "RATE_LIMITED" || error.status === 429) {
      return { title: "Request limit reached", detail: "No passport was created. Wait for the public-read limit to reset, then try again." };
    }
    if (error.code === "UPSTREAM_FAILURE" || error.status === 502) {
      return { title: "Public source unavailable", detail: "The official public read did not complete. No unavailable value was promoted to a fact." };
    }
    if (error.code === "REQUEST_ABORTED" || error.status === 499) {
      return { title: "Public read cancelled", detail: "The request ended before a bounded Agent Passport was returned." };
    }
    if (error.code === "INVALID_REQUEST" || error.status === 400) {
      return { title: "Address not accepted", detail: "The server rejected the exact-address query. Check the lowercase bech32 value and try again." };
    }
  }
  return { title: "Public read unavailable", detail: "The Agent Passport endpoint did not return a bounded document. No external state was changed." };
}

export function AgentPassportExplorer({
  onPassportLoaded,
}: {
  onPassportLoaded?: (passport: AgentPassport) => string | null | void | Promise<string | null | void>;
} = {}) {
  const inputId = useId();
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const [address, setAddress] = useState(SAFE_AGENTVERSE_EXAMPLE);
  const [phase, setPhase] = useState<AgentPassportReadPhase>("idle");
  const [passport, setPassport] = useState<AgentPassport | null>(null);
  const [problem, setProblem] = useState<{ title: string; detail: string } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    requestRef.current?.abort();
  }, []);

  /*
   * ?address= is both the shareable deep link and the pre-hydration fallback:
   * the form submits natively as GET before React attaches, which lands back
   * here with the query set, so a click that used to vanish now runs the read.
   */
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("address")?.trim();
    if (fromUrl && AGENTVERSE_ADDRESS.test(fromUrl)) {
      setAddress(fromUrl);
      void inspectAddress(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeAddress(value: string) {
    requestRef.current?.abort();
    requestRef.current = null;
    setAddress(value);
    setPassport(null);
    setProblem(null);
    setFeedback(null);
    setShowJson(false);
    setPhase("idle");
  }

  async function inspectAddress(explicitAddress?: string) {
    const exactAddress = (explicitAddress ?? address).trim();
    requestRef.current?.abort();
    setPassport(null);
    setProblem(null);
    setFeedback(null);
    setShowJson(false);

    if (!AGENTVERSE_ADDRESS.test(exactAddress)) {
      setPhase("invalid");
      setProblem({
        title: "Address not accepted",
        detail: "Use agent1 followed by exactly 59 lowercase bech32 characters. Names, handles and ENS are not accepted.",
      });
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setAddress(exactAddress);
    setPhase("loading");
    try {
      const next = await loadAgentPassport(exactAddress, controller.signal);
      if (requestRef.current !== controller) return;
      setPassport(next);
      setPhase("loaded");
      window.history.replaceState(null, "", `${window.location.pathname}?address=${exactAddress}`);
      const sourceFeedback = next.sources.every((source) => source.availability === "AVAILABLE")
          ? "All three source families returned available evidence for this read."
          : "A partial passport was returned. Unavailable sources and unknowns remain visible.";
      let retentionFeedback: string | null | void;
      try {
        retentionFeedback = await onPassportLoaded?.(next);
      } catch {
        retentionFeedback = "The Passport loaded, but this workspace could not add it to Agent Radar.";
      }
      if (requestRef.current !== controller) return;
      setFeedback([sourceFeedback, retentionFeedback].filter(Boolean).join(" "));
    } catch (error: unknown) {
      if (!isAbort(error) && requestRef.current === controller) {
        setProblem(errorCopy(error));
        setPhase("error");
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function copyPassport() {
    if (!passport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(passport, null, 2));
      setFeedback("Agent Passport JSON copied. Declared endpoint strings remain data, not navigation.");
    } catch {
      setFeedback("Clipboard access was unavailable. Use View raw JSON and copy the bounded document manually.");
    }
  }

  function downloadPassport() {
    if (!passport) return;
    const blob = new Blob([JSON.stringify(passport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ryntra-agent-passport-${passport.request.address}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setFeedback("Agent Passport downloaded as raw JSON.");
  }

  return (
    <div className="rx-shell ag-agent-passport-shell">
      <header className="ag-agent-passport-head">
        <div>
          <h1>Inspect the agent, not a score.</h1>
          <span className="ag-agent-passport-meta">Agent Control · Passport · exact-address public read</span>
          <p>Resolve exact public Agentverse records into source-labelled facts, conflicts and unknowns.</p>
        </div>

        <form
          className="ag-agent-passport-query"
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            void inspectAddress();
          }}
          aria-busy={phase === "loading"}
        >
          <label htmlFor={inputId}>Agent address (bech32)</label>
          <div>
            <input
              id={inputId}
              name="address"
              value={address}
              onChange={(event) => changeAddress(event.target.value)}
              aria-describedby={`${helpId}${problem ? ` ${errorId}` : ""}`}
              aria-invalid={phase === "invalid" || undefined}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={65}
            />
            <button className="ag-btn ag-btn--primary" type="submit" disabled={phase === "loading"}>
              <MagnifyingGlass size={16} weight="bold" aria-hidden />
              {phase === "loading" ? "Reading public sources…" : "Inspect public record"}
            </button>
          </div>
          <small id={helpId}>Exact Agentverse address only. Public reads are provider-global; there is no network selector.</small>
          {problem ? <p id={errorId} role="alert"><ShieldWarning size={15} weight="bold" aria-hidden />{problem.detail}</p> : null}
        </form>
      </header>

      <div className="ag-agent-passport-grid" aria-busy={phase === "loading"}>
        <AgentSourceLedger passport={passport} phase={phase} />

        <div className="ag-agent-passport-center">
          <AgentPassportDocument
            passport={passport}
            phase={phase}
            errorTitle={problem?.title ?? null}
            errorDetail={problem?.detail ?? null}
          />

          {passport ? (
            <>
              <div className="ag-artifact-actions" aria-label="Agent Passport actions">
                <button className="ag-btn ag-btn--ghost" type="button" onClick={() => setShowJson((current) => !current)}>
                  <FileCode size={16} weight="bold" aria-hidden />
                  {showJson ? "Hide raw JSON" : "View raw JSON"}
                </button>
                <button className="ag-btn ag-btn--ghost" type="button" onClick={() => void copyPassport()}>
                  <Copy size={16} weight="bold" aria-hidden />
                  Copy document
                </button>
                <button className="ag-btn ag-btn--ghost" type="button" onClick={downloadPassport}>
                  <DownloadSimple size={16} weight="bold" aria-hidden />
                  Download JSON
                </button>
              </div>
              {showJson ? <pre className="ag-json-view ag-agent-passport-json">{JSON.stringify(passport, null, 2)}</pre> : null}
            </>
          ) : null}

          <p className="ag-agent-point-in-time">
            This passport reflects a point-in-time observation of public provider records. Records may change.
          </p>
          <p className="ag-agent-feedback" role="status" aria-live="polite">{feedback}</p>
        </div>

        <AgentEvidenceBoundary passport={passport} />
      </div>
    </div>
  );
}
