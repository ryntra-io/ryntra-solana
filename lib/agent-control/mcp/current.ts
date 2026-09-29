/**
 * What the agent-tools surface can honestly show today.
 *
 * Every verdict below is produced by running the real gate and the real A2A
 * mirror over real inputs. Nothing here is a hand-written status: if the gate
 * changes its mind, this projection changes with it, which is the only way a
 * page can state a refusal without becoming a second source of truth.
 *
 * It is computed on the server because the gate reaches the hash-pinned
 * registry, which hashes with `node:crypto`. The browser gets the answers, not
 * the ability to produce new ones.
 */

import {
  A2A_CALLER_AUTHENTICATION,
  A2A_TASK_STATES,
  A2A_TERMINAL_STATES,
  A2aIngestError,
  RYNTRA_OWNER_AUTHORIZATION,
  ingestA2aTask,
  type A2aCallerAuthentication,
  type A2aTaskState,
  type RyntraOwnerAuthorization,
} from "../a2a/inbound.ts";
import { A2A_INBOUND_TASK_ACTION_REF } from "../adapters/a2a.ts";
import { AGENT_CONTROL_REGISTRY, resolveRegistryRef } from "../registry.ts";
import { PROPOSAL_LEDGER_CAPACITY, PROPOSAL_MAX_EVIDENCE } from "./proposal-ledger.ts";
import { admitMcpWrite, mcpWriteRefusal } from "./write-gate.ts";
import { MCP_WRITE_TOOLS, type McpWriteToolDefinition } from "./write-tools.ts";

/** The seven read tools the local server has carried since the Developer Kit. */
export const MCP_READ_TOOLS = Object.freeze([
  "draft_agent_action_intent",
  "inspect_agentverse_agent",
  "list_agent_launch_testnet_tokens",
  "inspect_agent_launch_testnet_token",
  "run_agent_action_preflight",
  "verify_action_passport_preview",
  "observe_bnb_apex_testnet_job",
]);

const SAMPLE_CARD = Object.freeze({
  name: "Counterparty research agent",
  protocolVersion: "1.0.0",
  version: "2.4.0",
  skills: Object.freeze(["market-research", "filing-summary"]),
  cardAuthenticity: "ASSERTED_UNVERIFIED" as const,
});

export type ToolProjection = Readonly<{
  name: string;
  title: string;
  kind: "READ" | "WRITE";
  effect: string;
  produces: string;
  /** How many registry actions this tool may name. `0` means it names none. */
  actionCount: number;
  /** The canonical classes those actions belong to, deduplicated. */
  classes: readonly string[];
  limitations: readonly string[];
}>;

function projectWriteTool(tool: McpWriteToolDefinition): ToolProjection {
  const classes = new Set<string>();
  for (const ref of tool.actionRefs) {
    classes.add(resolveRegistryRef(AGENT_CONTROL_REGISTRY, ref, "ACTION_SCHEMA").canonicalClass);
  }
  return Object.freeze({
    name: tool.name,
    title: tool.title,
    kind: "WRITE" as const,
    effect: tool.effect,
    produces: tool.produces,
    actionCount: tool.actionRefs.length,
    classes: Object.freeze([...classes].sort()),
    limitations: tool.limitations,
  });
}

export type RefusalProbe = Readonly<{
  id: string;
  /** What the caller tried, in a person's words. */
  attempt: string;
  reasonCode: string;
  /** Why this refusal and not another one. */
  because: string;
}>;

/** One real gate call per probe. A hand-written reason code here would be a lie. */
function probe(id: string, attempt: string, because: string, tool: string, input: unknown): RefusalProbe {
  let reasonCode = "ADMITTED";
  try {
    admitMcpWrite({ tool, input });
  } catch (error) {
    reasonCode = mcpWriteRefusal(error);
  }
  return Object.freeze({ id, attempt, reasonCode, because });
}

const CREATE_DRAFT = "action:bnb-apex/create-job-draft@1";

function refusalProbes(): readonly RefusalProbe[] {
  return Object.freeze([
    probe(
      "authority",
      "A field that grants authority",
      "Refused first, before the tool is even looked up. Later it would come back as an unrecognised field, and dropping the field would read as permission.",
      "propose_action",
      { actionRef: CREATE_DRAFT, ownerAuthority: "GRANTED" },
    ),
    probe(
      "endpoint",
      "An endpoint of the caller's choosing",
      "Where a tool reaches is an operator decision, never a tool argument.",
      "propose_action",
      { actionRef: CREATE_DRAFT, endpoint: "http://169.254.169.254/latest" },
    ),
    probe(
      "meta-tool",
      "A tool that runs a tool by name",
      "The catalogue is closed and the dispatch is a switch. A name that is not in it reaches nothing.",
      "tool_execute",
      { name: "propose_action" },
    ),
    probe(
      "unknown-action",
      "An action reference that does not exist",
      "The registry answers before the allowlist does: nobody can outranks you may not.",
      "propose_action",
      { actionRef: "action:bnb-apex/create-job-draft@9" },
    ),
    probe(
      "foreign-action",
      "A real action this tool does not allow",
      "Two independent allowlists. An action added under an allowlisted adapter tomorrow inherits nothing.",
      "propose_action",
      { actionRef: "action:demo/transfer@1" },
    ),
    probe(
      "budget",
      "A value-committing action with no budget",
      "The registry entry carries the budget rule, so a new action arrives with its own rather than inheriting one.",
      "propose_action",
      { actionRef: "action:bnb-apex/fund-job@1" },
    ),
  ]);
}

