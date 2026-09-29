import type { HomePortfolioProjection, HomeRiskCategory } from "@/lib/home/portfolio/read-model";
import { formatBps, formatMoney } from "@/lib/home/portfolio/format";
import type { ResearchProjection } from "@/lib/home/research/read-model";
import type { Entitlement } from "@/lib/home/research/mandate";
import type { MaterialChange } from "@/lib/home/research/change";
import type { DecisionsProjection } from "@/lib/home/advice/read-model";
import type { AdviceCase } from "@/lib/home/advice/advice-case";
import type { RynAnswerInput, RynFact, RynConflict, RynUnknownInput } from "@/lib/home/workbench/answer";
import type { RynQuestionContext } from "@/lib/home/workbench/question";
import { projectWorkbench, type WorkbenchProjection } from "@/lib/home/workbench/read-model";
import { loadHomeSourceReads, projectHomeSurface } from "@/app/app/portfolio/read";
import { loadResearchReads, projectResearchSurface, researchSourceStates } from "@/app/app/research/read";
import { loadDecisionReads, projectDecisionSurface } from "@/app/app/action-cases/read";

/**
 * Where the workbench's answers actually come from.
 *
 * Three reads, and **not one of them is new**. The Portfolio supplies what the
 * reader holds, how much of it could be priced and which constraints bind; the
 * Radar supplies what changed and which sources disagree; the decision queue
 * supplies what is waiting on a person. Everything after `loadAdviserReads` is
 * pure, so every state this surface can render is reachable in a test.
 *
 * **No model is called on this path.** The answers are compiled: a fact is a
 * reading a source already returned, a conflict is two readings the change
 * engine already refused to merge, a deterministic result is a share the
 * portfolio already computed with its own formula version. What a model would
 * add here is phrasing, and phrasing is exactly where an unpermitted
 * recommendation gets in.
 *
 * **One mapping decision worth stating.** The deterministic result for a
 * subject is the portfolio's own distribution share, not a figure recomputed
 * here. Recomputing it would produce a second answer to a question the
 * Portfolio already answers, and the two would drift on the first day one of
 * them changed its inclusion rule.
 */

export type AdviserReads = Readonly<{
  portfolio: HomePortfolioProjection | null;
  research: ResearchProjection | null;
  decisions: DecisionsProjection | null;
  recovery: readonly string[];
}>;

export async function loadAdviserReads(input: Readonly<{
  wallet: string | null;
  telegramId: number | null; accountId?: string | null;
  ownerRef: string;
  asOf: string;
}>): Promise<AdviserReads> {
  const recovery: string[] = [];

  const [portfolio, research, decisions] = await Promise.all([
    (async () => {
      try {
        const reads = await loadHomeSourceReads({ wallet: input.wallet, telegramId: input.telegramId });
        return projectHomeSurface({ reads, ownerRef: input.ownerRef, accountRef: input.ownerRef, asOf: input.asOf });
      } catch {
        recovery.push("The portfolio read did not complete, so nothing on this page states what you hold.");
        return null;
      }
    })(),
    (async () => {
      try {
        const reads = await loadResearchReads({ wallet: input.wallet, telegramId: input.telegramId });
        const projection = projectResearchSurface({ reads, ownerRef: input.ownerRef, asOf: input.asOf });
        /* The source states are read back beside the projection so a refusal
           keeps the provider's own words rather than becoming "unavailable". */
        void researchSourceStates(reads);
        return projection;
      } catch {
        recovery.push("The research read did not complete, so no change on this page was raised on this read.");
        return null;
      }
    })(),
    (async () => {
      try {
        const reads = await loadDecisionReads({
          wallet: input.wallet,
          telegramId: input.telegramId,
          ownerRef: input.ownerRef,
          asOf: input.asOf,
        });
        return projectDecisionSurface({ reads, ownerRef: input.ownerRef, asOf: input.asOf });
      } catch {
        recovery.push("The decision read did not complete, so nothing here states what is waiting on you.");
        return null;
      }
    })(),
  ]);

  return { portfolio, research, decisions, recovery };
}

const PORTFOLIO_SOURCE = "portfolio";

