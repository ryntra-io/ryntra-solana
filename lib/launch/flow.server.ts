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
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getBase58Decoder } from "@solana/kit";

import { MET_LOCK_PROGRAM, buildCreatorLockTransaction } from "../core/venues/meteora-dbc/creator-lock.server.ts";
import { LaunchRefusal, createMeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import { launchPreset, type LaunchPresetId } from "../core/venues/meteora-dbc/presets.ts";
import { creatorLockSchedule, type CreatorLockId } from "../core/launch/creator-lock.ts";
import { feeShareProblems, type FeeShare } from "../core/launch/fee-shares.ts";
import type { GuardStore } from "../guard/store.ts";
import { ensureRewardAccount } from "../rewards/ledger.ts";
import { LAUNCHES_PER_CREATOR_PER_DAY, LAUNCHES_PER_HOUR, POOL_PAYER_FLOOR_LAMPORTS, launchPair, type LaunchNetwork } from "./config.server.ts";
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
  /** A second operator asked before a signature is called absent: one public node behind another is not the chain. */
  second?: Connection | null;
}>;

export type LaunchFailureCode =
  | "METADATA_NOT_FOUND"
  | "NAME_BORROWED"
  | "CREATOR_LIMIT"
  | "PAYER_LOW"
  | "PRESET_UNAVAILABLE"
  | "FIRST_BUY_ABOVE_CAP"
  | "LOCK_NEEDS_PURCHASE"
  | "SHARES_INVALID"
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
  /** «Спільнота» sharing the creator's fees: the vault, the shares and the second transaction's message. */
  split: Readonly<{ vault: string; shares: readonly FeeShare[]; messageSha256: string }> | null;
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
  /**
   * «Спільнота» sharing the creator's fees: SHARED once the vault holds the curve's creator role on chain; PENDING while
   * its send has no answer — the token's read settles it from the curve's own creator; FAILED when the network refused
   * it or it was never sent, and then the creator's wallet keeps the role and every fee. Absent on a launch before it.
   */
  feeSharing?: Readonly<{ vault: string; shares: readonly FeeShare[]; signature: string | null; state: "SHARED" | "PENDING" | "FAILED"; reason: string | null }> | null;
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
  /** «Спільнота» only: the creator's fees shared, the creator among two to five wallets; absent or empty, not shared. */
  feeShares?: readonly FeeShare[];
}>;

