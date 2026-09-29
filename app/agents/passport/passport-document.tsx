import { FileCode } from "@phosphor-icons/react";

import type {
  AgentPassport,
  AgentPassportFact,
} from "@/lib/agent-control/agent-passport";

import type { AgentPassportReadPhase } from "../types";
import { AgentCapabilityValidation } from "./capability-validation";

const MAX_VISIBLE_FACTS = 24;
const MAX_VISIBLE_DECLARATIONS = 16;
const MAX_VISIBLE_OBSERVATIONS = 12;
const MAX_VISIBLE_TEXT = 560;

const SPECIAL_FIELDS = new Set(["endpoints", "protocols"]);

function labelFor(field: string): string {
  return field.replaceAll("_", " ");
}

function valueText(value: AgentPassportFact["value"]): string {
  const raw = Array.isArray(value) ? value.join(" · ") : String(value);
  return raw.length > MAX_VISIBLE_TEXT ? `${raw.slice(0, MAX_VISIBLE_TEXT)}… [view bounded]` : raw;
}

function declaredValues(fact: AgentPassportFact | undefined): readonly string[] {
  if (!fact) return [];
  const values = Array.isArray(fact.value) ? fact.value : [String(fact.value)];
  return values.slice(0, MAX_VISIBLE_DECLARATIONS);
}

function StateDocument({
  phase,
  errorTitle,
  errorDetail,
}: {
  phase: Exclude<AgentPassportReadPhase, "loaded">;
  errorTitle: string | null;
  errorDetail: string | null;
}) {
  const copy = phase === "loading"
    ? ["Reading public sources", "Ryntra is requesting three fixed Agentverse source families. No declared endpoint is fetched."]
    : phase === "invalid"
      ? ["Address not accepted", "Enter one exact lowercase Agentverse bech32 address before requesting public evidence."]
      : phase === "error"
        ? [errorTitle ?? "Public read unavailable", errorDetail ?? "No Agent Passport was created from this request."]
        : ["No Agent Passport loaded", "A public example is prefilled, but no request runs until you choose Inspect public record."];

  return (
    <article className="ag-agent-passport-sheet ag-agent-passport-sheet--state" aria-live="polite">
      <FileCode size={30} weight="thin" aria-hidden />
      <h2>{copy[0]}</h2>
      <span>Ryntra · Agent Passport · public read</span>
      <p>{copy[1]}</p>
      <small>READ ONLY · PROVIDER GLOBAL · LIVENESS NOT_TESTED</small>
    </article>
  );
}

function FactTable({ facts }: { facts: readonly AgentPassportFact[] }) {
  const visible = facts.slice(0, MAX_VISIBLE_FACTS);
  return (
    <>
      <dl className="ag-agent-fact-table">
        {visible.map((fact) => (
          <div key={fact.id}>
            <dt>{labelFor(fact.field)}</dt>
            <dd>{valueText(fact.value)}</dd>
            <small>{fact.declaration.replaceAll("_", " ")} · {fact.sourceIds.join(" + ")}</small>
          </div>
        ))}
      </dl>
      {facts.length > visible.length ? (
        <p className="ag-agent-view-limit">{facts.length - visible.length} additional fields remain in the raw JSON.</p>
      ) : null}
    </>
  );
}

