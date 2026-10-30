/**
 * The Exchange (CITY-5d) on Phoenix, by the deployment's switch (`NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE`):
 *
 * - `open` — the whole Exchange: the window, «Trade futures» on a tower card, the address `?open=exchange`.
 * - `exit` — futures have gone to RXN: nothing of the Exchange is shown, except to a wallet
 *   that still holds something on Phoenix — a position, an order or collateral. Its window then only takes risk away and
 *   brings the money home: cut, close, cancel, withdraw. Nothing opens or adds, no collateral goes in.
 * - anything else — closed: no window, no button, and nothing of Phoenix is read or built from the city.
 *
 * The operator opens it after §18.3 of the specification: paper or devnet, then the operator's canary with a small amount, then
 * the receipts checked. The switch is the city's own. Who may place an order or move collateral stays the engine's gate on
 * the server (`RYNTRA_PHOENIX_ORDERS`, `RYNTRA_PHOENIX_COLLATERAL`): an open city with a closed engine shows the engine's
 * answer.
 */
export type ExchangeMode = 'open' | 'exit' | 'closed';

export function exchangeMode(value: string | undefined): ExchangeMode {
  const mode = value?.trim();
  return mode === 'open' || mode === 'exit' ? mode : 'closed';
}

export function exchangeOpen(value: string | undefined): boolean {
  return exchangeMode(value) === 'open';
}

export const EXCHANGE_MODE = exchangeMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE);
export const EXCHANGE_OPEN = EXCHANGE_MODE === 'open';
/** Closing out only: the window stands for a wallet with something on Phoenix, and opens nothing new. */
export const EXCHANGE_EXIT = EXCHANGE_MODE === 'exit';
/** The window can stand at all: to trade, or to close out. */
export const EXCHANGE_SHOWN = EXCHANGE_MODE !== 'closed';