export type PreparedLaunch = Readonly<{
  ok: true;
  buildId: string;
  wireBase64: string;
  lockWireBase64: string | null;
  /** The sharing of the creator's fees, signed already by the new mint; the creator signs it in the same window. */
  splitWireBase64: string | null;
  feeVault: string | null;
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
  const shares = input.feeShares ?? [];
  if (shares.length > 0) {
    if (preset.id !== "community") return fail("SHARES_INVALID", "Only «Спільнота» shares the creator's fees.");
    const problems = feeShareProblems(input.creator, shares);
    if (problems.length) return fail("SHARES_INVALID", `The split does not hold: ${problems.join(", ")}.`);
  }
  await sweepBuilds(deps).catch(() => undefined);
  if ((await sendsToday(deps, input.creator)) >= LAUNCHES_PER_CREATOR_PER_DAY) {
    return fail("CREATOR_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} tokens a day.`);
  }
  const payerBalance = BigInt(await deps.connection.getBalance(deps.poolPayer.publicKey, "confirmed"));
  if (payerBalance < POOL_PAYER_FLOOR_LAMPORTS) return fail("PAYER_LOW", "Launching is paused; nothing was built.");

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
        pairMint: launchPair(deps.network, preset.id).mint,
      },
      { creatorCoversPayer: true, feeShares: shares },
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
    split: built.split ? { vault: built.split.vault, shares, messageSha256: sha256(Transaction.from(Buffer.from(built.split.wireBase64, "base64")).serializeMessage()) } : null,
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
    splitWireBase64: built.split?.wireBase64 ?? null,
    feeVault: built.split?.vault ?? null,
    token: built.token,
    firstBuyOutRaw: built.creatorFirstBuyOutRaw,
    payerCoveredLamports: built.payerCoveredLamports,
    creatorCostLamports: (BigInt(built.creatorSpendLamports ?? built.payerCoveredLamports) + lockCost + BigInt(built.split?.costLamports ?? "0")).toString(),
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

export type SubmittedLaunch = Readonly<{ ok: true; token: string; signature: string; state: "LAUNCHED" | "PENDING"; lock: LaunchRecord["lock"]; feeSharing: NonNullable<LaunchRecord["feeSharing"]> | null; tokenPath: string }>;

/**
 * What one send came to: confirmed; refused by the network's own preflight
 * before it reached the chain (it cost nobody anything); failed on chain (the
 * pool payer paid its fee); or not known yet — the bytes may still land until
 * their blockhash expires.
 */
export type Sent = Readonly<{ outcome: "CONFIRMED" | "REJECTED" | "FAILED" | "UNKNOWN"; signature: string; reason: string | null; /** A refusal's whole text with the program's logs, for telling one refusal from another. */ detail?: string }>;

/**
 * Blocks past a blockhash's last valid height before a signature nobody has is called expired. A node answers its
 * height and its signatures from different moments — and behind a public endpoint, from different machines — so the
 * edge itself is never the word: on 2026-10-06 two creations landed at the edge and were answered «expired».
 */
export const EXPIRY_MARGIN_BLOCKS = 30;

/** How long one read of the chain may take inside a send's budget; past it the read counts as not answered. */
const READ_MS = 3_000;

/** A read inside its time: its answer, or undefined when it failed or did not come in time. */
async function within<T>(read: () => Promise<T>, ms = READ_MS): Promise<T | undefined> {
  /* No time left is no answer: the read is not even asked. */
  if (!(ms > 0)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)))]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A read that may take only until `deadline` (ms): its answer, or `fallback` when it fails or the time runs out — the
 * route answers inside its 60 s, and what was not read is said as not read.
 */
export async function byDeadline<T, F>(read: () => Promise<T>, deadline: number, now: () => Date, fallback: F): Promise<T | F> {
  const answer = await within(read, deadline - now().getTime());
  return answer === undefined ? fallback : answer;
}

/**
 * A signature's status as one node answers it: the status, null when the node answered that it has none, undefined when
 * it did not answer — or answered from a slot before `minSlot`, where a missing signature says nothing.
 */
async function statusOn(connection: Connection, signature: string, minSlot: number | null, ms: number) {
  const read = await within(() => connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), ms);
  if (!read) return undefined;
  const status = read.value[0] ?? null;
  if (status) return status;
  return minSlot !== null && !(Number(read.context?.slot) >= minSlot) ? undefined : null;
}

type SignatureRead = Readonly<{ outcome: Sent["outcome"] | "EXPIRED"; /** The slot past the blockhash the «absent» answers were read at. */ slot: number | null }>;

/**
 * The chain's word on a signature: confirmed, refused, expired (its blockhash passed and it never landed), or not known
 * yet. Expired only when the chain is past the blockhash's height by a margin and every node asked answered — from that
 * slot or later — that it has no such signature: a read that failed, or came from a node behind, is not «absent».
 */
async function readSignature(
  connection: Connection,
  signature: string,
  validUntil: number,
  second: Connection | null,
  /** The time one read may take now — what is left of a send's budget, at most `READ_MS`. */
  cap: () => number = () => READ_MS,
): Promise<SignatureRead> {
  /* Height and slot in one answer of one node, read first: the absences below must come from that slot or later. */
  const tip = await within(() => connection.getEpochInfo("confirmed"), cap());
  const past = tip && tip.blockHeight !== undefined && tip.blockHeight > validUntil + EXPIRY_MARGIN_BLOCKS ? tip.absoluteSlot : null;
  const reads = [await statusOn(connection, signature, past, cap())];
  if (!reads[0] && second) reads.push(await statusOn(second, signature, past, cap()));
  const status = reads.find((read) => read);
  if (status) {
    if (status.err !== null) return { outcome: "FAILED", slot: null };
    if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return { outcome: "CONFIRMED", slot: null };
    return { outcome: "UNKNOWN", slot: null };
  }
  if (past === null || reads.some((read) => read === undefined)) return { outcome: "UNKNOWN", slot: null };
  return { outcome: "EXPIRED", slot: past };
}

