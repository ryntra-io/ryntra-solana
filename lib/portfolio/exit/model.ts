/**
 * «Вийти з усього» and «Зібрати все»: what one approval takes out of a wallet's positions, decided from the
 * portfolio's own read (`../model.ts`).
 *
 * Two modes:
 *
 * - **exit** — every position one step takes out is left: a pool's liquidity out with its fees and rewards and the
 *   position closed, a deposit taken back, an inactive stake withdrawn, a liquid staking token swapped; then what came
 *   out is swapped into the target — SOL, USDC, or half and half. An active stake is deactivated: its SOL is free after
 *   the epoch ends, and the answer says from which epoch.
 * - **collect** — only the fees and rewards of the pool positions; nothing leaves a pool and nothing is swapped.
 *
 * What the person chooses is a list of positions (`only`): what is on it is in the approval, what is not is out — so
 * what is built is what the person saw, and a position that appeared since is never taken unseen. Without a list, the
 * default: every step but a plain coin of the wallet, which is never swapped unless it is named — an unverified coin
 * cannot enter a swap by default. SOL itself, and the target's own coin, are never swapped.
 *
 * What one step does not take out is `held`, with the portfolio's own reason — the screen words it (`README.md`).
 *
 * Pure and client-safe: no I/O, no clock, no environment.
 */

import { NATIVE_SOL_MINT, USDC_MINT, type ExitReason, type PortfolioAnswer, type PortfolioKind, type PortfolioPosition, type PortfolioProtocol } from "../model.ts";

export const EXIT_MODES = ["exit", "collect"] as const;
export type ExitMode = (typeof EXIT_MODES)[number];

/** What everything is swapped into: SOL, USDC, or half of each by worth. */
export const EXIT_TARGETS = ["SOL", "USDC", "SPLIT"] as const;
export type ExitTarget = (typeof EXIT_TARGETS)[number];

/**
 * What the approval does to one position:
 *
 * - `leave` — out of its pool, market or stake account, whole or the part that can leave now (`partBps`);
 * - `collect` — its fees and rewards only;
 * - `swap` — a coin of the wallet swapped into the target;
 * - `deactivate` — an active stake deactivated: nothing comes back now, its SOL is free from `untilEpoch`.
 */
export const EXIT_ACTIONS = ["leave", "collect", "swap", "deactivate"] as const;
export type ExitAction = (typeof EXIT_ACTIONS)[number];

export type ExitItem = Readonly<{
  /** The portfolio's own id of the position. */
  id: string;
  protocol: PortfolioProtocol;
  kind: PortfolioKind;
  label: string | null;
  action: ExitAction;
  /** In the approval: by the person's list where one is given, else by default — every step but a wallet's plain coin. */
  picked: boolean;
  /** The share the step takes out now, basis points: 10 000 — all of it. */
  partBps: number;
  /** What the step brings at the prices read now, dollars: a position's worth (its part), or for `collect` what is to collect. Null — not priced. */
  usd: number | null;
  /** `deactivate`: the epoch from which the stake's SOL can be withdrawn. */
  untilEpoch: number | null;
}>;

/** A position one step does not take out, and why — the portfolio's own reason. */
export type ExitHeld = Readonly<{
  id: string;
  protocol: PortfolioProtocol;
  kind: PortfolioKind;
  label: string | null;
  reason: ExitReason;
  usd: number | null;
  untilEpoch: number | null;
  untilTime: string | null;
}>;

export type ExitChoice = Readonly<{ only?: readonly string[] | undefined }>;

export type ExitPlan = Readonly<{ items: readonly ExitItem[]; held: readonly ExitHeld[] }>;

/** The mints a target wants: what is already one of them is never swapped. */
export function wantedMints(target: ExitTarget): ReadonlySet<string> {
  if (target === "SOL") return new Set([NATIVE_SOL_MINT]);
  if (target === "USDC") return new Set([USDC_MINT]);
  return new Set([NATIVE_SOL_MINT, USDC_MINT]);
}

const part = (usd: number | null, partBps: number): number | null => (usd === null ? null : Math.round(((usd * partBps) / 10_000) * 10_000) / 10_000);

const held = (position: PortfolioPosition, reason: ExitReason): ExitHeld => ({
  id: position.id,
  protocol: position.protocol,
  kind: position.kind,
  label: position.label,
  reason,
  usd: position.value.usd,
  untilEpoch: position.exit.untilEpoch,
  untilTime: position.exit.untilTime,
});

const item = (position: PortfolioPosition, action: ExitAction, picked: boolean, partBps: number, usd: number | null): ExitItem => ({
  id: position.id,
  protocol: position.protocol,
  kind: position.kind,
  label: position.label,
  action,
  picked,
  partBps,
  usd,
  untilEpoch: action === "deactivate" ? position.exit.untilEpoch : null,
});

