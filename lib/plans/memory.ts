/**
 * Strategy memory — `RYN-RESULTS-MEMORY-001`, canon Part A §11.
 *
 * What the product remembers about how this wallet decides, so the next
 * decision is not made in a vacuum. Three rules make it worth trusting, and
 * they are the whole design:
 *
 * 1. **Every fact is derived from records at read time.** There is no memory
 *    store to drift from the plans, the Reviews, the executions and the
 *    notes it describes, and no write a model could reach. Delete a plan and
 *    its memory is gone with it, because the memory *was* the plan.
 * 2. **Every fact cites what it stands on** — the plan, the version, the
 *    Review, the signature, the ledger row, the monitoring note — with the
 *    time. A fact that can cite nothing is not written at all.
 * 3. **The server states figures, not sentences.** A fact is a kind, a scope
 *    and its numbers; the reader's language is composed by the client from
 *    those. No prose is stored, so no prose can be wrong in one language and
 *    right in another, and nothing here encourages, congratulates or judges
 *    the person.
 *
 * What this is not: a journal, a model's summary, a performance claim. The
 * most useful thing it says is often *your maximum-price rule refused all
 * three Reviews* — a fact about a rule that worked, not about a loss.
 *
 * Pure; the clock is a value.
 */

import { planAssetKind, type PlanMemoryCitation, type PlanMemoryFact, type PlanNoTradeOutcome, type PlanPosition, type PlanResult } from "../api/v1/contract.ts";
import type { TradingPlanRecord } from "./store.ts";

/** A monitoring note as memory reads it — the shape the surface already keeps, narrowed so this module needs nothing of the monitoring store. */
export type MemoryNote = Readonly<{
  id: string;
  href: string;
  createdAt: string;
  subject?: Readonly<{ kind: "trading-plan" | "prediction-plan"; id: string }>;
  finding?: Readonly<{ kind: string; outcome: string; facts?: Readonly<{ observedAt?: string | null }> }>;
}>;

/** One plan with everything derived from it, as the feed already computed it — memory never re-derives a figure a result stated. */
export type MemoryInput = Readonly<{
  record: TradingPlanRecord;
  results: readonly PlanResult[];
  outcome: PlanNoTradeOutcome | null;
  position: PlanPosition;
}>;

const PLAN_HREF = (planId: string) => `/app/strategies/plans/${planId}`;

function planCite(record: TradingPlanRecord): PlanMemoryCitation {
  return { kind: "plan", id: record.id, at: record.updatedAt, href: PLAN_HREF(record.id) };
}

function versionCite(record: TradingPlanRecord, version: number): PlanMemoryCitation {
  const entry = record.history.find((candidate) => candidate.version === version) ?? null;
  return { kind: "version", id: `${record.id}#${version}`, at: entry?.createdAt ?? null, href: PLAN_HREF(record.id) };
}

