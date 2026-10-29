/**
 * The Ring opens to people only where the deployment's switch says `open` (`NEXT_PUBLIC_RYNTRA_CITY_RING`). Until then
 * a garage in the quarter keeps its old empty state, no agent screen opens, and `/api/ring` answers 404 — the server
 * reads the same switch (`lib/ring/server.ts`), so no catalog is read and no key is made for a Ring nobody can see.
 */
export function ringOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const RING_OPEN = ringOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_RING);
