/**
 * What the Brief and the Critic reason over.
 *
 * Both formats stand on the **same engine** as the conversation: the
 * Research tools read through the product's own services and return
 * `ToolRun`s — facts with citations, typed cards, and sentences. Nothing
 * here reads a store, calls a provider, or computes a figure the tools did
 * not state; it is a projection of what was already read, so a Brief can
 * never disagree with the conversation about the same number.
 *
 * The projection exists because the two formats must *compare across* tools
 * — a plan's own bound against the market read, a memory fact against the
 * decision being made, an evidence state against the condition that names
 * it — and the six-section composer works within one tool's notes.
 *
 * Pure: no clock of its own, no store, no network.
 */

import type { AgentCard, AgentFigure, PlanMemoryKind } from "../../api/v1/contract.ts";
import type { ToolFact, ToolRun } from "../tools/types.ts";

export type MarketCard = Extract<AgentCard, { kind: "market" }>;
export type StockCard = Extract<AgentCard, { kind: "stock" }>;
export type EvidenceCard = Extract<AgentCard, { kind: "evidence" }>;
export type HoldingsCard = Extract<AgentCard, { kind: "holdings" }>;
export type PlanCard = Extract<AgentCard, { kind: "plan" }>;
export type NoteCard = Extract<AgentCard, { kind: "note" }>;

/** One figure of the wallet's strategy memory, recovered from the run that read it. */
export type MemoryView = Readonly<{ kind: PlanMemoryKind; symbol: string | null; id: string; values: ReadonlyMap<string, ToolFact> }>;

/**
 * The key a memory figure is filed under by `memory_read`, so the Critic can
 * find a fact by its kind without reading the store a second time. Internal
 * to the tool seam — never serialized, never part of the contract.
 */
export const memoryFactKey = (kind: string, symbol: string | null, id: string, key: string): string => `memory|${kind}|${symbol ?? ""}|${id}|${key}`;

export function parseMemoryFactKey(key: string): Readonly<{ kind: PlanMemoryKind; symbol: string | null; id: string; key: string }> | null {
  const parts = key.split("|");
  if (parts.length !== 5 || parts[0] !== "memory") return null;
  return { kind: parts[1] as PlanMemoryKind, symbol: parts[2] === "" ? null : parts[2], id: parts[3], key: parts[4] };
}

export type LensReads = Readonly<{
  runs: readonly ToolRun[];
  market: MarketCard | null;
  stock: StockCard | null;
  evidence: readonly EvidenceCard[];
  holdings: HoldingsCard | null;
  /** The plan the subject is about, when there is one. */
  plan: PlanCard | null;
  /** Every plan card the runs carried, the subject's included. */
  plans: readonly PlanCard[];
  notes: readonly NoteCard[];
  memory: readonly MemoryView[];
  /** Facts by key, the first wins — `price`, `plan.invalidation`, `plan.thesis`, … */
  facts: ReadonlyMap<string, ToolFact>;
  /** Tools that were asked and did not answer, by name. */
  unavailable: readonly string[];
  /** Tools that answered with nothing to stand on. */
  empty: readonly string[];
  /**
   * Whether the **subject itself** was read. A wallet-wide read — the
   * holdings, the whole record — must never make an asset nobody could
   * resolve look as though something about it had been read, so both formats
   * say *insufficient data* when this is false.
   */
  subjectRead: boolean;
}>;

const cardsOf = <K extends AgentCard["kind"]>(runs: readonly ToolRun[], kind: K): Extract<AgentCard, { kind: K }>[] =>
  runs.flatMap((run) => run.cards).filter((card): card is Extract<AgentCard, { kind: K }> => card.kind === kind);

export function projectReads(runs: readonly ToolRun[], subjectPlanId: string | null, subjectKind: "asset" | "plan" | "portfolio" | "note" | "page" | null = null): LensReads {
  const facts = new Map<string, ToolFact>();
  for (const run of runs) for (const entry of run.facts) if (!facts.has(entry.key)) facts.set(entry.key, entry);

  const memory = new Map<string, { kind: PlanMemoryKind; symbol: string | null; id: string; values: Map<string, ToolFact> }>();
  for (const [key, entry] of facts) {
    const parsed = parseMemoryFactKey(key);
    if (!parsed) continue;
    const row = memory.get(parsed.id) ?? { kind: parsed.kind, symbol: parsed.symbol, id: parsed.id, values: new Map<string, ToolFact>() };
    row.values.set(parsed.key, entry);
    memory.set(parsed.id, row);
  }

  const plans = cardsOf(runs, "plan");
  const plan = subjectPlanId ? (plans.find((card) => card.planId === subjectPlanId) ?? null) : (plans.find((card) => card.status === "active") ?? plans[0] ?? null);
  const named = runs.filter((run) => run.tool !== "service");
  const market = cardsOf(runs, "market")[0] ?? null;
  const stock = cardsOf(runs, "stock")[0] ?? null;
  const notes = cardsOf(runs, "note");
  const subjectRead =
    subjectKind === "asset"
      ? market !== null || stock !== null
      : subjectKind === "plan"
        ? plan !== null
        : subjectKind === "note"
          ? notes.length > 0
          : named.some((run) => run.outcome === "ok" && run.facts.length > 0);
  return {
    runs,
    market,
    stock,
    evidence: cardsOf(runs, "evidence"),
    holdings: cardsOf(runs, "holdings")[0] ?? null,
    plan,
    plans,
    notes,
    memory: [...memory.values()].map((row) => ({ kind: row.kind, symbol: row.symbol, id: row.id, values: row.values })),
    facts,
    unavailable: [...new Set(named.filter((run) => run.outcome === "unavailable").map((run) => run.tool))],
    empty: [...new Set(named.filter((run) => run.outcome === "empty").map((run) => run.tool))],
    subjectRead,
  };
}

/* ------------------------------------------------------------ small readers over the projection */

/** The figure a card states under a label key, by its position in the tool's own order. */
export function figureOf(card: Readonly<{ figures: readonly AgentFigure[] }> | null, index: number): AgentFigure | null {
  return card?.figures[index] ?? null;
}

export const numberOf = (fact: ToolFact | null | undefined): number | null => (fact && fact.number !== null && Number.isFinite(fact.number) ? fact.number : null);

/** A fact as a figure the contract can carry — the same text the tool printed, never re-formatted. */
export const asFigure = (fact: ToolFact): AgentFigure => ({ label: fact.label, value: fact.value, number: fact.number, unit: fact.unit, state: fact.state, cite: fact.cite });

/** The price of the subject asset, whichever desk read it. */
export function priceFact(reads: LensReads): ToolFact | null {
  return reads.facts.get("price") ?? null;
}

/** The symbol the subject is about, from whichever card carries it. */
export function subjectSymbol(reads: LensReads): string | null {
  return reads.stock?.symbol ?? reads.market?.symbol ?? reads.plan?.symbol ?? null;
}

/**
 * True when there is nothing to stand on: no research tool answered, or the
 * subject itself was never read. The second half matters — the wallet's own
 * holdings and record are read for every subject, and without this a Brief
 * about a mint the catalogue does not list would quietly become a Brief
 * about the wallet.
 */
export function nothingRead(reads: LensReads): boolean {
  const named = reads.runs.filter((run) => run.tool !== "service");
  if (named.length === 0) return true;
  if (!reads.subjectRead) return true;
  return named.every((run) => run.outcome !== "ok" || run.facts.length === 0);
}
