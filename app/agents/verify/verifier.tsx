"use client";

import { ArrowClockwise, CheckCircle, ClipboardText, ShieldWarning, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ActionPassportPreview } from "@/lib/agent-control/contracts";

import {
  ACTION_PASSPORT_HANDOFF_KEY,
  loadAgentDemo,
  verifyArtifact,
} from "../agent-control-client";
import type { ArtifactVerificationView } from "../types";

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function shortHash(value: string): string {
  return value.length > 30 ? `${value.slice(0, 18)}…${value.slice(-10)}` : value;
}

export function ActionPassportVerifier() {
  const [source, setSource] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading-sample" | "checking">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [verification, setVerification] = useState<ArtifactVerificationView | null>(null);
  const [acceptedPassport, setAcceptedPassport] = useState<ActionPassportPreview | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const resetResult = useCallback(() => {
    setProblem(null);
    setVerification(null);
    setAcceptedPassport(null);
  }, []);

  const beginRequest = useCallback((nextPhase: "loading-sample" | "checking") => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    resetResult();
    setPhase(nextPhase);
    return controller;
  }, [resetResult]);

  const commitVerification = useCallback((
    passport: unknown,
    next: ArtifactVerificationView,
    controller: AbortController,
  ) => {
    if (requestRef.current !== controller) return;
    setVerification(next);
    setAcceptedPassport(next.integrity.valid ? passport as ActionPassportPreview : null);
  }, []);

  const loadSample = useCallback(async () => {
    const controller = beginRequest("loading-sample");
    try {
      const demo = await loadAgentDemo(controller.signal);
      if (requestRef.current !== controller) return;
      setSource(JSON.stringify(demo.passport, null, 2));
      setPhase("checking");
      const next = await verifyArtifact(demo.passport, controller.signal);
      commitVerification(demo.passport, next, controller);
    } catch (error: unknown) {
      if (!isAbort(error) && requestRef.current === controller) {
        setProblem(error instanceof Error ? error.message : "The sample could not be checked.");
      }
    } finally {
      if (requestRef.current === controller) setPhase("idle");
    }
  }, [beginRequest, commitVerification]);

  const loadHandoff = useCallback(async (serialized: string) => {
    requestRef.current?.abort();
    resetResult();
    setSource(serialized);
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      setProblem("The staged Action Passport was not valid JSON. Copy or download the artifact and paste it manually.");
      setPhase("idle");
      return;
    }

    const controller = beginRequest("checking");
    try {
      const next = await verifyArtifact(parsed, controller.signal);
      commitVerification(parsed, next, controller);
    } catch (error: unknown) {
      if (!isAbort(error) && requestRef.current === controller) {
        setProblem(error instanceof Error ? error.message : "The staged Action Passport could not be checked.");
      }
    } finally {
      if (requestRef.current === controller) {
        window.sessionStorage.removeItem(ACTION_PASSPORT_HANDOFF_KEY);
        setPhase("idle");
      }
    }
  }, [beginRequest, commitVerification, resetResult]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsHandoff = params.get("handoff") === "1";
    const wantsSample = params.get("sample") === "1";
    if (wantsHandoff) {
      const staged = window.sessionStorage.getItem(ACTION_PASSPORT_HANDOFF_KEY);
      if (staged) void loadHandoff(staged);
      else setProblem("No staged Action Passport was found. Load a fresh sample or paste the complete JSON object.");
    } else if (wantsSample) {
      void loadSample();
    }
    return () => requestRef.current?.abort();
  }, [loadHandoff, loadSample]);

  function changeSource(value: string) {
    requestRef.current?.abort();
    requestRef.current = null;
    setSource(value);
    setPhase("idle");
    resetResult();
  }

  async function checkPastedPassport() {
    requestRef.current?.abort();
    resetResult();
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      setProblem("Paste one complete Action Passport JSON object. The current text is not valid JSON.");
      setPhase("idle");
      return;
    }

    const controller = beginRequest("checking");
    try {
      const next = await verifyArtifact(parsed, controller.signal);
      commitVerification(parsed, next, controller);
    } catch (error: unknown) {
      if (!isAbort(error) && requestRef.current === controller) {
        setProblem(error instanceof Error ? error.message : "The Action Passport could not be checked.");
      }
    } finally {
      if (requestRef.current === controller) setPhase("idle");
    }
  }

  function clearAll() {
    requestRef.current?.abort();
    requestRef.current = null;
    setSource("");
    setPhase("idle");
    resetResult();
  }

  const visibleVerdict = verification?.integrity.valid ? "INTEGRITY_VALID" : "INVALID";
  const visibleOutcome = verification?.observation.verdict ?? "OUTCOME STATUS UNAVAILABLE";
  /* The three axes, never merged into one answer. A valid unsigned artifact
     and a tampered signed one are opposite situations that any single verdict
     would render identically. */
  const axes = verification
    ? [
        { label: "Issuer signature", verdict: verification.issuer.verdict, detail: verification.issuer.detail },
        { label: "Human authorization", verdict: verification.authorization.verdict, detail: verification.authorization.detail },
        { label: "Observed outcome", verdict: verification.observation.verdict, detail: verification.observation.detail },
      ]
    : [];

  return (
    <div className="rx-shell ag-verify-shell">
      <header className="ag-verify-head">
        <div>
          <span className="ag-eyebrow">Agent Control / Public verifier</span>
          <h1>Recompute the preview. Keep its limits intact.</h1>
          <p>
            Paste a complete Action Passport Preview or load a fresh sample. The server validates its schema and
            recomputes canonical hashes; it does not look up an ID, a chain transaction or an external outcome.
          </p>
        </div>
        <div className="ag-boundary-stack">
          <span className="ag-status" data-tone="evidence">SAMPLE CAPABLE</span>
          <span className="ag-status" data-tone="caution">NOT ONCHAIN</span>
          <span className="ag-status" data-tone="muted">NO ID LOOKUP</span>
        </div>
      </header>

      <div className="ag-verifier-grid">
        <section className="ag-verifier-input" aria-labelledby="verifier-input-title">
          <header className="ag-panel-head">
            <div>
              <span>Artifact input</span>
              <h2 id="verifier-input-title">Complete Action Passport JSON</h2>
            </div>
            <ClipboardText size={21} weight="regular" aria-hidden />
          </header>
          <label className="ag-json-field">
            <span>Action Passport Preview</span>
            <textarea
              value={source}
              onChange={(event) => changeSource(event.target.value)}
              placeholder={'{\n  "kind": "ACTION_PASSPORT_PREVIEW",\n  …\n}'}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
          <div className="ag-verifier-actions">
            <button className="ag-btn ag-btn--primary" type="button" onClick={() => void checkPastedPassport()} disabled={!source.trim() || phase !== "idle"}>
              <CheckCircle size={16} weight="bold" aria-hidden />
              {phase === "checking" ? "Checking integrity…" : "Check Action Passport integrity"}
            </button>
            <button className="ag-btn ag-btn--ghost" type="button" onClick={() => void loadSample()} disabled={phase !== "idle"}>
              <ArrowClockwise size={16} weight="bold" aria-hidden />
              {phase === "loading-sample" ? "Loading sample…" : "Load fresh sample"}
            </button>
            <button className="ag-btn ag-btn--ghost" type="button" onClick={clearAll} disabled={!source && !verification && !problem}>
              <Trash size={16} weight="bold" aria-hidden />
              Clear
            </button>
          </div>
          <p className="ag-input-boundary">Requests are same-origin and ephemeral. No account, wallet, credential or external write is used.</p>
        </section>

        <section className="ag-verifier-result" aria-labelledby="verifier-result-title" aria-live="polite">
          <header className="ag-panel-head">
            <div>
              <span>Integrity result</span>
              <h2 id="verifier-result-title">What the artifact supports</h2>
            </div>
          </header>

          {!verification && !problem ? (
            <div className="ag-empty-result">
              <ShieldWarning size={28} weight="thin" aria-hidden />
              <h3>No result yet</h3>
              <p>Load the bounded sample or paste one complete Action Passport object.</p>
            </div>
          ) : null}

          {problem ? (
            <div className="ag-integrity-banner" data-tone="danger" role="alert">
              <ShieldWarning size={22} weight="bold" aria-hidden />
              <div><span>REQUEST OR FORMAT ERROR</span><b>NO INTEGRITY RESULT</b><p>{problem}</p></div>
            </div>
          ) : null}

          {verification ? (
            <div className="ag-integrity-banner" data-tone={verification.integrity.valid ? "evidence" : "danger"}>
              {verification.integrity.valid ? <CheckCircle size={22} weight="bold" aria-hidden /> : <ShieldWarning size={22} weight="bold" aria-hidden />}
              <div>
                <span>{verification.integrity.valid ? "CANONICAL HASH MATCH" : "TAMPERED OR UNSUPPORTED"}</span>
                <b>{visibleVerdict}</b>
                <p>
                  {verification.integrity.valid
                    ? "The submitted preview matches the canonical integrity calculation."
                    : "The artifact failed schema or integrity checks. Its descriptive summary is intentionally hidden."}
                </p>
              </div>
            </div>
          ) : null}

          {verification && axes.length ? (
            <div className="ag-issue-list" data-axes="true">
              <span>Proof axes, reported separately and never merged</span>
              <ul>
                {axes.map((axis) => (
                  <li key={axis.label}>
                    <b>{axis.label}</b>: {axis.verdict} &mdash; {axis.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {verification && !verification.integrity.valid && verification.integrity.issues.length ? (
            <div className="ag-issue-list">
              <span>Issues returned</span>
              <ul>{verification.integrity.issues.map((issue: string, index: number) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>
            </div>
          ) : null}

          {acceptedPassport && verification?.integrity.valid ? (
            <article className="ag-verifier-passport">
              <header>
                <div><span>Action Passport</span><b>{acceptedPassport.id}</b></div>
                <span className="ag-paper-stamp">SAMPLE</span>
              </header>
              <dl>
                <div><dt>Intent</dt><dd>{acceptedPassport.intent.action.kind}</dd></div>
                <div><dt>Chain</dt><dd>{acceptedPassport.intent.action.chainRef}</dd></div>
                <div><dt>Policy</dt><dd>{acceptedPassport.policy.result.decision}</dd></div>
                <div><dt>Human decision</dt><dd>{acceptedPassport.authorization.status}</dd></div>
                <div><dt>Execution</dt><dd>{acceptedPassport.execution.status}</dd></div>
                <div><dt>Integrity</dt><dd><code title={acceptedPassport.integrity.hash}>{shortHash(acceptedPassport.integrity.hash)}</code></dd></div>
              </dl>
              <div className="ag-finality-strip">
                <span>NOT FINALIZED</span>
                <span>{visibleOutcome}</span>
              </div>
              <footer>
                <p>INTEGRITY_VALID is not evidence of authorization, execution, settlement or outcome.</p>
                <small>SAMPLE · NOT ONCHAIN</small>
              </footer>
            </article>
          ) : null}
        </section>
      </div>
    </div>
  );
}
