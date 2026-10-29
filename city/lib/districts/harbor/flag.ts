/**
 * The Harbor opens to people only after a live check with a wallet has passed. Until the flag
 * says `open`, the dock keeps its quiet "opens soon" and nothing of the Harbor reads or builds.
 */
export function harborOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const HARBOR_OPEN = harborOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_HARBOR);
