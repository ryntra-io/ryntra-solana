/**
 * The ticket's own rules, without React: what its one button says and does, when «Try again» stands, and when a press
 * may open the wallet. The price, the route, the fee and the signature are the trade card's logic as it is
 * (`city/lib/trade/store.ts`); these rules only decide what the screen shows over it.
 *
 * Pure: the tests hold them as they are written.
 */

/** Where a trade is, as the trade card's store says it. */
export type TicketPhase = 'idle' | 'preparing' | 'wallet' | 'sending' | 'checking' | 'done' | 'failed' | 'unknown';

export type ActionInput = Readonly<{
  phase: TicketPhase;
  side: 'buy' | 'sell';
  connected: boolean;
  /** A wallet is being connected by a tap. */
  connecting: boolean;
  /** What is wrong with the amount in the field: `balance` — more than can be spent; `other` — not an amount. */
  problem: 'balance' | 'other' | null;
  /** The field holds an amount the engine can price. */
  hasAmount: boolean;
  /** The wallet's balance is read and there is nothing of the spent coin to spend. */
  empty: boolean;
  /** The engine's price for the amount is on screen. */
  priced: boolean;
  /** The exact order the wallet would sign is on screen. */
  exact: boolean;
  /** The screen has somewhere to send a person with nothing to buy with. */
  canTopUp: boolean;
  /**
   * The order being built was asked by the card itself, while the person reads the price — not by a press. Absent:
   * false.
   */
  auto?: boolean;
}>;

export type ActionLabel = 'verb' | 'connect' | 'connecting' | 'building' | 'wallet' | 'sending' | 'checking' | 'short' | 'nothing' | 'topUp';

export type ActionView = Readonly<{
  label: ActionLabel;
  /** `press` — the trade card's one step (build the order, then the wallet); `topUp` — the way to get funds. */
  does: 'press' | 'topUp' | 'none';
  busy: boolean;
}>;

const wait = (label: ActionLabel): ActionView => ({ label, does: 'none', busy: true });
const rest = (label: ActionLabel): ActionView => ({ label, does: 'none', busy: false });
const go = (label: ActionLabel, does: 'press' | 'topUp' = 'press'): ActionView => ({ label, does, busy: false });

/**
 * The ticket's one amber button. It is the trade's verb — «Buy SOL» — whenever a press can do it, and while it cannot
 * it says the one thing missing. It is never «Try again»: a price that did not come is asked again by a quiet control
 * of its own (`retryShown`), so a tap meant for that control cannot land on the button that opens the wallet.
 */
export function actionOf(input: ActionInput): ActionView {
  // The card building its first order while the price is read is no wait of the person's: the button reads on as if
  // idle, and a press then waits for that order and shows it (`useTrade.press`). Renewing bytes already on screen, or
  // an order a press asked for, is a wait.
  if (input.phase === 'preparing' && !(input.auto && !input.exact)) return wait('building');
  if (input.phase === 'wallet') return wait('wallet');
  if (input.phase === 'sending') return wait('sending');
  if (input.phase === 'checking') return wait('checking');
  if (input.connecting) return wait('connecting');
  if (input.connected && input.side === 'buy' && input.empty) return input.canTopUp ? go('topUp', 'topUp') : rest('short');
  if (input.problem === 'balance') return rest('short');
  if (input.problem) return rest('verb');
  if (!input.connected) return go('connect');
  if (!input.hasAmount) return rest(input.empty ? (input.side === 'sell' ? 'nothing' : 'short') : 'verb');
  // No price and no order on screen: nothing a press could agree to.
  if (!input.priced && !input.exact) return rest('verb');
  return go('verb');
}

/**
 * Whether «Try again» stands in the fee's place: the engine's price did not come, asking again can help, and no order
 * is on screen. It only reads the price again.
 */
export function retryShown(input: Readonly<{ quoteFailed: boolean; retryable: boolean; exact: boolean; phase: TicketPhase }>): boolean {
  return input.quoteFailed && input.retryable && !input.exact && input.phase === 'idle';
}

/** After a price that did not come, the order's figures stand this long before a press may open the wallet. */
export const READ_BEFORE_PRESS_MS = 1_200;

/**
 * What the ticket remembers of a price that did not come: `failed` until the exact order stands on screen again, and
 * `since` — when it did.
 */
export type Guard = Readonly<{ failed: boolean; since: number | null }>;

export const NO_GUARD: Guard = { failed: false, since: null };

/** The guard after what the screen shows now. */
export function guardNext(guard: Guard, seen: Readonly<{ quoteFailed: boolean; exact: boolean }>, now: number): Guard {
  if (seen.quoteFailed) return guard.failed && guard.since === null ? guard : { failed: true, since: null };
  if (guard.failed && seen.exact) return { failed: false, since: now };
  return guard;
}

/**
 * Whether a press is held back: the order's figures came after a failed price and have not stood long enough to be
 * read. A held press does nothing — the next one, a moment later, is the person's own.
 */
export function pressHeld(guard: Guard, now: number): boolean {
  return guard.since !== null && now - guard.since < READ_BEFORE_PRESS_MS;
}

/**
 * Whether the trade card may be given to another coin: it is shut, or it rests on its fields. A trade under way, its
 * result, or a limit's signature keep the card on their own coin until the person lets them go.
 */
export function ticketFree(card: Readonly<{ open: boolean; phase: TicketPhase; held: boolean }>): boolean {
  return !card.open || (card.phase === 'idle' && !card.held);
}
