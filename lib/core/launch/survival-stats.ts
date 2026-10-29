/**
 * The survival of markets launched on Ryntra at 7, 30 and 90 days (SOL-L3, audit SOL-L0 finding З19) — public, from
 * the chain, by one definition said in words beside the figures:
 *
 * a market **lived to day N** when someone other than its creator and Ryntra's own wallets traded it in the week up to
 * its N-th day (`[launch + N − 7 days, launch + N)`); it **went quiet** when every transaction of that week was read and
 * there was no such trade; it is **not read** when that week's history was not read whole — never counted as quiet. A
 * market younger than N days is not counted at N. Each market that lived is proven by the transaction of the trade.
 *
 * Ryntra's own launches (technical validation) are counted apart from people's: a test of Ryntra's is never a market's
 * demand. A decided outcome — lived or quiet, its week over — never changes, and is kept.
 *
 * Pure and client-safe: the chain is read by `lib/launch/survival.server.ts`.
 */

export const SURVIVAL_HORIZONS_DAYS = [7, 30, 90] as const;
export type SurvivalHorizon = (typeof SURVIVAL_HORIZONS_DAYS)[number];
/** The week before the N-th day a trade must fall in. */
export const SURVIVAL_WINDOW_DAYS = 7;

const DAY = 86_400;

export const SURVIVAL_STATES = ["young", "alive", "quiet", "unread"] as const;
export type SurvivalState = (typeof SURVIVAL_STATES)[number];

export type SurvivalOutcome = Readonly<{
  days: SurvivalHorizon;
  state: SurvivalState;
  /** The trade that proves «alive»: its transaction and time (unix seconds); null otherwise. */
  proof: Readonly<{ signature: string; at: number }> | null;
}>;

export type SurvivalTrade = Readonly<{ signature: string; at: number; trader: string; payer: string }>;
/** Which part of the market's history was read: whole, or from `coveredFrom` with the times of transactions listed but not read. */
export type SurvivalCover = Readonly<{ complete: boolean; coveredFrom: number | null; gaps: readonly number[] }>;

/** The window a horizon reads, unix seconds: from (inclusive) and to (exclusive). */
export function survivalWindow(launchedAt: number, days: SurvivalHorizon): Readonly<{ from: number; to: number }> {
  const to = launchedAt + days * DAY;
  return { from: Math.max(launchedAt, to - SURVIVAL_WINDOW_DAYS * DAY), to };
}

/** Every transaction of the window was read: the whole history, or a list reaching back past it with none unread inside. */
export function windowCovered(cover: SurvivalCover, window: Readonly<{ from: number; to: number }>): boolean {
  if (cover.complete) return true;
  /* A list cut at its limit may leave more of the same second unlisted: it covers the window only from before its start. */
  if (cover.coveredFrom !== null && cover.coveredFrom >= window.from) return false;
  return !cover.gaps.some((at) => at >= window.from && at < window.to);
}

/** One market's outcome at each horizon. `excluded`: its creator and Ryntra's own wallets — their trades prove nothing. */
export function marketSurvival(args: Readonly<{ launchedAt: number; trades: readonly SurvivalTrade[]; cover: SurvivalCover; excluded: ReadonlySet<string>; now: number }>): readonly SurvivalOutcome[] {
  return SURVIVAL_HORIZONS_DAYS.map((days) => {
    const window = survivalWindow(args.launchedAt, days);
    if (window.to > args.now) return { days, state: "young", proof: null };
    let proof: SurvivalOutcome["proof"] = null;
    for (const trade of args.trades) {
      if (trade.at < window.from || trade.at >= window.to) continue;
      if (!survivalProves(trade, args.excluded)) continue;
      if (!proof || trade.at > proof.at) proof = { signature: trade.signature, at: trade.at };
    }
    if (proof) return { days, state: "alive", proof };
    return { days, state: windowCovered(args.cover, window) ? "quiet" : "unread", proof: null };
  });
}

/** Whether a trade proves demand: neither its trader nor its payer is the creator or one of Ryntra's own wallets. */
export function survivalProves(trade: SurvivalTrade, excluded: ReadonlySet<string>): boolean {
  return !excluded.has(trade.trader) && !excluded.has(trade.payer);
}

/**
 * One horizon's outcome from a read of its own window (`windowTrades`): alive on any trade that proves demand — a read in
 * part is enough for that —, quiet only when every transaction of the window was read, else not read.
 */
export function windowOutcome(days: SurvivalHorizon, read: Readonly<{ trades: readonly SurvivalTrade[]; complete: boolean }>, launchedAt: number, excluded: ReadonlySet<string>): SurvivalOutcome {
  const window = survivalWindow(launchedAt, days);
  let proof: SurvivalOutcome["proof"] = null;
  for (const trade of read.trades) {
    if (trade.at < window.from || trade.at >= window.to || !survivalProves(trade, excluded)) continue;
    if (!proof || trade.at > proof.at) proof = { signature: trade.signature, at: trade.at };
  }
  if (proof) return { days, state: "alive", proof };
  return { days, state: read.complete ? "quiet" : "unread", proof: null };
}

/** An outcome that can no longer change: its week is over and it was decided. */
export function survivalDecided(outcome: SurvivalOutcome): boolean {
  return outcome.state === "alive" || outcome.state === "quiet";
}

export type SurvivalTally = Readonly<{ eligible: number; alive: number; quiet: number; unread: number }>;
export type SurvivalHorizonStats = Readonly<{ days: SurvivalHorizon; people: SurvivalTally; ryntra: SurvivalTally }>;

/** The tallies at each horizon, people's markets and Ryntra's own apart; a market not yet N days old is not counted at N. */
export function survivalStats(markets: readonly Readonly<{ own: boolean; outcomes: readonly SurvivalOutcome[] }>[]): readonly SurvivalHorizonStats[] {
  return SURVIVAL_HORIZONS_DAYS.map((days) => {
    const tally = (own: boolean): SurvivalTally => {
      const states = markets.filter((market) => market.own === own).map((market) => market.outcomes.find((outcome) => outcome.days === days)?.state ?? "unread");
      const count = (state: SurvivalState) => states.filter((entry) => entry === state).length;
      return { eligible: states.length - count("young"), alive: count("alive"), quiet: count("quiet"), unread: count("unread") };
    };
    return { days, people: tally(false), ryntra: tally(true) };
  });
}

/**
 * The share that lived, basis points of the markets at that age; null when none is that old, or while any of them is not
 * read — a market not read is most often a busy one, so a rate without it would be biased low.
 */
export function survivalRateBps(tally: SurvivalTally): number | null {
  const decided = tally.alive + tally.quiet;
  return decided === 0 || tally.unread > 0 ? null : Math.round((tally.alive * 10_000) / decided);
}