async function signatureOutcome(connection: Connection, signature: string, validUntil: number, second: Connection | null = null): Promise<Sent["outcome"] | "EXPIRED"> {
  return (await readSignature(connection, signature, validUntil, second)).outcome;
}

/** The programs a creation's mint belongs to: an account at its address owned by anything else is not the mint. */
export const MINT_OWNERS: readonly string[] = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()];

/**
 * Whether the account a transaction opens is on any node asked, owned by the program that opens it: true when one has
 * it, false when every one answered — from `minSlot` or later — that it has none, null otherwise. A creation's mint is a
 * fresh key only that creation opens, so its mint on chain is the creation landed — whatever any signature read said.
 * Lamports anyone sends to the address make an account the system owns, and that is not the mint.
 */
export async function accountOnChain(
  connections: readonly (Connection | null | undefined)[],
  address: string,
  owners: readonly string[],
  minSlot: number | null = null,
  cap: () => number = () => READ_MS,
): Promise<boolean | null> {
  let unread = false;
  for (const connection of connections) {
    if (!connection) continue;
    const read = await within(() => connection.getAccountInfoAndContext(new PublicKey(address), { commitment: "confirmed", ...(minSlot !== null ? { minContextSlot: minSlot } : {}) }), cap());
    if (!read) {
      unread = true;
      continue;
    }
    if (read.value && owners.includes(read.value.owner.toBase58())) return true;
  }
  return unread ? null : false;
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
 * settles it from the chain. `landed` reads what the transaction makes on chain
 * (a creation's mint): found, the send is confirmed whatever a signature read
 * said; not readable, an «expired» is not said.
 */
export async function sendOnce(
  connection: Connection,
  tx: Transaction,
  validUntil: number,
  now: () => Date,
  budget: Readonly<{ confirmMs: number; settleMs: number; /** An absolute time (ms) the whole send ends by, whatever its budget. */ deadline?: number }>,
  check: Readonly<{ second?: Connection | null; landed?: (minSlot: number | null, cap: () => number) => Promise<boolean | null> }> = {},
): Promise<Sent> {
  /* One clock for the whole send: the send and its confirmation share `confirmMs`, the reads after it `settleMs`, and
     every read is cut to what is left — past `end` the answer is UNKNOWN, and the token's read settles it. */
  const start = now().getTime();
  const end = Math.min(start + budget.confirmMs + budget.settleMs, budget.deadline ?? Number.POSITIVE_INFINITY);
  const confirmEnd = Math.min(start + budget.confirmMs, end);
  const cap = () => Math.min(READ_MS, end - now().getTime());
  const signature = getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array()));
  let sendError: unknown = null;
  try {
    /* A send that does not answer within the confirmation's time is a lost answer, not a refusal. */
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 2 }),
      new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("The node did not answer the send in time.")), Math.max(0, confirmEnd - now().getTime())))),
    ]).finally(() => timer && clearTimeout(timer));
  } catch (error) {
    if (preflightRefused(error)) {
      const logs = (error as { logs?: unknown }).logs;
      const detail = `${error instanceof Error ? error.message : ""}\n${Array.isArray(logs) ? logs.join("\n") : ""}`;
      return { outcome: "REJECTED", signature, reason: error instanceof Error ? error.message.slice(0, 300) : "The network refused it.", detail };
    }
    /* A lost answer is not a refusal: the bytes may have reached the network. */
    sendError = error;
  }
  if (!sendError && confirmEnd > now().getTime()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const confirmed = await Promise.race([
        connection.confirmTransaction({ signature, blockhash: tx.recentBlockhash ?? "", lastValidBlockHeight: validUntil }, "confirmed"),
        new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), Math.max(0, confirmEnd - now().getTime())))),
      ]).finally(() => timer && clearTimeout(timer));
      if (confirmed) return confirmed.value.err ? { outcome: "FAILED", signature, reason: JSON.stringify(confirmed.value.err).slice(0, 300) } : { outcome: "CONFIRMED", signature, reason: null };
    } catch (error) {
      sendError = error;
    }
  }
  /* Not confirmed in time is not «failed»: the bytes may still land until their blockhash expires. The chain's own word
     decides. The last reads keep their slice of the budget: the mint found at the end is a launch, not a «pending». */
  const until = Math.max(Math.min(confirmEnd, end), end - 5 * READ_MS);
  for (;;) {
    const { outcome, slot } = await readSignature(connection, signature, validUntil, check.second ?? null, cap);
    if (outcome === "CONFIRMED") return { outcome, signature, reason: null };
    if (outcome === "FAILED") return { outcome: "FAILED", signature, reason: sendError instanceof Error ? sendError.message.slice(0, 300) : "The network refused it on chain." };
    const over = now().getTime() >= until;
    if (outcome === "EXPIRED" || over) {
      /* Absent only from the slot the «expired» was read at or later; otherwise an absence says nothing. */
      const landed = check.landed ? await check.landed(outcome === "EXPIRED" ? slot : null, cap).catch(() => null) : false;
      if (landed === true) return { outcome: "CONFIRMED", signature, reason: null };
      if (outcome === "EXPIRED" && landed === false) return { outcome: "REJECTED", signature, reason: "The network never saw the transaction before its blockhash expired." };
      if (over) return { outcome: "UNKNOWN", signature, reason: null };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(SETTLE_POLL_MS, until - now().getTime()))));
  }
}

