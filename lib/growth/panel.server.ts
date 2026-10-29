import { readBusinessInputs } from "../admin/business.server.ts";
import type { SourceState } from "../admin/business.ts";
import { resolveInternalWallets } from "../admin/internal-wallets.ts";
import type { GuardStore } from "../guard/store.ts";
import { budgetMonthOf, readGrowthBudget } from "../rewards/budget.ts";
import { projectPanel, type PanelBudget, type PanelInputs, type PanelModel, type PanelRange } from "./panel.ts";
import { touchKeyFrom } from "./touch.ts";
import { listPostCodes, listTouchWallets, readVisits } from "./touch-store.ts";

/**
 * The store reads behind the growth panel, and nothing else. The records «Аналітика» reads are read by its own
 * reader (`readBusinessInputs`), so the two pages count the same rows the same way; the panel's own three and the
 * month's budget are read beside them. A record that fails to read answers `unavailable` for the figures that
 * depend on it; nothing here throws into a route.
 */

async function settle<T>(work: Promise<T>): Promise<Readonly<{ status: SourceState; value: T | null }>> {
  try {
    return { status: "measured", value: await work };
  } catch {
    return { status: "unavailable", value: null };
  }
}

const usd = (micros: bigint) => Number(micros) / 1_000_000;

export async function readPanelInputs(
  store: GuardStore,
  args: Readonly<{ now: string; range: PanelRange; env: NodeJS.ProcessEnv }>,
): Promise<PanelInputs> {
  const [business, visits, touches, posts, budget, internal] = await Promise.all([
    readBusinessInputs(store, { now: args.now, range: args.range, scope: "external", env: args.env }),
    settle(readVisits(store)),
    settle(listTouchWallets(store)),
    settle(listPostCodes(store)),
    settle(readGrowthBudget(store, budgetMonthOf(args.now))),
    /* The business reader keeps the wallets and drops whether the owner's list read; the panel says so. */
    resolveInternalWallets(store, args.env),
  ]);
  const month: PanelBudget | null = budget.value
    ? {
        month: budget.value.month,
        limitUsd: usd(budget.value.limitUsdMicros),
        spentUsd: usd(budget.value.spentUsdMicros),
        leftUsd: usd(budget.value.leftUsdMicros),
        reconciled: budget.value.reconciled,
      }
    : null;
  return {
    now: args.now,
    range: args.range,
    /* One read of the owner's list decides both what is excluded and whether the panel warns. */
    business: { ...business, internalWallets: internal.wallets },
    visits: visits.value ?? [],
    touches: touches.value ?? [],
    posts: posts.value ?? [],
    budget: month,
    sources: { visits: visits.status, touches: touches.status, posts: posts.status, budget: budget.status },
    internalWallets: internal.store === "unavailable" ? "unavailable" : "measured",
    touchSigning: touchKeyFrom(args.env) !== null,
  };
}

export async function readPanelModel(
  store: GuardStore,
  args: Readonly<{ now?: string; range: PanelRange; env?: NodeJS.ProcessEnv }>,
): Promise<PanelModel> {
  return projectPanel(await readPanelInputs(store, { now: args.now ?? new Date().toISOString(), range: args.range, env: args.env ?? process.env }));
}
