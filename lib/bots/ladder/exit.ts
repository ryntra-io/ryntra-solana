/**
 * The exit policy, chosen before a ladder starts (spec «Що є лише в нас» 9):
 * Stop · Sell all · Rebuild · Wait — and what it proposes once the price
 * leaves the ladder's band or the ladder has filled.
 *
 * Nothing here acts. A policy only says which proposal the person sees; every
 * proposal is built and simulated at the moment of the tap and signed in the
 * person's own wallet (`auto: false`, `builtAt: "tap"`) — nothing is signed in
 * advance and nothing is kept signed. Making those proposals reach the person
 * (inbox, push, Telegram) is B6.
 *
 * Pure.
 */

export const EXIT_POLICIES = ["stop", "sellAll", "rebuild", "wait"] as const;
export type ExitPolicy = (typeof EXIT_POLICIES)[number];
export const isExitPolicy = (value: unknown): value is ExitPolicy => typeof value === "string" && (EXIT_POLICIES as readonly string[]).includes(value);

/** A ladder's steps as the chain holds them. */
export type LadderProgress = Readonly<{ rungs: number; filled: number; partial: number }>;

/** Why a policy is due: the price left the band under or over it, or every step filled. */
export type ExitTrigger = "below" | "above" | "filled";

export function exitTrigger(
  band: Readonly<{ lower: number; upper: number }> | null,
  price: number | null,
  progress: LadderProgress,
): ExitTrigger | null {
  if (progress.rungs > 0 && progress.filled >= progress.rungs) return "filled";
  if (!band || price === null || !(price > 0)) return null;
  if (price < band.lower) return "below";
  if (price > band.upper) return "above";
  return null;
}

/**
 * - `takeBack` — cancel what is open and take back what converted: one prompt for every order account;
 * - `takeBackAndSell` — that, then sell what the ladder bought back to the dollar: a second prompt, a market trade;
 * - `takeBackAndRebuild` — that, then the same ladder around the new price: a second prompt, once the first landed;
 * - `none` — the orders stay and go on if the price comes back.
 */
export type ExitAction = "none" | "takeBack" | "takeBackAndSell" | "takeBackAndRebuild";

export type ExitProposal = Readonly<{
  policy: ExitPolicy;
  trigger: ExitTrigger;
  action: ExitAction;
  /** Wallet prompts the proposal takes, each the person's own. */
  prompts: number;
  /** Never: the person taps and signs. */
  auto: false;
  /** The transactions are built and simulated when the person taps, never before. */
  builtAt: "tap";
}>;

/**
 * What a policy proposes for a trigger. A filled ladder holds converted tokens in its order accounts until they are
 * taken back, so «Wait» proposes taking them back once there is nothing left to wait for; an exit ladder that sold
 * everything has nothing left to sell.
 */
export function exitProposal(
  policy: ExitPolicy,
  trigger: ExitTrigger | null,
  side: "buy" | "exit",
): ExitProposal | null {
  if (!trigger) return null;
  let action: ExitAction;
  switch (policy) {
    case "wait":
      action = trigger === "filled" ? "takeBack" : "none";
      break;
    case "stop":
      action = "takeBack";
      break;
    case "sellAll":
      action = side === "exit" && trigger === "filled" ? "takeBack" : "takeBackAndSell";
      break;
    case "rebuild":
      action = "takeBackAndRebuild";
      break;
  }
  if (action === "none") return null;
  const prompts = action === "takeBack" ? 1 : 2;
  return { policy, trigger, action, prompts, auto: false, builtAt: "tap" };
}