/* The route may run 60 s: the creation gets the most of it, the lock and the sharing what remains of `ROUTE_MS`; past it, PENDING. */
const CREATION_BUDGET = { confirmMs: 20_000, settleMs: 10_000 } as const;
const LOCK_BUDGET = { confirmMs: 12_000, settleMs: 6_000 } as const;
const ROUTE_MS = 50_000;
/** Less time than this left, a second transaction is not sent: it would be cut off mid-way. */
const SECOND_SEND_MIN_MS = 6_000;

/** A second transaction's budget out of what the route has left; null when too little is left to send it. */
export function budgetLeft(deadline: number, now: number): Readonly<{ confirmMs: number; settleMs: number }> | null {
  const left = deadline - now;
  if (left < SECOND_SEND_MIN_MS) return null;
  return { confirmMs: Math.min(LOCK_BUDGET.confirmMs, Math.floor(left * 0.6)), settleMs: Math.min(LOCK_BUDGET.settleMs, Math.floor(left * 0.2)) };
}

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
    return mine > LAUNCHES_PER_CREATOR_PER_DAY ? fail("CREATOR_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} tokens a day.`) : fail("PAYER_LOW", "Launching is paused; nothing was sent.");
  }
  return null;
}

export async function submitLaunch(
  deps: LaunchDeps,
  input: Readonly<{ buildId: string; creator: string; signedWireBase64: string; signedLockWireBase64: string | null; signedSplitWireBase64?: string | null }>,
): Promise<SubmittedLaunch | LaunchFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
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
  let splitTx: Transaction | null = null;
  if (build.split) {
    if (!input.signedSplitWireBase64) return fail("SIGNATURE_MISSING", "The sharing of the creator's fees was not signed.");
    const signed = signedAsBuilt(input.signedSplitWireBase64, build.split.messageSha256, null);
    if ("ok" in signed) return signed;
    splitTx = signed;
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
    feeSharing: null,
    referralCode: referral?.code ?? null,
    launchedAt: deps.now().toISOString(),
    buildId: build.id,
  };
  /* Written before the send: a launch the network has not answered for yet is still found, and its page reads the chain to finish it. */
  await writeLaunch(deps.store, pending);
  /* The mint is a fresh key only this creation opens: its account on chain is the launch landed, whatever a node says of the signature. */
  const sent = await sendOnce(deps.connection, creation, Number(build.validUntil), deps.now, { ...CREATION_BUDGET, deadline }, {
    second: deps.second,
    landed: (minSlot, cap) => accountOnChain([deps.connection, deps.second], build.token, MINT_OWNERS, minSlot, cap),
  });
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    await removeLaunch(deps.store, pending);
    /* Refused before the chain saw it: it cost nobody anything, so it counts against no limit. A failure on chain cost the payer its fee and stays counted. */
    if (sent.outcome === "REJECTED") await deps.store.collection<LaunchAttempt>("launchAttempts").delete(creatorKey(build.cluster, build.creator, build.id));
    return fail("SUBMIT_FAILED", sent.reason ?? "The network refused the launch.");
  }
  if (sent.outcome === "UNKNOWN") {
    /* The lock waits for the creation: its tokens exist only once the creation lands. The page says what the chain says. */
    const lock: LaunchRecord["lock"] = build.lock ? { schedule: build.lock.schedule, escrow: build.lock.escrow, signature: null, state: "FAILED", reason: "not sent: the launch was not confirmed in time" } : null;
    const feeSharing: LaunchRecord["feeSharing"] = build.split ? { vault: build.split.vault, shares: build.split.shares, signature: null, state: "FAILED", reason: "not sent: the launch was not confirmed in time" } : null;
    await writeLaunch(deps.store, { ...pending, lock, feeSharing });
    return { ok: true, token: build.token, signature, state: "PENDING", lock, feeSharing, tokenPath: `/app/launch/${build.token}` };
  }

  /* Landed: written LAUNCHED before the lock and the sharing go, each PENDING under its own signature — a route cut off
     mid-way leaves a launch its page finds and settles from the chain, never one that seems not to exist. */
  const sigOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array()));
  let lock: LaunchRecord["lock"] = build.lock && lockTx ? { schedule: build.lock.schedule, escrow: build.lock.escrow, signature: sigOf(lockTx), state: "PENDING", reason: null } : null;
  let feeSharing: LaunchRecord["feeSharing"] =
    build.split && splitTx ? { vault: build.split.vault, shares: build.split.shares, signature: sigOf(splitTx), state: "PENDING", reason: null } : null;
  await writeLaunch(deps.store, { ...pending, state: "LAUNCHED", lock, feeSharing });
  if (build.lock && lockTx && lock) {
    const escrow = build.lock.escrow;
    const budget = budgetLeft(deadline, deps.now().getTime());
    if (!budget) lock = { ...lock, signature: null, state: "FAILED", reason: "not sent: the launch took the route's time" };
    else {
      const locked = await sendOnce(deps.connection, lockTx, Number(build.validUntil), deps.now, { ...budget, deadline }, {
        second: deps.second,
        landed: (minSlot, cap) => accountOnChain([deps.connection, deps.second], escrow, [MET_LOCK_PROGRAM], minSlot, cap),
      });
      const state = locked.outcome === "CONFIRMED" ? "LOCKED" : locked.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
      lock = { ...lock, signature: locked.signature, state, reason: state === "FAILED" ? (locked.reason ?? "the network refused the lock") : null };
    }
  }
  if (build.split && splitTx && feeSharing) {
    const budget = budgetLeft(deadline, deps.now().getTime());
    if (!budget) feeSharing = { ...feeSharing, signature: null, state: "FAILED", reason: "not sent: the launch took the route's time" };
    else {
      const shared = await sendOnce(deps.connection, splitTx, Number(build.validUntil), deps.now, { ...budget, deadline }, { second: deps.second });
      const state = shared.outcome === "CONFIRMED" ? "SHARED" : shared.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
      feeSharing = { ...feeSharing, signature: shared.signature, state, reason: state === "FAILED" ? (shared.reason ?? "the network refused the sharing") : null };
    }
  }
  const launched: LaunchRecord = { ...pending, state: "LAUNCHED", lock, feeSharing };
  await writeLaunch(deps.store, launched);
  /* A sharing that never went shares nothing: the other wallets' rows written while it was pending go. */
  if (feeSharing?.state === "FAILED") await unindexFeeShares(deps.store, launched);
  return { ok: true, token: build.token, signature, state: "LAUNCHED", lock, feeSharing, tokenPath: `/app/launch/${build.token}` };
}

