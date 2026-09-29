/**
 * The provider session behind a wallet's paper account (`RYN-PREDICTIONS-001`,
 * canon v4.3 §6.5): held by the server, keyed by the proven Ryntra wallet,
 * refreshed by the server, never in the browser.
 *
 * One versioned record per wallet in Guard `predictionLinks`, the tokens
 * sealed by `vault.ts`. A wallet switch is a different key, so nothing of
 * one person's session can be read for another; a revoke wipes the tokens
 * and keeps the row as the record that a link existed. The access token
 * lives fifteen minutes at the provider: `withProviderSession` refreshes
 * before it runs a call when the token is about to expire, retries once
 * after a 401, and marks the link `expired` when the refresh itself is
 * refused — the person then signs once more, nothing is silently re-created.
 *
 * Server only.
 */

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { failure, type PredictionFailure } from "./failure.ts";
import type { PredictionProvider, ProviderUserSession, Result } from "./provider.ts";
import { open, seal, vaultAvailable } from "./vault.ts";

export type PredictionLinkState = "active" | "expired" | "revoked";

export type PredictionLinkRecord = Readonly<{
  version: number;
  wallet: string;
  externalId: string;
  providerUserId: string;
  /** The Solana address the provider holds for this user; must be the Ryntra wallet. */
  providerWallet: string | null;
  externalIdLinked: boolean;
  linkAttemptedAt: string | null;
  /** Why the external-id link is not made yet: `signing_key_missing`, or the provider's refusal. */
  linkError: string | null;
  /** Sealed tokens; null once revoked. */
  access: string | null;
  refresh: string | null;
  accessExpiresAt: string;
  state: PredictionLinkState;
  stateReason: string | null;
  createdAt: string;
  updatedAt: string;
  refreshedAt: string | null;
}>;

export const LINK_KEY_PREFIX = "solana:mainnet:";
export function linkKey(wallet: string): string {
  return `${LINK_KEY_PREFIX}${wallet}`;
}

/** The provider's access token is a JWT with `exp`; a token that is not one is assumed to live ten minutes. */
export function accessExpiry(accessToken: string, nowMs: number = Date.now()): string {
  const parts = accessToken.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
      if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) return new Date(payload.exp * 1000).toISOString();
    } catch {
      /* fall through */
    }
  }
  return new Date(nowMs + 10 * 60_000).toISOString();
}

function links(store: GuardStore) {
  return store.versioned<PredictionLinkRecord>("predictionLinks");
}

export async function readLink(store: GuardStore, wallet: string): Promise<PredictionLinkRecord | null> {
  return (await links(store).get(linkKey(wallet))) ?? null;
}

/** Insert or replace the wallet's record; the caller's `version` is the one it read (or 0 for a new row). */
export async function writeLink(store: GuardStore, record: Omit<PredictionLinkRecord, "version">, expectedVersion: number | null): Promise<PredictionLinkRecord | PredictionFailure> {
  const collection = links(store);
  const key = linkKey(record.wallet);
  const next: PredictionLinkRecord = { ...record, version: (expectedVersion ?? 0) + 1 };
  const written = await collection.compareAndSet(key, expectedVersion, next);
  if (!written) return failure("UNAVAILABLE", "The paper account changed under this request; read it again.");
  return next;
}

/** Replace the tokens on an existing record with a bounded compare-and-set loop. */
async function rotate(store: GuardStore, wallet: string, patch: (current: PredictionLinkRecord) => Omit<PredictionLinkRecord, "version">): Promise<PredictionLinkRecord | null> {
  const collection = links(store);
  const key = linkKey(wallet);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current) return null as never;
      const next: PredictionLinkRecord = { ...patch(current), version: current.version + 1 };
      const ok = await collection.compareAndSet(key, current.version, next);
      return ok ? next : false;
    });
  } catch {
    return null;
  }
}

export type LinkStatus = Readonly<{
  state: "none" | PredictionLinkState;
  externalIdLinked: boolean;
  linkError: string | null;
  providerUserId: string | null;
  since: string | null;
  refreshedAt: string | null;
  /** Whether this deployment can hold a link at all (a session secret and a durable store). */
  available: boolean;
  unavailableReason: string | null;
}>;

export function linkAvailability(store: GuardStore, env: NodeJS.ProcessEnv = process.env): Readonly<{ available: boolean; reason: string | null }> {
  if (!vaultAvailable(env)) return { available: false, reason: "no_session_secret" };
  if (store.durability === "EPHEMERAL_SINGLE_INSTANCE") return { available: false, reason: "store_not_durable" };
  return { available: true, reason: null };
}

