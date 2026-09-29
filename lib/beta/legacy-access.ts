/**
 * Has an account closed its legacy access?
 *
 * Sessions minted before the accounts migration are stateless HMAC cookies:
 * they carry no session id, so there is no row to revoke and «вийти всюди»
 * could only delete the copy in the browser that pressed it. Every other copy
 * kept working until it expired on its own, and the only lever that reached
 * them was rotating the signing secret, which signs out every user of the
 * product at once.
 *
 * The cutoff is the account-scoped lever: one timestamp on the account row,
 * checked here. A stateless cookie for a closed account stops resolving; a
 * recorded session is unaffected, because it has its own row and its own
 * revocation; nobody else is touched.
 *
 * An absent field means «never closed» — which is the state of every
 * deployment before the migration that projects it, and the reason this reads
 * defensively instead of assuming the column is there.
 */
export function legacyAccessClosed(user: { legacy_closed_at?: string | null } | null | undefined): boolean {
  const closed = user?.legacy_closed_at;
  return typeof closed === "string" && closed.trim().length > 0;
}
