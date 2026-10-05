/**
 * «Запустити токен» — the server's half of a launch.
 *
 * 1. **Build** (`prepareLaunch`). The metadata the creator stored is checked
 *    again (the name and ticker borrow no brand or person), the creator's
 *    limit and the pool payer's balance are checked, and the venue builds the
 *    creation: the token on the preset's config, the creator's first purchase
 *    under the cap, and — first — the creator paying Ryntra's pool payer back
 *    every lamport of rent and fee the network simulated it spending. The
 *    sealed bytes are simulated again; a payer that would lose anything is a
 *    refused build. When the creator chose to lock the purchase, the lock is a
 *    second transaction built with it. The exact messages are remembered by
 *    their hashes for a few minutes.
 * 2. **The creator signs** both in their wallet — the server never holds a
 *    key of theirs.
 * 3. **Submit** (`submitLaunch`). The signed messages must be the remembered
 *    ones byte for byte, with every signature but the payer's present and
 *    valid; only then does the pool payer sign. The creation is sent once and
 *    confirmed, then the lock; the launch is recorded with the creator's
 *    referral code for the link they share.
 *
 * Nothing here decides for the creator or signs for them; the payer's
 * signature is what makes the token Ryntra's launch, and it covers only bytes
 * this server built and checked.
 */

import { createHash, randomBytes } from "node:crypto";

import { PublicKey, Transaction, type Connection, type Keypair } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { buildCreatorLockTransaction } from "../core/venues/meteora-dbc/creator-lock.server.ts";
import { LaunchRefusal, createMeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import { launchPreset, type LaunchPresetId } from "../core/venues/meteora-dbc/presets.ts";
import { creatorLockSchedule, type CreatorLockId } from "../core/launch/creator-lock.ts";
import type { GuardStore } from "../guard/store.ts";
import { ensureRewardAccount } from "../rewards/ledger.ts";
import { LAUNCHES_PER_CREATOR_PER_DAY, LAUNCHES_PER_HOUR, POOL_PAYER_FLOOR_LAMPORTS, type LaunchNetwork } from "./config.server.ts";
import { checkLaunchForm } from "./form.ts";
import { metadataOfUri } from "./metadata.server.ts";

/** How long a built launch waits for the creator's signature. */
export const BUILD_TTL_MS = 2 * 60 * 1000;

export type LaunchDeps = Readonly<{
  network: LaunchNetwork;
  connection: Connection;
  store: GuardStore;
  poolPayer: Keypair;
  /** The public origin the metadata and share links live on. */
  origin: string;
  now: () => Date;
}>;

export type LaunchFailureCode =
  | "METADATA_NOT_FOUND"
  | "NAME_BORROWED"
  | "CREATOR_LIMIT"
  | "PAYER_LOW"
  | "PRESET_UNAVAILABLE"
  | "FIRST_BUY_ABOVE_CAP"
  | "LOCK_NEEDS_PURCHASE"
  | "NOT_BUILT"
  | "BUILD_EXPIRED"
  | "BUILD_USED"
  | "WRONG_CREATOR"
  | "SIGNED_OTHER_BYTES"
  | "SIGNATURE_MISSING"
  | "SUBMIT_FAILED"
  | "BUILD_FAILED";

export type LaunchFailure = Readonly<{ ok: false; code: LaunchFailureCode; message: string }>;
const fail = (code: LaunchFailureCode, message: string): LaunchFailure => ({ ok: false, code, message });

export type LaunchBuildRecord = Readonly<{
  id: string;
  cluster: LaunchNetwork["cluster"];
  creator: string;
  preset: LaunchPresetId;
  token: string;
  pool: string;
  config: string;
  pairMint: string;
  metadataUri: string;
  name: string;
  symbol: string;
  firstBuyInRaw: string;
  firstBuyOutRaw: string;
  payerCoveredLamports: string;
  messageSha256: string;
  lock: Readonly<{ schedule: CreatorLockId; escrow: string; amountRaw: string; cliffAt: number; endsAt: number; messageSha256: string }> | null;
  createdAt: string;
  expiresAt: string;
  validUntil: string;
}>;

export type LaunchRecord = Readonly<{
  cluster: LaunchNetwork["cluster"];
  /** Written PENDING before the send; LAUNCHED once the chain confirms. A refused send removes the record. */
  state: "PENDING" | "LAUNCHED";
  token: string;
  pool: string;
  config: string;
  pairMint: string;
  preset: LaunchPresetId;
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
  signature: string;
  /** The creation's last block height: past it, a signature the chain never saw can no longer land. */
  validUntil: string;
  firstBuyInRaw: string;
  firstBuyOutRaw: string;
  /**
   * The creator's lock: LOCKED once its escrow is on chain; PENDING while its send has no answer — the token's read
   * settles it from the escrow's own address; FAILED when the network refused it or it was never sent.
   */
  lock: Readonly<{ schedule: CreatorLockId; escrow: string; signature: string | null; state: "LOCKED" | "PENDING" | "FAILED"; reason: string | null }> | null;
  /** The build this launch was sent from — its send is counted under it. */
  buildId: string;
  referralCode: string | null;
  launchedAt: string;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const launchKey = (cluster: string, token: string) => `solana:${cluster}:${token}`;
const creatorKey = (cluster: string, creator: string, token = "") => `solana:${cluster}:${creator}:${token}`;
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;

export type PrepareInput = Readonly<{
  creator: string;
  preset: LaunchPresetId;
  metadataUri: string;
  /** The first purchase in the pair currency's raw units; "0" for none. */
  firstBuyRaw: string;
  lock: CreatorLockId | null;
}>;

export type PreparedLaunch = Readonly<{
  ok: true;
  buildId: string;
  wireBase64: string;
  lockWireBase64: string | null;
  token: string;
  firstBuyOutRaw: string;
  payerCoveredLamports: string;
  /** The creator's SOL both transactions take, as simulated and counted before the signature. */
  creatorCostLamports: string;
  expiresAt: string;
}>;

/** The creator's sends in the last day — every one, the ones the chain refused too. */
async function sendsToday(deps: LaunchDeps, creator: string): Promise<number> {
  const since = deps.now().getTime() - 24 * 60 * 60 * 1000;
  const rows = await deps.store.collection<LaunchAttempt>("launchAttempts").valuesWithPrefix(creatorKey(deps.network.cluster, creator));
  return rows.filter((row) => Date.parse(row.at) >= since).length;
}

/**
 * Builds the creator never signed are kept an hour past their expiry, sends
 * two days (the day's limit counts back one) — then removed: anyone can ask
 * for a build, nobody can fill the store with them, and the counts read a day.
 */
async function sweepBuilds(deps: LaunchDeps): Promise<void> {
  const builds = deps.store.collection<LaunchBuildRecord>("launchBuilds");
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  for (const build of await builds.valuesWithPrefix(`${deps.network.cluster}:`)) {
    if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.cluster, build.id));
  }
  const attempts = deps.store.collection<LaunchAttempt>("launchAttempts");
  const old = deps.now().getTime() - 48 * 60 * 60 * 1000;
  for (const attempt of await attempts.valuesWithPrefix(`solana:${deps.network.cluster}:`)) {
    if (Date.parse(attempt.at) < old) await attempts.delete(creatorKey(deps.network.cluster, attempt.creator, attempt.buildId));
  }
}

