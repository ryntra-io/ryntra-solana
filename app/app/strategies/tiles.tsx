import Link from "next/link";
import {
  ArrowRight,
  ChartLineUp,
  CheckCircle,
  Flask,
  GitBranch,
  ListChecks,
  Prohibit,
  Stack,
} from "@phosphor-icons/react/dist/ssr";

import { StateChip } from "@/app/app/portfolio/tiles";
import { BACKTEST_REQUIREMENT_LABEL, type BacktestAssessment } from "@/lib/home/strategy/backtest";
import { STRATEGY_STATES, STRATEGY_STATE_LABEL, type StrategyState } from "@/lib/home/strategy/lifecycle";
import type { StrategiesProjection, StrategyProjection } from "@/lib/home/strategy/read-model";
import styles from "@/app/app/home-surface.module.css";

/**
 * The strategy lifecycle's display layer.
 *
 * Everything here reads a field off the projection. The one thing this layer
 * decides is *presentation of absence*: a state nothing records is rendered as
 * a greyed step on the ladder with its reason, rather than left off it. A
 * lifecycle drawn only as far as it can currently reach reads like a product
 * where nobody ever approved anything; drawn in full with the unreachable half
 * greyed, it reads as what it is — a store that records evidence and does not
 * yet record decisions.
 */

type Tone = "good" | "caution" | "risk" | "unknown" | "quiet";

export const SectionIcons = {
  strategies: <Stack size={17} weight="bold" aria-hidden />,
  lifecycle: <ChartLineUp size={17} weight="bold" aria-hidden />,
  versions: <GitBranch size={17} weight="bold" aria-hidden />,
  evidence: <Flask size={17} weight="bold" aria-hidden />,
  requirements: <ListChecks size={17} weight="bold" aria-hidden />,
  unreachable: <Prohibit size={17} weight="bold" aria-hidden />,
} as const;

export function surfaceTone(state: StrategiesProjection["state"]): Tone {
  if (state === "CALM") return "good";
  if (state === "ATTENTION" || state === "DEGRADED") return "caution";
  return "unknown";
}

/**
 * A stage is where a strategy is, not a problem with it.
 *
 * Found by looking: `BACKTEST` rendered with an amber warning triangle, and so
 * did the `NOW` marker on the ladder — so a strategy at a perfectly normal
 * stage read as a strategy in trouble. The decision surfaces learned the same
 * lesson one wave earlier when `LIVE` carried a warning tone. Only the two
 * states that mean *this stopped being usable* keep a warning.
 */
export function stateTone(state: StrategyState): Tone {
  if (state === "FORWARD_PAPER" || state === "APPROVED" || state === "ACTIVE") return "good";
  if (state === "INVALIDATED" || state === "EXPIRED") return "risk";
  return "quiet";
}

/** `SELF_ATTESTED` is an enum; a reader needs the words. */
const STRENGTH_LABEL: Readonly<Record<BacktestAssessment["strength"], string>> = {
  BLIND: "Out-of-sample, blind",
  SELF_ATTESTED: "Out-of-sample, self-attested",
  NONE: "No out-of-sample",
  UNSTATED: "Out-of-sample not stated",
};

