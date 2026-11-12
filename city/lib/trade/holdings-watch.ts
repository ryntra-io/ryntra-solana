/**
 * One watch of the wallet's balance for every card that asks for funds (CITY-222: the agent's card; CITY-237: the
 * tower's ticket and the money autopilot).
 *
 * While a card says «Add SOL», the balance is read again — every 15 s and on return to the page — so a top-up turns the
 * card's action back without a reload. Three rules keep it from costing more than it gives:
 *
 * - a hidden tab reads nothing: nobody is looking, and the return to the page reads at once;
 * - two cards asking at once (the agent's card beside a tower's ticket) share one timer, not one each;
 * - a return to the page is one read: the browser says it twice (`focus` and `visibilitychange`).
 *
 * Pure: the page's timers, listeners and the read itself are given, so the rules are tested without a browser.
 */
export const HOLDINGS_WATCH_MS = 15_000;
/** Two asks closer than this are one read. */
export const HOLDINGS_WATCH_GAP_MS = 2_000;

export type HoldingsWatchEnv = Readonly<{
  /** Read the wallet's balance again. */
  read: () => void;
  /** Whether the page is in view. */
  visible: () => boolean;
  now: () => number;
  /** Run every `ms`; the answer stops it. */
  every: (run: () => void, ms: number) => () => void;
  /** Run when the person comes back to the page; the answer stops listening. */
  onReturn: (run: () => void) => () => void;
}>;

/** A card starts watching with the call and stops with its answer; the timer lives while at least one card watches. */
export function createHoldingsWatch(env: HoldingsWatchEnv): () => () => void {
  let cards = 0;
  let stop: (() => void) | null = null;
  let last = Number.NEGATIVE_INFINITY;
  const again = () => {
    if (!env.visible()) return;
    const at = env.now();
    if (at - last < HOLDINGS_WATCH_GAP_MS) return;
    last = at;
    env.read();
  };
  return () => {
    cards += 1;
    if (cards === 1) {
      const offTimer = env.every(again, HOLDINGS_WATCH_MS);
      const offReturn = env.onReturn(again);
      stop = () => {
        offTimer();
        offReturn();
      };
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      cards -= 1;
      if (cards === 0) {
        stop?.();
        stop = null;
      }
    };
  };
}
