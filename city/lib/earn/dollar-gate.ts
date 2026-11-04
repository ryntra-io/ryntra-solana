/**
 * The Dollar Saver's own switch in the city (CITY-192): `NEXT_PUBLIC_RYNTRA_CITY_EARN_DOLLAR=open` turns its card on
 * the Shelf into an action — an amount, «Put in» and «Take back». Anything else, and unset, is closed: the card stands
 * with its live rate and «tell me when it opens», and the sentence «put my USDC to work» opens nothing.
 *
 * It sits on top of the engine's own gate (`lib/earn/gate.ts`, `RYNTRA_EARN_ACTIONS`), which this file never changes:
 * with the city's switch open and the engine's closed, the card still offers nothing to sign — the engine's
 * `actions.open` is asked before a button appears, and asked again by the server before bytes are built and before
 * they are sent.
 */

export const DOLLAR_ENV = 'NEXT_PUBLIC_RYNTRA_CITY_EARN_DOLLAR';

export function dollarOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

/** The switch this build was made with. */
export const DOLLAR_OPEN = dollarOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN_DOLLAR);