export async function linkStatus(store: GuardStore, wallet: string, env: NodeJS.ProcessEnv = process.env): Promise<LinkStatus> {
  const availability = linkAvailability(store, env);
  const record = await readLink(store, wallet);
  return {
    state: record ? record.state : "none",
    externalIdLinked: record?.externalIdLinked ?? false,
    linkError: record?.linkError ?? null,
    providerUserId: record?.providerUserId ?? null,
    since: record?.createdAt ?? null,
    refreshedAt: record?.refreshedAt ?? null,
    available: availability.available,
    unavailableReason: availability.reason,
  };
}

const REFRESH_AHEAD_MS = 45_000;

/**
 * Run one provider call for the wallet's session: refresh ahead of expiry,
 * retry once on a 401, mark the link expired when the refresh is refused.
 */
export async function withProviderSession<T>(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  run: (session: ProviderUserSession, record: PredictionLinkRecord) => Promise<Result<T>>,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): Promise<Result<T>> {
  let record = await readLink(store, wallet);
  if (!record || record.state === "revoked" || !record.access) return failure("NOT_LINKED", "The paper account is not linked to this wallet yet.");
  if (record.state === "expired") return failure("SESSION_EXPIRED", "The paper account's session expired; sign with the wallet again.");

  const refreshNow = async (): Promise<PredictionLinkRecord | PredictionFailure> => {
    const refreshToken = record?.refresh ? open(record.refresh, env) : null;
    if (!refreshToken) {
      await rotate(store, wallet, (c) => ({ ...c, state: "expired", stateReason: "no_refresh_token", updatedAt: new Date(nowMs).toISOString() }));
      return failure("SESSION_EXPIRED", "The paper account's session expired; sign with the wallet again.");
    }
    const refreshed = await provider.refresh(refreshToken);
    if (!refreshed.ok) {
      if (refreshed.code === "SESSION_EXPIRED" || refreshed.code === "SIGNATURE_INVALID" || refreshed.code === "FORBIDDEN") {
        await rotate(store, wallet, (c) => ({ ...c, state: "expired", stateReason: "refresh_refused", access: null, refresh: null, updatedAt: new Date(nowMs).toISOString() }));
        return failure("SESSION_EXPIRED", "The paper account's session expired; sign with the wallet again.");
      }
      return refreshed;
    }
    const stamp = new Date(nowMs).toISOString();
    const next = await rotate(store, wallet, (c) => ({
      ...c,
      access: seal(refreshed.value.accessToken, env),
      refresh: refreshed.value.refreshToken ? seal(refreshed.value.refreshToken, env) : c.refresh,
      accessExpiresAt: accessExpiry(refreshed.value.accessToken, nowMs),
      refreshedAt: stamp,
      updatedAt: stamp,
      state: "active",
      stateReason: null,
    }));
    if (!next) return failure("UNAVAILABLE", "The paper account could not be updated; try again.");
    return next;
  };

  if (Date.parse(record.accessExpiresAt) - nowMs < REFRESH_AHEAD_MS) {
    const refreshed = await refreshNow();
    if ("ok" in refreshed && refreshed.ok === false) return refreshed;
    record = refreshed as PredictionLinkRecord;
  }

  const access = record.access ? open(record.access, env) : null;
  if (!access) {
    await rotate(store, wallet, (c) => ({ ...c, state: "expired", stateReason: "unreadable_token", updatedAt: new Date(nowMs).toISOString() }));
    return failure("SESSION_EXPIRED", "The paper account's session cannot be read on this deployment; sign with the wallet again.");
  }

  const first = await run({ accessToken: access }, record);
  if (first.ok || first.code !== "SESSION_EXPIRED") return first;

  const refreshed = await refreshNow();
  if ("ok" in refreshed && refreshed.ok === false) return refreshed;
  const again = refreshed as PredictionLinkRecord;
  const nextAccess = again.access ? open(again.access, env) : null;
  if (!nextAccess) return failure("SESSION_EXPIRED", "The paper account's session expired; sign with the wallet again.");
  return run({ accessToken: nextAccess }, again);
}

/** Sign the provider session out (best effort) and wipe the tokens; the row stays as history. */
export async function revokeLink(store: GuardStore, provider: PredictionProvider, wallet: string, env: NodeJS.ProcessEnv = process.env): Promise<Result<LinkStatus>> {
  const record = await readLink(store, wallet);
  if (!record) return failure("NOT_LINKED", "There is no paper account linked to this wallet.");
  const access = record.access ? open(record.access, env) : null;
  if (access) await provider.signOut({ accessToken: access }).catch(() => null);
  const stamp = new Date().toISOString();
  const next = await rotate(store, wallet, (c) => ({ ...c, state: "revoked", stateReason: "revoked_by_person", access: null, refresh: null, updatedAt: stamp }));
  if (!next) return failure("UNAVAILABLE", "The paper account could not be updated; try again.");
  return { ok: true, value: await linkStatus(store, wallet, env) };
}

export { open as openSealed, seal as sealToken };
