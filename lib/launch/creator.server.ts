/**
 * «Мої лаунчі» — the creator's cabinet, the server's half.
 *
 * - `readCreatorCabinet` — a wallet's launches as their creator, and the
 *   launches whose creator fees it shares in («Спільнота»), each read again
 *   from the chain: the curve's way to the DEX and what the creator's side
 *   earned by source, the wallet's part of it. A launch whose chain could not
 *   be read is listed with its figures unread, never as zero. Then the
 *   wallet's claim receipts and the creator earnings card's data.
 * - `buildLaunchClaim` / `submitLaunchClaim` — «Забрати»: every source
 *   holding a fee now, in transactions the wallet signs as the only signer;
 *   the signed bytes must be the built ones (the wallet may add only its own
 *   fee and guard instructions); sent once; the receipt is read back from the
 *   programs' own events and the wallet's own balance, and kept by wallet and
 *   signature.
 * - A launch the chain shows graduated earns its creator the Growth line's
 *   points, once per mint (`recordLaunchGraduation` in `lib/rewards`).
 *
 * Everything here is public on chain — who created a token, its fees, a
 * claim's transaction — so the cabinet reads by address; nothing private of
 * the person's is kept or shown.
 */

import { randomBytes } from "node:crypto";

import { getBase58Decoder } from "@solana/kit";
import { Transaction } from "@solana/web3.js";

import type {
  ApiErrorCode,
  LaunchCabinetRow,
  LaunchClaimBuildResponse,
  LaunchClaimReceipt,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
} from "../api/v1/contract.ts";
import { creatorEarningsCard, type CreatorEarningsCard } from "../core/launch/earnings-card.ts";
import { ClaimRefusal, buildCreatorClaim, earningsOf, mayClaim, observeCreatorClaim, readCreatorFees, type CreatorFeesObservation } from "../core/venues/meteora-dbc/claim.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import type { LaunchDeps, LaunchRecord } from "./flow.server.ts";
import { FEE_SHARE_INDEX, feeShareKey, readLaunchRecord, sendOnce, settleFeeSharing, type FeeShareIndex } from "./flow.server.ts";
import { noteGraduation } from "./graduation.server.ts";
import { forgetLaunchMarket } from "./market.server.ts";
import { metadataOfUri } from "./metadata.server.ts";

export type CabinetDeps = Pick<LaunchDeps, "network" | "connection" | "store" | "now">;

/** How long one read of a cabinet may take inside the route's minute; launches past it are listed unread. */
const CABINET_BUDGET_MS = 40_000;
/** How many launches a cabinet lists, the newest first. */
const CABINET_LAUNCHES = 50;
const RECEIPTS = 50;
/** How long a built claim waits for the signature. */
export const CLAIM_BUILD_TTL_MS = 90 * 1000;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 8_000 } as const;

const claimKey = (cluster: string, wallet: string, signature = "") => `solana:${cluster}:${wallet}:${signature}`;
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;


type CabinetRead = Readonly<{ row: LaunchCabinetRow; card: Parameters<typeof creatorEarningsCard>[0]["rows"][number] | null }>;

