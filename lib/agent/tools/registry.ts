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

import { MARKET_DATA_TOOLS } from "./market-data.ts";
import { NEWS_TOOLS } from "./news.ts";
import { PREPARE_TOOLS } from "./prepare.ts";
import { RESEARCH_TOOLS } from "./research.ts";
import { emptyRun, type RegisteredTool, type ToolContext, type ToolRun } from "./types.ts";

export const AGENT_TOOLS: readonly RegisteredTool[] = [...RESEARCH_TOOLS, ...MARKET_DATA_TOOLS, ...NEWS_TOOLS, ...PREPARE_TOOLS] as readonly RegisteredTool[];

/** Words a tool's name may never carry: the verbs and nouns of an execution, of a spend and of a key. */
export const FORBIDDEN_TOOL_WORDS = [
  "sign", "submit", "broadcast", "transfer", "swap", "buy", "sell", "cancel", "approve", "claim", "execute", "send", "withdraw", "deposit", "stake", "mint", "burn", "bridge", "delegate", "revoke",
  /* AI-02: the rest of PLAN §12 and their neighbours — an order placed, a payment, an allowance, a key exported, a position closed. */
  "order", "place", "pay", "spend", "allowance", "permit", "seed", "key", "private", "export", "drain", "sweep", "liquidat", "close", "unlock", "borrow", "lend", "repay", "redeem", "settle", "fund",
  /* AI-04: credits are given, held and spent by the service alone — never by a tool the model may name. */
  "credit", "grant", "charge", "purchase", "refund", "topup",
] as const;

/** A tool's name is plain ASCII snake case: any other spelling — camelCase, kebab, dots, spaces, look-alike letters — is refused before the words are read. */
export const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const LOOK_ALIKE_DIGITS: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/**
 * The name as one run of letters: lower case, every separator gone, the
 * digits that stand in for letters read as those letters — so `executeSwap`,
 * `place-order`, `sign.transaction`, `s1gn_tx` and `signtransaction` all
 * meet the same words.
 */
export function compactToolName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[0-9]/g, (digit) => LOOK_ALIKE_DIGITS[digit] ?? digit)
    .replace(/[^a-z]/g, "");
}

/** The forbidden words a name carries in any spelling; empty when it carries none. */
export function forbiddenWordsIn(name: string): readonly string[] {
  const compact = compactToolName(name);
  return FORBIDDEN_TOOL_WORDS.filter((word) => compact.includes(word));
}

export function assertToolBoundary(tools: readonly RegisteredTool[] = AGENT_TOOLS): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (tool.kind !== "research" && tool.kind !== "prepare") throw new Error(`tool ${tool.name} has a kind the boundary does not allow: ${String(tool.kind)}`);
    if (!TOOL_NAME.test(tool.name)) throw new Error(`tool ${tool.name} is not named in plain snake case`);
    const words = forbiddenWordsIn(tool.name);
    if (words.length > 0) throw new Error(`tool ${tool.name} carries the verb "${words[0]}"`);
    if (names.has(tool.name)) throw new Error(`tool ${tool.name} is registered twice`);
    names.add(tool.name);
  }
}

assertToolBoundary();

export function findTool(name: string): RegisteredTool | null {
  /* A name in any other spelling, or one that carries a forbidden word, is no tool — whatever asked for it. */
  if (!TOOL_NAME.test(name) || forbiddenWordsIn(name).length > 0) return null;
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
