/**
 * A launched token as its page and the phone read it — the record Ryntra
 * kept, and everything else from the chain now: the receipt's facts and marks,
 * the curve's progress, the creator's lock.
 *
 * A fact that could not be read is said as not read: no mark is drawn for it,
 * and `receiptProblems` names why — never a green line on a guess.
 */

import { observeCreatorLock, type CreatorLockObservation } from "../core/venues/meteora-dbc/creator-lock.server.ts";
import { createMeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import { RECEIPT_EXIT_UNREAD, RECEIPT_LOCK_UNREAD, buildLaunchReceiptFacts, receiptRefusedByRules, type LaunchReceiptFacts } from "../core/venues/meteora-dbc/receipt.ts";
import type { LaunchTokenResponse } from "../api/v1/contract.ts";
import { autopilotReceipts } from "./autopilot.server.ts";
import { unusualTokenomics } from "../core/launch/advanced.ts";
import { configsOfRecord, launchArchiveConnection, launchHistoryConnection, launchPair } from "./config.server.ts";
import type { LaunchDeps } from "./flow.server.ts";
import { launchShareLink, readLaunchRecord, settleFeeSharing, settleLaunchLock, type LaunchRecord } from "./flow.server.ts";
import { ipfsCidOfSha256, ipfsGatewayUrl } from "./ipfs.ts";
import { readIpfsPins, shaOfOurUri } from "./ipfs.server.ts";
import { metadataOfUri, isTakenDown } from "./metadata.server.ts";
import { pairWatchView, readQuoteWatch } from "./quote-watch.server.ts";

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
  const recent = good?.view.receipt && now - good.at < FALLBACK_MS ? good.view.receipt : null;
  /* Read but for the exit: the liquidity locked for ever stays locked — its marks stand from the last good read, with its pool. */
  if (fresh.receipt && fresh.receiptProblems.includes(RECEIPT_EXIT_UNREAD) && recent?.graduated) {
    return { ...fresh, receipt: { ...fresh.receipt, graduated: recent.graduated, marks: [...fresh.receipt.marks, ...recent.marks.filter((mark) => mark.code === "LP_LOCKED_FOREVER")] } };
  }
  if (fresh.receipt) return fresh;
  if (!good?.view.receipt || receiptRefusedByRules(fresh.receiptProblems) || now - good.at >= FALLBACK_MS) return fresh;
  return { ...fresh, receipt: { ...good.view.receipt, marks: good.view.receipt.marks.filter((mark) => IMMUTABLE_MARKS.has(mark.code)) } };
}

