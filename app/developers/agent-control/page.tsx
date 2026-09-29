import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BracketsCurly,
  Fingerprint,
  ShieldCheck,
  TerminalWindow,
} from "@phosphor-icons/react/dist/ssr";

import { PUBLIC_REPOSITORIES } from "@/lib/site/contacts";
import { sitePageMetadata } from "@/app/site/seo";
import { StatePill } from "@/app/site/parts";
import { publicCapabilityRow } from "@/app/site/truth-core";

import { CopyButton } from "./copy-button";
import {
  BNB_OBSERVER_COMMAND,
  CAPABILITY_MATRIX,
  HTTP_OPERATIONS,
  LOCAL_SOURCE_COMMAND,
  MCP_TOOLS,
  REFERENCE_STEPS,
} from "./surface";

export const revalidate = 3600;

const REGISTRY_CAPABILITIES = CAPABILITY_MATRIX.map((row) => ({
  ...row,
  registry: publicCapabilityRow(row.registryId),
}));

export const metadata: Metadata = sitePageMetadata({
  path: "/developers/agent-control",
  title: "Agent Control Developer Kit v0.1 — Ryntra",
  description:
    "The source-level Agent Control Developer Kit: a typed local SDK, exact read and preview HTTP contracts, seven non-executing MCP tools plus five that can only write a proposal, and a runnable reference flow with explicit limits.",
  keywords: [
    "agent control sdk",
    "agent mcp tools",
    "agentverse developer tools",
    "bnb apex observer",
    "action passport",
  ],
  audience: "guard",
});

function CodePanel({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: ReactNode;
}) {
  return (
    <div className="acd-code-panel">
      <div className="acd-code-head">
        <span>{label}</span>
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{value}</code>
      </pre>
      <p>{note}</p>
    </div>
  );
}

function SectionHeader({
  id,
  heading,
  lead,
  status,
}: {
  id: string;
  heading: string;
  lead: string;
  status?: ReactNode;
}) {
  return (
    <header className="acd-section-head">
      <div>
        <h2 id={id}>{heading}</h2>
        <p>{lead}</p>
      </div>
      {status}
    </header>
  );
}