export function StrategyList({
  strategies,
  empty,
}: {
  strategies: readonly StrategyProjection[];
  empty: string;
}) {
  if (strategies.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.questions}>
      {strategies.map((strategy) => (
        /* The whole row is the link. Measuring found the title alone was a
           19px-tall target — a real destination a thumb could not hit. */
        <li key={strategy.strategyId}>
          <Link className={`${styles.question} ${styles.stackedRow}`} href={strategy.href}>
            <span className={styles.questionBody}>
              <span className={styles.questionPrompt}>{strategy.title}</span>
              <span className={styles.rowMeta}>
                <StateChip tone={stateTone(strategy.state)} label={strategy.stateLabel} />
                <b>v{strategy.latestVersion?.versionNumber ?? "—"}</b>
                <span>{strategy.versionCount} version(s)</span>
                <span>{strategy.evidence.length} run(s)</span>
              </span>
              <span className={styles.rowReason}>{strategy.stateReason}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The full ladder, with the half nothing records greyed rather than omitted.
 *
 * Drawn as a tile grid rather than as eleven full-width rows. Found by looking:
 * the row form was eleven stacked bands, four of them a single word in a lot of
 * empty space and seven of them three lines tall — a page of lifecycle where a
 * reader needed a glance. The tiles say the same eleven things in a quarter of
 * the height, and the unreachable ones keep their reason on the tile.
 */
export function Lifecycle({
  current,
  unreachable,
}: {
  current: StrategyState | null;
  unreachable: StrategiesProjection["unreachable"];
}) {
  const blocked = new Map(unreachable.map((entry) => [entry.state, entry.reason]));
  return (
    <div className={styles.tiles}>
      {STRATEGY_STATES.map((state) => {
        const reason = blocked.get(state);
        return (
          <article key={state} className={styles.tile} data-state={state}>
            <header className={styles.tileHead}>
              <span>{STRATEGY_STATE_LABEL[state]}</span>
              {/* Every tile carries a chip, and the four derivable states say so.
                  Found by looking: with a chip only on the seven unreachable
                  ones, the other four rendered as tall empty boxes that read as
                  "nothing to say here" rather than "this one the records can
                  reach". */}
              {state === current
                ? <StateChip tone={stateTone(state)} label="Now" />
                : reason === undefined
                  ? <StateChip tone="quiet" label="From records" />
                  : <StateChip tone="unknown" label="Not recorded" />}
            </header>
            {reason === undefined ? null : <p className={styles.tileNote}>{reason}</p>}
          </article>
        );
      })}
    </div>
  );
}

export function Versions({ strategy }: { strategy: StrategyProjection }) {
  if (strategy.materialChanges.length === 0) {
    return (
      <p className={styles.empty}>
        One version is recorded, so there is no change between versions to describe yet.
      </p>
    );
  }
  return (
    <ul className={styles.rows}>
      {strategy.materialChanges.map((change) => (
        <li key={`${change.fromVersion}-${change.toVersion}`} className={`${styles.row} ${styles.stackedRow}`}>
          <span className={styles.rowBody}>
            <span className={styles.rowName}>
              v{change.fromVersion} → v{change.toVersion}
            </span>
            <span className={styles.rowMeta}>
              {/* Quiet, not amber: a material rule change is why the version
                  exists, and toning it as a warning made a correct history read
                  as a list of problems. */}
              <StateChip
                tone="quiet"
                label={change.fields.length > 0 ? `${change.fields.length} rule field(s)` : "No rule change"}
              />
              {change.fields.map((field) => <b key={field}>{field}</b>)}
            </span>
            <span className={styles.rowReason}>{change.reason}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Evidence({ assessments }: { assessments: readonly BacktestAssessment[] }) {
  if (assessments.length === 0) {
    return <p className={styles.empty}>No backtest run is recorded against any version of this strategy.</p>;
  }
  return (
    <ul className={styles.rows}>
      {assessments.map((assessment) => (
        <li key={assessment.runId} className={`${styles.row} ${styles.stackedRow}`}>
          <span className={styles.rowBody}>
            <span className={styles.rowName}>
              <StateChip
                tone={assessment.state === "EVIDENCE" ? "good" : "caution"}
                label={assessment.state === "EVIDENCE" ? "Evidence" : "Incomplete"}
              />
              {" "}
              {assessment.trades === null ? "trades not stated" : `${assessment.trades} trades`}
            </span>
            <span className={styles.rowMeta}>
              <StateChip tone={assessment.strength === "BLIND" ? "good" : "unknown"} label={STRENGTH_LABEL[assessment.strength]} />
              <b>
                {assessment.maxDrawdownPercent === null
                  ? "drawdown not stated"
                  : `max drawdown ${assessment.maxDrawdownPercent}%`}
              </b>
              {assessment.parameterSensitivity === null ? null : <span>sensitivity {assessment.parameterSensitivity}</span>}
              {assessment.regimesCovered === null ? null : <span>{assessment.regimesCovered} regime(s)</span>}
            </span>
            <Requirements assessment={assessment} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Seven requirements, each satisfied or refused by name. */
export function Requirements({ assessment }: { assessment: BacktestAssessment }) {
  return (
    <>
      <span className={styles.structure}>
        {assessment.satisfied.map((requirement) => (
          <span key={requirement} className={styles.structureItem}>
            <StateChip tone="good" label={BACKTEST_REQUIREMENT_LABEL[requirement]} />
          </span>
        ))}
        {assessment.missing.map((requirement) => (
          <span key={requirement} className={styles.structureItem}>
            <StateChip tone="unknown" label={BACKTEST_REQUIREMENT_LABEL[requirement]} />
          </span>
        ))}
      </span>
      {assessment.missing.map((requirement) => (
        <span key={requirement} className={styles.rowReason}>
          {assessment.reasons[requirement]}
        </span>
      ))}
    </>
  );
}

export function Approval({ strategy }: { strategy: StrategyProjection }) {
  return (
    <div className={`${styles.row} ${styles.stackedRow}`}>
      <span className={styles.rowBody}>
        <span className={styles.rowName}>
          {strategy.approval.ok ? (
            <><CheckCircle size={15} weight="fill" aria-hidden /> Evidence permits an approval decision</>
          ) : (
            <><Prohibit size={15} weight="bold" aria-hidden /> Evidence does not permit an approval decision</>
          )}
        </span>
        <span className={styles.rowReason}>{strategy.approval.reason}</span>
        <span className={styles.rowMeta}>
          <StateChip tone="quiet" label="Decision is yours" />
        </span>
      </span>
    </div>
  );
}

export function LabLink() {
  return (
    <div className={styles.actions}>
      <Link className={styles.link} href="/app/strategy-lab">
        Strategy Lab <ArrowRight size={13} weight="bold" aria-hidden />
      </Link>
    </div>
  );
}
