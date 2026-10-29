/**
 * The engine's refusals as the Exchange says them: what happened, in a person's words, and that nothing was sent. Every
 * code here is one the Phoenix routes (`app/api/solana/futures/**`) or the city's own flow give before anything was
 * sent; a refusal after a send does not exist — that outcome is the chain's to say (`flow.ts`). A code this release
 * does not know is said plainly rather than in the server's own wording, which is written for developers (the clean
 * interface rule of 28.10: no technical words on screen).
 */

const WORDS: Readonly<Record<string, string>> = {
  /* The gates. */
  ORDERS_CLOSED: 'Orders aren’t open for this wallet yet. Nothing was sent.',
  ACTIONS_CLOSED: 'Deposits and withdrawals aren’t open for this wallet yet. Nothing was sent.',
  CANARY_LIMIT: 'Over the current limit. Nothing was sent.',
  ORDERS_UNAVAILABLE: 'Trading is unavailable right now. Nothing was sent.',
  ACTIONS_UNAVAILABLE: 'Deposits and withdrawals are unavailable right now. Nothing was sent.',
  /* Phoenix's account and market. */
  ACCOUNT_NEEDED: 'No Phoenix account for this wallet. Phoenix opens accounts by invite.',
  TRADING_CLOSED: 'Phoenix doesn’t take this order on this account now. Nothing was sent.',
  MARKET_GATED: 'Phoenix doesn’t take orders on this market now. Nothing was sent.',
  ISOLATED_ONLY: 'This market is isolated margin only. Nothing was sent.',
  DEPOSIT_CLOSED: 'Phoenix doesn’t take a deposit on this account now. Nothing was sent.',
  WITHDRAW_CLOSED: 'Phoenix doesn’t allow a withdrawal on this account now. Nothing was sent.',
  OVER_WITHDRAWABLE: 'More than the account may withdraw now. Nothing was sent.',
  /* The order itself. */
  BELOW_MINIMUM: 'The smallest position is $1. Nothing was sent.',
  LIMIT_FAR: 'The limit is more than 5% from the price. Nothing was sent.',
  POST_ONLY_CROSS: 'At this price the order would trade at once. Nothing was sent.',
  TP_SIDE: 'The take profit is on the wrong side of the price. Nothing was sent.',
  SL_SIDE: 'The stop loss is on the wrong side of the price. Nothing was sent.',
  PRICE_UNKNOWN: 'The price didn’t arrive. Nothing was sent.',
  NOT_FILLABLE: 'Not enough in the book for this size now. Nothing was sent.',
  NO_POSITION: 'There is no position on this market. Nothing was sent.',
  OVER_POSITION: 'More than the position holds. Nothing was sent.',
  LEGS_SIDE: 'Set TP/SL on the position itself. Nothing was sent.',
  NOTHING_TO_CHANGE: 'No TP/SL to change. Nothing was sent.',
  NO_ORDERS: 'No open orders on this market. Nothing was sent.',
  NO_ORDER: 'This order is no longer open. Nothing was sent.',
  NO_CONDITIONAL: 'This TP/SL is no longer set. Nothing was sent.',
  BAD_REQUEST: 'This order couldn’t be prepared. Nothing was sent.',
  VALIDATION_ERROR: 'This couldn’t be prepared. Nothing was sent.',
  /* Phoenix, Solana and the line between. */
  PHOENIX_UNAVAILABLE: 'Phoenix didn’t answer. Nothing was sent.',
  PHOENIX_RATE_LIMITED: 'Phoenix is busy. Nothing was sent; try again in a moment.',
  UNAVAILABLE: 'Solana didn’t answer. Nothing was sent.',
  BUILD_REFUSED: 'This order didn’t pass its check. Nothing was sent.',
  RATE_LIMITED: 'Too many tries. Nothing was sent; try again in a moment.',
  TIMEOUT: 'No answer in time. Nothing was sent.',
  NETWORK: 'The connection dropped. Nothing was sent.',
  /* The wallet and the ticket. */
  WALLET_REFUSED: 'The wallet said no. Nothing was sent.',
  WALLET_MISMATCH: 'Signed in with another wallet. Nothing was sent.',
  TICKET_EXPIRED: 'The terms expired. Nothing was sent; try again.',
  TICKET_INVALID: 'The terms expired. Nothing was sent; try again.',
  SIGNED_MISMATCH: 'The wallet changed the order. Nothing was sent.',
  NOT_SIGNED: 'Not signed by this wallet. Nothing was sent.',
  RELAY_REFUSED: 'Solana refused it. Nothing was sent.',
  FORBIDDEN_ORIGIN: 'Orders are taken on Ryntra only. Nothing was sent.',
};

const FALLBACK = 'Not accepted right now. Nothing was sent.';

/** The line for an engine code; a plain line for a code this release does not know. */
export function refusalWords(code: string): string {
  return WORDS[code] ?? FALLBACK;
}

/** Codes that a fresh Review cures by itself: the card offers «Review again» rather than a dead end. */
export const AGAIN: ReadonlySet<string> = new Set(['TICKET_EXPIRED', 'TICKET_INVALID', 'PHOENIX_UNAVAILABLE', 'PHOENIX_RATE_LIMITED', 'UNAVAILABLE', 'RATE_LIMITED', 'TIMEOUT', 'NETWORK', 'PRICE_UNKNOWN']);
