import type { HomePortfolioProjection } from "@/lib/home/portfolio/read-model";
import type { ResearchProjection } from "@/lib/home/research/read-model";
import type { DecisionsProjection } from "@/lib/home/advice/read-model";
import { buildControlProjection, type ControlInput, type ControlProjection } from "@/lib/home/control/projection";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { loadHomeSourceReads, projectHomeSurface } from "@/app/app/portfolio/read";
import { loadResearchReads, projectResearchSurface } from "@/app/app/research/read";
import { loadDecisionReads, projectDecisionSurface } from "@/app/app/action-cases/read";

/**
 * Where the control projections come from — and every one of them comes from
 * somewhere else.
 *
 * That sentence is the whole design. This route reads the Portfolio, the Radar
 * and the decision queue, and turns each into a tile that names the surface it
 * came from and links to it. **No fact is computed here.** A commitment count
 * is the Portfolio's; a rule count is the Radar's; a queue length is the
 * decision surface's. If a number on this page and the number on its owning
 * surface ever disagreed, this file would be the bug — so it is written to have
 * no arithmetic in it at all.
 *
 * The one thing this layer adds is **absence**: Agent Control's own cases live
 * in one browser tab's session storage, and the tile that says so is built here
 * rather than read from anywhere, because there is nothing to read.
 */

export type ControlReads = Readonly<{
  portfolio: HomePortfolioProjection | null;
  research: ResearchProjection | null;
  decisions: DecisionsProjection | null;
  recovery: readonly string[];
}>;

/**
 * The reader-facing literals this mapping layer authors — recovery lines and
 * absence reasons — per locale, in this file. Release checks regex this source
 * for the exact English strings; English is byte-identical to what shipped and
 * `uk` is its twin. Everything else on the surface arrives from the owning
 * projections and passes through untouched.
 */
type ControlReadCopy = Readonly<{
  portfolioFailed: string;
  researchFailed: string;
  decisionsFailed: string;
  noCommitmentStated: string;
  noCommitmentCategory: string;
  noRuleStated: string;
}>;

const COPY = {
  en: {
    portfolioFailed: "The portfolio read did not complete, so its risk and commitment tiles state nothing.",
    researchFailed: "The research read did not complete, so the monitoring tiles state nothing.",
    decisionsFailed: "The decision read did not complete, so nothing here states what is waiting on you.",
    noCommitmentStated: "The portfolio read did not complete, so no commitment is stated.",
    noCommitmentCategory: "The portfolio calculation reported no commitment category on this read.",
    noRuleStated: "The research read did not complete, so no rule is stated.",
  },
  uk: {
    portfolioFailed: "Читання портфеля не завершилося, тому його плитки ризику та зобовʼязань нічого не стверджують.",
    researchFailed: "Читання досліджень не завершилося, тому плитки моніторингу нічого не стверджують.",
    decisionsFailed: "Читання рішень не завершилося, тому тут ніщо не каже, що чекає на вас.",
    noCommitmentStated: "Читання портфеля не завершилося, тому жодне зобовʼязання не стверджується.",
    noCommitmentCategory: "Розрахунок портфеля не повідомив категорію зобовʼязань у цьому читанні.",
    noRuleStated: "Читання досліджень не завершилося, тому жодне правило не стверджується.",
  },
} as const satisfies Record<WorkspaceLocale, ControlReadCopy>;

export async function loadControlReads(input: Readonly<{
  wallet: string | null;
  telegramId: number | null; accountId?: string | null;
  ownerRef: string;
  asOf: string;
  locale?: WorkspaceLocale;
}>): Promise<ControlReads> {
  const c = COPY[input.locale ?? "en"];
  const recovery: string[] = [];

  const [portfolio, research, decisions] = await Promise.all([
    (async () => {
      try {
        const reads = await loadHomeSourceReads({ wallet: input.wallet, telegramId: input.telegramId });
        return projectHomeSurface({ reads, ownerRef: input.ownerRef, accountRef: input.ownerRef, asOf: input.asOf });
      } catch {
        recovery.push(c.portfolioFailed);
        return null;
      }
    })(),
    (async () => {
      try {
        const reads = await loadResearchReads({ wallet: input.wallet, telegramId: input.telegramId });
        return projectResearchSurface({ reads, ownerRef: input.ownerRef, asOf: input.asOf });
      } catch {
        recovery.push(c.researchFailed);
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
        recovery.push(c.decisionsFailed);
        return null;
      }
    })(),
  ]);

  return { portfolio, research, decisions, recovery };
}

/** Agent commitments, taken from the Portfolio's own commitment category. */
function commitments(portfolio: HomePortfolioProjection | null, c: ControlReadCopy): ControlInput["commitments"] {
  if (portfolio === null) {
    return {
      count: 0,
      state: "UNKNOWN",
      value: null,
      reason: c.noCommitmentStated,
      observedAt: null,
    };
  }
  const category = portfolio.risk.find((entry) => entry.id === "COMMITMENTS");
  if (category === undefined) {
    return {
      count: 0,
      state: "UNKNOWN",
      value: null,
      reason: c.noCommitmentCategory,
      observedAt: portfolio.asOf,
    };
  }
  const known = category.metrics.filter((metric) => metric.state === "KNOWN");
  return {
    count: known.length,
    state: category.status === "WITHIN" ? "OK" : category.status === "UNKNOWN" ? "UNKNOWN" : "ATTENTION",
    value: String(known.length),
    reason: category.limitations[0] ?? null,
    observedAt: portfolio.asOf,
  };
}

function monitoring(research: ResearchProjection | null, c: ControlReadCopy): ControlInput["monitoring"] {
  if (research === null) {
    return {
      ruleCount: 0,
      scheduledCount: 0,
      unenrolledCount: 0,
      state: "UNKNOWN",
      reason: c.noRuleStated,
      observedAt: null,
    };
  }
  const scheduled = research.rules.filter((rule) => rule.mode === "SCHEDULE");
  /* Not "due": the scheduler's own next-occurrence is always computed forward
     of `asOf`, so a rule is never observed late. What *is* observable, and is
     the fact a control surface needs, is a rule that declares a schedule with
     nothing enrolled to run it. */
  const unenrolled = scheduled.filter((rule) => !rule.run.enrolled);
  return {
    ruleCount: research.rules.length,
    scheduledCount: scheduled.length,
    unenrolledCount: unenrolled.length,
    state: research.state === "DEGRADED" ? "DEGRADED" : research.state === "UNKNOWN" ? "UNKNOWN" : "OK",
    reason: research.recovery[0] ?? null,
    observedAt: research.asOf,
  };
}

export function projectControlSurface(input: Readonly<{
  reads: ControlReads;
  asOf: string;
  locale?: WorkspaceLocale;
}>): ControlProjection {
  const { portfolio, research, decisions } = input.reads;
  const c = COPY[input.locale ?? "en"];

  return buildControlProjection({
    asOf: input.asOf,
    commitments: commitments(portfolio, c),
    monitoring: monitoring(research, c),
    sources: (research?.sources ?? []).map((source) => ({
      sourceId: source.sourceId,
      label: source.label,
      state: source.state,
      reason: source.reason,
      observedAt: research?.asOf ?? null,
    })),
    risk: (portfolio?.risk ?? []).map((category) => ({
      id: category.id,
      status: category.status,
      detailHref: category.detailHref,
    })),
    waiting: {
      queueCount: decisions?.counts.queue ?? 0,
      openActionCount: decisions?.counts.openActions ?? 0,
    },
    recovery: input.reads.recovery,
  });
}