function coverageState(portfolio: HomePortfolioProjection | null): RynQuestionContext["coverage"] {
  if (portfolio === null) return "NONE";
  const bps = portfolio.coverage.positionCoverageBps;
  if (bps === null) return "NONE";
  return bps >= 10_000 ? "COMPLETE" : "PARTIAL";
}

/** Every disagreement the Radar found, flattened into the workbench's shape. */
function conflictsOf(change: MaterialChange): readonly RynConflict[] {
  if (change.conflict.length < 2) return [];
  return [
    {
      conflictId: change.id + ":conflict",
      subject: change.subjectLabel + " · " + change.factKey,
      readings: change.conflict.map((entry) => ({
        sourceId: entry.sourceId,
        label: entry.sourceId,
        value: entry.value,
        observedAt: entry.observedAt,
      })),
      reason: "Two sources report a different value for the same fact, and neither is preferred here.",
    },
  ];
}

function unknownsOf(change: MaterialChange): readonly RynUnknownInput[] {
  return change.unknown.map((missing, index) => ({
    unknownId: change.id + ":unknown:" + String(index),
    missingKey: change.factKey,
    missingFact: missing,
    why: "The source that would carry it did not report it on this read.",
    blocking: true,
  }));
}

/**
 * The entitlement a source was read under, looked up rather than invented.
 *
 * An earlier draft wrote `SOURCE_DECLARED` here, which is not a value the
 * entitlement union contains — a fabricated vocabulary word on an evidence
 * surface. The Radar records the real one per source; a source it does not
 * record is `NONE`, which is the honest answer rather than a guess.
 */
function entitlementOf(
  research: ResearchProjection | null,
  sourceId: string,
): Entitlement {
  return research?.sources.find((source) => source.sourceId === sourceId)?.entitlement ?? "NONE";
}

function changeFacts(change: MaterialChange, research: ResearchProjection | null): readonly RynFact[] {
  const facts: RynFact[] = [];
  if (change.current !== null) {
    facts.push({
      key: change.factKey,
      statement: change.subjectLabel + " reports " + change.factKey + " at " + change.current.value + ".",
      value: change.current.value,
      sourceId: change.current.source,
      sourceLabel: change.current.source,
      observedAt: change.current.observedAt ?? change.observedAt ?? "",
      freshness: change.observedAt === null ? "UNKNOWN" : "CURRENT",
      entitlement: entitlementOf(research, change.current.source),
    });
  }
  if (change.previous !== null) {
    facts.push({
      key: change.factKey + ":previous",
      statement: "The previous recorded value was " + change.previous.value + ".",
      value: change.previous.value,
      sourceId: change.previous.source,
      sourceLabel: change.previous.source,
      observedAt: change.previous.observedAt ?? "",
      freshness: change.previous.observedAt === null ? "UNKNOWN" : "CURRENT",
      entitlement: entitlementOf(research, change.previous.source),
    });
  }
  return facts;
}

/** The share of priced value this subject carries, taken from the Portfolio. */
function subjectShare(
  portfolio: HomePortfolioProjection | null,
  subjectLabel: string,
): Readonly<{ statement: string; value: string; basis: string; inputDigest: string }> | null {
  if (portfolio === null) return null;
  const slice = portfolio.distribution.find((entry) => entry.key === subjectLabel);
  if (slice === undefined) return null;
  return {
    statement:
      subjectLabel + " is " + formatBps(slice.shareBps) + " of priced value, at " + formatMoney(slice.value) + ".",
    value: formatBps(slice.shareBps),
    basis: portfolio.distributionBasis,
    inputDigest: portfolio.calculation.inputDigest,
  };
}

function riskReference(portfolio: HomePortfolioProjection | null): RynAnswerInput["risk"] {
  if (portfolio === null) {
    return { state: "UNAVAILABLE", reference: null, reason: "The portfolio read did not complete on this request." };
  }
  return { state: "AVAILABLE", reference: portfolio.calculation.inputDigest, reason: null };
}

function sourceVersions(
  portfolio: HomePortfolioProjection | null,
  research: ResearchProjection | null,
): readonly Readonly<{ sourceId: string; label: string; version: string }>[] {
  const versions: Readonly<{ sourceId: string; label: string; version: string }>[] = [];
  if (portfolio !== null) {
    versions.push({
      sourceId: PORTFOLIO_SOURCE,
      label: "Portfolio calculation",
      version: portfolio.calculation.formulaVersion,
    });
  }
  if (research !== null) {
    versions.push({
      sourceId: "mandate",
      label: "Research mandate",
      version: research.mandate.version,
    });
  }
  return versions;
}