async function readRow(deps: CabinetDeps, record: LaunchRecord, wallet: string, deadline: number): Promise<CabinetRead> {
  const pairOf = deps.network.pairs[record.preset];
  const stored = await metadataOfUri(deps.store, record.metadataUri, deps.network.origin).catch(() => null);
  let observation: CreatorFeesObservation | null = null;
  let settled = record;
  if (Date.now() < deadline - 3_000) {
    try {
      observation = await readCreatorFees(deps.connection, { token: record.token, pool: record.pool });
      settled = await settleFeeSharing(deps, record, observation.roleOwner);
      if (observation.migrated) await noteGraduation(deps.store, record, observation.graduatedAt, deps.now()).catch(() => undefined);
    } catch {
      /* Unread stays unread: the row says so, never zero. */
      observation = null;
    }
  }
  const sharing = settled.feeSharing ?? null;
  /* A wallet named in a sharing that has not landed (or never will) takes nothing yet: no figure of the creator's is its. */
  const waiting = record.creator !== wallet && sharing?.state !== "SHARED";
  const earnings = observation && !waiting ? earningsOf(observation, wallet) : null;
  const pair = { mint: record.pairMint, symbol: pairOf.symbol, decimals: pairOf.decimals, dollar: pairOf.dollar };
  const row: LaunchCabinetRow = {
    token: record.token,
    name: stored?.metadata.name ?? record.name,
    symbol: stored?.metadata.symbol ?? record.symbol,
    image: stored?.metadata.image ?? null,
    preset: record.preset,
    creator: record.creator,
    role: record.creator === wallet ? "creator" : "recipient",
    launchedAt: record.launchedAt,
    pair,
    progressBps: observation ? progressOf(observation) : null,
    migrated: observation ? observation.migrated : null,
    earnings,
    feeSharing: sharing ? { vault: sharing.vault, shares: [...sharing.shares], signature: sharing.signature, state: sharing.state, reason: sharing.reason } : null,
    claimable: Boolean(observation && earnings && mayClaim(observation, wallet) && BigInt(earnings.mine.unclaimedRaw) > 0n),
  };
  /* The card counts only what the wallet took part in: a sharing not landed is left out, not counted as unread. */
  const card = waiting ? null : { launchedAt: record.launchedAt, migrated: row.migrated, read: earnings !== null, pair, earnedRaw: earnings?.mine.earnedRaw ?? "0", claimedRaw: earnings?.mine.claimedRaw ?? "0" };
  return { row, card };
}

function progressOf(observation: CreatorFeesObservation): number {
  const threshold = BigInt(observation.read.graduation.thresholdRaw);
  if (observation.migrated) return 10_000;
  return threshold === 0n ? 0 : Math.min(10_000, Number((BigInt(observation.reserveRaw) * 10_000n) / threshold));
}

/** Whether a launch is the wallet's to list: its own, or another's whose sharing names it and has not failed. */
export function sharesWith(record: Pick<LaunchRecord, "creator" | "feeSharing">, wallet: string): boolean {
  if (record.creator === wallet) return true;
  const sharing = record.feeSharing;
  return Boolean(sharing && sharing.state !== "FAILED" && sharing.shares.some((share) => share.address === wallet));
}

/** The wallet's launches — as creator and as a sharer of creator fees — the newest first. */
async function cabinetRecords(deps: CabinetDeps, wallet: string): Promise<readonly LaunchRecord[]> {
  const cluster = deps.network.cluster;
  const own = await deps.store.collection<LaunchRecord>("launchesByCreator").valuesWithPrefix(`solana:${cluster}:${wallet}:`);
  const shared = await deps.store.collection<FeeShareIndex>(FEE_SHARE_INDEX).valuesWithPrefix(feeShareKey(cluster, wallet));
  const records: LaunchRecord[] = [];
  const seen = new Set<string>();
  for (const candidate of [...own.map((record) => record.token), ...shared.map((entry) => entry.token)]) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    /* A pending launch is settled by the chain's word on its signature; one that never landed is gone. */
    const record = await readLaunchRecord(deps, cluster, candidate).catch(() => null);
    if (!record || record.state === "PENDING" || record.cluster !== cluster) continue;
    if (!sharesWith(record, wallet)) continue;
    records.push(record);
  }
  return records.sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt)).slice(0, CABINET_LAUNCHES);
}

