import { subjectPresent, type AccountSubject } from "@/lib/account/subject";
import { strategyLabGet, strategyLabList, type StrategyListItem } from "@/lib/strategy-lab/rpc";
import { StrategyLabDetailResultSchema } from "@/lib/strategy-lab/persistence-schemas";
import type { StrategyBacktestRecord, StrategyRecord, StrategyVersionRecord } from "@/lib/home/strategy/read-model";
import { projectStrategies, type StrategiesProjection } from "@/lib/home/strategy/read-model";

/**
 * Where the strategy lifecycle's facts come from: the Strategy Lab's own store.
 *
 * Two read RPCs that already existed — `strategy_lab_list` and
 * `strategy_lab_get`. **Nothing here appends a version, a run or a proposal.**
 * The lab owns writing; this surface owns reading the same records back as the
 * lifecycle the canon describes.
 *
 * **Three fields are deliberately dropped on the way through.** The lab's
 * evidence report carries `quality`, `verdict` and a numeric `score`. Inside
 * the lab those describe evidence completeness against a fixed rubric; on a
 * Home surface beside a portfolio they would read as a judgement about the
 * strategy, which is the universal score frozen decision 20 refuses. What
 * crosses this boundary is the protocol — costs, out-of-sample, forward
 * evidence, sensitivity, regimes — plus the drawdown and the trade count, and
 * `lib/home/strategy/backtest.ts` decides what is missing from those.
 *
 * **The read is bounded.** A reader with sixty strategies gets the most
 * recently updated `STRATEGY_LIMIT`, and the projection says how many were not
 * read rather than presenting a truncated list as the whole account.
 */

/** How many strategies are read in full. Beyond this the page stops being readable. */
export const STRATEGY_LIMIT = 12;

const VERSION_LIMIT = 20;
const RUN_LIMIT = 20;

export type StrategyReads = Readonly<{
  records: readonly StrategyRecord[];
  listed: number;
  recovery: readonly string[];
}>;

type DetailResult = ReturnType<typeof StrategyLabDetailResultSchema.parse>;

function versionRecords(detail: DetailResult): readonly StrategyVersionRecord[] {
  return detail.versions.map((version) => ({
    versionId: version.versionId,
    versionNumber: version.versionNumber,
    recordedAt: version.recordedAt,
    approvedAt: version.approvedAt,
    specHash: version.specHash,
    spec: version.spec as unknown as Readonly<Record<string, unknown>>,
  }));
}

function runRecords(detail: DetailResult): readonly StrategyBacktestRecord[] {
  return detail.runs.map((run) => ({
    runId: run.experimentId,
    versionId: run.versionId,
    createdAt: run.createdAt,
    dataset: run.manifest.symbol + " " + run.manifest.timeframe + " (" + run.manifest.provider + ")",
    datasetVersion: run.manifest.pineHash,
    engineVersion: run.engineVersion,
    costsIncluded: run.protocol.costsIncluded,
    /* The lab records a cost *protocol*, not the four rates. Reporting a rate
       it never stored would be supplying a fact. */
    commissionBps: null,
    spreadBps: null,
    slippageBps: null,
    fundingBpsPerDay: null,
    /* MISSING DATA IS NOT RECORDED BY THIS STORE, and that is reported rather
       than worked around.
       The lab scores `dataCompleteness` as a rubric dimension — 0, 6 or 10 —
       which answers *did this run produce trades, and was there a benchmark*.
       It is not a count of bars with no quote, and mapping it to `0 missing
       bars` would state a fact no source ever recorded. So the count is `null`
       for every run, the requirement reports as missing, and the reason names
       what the store actually holds. The consequence is visible and intended:
       no run reaches Forward paper on this evidence, and the surface says which
       field is why. */
    missingDataBars: null,
    missingDataReason:
      "The strategy store records data completeness as a rubric score over the compiled window, not a count of missing bars, so no missing-data quantity exists to state.",
    maxDrawdownPercent: run.evidence.metrics.maxDrawdownPercent,
    outOfSample: run.protocol.oos,
    forwardEvidence: run.protocol.forwardEvidence,
    parameterSensitivity: run.protocol.parameterSensitivity,
    regimesCovered: run.protocol.regimesCovered,
    trades: run.evidence.metrics.trades,
  }));
}

export async function loadStrategyReads(input: Readonly<{ subject: AccountSubject }>): Promise<StrategyReads> {
  const recovery: string[] = [];

  if (!subjectPresent(input.subject)) {
    return {
      records: [],
      listed: 0,
      recovery: ["This session has no account identity, so the strategy store cannot be read for it."],
    };
  }

  const listed = await strategyLabList({
    subject: input.subject,
    limit: STRATEGY_LIMIT,
    beforeUpdatedAt: null,
    beforeId: null,
  });

  if (!listed.ok) {
    return { records: [], listed: 0, recovery: ["The strategy list did not answer: " + listed.error] };
  }

  const items: readonly StrategyListItem[] = listed.data;

  const records = await Promise.all(
    items.map(async (item): Promise<StrategyRecord | null> => {
      const detail = await strategyLabGet({
        subject: input.subject,
        strategyId: item.strategyId,
        versionLimit: VERSION_LIMIT,
        versionsBeforeRecordedAt: null,
        versionsBeforeId: null,
        runLimit: RUN_LIMIT,
        runsBeforeCreatedAt: null,
        runsBeforeId: null,
        proposalLimit: 0,
        proposalsBeforeCreatedAt: null,
        proposalsBeforeId: null,
      });
      if (!detail.ok || detail.data === null) {
        recovery.push("Strategy " + item.title + " could not be read in full, so its evidence is not stated.");
        return null;
      }
      const parsed = StrategyLabDetailResultSchema.safeParse(detail.data);
      if (!parsed.success) {
        recovery.push("Strategy " + item.title + " returned a record this product could not read, so nothing is stated about it.");
        return null;
      }
      return {
        strategyId: parsed.data.strategy.strategyId,
        title: parsed.data.strategy.title,
        createdAt: parsed.data.strategy.createdAt,
        updatedAt: parsed.data.strategy.updatedAt,
        versions: versionRecords(parsed.data),
        runs: runRecords(parsed.data),
      };
    }),
  );

  return {
    records: records.filter((record): record is StrategyRecord => record !== null),
    listed: items.length,
    recovery,
  };
}

export function projectStrategySurface(input: Readonly<{
  reads: StrategyReads;
  asOf: string;
}>): StrategiesProjection {
  return projectStrategies({
    asOf: input.asOf,
    records: input.reads.records,
    recovery: input.reads.recovery,
  });
}