/** A figure with a number, or one with a word where a number would not say it. */
function figure(key: string, value: number | null, unit: PlanMemoryFact["figures"][number]["unit"], text: string | null = null): PlanMemoryFact["figures"][number] {
  return { key, value, text, unit };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * The wallet's memory, newest first. `notes` are the monitoring notes the
 * surface already read for this wallet; a note about a plan this wallet does
 * not own is never matched, because the input is the wallet's own plans.
 */
export function memoryFactsOf(inputs: readonly MemoryInput[], notes: readonly MemoryNote[] = []): PlanMemoryFact[] {
  const facts: PlanMemoryFact[] = [];

  /* ---- per asset: how many plans, how many traded, and which rule refused the rest ---- */
  const byMint = new Map<string, MemoryInput[]>();
  for (const input of inputs) {
    const list = byMint.get(input.record.asset.mint) ?? [];
    list.push(input);
    byMint.set(input.record.asset.mint, list);
  }

  for (const [mint, group] of byMint) {
    const symbol = group[0].record.asset.underlying.symbol || group[0].record.asset.symbol;
    const scope = { kind: "asset" as const, mint, symbol, planId: null };
    const cites = group.slice(0, 8).map((input) => planCite(input.record));
    const newest = group.reduce((latest, input) => (Date.parse(input.record.updatedAt) > Date.parse(latest) ? input.record.updatedAt : latest), group[0].record.updatedAt);
    const active = group.filter((input) => input.record.status === "active").length;

    facts.push({
      id: `mem_plans_${mint.slice(0, 16)}`,
      kind: "plans-written",
      scope,
      figures: [figure("plans", group.length, "count"), figure("active", active, "count"), figure("kind", null, "word", planAssetKind(group[0].record.asset))],
      cites,
      observedAt: newest,
    });

    const traded = group.filter((input) => input.results.some((result) => result.actual.outcome === "DONE" && result.actual.leg === "entry"));
    const reviewed = group.filter((input) => (input.outcome?.reviews ?? 0) > 0 || input.results.some((result) => result.beforeSigning !== null));
    if (reviewed.length > 0 || traded.length > 0) {
      facts.push({
        id: `mem_trades_${mint.slice(0, 16)}`,
        kind: "trades-made",
        scope,
        figures: [figure("reviewed", reviewed.length, "count"), figure("traded", traded.length, "count")],
        cites,
        observedAt: newest,
      });
    }

    /* A rule that refused every Review of a plan is the fact worth keeping: it is the plan doing its work. */
    const refused = new Map<string, MemoryInput[]>();
    for (const input of group) {
      const outcome = input.outcome;
      if (!outcome || !outcome.everyReview || outcome.blockedBy === null) continue;
      const list = refused.get(outcome.blockedBy) ?? [];
      list.push(input);
      refused.set(outcome.blockedBy, list);
    }
    for (const [rule, list] of refused) {
      const first = list[0].outcome;
      facts.push({
        id: `mem_blocked_${rule}_${mint.slice(0, 12)}`,
        kind: "blocked-by-rule",
        scope,
        figures: [figure("plans", list.length, "count"), figure("rule", null, "word", rule), figure("bound", null, "word", first?.expected ?? null), figure("found", null, "word", first?.found ?? null)],
        cites: list.slice(0, 8).map((input) => planCite(input.record)),
        observedAt: list.reduce((latest, input) => (Date.parse(input.outcome?.observedAt ?? "") > Date.parse(latest) ? (input.outcome?.observedAt ?? latest) : latest), list[0].outcome?.observedAt ?? newest),
      });
    }
  }

  /* ---- per plan: how the entry stood, whether the position is open, how an exit stood ---- */
  for (const input of inputs) {
    const { record, results, position } = input;
    const symbol = record.asset.underlying.symbol || record.asset.symbol;
    const scope = { kind: "plan" as const, mint: record.asset.mint, symbol, planId: record.id };

    for (const result of results) {
      const actual = result.actual;
      if (actual.outcome !== "DONE") continue;
      const executionCite: PlanMemoryCitation = { kind: "execution", id: actual.signature, at: actual.settledAt, href: PLAN_HREF(record.id) };

      if (actual.leg === "entry" && actual.perShareUsd !== null && result.plan.entryPerShareUsd > 0) {
        const diff = ((actual.perShareUsd - result.plan.entryPerShareUsd) / result.plan.entryPerShareUsd) * 100;
        facts.push({
          id: `mem_entry_${actual.signature.slice(0, 16)}`,
          kind: "entry-vs-plan",
          scope,
          figures: [figure("planned", round(result.plan.entryPerShareUsd, 6), "usd"), figure("actual", round(actual.perShareUsd, 6), "usd"), figure("diff", round(diff, 4), "pct")],
          cites: [planCite(record), versionCite(record, result.version), executionCite],
          observedAt: actual.settledAt,
        });
      }

      if (actual.leg === "exit" && result.exit) {
        facts.push({
          id: `mem_exit_${actual.signature.slice(0, 16)}`,
          kind: "exit-adherence",
          scope,
          figures: [
            figure("verdict", null, "word", result.exit.verdict),
            figure("ruledByVersion", result.exit.ruledByVersion, "count"),
            figure("price", actual.perShareUsd === null ? null : round(actual.perShareUsd, 6), "usd"),
            figure("rule", null, "word", result.exit.checks.find((check) => check.outcome === "fail")?.id ?? null),
          ],
          cites: [planCite(record), versionCite(record, result.exit.ruledByVersion ?? result.version), executionCite],
          observedAt: actual.settledAt,
        });
      }
    }

    if (position.state === "open") {
      facts.push({
        id: `mem_open_${record.id.slice(5, 21)}`,
        kind: "position-open",
        scope,
        figures: [figure("unitsHeld", Number(position.unitsHeld), "units"), figure("costBasis", position.costBasisUsd, "usd"), figure("entries", position.entries, "count")],
        cites: [planCite(record)],
        observedAt: record.updatedAt,
      });
    }

    for (const note of notes) {
      if (note.subject?.kind !== "trading-plan" || note.subject.id !== record.id) continue;
      facts.push({
        id: `mem_note_${note.id.slice(0, 24)}`,
        kind: "monitoring-said",
        scope,
        figures: [figure("finding", null, "word", note.finding?.kind ?? null), figure("outcome", null, "word", note.finding?.outcome ?? null)],
        cites: [{ kind: "note", id: note.id, at: note.finding?.facts?.observedAt ?? note.createdAt, href: note.href }, planCite(record)],
        observedAt: note.createdAt,
      });
    }
  }

  return facts.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}
