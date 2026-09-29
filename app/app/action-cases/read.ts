import { getFills, type ArcusFill } from "@/lib/arcus/public";
import { liveNotesList, type LiveNote } from "@/lib/live/rpc";
import { paperList, type PaperStats, type PaperTrade } from "@/lib/paper/rpc";
import type { JournalReview, RiskReference } from "@/lib/home/advice/advice-case";
import type { HomeExactAction } from "@/lib/home/advice/action-case";
import type { ActivitySource } from "@/lib/home/advice/activity";
import { projectDecisions, type DecisionsProjection } from "@/lib/home/advice/read-model";
import type { MaterialChange } from "@/lib/home/research/change";
import type { HomePortfolioProjection } from "@/lib/home/portfolio/read-model";
import { loadHomeSourceReads, projectHomeSurface } from "@/app/app/portfolio/read";
import { loadResearchReads, projectResearchSurface, researchSourceStates } from "@/app/app/research/read";

/**
 * Where the decisions surface's facts actually come from.
 *
 * Four reads, and **not one of them is new**. The Radar's own read supplies the
 * triggers; the Portfolio's own read supplies the deterministic risk reference;
 * the paper book supplies the plans, the closes and the lessons; the venue
 * supplies the real fills. Everything after `loadDecisionReads` is pure, so
 * every state this surface can render is reachable in a test by handing the
 * pure half a literal.
 *
 * **Nothing here writes.** No disposition control exists, no note is saved, no
 * order is prepared. The decision this surface is about was recorded elsewhere
 * or has not been recorded at all, and the second case says so.
 *
 * **Two facts a reader has to be able to see, not infer.** Agent Control's own
 * Action Cases live in `sessionStorage` in one browser tab — its store says so
 * in its own file — so no server render can list them and this module does not
 * pretend to. And the declared InvestorContext lives in the reader's browser,
 * so a server render binds `NOT_SERVER_READABLE` and the client island beside
 * the queue fills in the version when the browser has one.
 */

export const DECISIONS_CONTEXT_REASON =
  "Your declared context is held in this browser, not on a server, so this page cannot bind a version to a case until the browser reports one.";

/** How many venue fills are read back. The venue's own page size, unchanged. */
const FILL_LIMIT = 100;
/** How many closing fills become cases. Beyond this the index stops being readable. */
const LIVE_ACTION_LIMIT = 30;

export type DecisionReads = Readonly<{
  changes: readonly MaterialChange[];
  sources: readonly ActivitySource[];
  actions: readonly HomeExactAction[];
  reviews: readonly (readonly [string, JournalReview])[];
  risk: RiskReference;
  /**
   * The paper book's own statistics, carried through rather than recomputed.
   *
   * `null` when the read failed — never the $10,000 starting balance and never
   * a zero adherence, because "the book did not answer" and "you followed no
   * plan" are different facts and only one of them is about the reader.
   */
  paperStats: PaperStats | null;
  recovery: readonly string[];
}>;

export async function loadDecisionReads(input: Readonly<{
  wallet: string | null;
  telegramId: number | null; accountId?: string | null;
  ownerRef: string;
  asOf: string;
}>): Promise<DecisionReads> {
  const recovery: string[] = [];

  const [research, portfolio, paper, notes, fills] = await Promise.all([
    researchState(input, recovery),
    portfolioState(input, recovery),
    paperState(input, recovery),
    notesState(input),
    fillState(input, recovery),
  ]);

  const actions = [...paperActions(paper), ...liveActions(fills)];

  return {
    changes: research.changes,
    sources: research.sources,
    actions,
    reviews: [...paperReviews(paper), ...liveReviews(notes)],
    risk: portfolio,
    paperStats: paper.stats,
    recovery,
  };
}

