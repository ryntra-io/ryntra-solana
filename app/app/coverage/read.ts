import type { HomePortfolioProjection } from "@/lib/home/portfolio/read-model";
import type { ResearchProjection } from "@/lib/home/research/read-model";
import {
  projectCoverage,
  type CoverageProjection,
  type CoverageSource,
  type UncountedReason,
} from "@/lib/home/coverage/coverage";
import type { HomeReads } from "@/app/app/home-reads";

/**
 * What the coverage numbers are counted from.
 *
 * Two decisions live here and both are refusals.
 *
 * **A source the product has never connected is not a failed source.** The
 * Radar reports `OK / STALE / FAILED` for sources it actually read; a declared
 * source with no read at all arrives as absent, and absent is mapped to
 * `NEVER_OBSERVED` rather than folded into `FAILED`. "It broke" and "nobody
 * ever tried" produce the same empty screen and require completely different
 * actions.
 *
 * **A budget spend is never inferred.** The mandate declares the ceilings and
 * this deployment records no spend against any of them, so `recorded` is `null`
 * everywhere and the module renders `UNRECORDED`. Deriving a plausible figure
 * from the number of reads this page happened to make would be inventing a
 * measurement on the surface whose entire job is to say what was measured.
 */

function sources(
  research: ResearchProjection | null,
  portfolio: HomePortfolioProjection | null,
): readonly CoverageSource[] {
  const seen = new Map<string, CoverageSource>();

  for (const source of research?.sources ?? []) {
    seen.set(source.sourceId, {
      sourceId: source.sourceId,
      label: source.label,
      state: source.state,
      entitlement: source.entitlement,
      observedAt: source.state === "OK" ? (research?.asOf ?? null) : null,
      reason: source.reason,
    });
  }

  for (const source of portfolio?.sources ?? []) {
    /* The Radar's answer wins when both saw the same source: it carries the
       entitlement, which is the field this surface exists to show. */
    if (seen.has(source.sourceId)) continue;
    seen.set(source.sourceId, {
      sourceId: source.sourceId,
      label: source.label,
      state: source.state,
      entitlement: "NONE",
      observedAt: source.state === "OK" ? source.observedAt : null,
      reason: source.reason,
    });
  }

  return [...seen.values()];
}

/**
 * Position counts, taken from the valuation coverage the Portfolio computed.
 *
 * Every uncounted position gets a named reason from the valuation state that
 * excluded it, and the module refuses the whole count if those reasons do not
 * add up — which is the check that keeps this mapping honest as valuation
 * states are added.
 */
function dataCounts(portfolio: HomePortfolioProjection | null) {
  if (portfolio === null) {
    const empty = { counted: 0, total: 0, uncounted: [] as readonly UncountedReason[] };
    return { positions: empty, valuations: empty, identities: empty };
  }

  const { coverage } = portfolio;
  const counts = coverage.stateCounts;
  const total = coverage.eligiblePositionCount;
  const priced = counts.PRICED;

  const named: UncountedReason[] = [];
  const push = (reason: string, count: number) => { if (count > 0) named.push({ reason, count }); };
  push("Estimated rather than priced", counts.ESTIMATED);
  push("Priced outside its freshness window", counts.STALE);
  push("No price at the valuation instant", counts.UNPRICED);
  push("Sources disagree on the price", counts.CONFLICTING);
  push("Held privately and not disclosed", counts.PRIVATE_HIDDEN);

  const namedTotal = named.reduce((sum, entry) => sum + entry.count, 0);
  const unexplained = total - priced - namedTotal;
  if (unexplained > 0) {
    named.push({ reason: "Outside the valuation states this projection reports", count: unexplained });
  }

  const valuations = { counted: priced, total, uncounted: named };

  /* Included-in-the-calculation is its own count: the inclusion method decides
     whether an estimate counts, and that is a different question from priced. */
  const includedGap = total - coverage.includedPositionCount;
  const positions = {
    counted: coverage.includedPositionCount,
    total,
    uncounted: includedGap > 0
      ? [{ reason: "Excluded by the declared inclusion method (" + coverage.inclusionMethod + ")", count: includedGap }]
      : [],
  };

  /* Identity is not separately counted by the portfolio projection, and this
     surface does not invent it: an unpriced position may or may not also be
     unidentified, and only one of those is recorded. Identity is reported as
     the positions that reached the calculation at all. */
  const identities = { counted: coverage.eligiblePositionCount, total: coverage.eligiblePositionCount, uncounted: [] };

  return { positions, valuations, identities };
}

export function projectCoverageSurface(input: Readonly<{
  reads: HomeReads;
  asOf: string;
}>): CoverageProjection {
  const { portfolio, research } = input.reads;
  const budgets = research?.mandate.budgets ?? { dataReadsPerDay: null, aiCallsPerDay: null, maxAlertsPerDay: null };

  return projectCoverage({
    asOf: input.asOf,
    sources: sources(research, portfolio),
    data: dataCounts(portfolio),
    budgets: {
      /* `recorded: null` throughout, and deliberately: no store records spend
         against these ceilings, so the module reports UNRECORDED rather than a
         zero nobody observed. */
      dataReadsPerDay: { declared: budgets.dataReadsPerDay, recorded: null },
      aiCallsPerDay: { declared: budgets.aiCallsPerDay, recorded: null },
      maxAlertsPerDay: { declared: budgets.maxAlertsPerDay, recorded: null },
    },
  });
}
