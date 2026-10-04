import { createHash } from "node:crypto";

import { z } from "zod";

import type { GuardStore } from "../../guard/store.ts";
import { AGENT_CONTROL_SCOPES, type AgentControlScope } from "../tenancy.ts";
import { MCP_READ_TOOLS } from "./current.ts";
import { MCP_WRITE_TOOLS } from "./write-tools.ts";

/**
 * The hosted MCP inventory, and the gate that answers before any handler runs.
 *
 * The stdio server carries twelve tools, and its only caller is the person who
 * started the process. This endpoint is reachable from the internet by anyone
 * holding a token, so two things change and nothing else does.
 *
 * **The inventory is smaller, and the cut is a property rather than a
 * preference.** Four of the seven read tools reach an upstream provider —
 * Agentverse, the Agent Launch list, BNB APEX. On a local server that is the
 * operator spending their own network; on a hosted one it would make Ryntra a
 * proxy that fetches on a stranger's behalf, which is an amplifier and an
 * outbound surface nobody asked for. So the hosted inventory is exactly the
 * tools that touch nothing outside this process: three local previews and the
 * five writes, each of which produces a proposal and reaches no provider by
 * construction. **The hosted endpoint makes no outbound call on a caller's
 * behalf**, which is the same rule the write gate applies to endpoints in tool
 * input, one layer out.
 *
 * **Scope is enforced at call time, not by filtering a list.** `tools/list` is
 * filtered because an inventory a caller cannot use is noise, but the filter is
 * an ergonomic, never the control. Binance's own MCP server is the proof: it
 * publishes a `tool_execute` that takes a tool name as a string, so any
 * client-side list of forbidden names is defeated by one indirection. A caller
 * who has read this source, guessed a name, or kept a name from a token with
 * wider scope calls it and is refused here.
 *
 * **The precedence is the write gate's.** *Nobody can* outranks *you may
 * not*: a name this endpoint does not host is `TOOL_NOT_HOSTED` even for a
 * token holding every scope, because telling a caller they lack a scope for a
 * tool that exists nowhere says a tool exists.
 */

export const HOSTED_MCP_REFUSALS = [
  "TOOL_NOT_HOSTED",
  "SCOPE_NOT_GRANTED",
] as const;

export type HostedMcpRefusal = (typeof HOSTED_MCP_REFUSALS)[number];

/**
 * The three read tools that resolve entirely inside this process.
 *
 * Kept as an explicit list checked against `MCP_READ_TOOLS` rather than derived
 * by excluding names that look upstream: a new read tool must be classified by
 * a person, and the test below fails on any read name this list has not
 * decided about.
 */
export const HOSTED_LOCAL_READ_TOOLS = Object.freeze([
  "draft_agent_action_intent",
  "run_agent_action_preflight",
  "verify_action_passport_preview",
]);

/** The read tools deliberately withheld, with the reason attached to each. */
export const WITHHELD_UPSTREAM_READ_TOOLS = Object.freeze([
  Object.freeze({ name: "inspect_agentverse_agent", reason: "Reads Agentverse on the caller's behalf." }),
  Object.freeze({ name: "list_agent_launch_testnet_tokens", reason: "Reads the Agent Launch list on the caller's behalf." }),
  Object.freeze({ name: "inspect_agent_launch_testnet_token", reason: "Reads one Agent Launch record on the caller's behalf." }),
  Object.freeze({ name: "observe_bnb_apex_testnet_job", reason: "Reads BNB APEX on the caller's behalf." }),
]);

export type HostedMcpTool = Readonly<{
  name: string;
  scope: AgentControlScope;
  kind: "READ" | "WRITE";
}>;

export const HOSTED_MCP_TOOLS: readonly HostedMcpTool[] = Object.freeze([
  ...HOSTED_LOCAL_READ_TOOLS.map(
    (name) => Object.freeze({ name, scope: "evidence:read", kind: "READ" }) as HostedMcpTool,
  ),
  ...MCP_WRITE_TOOLS.map(
    (tool) => Object.freeze({ name: tool.name, scope: "proposal:write", kind: "WRITE" }) as HostedMcpTool,
  ),
]);

const BY_NAME = new Map(HOSTED_MCP_TOOLS.map((tool) => [tool.name, tool]));

export function hostedMcpTool(name: string): HostedMcpTool | null {
  return BY_NAME.get(name) ?? null;
}