export function AgentPassportDocument({
  passport,
  phase,
  errorTitle,
  errorDetail,
}: {
  passport: AgentPassport | null;
  phase: AgentPassportReadPhase;
  errorTitle: string | null;
  errorDetail: string | null;
}) {
  if (!passport) {
    return (
      <StateDocument
        phase={phase === "loaded" ? "error" : phase}
        errorTitle={errorTitle}
        errorDetail={errorDetail}
      />
    );
  }

  const metrics = passport.providerClaims.filter((fact) => fact.declaration === "PROVIDER_REPORTED_METRIC");
  const endpoints = passport.providerClaims.find((fact) => fact.field === "endpoints");
  const protocols = passport.providerClaims.find((fact) => fact.field === "protocols");
  const profileFacts = passport.providerClaims.filter(
    (fact) => fact.declaration === "PROVIDER_DECLARED" && !SPECIAL_FIELDS.has(fact.field),
  );
  const partial = passport.sources.some((source) => source.availability !== "AVAILABLE");

  return (
    <article className="ag-agent-passport-sheet" aria-label="Agent Passport public evidence document">
      <header className="ag-agent-passport-sheet-head">
        <div>
          <h2>Agent Passport</h2>
          <span>Ryntra · Agent Passport · provider-global read</span>
          <code>{passport.request.address}</code>
        </div>
        <div>
          <span className="ag-agent-public-stamp">PUBLIC PROVIDER DATA</span>
          <small>READ ONLY</small>
        </div>
      </header>

      <div className="ag-passport-rule" />

      {partial ? (
        <div className="ag-agent-partial-note" role="status">
          <b>PARTIAL PUBLIC EVIDENCE</b>
          <span>Available source facts are shown; unavailable sources remain explicit in the ledger and unknowns.</span>
        </div>
      ) : null}

      <AgentCapabilityValidation passport={passport} />

      <section className="ag-agent-document-section" aria-labelledby="agent-profile-fields-title">
        <h3 id="agent-profile-fields-title">Provider declarations</h3>
        {profileFacts.length ? <FactTable facts={profileFacts} /> : <p className="ag-agent-document-empty">No profile declaration was normalized from the returned sources.</p>}
      </section>

      <section className="ag-agent-document-section" aria-labelledby="agent-protocol-fields-title">
        <h3 id="agent-protocol-fields-title">Protocols and endpoint declarations</h3>
        <dl className="ag-agent-declaration-table">
          <div>
            <dt>Protocols</dt>
            <dd>
              {declaredValues(protocols).length ? declaredValues(protocols).map((value, index) => <code key={`${index}-${value}`}>{value}</code>) : <span>NOT DECLARED</span>}
            </dd>
          </div>
          <div>
            <dt>Declared endpoints</dt>
            <dd>
              {declaredValues(endpoints).length ? declaredValues(endpoints).map((value, index) => <code key={`${index}-${value}`}>{value}</code>) : <span>NOT DECLARED</span>}
            </dd>
          </div>
        </dl>
        <p className="ag-agent-declaration-note">Declarations are non-clicking text. Ryntra did not fetch or test these endpoints.</p>
      </section>

      {metrics.length ? (
        <section className="ag-agent-document-section" aria-labelledby="agent-metrics-title">
          <h3 id="agent-metrics-title">Provider-reported metrics</h3>
          <FactTable facts={metrics} />
          <p className="ag-agent-declaration-note">Provider-reported values are not a Ryntra trust, safety, reputation or quality score.</p>
        </section>
      ) : null}

      <section className="ag-agent-document-section" aria-labelledby="agent-observations-title">
        <h3 id="agent-observations-title">Ryntra read observations</h3>
        <dl className="ag-agent-observation-table">
          {/* Two sources can report the same observation verbatim (address
              match from registry and search). The artifact keeps both rows so
              its hash is untouched; the rendered table says it once. */}
          {passport.ryntraObservations
            .filter((observation, index, all) =>
              all.findIndex(
                (other) =>
                  other.kind === observation.kind &&
                  String(other.value) === String(observation.value) &&
                  other.detail === observation.detail,
              ) === index,
            )
            .slice(0, MAX_VISIBLE_OBSERVATIONS)
            .map((observation) => (
              <div key={observation.id}>
                <dt>{labelFor(observation.kind)}</dt>
                <dd>{String(observation.value)}</dd>
                <small>{observation.detail}</small>
              </div>
            ))}
        </dl>
      </section>

      <dl className="ag-agent-document-proof">
        <div><dt>Provider / scope</dt><dd>{passport.request.provider} · PROVIDER_GLOBAL</dd></div>
        <div><dt>Maturity / created</dt><dd>{passport.maturity} · {passport.createdAt}</dd></div>
        <div><dt>Integrity · {passport.integrity.algorithm}</dt><dd><code title={passport.integrity.hash}>{passport.integrity.hash}</code></dd></div>
      </dl>

      <footer className="ag-agent-document-foot">
        <ul>
          {passport.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
        <small>{passport.kind} · schema {passport.schemaVersion} · {passport.id}</small>
      </footer>
    </article>
  );
}