/** A launch whose creator fees a wallet shares in, indexed by that wallet — the creator's own row is in `launchesByCreator`. */
export type FeeShareIndex = Readonly<{ cluster: string; wallet: string; token: string }>;
export const FEE_SHARE_INDEX = "launchFeeShares";
export const feeShareKey = (cluster: string, wallet: string, token = "") => `solana:${cluster}:${wallet}:${token}`;

async function indexFeeShares(store: GuardStore, record: LaunchRecord): Promise<void> {
  const sharing = record.feeSharing;
  if (!sharing || sharing.state === "FAILED") return;
  const index = store.collection<FeeShareIndex>(FEE_SHARE_INDEX);
  for (const share of sharing.shares) {
    if (share.address === record.creator) continue;
    await index.set(feeShareKey(record.cluster, share.address, record.token), { cluster: record.cluster, wallet: share.address, token: record.token });
  }
}

async function unindexFeeShares(store: GuardStore, record: LaunchRecord): Promise<void> {
  const index = store.collection<FeeShareIndex>(FEE_SHARE_INDEX);
  for (const share of record.feeSharing?.shares ?? []) await index.delete(feeShareKey(record.cluster, share.address, record.token));
}

export async function writeLaunch(store: GuardStore, record: LaunchRecord): Promise<void> {
  await store.collection<LaunchRecord>("launches").set(launchKey(record.cluster, record.token), record);
  await store.collection<LaunchRecord>("launchesByCreator").set(creatorKey(record.cluster, record.creator, record.token), record);
  await indexFeeShares(store, record);
}