/** The complete local inventory a hosted name must belong to. */
export function localMcpToolNames(): readonly string[] {
  return Object.freeze([...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS.map((tool) => tool.name)]);
}

export type HostedAdmission =
  | Readonly<{ admitted: true; tool: HostedMcpTool }>
  | Readonly<{ admitted: false; reasonCode: HostedMcpRefusal; requiredScope: AgentControlScope | null }>;

export function admitHostedToolCall(
  toolName: string,
  scopes: readonly AgentControlScope[],
): HostedAdmission {
  const tool = hostedMcpTool(toolName);
  if (!tool) return { admitted: false, reasonCode: "TOOL_NOT_HOSTED", requiredScope: null };
  if (!scopes.includes(tool.scope)) {
    return { admitted: false, reasonCode: "SCOPE_NOT_GRANTED", requiredScope: tool.scope };
  }
  return { admitted: true, tool };
}

export function hostedToolsFor(scopes: readonly AgentControlScope[]): readonly HostedMcpTool[] {
  return HOSTED_MCP_TOOLS.filter((tool) => scopes.includes(tool.scope));
}

export function hostedRefusalMessage(admission: Extract<HostedAdmission, { admitted: false }>): string {
  return admission.reasonCode === "TOOL_NOT_HOSTED"
    ? "This endpoint hosts no tool by that name."
    : `This token does not carry ${admission.requiredScope}.`;
}

/* ── the receipt every accepted call leaves ────────────────────────────── */

const timestamp = z.string().datetime({ offset: true });

export const HostedCallReceiptSchema = z
  .object({
    version: z.number().int().nonnegative(),
    receiptId: z.string().min(8).max(128),
    tenantId: z.string().min(1).max(64),
    clientId: z.string().min(1).max(64),
    grantId: z.string().min(1).max(64),
    toolName: z.string().min(1).max(96),
    scope: z.enum(AGENT_CONTROL_SCOPES),
    outcome: z.enum(["ACCEPTED", "REFUSED"]),
    /* The exact refusal, or null when the call was admitted. Never a boolean:
       "it failed" is not a reason, and the reason is the whole point. */
    reasonCode: z.string().min(1).max(64).nullable(),
    /** SHA-256 of the canonical arguments. The arguments themselves are a
     * caller's business data and are not copied into a Ryntra record. */
    argumentsDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    at: timestamp,
  })
  .strict();

export type HostedCallReceipt = z.output<typeof HostedCallReceiptSchema>;

export function digestArguments(value: unknown): string {
  return `0x${createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex")}`;
}

/**
 * Write one receipt per hosted tool call.
 *
 * Refusals are recorded too. A log of only the calls that worked answers "what
 * did this tenant do" and not "what did this tenant try", and the second
 * question is the one an operator asks after something goes wrong.
 *
 * The receipt carries a digest of the arguments rather than the arguments. A
 * proposal's contents belong to the tenant who wrote it and already live in the
 * proposal ledger; copying them into an audit row would duplicate a caller's
 * data into a second retention surface for no evidentiary gain.
 */
export async function recordHostedCallReceipt(
  store: GuardStore,
  input: Readonly<{
    receiptId: string;
    tenantId: string;
    clientId: string;
    grantId: string;
    toolName: string;
    scope: AgentControlScope;
    outcome: "ACCEPTED" | "REFUSED";
    reasonCode: string | null;
    args: unknown;
    atMs: number;
  }>,
): Promise<HostedCallReceipt> {
  const receipt = HostedCallReceiptSchema.parse({
    version: 0,
    receiptId: input.receiptId,
    tenantId: input.tenantId,
    clientId: input.clientId,
    grantId: input.grantId,
    toolName: input.toolName,
    scope: input.scope,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    argumentsDigest: digestArguments(input.args),
    at: new Date(input.atMs).toISOString(),
  });
  /* `insertIfAbsent` under a tenant-prefixed key: the audit trail is
     append-only because there is no code path that overwrites one, which is the
     same guarantee `store.ts` gives the lifecycle audit and for the same
     reason. */
  await store
    .collection<HostedCallReceipt>("agentMcpReceipts")
    .insertIfAbsent(`${input.tenantId}:${input.receiptId}`, receipt);
  return receipt;
}

export function readHostedCallReceipts(
  store: GuardStore,
  tenantId: string,
): Promise<readonly HostedCallReceipt[]> {
  return store.collection<HostedCallReceipt>("agentMcpReceipts").valuesWithPrefix(`${tenantId}:`);
}
