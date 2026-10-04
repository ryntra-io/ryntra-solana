import type { HomePortfolioProjection } from "@/lib/home/portfolio/read-model";
import type { ResearchProjection } from "@/lib/home/research/read-model";
import type { DecisionsProjection } from "@/lib/home/advice/read-model";
import { loadHomeSourceReads, projectHomeSurface } from "@/app/app/portfolio/read";
import { loadResearchReads, projectResearchSurface } from "@/app/app/research/read";
import { loadDecisionReads, projectDecisionSurface } from "@/app/app/action-cases/read";

/**
 * The three projections Home's summary surfaces stand on.
 *
 * The Brief, Alerts, Coverage and Operations all need some subset of the
 * Portfolio, the Radar and the decision queue, and all four would otherwise
 * repeat the same guarded triple-load with slightly different wording in its
 * failure branches. One loader means one definition of what "the portfolio read
 * did not complete" does — and, more importantly, one place where a failure
 * turns into a *named recovery sentence* rather than an empty object that later
 * reads as calm.
 *
 * Nothing here computes a product fact. Each surface's own `read.ts` maps these
 * projections into that surface's compiler input, and the compiler owns what
 * anything means.
 */

export type HomeReads = Readonly<{
  portfolio: HomePortfolioProjection | null;
  research: ResearchProjection | null;
  decisions: DecisionsProjection | null;
  recovery: readonly string[];
}>;

export async function loadHomeReads(input: Readonly<{
  wallet: string | null;
  telegramId: number | null; accountId?: string | null;
  ownerRef: string;
  asOf: string;
  want?: Readonly<{ portfolio?: boolean; research?: boolean; decisions?: boolean }>;
}>): Promise<HomeReads> {
  const want = {
    portfolio: input.want?.portfolio ?? true,
    research: input.want?.research ?? true,
    decisions: input.want?.decisions ?? true,
  };
  const recovery: string[] = [];

  const [portfolio, research, decisions] = await Promise.all([
    (async () => {
      if (!want.portfolio) return null;
      try {
        const reads = await loadHomeSourceReads({ wallet: input.wallet, telegramId: input.telegramId });
        return projectHomeSurface({ reads, ownerRef: input.ownerRef, accountRef: input.ownerRef, asOf: input.asOf });
      } catch {
        recovery.push("The portfolio read did not complete, so nothing here states a position, a valuation or a risk category.");
        return null;
      }
    })(),
    (async () => {
      if (!want.research) return null;
      try {
        const reads = await loadResearchReads({ wallet: input.wallet, telegramId: input.telegramId });
        return projectResearchSurface({ reads, ownerRef: input.ownerRef, asOf: input.asOf });
      } catch {
        recovery.push("The research read did not complete, so nothing here states a monitor rule, a source or a material change.");
        return null;
      }
    })(),
    (async () => {
      if (!want.decisions) return null;
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