export async function listClaimReceipts(store: GuardStore, cluster: string, wallet: string): Promise<readonly LaunchClaimReceipt[]> {
  const rows = await store.collection<LaunchClaimReceipt>("launchClaims").valuesWithPrefix(claimKey(cluster, wallet));
  return [...rows].sort((a, b) => Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0")).slice(0, RECEIPTS);
}

export async function readCreatorCabinet(deps: CabinetDeps, wallet: string): Promise<LaunchCreatorCabinetResponse> {
  const deadline = Date.now() + CABINET_BUDGET_MS;
  const records = await cabinetRecords(deps, wallet);
  const reads: CabinetRead[] = [];
  /* One at a time: a public node answers a burst with 429. What time does not reach is listed unread. */
  for (const record of records) reads.push(await readRow(deps, record, wallet, deadline));
  const receipts = await listClaimReceipts(deps.store, deps.network.cluster, wallet);
  const now = deps.now().toISOString();
  return {
    network: deps.network.chain,
    wallet,
    launches: reads.map((read) => read.row),
    receipts: [...receipts],
    card: cardView(creatorEarningsCard({ wallet, network: deps.network.chain, rows: reads.flatMap((read) => (read.card ? [read.card] : [])), receipts: receipts.map((receipt) => receipt.signature), now }), deps.network.chain),
    observedAt: now,
  };
}

function cardView(card: CreatorEarningsCard, network: LaunchCreatorCabinetResponse["network"]): LaunchCreatorCabinetResponse["card"] {
  return { ...card, network, period: { ...card.period }, amounts: card.amounts.map((amount) => ({ ...amount })), receipts: [...card.receipts] };
}

/** The creator earnings card's data for the Growth line's card: the same figures the cabinet shows. */
export async function readCreatorEarningsCard(deps: CabinetDeps, wallet: string): Promise<LaunchCreatorCabinetResponse["card"]> {
  return (await readCreatorCabinet(deps, wallet)).card;
}

/* ------------------------------------------------------------ «Забрати» */

export type ClaimFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string }>;
const fail = (code: ApiErrorCode, message: string): ClaimFailure => ({ ok: false, code, message });

type ClaimBuildRecord = Readonly<{
  id: string;
  cluster: string;
  token: string;
  wallet: string;
  /** The bytes as built, unsigned, in order: the signed ones are compared with them. */
  wires: readonly string[];
  validUntil: readonly string[];
  createdAt: string;
  expiresAt: string;
}>;

type ClaimSend = Readonly<{ cluster: string; id: string; at: string }>;

async function launchFor(deps: CabinetDeps, token: string): Promise<LaunchRecord | ClaimFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  return record;
}

/** Builds older than an hour past their expiry are removed: anyone may ask for a build, nobody can fill the store with them. */
async function sweep(deps: CabinetDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  const builds = deps.store.collection<ClaimBuildRecord>("launchClaimBuilds");
  for (const build of await builds.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.cluster, build.id));
  const sends = deps.store.collection<ClaimSend>("launchClaimSends");
  for (const send of await sends.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(send.at) < stale) await sends.delete(buildKey(send.cluster, send.id));
}

export async function buildLaunchClaim(deps: CabinetDeps, token: string, wallet: string): Promise<Readonly<{ ok: true; build: LaunchClaimBuildResponse }> | ClaimFailure> {
  const record = await launchFor(deps, token);
  if ("ok" in record) return record;
  try {
    const observation = await readCreatorFees(deps.connection, { token, pool: record.pool });
    const built = await buildCreatorClaim(deps.connection, { observation, wallet, configs: deps.network.configs });
    const earnings = earningsOf(observation, wallet);
    await sweep(deps).catch(() => undefined);
    const now = deps.now();
    const build: ClaimBuildRecord = {
      id: randomBytes(16).toString("hex"),
      cluster: deps.network.cluster,
      token,
      wallet,
      wires: built.txs.map((tx) => tx.wireBase64),
      validUntil: built.txs.map((tx) => tx.validUntil ?? "0"),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CLAIM_BUILD_TTL_MS).toISOString(),
    };
    await deps.store.collection<ClaimBuildRecord>("launchClaimBuilds").insertIfAbsent(buildKey(build.cluster, build.id), build);
    const pair = deps.network.pairs[record.preset];
    return {
      ok: true,
      build: {
        buildId: build.id,
        network: deps.network.chain,
        unsignedWireBase64: [...build.wires],
        sources: [...built.sources],
        expectedRaw: earnings.mine.unclaimedRaw,
        networkCostLamports: built.costLamports,
        pair: { mint: record.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
        expiresAt: build.expiresAt,
      },
    };
  } catch (error) {
    if (error instanceof ClaimRefusal) return error.code === "NOT_YOURS" ? fail("WALLET_MISMATCH", error.message) : fail("LAUNCH_NOTHING_TO_CLAIM", error.message);
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The claim could not be prepared.");
  }
}

