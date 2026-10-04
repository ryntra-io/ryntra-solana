import { getPositions, type ArcusPosition } from "@/lib/arcus/public";
import { paperList, type PaperStats, type PaperTrade } from "@/lib/paper/rpc";
import { normalizeArcusPosition } from "@/lib/home/portfolio/adapters/arcus";
import { normalizePaperTrade } from "@/lib/home/portfolio/adapters/paper";
import { adapterFailure, adapterSuccess, type AdapterResult } from "@/lib/home/portfolio/adapters/types";
import type { AttentionItem } from "@/lib/home/portfolio/attention";
import type { PnlObservation } from "@/lib/home/portfolio/pnl";
import type { PositionRecord } from "@/lib/home/portfolio/position";
import {
  projectHomePortfolio,
  type HomePortfolioProjection,
  type HomeSourceObservation,
} from "@/lib/home/portfolio/read-model";

/**
 * The two Home surfaces read the world once, here.
 *
 * The split is deliberate: `loadHomeSourceReads` performs the effects and
 * `projectHomeSurface` is pure. Today needs the same paper read for its own
 * panels, so it loads once and projects once instead of asking the RPC twice,
 * and every state this file can produce is reachable in a test by handing the
 * pure half a literal.
 *
 * No provider is added here and nothing is written. Both reads already existed
 * on Home — this file turns their results into the canonical adapter contract
 * rather than into ad-hoc page variables.
 */
export const HOME_LIVE_SOURCE_ID = "arcus-perps";
export const HOME_PAPER_SOURCE_ID = "paper-book";

/** How long a venue observation is treated as current. */
const VENUE_MAX_AGE_SECONDS = 120;
/** The paper book is local state, so its observation does not expire on a clock. */
const PAPER_MAX_AGE_SECONDS = 900;

export type PaperRead = Readonly<{
  ok: boolean;
  open: readonly PaperTrade[];
  closed: readonly PaperTrade[];
  /** `null` when the read failed — never the $10,000 starting balance. */
  stats: PaperStats | null;
}>;

export type HomeSourceReads = Readonly<{
  wallet: string | null;
  /** `null` = not asked (no wallet). `"FAILED"` = asked and the venue did not answer. */
  positions: readonly ArcusPosition[] | "FAILED" | null;
  paper: PaperRead | null;
}>;

export async function loadHomeSourceReads(input: Readonly<{
  wallet: string | null;
  telegramId: number | null; accountId?: string | null;
}>): Promise<HomeSourceReads> {
  let positions: readonly ArcusPosition[] | "FAILED" | null = null;
  if (input.wallet) {
    try {
      positions = await getPositions(input.wallet);
    } catch {
      /* A venue that did not answer is a degraded source, not an empty
         portfolio. The distinction is the whole reason this is not `[]`. */
      positions = "FAILED";
    }
  }

  let paper: PaperRead | null = null;
  if (input.telegramId !== null || input.accountId) {
    const result = await paperList({ accountId: input.accountId ?? null, telegramId: input.telegramId });
    paper = result.ok
      ? { ok: true, open: result.data.open, closed: result.data.closed, stats: result.data.stats }
      : { ok: false, open: [], closed: [], stats: null };
  }

  return { wallet: input.wallet, positions, paper };
}

function liveSource(input: Readonly<{
  reads: HomeSourceReads;
  ownerRef: string;
  accountRef: string;
  asOf: string;
}>): HomeSourceObservation | null {
  if (input.reads.positions === null) return null;
  const observation = {
    sourceId: HOME_LIVE_SOURCE_ID,
    label: "Arcus positions",
    observedAt: input.asOf,
    freshnessPolicy: { maxAgeSeconds: VENUE_MAX_AGE_SECONDS },
    detailHref: "/app/connect",
  };
  if (input.reads.positions === "FAILED") {
    return {
      ...observation,
      result: adapterFailure(
        "SOURCE_CONTRACT_INSUFFICIENT",
        "The venue position read did not complete, so no live position is claimed for this read.",
        [`evidence:${HOME_LIVE_SOURCE_ID}:read`],
      ),
    };
  }

  const records: PositionRecord[] = [];
  for (const [index, position] of input.reads.positions.entries()) {
    const result = normalizeArcusPosition({
      ownerRef: input.ownerRef,
      accountRef: input.accountRef,
      connectionId: `${HOME_LIVE_SOURCE_ID}:${input.reads.wallet ?? "unknown"}`,
      sourceId: HOME_LIVE_SOURCE_ID,
      sourceVersion: null,
      observedAt: input.asOf,
      evidenceRefs: [`evidence:${HOME_LIVE_SOURCE_ID}:${index}`],
      networkRef: "arcus",
      instrumentKey: position.marketDisplayName,
      underlyingKey: position.marketDisplayName.split("-")[0] ?? position.marketDisplayName,
      representationKey: `arcus:perp:${position.marketDisplayName}`,
      quoteCurrency: "USD",
      freshnessPolicy: { maxAgeSeconds: VENUE_MAX_AGE_SECONDS },
      position,
    });
    /* One malformed position does not discard the ones that parsed: the
       adapter already refuses the record, and the surface reports the source as
       degraded through the failure below rather than silently shrinking. */
    if (!result.ok) return { ...observation, result };
    records.push(...result.records);
  }
  return { ...observation, result: adapterSuccess(records) };
}