export async function prepareLaunch(deps: LaunchDeps, input: PrepareInput): Promise<PreparedLaunch | LaunchFailure> {
  const preset = launchPreset(input.preset);
  if (!preset || !deps.network.configs[preset.id]) return fail("PRESET_UNAVAILABLE", "This preset has no config on this network.");
  const stored = await metadataOfUri(deps.store, input.metadataUri, deps.origin);
  if (!stored) return fail("METADATA_NOT_FOUND", "The token's details were not found; fill the form again.");
  const check = checkLaunchForm({ name: stored.metadata.name, symbol: stored.metadata.symbol, description: stored.metadata.description, website: "", x: "", telegram: "" });
  if (check.hits.length) return fail("NAME_BORROWED", `The name or ticker reads as ${check.hits.map((hit) => hit.label).join(", ")}.`);
  if (input.lock && BigInt(input.firstBuyRaw) <= 0n) return fail("LOCK_NEEDS_PURCHASE", "Only a first purchase can be locked.");
  await sweepBuilds(deps).catch(() => undefined);
  if ((await sendsToday(deps, input.creator)) >= LAUNCHES_PER_CREATOR_PER_DAY) {
    return fail("CREATOR_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} tokens a day.`);
  }
  const payerBalance = BigInt(await deps.connection.getBalance(deps.poolPayer.publicKey, "confirmed"));
  if (payerBalance < POOL_PAYER_FLOOR_LAMPORTS) return fail("PAYER_LOW", "Launching is paused for a moment; try again later.");

  const venue = createMeteoraDbcLaunchVenue({ connection: deps.connection, configs: deps.network.configs, poolPayer: deps.poolPayer.publicKey.toBase58() });
  let built;
  try {
    built = await venue.create(
      {
        network: "solana",
        name: stored.metadata.name,
        symbol: stored.metadata.symbol,
        metadataUri: input.metadataUri,
        preset: preset.id,
        creator: input.creator,
        creatorFirstBuyRaw: input.firstBuyRaw,
        pairMint: deps.network.pairs[preset.id].mint,
      },
      { creatorCoversPayer: true },
    );
  } catch (error) {
    if (error instanceof LaunchRefusal && error.code === "CREATOR_BUY_ABOVE_CAP") return fail("FIRST_BUY_ABOVE_CAP", "The first purchase is above the preset's cap.");
    return fail("BUILD_FAILED", error instanceof Error ? error.message : "The launch could not be built.");
  }
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  const now = deps.now();
  let lock: LaunchBuildRecord["lock"] = null;
  let lockWireBase64: string | null = null;
  let lockCost = 0n;
  if (input.lock) {
    const schedule = creatorLockSchedule(input.lock);
    if (!schedule) return fail("BUILD_FAILED", "Unknown lock.");
    const lockBuild = await buildCreatorLockTransaction({
      connection: deps.connection,
      mint: built.token,
      creator: input.creator,
      amountRaw: BigInt(built.creatorFirstBuyOutRaw),
      schedule,
      startSeconds: Math.floor(now.getTime() / 1000),
      recentBlockhash: tx.recentBlockhash ?? "",
      lastValidBlockHeight: Number(built.validUntil ?? 0),
    });
    lockWireBase64 = lockBuild.wireBase64;
    lockCost = BigInt(lockBuild.costLamports);
    lock = {
      schedule: schedule.id,
      escrow: lockBuild.escrow,
      amountRaw: lockBuild.amountRaw,
      cliffAt: lockBuild.cliffAt,
      endsAt: lockBuild.endsAt,
      messageSha256: sha256(Transaction.from(Buffer.from(lockBuild.wireBase64, "base64")).serializeMessage()),
    };
  }
  const record: LaunchBuildRecord = {
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    creator: input.creator,
    preset: preset.id,
    token: built.token,
    pool: built.pool,
    config: built.config,
    pairMint: built.pairMint,
    metadataUri: input.metadataUri,
    name: stored.metadata.name,
    symbol: stored.metadata.symbol,
    firstBuyInRaw: input.firstBuyRaw,
    firstBuyOutRaw: built.creatorFirstBuyOutRaw,
    payerCoveredLamports: built.payerCoveredLamports,
    messageSha256: sha256(tx.serializeMessage()),
    lock,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + BUILD_TTL_MS).toISOString(),
    validUntil: built.validUntil ?? "0",
  };
  await deps.store.collection<LaunchBuildRecord>("launchBuilds").insertIfAbsent(buildKey(record.cluster, record.id), record);
  return {
    ok: true,
    buildId: record.id,
    wireBase64: built.wireBase64,
    lockWireBase64,
    token: built.token,
    firstBuyOutRaw: built.creatorFirstBuyOutRaw,
    payerCoveredLamports: built.payerCoveredLamports,
    creatorCostLamports: (BigInt(built.creatorSpendLamports ?? built.payerCoveredLamports) + lockCost).toString(),
    expiresAt: record.expiresAt,
  };
}

