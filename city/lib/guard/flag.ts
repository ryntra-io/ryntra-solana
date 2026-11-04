/**
 * «Охорона» in the city (CITY-152, phase 1): the Deck's Guard place opens one window — paste a transaction or a link,
 * read one line, open the reasons if you want them. It stands on the engine's pre-sign check
 * (`POST /api/v1/ward/check`, working name «ward»), which only reads: it holds no key, signs nothing and keeps nothing.
 *
 * Behind the deployment's switch (`NEXT_PUBLIC_RYNTRA_CITY_GUARD=open`) until the operator names the product and opens
 * it; until then the place keeps its «Soon» and asks the engine nothing.
 */

export function guardOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const GUARD_OPEN = guardOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_GUARD);
