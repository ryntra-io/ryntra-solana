/**
 * The one MCP write gate.
 *
 * Every write tool in `./write-tools.ts` passes through `admitMcpWrite` before
 * any body runs, and this module is the only place a write is admitted or
 * refused. The catalogue beside it is data; a test reads both from disk and
 * fails if this file branches on a tool name to decide *what a tool may do*,
 * or if the catalogue grows a resolver.
 *
 * ## Why the gate exists at all, given the tools are already narrow
 *
 * Because narrowness that lives in the caller is not a control. The Model
 * Context Protocol says so about its own annotations — *"clients MUST consider
 * tool annotations to be untrusted unless they come from trusted servers"* —
 * and its security section splits the guidance the same way: **servers MUST**
 * validate inputs, implement access controls, rate limit and sanitize, while
 * **clients SHOULD** prompt for user confirmation and show inputs to the user.
 * Every human-in-the-loop control in that document is a client `SHOULD`.
 *
 * `RYN-BIN-AOS-003` found the same thing empirically a session earlier: the
 * Binance MCP server ships a meta-tool that takes a tool name as a string, so
 * a client-side blocklist of tool names blocks nothing at all. The conclusion
 * both arrive at is the same one, and it is why this file exists rather than a
 * list of forbidden names in a client config.
 *
 * ## The order of the checks is load-bearing
 *
 * An input shaped to grant authority is refused **first**, before schema
 * shape, before the tool is even looked up. If it were refused later it would
 * come back as "unrecognized field" — and somebody would remove the field,
 * resend, and read the success as permission to keep going. Canon `04 §6` puts
 * unsupported action above budget for the same reason, and the 402 engine puts
 * provider capability above owner policy for the same reason: report the
 * structural refusal, not the incidental one.
 *
 * A caller-supplied endpoint is refused second, on the `RYN-SOL-A6` rule —
 * where a tool reaches is an operator decision, never a tool argument.
 *
 * Further down, the registry resolves before the tool's own allowlist for the
 * same family of reasons: *this action does not exist* outranks *this tool may
 * not propose it*, because the second sentence implies another tool could.
 *
 * ## What "admitted" means, and what it does not
 *
 * It means: this request may become one Ryntra record at `PROPOSE`. It does
 * not mean anything happens outside this process. There is no signer, no key,
 * no credential, no provider client and no network call in this module or any
 * module it imports.
 */

import {
  AGENT_CONTROL_REGISTRY,
  RegistryResolutionError,
  registryPin,
  resolveRegistryRef,
  type AgentActionClass,
  type RegistryPin,
} from "../registry.ts";
import {
  MCP_WRITE_PHASE,
  mcpWriteTool,
  type McpWriteEffect,
  type McpWriteOutputKind,
} from "./write-tools.ts";

export const MCP_WRITE_REFUSALS = [
  "OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER",
  "CALLER_SUPPLIED_ENDPOINT",
  "WRITE_INPUT_OUT_OF_BOUNDS",
  "WRITE_TOOL_NOT_REGISTERED",
  "ACTION_REF_REQUIRED_BY_TOOL",
  "ACTION_REF_NOT_ACCEPTED_BY_TOOL",
  "ACTION_NOT_ALLOWED_BY_TOOL",
  "ACTION_ADAPTER_NOT_ALLOWED_BY_TOOL",
  "ACTION_ADAPTER_NOT_READ_ONLY",
  "BUDGET_REQUIRED_BY_ACTION",
  "BUDGET_FORBIDDEN_BY_ACTION",
] as const;

export type McpWriteRefusal = (typeof MCP_WRITE_REFUSALS)[number];

export class McpWriteError extends Error {
  readonly reasonCode: McpWriteRefusal;

  constructor(reasonCode: McpWriteRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "McpWriteError";
    this.reasonCode = reasonCode;
  }
}

/**
 * Words that would make a request an attempt to hand Ryntra authority.
 *
 * These are matched against **segments of the caller's own object keys**, never
 * against values — a caller who writes prose containing the word "approval" is
 * writing prose, while a caller who sends `{ approval: true }` is trying to
 * decide something that is not theirs to decide.
 *
 * **Segments rather than whole keys, and that distinction is the packet's own
 * lesson turned on itself.** The first version of this list compared the whole
 * normalized key, so `authority` was refused and `ownerAuthority` sailed
 * through. A denylist that a rename defeats is precisely the shape
 * `RYN-BIN-AOS-003` proved worthless, and it was caught here by a fixture that
 * used the hyphenated spelling.
 *
 * `authentication` is deliberately absent. What a caller proved about itself
 * and what the owner decided are two axes in this product, and refusing the
 * first as if it were the second would collapse them at the door.
 */
const AUTHORITY_SHAPED_WORDS = new Set([
  "authorization",
  "authorisation",
  "authorized",
  "authorised",
  "authorize",
  "authorise",
  "authority",
  "approval",
  "approved",
  "approve",
  "mandate",
  "mandates",
  "grant",
  "granted",
  "consent",
  "signature",
  "signatures",
  "signed",
  "signer",
  "sign",
  "mnemonic",
  "keystore",
  "passphrase",
  "bearer",
  "credential",
  "credentials",
]);