/** The signed bytes against the remembered message: the same message, and every signature it needs but `except` present and valid. */
function signedAsBuilt(wireBase64: string, messageSha256: string, except: PublicKey | null): Transaction | LaunchFailure {
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(wireBase64, "base64"));
  } catch {
    return fail("SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (sha256(tx.serializeMessage()) !== messageSha256) return fail("SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  if (!tx.verifySignatures(false)) return fail("SIGNATURE_MISSING", "A signature does not match the transaction.");
  const missing = tx.signatures.filter((entry) => entry.signature === null && !(except && entry.publicKey.equals(except)));
  if (missing.length) return fail("SIGNATURE_MISSING", "The transaction is not signed by the creator.");
  return tx;
}

export type SubmittedLaunch = Readonly<{ ok: true; token: string; signature: string; state: "LAUNCHED" | "PENDING"; lock: LaunchRecord["lock"]; tokenPath: string }>;

/**
 * What one send came to: confirmed; refused by the network's own preflight
 * before it reached the chain (it cost nobody anything); failed on chain (the
 * pool payer paid its fee); or not known yet — the bytes may still land until
 * their blockhash expires.
 */
type Sent = Readonly<{ outcome: "CONFIRMED" | "REJECTED" | "FAILED" | "UNKNOWN"; signature: string; reason: string | null }>;

/** The chain's word on a signature: confirmed, refused, expired (its blockhash passed and it never landed), or not known yet. */
async function signatureOutcome(connection: Connection, signature: string, validUntil: number): Promise<Sent["outcome"] | "EXPIRED"> {
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => null))?.value[0];
  if (status) {
    if (status.err !== null) return "FAILED";
    if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return "CONFIRMED";
    return "UNKNOWN";
  }
  const height = await connection.getBlockHeight("confirmed").catch(() => null);
  return height !== null && height > validUntil ? "EXPIRED" : "UNKNOWN";
}

