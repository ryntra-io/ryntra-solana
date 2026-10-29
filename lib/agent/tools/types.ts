/**
 * The shape of a tool.
 *
 * A tool is one of two kinds and nothing else: `research` reads through an
 * existing service and returns what it read with its provenance; `prepare`
 * returns a draft in the contract's own schema — a plan's rules, a condition,
 * a trade intention — that opens on the existing surface where the person
 * decides. There is no third kind. Nothing here signs, submits, broadcasts,
 * transfers, swaps, buys, sells, cancels, approves or claims, and the
 * registry test proves it by name and by effect (`registry.ts`).
 *
 * Every tool takes its input through a zod schema, so an argument the model
 * or the parser produced is validated before it reaches a service; every
 * figure it returns carries a citation (`provenance.ts`).
 */

import type { z } from "zod";

import type { AgentCard, AgentCitation, AgentHandoff, AgentState } from "../../api/v1/contract.ts";
import type { CitationBook, Locale } from "../provenance.ts";
import type { AgentReaders } from "./readers.ts";

export type ToolKind = "research" | "prepare";

/** A fact a tool established: the words for a person, the figure behind them, its state and the citation. */
export type ToolFact = Readonly<{
  /** A stable key the composer can pick a fact by (`price`, `liquidity`, `plan.status`). */
  key: string;
  label: string;
  value: string;
  number: number | null;
  unit: string | null;
  state: AgentState;
  cite: string;
}>;

/** A sentence a tool wrote for the composer, with the citations it stands on — the deterministic composer prints these; a model may reword them and must keep the citations. */
export type ToolNote = Readonly<{
  text: string;
  cites: readonly string[];
  section: "observation" | "meaning" | "counter" | "risks" | "checks" | "actions";
  /**
   * AI-09: the sentence carries a third party's words — a headline. It reaches
   * the model in a block of its own marked as untrusted, and the figures in it
   * hold a model only in a sentence that cites it (`answer.ts`).
   */
  quote?: true;
  /** AI-09: on a line of «What moved the price?», its mark — the model is handed it and keeps it. */
  mark?: "fact" | "unverified" | "inference" | "unknown";
  /**
   * AI-21 (the phone's request 69): the same sentence without its own figure
   * of the price's move — said where the answer's head is the move, from one
   * source with its time, so a second source's figure of the same move does
   * not sit beside it.
   */
  withoutMove?: string;
}>;

export type ToolOutcome = "ok" | "empty" | "unavailable" | "refused";

export type ToolRun = Readonly<{
  tool: string;
  kind: ToolKind;
  outcome: ToolOutcome;
  /** The state of what was read, where one state describes it; null for a draft or an empty read. */
  state: AgentState | null;
  facts: readonly ToolFact[];
  notes: readonly ToolNote[];
  cards: readonly AgentCard[];
  handoffs: readonly AgentHandoff[];
  /** For a `prepare` tool: the draft it made, to be stored by the service; the card carries the same id. */
  draft: AgentCard | null;
}>;

export type ToolContext = Readonly<{
  owner: string;
  locale: Locale;
  nowMs: number;
  readers: AgentReaders;
  citations: CitationBook;
  newDraftId: () => string;
}>;

export type AgentTool<S extends z.ZodTypeAny = z.ZodTypeAny> = Readonly<{
  name: string;
  kind: ToolKind;
  /** One line for a person and for the model: what the tool reads or prepares. */
  description: string;
  input: S;
  run: (input: z.output<S>, ctx: ToolContext) => Promise<ToolRun>;
}>;

/** A tool as the registry holds it: the input schema erased to the validator, the run taking what that validator produced. */
export type RegisteredTool = Readonly<{
  name: string;
  kind: ToolKind;
  description: string;
  input: z.ZodTypeAny;
  run: (input: never, ctx: ToolContext) => Promise<ToolRun>;
}>;

export function emptyRun(tool: string, kind: ToolKind, outcome: ToolOutcome, state: AgentState | null = null): ToolRun {
  return { tool, kind, outcome, state, facts: [], notes: [], cards: [], handoffs: [], draft: null };
}

export function collectCitations(book: CitationBook): readonly AgentCitation[] {
  return book.list();
}
