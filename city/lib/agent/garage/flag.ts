/**
 * The garage agent (CITY-29) opens to people only where the deployment's switch says `open`
 * (`NEXT_PUBLIC_RYNTRA_CITY_GARAGE`). Until then a garage in the quarter keeps the sheet it had.
 */
export function garageOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const GARAGE_OPEN = garageOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_GARAGE);