function riskCategoryAnswer(
  category: HomeRiskCategory,
  portfolio: HomePortfolioProjection,
  research: ResearchProjection | null,
  asOf: string,
): RynAnswerInput {
  const binding = category.constraints.find((constraint) => constraint.status === "EXCEEDED")
    ?? category.constraints[0]
    ?? null;

  const facts: RynFact[] = category.metrics
    .filter((metric) => metric.state === "KNOWN" && metric.value !== null)
    .map((metric) => ({
      key: category.id + ":" + metric.id,
      statement: metric.id + " measures " + formatMoney(metric.value as NonNullable<typeof metric.value>) + ".",
      value: formatMoney(metric.value as NonNullable<typeof metric.value>),
      sourceId: PORTFOLIO_SOURCE,
      sourceLabel: "Portfolio calculation",
      observedAt: portfolio.asOf,
      freshness: "CURRENT",
      entitlement: "OWN_ACCOUNT",
    }));

  const unknowns: RynUnknownInput[] = category.metrics
    .filter((metric) => metric.state !== "KNOWN")
    .map((metric) => ({
      unknownId: category.id + ":" + metric.id,
      missingKey: category.id + ":" + metric.id,
      missingFact: metric.id,
      why: metric.reasons[0] ?? "No source reported this metric.",
      blocking: true,
    }));

  return {
    asOf,
    question: {
      questionId: "rq_risk_" + category.id,
      prompt:
        "Which " + category.id + " constraint is " + category.status.toLowerCase() + ", and on what basis was it measured?",
      operation: "EXPLAIN",
      subjectLabel: category.id,
      subjectHref: "/app/portfolio",
    },
    plainAnswer: facts.length === 0
      ? null
      : "The " + category.id + " category is " + category.status.toLowerCase() + " against the limits recorded for it.",
    facts,
    conflicts: [],
    unknowns,
    scenarios: [],
    relevance: {
      state: "RELEVANT",
      positions: [String(portfolio.books.live.positionCount + portfolio.books.paper.positionCount) + " position(s) in scope"],
      plans: [],
      reason: null,
    },
    deterministic: binding === null || binding.status === "UNKNOWN"
      ? null
      : {
          statement: binding.id + " is " + binding.status.toLowerCase() + " against its recorded limit.",
          value: binding.status,
          basis: portfolio.distributionBasis,
          inputDigest: portfolio.calculation.inputDigest,
        },
    risk: riskReference(portfolio),
    nextSteps: [
      { kind: "REVIEW_EVIDENCE", label: "Open the portfolio risk detail", href: category.detailHref, reason: null },
    ],
    sourceVersions: sourceVersions(portfolio, research),
  };
}