async function researchState(
  input: Readonly<{ wallet: string | null; telegramId: number | null; accountId?: string | null; ownerRef: string; asOf: string }>,
  recovery: string[],
): Promise<Readonly<{ changes: readonly MaterialChange[]; sources: readonly ActivitySource[] }>> {
  try {
    const reads = await loadResearchReads({ wallet: input.wallet, telegramId: input.telegramId });
    const projection = projectResearchSurface({ reads, ownerRef: input.ownerRef, asOf: input.asOf });
    const sources = researchSourceStates(reads).map((source) => ({
      sourceId: source.sourceId,
      label: source.label,
      state: source.state,
      reason: source.reason,
      entitlement: source.entitlement,
    }));
    /* An immaterial change is a measurement that stayed inside its threshold.
       It is a fact and it belongs on the Radar; it is not something a person
       has to decide about, and a queue that lists it is a queue nobody reads. */
    return {
      changes: (projection?.changes ?? []).filter((change) => change.state !== "IMMATERIAL"),
      sources,
    };
  } catch {
    recovery.push("The research read did not complete, so no change on this page was raised on this read.");
    return { changes: [], sources: [] };
  }
}

/**
 * The risk link of the chain, taken from the Portfolio rather than recomputed.
 *
 * The canon's chain names one `RiskCalculation`, and the Portfolio already owns
 * it. Recomputing here would produce a second deterministic answer to the same
 * question, which is exactly the drift the one-object-graph rule exists to
 * stop, so this reads the digest the Portfolio produced and carries it.
 */
async function portfolioState(
  input: Readonly<{ wallet: string | null; telegramId: number | null; accountId?: string | null; ownerRef: string; asOf: string }>,
  recovery: string[],
): Promise<RiskReference> {
  try {
    const reads = await loadHomeSourceReads({ wallet: input.wallet, telegramId: input.telegramId });
    const projection: HomePortfolioProjection = projectHomeSurface({
      reads,
      ownerRef: input.ownerRef,
      accountRef: input.ownerRef,
      asOf: input.asOf,
    });
    return {
      state: "ATTACHED",
      schemaVersion: projection.calculation.schemaVersion,
      formulaVersion: projection.calculation.formulaVersion,
      inputDigest: projection.calculation.inputDigest,
      scopeId: "home",
      bindingConstraintIds: projection.risk
        .filter((category) => category.status === "EXCEEDED")
        .map((category) => category.id),
      unknowns: projection.coverageLimit,
    };
  } catch {
    recovery.push("The portfolio read did not complete, so no deterministic risk calculation is attached to these cases.");
    return {
      state: "UNAVAILABLE",
      reason: "The portfolio read did not complete on this request, so no deterministic calculation exists to attach.",
    };
  }
}

type PaperState = Readonly<{ open: readonly PaperTrade[]; closed: readonly PaperTrade[]; stats: PaperStats | null }>;

async function paperState(
  input: Readonly<{ telegramId: number | null; accountId?: string | null }>,
  recovery: string[],
): Promise<PaperState> {
  if (input.telegramId === null && !input.accountId) return { open: [], closed: [], stats: null };
  const result = await paperList({ accountId: input.accountId ?? null, telegramId: input.telegramId });
  if (!result.ok) {
    recovery.push("The paper book read did not complete, so no paper decision or outcome is shown on this read.");
    return { open: [], closed: [], stats: null };
  }
  return { open: result.data.open, closed: result.data.closed, stats: result.data.stats };
}

async function notesState(input: Readonly<{ telegramId: number | null; accountId?: string | null }>): Promise<Readonly<Record<string, LiveNote>>> {
  if (input.telegramId === null && !input.accountId) return {};
  const result = await liveNotesList({ accountId: input.accountId ?? null, telegramId: input.telegramId });
  return result.ok ? result.data : {};
}

async function fillState(
  input: Readonly<{ wallet: string | null }>,
  recovery: string[],
): Promise<readonly ArcusFill[]> {
  if (!input.wallet) return [];
  try {
    return await getFills(input.wallet, FILL_LIMIT);
  } catch {
    recovery.push("The venue fill read did not complete, so no real action is shown on this read.");
    return [];
  }
}

const paperRef = (id: string) => `paper:${id}`;
const fillRef = (tradeId: string) => `arcus:fill:${tradeId}`;

/** A finite decimal as text, or `null`. Never a rounded stand-in for a missing one. */
function money(value: unknown): string | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