export function readLaunchView(deps: Omit<LaunchDeps, "poolPayer"> & Readonly<{ poolPayer: string }>, token: string): Promise<LaunchTokenResponse | null> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const hit = VIEWS.get(key);
  if (hit && now - hit.at < FRESH_MS) return hit.view;
  const view = readFresh(deps, token).then((fresh) => {
    if (!fresh) return null;
    /* Only a receipt read whole stands in for later reads. */
    if (fresh.receipt && fresh.receiptProblems.length === 0) LAST_GOOD.set(key, { at: now, view: fresh });
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
  const venue = createMeteoraDbcLaunchVenue({
    connection: deps.connection,
    configs: configsOfRecord(deps.network, record),
    advancedFeeClaimer: deps.network.referralOwner,
    curveRules: deps.network.curveRules ?? null,
    poolPayer: deps.poolPayer,
    archive: launchArchiveConnection(deps.network),
    history: launchHistoryConnection(deps.network),
  });
  let receipt: LaunchReceiptFacts | null = null;
  let progressBps: number | null = null;
  let migrated: boolean | null = null;
  let cliffAt: string | null = null;
  let endsAt: string | null = null;
  const problems: string[] = [];
  try {
    /* The executor's receipt of the graduation names the move to the DEX: asked only once the curve has graduated. */
    const exitSignature = async () => (await autopilotReceipts(deps.store, deps.network.cluster, token).catch(() => [])).find((receipt) => receipt.kind === "GRADUATED")?.signature ?? null;
    const [observation, creation, lock] = await Promise.all([
      venue.observe(token, { exitSignature }),
      venue.observeCreation(record.signature, token),
      /* The escrow's address is known from the build: read it whatever the send said. A lock not read leaves the rest of
         the receipt standing — its mark is then not drawn and the page says the lock was not read, never that it is gone. */
      record.lock
        ? observeCreatorLock(deps.connection, record.lock.escrow).catch((): "UNREAD" => "UNREAD")
        : Promise.resolve<CreatorLockObservation | null>(null),
    ]);
    /* A lock not read settles nothing: «not read» is never «the escrow is there». */
    if (lock === "UNREAD") problems.push(RECEIPT_LOCK_UNREAD);
    else record = await settleLaunchLock(deps, record, lock !== null);
    if (observation.graduated?.exitUnread) problems.push(RECEIPT_EXIT_UNREAD);
    record = await settleFeeSharing(deps, record, observation.creator);
    progressBps = observation.curve.progressBps;
    migrated = observation.curve.migrated;
    if (lock && lock !== "UNREAD") {
      cliffAt = new Date(lock.cliffAt * 1000).toISOString();
      endsAt = new Date(lock.endsAt * 1000).toISOString();
    }
    receipt = buildLaunchReceiptFacts({
      cluster: deps.network.cluster,
      observation,
      creation,
      ryntraPoolPayer: deps.poolPayer,
      creatorLock: lock === "UNREAD" ? null : lock,
      metadataUriPrefix: `${deps.origin}/api/launch/metadata/`,
      advancedFirstBuyCapBps: record.advanced?.firstBuyCapBps ?? null,
      curveRuleSet: record.curveRules ?? null,
      observedAt: deps.now().toISOString(),
    });
  } catch (error) {
    /* The rules refused, or the chain was not read: the two are said apart (`receiptRefusedByRules`). */
    receipt = null;
    problems.splice(0, problems.length, error instanceof Error ? error.message.slice(0, 500) : "The chain could not be read.");
  }
  /* Taken down: no copy of the picture or the details is pointed at either — the IPFS addresses are not shown. */
  const storage = stored && !stored.takenDown ? await storageOf(deps, stored.id, stored.metadata.image).catch(() => null) : null;
  return {
    network: deps.network.chain,
    token: record.token,
    name: stored?.metadata.name ?? record.name,
    symbol: stored?.metadata.symbol ?? record.symbol,
    description: stored?.metadata.description ?? "",
    image: stored && !stored.takenDown ? stored.metadata.image : null,
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
    /* «Розширений»: its own numbers and why its tokenomics are unusual; «Спільнота»: its community token (SOL-L5). */
    ...(record.advanced ? { advanced: { terms: { ...record.advanced, graduationFee: { ...record.advanced.graduationFee } }, unusual: [...unusualTokenomics(record.advanced)] } } : {}),
    ...(record.preset === "community" ? pairOf(deps, record) : {}),
    /* SOL-L12: the pair currency's watch — a change its issuer made is said on the market's page; not read, said as nothing. */
    pairWatch: pairWatchView(await readQuoteWatch(deps.store, deps.network.cluster, record.pairMint).catch(() => null)),
    storage,
    observedAt: deps.now().toISOString(),
  };
}

/**
 * Where the token's metadata and picture are kept (SOL-L3): Ryntra's copy by the sha256 the mint names, the same bytes'
 * IPFS address, and the IPFS copy once the operator's provider pinned it. A store not read leaves the field out.
 */
/** «Спільнота»'s pair as the token's read names it; nothing where the network no longer offers that community. */
function pairOf(deps: Pick<LaunchDeps, "network">, record: Pick<LaunchRecord, "preset" | "pairMint">): Pick<LaunchTokenResponse, "pair"> {
  try {
    const pair = launchPair(deps.network, record.preset, record.pairMint);
    return { pair: { mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals } };
  } catch {
    return {};
  }
}

async function storageOf(deps: Pick<LaunchDeps, "store" | "origin">, metadataSha: string, image: string | undefined): Promise<NonNullable<LaunchTokenResponse["storage"]> | null> {
  const imageSha = image ? shaOfOurUri(image, deps.origin, "image") : null;
  const pins = await readIpfsPins(deps.store, [metadataSha, ...(imageSha ? [imageSha] : [])]);
  const file = (sha: string) => {
    const cid = ipfsCidOfSha256(sha);
    if (!cid) return null;
    const pin = pins.get(sha);
    return { sha256: sha, cid, ipfs: pin && pin.cid === cid ? { url: ipfsGatewayUrl(cid), pinnedAt: pin.pinnedAt } : null };
  };
  const metadata = file(metadataSha);
  /* A picture another token's takedown holds is not pointed at from this one either. */
  const imageDown = imageSha ? await isTakenDown(deps.store, "image", imageSha) : false;
  return metadata ? { metadata, image: imageSha && !imageDown ? file(imageSha) : null } : null;
}