/**
 * Adjacent segment pairs that are only dangerous together.
 *
 * `token` alone is an ordinary word in this product — an asset reference is a
 * token reference — so banning it outright would refuse honest requests and
 * teach callers to work around the gate. `accessToken` is a different thing.
 */
const AUTHORITY_SHAPED_PAIRS = [
  ["access", "token"],
  ["refresh", "token"],
  ["id", "token"],
  ["api", "key"],
  ["private", "key"],
  ["secret", "key"],
  ["seed", "phrase"],
] as const;

/**
 * Words that would let a caller choose where a tool reaches.
 *
 * The `RYN-SOL-A6` rule, restated for writes. The Solana kit asserts the same
 * absence over every published JSON Schema; this list is the runtime half, so
 * that a payload carrying one is refused by its own name rather than falling
 * through a schema that has not been written yet.
 */
const ENDPOINT_SHAPED_WORDS = new Set([
  "endpoint",
  "endpoints",
  "url",
  "urls",
  "uri",
  "host",
  "hostname",
  "origin",
  "rpc",
  "webhook",
  "webhooks",
  "callback",
  "proxy",
]);

const ENDPOINT_SHAPED_PAIRS = [
  ["base", "url"],
  ["service", "url"],
] as const;

/** Traversal budgets. A gate that can be exhausted by a large object is not a gate. */
const MAX_NODES = 4_000;
const MAX_DEPTH = 24;
const MAX_KEY_LENGTH = 128;

type ScanResult = {
  authorityKey: string | null;
  endpointKey: string | null;
  outOfBounds: boolean;
};

/**
 * Split one object key into lowercase words.
 *
 * `ownerAuthority`, `owner-authority`, `owner_authority` and `OWNER_AUTHORITY`
 * all become `["owner", "authority"]`, so a rename does not defeat the gate.
 */
function keyWords(key: string): readonly string[] {
  return key
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());
}

function matchWords(
  words: readonly string[],
  single: ReadonlySet<string>,
  pairs: readonly (readonly [string, string])[],
): string | null {
  for (const word of words) {
    if (single.has(word)) return word;
  }
  for (let index = 0; index + 1 < words.length; index += 1) {
    for (const [first, second] of pairs) {
      if (words[index] === first && words[index + 1] === second) return `${first}${second}`;
    }
  }
  return null;
}

/**
 * One bounded traversal that collects every class of problem, then lets the
 * caller decide precedence.
 *
 * Collecting first and deciding after is what makes the refusal deterministic:
 * "whichever offending key the traversal happened to reach first" would make
 * the reason code depend on object key order, which is not a property anybody
 * should have to reason about.
 */
function scanInput(value: unknown): ScanResult {
  const result: ScanResult = { authorityKey: null, endpointKey: null, outOfBounds: false };
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > MAX_NODES || current.depth > MAX_DEPTH) {
      result.outOfBounds = true;
      break;
    }

    if (Array.isArray(current.value)) {
      for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 });
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;

    for (const [key, entry] of Object.entries(current.value)) {
      if (key.length > MAX_KEY_LENGTH) {
        result.outOfBounds = true;
        continue;
      }
      const words = keyWords(key);
      const authority = matchWords(words, AUTHORITY_SHAPED_WORDS, AUTHORITY_SHAPED_PAIRS);
      if (authority !== null && result.authorityKey === null) result.authorityKey = authority;
      const endpoint = matchWords(words, ENDPOINT_SHAPED_WORDS, ENDPOINT_SHAPED_PAIRS);
      if (endpoint !== null && result.endpointKey === null) result.endpointKey = endpoint;
      stack.push({ value: entry, depth: current.depth + 1 });
    }
  }

  return result;
}

export type McpWriteRequest = Readonly<{
  tool: string;
  /** The caller's raw arguments, before any schema has looked at them. */
  input: unknown;
}>;

export type AdmittedMcpWrite = Readonly<{
  tool: string;
  effect: McpWriteEffect;
  produces: McpWriteOutputKind;
  phase: typeof MCP_WRITE_PHASE;
  actionRef: string | null;
  adapterRef: string | null;
  canonicalClass: AgentActionClass | null;
  pin: RegistryPin | null;
  /**
   * The owner-authorization state an admitted write may carry.
   *
   * A literal, not a field the caller or the tool can influence: this gate has
   * no code path that produces any other value, and a test asserts it over
   * every tool and every input in the suite.
   */
  ownerAuthorization: "NOT_REQUESTED";
}>;

function readOptionalRef(input: unknown, key: "actionRef"): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function hasBudget(input: unknown): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const value = (input as Record<string, unknown>).budget;
  return value !== undefined && value !== null;
}

/**
 * Admit one write, or refuse it by name.
 *
 * Throws `McpWriteError` for this gate's own refusals and lets
 * `RegistryResolutionError` through unchanged — a reference that is unknown,
 * retired, of the wrong kind or whose content hash does not match its pin is
 * the registry's refusal to make, and restating it here would create a second
 * vocabulary for one fact.
 */
