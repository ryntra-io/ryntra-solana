/**
 * RXN, the futures and predictions brand of its own. The city's door «Futures → RXN»
 * leads there only where the deployment's switch says `open` (`NEXT_PUBLIC_RYNTRA_CITY_RXN`), once RXN is live; until then
 * there is no door and no link to it anywhere in the city.
 */
export const RXN_URL = 'https://rxn.gg';

export function rxnOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const RXN_OPEN = rxnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_RXN);