/**
 * What collecting takes from a pool position: its fees — and on DLMM Pro its rewards too. The pools engine's claim on
 * DLMM and DAMM v2 takes the fees; a farm's rewards there come out when the position is left.
 */
const collected = (position: PortfolioPosition) =>
  position.tokens.filter((token) => (token.role === "fee" || (token.role === "reward" && position.protocol === "meteora-dlmm-pro")) && token.amountRaw !== null && token.amountRaw !== "0");

/** Their worth in dollars; null when one of them has no price. */
function collectedUsd(position: PortfolioPosition): number | null {
  let sum = 0;
  for (const token of collected(position)) {
    if (token.usd === null) return null;
    sum += token.usd;
  }
  return Math.round(sum * 10_000) / 10_000;
}

/** One position of an exit: the step that takes it out, or why none does. Null — nothing to do with it (a borrow's twin row, SOL itself). */
function exitOf(position: PortfolioPosition, target: ExitTarget): ExitItem | ExitHeld | null {
  if (position.state !== "read") return held(position, "NOT_READ");
  if (position.origin === "projection") return held(position, "PROJECTION");
  const { exit } = position;
  const usd = position.value.usd;
  switch (exit.how) {
    case "pool-withdraw":
    case "lend-withdraw":
      if (exit.oneStep) return item(position, "leave", true, 10_000, usd);
      /* A part can leave now — a lock, or a market short of liquidity: the part is taken, the rest is said. */
      if ((exit.reason === "LOCKED" || exit.reason === "LIQUIDITY") && exit.partBps > 0) return item(position, "leave", true, exit.partBps, part(usd, exit.partBps));
      return held(position, exit.reason ?? "NO_ROUTE");
    case "stake-withdraw":
      return exit.oneStep ? item(position, "leave", true, 10_000, usd) : held(position, exit.reason ?? "NO_ROUTE");
    case "stake-deactivate":
      /* Deactivated now, free after the epoch: a step of the exit, though it brings nothing yet. */
      return exit.reason === "STAKE_ACTIVE" ? item(position, "deactivate", true, 0, usd) : held(position, exit.reason ?? "NO_ROUTE");
    case "swap": {
      const mint = position.tokens[0]?.mint ?? null;
      /* SOL itself — native or wrapped — and the target's own coin stay as they are. */
      if (!mint || mint === NATIVE_SOL_MINT || wantedMints(target).has(mint)) return null;
      /* A liquid staking token is staking, so it leaves; a plain coin only when the person names it. */
      return item(position, "swap", position.kind === "lst", 10_000, usd);
    }
    case "repay":
      return held(position, "REPAY");
    default:
      return held(position, exit.reason ?? "NO_ROUTE");
  }
}

/**
 * The plan of one approval from a portfolio read: the steps, each picked or not, and what no step takes out. Biggest
 * first, as the portfolio orders them.
 */
export function exitPlan(answer: Pick<PortfolioAnswer, "positions">, mode: ExitMode, target: ExitTarget, choice: ExitChoice = {}): ExitPlan {
  const only = choice.only ? new Set(choice.only) : null;
  const items: ExitItem[] = [];
  const stays: ExitHeld[] = [];
  for (const position of answer.positions) {
    if (mode === "collect") {
      if (position.kind !== "pool" || position.state !== "read" || position.origin === "projection" || collected(position).length === 0) continue;
      items.push(item(position, "collect", only ? only.has(position.id) : true, 10_000, collectedUsd(position)));
      continue;
    }
    const found = exitOf(position, target);
    if (!found) continue;
    if ("reason" in found) stays.push(found);
    else items.push({ ...found, picked: only ? only.has(found.id) : found.picked });
  }
  return { items, held: stays };
}

/**
 * «≈» of what the picked steps bring, at the prices the portfolio read: in dollars, and in the target's coins — lamports
 * of SOL, base units of USDC (six decimals). Before any fee and any slippage: the Review states the exact figures.
 * Null where a price did not read. A deactivated stake brings nothing now and is not counted.
 */
export function exitEstimate(items: readonly ExitItem[], target: ExitTarget, solUsd: number | null): Readonly<{ usd: number | null; lamports: string | null; usdcRaw: string | null }> {
  let usd = 0;
  for (const entry of items) {
    if (!entry.picked || entry.action === "deactivate") continue;
    if (entry.usd === null) return { usd: null, lamports: null, usdcRaw: null };
    usd += entry.usd;
  }
  const solShare = target === "SOL" ? 1 : target === "USDC" ? 0 : 0.5;
  const lamports = solShare === 0 ? "0" : solUsd !== null && solUsd > 0 ? Math.floor(((usd * solShare) / solUsd) * 1e9).toString() : null;
  const usdcRaw = Math.floor(usd * (1 - solShare) * 1e6).toString();
  return { usd: Math.round(usd * 10_000) / 10_000, lamports, usdcRaw };
}