const SETTLE_POLL_MS = 2_000;

/** A preflight refusal: the RPC simulated the bytes and they failed — the chain never saw them. Any other send error leaves the outcome open. */
function preflightRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const logs = (error as { logs?: unknown }).logs;
  /* «Already processed» is a preflight answer too, and it means the opposite: the bytes are on chain. */
  if (/already (been )?processed/i.test(error.message)) return false;
  return /simulation failed|Transaction simulation/i.test(error.message) || (Array.isArray(logs) && logs.length > 0);
}

/**
 * One send, inside a time budget: confirm for up to `confirmMs`, then read the
 * signature's status until `settleMs` more has passed. The whole stays within
 * what the route may take; past it the outcome is UNKNOWN and the token's read
 * settles it from the chain.
 */
async function sendOnce(connection: Connection, tx: Transaction, validUntil: number, now: () => Date, budget: Readonly<{ confirmMs: number; settleMs: number }>): Promise<Sent> {
  const signature = getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array()));
  let sendError: unknown = null;
  try {
    await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 2 });
  } catch (error) {
    if (preflightRefused(error)) return { outcome: "REJECTED", signature, reason: error instanceof Error ? error.message.slice(0, 300) : "The network refused it." };
    /* A lost answer is not a refusal: the bytes may have reached the network. */
    sendError = error;
  }
  if (!sendError) {
    try {
      const confirmed = await Promise.race([
        connection.confirmTransaction({ signature, blockhash: tx.recentBlockhash ?? "", lastValidBlockHeight: validUntil }, "confirmed"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), budget.confirmMs)),
      ]);
      if (confirmed) return confirmed.value.err ? { outcome: "FAILED", signature, reason: JSON.stringify(confirmed.value.err).slice(0, 300) } : { outcome: "CONFIRMED", signature, reason: null };
    } catch (error) {
      sendError = error;
    }
  }
  /* Not confirmed in time is not «failed»: the bytes may still land until their blockhash expires. The chain's own word decides. */
  const until = now().getTime() + budget.settleMs;
  for (;;) {
    const outcome = await signatureOutcome(connection, signature, validUntil);
    if (outcome === "CONFIRMED") return { outcome, signature, reason: null };
    if (outcome === "FAILED") return { outcome: "FAILED", signature, reason: sendError instanceof Error ? sendError.message.slice(0, 300) : "The network refused it on chain." };
    if (outcome === "EXPIRED") return { outcome: "REJECTED", signature, reason: "The network never saw the launch before its blockhash expired." };
    if (now().getTime() >= until) return { outcome: "UNKNOWN", signature, reason: null };
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

/* The route may run 60 s: the creation gets the most of it, the lock what remains; past it, PENDING. */
const CREATION_BUDGET = { confirmMs: 20_000, settleMs: 10_000 } as const;
const LOCK_BUDGET = { confirmMs: 12_000, settleMs: 6_000 } as const;

export type LaunchAttempt = Readonly<{ buildId: string; creator: string; at: string }>;

/** Claims one send for a build and counts it against the creator's day and the network's hour; a claim over a limit is released and refused. */
async function claimAttempt(deps: LaunchDeps, build: LaunchBuildRecord): Promise<LaunchFailure | null> {
  const attempts = deps.store.collection<LaunchAttempt>("launchAttempts");
  const key = creatorKey(build.cluster, build.creator, build.id);
  const now = deps.now();
  /* One send per build: whoever claims the key sends; a second press of the button finds it used. */
  if (!(await attempts.insertIfAbsent(key, { buildId: build.id, creator: build.creator, at: now.toISOString() }))) return fail("BUILD_USED", "This launch was already sent.");
  const day = now.getTime() - 24 * 60 * 60 * 1000;
  const hour = now.getTime() - 60 * 60 * 1000;
  const mine = (await attempts.valuesWithPrefix(creatorKey(build.cluster, build.creator))).filter((row) => Date.parse(row.at) >= day).length;
  const all = (await attempts.valuesWithPrefix(`solana:${build.cluster}:`)).filter((row) => Date.parse(row.at) >= hour).length;
  if (mine > LAUNCHES_PER_CREATOR_PER_DAY || all > LAUNCHES_PER_HOUR) {
    await attempts.delete(key);
    return mine > LAUNCHES_PER_CREATOR_PER_DAY ? fail("CREATOR_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} tokens a day.`) : fail("PAYER_LOW", "Launching is paused for a moment; try again later.");
  }
  return null;
}

export async function submitLaunch(
  deps: LaunchDeps,
  input: Readonly<{ buildId: string; creator: string; signedWireBase64: string; signedLockWireBase64: string | null }>,
): Promise<SubmittedLaunch | LaunchFailure> {
  const builds = deps.store.collection<LaunchBuildRecord>("launchBuilds");
  const build = await builds.get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.cluster !== deps.network.cluster) return fail("NOT_BUILT", "This launch was not built here.");
  if (build.creator !== input.creator) return fail("WRONG_CREATOR", "This launch was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("BUILD_EXPIRED", "The launch waited too long for the signature; build it again.");
  const creation = signedAsBuilt(input.signedWireBase64, build.messageSha256, deps.poolPayer.publicKey);
  if ("ok" in creation) return creation;
  let lockTx: Transaction | null = null;
  if (build.lock) {
    if (!input.signedLockWireBase64) return fail("SIGNATURE_MISSING", "The lock was not signed.");
    const signed = signedAsBuilt(input.signedLockWireBase64, build.lock.messageSha256, null);
    if ("ok" in signed) return signed;
    lockTx = signed;
  }
  const refused = await claimAttempt(deps, build);
  if (refused) return refused;

  creation.partialSign(deps.poolPayer);
  const signature = getBase58Decoder().decode(new Uint8Array(creation.signatures[0]?.signature ?? new Uint8Array()));
  const referral = await ensureRewardAccount(deps.store, build.creator, deps.now().toISOString()).catch(() => null);
  const pending: LaunchRecord = {
    cluster: build.cluster,
    state: "PENDING",
    token: build.token,
    pool: build.pool,
    config: build.config,
    pairMint: build.pairMint,
    preset: build.preset,
    creator: build.creator,
    name: build.name,
    symbol: build.symbol,
    metadataUri: build.metadataUri,
    signature,
    validUntil: build.validUntil,
    firstBuyInRaw: build.firstBuyInRaw,
    firstBuyOutRaw: build.firstBuyOutRaw,
    lock: null,
    referralCode: referral?.code ?? null,
    launchedAt: deps.now().toISOString(),
    buildId: build.id,
  };
  /* Written before the send: a launch the network has not answered for yet is still found, and its page reads the chain to finish it. */
  await writeLaunch(deps.store, pending);
  const sent = await sendOnce(deps.connection, creation, Number(build.validUntil), deps.now, CREATION_BUDGET);
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    await removeLaunch(deps.store, pending);
    /* Refused before the chain saw it: it cost nobody anything, so it counts against no limit. A failure on chain cost the payer its fee and stays counted. */
    if (sent.outcome === "REJECTED") await deps.store.collection<LaunchAttempt>("launchAttempts").delete(creatorKey(build.cluster, build.creator, build.id));
    return fail("SUBMIT_FAILED", sent.reason ?? "The network refused the launch.");
  }
  if (sent.outcome === "UNKNOWN") {
    /* The lock waits for the creation: its tokens exist only once the creation lands. The page says what the chain says. */
    const lock: LaunchRecord["lock"] = build.lock ? { schedule: build.lock.schedule, escrow: build.lock.escrow, signature: null, state: "FAILED", reason: "not sent: the launch was not confirmed in time" } : null;
    await writeLaunch(deps.store, { ...pending, lock });
    return { ok: true, token: build.token, signature, state: "PENDING", lock, tokenPath: `/app/launch/${build.token}` };
  }

  let lock: LaunchRecord["lock"] = null;
  if (build.lock && lockTx) {
    const locked = await sendOnce(deps.connection, lockTx, Number(build.validUntil), deps.now, LOCK_BUDGET);
    const state = locked.outcome === "CONFIRMED" ? "LOCKED" : locked.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
    lock = { schedule: build.lock.schedule, escrow: build.lock.escrow, signature: locked.signature, state, reason: state === "FAILED" ? (locked.reason ?? "the network refused the lock") : null };
  }
  await writeLaunch(deps.store, { ...pending, state: "LAUNCHED", lock });
  return { ok: true, token: build.token, signature, state: "LAUNCHED", lock, tokenPath: `/app/launch/${build.token}` };
}

async function writeLaunch(store: GuardStore, record: LaunchRecord): Promise<void> {
  await store.collection<LaunchRecord>("launches").set(launchKey(record.cluster, record.token), record);
  await store.collection<LaunchRecord>("launchesByCreator").set(creatorKey(record.cluster, record.creator, record.token), record);
}

async function removeLaunch(store: GuardStore, record: LaunchRecord): Promise<void> {
  await store.collection<LaunchRecord>("launches").delete(launchKey(record.cluster, record.token));
  await store.collection<LaunchRecord>("launchesByCreator").delete(creatorKey(record.cluster, record.creator, record.token));
}

/**
 * A launch as its record and the chain say now: a pending one is settled by
 * the chain's word on its signature — confirmed becomes launched, refused or
 * expired is removed (nothing landed) — and anything still unknown stays
 * pending. Null when there is no launch of the token here.
 */
export async function readLaunchRecord(deps: Pick<LaunchDeps, "store" | "connection">, cluster: string, token: string): Promise<LaunchRecord | null> {
  const record = (await deps.store.collection<LaunchRecord>("launches").get(launchKey(cluster, token))) ?? null;
  if (!record || record.state !== "PENDING") return record;
  const outcome = await signatureOutcome(deps.connection, record.signature, Number(record.validUntil));
  if (outcome === "CONFIRMED") {
    const launched: LaunchRecord = { ...record, state: "LAUNCHED" };
    await writeLaunch(deps.store, launched);
    return launched;
  }
  if (outcome === "FAILED" || outcome === "EXPIRED") {
    await removeLaunch(deps.store, record);
    /* Never seen by the chain, it cost nobody anything: its send counts against no limit. */
    if (outcome === "EXPIRED" && record.buildId) await deps.store.collection<LaunchAttempt>("launchAttempts").delete(creatorKey(cluster, record.creator, record.buildId));
    return null;
  }
  return record;
}

/**
 * The lock as the chain settles it: an escrow at its address is LOCKED, whatever the send said; a PENDING one whose
 * signature failed or expired is FAILED. The record is rewritten when the state changes.
 */
export async function settleLaunchLock(deps: Pick<LaunchDeps, "store" | "connection">, record: LaunchRecord, escrowFound: boolean): Promise<LaunchRecord> {
  const lock = record.lock;
  if (!lock || lock.state === "LOCKED") return record;
  let next: NonNullable<LaunchRecord["lock"]> | null = null;
  if (escrowFound) next = { ...lock, state: "LOCKED", reason: null };
  else if (lock.state === "PENDING" && lock.signature) {
    const outcome = await signatureOutcome(deps.connection, lock.signature, Number(record.validUntil));
    if (outcome === "FAILED" || outcome === "EXPIRED") next = { ...lock, state: "FAILED", reason: "the network did not take the lock" };
  }
  if (!next) return record;
  const settled: LaunchRecord = { ...record, lock: next };
  await writeLaunch(deps.store, settled);
  return settled;
}

/** The link a creator shares: their referral code, landing on the token's page. */
export function launchShareLink(origin: string, record: Pick<LaunchRecord, "token" | "referralCode">): string {
  const page = `/app/launch/${record.token}`;
  /* The page is a path of base58 letters and slashes — legal in a query as it is, so the link reads plainly. */
  return record.referralCode ? `${origin}/r/${record.referralCode}?to=${page}` : `${origin}${page}`;
}