export default function AgentControlDeveloperPage() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="acd-hero" aria-labelledby="acd-title">
        <div className="rx-shell acd-hero-grid">
          <div className="acd-hero-copy">
            <StatePill label="Live route · source preview" tone="neutral" />
            <h1 id="acd-title">
              Inspect an agent. Preflight its action. <span>Verify the record.</span>
            </h1>
            <p>
              Agent Control Developer Kit v0.1 turns the existing Ryntra Agent Control slices into one
              typed local developer contract. It reads bounded public evidence, drafts strict intents,
              runs deterministic preview policy and verifies integrity. It has no write tool.
            </p>
            <div className="acd-actions">
              <a className="rx-btn rx-btn--primary" href="#quickstart">
                Run the local source example
                <ArrowRight size={15} weight="bold" aria-hidden />
              </a>
              <Link className="rx-btn rx-btn--ghost" href="/agents/workspace">
                Open the sample workbench
              </Link>
            </div>
            <dl className="acd-hero-stats" aria-label="Developer Kit contract summary">
              <div>
                <dt>HTTP</dt>
                <dd translate="no">{HTTP_OPERATIONS.length} operations</dd>
              </div>
              <div>
                <dt>MCP</dt>
                <dd translate="no">{MCP_TOOLS.length} local tools</dd>
              </div>
              <div>
                <dt>Network scope</dt>
                <dd translate="no">BSC Testnet · 97</dd>
              </div>
              <div>
                <dt>Write surface</dt>
                <dd translate="no">0 tools</dd>
              </div>
            </dl>
          </div>

          <aside className="acd-manifest" aria-label="Developer Kit source manifest">
            <header>
              <div>
                <TerminalWindow size={18} weight="bold" aria-hidden />
                <span>Developer Kit manifest</span>
              </div>
              <StatePill label="Source preview" tone="evidence" />
            </header>
            <dl>
              <div>
                <dt>Package</dt>
                <dd translate="no">@ryntra/agent-control-sdk</dd>
              </div>
              <div>
                <dt>Client</dt>
                <dd translate="no">RyntraAgentControlClient</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd translate="no">HTTP · local stdio MCP</dd>
              </div>
              <div>
                <dt>Credentials</dt>
                <dd translate="no">omit by default</dd>
              </div>
              <div>
                <dt>Distribution</dt>
                <dd>Published Apache-2.0 source; not on npm</dd>
              </div>
              <div>
                <dt>Repository</dt>
                <dd>
                  <a
                    className="rx-link"
                    href={PUBLIC_REPOSITORIES.agentControl}
                    target="_blank"
                    rel="noreferrer"
                    translate="no"
                  >
                    ryntra-io/ryntra-agent-control
                  </a>
                </dd>
              </div>
              <div>
                <dt>Public states</dt>
                <dd>Capability registry at render time</dd>
              </div>
            </dl>
            <ol className="acd-manifest-flow" aria-label="Reference flow">
              {REFERENCE_STEPS.map((step, index) => (
                <li key={step.label}>
                  <span translate="no">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{step.label}</b>
                    <code>{step.method}</code>
                  </div>
                </li>
              ))}
            </ol>
            <footer>
              <ShieldCheck size={17} weight="bold" aria-hidden />
              <span>No account, wallet, signer, funding or provider write path.</span>
            </footer>
          </aside>
        </div>
      </section>

      <nav className="acd-local-nav" aria-label="Agent Control developer page">
        <div className="rx-shell">
          <a href="#quickstart">Quickstart</a>
          <a href="#contracts">HTTP &amp; MCP</a>
          <a href="#capabilities">Capability matrix</a>
          <a href="#limits">Limits</a>
        </div>
      </nav>

      <section className="acd-section" id="quickstart" aria-labelledby="quickstart-title">
        <div className="rx-shell">
          <SectionHeader
            id="quickstart-title"
            heading="Run the complete non-executing reference flow"
            lead="Start the Ryntra application locally, then run the workspace example against that origin. The example inspects an agent, drafts an intent, runs preflight and verifies the resulting Action Passport Preview."
            status={<StatePill label="No package download" tone="neutral" />}
          />

          <div className="acd-quickstart-grid">
            <CodePanel
              label="Local source command"
              value={LOCAL_SOURCE_COMMAND}
              note={
                <>
                  <code>AGENTVERSE_ADDRESS</code> is required and selects the exact public record to inspect.
                  <code> RYNTRA_BASE_URL</code> is optional and defaults to <code>https://ryntra.io</code>; the
                  command above pins it to the local origin explicitly.
                </>
              }
            />

            <ol className="acd-reference-flow">
              {REFERENCE_STEPS.map((step, index) => (
                <li key={step.label}>
                  <span translate="no">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{step.label}</h3>
                    <code>{step.method}</code>
                    <p>{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="acd-observer-example">
            <div>
              <BracketsCurly size={19} weight="bold" aria-hidden />
              <div>
                <h3>Known-reference BNB observer</h3>
                <p>
                  Supply one decimal <code>jobId</code> and its exact 32-byte transaction hash. The server
                  fixes chain 97, the RPC and contract allowlist. Placeholder values must be replaced before
                  the request is valid.
                </p>
              </div>
            </div>
            <CodePanel
              label="HTTP observer template"
              value={BNB_OBSERVER_COMMAND}
              note="This read can observe a missing, failed, non-terminal or contradictory reference. None creates a finalized Outcome Receipt."
            />
          </div>
        </div>
      </section>

      <section className="acd-section acd-section--paper" id="contracts" aria-labelledby="contracts-title">
        <div className="rx-shell">
          <SectionHeader
            id="contracts-title"
            heading="One bounded contract, two local transports"
            lead="The SDK and MCP server expose the same read and preview boundary. HTTP responses are private and no-store; MCP runs over local stdio with protocol output isolated from diagnostics. Five stdio tools also write, and every one of them produces the same thing: a proposal at PROPOSE, in that process, awaiting a person."
            status={<StatePill label="Writes propose only" tone="evidence" />}
          />

          <div className="acd-contract-grid">
            <article className="acd-contract-panel">
              <header>
                <div>
                  <BracketsCurly size={18} weight="bold" aria-hidden />
                  <h3>HTTP operations</h3>
                </div>
                <span translate="no">{HTTP_OPERATIONS.length} exact routes</span>
              </header>
              <div className="acd-operation-list">
                {HTTP_OPERATIONS.map((operation) => (
                  <article key={`${operation.method} ${operation.path}`}>
                    <div className="acd-operation-id">
                      <span data-method={operation.method}>{operation.method}</span>
                      <code>{operation.path}</code>
                    </div>
                    <p>{operation.purpose}</p>
                    <div className="acd-operation-meta">
                      <code>{operation.sdkMethod}</code>
                      <span>{operation.operationMode}</span>
                    </div>
                    <small>{operation.boundary}</small>
                  </article>
                ))}
              </div>
            </article>

            <article className="acd-contract-panel">
              <header>
                <div>
                  <TerminalWindow size={18} weight="bold" aria-hidden />
                  <h3>Local MCP tools</h3>
                </div>
                <span translate="no">{MCP_TOOLS.length} exact names</span>
              </header>
              <div className="acd-tool-list">
                {MCP_TOOLS.map((tool) => (
                  <article key={tool.name}>
                    <code>{tool.name}</code>
                    <p>{tool.purpose}</p>
                    <small>{tool.boundary}</small>
                  </article>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="acd-section" id="capabilities" aria-labelledby="capabilities-title">
        <div className="rx-shell">
          <SectionHeader
            id="capabilities-title"
            heading="Four truths stay separate"
            lead="Route availability, provider capability, Ryntra maturity and user eligibility answer different questions. A mounted source route does not make an external integration live, and a provider response does not promote Ryntra maturity."
          />

          <dl className="acd-truth-axes">
            <div>
              <dt>Route availability</dt>
              <dd>The seven HTTP routes are live on this Ryntra deployment and twelve MCP tools run locally over stdio — seven that read and five that write one local proposal. The published kit is the seven. Route availability does not promote provider capability or Ryntra maturity.</dd>
            </div>
            <div>
              <dt>Provider capability</dt>
              <dd>Agentverse, Agent Launch and BNB APEX reads can return bounded observations for exact caller-supplied references, or fail closed.</dd>
            </div>
            <div>
              <dt>Ryntra maturity</dt>
              <dd>Every state below comes from <code>publicCapabilityRow</code> at render time, including any freshness downgrade to Re-verifying.</dd>
            </div>
            <div>
              <dt>User eligibility</dt>
              <dd>The kit makes no account, ownership or eligibility decision. Provider and jurisdiction rules remain external, current and user-specific.</dd>
            </div>
          </dl>

          <div className="acd-table-wrap" tabIndex={0} role="region" aria-label="Agent Control capability matrix">
            <table className="acd-table">
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col">Exact input</th>
                  <th scope="col">Output</th>
                  <th scope="col">Registry state</th>
                  <th scope="col">Registry limitation</th>
                </tr>
              </thead>
              <tbody>
                {REGISTRY_CAPABILITIES.map((row) => (
                  <tr key={row.registryId}>
                    <th scope="row">
                      {row.registry.label}
                      <code className="acd-registry-id">{row.registryId}</code>
                    </th>
                    <td>{row.input}</td>
                    <td>{row.output}</td>
                    <td className="acd-registry-state">
                      <StatePill label={row.registry.stateLabel} tone={row.registry.tone} />
                      <span>{row.registry.scope}</span>
                      <time dateTime={row.registry.lastVerifiedAt}>Reviewed {row.registry.lastVerifiedAt}</time>
                    </td>
                    <td>{row.registry.limitation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="acd-section acd-limits" id="limits" aria-labelledby="limits-title">
        <div className="rx-shell">
          <SectionHeader
            id="limits-title"
            heading="The missing actions are part of the contract"
            lead="The kit is useful before it can move value because it makes identity evidence, intent shape, policy and integrity inspectable without asking a developer to trust a simulated settlement."
            status={<StatePill label="Fails closed" tone="caution" />}
          />

          <div className="acd-limit-grid">
            <article>
              <Fingerprint size={20} weight="bold" aria-hidden />
              <h3>What this source kit can establish</h3>
              <ul>
                <li>The exact public record and the source that supplied each claim.</li>
                <li>Unknown, conflicting, stale or unavailable evidence without collapsing it into a score.</li>
                <li>A strict versioned intent and a deterministic source-preview policy result.</li>
                <li>Action Passport Preview integrity recomputed by an independent caller.</li>
                <li>One known BNB APEX testnet job/transaction binding when the caller supplies both references.</li>
              </ul>
            </article>
            <article>
              <ShieldCheck size={20} weight="bold" aria-hidden />
              <h3>What remains outside v0.1</h3>
              <ul>
                <li>No provider account, Agentverse ownership, registration, endpoint call or ASI:One invocation.</li>
                <li>No wallet connection, signature, server signer, custody, funding or transaction broadcast.</li>
                <li>No Agent Launch tokenization, handoff, launch, trading or holder claim.</li>
                <li>No BNB APEX create, submit, evaluate, settle or refund write.</li>
                <li>No finalized Outcome Receipt without independently observed terminal effects.</li>
                <li>No npm package and no remote MCP service; the published repository is a source release, not a hosted endpoint.</li>
              </ul>
            </article>
          </div>

          <p className="acd-page-boundary">
            Absence and failure stay explicit: <code>ZERO_STATE</code> means a successful empty list,{" "}
            <code>NOT_FOUND</code> means the exact record was not observed, stale or unavailable evidence remains
            non-positive, and <code>UPSTREAM_FAILURE</code> returns no raw provider error. This page itself performs
            no provider request. Reads happen only when a developer runs the local example, calls an HTTP route or
            invokes one of the listed stdio tools.
          </p>
        </div>
      </section>

      <section className="acd-related" aria-labelledby="related-title">
        <div className="rx-shell">
          <header>
            <h2 id="related-title">Inspect the same boundary from the product side</h2>
            <p>Each link opens an already-existing Agent Control surface. None starts a wallet or provider action.</p>
          </header>
          <div className="acd-related-links">
            <Link href="/agents">
              <span>Product overview</span>
              <small>Current Agent Control maturity and lifecycle</small>
              <ArrowRight size={15} weight="bold" aria-hidden />
            </Link>
            <Link href="/agents/passport">
              <span>Agent Passport</span>
              <small>Inspect one exact public Agentverse address</small>
              <ArrowRight size={15} weight="bold" aria-hidden />
            </Link>
            <Link href="/agents/workspace">
              <span>Sample workbench</span>
              <small>Change the strict intent and run preflight</small>
              <ArrowRight size={15} weight="bold" aria-hidden />
            </Link>
            <Link href="/agents/verify">
              <span>Passport verifier</span>
              <small>Recompute preview integrity from JSON</small>
              <ArrowRight size={15} weight="bold" aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
