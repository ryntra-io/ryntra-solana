import {
  CheckCircle,
  Eye,
  FileText,
  Info,
  Prohibit,
  Question,
  SealCheck,
  Warning,
} from "@phosphor-icons/react/dist/ssr";

import type { AgentPassport } from "@/lib/agent-control/agent-passport";
import {
  deriveAgentCapabilities,
  type AgentCapabilityState,
} from "@/lib/agent-control/agent-capability";

function StateIcon({ state }: { state: AgentCapabilityState }) {
  if (state === "PROVEN") return <SealCheck size={16} weight="fill" aria-hidden />;
  if (state === "OBSERVED") return <Eye size={16} weight="bold" aria-hidden />;
  if (state === "DISCOVERED") return <CheckCircle size={16} weight="bold" aria-hidden />;
  if (state === "DECLARED") return <FileText size={16} weight="bold" aria-hidden />;
  if (state === "CONFLICTING") return <Warning size={16} weight="fill" aria-hidden />;
  if (state === "UNAVAILABLE") return <Prohibit size={16} weight="bold" aria-hidden />;
  return <Question size={16} weight="bold" aria-hidden />;
}

function State({ state }: { state: AgentCapabilityState }) {
  return (
    <span className="ag-capability-state" data-state={state}>
      <StateIcon state={state} />
      {state}
    </span>
  );
}

export function AgentCapabilityValidation({ passport }: { passport: AgentPassport }) {
  const rows = deriveAgentCapabilities(passport);

  return (
    <section className="ag-agent-document-section" aria-labelledby="agent-capability-validation-title">
      <h3 id="agent-capability-validation-title">Capability validation</h3>
      <p className="ag-capability-intro">
        Each capability keeps the provider claim and Ryntra observation separate. There is no aggregate score.
      </p>

      <div className="ag-capability-table" role="table" aria-label="Claimed versus observed agent capabilities">
        {rows.map((row) => (
          <div className="ag-capability-row" role="row" key={row.id}>
            <div className="ag-capability-name" role="cell">
              <span className="ag-capability-cell-label">Capability</span>
              <b>{row.label}</b>
              <span className="ag-capability-detail">{row.detail}</span>
            </div>
            <div className="ag-capability-status-cell" role="cell">
              <span className="ag-capability-cell-label">State</span>
              <State state={row.state} />
            </div>
            <div className="ag-capability-axis-cell" role="cell">
              <span className="ag-capability-cell-label">Claim / observation</span>
              <span className="ag-capability-axis">
                <span>{row.claimed}</span><span aria-hidden>/</span><span>{row.observed}</span>
              </span>
            </div>
            <details className="ag-capability-evidence" role="cell">
              <summary><Info size={15} weight="bold" aria-hidden /> Open evidence</summary>
              <dl>
                <div><dt>Authority</dt><dd>{row.authority}</dd></div>
                <div><dt>Observed</dt><dd>{row.observedAt}</dd></div>
                <div><dt>Method</dt><dd>{row.verificationMethod}</dd></div>
                <div><dt>Sources</dt><dd>{row.sourceIds.join(" + ")}</dd></div>
                <div><dt>Limit</dt><dd>{row.limitation}</dd></div>
              </dl>
            </details>
          </div>
        ))}
      </div>

      <p className="ag-capability-proof-limit">
        <Warning size={15} weight="bold" aria-hidden />
        No current capability is PROVEN. This adapter reads public records; it invokes no agent and proves no control.
      </p>
    </section>
  );
}