export async function submitLaunchClaim(
  deps: CabinetDeps,
  token: string,
  input: Readonly<{ buildId: string; wallet: string; signedWireBase64: readonly string[] }>,
): Promise<Readonly<{ ok: true; submit: LaunchClaimSubmitResponse }> | ClaimFailure> {
  const build = await deps.store.collection<ClaimBuildRecord>("launchClaimBuilds").get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.token !== token) return fail("LAUNCH_NOT_FOUND", "This claim was not built here.");
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", "This claim was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The claim waited too long for the signature; prepare it again.");
  if (input.signedWireBase64.length !== build.wires.length) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet did not sign every transaction of the claim.");
  const txs: Transaction[] = [];
  for (let index = 0; index < build.wires.length; index += 1) {
    /* The wallet's own fee and guard instructions are its right; any other change is not the claim the person reviewed. */
    const verdict = compareWalletTransaction({ expectedWireBase64: build.wires[index]!, actualWireBase64: input.signedWireBase64[index]!, guardPolicy: "BOUNDED" });
    if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
    let tx: Transaction;
    try {
      tx = Transaction.from(Buffer.from(input.signedWireBase64[index]!, "base64"));
    } catch {
      return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
    }
    if (!tx.verifySignatures(true)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature is missing or does not match the transaction.");
    txs.push(tx);
  }
  /* One send per build: a second press of the button finds it used. */
  if (!(await deps.store.collection<ClaimSend>("launchClaimSends").insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This claim was already sent.");
  }
  const record = await launchFor(deps, token);
  if ("ok" in record) return record;
  const receipts: LaunchClaimReceipt[] = [];
  const pending: string[] = [];
  const failed: { signature: string; reason: string }[] = [];
  for (let index = 0; index < txs.length; index += 1) {
    /* After one that did not land, the rest are not sent: each part waits on the one before it. */
    if (failed.length) {
      failed.push({ signature: signatureOf(txs[index]!), reason: "not sent: the transaction before it did not land" });
      continue;
    }
    const sent = await sendOnce(deps.connection, txs[index]!, Number(build.validUntil[index] ?? "0"), deps.now, SEND_BUDGET);
    if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
      if (receipts.length === 0 && pending.length === 0) return fail("LAUNCH_SUBMIT_FAILED", sent.reason ?? "The network refused the claim.");
      failed.push({ signature: sent.signature, reason: (sent.reason ?? "the network refused it").slice(0, 300) });
      continue;
    }
    if (sent.outcome === "UNKNOWN") {
      pending.push(sent.signature);
      continue;
    }
    const receipt = await claimReceipt(deps, record, input.wallet, sent.signature);
    if (receipt) receipts.push(receipt);
    else pending.push(sent.signature);
  }
  forgetLaunchMarket(deps.network.cluster, token);
  /* CONFIRMED only when every transaction landed; a part that did not is said as a part, never as the whole. */
  const state = failed.length ? "PARTIAL" : pending.length ? "PENDING" : "CONFIRMED";
  return { ok: true, submit: { state, receipts, pending, failed } };
}

const signatureOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array(64)));

/**
 * A confirmed claim's receipt, read back from the chain a few times while a node has no record of it yet, and kept by
 * wallet and signature. Null when it could not be read: the signature stands, and its transaction is on chain.
 */
async function claimReceipt(deps: CabinetDeps, record: LaunchRecord, wallet: string, signature: string): Promise<LaunchClaimReceipt | null> {
  const fees = await readCreatorFees(deps.connection, { token: record.token, pool: record.pool }).catch(() => null);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = await observeCreatorClaim(deps.connection, { signature, wallet, pairMint: record.pairMint, pool: record.pool, graduatedPool: fees?.graduated?.pool ?? null }).catch(() => null);
    if (observed && !observed.failed) {
      const pair = deps.network.pairs[record.preset];
      const receipt: LaunchClaimReceipt = {
        token: record.token,
        name: record.name,
        symbol: record.symbol,
        signature,
        at: observed.at === null ? null : new Date(observed.at * 1000).toISOString(),
        pair: { mint: record.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
        paid: observed.paid,
        vaultPaidRaw: observed.vaultPaidRaw,
        /* A balance never falls on a claim: a negative change would be someone else's transfer in the same transaction. */
        receivedRaw: BigInt(observed.receivedRaw) > 0n ? observed.receivedRaw : "0",
      };
      await deps.store.collection<LaunchClaimReceipt>("launchClaims").set(claimKey(record.cluster, wallet, signature), receipt);
      return receipt;
    }
    if (observed?.failed) return null;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return null;
}