export type A2aOutcome = Readonly<{
  state: A2aTaskState;
  class: "OPEN" | "INTERRUPTED" | "TERMINAL" | "REFUSED";
  /** What Ryntra ends up holding. Never a Receipt, never an authorization. */
  produces: string;
  event: string | null;
  ownerAuthorization: RyntraOwnerAuthorization | null;
  promotes: string;
}>;

function a2aOutcomes(): readonly A2aOutcome[] {
  return Object.freeze(A2A_TASK_STATES.map((state) => {
    const terminal = (A2A_TERMINAL_STATES as readonly string[]).includes(state);
    try {
      const proposal = ingestA2aTask({
        actionRef: A2A_INBOUND_TASK_ACTION_REF,
        task: {
          id: "task-sample",
          contextId: "ctx-sample",
          state,
          artifacts: [],
          terminalResult: terminal ? "the counterparty returned a summary" : null,
        },
        agentCard: SAMPLE_CARD,
        callerAuthentication: "UNAUTHENTICATED",
      });
      return Object.freeze({
        state,
        class: proposal.taskStateClass,
        produces: proposal.kind,
        event: proposal.event,
        ownerAuthorization: proposal.ownerAuthorization,
        promotes: "nothing",
      });
    } catch (error) {
      return Object.freeze({
        state,
        class: "REFUSED" as const,
        produces: error instanceof A2aIngestError ? error.reasonCode : "REFUSED",
        event: null,
        ownerAuthorization: null,
        promotes: "nothing",
      });
    }
  }));
}

export type AxisCell = Readonly<{
  authentication: A2aCallerAuthentication;
  state: A2aTaskState;
  authorization: RyntraOwnerAuthorization;
}>;

/**
 * The two axes, crossed and run through the real mirror.
 *
 * A2A §7.6.1 lets an agent resume work the moment a credential arrives. This
 * grid is what refusing that looks like: the columns move and the values do not.
 */
function authorizationGrid(): readonly AxisCell[] {
  const states: readonly A2aTaskState[] = ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_AUTH_REQUIRED"];
  const cells: AxisCell[] = [];
  for (const authentication of A2A_CALLER_AUTHENTICATION) {
    for (const state of states) {
      const proposal = ingestA2aTask({
        actionRef: A2A_INBOUND_TASK_ACTION_REF,
        task: { id: "task-sample", contextId: null, state, artifacts: [], terminalResult: null },
        agentCard: SAMPLE_CARD,
        callerAuthentication: authentication,
      });
      cells.push(Object.freeze({ authentication, state, authorization: proposal.ownerAuthorization }));
    }
  }
  return Object.freeze(cells);
}

export type AgentToolsSurface = Readonly<{
  tools: readonly ToolProjection[];
  readCount: number;
  writeCount: number;
  effects: readonly string[];
  probes: readonly RefusalProbe[];
  outcomes: readonly A2aOutcome[];
  grid: readonly AxisCell[];
  authorizationLadder: readonly RyntraOwnerAuthorization[];
  /** The rungs this surface can reach. Drawn against the full ladder. */
  reachableAuthorization: readonly RyntraOwnerAuthorization[];
  ledger: Readonly<{ capacity: number; maxEvidence: number }>;
  blockers: readonly string[];
}>;

export const AGENT_TOOLS_BLOCKERS = Object.freeze([
  "The proposal ledger lives in the MCP server process. Stopping the server loses it, and there is no durable queue, no database and no shared state behind it.",
  "No owner can authorize anything from this surface or from any tool. AUTHORIZE is closed elsewhere, by a person, and this packet did not build that path.",
  "Nothing here calls another agent. A2A ingestion reads a payload a caller supplies; no Agent Card is fetched, no task is created, no stream is opened.",
  "No Agent Card signature is checked. A2A 1.0 §8.4 allows a JWS block and Ryntra records only whether one is present, because verifying it needs an issuer key and a reason to trust it.",
]);

export function buildAgentToolsSurface(): AgentToolsSurface {
  const writes = MCP_WRITE_TOOLS.map(projectWriteTool);
  const reads: readonly ToolProjection[] = Object.freeze(MCP_READ_TOOLS.map((name) => Object.freeze({
    name,
    title: name.replace(/_/g, " "),
    kind: "READ" as const,
    effect: "READ_ONLY",
    produces: "OBSERVATION",
    actionCount: 0,
    classes: Object.freeze([]),
    limitations: Object.freeze(["Reads or computes. Writes nothing, anywhere."]),
  })));

  const grid = authorizationGrid();
  const outcomes = a2aOutcomes();

  return Object.freeze({
    tools: Object.freeze([...reads, ...writes]),
    readCount: reads.length,
    writeCount: writes.length,
    effects: Object.freeze([...new Set(writes.map((tool) => tool.effect))]),
    probes: refusalProbes(),
    outcomes,
    grid,
    authorizationLadder: RYNTRA_OWNER_AUTHORIZATION,
    reachableAuthorization: Object.freeze(
      [...new Set([
        ...grid.map((cell) => cell.authorization),
        ...outcomes.map((outcome) => outcome.ownerAuthorization).filter((value): value is RyntraOwnerAuthorization => value !== null),
      ])].sort(),
    ),
    ledger: Object.freeze({ capacity: PROPOSAL_LEDGER_CAPACITY, maxEvidence: PROPOSAL_MAX_EVIDENCE }),
    blockers: AGENT_TOOLS_BLOCKERS,
  });
}