function caseAnswer(
  advice: AdviceCase,
  portfolio: HomePortfolioProjection | null,
  research: ResearchProjection | null,
  asOf: string,
): RynAnswerInput {
  const subjectLabel = advice.trigger.subjectLabel;
  const facts: RynFact[] = advice.evidence.items.map((item, index) => ({
    key: advice.caseId + ":evidence:" + String(index),
    statement: item.label + (item.reason === null ? "" : " — " + item.reason),
    value: null,
    sourceId: item.sourceId,
    sourceLabel: item.label,
    observedAt: item.observedAt ?? "",
    freshness: item.state === "OK" ? "CURRENT" : item.state === "STALE" ? "STALE" : "UNKNOWN",
    entitlement: item.entitlement,
  }));

  /* One conflict object, carrying every disagreeing reading. The case records
     the entries; grouping them here is presentation, not resolution. */
  const conflicts: readonly RynConflict[] = advice.evidence.conflicts.length < 2
    ? []
    : [
        {
          conflictId: advice.caseId + ":conflict",
          subject: subjectLabel,
          readings: advice.evidence.conflicts.map((entry) => ({
            sourceId: entry.sourceId,
            label: entry.sourceId,
            value: entry.value,
            observedAt: entry.observedAt,
          })),
          reason: "Two sources report a different value for this subject and neither is preferred here.",
        },
      ];

  return {
    asOf,
    question: {
      questionId: "rq_case_" + advice.caseId.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
      prompt: "What is the decision on " + subjectLabel + " waiting on?",
      operation: "EXPLAIN",
      subjectLabel,
      subjectHref: "/app/action-cases/" + advice.caseId,
    },
    plainAnswer: facts.length === 0 ? null : advice.openQuestion,
    facts,
    conflicts,
    unknowns: advice.evidence.unknowns.map((missing, index) => ({
      unknownId: advice.caseId + ":unknown:" + String(index),
      missingKey: advice.caseId + ":unknown:" + String(index),
      missingFact: missing,
      why: "The source that would carry it did not report it on this read.",
      blocking: true,
    })),
    scenarios: [],
    relevance: {
      state: "RELEVANT",
      positions: [subjectLabel],
      plans: [],
      reason: null,
    },
    deterministic: subjectShare(portfolio, subjectLabel),
    risk: riskReference(portfolio),
    nextSteps: [
      { kind: "RECORD_DECISION", label: "Open the case", href: "/app/action-cases/" + advice.caseId, reason: null },
    ],
    sourceVersions: sourceVersions(portfolio, research),
  };
}

