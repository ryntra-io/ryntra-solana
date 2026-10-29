/**
 * The Vault opens to people only where the deployment's switch says `open` (`NEXT_PUBLIC_RYNTRA_CITY_VAULT`). Until
 * then the city shows no vault tower, no dock button and no room, and `/api/vault` answers 404 — the server reads the
 * same switch (`lib/vault/server.ts`), so no guard is asked for a vault nobody can see.
 */
export function vaultOpen(value: string | undefined): boolean {
  return value?.trim() === 'open';
}

export const VAULT_OPEN = vaultOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_VAULT);
