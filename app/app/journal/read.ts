import { adherenceOutcome, type AdherenceReport, type AdherenceTrade } from "@/lib/journal/adherence";
import type { JournalProjection } from "@/lib/home/advice/journal";
import type { DecisionsProjection } from "@/lib/home/advice/read-model";
import { loadDecisionReads } from "@/app/app/action-cases/read";
import { projectDecisions } from "@/lib/home/advice/read-model";
import type { HonestPnl } from "@/lib/core/pnl/honest";
import { fillsHonest, paperHonest } from "@/lib/journal/honest";

/**
 * What the Journal reads, and why it reads it through the decisions projection.
 *
 * The cycle this page shows is the *same* cycle `/app/action-cases` shows, so
 * it is compiled by the same function from the same records rather than by a
 * second pass over the paper book. Two independent readings of one trade is how
 * two surfaces end up disagreeing about what a person did, and disagreeing
 * about that is the one thing a journal may not do.
 *
 * Discipline stays where it already was — `lib/journal/adherence`, unchanged —
 * because plan adherence is a property of the trades rather than of the cycle
 * projection, and moving it would have been a rewrite dressed as a migration.
 */

export type JournalRead = Readonly<{
  cycle: JournalProjection;
  adherence: AdherenceReport;
  adherencePct: number | null;
  winRatePct: number | null;
  avgR: number | null;
  trades: number | null;
  journaled: number | null;
  /** `true` when the paper book answered. `false` means no figure is a fact. */
  statsAvailable: boolean;
  /**
   * The honest standard (DSC-2) over each book apart — paper and real are never summed. Null when that book was not
   * read (or there is none to read): the page says «not read», never a zero.
   */
  honest: Readonly<{ paper: HonestPnl | null; live: HonestPnl | null }>;
  recovery: readonly string[];
}>;

export async function loadJournal(input: Readonly<{
  wallet: string | null;
  telegramId: number | null; accountId?: string | null;
  ownerRef: string;
  asOf: string;
}>): Promise<JournalRead> {
  const reads = await loadDecisionReads(input);
  const nowS = Math.floor(Date.parse(input.asOf) / 1000);

  const projection = projectDecisions({
    asOf: input.asOf,
    ownerRef: input.ownerRef,
    investorContext: {
      state: "NOT_SERVER_READABLE",
      version: null,
      reason: "Your declared context is held in this browser, not on a server.",
    },
    /* A change nobody acted on is not a journal entry. Changes belong to the
       Radar and to the decision queue; this page is about cycles that happened. */
    changes: [],
    actions: reads.actions,
    reviews: reads.reviews,
    risk: reads.risk,
    sources: reads.sources,
    recovery: reads.recovery,
  });

  return {
    cycle: projection.journal,
    adherence: adherenceOutcome(adherenceTrades(projection)),
    adherencePct: reads.paperStats?.adherence_pct ?? null,
    winRatePct: reads.paperStats?.win_rate ?? null,
    avgR: reads.paperStats?.avg_r ?? null,
    trades: reads.paperStats?.trades ?? null,
    journaled: reads.paperStats?.journaled ?? null,
    statsAvailable: reads.paperStats !== null,
    honest: {
      paper: reads.books.paper ? paperHonest(reads.books.paper, nowS) : null,
      live: reads.books.fills ? fillsHonest(reads.books.fills, nowS) : null,
    },
    recovery: reads.recovery,
  };
}

/**
 * The adherence cohorts, read off the cases rather than off a second query.
 *
 * **Paper only, and that is a design decision rather than an omission.** Each
 * paper trade is exactly one position, so the cohorts are clean. Real closes
 * arrive as individual fills — one position can close in several — and mixing a
 * simulated win rate with a real one would read as real performance. Live joins
 * this comparison the day fills are reconciled to positions, which is not this
 * packet.
 */
function adherenceTrades(projection: DecisionsProjection): AdherenceTrade[] {
  return projection.cases
    .filter((advice) => advice.action?.book === "PAPER" && advice.outcome !== null)
    .map((advice) => ({
      followedPlan: advice.review.state === "RECORDED" ? advice.review.followedPlan : null,
      /* A win is a close in profit. A null realized amount is not a win — it is
         a trade whose result was never reported, and counting it either way
         would be inventing the result. */
      won: Number(advice.outcome?.realizedAmount ?? Number.NaN) > 0,
    }));
}
