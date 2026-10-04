/**
 * The tool registry — every tool Ryn has, and the proof that none executes.
 *
 * Two lists and nothing else: the Research tools read, the Prepare tools
 * draft. `assertToolBoundary` is run by the registry test and at module load:
 * no tool has a kind other than the two, no tool's name carries a verb of
 * execution, and no tool module imports a signer, a submitter or a provider
 * client. `runTool` validates every argument against the tool's own schema
 * before the tool sees it, and never throws — a tool that failed is a run
 * with the outcome `unavailable`.
 */

import { PREPARE_TOOLS } from "./prepare.ts";
import { RESEARCH_TOOLS } from "./research.ts";
import { emptyRun, type RegisteredTool, type ToolContext, type ToolRun } from "./types.ts";

export const AGENT_TOOLS: readonly RegisteredTool[] = [...RESEARCH_TOOLS, ...PREPARE_TOOLS] as readonly RegisteredTool[];

/** Words a tool's name may never carry: the verbs of an execution. */
export const FORBIDDEN_TOOL_WORDS = ["sign", "submit", "broadcast", "transfer", "swap", "buy", "sell", "cancel", "approve", "claim", "execute", "send", "withdraw", "deposit", "stake", "mint", "burn", "bridge", "delegate", "revoke"] as const;

export function assertToolBoundary(tools: readonly RegisteredTool[] = AGENT_TOOLS): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (tool.kind !== "research" && tool.kind !== "prepare") throw new Error(`tool ${tool.name} has a kind the boundary does not allow: ${String(tool.kind)}`);
    const lower = tool.name.toLowerCase();
    for (const word of FORBIDDEN_TOOL_WORDS) {
      if (new RegExp(`(^|_)${word}(_|$)`).test(lower)) throw new Error(`tool ${tool.name} carries the verb "${word}"`);
    }
    if (names.has(tool.name)) throw new Error(`tool ${tool.name} is registered twice`);
    names.add(tool.name);
  }
}

assertToolBoundary();

export function findTool(name: string): RegisteredTool | null {
  return AGENT_TOOLS.find((tool) => tool.name === name) ?? null;
}

export function toolNames(kind: "research" | "prepare"): readonly string[] {
  return AGENT_TOOLS.filter((tool) => tool.kind === kind).map((tool) => tool.name);
}

/**
 * Run one tool by name on validated input. Unknown tool, invalid input or a
 * thrown failure all come back as a run — the answer then says what could
 * not be read, and the turn is still written.
 */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolRun> {
  const tool = findTool(name);
  if (!tool) return emptyRun(name, "research", "unavailable");
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return emptyRun(name, tool.kind, "refused");
  try {
    return await tool.run(parsed.data as never, ctx);
  } catch {
    return emptyRun(name, tool.kind, "unavailable", "unavailable");
  }
}