export function projectAdviserSurface(input: Readonly<{
  reads: AdviserReads;
  asOf: string;
  selectedQuestionId: string | null;
}>): WorkbenchProjection {
  const { portfolio, research, decisions } = input.reads;

  const changes = (research?.changes ?? []).filter((change) => change.state !== "IMMATERIAL");
  const conflictSubjects = changes
    .filter((change) => change.conflict.length >= 2)
    .map((change) => ({
      conflictId: change.id,
      subject: change.subjectLabel + " · " + change.factKey,
      sourceCount: change.conflict.length,
    }));

  const riskCategories = (portfolio?.risk ?? []).map((category) => ({
    id: category.id,
    status: category.status,
  }));

  const queue = (decisions?.queue ?? []).map((advice) => ({
    caseId: advice.caseId,
    subjectLabel: advice.trigger.subjectLabel,
  }));

  const context: RynQuestionContext = {
    changes: changes.map((change) => ({
      changeId: change.id,
      subjectLabel: change.subjectLabel,
      state: change.state,
      conflictCount: change.conflict.length,
      unknownCount: change.unknown.length,
    })),
    conflicts: conflictSubjects,
    riskCategories,
    coverage: coverageState(portfolio),
    queue,
    holdings: portfolio === null
      ? []
      : portfolio.distribution.map((slice) => ({ label: slice.key })),
  };

  const answerInputs: (readonly [string, RynAnswerInput])[] = [];

  for (const change of changes) {
    const questionId = "rq_change_" + change.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    answerInputs.push([
      questionId,
      {
        asOf: input.asOf,
        question: {
          questionId,
          prompt: "What changed on " + change.subjectLabel + ", and what does it touch that I hold?",
          operation: "EXPLAIN",
          subjectLabel: change.subjectLabel,
          subjectHref: "/app/research",
        },
        plainAnswer: change.current === null
          ? null
          : "The Radar measured a " + change.kind.toLowerCase().replace(/_/g, " ") + " on " + change.subjectLabel + ".",
        facts: changeFacts(change, research),
        conflicts: conflictsOf(change),
        unknowns: unknownsOf(change),
        scenarios: change.effectiveAt === null
          ? []
          : [
              {
                scenarioId: change.id + ":effective",
                label: "When the declared value takes effect",
                assumption: "The declared value replaces the current one on the effective date.",
                effect: "The reported figure changes to the declared one; nothing about your holding is transacted.",
                requires: [change.factKey],
                basis: "Declared by the source",
              },
            ],
        relevance: portfolio === null
          ? { state: "UNKNOWN", positions: [], plans: [], reason: "The portfolio read did not complete, so what this touches is unknown." }
          : portfolio.distribution.some((slice) => slice.key === change.subjectLabel)
            ? { state: "RELEVANT", positions: [change.subjectLabel], plans: [], reason: null }
            : { state: "NOT_RELEVANT", positions: [], plans: [], reason: "Nothing priced in your portfolio carries this subject." },
        deterministic: subjectShare(portfolio, change.subjectLabel),
        risk: riskReference(portfolio),
        nextSteps: [{ kind: "REVIEW_EVIDENCE", label: "Open the change on the Radar", href: "/app/research", reason: null }],
        sourceVersions: sourceVersions(portfolio, research),
      },
    ]);
  }

  for (const conflict of conflictSubjects) {
    const change = changes.find((entry) => entry.id === conflict.conflictId);
    if (change === undefined) continue;
    const questionId = "rq_conflict_" + conflict.conflictId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    answerInputs.push([
      questionId,
      {
        asOf: input.asOf,
        question: {
          questionId,
          prompt: "Which sources disagree about " + conflict.subject + ", and by how much?",
          operation: "COMPARE",
          subjectLabel: conflict.subject,
          subjectHref: "/app/research",
        },
        plainAnswer: String(conflict.sourceCount) + " sources report a different value for the same fact.",
        facts: changeFacts(change, research),
        conflicts: conflictsOf(change),
        unknowns: unknownsOf(change),
        scenarios: [],
        relevance: { state: "UNKNOWN", positions: [], plans: [], reason: "Sources disagree, so what this touches cannot be stated from here." },
        /* Deliberately none: a number computed over readings that disagree is
           the averaging this product refuses. */
        deterministic: null,
        risk: riskReference(portfolio),
        nextSteps: [{ kind: "COMPARE_SOURCES", label: "Open the sources on the Radar", href: "/app/research", reason: null }],
        sourceVersions: sourceVersions(portfolio, research),
      },
    ]);
  }

  if (portfolio !== null) {
    for (const category of portfolio.risk) {
      if (category.status === "WITHIN") continue;
      answerInputs.push(["rq_risk_" + category.id, riskCategoryAnswer(category, portfolio, research, input.asOf)]);
    }

    if (coverageState(portfolio) !== "COMPLETE") {
      answerInputs.push([
        "rq_coverage",
        {
          asOf: input.asOf,
          question: {
            questionId: "rq_coverage",
            prompt: "What part of what I hold could not be priced, and why?",
            operation: "EXPLAIN",
            subjectLabel: "Valuation coverage",
            subjectHref: "/app/portfolio",
          },
          plainAnswer:
            String(portfolio.coverage.includedPositionCount) +
            " of " +
            String(portfolio.coverage.eligiblePositionCount) +
            " eligible positions carry a price.",
          facts: [
            {
              key: "coverage",
              statement:
                "Position coverage is " + formatBps(portfolio.coverage.positionCoverageBps) + " of eligible positions.",
              value: formatBps(portfolio.coverage.positionCoverageBps),
              sourceId: PORTFOLIO_SOURCE,
              sourceLabel: "Portfolio calculation",
              observedAt: portfolio.asOf,
              freshness: "CURRENT",
              entitlement: "OWN_ACCOUNT",
            },
          ],
          conflicts: [],
          unknowns: portfolio.coverageLimit.map((limit, index) => ({
            unknownId: "coverage:" + String(index),
            missingKey: "coverage:" + String(index),
            missingFact: limit,
            why: "The source that would price it did not return one.",
            blocking: true,
          })),
          scenarios: [],
          relevance: {
            state: "RELEVANT",
            positions: [String(portfolio.coverage.eligiblePositionCount) + " eligible position(s)"],
            plans: [],
            reason: null,
          },
          deterministic: null,
          risk: riskReference(portfolio),
          nextSteps: [{ kind: "REVIEW_EVIDENCE", label: "Open coverage in the Portfolio", href: "/app/portfolio", reason: null }],
          sourceVersions: sourceVersions(portfolio, research),
        },
      ]);
    }
  }

  for (const advice of decisions?.queue ?? []) {
    const questionId = "rq_case_" + advice.caseId.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    answerInputs.push([questionId, caseAnswer(advice, portfolio, research, input.asOf)]);
  }

  return projectWorkbench({
    asOf: input.asOf,
    context,
    answerInputs,
    selectedQuestionId: input.selectedQuestionId,
    drafts: [],
    recovery: input.reads.recovery,
  });
}
