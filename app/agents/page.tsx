import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Fingerprint, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

import { Section, StatePill } from "@/app/site/parts";
import { sitePageMetadata } from "@/app/site/seo";
import { publicCapabilityRow } from "@/app/site/truth-core";

import { LandingDemoStatus } from "./landing-status";

export const revalidate = 3600;

export const metadata: Metadata = sitePageMetadata({
  path: "/agents",
  title: "Agent Control — understand the agent, control the action, prove the outcome — Ryntra",
  description:
    "Ryntra Agent Control binds public agent evidence, an exact proposed action, deterministic owner policy and explicit human authorization while keeping execution and outcome truth separate.",
  keywords: [
    "agent control",
    "economic agents",
    "agent intent",
    "action passport",
    "deterministic policy",
  ],
  audience: "guard",
});

const INTENT = publicCapabilityRow("agent-control-intent");
const PREFLIGHT = publicCapabilityRow("agent-control-preflight");
const PASSPORT = publicCapabilityRow("agent-decision-passport-preview");
const AGENT_PASSPORT = publicCapabilityRow("agentverse-public-passport");
const AGENT_LAUNCH = publicCapabilityRow("agent-launch-public-read");
const BNB_APEX = publicCapabilityRow("bnb-apex-read-observer");

const CAPABILITIES = [AGENT_PASSPORT, AGENT_LAUNCH, BNB_APEX, INTENT, PREFLIGHT, PASSPORT] as const;

const LIFECYCLE = [
  ["01", "Agent request", "Sample input; no external-origin claim"],
  ["02", "Strict intent", "AgentActionIntent 1.0.0"],
  ["03", "Evidence", "Source-labelled and time-bounded"],
  ["04", "Policy", "Deterministic and execution-free"],
  ["05", "Human decision", "Separate demo acknowledgement"],
  ["06", "Execution", "Unavailable"],
  ["07", "Outcome", "Not observed"],
  ["08", "Action Passport", "Integrity-checkable preview"],
] as const;

export default function AgentsLandingPage() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="ag-hero">
        <div className="rx-shell ag-hero-grid">
          <div className="ag-hero-copy">
            {/* Canon v5.2 replaced "Understand the agent" — the product's
                first move is verifying the intent, and the old line described
                the surface rather than the act. */}
            <h1>
              Verify the intent.
              <span> Control the action. Prove the outcome.</span>
            </h1>
            <p>
              Ryntra turns an agent-proposed economic action into live public evidence, deterministic owner policy,
              explicit authorization boundaries and a verifiable outcome path. Today the public Agent Passport and
              read-only adapters are real; wallet execution and a finalized Outcome Receipt are not yet available.
            </p>
            <div className="ag-actions">
              <Link className="ag-btn ag-btn--primary" href="/agents/passport">
                Inspect a live Agent Passport
                <ArrowRight size={16} weight="bold" aria-hidden />
              </Link>
              <Link className="ag-btn ag-btn--ghost" href="/agents/workspace/lab">
                Open Action Passport Lab
                <Fingerprint size={16} weight="bold" aria-hidden />
              </Link>
            </div>
            <ul className="ag-trust-rail" aria-label="Current product boundaries">
              <li>PUBLIC AGENT READ</li>
              <li>READ-ONLY ADAPTERS</li>
              <li>NO WALLET EXECUTION</li>
              <li>NO FINAL OUTCOME RECEIPT</li>
            </ul>
          </div>

          <div className="ag-hero-console" aria-label="Agent Control lifecycle preview">
            <header>
              <span>Source preview</span>
              <b>SAMPLE · NOT ONCHAIN</b>
            </header>
            <ol>
              {LIFECYCLE.slice(0, 5).map(([index, label, detail]) => (
                <li key={index}>
                  <span>{index}</span>
                  <div>
                    <b>{label}</b>
                    <small>{detail}</small>
                  </div>
                </li>
              ))}
            </ol>
            <footer>
              <ShieldCheck size={18} weight="bold" aria-hidden />
              <span>Human decision stays separate from policy and execution.</span>
            </footer>
          </div>
        </div>
      </section>

      <Section
        index="01"
        kicker="The boundary"
        heading="Identity, policy, payment and outcome live in separate systems."
        lead="Ryntra binds them around one exact action without treating a platform profile, a token association or a confirmed transaction as proof of capability, authorization or successful delivery."
      >
        <div className="ag-principles">
          <article>
            <span>Agent</span>
            <h3>Proposes a bounded request</h3>
            <p>Source, subject, action, chain, deliverable, deadline and expected effects become explicit fields.</p>
          </article>
          <article>
            <span>Ryntra</span>
            <h3>Resolves evidence and policy</h3>
            <p>Missing, stale, unsupported or conflicting inputs remain blockers rather than becoming model guesses.</p>
          </article>
          <article>
            <span>Human</span>
            <h3>Records a separate demo decision</h3>
            <p>The local acknowledgement is visibly demo-only. It is not a wallet authorization or provider signature.</p>
          </article>
        </div>
      </Section>

      <Section
        index="02"
        kicker="What is built"
        heading="Working reads and source previews, each with its own limit"
        lead="Every maturity label is resolved from the Capability Registry at render time. Implemented adapters remain read-only and are not presented as an integrated end-to-end action flow."
        paper
      >
        <div className="ag-capability-list">
          {CAPABILITIES.map((capability) => (
            <article key={capability.id}>
              <div>
                <h3>{capability.label}</h3>
                <p>{capability.scope}</p>
              </div>
              <StatePill label={capability.stateLabel} tone={capability.tone} />
              <p>{capability.limitation}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section
        index="03"
        kicker="Action proof"
        heading="An Action Passport Preview whose gaps remain visible"
        lead="The bounded demo endpoint creates a fresh sample in source. Its hashes can be recomputed, while its execution and outcome fields remain explicitly unavailable."
      >
        <LandingDemoStatus
          capabilityLabels={{
            agentverse: AGENT_PASSPORT.stateLabel,
            agentLaunch: AGENT_LAUNCH.stateLabel,
            bnbApex: BNB_APEX.stateLabel,
            actionPassport: PASSPORT.stateLabel,
          }}
        />
      </Section>

      <Section
        index="04"
        kicker="Lifecycle"
        heading="One action, eight separate lifecycle facts"
        lead="Integrity, policy, human acknowledgement, execution, outcome and finalization are different facts. The interface keeps them different."
        paper
      >
        <ol className="ag-lifecycle ag-lifecycle--landing">
          {LIFECYCLE.map(([index, label, detail], position) => (
            <li
              key={index}
              data-state={position < 5 || position === 7 ? "evidence" : position === 5 ? "blocked" : "caution"}
            >
              <span>{index}</span>
              <div>
                <b>{label}</b>
                <small>{detail}</small>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <section className="ag-close">
        <div className="rx-shell ag-close-inner">
          <div>
            <h2>Open Agent Control or inspect the strongest live public artifact.</h2>
            <p>The workspace shows what exists, what is only previewed and what still has no execution proof.</p>
          </div>
          <Link className="ag-btn ag-btn--primary" href="/agents/workspace">
            Open Mission Control
            <ArrowRight size={16} weight="bold" aria-hidden />
          </Link>
        </div>
      </section>
    </main>
  );
}
