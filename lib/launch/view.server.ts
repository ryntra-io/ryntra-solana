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
import { launchShareLink, readLaunchRecord, settleLaunchLock } from "./flow.server.ts";
import { metadataOfUri } from "./metadata.server.ts";

export async function readLaunchView(deps: Omit<LaunchDeps, "poolPayer"> & Readonly<{ poolPayer: string }>, token: string): Promise<LaunchTokenResponse | null> {
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
    receipt,
    receiptProblems: problems,
    shareLink: launchShareLink(deps.origin, record),
    observedAt: deps.now().toISOString(),
  };
}
