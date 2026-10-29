/**
 * The beacons' switch for a deployment (CITY-72): `NEXT_PUBLIC_RYNTRA_CITY_BEACONS`, closed when not set.
 *
 * - `closed` (not set, or anything else) — no beacon in the city; `/api/world/beacons` answers 404 and the cron
 *   checks nothing and tells nobody.
 * - `device` — beacons on the person's device only: they light towers in the city; no account, no server, no Telegram.
 * - `open` — the account keeps the beacons and the cron tells Telegram where the person turned it on. Only after the
 *   owner applied the migration `20261028120000_world_beacons.sql`.
 *
 * Pure. Relative imports with their extension only.
 */

export type BeaconsMode = "closed" | "device" | "open";

export function beaconsMode(value: string | undefined): BeaconsMode {
  return value === "open" ? "open" : value === "device" ? "device" : "closed";
}