export function admitMcpWrite(request: McpWriteRequest): AdmittedMcpWrite {
  const scan = scanInput(request.input);

  if (scan.authorityKey !== null) {
    throw new McpWriteError(
      "OWNER_AUTHORITY_NOT_ACCEPTED_FROM_CALLER",
      `a write carried the key class "${scan.authorityKey}"; authority is the owner's and is recorded elsewhere`,
    );
  }
  if (scan.endpointKey !== null) {
    throw new McpWriteError(
      "CALLER_SUPPLIED_ENDPOINT",
      `a write carried the key class "${scan.endpointKey}"; where a tool reaches is an operator decision`,
    );
  }
  if (scan.outOfBounds) {
    throw new McpWriteError(
      "WRITE_INPUT_OUT_OF_BOUNDS",
      "the write exceeded the traversal budget and was not read in full",
    );
  }

  const tool = mcpWriteTool(request.tool);
  if (!tool) {
    throw new McpWriteError("WRITE_TOOL_NOT_REGISTERED", "the catalogue carries no such write tool");
  }

  const requestedRef = readOptionalRef(request.input, "actionRef");

  if (tool.actionRefs.length === 0) {
    if (requestedRef !== null) {
      throw new McpWriteError(
        "ACTION_REF_NOT_ACCEPTED_BY_TOOL",
        `${tool.name} operates on an existing record whose action was pinned when it was created`,
      );
    }
    return Object.freeze({
      tool: tool.name,
      effect: tool.effect,
      produces: tool.produces,
      phase: tool.phase,
      actionRef: null,
      adapterRef: null,
      canonicalClass: null,
      pin: null,
      ownerAuthorization: "NOT_REQUESTED" as const,
    });
  }

  if (requestedRef === null) {
    throw new McpWriteError(
      "ACTION_REF_REQUIRED_BY_TOOL",
      `${tool.name} records what is being proposed and cannot infer it`,
    );
  }
  /* The registry resolves **before** the tool's allowlist is consulted, and the
     order is deliberate. Told "this tool does not allow that action" about a
     reference that exists nowhere, a caller reasonably infers some other tool
     allows it. *Nobody can* outranks *you may not* — the same precedence the
     402 engine gives provider capability over owner policy, and canon `04 §6`
     gives an unsupported action over a budget. */
  const action = resolveRegistryRef(AGENT_CONTROL_REGISTRY, requestedRef, "ACTION_SCHEMA");

  if (!tool.actionRefs.includes(requestedRef)) {
    throw new McpWriteError(
      "ACTION_NOT_ALLOWED_BY_TOOL",
      `${tool.name} allows ${tool.actionRefs.length} action reference(s) and this is not one of them`,
    );
  }

  /* Two independent allowlists rather than one derived from the other. An
     action added under an allowlisted adapter tomorrow must not become
     proposable by inheriting a permission nobody granted it. */
  if (!tool.adapterRefs.includes(action.adapterRef)) {
    throw new McpWriteError(
      "ACTION_ADAPTER_NOT_ALLOWED_BY_TOOL",
      `${tool.name} does not accept actions belonging to that adapter`,
    );
  }

  const adapter = resolveRegistryRef(AGENT_CONTROL_REGISTRY, action.adapterRef, "ADAPTER");
  if (adapter.capability !== "READ_ONLY") {
    throw new McpWriteError(
      "ACTION_ADAPTER_NOT_READ_ONLY",
      "a write may only propose against an adapter that observes; nothing here executes",
    );
  }

  const budgetSupplied = hasBudget(request.input);
  if (action.budget === "REQUIRED" && !budgetSupplied) {
    throw new McpWriteError(
      "BUDGET_REQUIRED_BY_ACTION",
      "this action commits or moves value and cannot be proposed without a declared budget",
    );
  }
  if (action.budget === "FORBIDDEN" && budgetSupplied) {
    throw new McpWriteError(
      "BUDGET_FORBIDDEN_BY_ACTION",
      "this action records rather than spends; a budget on it would be a decision nobody made",
    );
  }

  return Object.freeze({
    tool: tool.name,
    effect: tool.effect,
    produces: tool.produces,
    phase: tool.phase,
    actionRef: action.ref,
    adapterRef: action.adapterRef,
    canonicalClass: action.canonicalClass,
    pin: registryPin(AGENT_CONTROL_REGISTRY, [action.ref, action.adapterRef]),
    ownerAuthorization: "NOT_REQUESTED" as const,
  });
}

/**
 * The refusal a caller sees, with no caller input echoed back.
 *
 * `RegistryResolutionError` keeps its own code; anything unexpected collapses
 * to one opaque value rather than leaking a stack or a message somebody else
 * wrote.
 */
export function mcpWriteRefusal(error: unknown): string {
  if (error instanceof McpWriteError) return error.reasonCode;
  if (error instanceof RegistryResolutionError) return error.reasonCode;
  return "WRITE_REFUSED";
}
