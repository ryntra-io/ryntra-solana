/**
 * The Agent Control surface and deferral register.
 *
 * The public documentation page for Agent Control renders from this file rather
 * than from prose, which is what makes the finish line's last condition — *no
 * sentence a person can read that a test cannot check* — true for that page.
 * Every field is checkable: the route resolves, the module exists, the write
 * authority is a constant, and each deferral names both the gate that would
 * open it and a real path where the work would land.
 *
 * **Why a second register when `app/agents/workspace/surfaces.ts` exists.**
 * They answer different questions and neither can answer the other's. That file
 * owns *rendering* facts — the heading, the scope chip, the state word, the
 * "instead" link — and is read by pages. This one owns *product* facts — what
 * the surface is for, what it refuses, which capability rows it depends on,
 * which wave built it — and is read by the documentation page and the finish
 * battery. The battery asserts that every workspace route in that file appears
 * here, so the two cannot quietly disagree about what the product has.
 *
 * **`writeAuthority` is the constant `NONE` on every row and is not read from
 * an input.** No page under `/agents` writes, signs, authorizes, executes or
 * moves anything. The product's one write path is not a page at all — see
 * `AGENT_CONTROL_WRITE_PATH` — and a row that needed a different value would
 * have to change the type, which is the review moment it deserves.
 */

import type { ProductCapabilityId } from "@/lib/product/capabilities";

export const AGENT_CONTROL_WRITE_AUTHORITY = "NONE" as const;

/**
 * The one place in Agent Control where an outside caller changes Ryntra state,
 * stated here so that "every surface is read-only" cannot be read as "nothing
 * writes".
 *
 * It is not reachable from any page. `RYN-AGENT-CONTROL-013` made a generic
 * signer unrepresentable rather than forbidden: the effect vocabulary the write
 * tools are typed against has exactly one member, so there is no value a
 * signing tool could carry.
 */
export const AGENT_CONTROL_WRITE_PATH = Object.freeze({
  where: "The five MCP write tools, admitted by lib/agent-control/mcp/write-gate.ts",
  effect: "PROPOSAL_ONLY",
  reachableFromASurface: false,
  why:
    "A write records a proposal at PROPOSE and nothing else. AUTHORIZE is closed by an owner outside the tool "
    + "surface, and no tool can reach it.",
  module: "lib/agent-control/mcp/write-gate.ts",
});

export type AgentControlSurfaceRecord = Readonly<{
  id: string;
  label: string;
  href: string;
  /** One line. What a reader comes to this surface to find out. */
  question: string;
  /** The module that owns what this surface's facts mean. */
  module: string;
  /** The delivery wave that built it. */
  wave: string;
  /** What this surface refuses to do, stated where a reader will see it. */
  refuses: readonly string[];
  /** Registry rows whose truth this surface depends on. Empty is a real answer. */
  capabilities: readonly ProductCapabilityId[];
  writeAuthority: typeof AGENT_CONTROL_WRITE_AUTHORITY;
}>;

const NONE = AGENT_CONTROL_WRITE_AUTHORITY;