function paperActions(paper: PaperState): readonly HomeExactAction[] {
  return [...paper.open, ...paper.closed].map((trade) => ({
    actionRef: paperRef(trade.id),
    kind: "PAPER_TRADE" as const,
    book: "PAPER" as const,
    subjectRef: `arcus:perp:${trade.market}`,
    subjectLabel: trade.market,
    side: trade.side,
    size: money(trade.size),
    entryPrice: money(trade.entry_price),
    plan: {
      stop: money(trade.sl),
      target: money(trade.tp),
      rationale: trade.reason ?? null,
    },
    openedAt: trade.opened_at ?? null,
    closedAt: trade.closed_at ?? null,
    exitReason: trade.exit_reason ?? null,
    realizedAmount: trade.closed_at ? money(trade.pnl) : null,
    realizedCurrency: trade.closed_at ? "USD" : null,
    fees: money(trade.fees),
    venue: "Arcus SmartTrade (paper)",
  }));
}

/**
 * The venue's closing fills, as exact actions.
 *
 * Only closes, because a close is the one fill that carries a realized figure
 * the venue itself computed — an opening fill has an outcome that has not
 * happened yet, and giving it one would be the receipt-before-observation
 * defect wearing a different hat.
 */
function liveActions(fills: readonly ArcusFill[]): readonly HomeExactAction[] {
  return fills
    .filter((fill) => fill.positionEffect?.startsWith("CLOSE"))
    .slice(0, LIVE_ACTION_LIMIT)
    .map((fill) => {
      const at = new Date(fill.createdAt).toISOString();
      return {
        actionRef: fillRef(fill.tradeId),
        kind: "LIVE_FILL" as const,
        book: "LIVE" as const,
        subjectRef: `arcus:perp:${fill.marketDisplayName}`,
        subjectLabel: fill.marketDisplayName,
        side: fill.side,
        size: fill.size,
        entryPrice: fill.price,
        /* The venue reports a fill, never the plan behind one. That absence is
           a fact about what a venue is, and the surface states it rather than
           leaving four dashes. */
        plan: { stop: null, target: null, rationale: null },
        openedAt: at,
        closedAt: at,
        exitReason: fill.positionEffect,
        realizedAmount: money(fill.closedPnl),
        realizedCurrency: "USD",
        fees: money(fill.fee),
        venue: "Arcus",
      };
    });
}

function review(note: Readonly<{ followed_plan: boolean | null; mistake_tag: string | null; lesson: string | null }>, at: string | null): JournalReview {
  const written = note.followed_plan !== null || note.mistake_tag !== null || (note.lesson ?? "") !== "";
  return written
    ? { state: "RECORDED", recordedAt: at, followedPlan: note.followed_plan, mistakeTag: note.mistake_tag, lesson: note.lesson }
    : {
        state: "MISSING",
        reason: "No review is recorded against this outcome. Plan adherence, the mistake and the lesson are written in the terminal, and none of the three is set here.",
      };
}

function paperReviews(paper: PaperState): readonly (readonly [string, JournalReview])[] {
  return paper.closed.map((trade) => [
    paperRef(trade.id),
    review(
      { followed_plan: trade.followed_plan ?? null, mistake_tag: trade.mistake_tag ?? null, lesson: trade.lesson ?? trade.reason ?? null },
      trade.closed_at ?? null,
    ),
  ] as const);
}

function liveReviews(notes: Readonly<Record<string, LiveNote>>): readonly (readonly [string, JournalReview])[] {
  return Object.entries(notes).map(([tradeId, note]) => [fillRef(tradeId), review(note, null)] as const);
}

export function projectDecisionSurface(input: Readonly<{
  reads: DecisionReads;
  ownerRef: string;
  asOf: string;
}>): DecisionsProjection {
  return projectDecisions({
    asOf: input.asOf,
    ownerRef: input.ownerRef,
    /* The server cannot read the declared context: it lives in the reader's
       own browser. Binding it here would be inventing a version. */
    investorContext: { state: "NOT_SERVER_READABLE", version: null, reason: DECISIONS_CONTEXT_REASON },
    changes: input.reads.changes,
    actions: input.reads.actions,
    reviews: input.reads.reviews,
    risk: input.reads.risk,
    sources: input.reads.sources,
    recovery: input.reads.recovery,
  });
}
