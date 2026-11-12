/**
 * Hack's windows open to people only where the deployment's switch says `open` (`NEXT_PUBLIC_RYNTRA_CITY_HACK`), the
 * same switch the routes read (`../store/ready.ts`). Until then the Arena's tray shows no Hack door, no window mounts,
 * and `/api/arena/hack/**` answers 404 — nothing is asked of a door nobody can see.
 */
export function hackOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const HACK_OPEN = hackOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_HACK);
