/**
 * The Exchange (CITY-5d) opens to people only where the deployment's switch says `open`
 * (`NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE`). Until then the city shows no Exchange in the dock, no «Trade futures» on a tower
 * card and no window, and nothing of Phoenix is read or built from the city. The operator opens it after §18.3 of the
 * specification: paper or devnet, then the operator's canary with a small amount, then the receipts checked.
 *
 * The switch is the city's own. Who may place an order or move collateral stays the engine's gate on the server
 * (`RYNTRA_PHOENIX_ORDERS`, `RYNTRA_PHOENIX_COLLATERAL`): an open city with a closed engine shows the engine's answer.
 */
export function exchangeOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const EXCHANGE_OPEN = exchangeOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE);