async function removeLaunch(store: GuardStore, record: LaunchRecord): Promise<void> {
  await store.collection<LaunchRecord>("launches").delete(launchKey(record.cluster, record.token));
  await store.collection<LaunchRecord>("launchesByCreator").delete(creatorKey(record.cluster, record.creator, record.token));
}

/** What reading a launch's record needs: the store and the chain, a second operator, and — where it is served — adopting a launch the store lost. */
export type LaunchReadDeps = Pick<LaunchDeps, "store" | "connection"> &
  Readonly<{ second?: Connection | null; adopt?: ((token: string) => Promise<LaunchRecord | null>) | null }>;

/**
 * A launch as its record and the chain say now: a pending one is settled by
 * the chain's word on its signature — confirmed becomes launched, refused or
 * expired is removed (nothing landed) — and anything still unknown stays
 * pending. A pending one whose mint is on chain landed, whatever the
 * signature read said. With no record, a launch the chain shows Ryntra's
 * pool payer created is adopted where `adopt` is given. Null when there is no
 * launch of the token here.
 */
export async function readLaunchRecord(deps: LaunchReadDeps, cluster: string, token: string): Promise<LaunchRecord | null> {
  const record = (await deps.store.collection<LaunchRecord>("launches").get(launchKey(cluster, token))) ?? null;
  /* A launch the store lost is adopted from the chain where that is served; a read that fails there is «not found». */
  if (!record) return deps.adopt ? deps.adopt(token).catch(() => null) : null;
  if (record.state !== "PENDING") return record;
  const read = await readSignature(deps.connection, record.signature, Number(record.validUntil), deps.second ?? null);
  let outcome = read.outcome;
  if (outcome === "EXPIRED" || outcome === "UNKNOWN") {
    const landed = await accountOnChain([deps.connection, deps.second], record.token, MINT_OWNERS, outcome === "EXPIRED" ? read.slot : null);
    if (landed === true) outcome = "CONFIRMED";
    else if (landed === null && outcome === "EXPIRED") outcome = "UNKNOWN";
  }
  if (outcome === "CONFIRMED") {
    const launched: LaunchRecord = { ...record, state: "LAUNCHED" };
    await writeLaunch(deps.store, launched);
    return launched;
  }
  if (outcome === "FAILED" || outcome === "EXPIRED") {
    /* Only the pending record this read judged: one the send or another read has settled meanwhile stays. */
    const current = await deps.store.collection<LaunchRecord>("launches").get(launchKey(cluster, token));
    if (current?.state !== "PENDING" || current.signature !== record.signature) return current ?? null;
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
export async function settleLaunchLock(deps: LaunchReadDeps, record: LaunchRecord, escrowFound: boolean): Promise<LaunchRecord> {
  const lock = record.lock;
  if (!lock || lock.state === "LOCKED") return record;
  let next: NonNullable<LaunchRecord["lock"]> | null = null;
  if (escrowFound) next = { ...lock, state: "LOCKED", reason: null };
  else if (lock.state === "PENDING" && lock.signature) {
    const outcome = await signatureOutcome(deps.connection, lock.signature, Number(record.validUntil), deps.second ?? null);
    if (outcome === "FAILED" || outcome === "EXPIRED") next = { ...lock, state: "FAILED", reason: "the network did not take the lock" };
  }
  if (!next) return record;
  const settled: LaunchRecord = { ...record, lock: next };
  await writeLaunch(deps.store, settled);
  return settled;
}

/**
 * The sharing as the chain settles it: the vault holding the curve's creator role is SHARED, whatever the send said; a
 * PENDING one whose signature failed or expired is FAILED. The record is rewritten when the state changes.
 */
export async function settleFeeSharing(deps: LaunchReadDeps, record: LaunchRecord, roleOwner: string | null): Promise<LaunchRecord> {
  const sharing = record.feeSharing;
  if (!sharing || sharing.state === "SHARED") return record;
  let next: NonNullable<LaunchRecord["feeSharing"]> | null = null;
  if (roleOwner === sharing.vault) next = { ...sharing, state: "SHARED", reason: null };
  else if (sharing.state === "PENDING" && sharing.signature) {
    const outcome = await signatureOutcome(deps.connection, sharing.signature, Number(record.validUntil), deps.second ?? null);
    if (outcome === "FAILED" || outcome === "EXPIRED") next = { ...sharing, state: "FAILED", reason: "the network did not take the sharing" };
  }
  if (!next) return record;
  const settled: LaunchRecord = { ...record, feeSharing: next };
  await writeLaunch(deps.store, settled);
  /* A sharing that never landed shares nothing: the other wallets' rows go, and the creator keeps every fee. */
  if (next.state === "FAILED") await unindexFeeShares(deps.store, settled);
  return settled;
}

/**
 * Whether the referral route `/r/<code>` lands on the page a link names with `to=`. Until it does it lands on Rewards,
 * so the link a creator shares is the token's page itself and the creator's code waits for it; the launch test reads
 * the route and fails the day it follows `to`, so this is flipped then and not later.
 */
export const REFERRAL_ROUTE_FOLLOWS_TO = false;

/** The link a creator shares: the token's page — through their referral code once the referral route lands there. */
export function launchShareLink(origin: string, record: Pick<LaunchRecord, "token" | "referralCode">, followsTo: boolean = REFERRAL_ROUTE_FOLLOWS_TO): string {
  const page = `/app/launch/${record.token}`;
  /* The page is a path of base58 letters and slashes — legal in a query as it is, so the link reads plainly. */
  return followsTo && record.referralCode ? `${origin}/r/${record.referralCode}?to=${page}` : `${origin}${page}`;
}
