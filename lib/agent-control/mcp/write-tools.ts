/**
 * The closed catalogue of MCP write tools, as data.
 *
 * Every admission decision about these lives in `./write-gate.ts`. This file
 * declares what exists and nothing else, the same split
 * `payments/implementations.ts` and `payments/x402-engine.ts` use, and a test
 * reads both from disk and fails if either grows the other's job.
 *
 * ## Why a "write tool" is a safe phrase here
 *
 * Canon `12 §10` gives Ryntra's MCP surface three roles — READ, PROPOSE, and
 * EXECUTE **only** behind a separate release gate and a bounded mandate
 * contract. That gate has not opened. So a write here writes to Ryntra's own
 * decision record and to nothing else: no provider, no chain, no facilitator,
 * no wallet. The record it produces sits at `PROPOSE` and waits for a person.
 *
 * ## The effect vocabulary has one member, and that is the design
 *
 * `MCP_WRITE_EFFECTS` is a union of exactly one value. A tool that signed
 * something would need an effect value to carry, and there is none — so a
 * generic signing tool is not *forbidden* here, it is **unrepresentable**.
 *
 * That distinction is the packet's whole argument and it is not pedantry.
 * `RYN-BIN-AOS-003` proved the alternative fails: the Binance MCP server ships
 * a meta-tool that takes a tool name as a string, so a client-side blocklist of
 * names blocks nothing. The MCP specification says the same thing about itself
 * — *"clients MUST consider tool annotations to be untrusted"* — and splits its
 * own security guidance so that every hard control is a server `MUST` while
 * every human-in-the-loop control is a client `SHOULD`. A boundary that depends
 * on the caller behaving is not a boundary.
 *
 * ## Why each tool names its actions rather than accepting any
 *
 * `propose_action(actionRef)` and a meta-tool are superficially alike:
 * both take a selector. What separates them is that the meta-tool's *outcome*
 * varies with the selector, while here the outcome is the same object every
 * time — a proposal — and the ref is data recorded inside it. A test enumerates
 * this catalogue and fails if any entry's `produces` differs from any other's.
 */

import { A2A_ADAPTER_REF, A2A_INBOUND_TASK_ACTION_REF } from "../adapters/a2a.ts";

/**
 * Everything an MCP write may do in this product.
 *
 * One member. Adding a second is a canon change with its own founder decision,
 * not a code edit, and the test that pins the length says so.
 */
export const MCP_WRITE_EFFECTS = ["PROPOSAL_ONLY"] as const;

export type McpWriteEffect = (typeof MCP_WRITE_EFFECTS)[number];

/** The one kind of record a write can produce. Also a union of one, also on purpose. */
export const MCP_WRITE_OUTPUT_KINDS = ["AGENT_CONTROL_PROPOSAL"] as const;

export type McpWriteOutputKind = (typeof MCP_WRITE_OUTPUT_KINDS)[number];

/**
 * The lifecycle phase a write may leave a record in.
 *
 * `PROPOSE` only. `VERIFY` is Ryntra's own evaluation and `AUTHORIZE` is the
 * owner's decision; neither is reachable from a tool call, which is why this is
 * a literal rather than a parameter.
 */
export const MCP_WRITE_PHASE = "PROPOSE" as const;

export type McpWriteToolDefinition = Readonly<{
  name: string;
  title: string;
  /** What a caller is actually asking for, in one sentence, without a verb it cannot perform. */
  summary: string;
  effect: McpWriteEffect;
  produces: McpWriteOutputKind;
  phase: typeof MCP_WRITE_PHASE;
  /**
   * The exact registry action references this tool may name.
   *
   * Empty means the tool names no action at all — it operates on a record that
   * already exists, and the action was pinned when that record was created.
   */
  actionRefs: readonly string[];
  /**
   * The exact registry adapter references those actions must belong to.
   *
   * A second, independent allowlist rather than something derived from the
   * first: an action added to an allowlisted adapter tomorrow must not become
   * proposable because it inherited a permission nobody granted it.
   */
  adapterRefs: readonly string[];
  /** What this tool cannot do, in the words a reader needs, not the words a lawyer needs. */
  limitations: readonly string[];
}>;

const BNB_APEX_ADAPTER_REF = "adapter:bnb-apex@1";

const COMMON_LIMITATIONS = [
  "Writes one Ryntra record. Reaches no provider, chain, facilitator or wallet.",
  "Cannot authorize, approve, mandate or sign. There is no effect value for any of those.",
] as const;