function paperSource(input: Readonly<{
  reads: HomeSourceReads;
  ownerRef: string;
  accountRef: string;
  asOf: string;
}>): HomeSourceObservation | null {
  const paper = input.reads.paper;
  if (paper === null) return null;
  const observation = {
    sourceId: HOME_PAPER_SOURCE_ID,
    label: "Paper book",
    observedAt: input.asOf,
    freshnessPolicy: { maxAgeSeconds: PAPER_MAX_AGE_SECONDS },
    detailHref: "/app/journal",
  };
  if (!paper.ok) {
    return {
      ...observation,
      result: adapterFailure(
        "SOURCE_CONTRACT_INSUFFICIENT",
        "The paper book read did not complete, so no paper position is claimed for this read.",
        [`evidence:${HOME_PAPER_SOURCE_ID}:read`],
      ),
    };
  }

  const records: PositionRecord[] = [];
  let failure: AdapterResult | null = null;
  for (const trade of paper.open) {
    const result = normalizePaperTrade({
      ownerRef: input.ownerRef,
      accountRef: input.accountRef,
      sourceId: HOME_PAPER_SOURCE_ID,
      sourceVersion: null,
      observedAt: input.asOf,
      evidenceRefs: [`evidence:${HOME_PAPER_SOURCE_ID}:${trade.id}`],
      trade,
    });
    if (!result.ok) { failure = result; break; }
    records.push(...result.records);
  }
  return { ...observation, result: failure ?? adapterSuccess(records) };
}

/**
 * P&L is declared, never inferred.
 *
 * Both current sources are explicit about what they do not carry: `ArcusPosition`
 * reports a per-position unrealized figure with no period boundary, and
 * `PaperTrade` stores JavaScript numbers with no exact decimal serialization.
 * Aggregating either would invent a period or a precision, so each component is
 * reported `UNAVAILABLE` with the reason the source itself gives. A component
 * only becomes a number when a source contract supplies one.
 */
function pnlObservations(reads: HomeSourceReads): readonly PnlObservation[] {
  const observations: PnlObservation[] = [];
  const components = ["REALIZED", "UNREALIZED", "FEES", "FUNDING"] as const;

  if (reads.positions !== null) {
    for (const component of components) {
      observations.push({
        component,
        book: "LIVE",
        state: "UNAVAILABLE",
        reason: component === "UNREALIZED"
          ? "The venue reports unrealized PnL per position without a period boundary; Ryntra does not aggregate a figure whose period is unknown."
          : "The venue position contract does not report this component.",
        sourceRef: HOME_LIVE_SOURCE_ID,
        observedAt: null,
      });
    }
  }

  if (reads.paper !== null) {
    for (const component of components) {
      observations.push({
        component,
        book: "PAPER",
        state: "UNAVAILABLE",
        reason: "PaperTrade uses JavaScript number fields without an exact source decimal serialization.",
        sourceRef: HOME_PAPER_SOURCE_ID,
        observedAt: null,
      });
    }
  }

  return observations;
}

/**
 * Typed facts that are true about this reader but are not portfolio arithmetic.
 *
 * Exactly one exists today, and it is a real one: a closed paper outcome with
 * no journal entry is `UNREVIEWED_OUTCOME` in the product's own vocabulary
 * and has a destination that exists. Onboarding prompts — no wallet, no
 * confirmed account — are deliberately *not* here; they explain an empty
 * surface, and putting them in Attention is the filler the product refuses.
 */
function signals(input: Readonly<{ reads: HomeSourceReads; asOf: string }>): readonly AttentionItem[] {
  const paper = input.reads.paper;
  if (paper === null || !paper.ok) return [];
  const unreviewed = paper.closed.length - (paper.stats?.journaled ?? 0);
  if (unreviewed <= 0) return [];
  return [{
    id: "journal:unreviewed-outcomes",
    kind: "UNREVIEWED_OUTCOME",
    severity: "LOW",
    observedAt: input.asOf,
    title: `${unreviewed} closed paper outcome${unreviewed === 1 ? "" : "s"} without a journal entry`,
    reason: "A closed outcome with no recorded decision cannot be reviewed later.",
    sourceRef: HOME_PAPER_SOURCE_ID,
    freshness: "CURRENT",
    detailHref: "/app/journal",
    actionLabel: "Open Journal",
    limitation: null,
  }];
}

export function projectHomeSurface(input: Readonly<{
  reads: HomeSourceReads;
  ownerRef: string;
  accountRef: string;
  asOf: string;
}>): HomePortfolioProjection {
  const sources = [
    liveSource(input),
    paperSource(input),
  ].filter((source): source is HomeSourceObservation => source !== null);

  return projectHomePortfolio({
    asOf: input.asOf,
    displayCurrency: "USD",
    scale: 2,
    roundingMode: "HALF_EVEN",
    inclusionMethod: "PRICED_ONLY",
    scope: { scopeId: "home", ownerRef: input.ownerRef, contextVersion: null },
    sources,
    fx: [],
    constraints: [],
    pnl: pnlObservations(input.reads),
    signals: signals(input),
  });
}