export const AGENT_CONTROL_SURFACES: readonly AgentControlSurfaceRecord[] = Object.freeze([
  Object.freeze<AgentControlSurfaceRecord>({
    id: "mission-control",
    label: "Mission Control",
    href: "/agents/workspace",
    question: "What is this workspace, and what can it actually do today?",
    module: "app/agents/workspace/workbench.tsx",
    wave: "RYN-AGENT-WS-001",
    refuses: ["Shows a route with no backend carrying its real state word rather than hiding it."],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "actions",
    label: "Actions",
    href: "/agents/workspace/actions",
    question: "What has been proposed, what did the policy say, and what did a person decide?",
    module: "lib/agent-control/action-case.ts",
    wave: "RYN-AGENT-WS-001",
    refuses: [
      "Keeps the list tab-local and says so: there is no durable Action Case queue behind it.",
      "Never treats a policy verdict as an authorization.",
    ],
    capabilities: ["agent-control-intent"],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "lab",
    label: "Action Passport Lab",
    href: "/agents/workspace/lab",
    question: "What exactly does this agent propose, and what does the policy answer?",
    module: "lib/agent-control/core.ts",
    wave: "RYN-AGENT-CONTROL-002",
    refuses: [
      "The policy decides deterministically; no language model contributes to a verdict.",
      "Records a local demo acknowledgement, never a product authorization.",
    ],
    capabilities: ["agent-control-intent", "agent-control-preflight"],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "reviews",
    label: "Reviews",
    href: "/agents/workspace/reviews",
    question: "What is waiting on a person, and what would invalidate the approval?",
    module: "app/agents/workspace/reviews/page.tsx",
    wave: "RYN-AGENT-WS-001",
    refuses: ["States that no authenticated approval workflow exists rather than showing an empty queue."],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "agents",
    label: "Agent Radar",
    href: "/agents/workspace/agents",
    question: "Which agents have been inspected, and where does claimed disagree with observed?",
    module: "lib/agent-control/passport-directory.ts",
    wave: "RYN-AGENT-CONTROL-009",
    refuses: [
      "Issues no score, no rank and no trust leaderboard.",
      "Keeps provider declaration and Ryntra observation as separate facts per capability.",
    ],
    capabilities: ["agentverse-public-passport"],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "passport",
    label: "Agent Passport",
    href: "/agents/workspace/passport",
    question: "Who is this agent, and what is actually known about it?",
    module: "lib/agent-control/agent-passport.ts",
    wave: "RYN-AGENT-CONTROL-009",
    refuses: [
      "Every reading is a point-in-time public read with its own freshness, never a standing fact.",
      "A capability nobody observed stays unknown rather than being inferred from a declaration.",
    ],
    capabilities: ["agentverse-public-passport"],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "policies",
    label: "Mandates and policies",
    href: "/agents/workspace/policies",
    question: "Which rules is an action judged against, and what has already been committed?",
    module: "lib/agent-control/owner-control.ts",
    wave: "RYN-AGENT-CONTROL-010",
    refuses: [
      "BOUNDED_MANDATE fails closed without an active, exact-path, revocable technical binding.",
      "Pending and escrowed commitments reduce the available budget before the next action is reviewed.",
    ],
    capabilities: ["agent-control-preflight"],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "evidence",
    label: "Evidence and receipts",
    href: "/agents/workspace/evidence",
    question: "What artifacts exist for this action, and which of them is not a receipt?",
    module: "lib/agent-control/artifacts.ts",
    wave: "RYN-AGENT-WS-001",
    refuses: [
      "A preview that states OUTCOME_NOT_OBSERVED is a preview; calling it a receipt is the claim the canon forbids.",
      "Keeps six artifact kinds apart rather than merging them into one document.",
    ],
    capabilities: ["agent-decision-passport-preview"],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "verify",
    label: "Preview verifier",
    href: "/agents/workspace/verify",
    question: "Does this artifact recompute to the hashes it claims?",
    module: "lib/agent-control/verify.ts",
    wave: "RYN-AGENT-CONTROL-002",
    refuses: ["Reports three proof axes separately and never merges them into a single pass or fail."],
    capabilities: ["agent-decision-passport-preview"],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "authorize",
    label: "Human authorization",
    href: "/agents/workspace/authorize",
    question: "What does an owner signature over this exact action look like?",
    module: "lib/agent-control/authorization.ts",
    wave: "RYN-AGENT-CONTROL-005",
    refuses: [
      "Signs an artifact in the reader's own wallet without that signature becoming a product authorization.",
      "Never requests a seed phrase, a private key or a withdrawal scope.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "integrations",
    label: "Adapter projections",
    href: "/agents/workspace/integrations",
    question: "How does one action identity read on Solana and Stellar at once?",
    module: "lib/agent-control/adapter-projection.ts",
    wave: "RYN-AGENT-CONTROL-011",
    refuses: [
      "One Action and Receipt core across every adapter; never a second Agent Control per chain.",
      "Keeps provider capability, Ryntra maturity, route capability and user eligibility as four independent axes.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "commerce",
    label: "Jobs and payments",
    href: "/agents/workspace/commerce",
    question: "Which payment route is declarable here, and what did paying actually prove?",
    module: "lib/agent-control/payments/x402-engine.ts",
    wave: "RYN-AGENT-CONTROL-012",
    refuses: [
      "Binds a payment outcome and a service outcome separately: paying is not evidence of delivery.",
      "Mirrors both Draft standards behind a content digest and integrates neither.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "tools",
    label: "Agent tools",
    href: "/agents/workspace/tools",
    question: "What can a tool call do here, and what does the gate refuse?",
    module: "lib/agent-control/mcp/write-gate.ts",
    wave: "RYN-AGENT-CONTROL-013",
    refuses: [
      "Five write tools share one effect value, so a generic signer has nothing to carry.",
      "An A2A task in a terminal state promotes nothing and never becomes a Receipt.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "adoption",
    label: "External adoption",
    href: "/agents/workspace/adoption",
    question: "Who can reach the hosted endpoint, holding what, and how much of it?",
    module: "lib/agent-control/adoption-current.ts",
    wave: "RYN-AGENT-CONTROL-008",
    refuses: [
      "Every matrix cell is a real gate call at render time, so the page cannot disagree with the server.",
      "No tenant or key can be created from any screen.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "operations",
    label: "Operations",
    href: "/agents/workspace/operations",
    question: "What is this system doing, and what is it deliberately not counting?",
    module: "lib/agent-control/analytics/operations.ts",
    wave: "RYN-AGENT-CONTROL-014",
    refuses: [
      "Never totals a measured count with a catalogue size: the two are different quantities and the helper throws.",
      "Counts per warm instance and computes no fleet total, stated on the snapshot rather than in a footnote.",
      "Issues no health verdict, availability figure or uptime number.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "attention",
    label: "Attention and recovery",
    href: "/agents/workspace/attention",
    question: "What needs a person right now, and who can actually fix it?",
    module: "lib/agent-control/attention.ts",
    wave: "RYN-AGENT-CONTROL-014",
    refuses: [
      "Ranks by a frozen category table and issues no importance number.",
      "An item nobody can act on names the record that would change that.",
      "An empty queue states what was checked, so a calm state cannot read as a failed load.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "team",
    label: "Team",
    href: "/agents/workspace/team",
    question: "Who holds access to this tenant, with which scopes and which budget?",
    module: "lib/agent-control/team-current.ts",
    wave: "RYN-AGENT-CONTROL-014",
    refuses: [
      "Reads tenancy and issues nothing: no key is created, rotated or revoked from this screen.",
      "Never renders a secret, a key body or any part of one.",
      "Shows the mainnet promotion perimeter as computed refusals rather than as a maturity badge.",
    ],
    capabilities: [],
    writeAuthority: NONE,
  }),
  Object.freeze<AgentControlSurfaceRecord>({
    id: "settings",
    label: "Workspace settings",
    href: "/agents/workspace/settings",
    question: "How is this workspace configured, and where does each setting take effect?",
    module: "app/agents/workspace/settings/page.tsx",
    wave: "RYN-AGENT-WS-001",
    refuses: ["States that Agent Control has no workspace-scoped settings of its own rather than inventing some."],
    capabilities: [],
    writeAuthority: NONE,
  }),
]);

/**
 * Everything the canon designed that this product has not built.
 *
 * A finish line is only honest if the unfinished parts are enumerated. A silent
 * omission and a deliberate deferral render identically in a feature list and
 * mean opposite things, so every remaining item names the gate that would open
 * it and a real path where the work would land.
 *
 * `nearest` is not "where it is". It is where it *would be*, and the finish
 * battery asserts the path exists — a deferral pointing at nothing is a wish.
 */
export type AgentControlDeferral = Readonly<{
  id: string;
  label: string;
  /** The exact condition that would open it. Never "coming soon". */
  gate: string;
  /** A real repository path where the work would land. */
  nearest: string;
}>;

export const AGENT_CONTROL_DEFERRED: readonly AgentControlDeferral[] = Object.freeze([
  Object.freeze({
    id: "mainnet-execution",
    label: "Mainnet execution and Outcome Receipts over a real effect",
    gate:
      "A founder decision superseding FD-02, then one canary per capability through lib/agent-control/mainnet-promotion.ts. "
      + "Every capability is refused today on its own missing canary, and no capability inherits another's.",
    nearest: "lib/agent-control/mainnet-promotion.ts",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "agent-portfolio",
    label: "Agent Portfolio with fleet and budget exposure",
    gate:
      "A durable, authenticated fleet record. The Radar directory is tab-local by construction: a new tab starts "
      + "empty, so there is nothing a portfolio could aggregate across sessions.",
    nearest: "lib/agent-control/passport-directory.ts",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "agent-delegation",
    label: "Agent-to-agent delegation",
    gate:
      "A revocable technical authority that a provider actually enforces, plus an outbound A2A path. Inbound A2A "
      + "creates proposals and no outbound call exists, so there is nothing to delegate with.",
    nearest: "lib/agent-control/a2a/inbound.ts",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "counterparties-and-services",
    label: "Counterparties and services as first-class evidence",
    gate:
      "A service-delivery report that is not the payment report. The vocabularies are already disjoint; what is "
      + "missing is any source admissible on the service axis.",
    nearest: "lib/agent-control/payments/vocabulary.ts",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "workspace-assistant",
    label: "The in-workspace AI assistant",
    gate:
      "A contextual assistant may Explain, Formalize, Compare and Review only. It supplies no missing fact and "
      + "decides no policy, so it waits on the compiled evidence surfaces it would read from rather than on a model.",
    nearest: "lib/agent-control/adapter-projection-current.ts",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "remaining-adapter-projections",
    label: "Base/EVM, Starknet and Robinhood/Arcus adapter projections",
    gate:
      "Each needs its own ecosystem surface to project from. Solana and Stellar shipped in wave 3; the rest "
      + "have no shared action identity to expose yet, and Robinhood/Arcus comes after safer commerce adapters mature.",
    nearest: "lib/agent-control/adapter-projection.ts",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "mobile",
    label: "A mobile Agent Control layout",
    gate:
      "The workspace collapses correctly at 375 and is verified there, but a mobile layout of its own is a separate "
      + "design packet rather than a breakpoint, and none is registered.",
    nearest: "app/agents/workspace/agent-workspace.css",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "demo-video",
    label: "A demo video cut from real footage",
    gate:
      "Finish condition 5 asks for footage of the product working; the founder records it, and no video exists yet.",
    nearest: "docs/products/agent-control.md",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "external-b2b-name",
    label: "An external B2B product name",
    gate:
      "No external product name is published anywhere: the module ships under its internal name, and no package takes one.",
    nearest: "docs/agent-control/README.md",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "enforced-pilot",
    label: "An enforced pilot",
    gate:
      "Nothing in the product enforces today — external direct actions are OBSERVE_ONLY.",
    nearest: "lib/agent-control/owner-control.ts",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "packages-published",
    label: "The developer packages on a public registry",
    gate:
      "Publishing needs an npm sign-in with a password and a one-time code, and the @ryntra scope has zero "
      + "published packages.",
    nearest: "docs/agent-control/DEVELOPER-KIT-EXTRACTION-MANIFEST.json",
  }),
  Object.freeze<AgentControlDeferral>({
    id: "bnb-signed-lifecycle",
    label: "The BNB signed lifecycle",
    gate:
      "The signed lifecycle waits on funding: United Stables on BNB Testnet is minted by its issuer with "
      + "autoMintMaxLimit 0 and no faucet, so obtaining it is a human request rather than a code path.",
    nearest: "lib/agent-control/adapters/bnb-apex.ts",
  }),
]);

const BY_ID = new Map(AGENT_CONTROL_SURFACES.map((surface) => [surface.id, surface]));

export function agentControlSurface(id: string): AgentControlSurfaceRecord {
  const surface = BY_ID.get(id);
  if (!surface) throw new Error(`Unknown Agent Control surface: ${id}`);
  return surface;
}
