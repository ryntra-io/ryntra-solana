/**
 * A launched token as its page and the phone read it — the record Ryntra
 * kept, and everything else from the chain now: the receipt's facts and marks,
 * the curve's progress, the creator's lock.
 *
 * A fact that could not be read is said as not read: no mark is drawn for it,
 * and `receiptProblems` names why — never a green line on a guess.
 */

import { observeCreatorLock } from "../core/venues/meteora-dbc/creator-lock.server.ts";
import { createMeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import { buildLaunchReceiptFacts, type LaunchReceiptFacts } from "../core/venues/meteora-dbc/receipt.ts";
import type { LaunchTokenResponse } from "../api/v1/contract.ts";
import type { LaunchDeps } from "./flow.server.ts";
import { launchShareLink, readLaunchRecord, settleFeeSharing, settleLaunchLock } from "./flow.server.ts";
import { metadataOfUri } from "./metadata.server.ts";

/* A read is served again for a few seconds — the page's title and body ask at once — and a read the chain failed
   falls back to the last one that succeeded within a few minutes, with that read's own time: never a mark on a guess,
   but not a blank page because a public node answered 429. */
const FRESH_MS = 10_000;
const FALLBACK_MS = 5 * 60 * 1000;
const VIEWS = new Map<string, Readonly<{ at: number; view: Promise<LaunchTokenResponse | null> }>>();
const LAST_GOOD = new Map<string, Readonly<{ at: number; view: LaunchTokenResponse }>>();
const IMMUTABLE_MARKS: ReadonlySet<string> = new Set(["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK", "LP_LOCKED_FOREVER"]);

/**
 * A fresh view, or — when its read of the chain failed — the same view with the receipt of the last good read a few
 * minutes old. Only a read that failed falls back — a launch the rules refuse never does — and only to the marks that
 * cannot change: what a mint can no longer do and liquidity locked for ever. The curve's money and the lock's time are
 * said from a fresh read or not at all; the receipt keeps the time it was read.
 */
export function withFallback(fresh: LaunchTokenResponse, good: Readonly<{ at: number; view: LaunchTokenResponse }> | null, now: number): LaunchTokenResponse {
  if (fresh.receipt) return fresh;
  const refusedByRules = fresh.receiptProblems.some((problem) => problem.startsWith("Not a Ryntra launch"));
  if (!good?.view.receipt || refusedByRules || now - good.at >= FALLBACK_MS) return fresh;
  return { ...fresh, receipt: { ...good.view.receipt, marks: good.view.receipt.marks.filter((mark) => IMMUTABLE_MARKS.has(mark.code)) } };
}

export function readLaunchView(deps: Omit<LaunchDeps, "poolPayer"> & Readonly<{ poolPayer: string }>, token: string): Promise<LaunchTokenResponse | null> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const hit = VIEWS.get(key);
  if (hit && now - hit.at < FRESH_MS) return hit.view;
  const view = readFresh(deps, token).then((fresh) => {
    if (!fresh) return null;
    if (fresh.receipt) LAST_GOOD.set(key, { at: now, view: fresh });
    return withFallback(fresh, LAST_GOOD.get(key) ?? null, now);
  });
  VIEWS.set(key, { at: now, view });
  view.catch(() => VIEWS.delete(key));
  return view;
}

async function readFresh(deps: Omit<LaunchDeps, "poolPayer"> & Readonly<{ poolPayer: string }>, token: string): Promise<LaunchTokenResponse | null> {
  let record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record) return null;
  const stored = await metadataOfUri(deps.store, record.metadataUri, deps.origin);
  const venue = createMeteoraDbcLaunchVenue({ connection: deps.connection, configs: deps.network.configs, poolPayer: deps.poolPayer });
  let receipt: LaunchReceiptFacts | null = null;
  let progressBps: number | null = null;
  let migrated: boolean | null = null;
  let cliffAt: string | null = null;
  let endsAt: string | null = null;
  const problems: string[] = [];
  try {
    const [observation, creation, lock] = await Promise.all([
      venue.observe(token),
      venue.observeCreation(record.signature, token),
      /* The escrow's address is known from the build: read it whatever the send said. */
      record.lock ? observeCreatorLock(deps.connection, record.lock.escrow) : Promise.resolve(null),
    ]);
    record = await settleLaunchLock(deps, record, lock !== null);
    record = await settleFeeSharing(deps, record, observation.creator);
    progressBps = observation.curve.progressBps;
    migrated = observation.curve.migrated;
    if (lock) {
      cliffAt = new Date(lock.cliffAt * 1000).toISOString();
      endsAt = new Date(lock.endsAt * 1000).toISOString();
    }
    receipt = buildLaunchReceiptFacts({
      cluster: deps.network.cluster,
      observation,
      creation,
      ryntraPoolPayer: deps.poolPayer,
      creatorLock: lock,
      metadataUriPrefix: `${deps.origin}/api/launch/metadata/`,
      observedAt: deps.now().toISOString(),
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message.slice(0, 500) : "The chain could not be read.");
  }
  return {
    network: deps.network.chain,
    token: record.token,
    name: stored?.metadata.name ?? record.name,
    symbol: stored?.metadata.symbol ?? record.symbol,
    description: stored?.metadata.description ?? "",
    image: stored?.metadata.image ?? null,
    links: { website: stored?.metadata.website ?? null, x: stored?.metadata.twitter ?? null, telegram: stored?.metadata.telegram ?? null },
    preset: record.preset,
    creator: record.creator,
    launchedAt: record.launchedAt,
    signature: record.signature,
    progressBps,
    migrated,
    lock: record.lock ? { ...record.lock, cliffAt, endsAt } : null,
    feeSharing: record.feeSharing ? { ...record.feeSharing, shares: [...record.feeSharing.shares] } : null,
    receipt,
    receiptProblems: problems,
    shareLink: launchShareLink(deps.origin, record),
    observedAt: deps.now().toISOString(),
  };
}