export const MCP_WRITE_TOOLS: readonly McpWriteToolDefinition[] = Object.freeze([
  {
    /* `propose_`, not `submit_`. The existing server suite bans `submit_`
       across the inventory, and it is right to: "submit" means submitting work
       or a transaction in both ERC-8183 and A2A, and this tool does neither. It
       also reads better — the name now says which lifecycle phase the record
       lands in. */
    name: "propose_action",
    title: "Propose one bounded action",
    summary:
      "Record a proposed action against one allowlisted registry reference, at PROPOSE, awaiting a person.",
    effect: "PROPOSAL_ONLY",
    produces: "AGENT_CONTROL_PROPOSAL",
    phase: MCP_WRITE_PHASE,
    /* The four BNB APEX subtypes, including the two that commit and release
       value. Proposing a value-committing action is exactly what this product
       is for; the refusal that matters is not "you may not ask", it is that
       asking never becomes permission. */
    actionRefs: [
      "action:bnb-apex/create-job-draft@1",
      "action:bnb-apex/fund-job@1",
      "action:bnb-apex/submit-work@1",
      "action:bnb-apex/settle-job@1",
    ],
    adapterRefs: [BNB_APEX_ADAPTER_REF],
    limitations: COMMON_LIMITATIONS,
  },
  {
    name: "attach_proposal_evidence",
    title: "Attach evidence to a proposal",
    summary:
      "Add source-labelled evidence references to a proposal this ledger already holds.",
    effect: "PROPOSAL_ONLY",
    produces: "AGENT_CONTROL_PROPOSAL",
    phase: MCP_WRITE_PHASE,
    actionRefs: [],
    adapterRefs: [],
    limitations: [
      ...COMMON_LIMITATIONS,
      "Evidence is recorded with its source, never merged into a verdict.",
    ],
  },
  {
    name: "request_human_review",
    title: "Ask for a person to look",
    summary:
      "Mark a proposal as waiting on a human. The request is the whole effect; nothing advances.",
    effect: "PROPOSAL_ONLY",
    produces: "AGENT_CONTROL_PROPOSAL",
    phase: MCP_WRITE_PHASE,
    actionRefs: [],
    adapterRefs: [],
    limitations: [
      ...COMMON_LIMITATIONS,
      "Requesting review does not move the record past PROPOSE. Only the owner does that, elsewhere.",
    ],
  },
  {
    /* `retract_`, not `withdraw_`. In a product about programmable assets,
       "withdraw" already means taking funds out of something, and the existing
       server suite bans that prefix across the whole tool inventory. The right
       response to a name tripwire is a clearer name, never a weaker tripwire —
       the same reasoning that gave Binance B402 and Vistara B402 separate route
       ids instead of one label with a note. */
    name: "retract_proposal",
    title: "Retract a proposal",
    summary: "Retract a proposal this ledger holds, leaving the record and its reason in place.",
    effect: "PROPOSAL_ONLY",
    produces: "AGENT_CONTROL_PROPOSAL",
    phase: MCP_WRITE_PHASE,
    actionRefs: [],
    adapterRefs: [],
    limitations: [
      ...COMMON_LIMITATIONS,
      "Retraction is recorded, not erased: a proposal that existed keeps existing.",
    ],
  },
  {
    name: "ingest_a2a_task",
    title: "Record one inbound A2A task",
    summary:
      "Turn an inbound A2A 1.0 task and its Agent Card into a proposal, with what the caller proved kept apart from what the owner decided.",
    effect: "PROPOSAL_ONLY",
    produces: "AGENT_CONTROL_PROPOSAL",
    phase: MCP_WRITE_PHASE,
    actionRefs: [A2A_INBOUND_TASK_ACTION_REF],
    adapterRefs: [A2A_ADAPTER_REF],
    limitations: [
      ...COMMON_LIMITATIONS,
      "A2A 1.0 §7.6.4: reaching TASK_STATE_AUTH_REQUIRED is not authorization for any operation.",
      "A completed A2A task promotes nothing — no Receipt, no MATCHED, no change of authorization.",
    ],
  },
]);

const BY_NAME = new Map(MCP_WRITE_TOOLS.map((tool) => [tool.name, tool]));

/** The catalogue lookup. `null` rather than a throw: the gate owns the refusal vocabulary. */
export function mcpWriteTool(name: string): McpWriteToolDefinition | null {
  return BY_NAME.get(name) ?? null;
}

export const MCP_WRITE_TOOL_NAMES: readonly string[] = Object.freeze(
  MCP_WRITE_TOOLS.map((tool) => tool.name),
);
