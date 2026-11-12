/**
 * «Пресейл і ранній доступ» — the server's half (SOL-L5): who may open one, the build and the send of the creation, a
 * person's deposit, and the token page's view.
 *
 * Gating. On the devnet stand the format is open with `DEVNET_EARLY_ACCESS_BOUNDS`.
 *
 * The creation follows `flow.server.ts`:
 * 1. **Build** (`prepareEarlyAccess`): the rules against the bounds, the stored metadata against the name rules, the
 *    creator's day, the one raw unit of USDC the pool's program takes; the venue builds the three transactions (the
 *    mint, the pool with its lock, the vault) and reads them back. Their messages are remembered by hash; the fresh
 *    keys — the mint's and the position NFT's — come off the bytes the wallet sees and wait sealed with the server's key.
 * 2. **The creator signs** all three in one go; the server never holds a key of theirs, and Ryntra signs nothing.
 * 3. **Submit** (`submitEarlyAccess`): each signed message must be the built one — or, the creator paying every fee,
 *    the same instructions with only what a wallet may add on signing —, the creator's signature real; the fresh keys
 *    then sign over the exact message, and the three go one after the other, each once. The record (`launchEarlyAccess`,
 *    `<cluster>:<mint>`) is written PENDING before the first send, and each step is settled from the chain's own
 *    accounts — the mint, the pool, the vault at their addresses — whatever a node says of a signature.
 *
 * A person's deposit (`prepareEarlyAccessDeposit` / `submitEarlyAccessDeposit`) is a transaction their wallet signs as
 * the only signer, compared with the built one as a claim is (`compareWalletTransaction`). The token page reads
 * `earlyAccessView`: the rules and their plain lines, what is deposited against the cap, the phase, the pool and the
 * vault, and — when a read failed — that it failed, never a zero.
 *
 * Nothing here pays Ryntra or names Ryntra as a fee claimer; the creator's wallet pays every fee and rent.
 */

import { createHash, randomBytes } from "node:crypto";

import { getBase58Decoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction, VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";

import type { ApiErrorCode } from "../api/v1/contract.ts";
import {
  DEVNET_EARLY_ACCESS_BOUNDS,
  RYNTRA_EARLY_ACCESS_SHARE_BPS,
  earlyAccessBoundsProblems,
  earlyAccessFill,
  earlyAccessPhase,
  earlyAccessProblems,
  earlyAccessRuleLines,
  presaleBpsOf,
  startPriceUsd,
  type EarlyAccessBounds,
  type EarlyAccessFill,
  type EarlyAccessPhase,
  type EarlyAccessRules,
  type EarlyAccessSchedule,
} from "../core/launch/early-access.ts";
import {
  ALPHA_VAULT_MODE,
  ALPHA_VAULT_PROGRAM,
  DAMM_V2_PROGRAM,
  EarlyAccessRefusal,
  buildEarlyAccessClaim,
  buildEarlyAccessCreation,
  buildEarlyAccessDeposit,
  buildEarlyAccessFill,
  buildEarlyAccessWithdraw,
  buildEarlyAccessWithdrawRemaining,
  claimInfoOf,
  depositRoomOf,
  readEarlyAccessPool,
  readEarlyAccessVault,
  remainingQuoteOf,
  type EarlyAccessCreation,
  type VaultFields,
} from "../core/venues/meteora-alpha-vault/early-access.server.ts";
import type { GuardCollection, GuardStore } from "../guard/store.ts";
import type { Env } from "../liquidity/studio/gate.ts";
import { openCosigners, reviewedDigest, sealCosigners, ticketKeyConfigured, walletAdditionsAllowed, withoutSignaturesOf, type Cosigner } from "../liquidity/studio/ticket.ts";
import { NEXT_TRANSACTION_MARGIN_MS, readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import { LAUNCHES_PER_CREATOR_PER_DAY, type LaunchCluster, type LaunchNetwork, type LaunchPair } from "./config.server.ts";
import { accountOnChain, budgetLeft, sendOnce, type Sent } from "./flow.server.ts";
import { checkLaunchForm } from "./form.ts";
import { isTakenDown, metadataOfUri } from "./metadata.server.ts";
import { quotePaused } from "./quote-watch.server.ts";

/* ------------------------------------------------------------- gating */

/**
 * False: closed, whatever the bounds configured — the format
 * opens on mainnet alone, flipped here then.
 */
export const EARLY_ACCESS_OWNER_WORD = true; // Fork 24/24, devnet 25/25; bounds — RYNTRA_LAUNCH_EARLY_ACCESS_BOUNDS, CITY-220 report §6

export const EARLY_ACCESS_BOUNDS_ENV = "RYNTRA_LAUNCH_EARLY_ACCESS_BOUNDS";

/** Mainnet's bounds as configured — a JSON `EarlyAccessBounds` that passes `earlyAccessBoundsProblems` —, or null. */
export function parseEarlyAccessBounds(raw: string | undefined): EarlyAccessBounds | null {
  if (!raw?.trim()) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return earlyAccessBoundsProblems(value).length === 0 ? Object.freeze(value as EarlyAccessBounds) : null;
}

type ClusterOf = LaunchCluster | Pick<LaunchNetwork, "cluster">;
const clusterOf = (network: ClusterOf): LaunchCluster => (typeof network === "string" ? network : network.cluster);

/** The bounds on a network: the stand's on devnet, the configured ones on mainnet (null when absent or invalid). */
export function earlyAccessBoundsFor(network: ClusterOf, env: Env = process.env): EarlyAccessBounds | null {
  return clusterOf(network) === "devnet" ? DEVNET_EARLY_ACCESS_BOUNDS : parseEarlyAccessBounds(env[EARLY_ACCESS_BOUNDS_ENV]);
}

/** Whether an early-access launch may be built or deposited into here: the devnet stand always. */
export function earlyAccessOpenFor(network: ClusterOf, env: Env = process.env, ownerWord: boolean = EARLY_ACCESS_OWNER_WORD): boolean {
  if (clusterOf(network) === "devnet") return true;
  return ownerWord === true && earlyAccessBoundsFor(network, env) !== null;
}

/* -------------------------------------------------------------- store */

/**
 * The collections, appended to `GUARD_COLLECTIONS` by the integrating change (a value in the same column, no DDL):
 * the record per token (`<cluster>:<mint>`), the builds waiting for a signature (`<cluster>:<id>`, swept an hour past
 * their expiry) and the one send of each (`<cluster>:<id>`).
 */
export const EARLY_ACCESS_COLLECTIONS = { records: "launchEarlyAccess", builds: "launchEarlyAccessBuilds", sends: "launchEarlyAccessSends" } as const;
const collection = <T,>(store: GuardStore, name: (typeof EARLY_ACCESS_COLLECTIONS)[keyof typeof EARLY_ACCESS_COLLECTIONS]): GuardCollection<T> =>
  store.collection<T>(name);

export type EarlyAccessDeps = Readonly<{
  network: LaunchNetwork;
  connection: Connection;
  store: GuardStore;
  now: () => Date;
  /** The server's environment: its key (`BETA_TOKEN_SECRET`) seals the fresh keys until the creator has signed; the bounds on mainnet. */
  env: Env;
  /** The public origin the metadata lives on. */
  origin: string;
  second?: Connection | null;
  ownerWord?: boolean;
}>;

export type EarlyAccessFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string }>;
const fail = (code: ApiErrorCode, message: string): EarlyAccessFailure => ({ ok: false, code, message });

export const EARLY_ACCESS_ROLES = ["MINT", "POOL", "VAULT"] as const;
export type EarlyAccessRole = (typeof EARLY_ACCESS_ROLES)[number];
export type EarlyAccessStepState = "CONFIRMED" | "PENDING" | "FAILED" | "NOT_SENT";
export type EarlyAccessStep = Readonly<{ signature: string | null; state: EarlyAccessStepState; reason: string | null }>;

export type EarlyAccessRecord = Readonly<{
  cluster: LaunchCluster;
  mint: string;
  pool: string;
  vault: string;
  position: string;
  creator: string;
  quoteMint: string;
  name: string;
  symbol: string;
  metadataUri: string;
  rules: EarlyAccessRules;
  schedule: EarlyAccessSchedule;
  /** PENDING — a step not settled yet; OPEN — the mint, the pool and the vault on chain; PARTIAL — a step failed or was never sent. */
  state: "PENDING" | "OPEN" | "PARTIAL";
  steps: Readonly<Record<EarlyAccessRole, EarlyAccessStep>>;
  ryntraShareBps: 0;
  buildId: string;
  createdAt: string;
}>;

type BuiltMessage = Readonly<{ role: EarlyAccessRole; messageSha256: string; digest: string; validUntil: string }>;

export type EarlyAccessBuildRecord = Readonly<
  | {
      kind: "CREATE";
      id: string;
      cluster: LaunchCluster;
      creator: string;
      mint: string;
      pool: string;
      vault: string;
      position: string;
      quoteMint: string;
      name: string;
      symbol: string;
      metadataUri: string;
      rules: EarlyAccessRules;
      schedule: EarlyAccessSchedule;
      messages: readonly BuiltMessage[];
      /** The mint's key (index 0) and the position NFT's (index 1), sealed (`sealCosigners`). */
      cosign: string;
      createdAt: string;
      expiresAt: string;
    }
  | {
      kind: "DEPOSIT";
      id: string;
      cluster: LaunchCluster;
      wallet: string;
      mint: string;
      vault: string;
      amountRaw: string;
      wireBase64: string;
      validUntil: string;
      createdAt: string;
      expiresAt: string;
    }
  | {
      kind: "ACTION";
      action: EarlyAccessAction;
      id: string;
      cluster: LaunchCluster;
      wallet: string;
      mint: string;
      vault: string;
      /** What the action moves as read at the build (the tokens claimed, the USDC taken back); null for the purchase. */
      amountRaw: string | null;
      wireBase64: string;
      validUntil: string;
      createdAt: string;
      expiresAt: string;
    }
>;

type EarlyAccessSend = Readonly<{ cluster: string; id: string; at: string }>;

const recordKey = (cluster: string, mint: string) => `${cluster}:${mint}`;
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const seconds = (deps: Pick<EarlyAccessDeps, "now">) => Math.floor(deps.now().getTime() / 1_000);
const signatureOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array(64)));

/** The longest a build waits for the signature; the bytes' own life is shorter (~30 s on 200 ms slots), less a margin for each later send. */
export const EARLY_ACCESS_BUILD_TTL_MS = 2 * 60 * 1000;
const ROUTE_MS = 50_000;
const FIRST_BUDGET = { confirmMs: 18_000, settleMs: 6_000 } as const;
const DEPOSIT_BUDGET = { confirmMs: 20_000, settleMs: 8_000 } as const;

export async function readEarlyAccessRecord(store: GuardStore, cluster: string, mint: string): Promise<EarlyAccessRecord | null> {
  return (await collection<EarlyAccessRecord>(store, EARLY_ACCESS_COLLECTIONS.records).get(recordKey(cluster, mint))) ?? null;
}

/** Every early access on a network, as Ryntra keeps it — read-only, for «Події ринку» (DSC-1). */
export async function listEarlyAccessRecords(store: GuardStore, cluster: string): Promise<readonly EarlyAccessRecord[]> {
  return collection<EarlyAccessRecord>(store, EARLY_ACCESS_COLLECTIONS.records).valuesWithPrefix(`${cluster}:`);
}

async function writeRecord(store: GuardStore, record: EarlyAccessRecord): Promise<void> {
  await collection<EarlyAccessRecord>(store, EARLY_ACCESS_COLLECTIONS.records).set(recordKey(record.cluster, record.mint), record);
}

async function sweep(deps: EarlyAccessDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  const builds = collection<EarlyAccessBuildRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.builds);
  for (const build of await builds.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.cluster, build.id));
  const sends = collection<EarlyAccessSend>(deps.store, EARLY_ACCESS_COLLECTIONS.sends);
  for (const send of await sends.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(send.at) < stale) await sends.delete(buildKey(send.cluster, send.id));
}

/** The USDC pair on this network — the same the Launch presets trade against. */
export function earlyAccessQuote(network: Pick<LaunchNetwork, "pairs" | "cluster">): LaunchPair {
  const pair = Object.values(network.pairs).find((candidate) => candidate?.symbol === "USDC" && candidate.dollar);
  if (!pair) throw new Error(`No USDC pair on ${network.cluster}.`);
  return pair;
}

/* ------------------------------------------------------------ the build */

export type PrepareEarlyAccessInput = Readonly<{ creator: string; metadataUri: string; rules: EarlyAccessRules }>;

export type PreparedEarlyAccess = Readonly<{
  ok: true;
  buildId: string;
  /** MINT, POOL, VAULT — for the creator's wallet to sign in one go; no other signature on them yet. */
  unsignedWireBase64: readonly string[];
  mint: string;
  pool: string;
  vault: string;
  schedule: EarlyAccessSchedule;
  lines: Readonly<{ uk: readonly string[]; en: readonly string[] }>;
  presaleBps: number;
  expiresAt: string;
  signableMs: number;
}>;

/** Whether the creator holds at least one raw unit of USDC — the pool's program takes it to prove the pair. Null when not read. */
async function holdsQuoteUnit(connection: Connection, owner: string, quote: LaunchPair): Promise<boolean | null> {
  try {
    const info = await connection.getAccountInfo(new PublicKey(quote.mint), "confirmed");
    if (!info) return null;
    const account = getAssociatedTokenAddressSync(new PublicKey(quote.mint), new PublicKey(owner), false, info.owner);
    const balance = await connection.getTokenAccountBalance(account, "confirmed").catch((error: unknown) => {
      if (error instanceof Error && /could not find account|Invalid param/i.test(error.message)) return null;
      throw error;
    });
    return balance !== null && BigInt(balance.value.amount) >= 1n;
  } catch {
    return null;
  }
}

export async function prepareEarlyAccess(deps: EarlyAccessDeps, input: PrepareEarlyAccessInput): Promise<PreparedEarlyAccess | EarlyAccessFailure> {
  if (!earlyAccessOpenFor(deps.network, deps.env, deps.ownerWord)) return fail("LAUNCH_PAUSED", "Early access is not open here; nothing was built.");
  const bounds = earlyAccessBoundsFor(deps.network, deps.env)!;
  const problems = earlyAccessProblems(input.rules, bounds, seconds(deps));
  if (problems.length) return fail("VALIDATION_ERROR", `The rules do not hold: ${problems.join("; ")}.`);
  const stored = await metadataOfUri(deps.store, input.metadataUri, deps.origin);
  if (!stored) return fail("LAUNCH_NOT_FOUND", "The token's details were not found; fill the form again.");
  if (stored.takenDown) return fail("VALIDATION_ERROR", "Ryntra does not launch a token with these details.");
  const check = checkLaunchForm({ name: stored.metadata.name, symbol: stored.metadata.symbol, description: stored.metadata.description, website: "", x: "", telegram: "" });
  if (check.problems.name === "OFFENSIVE" || check.problems.symbol === "OFFENSIVE") return fail("VALIDATION_ERROR", "Ryntra does not launch a token under this name or ticker.");
  if (check.hits.length) return fail("LAUNCH_NAME_BORROWED", `The name or ticker reads as ${check.hits.map((hit) => hit.label).join(", ")}.`);
  await sweep(deps).catch(() => undefined);
  const day = deps.now().getTime() - 24 * 60 * 60 * 1000;
  const mine = (await collection<EarlyAccessRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.records).valuesWithPrefix(`${deps.network.cluster}:`)).filter(
    (record) => record.creator === input.creator && Date.parse(record.createdAt) >= day,
  );
  if (mine.length >= LAUNCHES_PER_CREATOR_PER_DAY) return fail("LAUNCH_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} tokens a day.`);
  if (!ticketKeyConfigured(deps.env)) return fail("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const quote = earlyAccessQuote(deps.network);
  /* SOL-L12: a pair whose issuer changed its token's rules takes no new launch until Ryntra's check. */
  if (await quotePaused(deps.store, deps.network.cluster, quote.mint)) return fail("LAUNCH_PAUSED", "The pair currency's issuer changed its token's rules; launches on it wait for Ryntra's check. Nothing was built.");
  const unit = await holdsQuoteUnit(deps.connection, input.creator, quote);
  if (unit === null) return fail("UNAVAILABLE", "The creator's USDC could not be read now; nothing was built. Try again.");
  if (!unit) return fail("LAUNCH_BALANCE_LOW", "The pool's program takes one raw unit of USDC (0.000001) from its creator to prove the pair: hold a little USDC in this wallet.");

  let built: EarlyAccessCreation;
  try {
    built = await buildEarlyAccessCreation({
      connection: deps.connection,
      creator: input.creator,
      quoteMint: quote.mint,
      rules: input.rules,
      name: stored.metadata.name,
      symbol: stored.metadata.symbol,
      uri: input.metadataUri,
    });
  } catch (error) {
    if (error instanceof EarlyAccessRefusal) return fail("UNAVAILABLE", `The launch was not built: ${error.message}`);
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The launch could not be built.");
  }
  const cosigners: Cosigner[] = [
    { index: 0, key: built.mintKey },
    { index: 1, key: built.positionNftKey },
  ];
  const cosign = sealCosigners(cosigners, deps.env);
  if (!cosign) return fail("LAUNCH_PAUSED", "Launching is paused; nothing was built.");
  const freshKeys = [built.mint, built.positionNft];
  const unsigned = built.txs.map((tx) => withoutSignaturesOf(tx.wireBase64, freshKeys));
  const messages: BuiltMessage[] = built.txs.map((tx) => {
    const parsed = Transaction.from(Buffer.from(tx.wireBase64, "base64"));
    return { role: tx.role, messageSha256: sha256(parsed.serializeMessage()), digest: reviewedDigest(parsed), validUntil: tx.validUntil ?? "0" };
  });
  const validUntil = built.txs[0]?.validUntil ?? "0";
  const windows = await readBuildWindows(web3ChainReader(deps.connection), validUntil, { transactions: built.txs.length, capMs: EARLY_ACCESS_BUILD_TTL_MS });
  const now = deps.now();
  const record: EarlyAccessBuildRecord = {
    kind: "CREATE",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    creator: input.creator,
    mint: built.mint,
    pool: built.pool,
    vault: built.vault,
    position: built.position,
    quoteMint: built.quoteMint,
    name: stored.metadata.name,
    symbol: stored.metadata.symbol,
    metadataUri: input.metadataUri,
    rules: input.rules,
    schedule: built.schedule,
    messages,
    cosign,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(0, windows.lifeMs - NEXT_TRANSACTION_MARGIN_MS * (built.txs.length - 1))).toISOString(),
  };
  await collection<EarlyAccessBuildRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.builds).insertIfAbsent(buildKey(record.cluster, record.id), record);
  return {
    ok: true,
    buildId: record.id,
    unsignedWireBase64: unsigned,
    mint: built.mint,
    pool: built.pool,
    vault: built.vault,
    schedule: built.schedule,
    lines: { uk: earlyAccessRuleLines(input.rules, "uk"), en: earlyAccessRuleLines(input.rules, "en") },
    presaleBps: presaleBpsOf(input.rules),
    expiresAt: record.expiresAt,
    signableMs: windows.signableMs,
  };
}

/* ------------------------------------------------------------- the send */

/**
 * The creator's signed bytes against a built message: the same message byte for byte, or — the creator pays this fee —
 * the same instructions with only what a wallet may add on signing; the creator's signature real; then the fresh keys
 * sign over the exact message the creator signed, and every signature must be real.
 */
export function signedAsBuilt(wireBase64: string, built: Pick<BuiltMessage, "messageSha256" | "digest">, creator: string, keys: readonly Keypair[]): Transaction | EarlyAccessFailure {
  let tx: Transaction;
  let exact: VersionedTransaction;
  try {
    tx = Transaction.from(Buffer.from(wireBase64, "base64"));
    exact = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (exact.version !== "legacy") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  const same = sha256(tx.serializeMessage()) === built.messageSha256;
  const added = !same && tx.feePayer?.toBase58() === creator && reviewedDigest(tx) === built.digest && walletAdditionsAllowed(tx);
  if (!same && !added) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  const message = exact.message.serialize();
  const signers = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures);
  const real = (at: number) => {
    const signature = exact.signatures[at];
    return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signers[at]!);
  };
  const creatorAt = signers.findIndex((signer) => signer.toBase58() === creator);
  if (creatorAt < 0 || !real(creatorAt)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The transaction is not signed by the creator.");
  const needed = keys.filter((key) => signers.some((signer) => signer.equals(key.publicKey)));
  try {
    if (needed.length) exact.sign(needed);
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  }
  if (signers.some((_, at) => !real(at))) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature does not match the transaction.");
  return Transaction.from(exact.serialize());
}

export type SubmittedEarlyAccess = Readonly<{ ok: true; mint: string; pool: string; vault: string; state: EarlyAccessRecord["state"]; steps: EarlyAccessRecord["steps"]; tokenPath: string }>;

const OWNERS: Readonly<Record<EarlyAccessRole, readonly string[]>> = {
  MINT: [TOKEN_2022_PROGRAM_ID.toBase58()],
  POOL: [DAMM_V2_PROGRAM],
  VAULT: [ALPHA_VAULT_PROGRAM],
};
const accountOf = (record: Pick<EarlyAccessRecord, "mint" | "pool" | "vault">, role: EarlyAccessRole) => (role === "MINT" ? record.mint : role === "POOL" ? record.pool : record.vault);
const stateOf = (steps: EarlyAccessRecord["steps"]): EarlyAccessRecord["state"] =>
  EARLY_ACCESS_ROLES.every((role) => steps[role].state === "CONFIRMED") ? "OPEN" : EARLY_ACCESS_ROLES.some((role) => steps[role].state === "FAILED" || steps[role].state === "NOT_SENT") ? "PARTIAL" : "PENDING";

export async function submitEarlyAccess(
  deps: EarlyAccessDeps,
  input: Readonly<{ buildId: string; creator: string; signedWireBase64: readonly string[] }>,
): Promise<SubmittedEarlyAccess | EarlyAccessFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await collection<EarlyAccessBuildRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.builds).get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== "CREATE" || build.cluster !== deps.network.cluster) return fail("LAUNCH_NOT_FOUND", "This launch was not built here.");
  if (build.creator !== input.creator) return fail("WALLET_MISMATCH", "This launch was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The launch waited too long for the signature; build it again.");
  if (input.signedWireBase64.length !== build.messages.length) return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet did not sign every transaction of the launch.");
  const sealed = openCosigners(build.cosign, deps.env);
  if (!sealed) return fail("LAUNCH_BUILD_EXPIRED", "The launch can no longer be signed; build it again.");
  const keys = sealed.map((cosigner) => cosigner.key);
  const txs: Transaction[] = [];
  for (const [index, message] of build.messages.entries()) {
    const signed = signedAsBuilt(input.signedWireBase64[index]!, message, build.creator, keys);
    if ("ok" in signed) return signed;
    txs.push(signed);
  }
  const sends = collection<EarlyAccessSend>(deps.store, EARLY_ACCESS_COLLECTIONS.sends);
  if (!(await sends.insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) return fail("LAUNCH_BUILD_USED", "This launch was already sent.");

  const notSent = (reason: string): EarlyAccessStep => ({ signature: null, state: "NOT_SENT", reason });
  let steps: Record<EarlyAccessRole, EarlyAccessStep> = {
    MINT: { signature: signatureOf(txs[0]!), state: "PENDING", reason: null },
    POOL: notSent("waits for the token"),
    VAULT: notSent("waits for the pool"),
  };
  const base: Omit<EarlyAccessRecord, "state" | "steps"> = {
    cluster: build.cluster,
    mint: build.mint,
    pool: build.pool,
    vault: build.vault,
    position: build.position,
    creator: build.creator,
    quoteMint: build.quoteMint,
    name: build.name,
    symbol: build.symbol,
    metadataUri: build.metadataUri,
    rules: build.rules,
    schedule: build.schedule,
    ryntraShareBps: RYNTRA_EARLY_ACCESS_SHARE_BPS,
    buildId: build.id,
    createdAt: deps.now().toISOString(),
  };
  const write = () => writeRecord(deps.store, { ...base, steps, state: stateOf(steps) });
  /* Written before the first send: a launch the network has not answered for yet is still found, and its page settles it. */
  await write();
  for (const [index, role] of EARLY_ACCESS_ROLES.entries()) {
    const tx = txs[index]!;
    const budget = index === 0 ? FIRST_BUDGET : budgetLeft(deadline, deps.now().getTime());
    if (!budget) {
      steps = { ...steps, [role]: notSent("not sent: the launch took the route's time") };
      continue;
    }
    const sent: Sent = await sendOnce(deps.connection, tx, Number(build.messages[index]!.validUntil), deps.now, { ...budget, deadline }, {
      second: deps.second,
      landed: (minSlot, cap) => accountOnChain([deps.connection, deps.second], accountOf(build, role), OWNERS[role], minSlot, cap),
    });
    if (sent.outcome === "CONFIRMED") steps = { ...steps, [role]: { signature: sent.signature, state: "CONFIRMED", reason: null } };
    else if (sent.outcome === "UNKNOWN") steps = { ...steps, [role]: { signature: sent.signature, state: "PENDING", reason: null } };
    else steps = { ...steps, [role]: { signature: sent.signature, state: "FAILED", reason: (sent.reason ?? "the network refused it").slice(0, 300) } };
    await write();
    if (sent.outcome !== "CONFIRMED") {
      /* Each step needs the one before it on chain: the rest wait, and say why. */
      for (const later of EARLY_ACCESS_ROLES.slice(index + 1)) steps = { ...steps, [later]: notSent(`not sent: the ${role.toLowerCase()} step is not confirmed`) };
      break;
    }
  }
  if (steps.MINT.state === "FAILED" && steps.MINT.reason !== null) {
    /* Nothing landed: no launch of this mint exists; a refusal before the chain saw it costs nobody and is not counted. */
    await collection<EarlyAccessRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.records).delete(recordKey(build.cluster, build.mint));
    await sends.delete(buildKey(build.cluster, build.id));
    return fail("LAUNCH_SUBMIT_FAILED", steps.MINT.reason);
  }
  await write();
  return { ok: true, mint: build.mint, pool: build.pool, vault: build.vault, state: stateOf(steps), steps, tokenPath: `/app/launch/${build.mint}` };
}

/* ------------------------------------------------------------ a deposit */

export type PreparedDeposit = Readonly<{ ok: true; buildId: string; unsignedWireBase64: string; escrow: string; opensEscrow: boolean; amountRaw: string; expiresAt: string; signableMs: number }>;

/**
 * Whether Ryntra took this launch down (MC-1, `takedown.server.ts`): its token, or the details its metadata names. A
 * launch taken down is not shown to newcomers and takes no deposit (review 8.11) — `prepareEarlyAccess` refuses its
 * details at creation already. A person's way back to their own tokens and USDC stays open: the actions never ask this.
 */
export async function earlyAccessTakenDown(store: GuardStore, origin: string, record: Pick<EarlyAccessRecord, "mint" | "metadataUri">): Promise<boolean> {
  if (await isTakenDown(store, "mint", record.mint)) return true;
  return (await metadataOfUri(store, record.metadataUri, origin))?.takenDown === true;
}

const TAKEN_DOWN = "Ryntra took this launch's details down: it takes no deposit here.";

async function openRecord(deps: Pick<EarlyAccessDeps, "store" | "network">, mint: string): Promise<EarlyAccessRecord | EarlyAccessFailure> {
  const record = await readEarlyAccessRecord(deps.store, deps.network.cluster, mint);
  if (!record) return fail("LAUNCH_NOT_FOUND", "No early-access launch of this token here.");
  return record;
}

export async function prepareEarlyAccessDeposit(deps: EarlyAccessDeps, mint: string, input: Readonly<{ wallet: string; amountRaw: string }>): Promise<PreparedDeposit | EarlyAccessFailure> {
  if (!earlyAccessOpenFor(deps.network, deps.env, deps.ownerWord)) return fail("LAUNCH_PAUSED", "Early access is not open here; nothing was built.");
  const stored = await openRecord(deps, mint);
  if ("ok" in stored) return stored;
  if (await earlyAccessTakenDown(deps.store, deps.origin, stored)) return fail("VALIDATION_ERROR", `${TAKEN_DOWN} Nothing was built.`);
  const phase = earlyAccessPhase(stored.schedule, seconds(deps));
  if (phase !== "DEPOSITS") return fail("VALIDATION_ERROR", phase === "UPCOMING" ? "Deposits are not open yet." : "Deposits are closed.");
  /* Money goes into a vault only once the whole launch is on chain as built: every step landed, the vault holds the
     launch's terms, and the pool names this vault as the one that buys before activation. */
  const record = await settle(deps, stored).catch(() => stored);
  if (record.state !== "OPEN") return fail("LAUNCH_NOT_FOUND", "The launch is not on the network whole yet; nothing was built.");
  try {
    const [vault, pool] = await Promise.all([readEarlyAccessVault(deps.connection, record.vault, null), readEarlyAccessPool(deps.connection, record.pool)]);
    if (!vault || !pool) return fail("LAUNCH_NOT_FOUND", "The launch's vault or pool is not on the network; nothing was built.");
    const problems = vaultProblems(vault.vault, record);
    if (problems.length) return fail("VALIDATION_ERROR", `The vault on the network is not the launch's: ${problems[0]}; nothing was built.`);
    if (pool.whitelistedVault !== record.vault) return fail("VALIDATION_ERROR", "The pool does not name the launch's vault; nothing was built.");
  } catch {
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
  let built;
  try {
    built = await buildEarlyAccessDeposit({ connection: deps.connection, vault: record.vault, owner: input.wallet, amountRaw: input.amountRaw });
  } catch (error) {
    if (error instanceof EarlyAccessRefusal) return fail(error.code === "NO_VAULT" ? "LAUNCH_NOT_FOUND" : "VALIDATION_ERROR", error.message);
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The deposit could not be built.");
  }
  await sweep(deps).catch(() => undefined);
  const windows = await readBuildWindows(web3ChainReader(deps.connection), built.validUntil ?? "0", { transactions: 1, capMs: EARLY_ACCESS_BUILD_TTL_MS });
  const now = deps.now();
  const build: EarlyAccessBuildRecord = {
    kind: "DEPOSIT",
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    wallet: input.wallet,
    mint,
    vault: record.vault,
    amountRaw: input.amountRaw,
    wireBase64: built.wireBase64,
    validUntil: built.validUntil ?? "0",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + windows.lifeMs).toISOString(),
  };
  await collection<EarlyAccessBuildRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.builds).insertIfAbsent(buildKey(build.cluster, build.id), build);
  return { ok: true, buildId: build.id, unsignedWireBase64: built.wireBase64, escrow: built.escrow, opensEscrow: built.opensEscrow, amountRaw: input.amountRaw, expiresAt: build.expiresAt, signableMs: windows.signableMs };
}

export type SubmittedDeposit = Readonly<{ ok: true; state: "CONFIRMED" | "PENDING"; signature: string }>;

export async function submitEarlyAccessDeposit(deps: EarlyAccessDeps, mint: string, input: Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>): Promise<SubmittedDeposit | EarlyAccessFailure> {
  return sendWalletBuild(deps, mint, "DEPOSIT", input);
}

/**
 * A build the wallet signs as the fee payer and only signer — a deposit or an action — against the bytes remembered:
 * only the wallet's own fee and guard instructions may be added, every signature real; sent once.
 */
async function sendWalletBuild(
  deps: EarlyAccessDeps,
  mint: string,
  kind: "DEPOSIT" | "ACTION",
  input: Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>,
): Promise<SubmittedDeposit | EarlyAccessFailure> {
  const what = kind === "DEPOSIT" ? "deposit" : "action";
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await collection<EarlyAccessBuildRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.builds).get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.kind !== kind || build.mint !== mint) return fail("LAUNCH_NOT_FOUND", `This ${what} was not built here.`);
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", `This ${what} was built for another wallet.`);
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", `The ${what} waited too long for the signature; prepare it again.`);
  /* The wallet's own fee and guard instructions are its right; any other change is not what the person reviewed. */
  const verdict = compareWalletTransaction({ expectedWireBase64: build.wireBase64, actualWireBase64: input.signedWireBase64, guardPolicy: "BOUNDED" });
  if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(input.signedWireBase64, "base64"));
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (!tx.verifySignatures(true)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature is missing or does not match the transaction.");
  /* A deposit built before a takedown is not sent after it; an action — a way back to one's own money — always is. */
  if (kind === "DEPOSIT") {
    const record = await readEarlyAccessRecord(deps.store, build.cluster, build.mint);
    if (!record || (await earlyAccessTakenDown(deps.store, deps.origin, record))) return fail("VALIDATION_ERROR", `${TAKEN_DOWN} Nothing was sent.`);
  }
  const sends = collection<EarlyAccessSend>(deps.store, EARLY_ACCESS_COLLECTIONS.sends);
  if (!(await sends.insertIfAbsent(buildKey(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) return fail("LAUNCH_BUILD_USED", `This ${what} was already sent.`);
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...DEPOSIT_BUDGET, deadline }, { second: deps.second });
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    if (sent.outcome === "REJECTED") await sends.delete(buildKey(build.cluster, build.id));
    return fail("LAUNCH_SUBMIT_FAILED", sent.reason ?? `The network refused the ${what}.`);
  }
  return { ok: true, state: sent.outcome === "CONFIRMED" ? "CONFIRMED" : "PENDING", signature: sent.signature };
}

/* ------------------------------------------------- after the deposits */

/**
 * What a depositor — or anyone — does with the vault once deposits are in:
 * - `CLAIM` — the tokens vested so far, from the moment vesting starts (a second after trading opens);
 * - `WITHDRAW_REMAINING` — the USDC the vault did not spend (a Pro Rata overflow, or all of it when the vault never
 *   bought), once trading has opened;
 * - `WITHDRAW` — Pro Rata only, while deposits are open: the deposit back (all of it unless `amountRaw` names a part);
 * - `FILL` — the vault's purchase, a permissionless crank any wallet may send and pay for, only in the hour before
 *   trading opens.
 * Not behind the operator's switch: a person's way back to their own tokens and USDC is never closed by Ryntra.
 */
export const EARLY_ACCESS_ACTIONS = ["CLAIM", "WITHDRAW_REMAINING", "WITHDRAW", "FILL"] as const;
export type EarlyAccessAction = (typeof EARLY_ACCESS_ACTIONS)[number];

export type PreparedAction = Readonly<{ ok: true; buildId: string; unsignedWireBase64: string; action: EarlyAccessAction; amountRaw: string | null; expiresAt: string; signableMs: number }>;

/** Whether the action's window is open at `now` (unix seconds), by the launch's schedule; the refusal's words when not. */
export function actionWindowProblem(record: Pick<EarlyAccessRecord, "schedule" | "rules">, action: EarlyAccessAction, now: number): string | null {
  const s = record.schedule;
  switch (action) {
    case "CLAIM":
      return now >= s.vestingStartsAt ? null : "Tokens can be claimed once trading opens.";
    case "WITHDRAW_REMAINING":
      return now >= s.activatesAt ? null : "What the vault did not spend can be taken back once trading opens.";
    case "WITHDRAW":
      if (record.rules.mode !== "PRO_RATA") return "A first-come deposit cannot be taken back.";
      return now >= s.depositStartsAt && now <= s.depositEndsAt ? null : "A deposit can be taken back only while deposits are open.";
    case "FILL":
      return now >= s.fillStartsAt && now < s.activatesAt ? null : "The vault buys only in the hour before trading opens.";
  }
}

const REFUSALS: Readonly<Record<EarlyAccessRefusal["code"], ApiErrorCode>> = {
  NOT_HONEST: "UNAVAILABLE",
  ALLOWLIST_LATER: "VALIDATION_ERROR",
  NO_VAULT: "LAUNCH_NOT_FOUND",
  NO_POOL: "LAUNCH_NOT_FOUND",
  NOT_NOW: "VALIDATION_ERROR",
  ABOVE_CAP: "VALIDATION_ERROR",
  NOTHING_TO_DO: "LAUNCH_NOTHING_TO_CLAIM",
  NOT_YOURS: "LAUNCH_NOTHING_TO_CLAIM",
};

export async function prepareEarlyAccessAction(
  deps: EarlyAccessDeps,
  mint: string,
  input: Readonly<{ wallet: string; action: EarlyAccessAction; amountRaw?: string | null }>,
): Promise<PreparedAction | EarlyAccessFailure> {
  if (!(EARLY_ACCESS_ACTIONS as readonly string[]).includes(input.action)) return fail("VALIDATION_ERROR", "Unknown action.");
  const record = await openRecord(deps, mint);
  if ("ok" in record) return record;
  const closed = actionWindowProblem(record, input.action, seconds(deps));
  if (closed) return fail("VALIDATION_ERROR", closed);
  const args = { connection: deps.connection, vault: record.vault, owner: input.wallet };
  let built: Readonly<{ wireBase64: string; validUntil: string | null; amountRaw?: string }>;
  try {
    if (input.action === "CLAIM") built = await buildEarlyAccessClaim(args);
    else if (input.action === "WITHDRAW_REMAINING") built = await buildEarlyAccessWithdrawRemaining(args);
    else if (input.action === "FILL") built = await buildEarlyAccessFill({ connection: deps.connection, vault: record.vault, cranker: input.wallet });
    else {
      let amountRaw = input.amountRaw ?? null;
      if (amountRaw === null) {
        const read = await readEarlyAccessVault(deps.connection, record.vault, input.wallet);
        if (!read) return fail("LAUNCH_NOT_FOUND", "The vault is not on chain.");
        amountRaw = read.escrow?.totalDeposit ?? "0";
      }
      built = { ...(await buildEarlyAccessWithdraw({ ...args, amountRaw })), amountRaw };
    }
  } catch (error) {
    if (error instanceof EarlyAccessRefusal) return fail(REFUSALS[error.code], error.message);
    return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The action could not be built.");
  }
  await sweep(deps).catch(() => undefined);
  const windows = await readBuildWindows(web3ChainReader(deps.connection), built.validUntil ?? "0", { transactions: 1, capMs: EARLY_ACCESS_BUILD_TTL_MS });
  const now = deps.now();
  const build: EarlyAccessBuildRecord = {
    kind: "ACTION",
    action: input.action,
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    wallet: input.wallet,
    mint,
    vault: record.vault,
    amountRaw: built.amountRaw ?? null,
    wireBase64: built.wireBase64,
    validUntil: built.validUntil ?? "0",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + windows.lifeMs).toISOString(),
  };
  await collection<EarlyAccessBuildRecord>(deps.store, EARLY_ACCESS_COLLECTIONS.builds).insertIfAbsent(buildKey(build.cluster, build.id), build);
  return { ok: true, buildId: build.id, unsignedWireBase64: build.wireBase64, action: input.action, amountRaw: build.amountRaw, expiresAt: build.expiresAt, signableMs: windows.signableMs };
}

export type SubmittedAction = SubmittedDeposit;

export async function submitEarlyAccessAction(deps: EarlyAccessDeps, mint: string, input: Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>): Promise<SubmittedAction | EarlyAccessFailure> {
  return sendWalletBuild(deps, mint, "ACTION", input);
}

/* -------------------------------------------------------------- the view */

export type EarlyAccessView = Readonly<{
  mint: string;
  pool: string;
  vault: string;
  creator: string;
  name: string;
  symbol: string;
  rules: EarlyAccessRules;
  schedule: EarlyAccessSchedule;
  lines: Readonly<{ uk: readonly string[]; en: readonly string[] }>;
  /** The phase by the chain's clock when it was read, by the server's otherwise. */
  state: EarlyAccessPhase;
  creation: Readonly<{ state: EarlyAccessRecord["state"]; steps: EarlyAccessRecord["steps"] }>;
  terms: Readonly<{ startPriceUsd: number; presaleBps: number; ryntraShareBps: 0; atCap: EarlyAccessFill }>;
  /** The vault as read now: OK, MISSING (not on chain — the creation has not landed it), or FAILED (not readable now). */
  read: "OK" | "MISSING" | "FAILED";
  /** Null unless read OK — never a zero for a figure that was not read. */
  depositedRaw: string | null;
  capRaw: string;
  depositors: string | null;
  boughtRaw: string | null;
  /** Whether the vault has bought from the pool; null unless read. */
  filled: boolean | null;
  /** What the deposits so far would buy, on the pool's curve; null unless read. */
  atDeposited: EarlyAccessFill | null;
  /** Where the vault on chain says other than the record: each a plain line. */
  chainProblems: readonly string[];
  /** The asking wallet's part, when it asked and the vault was read. */
  mine: Readonly<{ depositedRaw: string; claimableRaw: string; claimedRaw: string; allocatedRaw: string; remainingQuoteRaw: string; roomRaw: string | null; refunded: boolean }> | null;
}>;

/** Where the vault on chain differs from the rules the record names. */
export function vaultProblems(vault: VaultFields, record: Pick<EarlyAccessRecord, "rules" | "schedule" | "pool" | "mint" | "quoteMint">): readonly string[] {
  const problems: string[] = [];
  const mode = record.rules.mode === "FCFS" ? ALPHA_VAULT_MODE.FCFS : ALPHA_VAULT_MODE.PRORATA;
  if (vault.vaultMode !== mode) problems.push("the vault's mode is not the launch's");
  if (vault.pool !== record.pool || vault.baseMint !== record.mint || vault.quoteMint !== record.quoteMint) problems.push("the vault is not this launch's pool");
  if (vault.depositingPoint !== String(record.schedule.depositStartsAt)) problems.push("the vault's deposits open at another time");
  if (vault.startVestingPoint !== String(record.schedule.vestingStartsAt) || vault.endVestingPoint !== String(record.schedule.vestingEndsAt)) problems.push("the vault's vesting is another");
  if (record.rules.mode === "FCFS" ? vault.maxDepositingCap !== record.rules.maxCapRaw || vault.individualDepositingCap !== record.rules.individualCapRaw : vault.maxBuyingCap !== record.rules.maxCapRaw) problems.push("the vault's caps are others");
  if (vault.escrowFee !== "0") problems.push("the vault charges an escrow fee");
  return problems;
}

/**
 * Steps not settled yet, settled from the chain's accounts: the mint, the pool and the vault at their addresses, each
 * owned by its program, is that step landed — whatever any signature read said. Rewritten when it changes.
 */
async function settle(deps: Pick<EarlyAccessDeps, "connection" | "store">, record: EarlyAccessRecord): Promise<EarlyAccessRecord> {
  if (record.state === "OPEN") return record;
  const infos = await deps.connection.getMultipleAccountsInfo(EARLY_ACCESS_ROLES.map((role) => new PublicKey(accountOf(record, role))), "confirmed").catch(() => null);
  if (!infos) return record;
  let steps = record.steps;
  for (const [index, role] of EARLY_ACCESS_ROLES.entries()) {
    const info = infos[index];
    if (steps[role].state !== "CONFIRMED" && info && OWNERS[role].includes(info.owner.toBase58())) steps = { ...steps, [role]: { ...steps[role], state: "CONFIRMED", reason: null } };
  }
  if (steps === record.steps) return record;
  const settled: EarlyAccessRecord = { ...record, steps, state: stateOf(steps) };
  await writeRecord(deps.store, settled);
  return settled;
}

/**
 * The launch as its window shows it. One Ryntra took down (review 8.11) is shown only to a wallet with its own money in
 * the vault — and with no room to bring more (`roomRaw` "0"), so the window offers only the way back; to anyone else it
 * is not here (null).
 */
export async function earlyAccessView(deps: Pick<EarlyAccessDeps, "network" | "connection" | "store" | "now">, mint: string, wallet?: string | null): Promise<EarlyAccessView | null> {
  const stored = await readEarlyAccessRecord(deps.store, deps.network.cluster, mint);
  if (!stored) return null;
  const view = await viewOf(deps, stored, wallet);
  if (!(await earlyAccessTakenDown(deps.store, deps.network.origin, stored))) return view;
  const mine = view.mine;
  const own = mine !== null && (BigInt(mine.depositedRaw) > 0n || BigInt(mine.claimableRaw) > 0n || BigInt(mine.remainingQuoteRaw) > 0n);
  return own ? { ...view, mine: { ...mine, roomRaw: "0" } } : null;
}

async function viewOf(deps: Pick<EarlyAccessDeps, "network" | "connection" | "store" | "now">, stored: EarlyAccessRecord, wallet?: string | null): Promise<EarlyAccessView> {
  const record = await settle(deps, stored).catch(() => stored);
  let read: EarlyAccessView["read"] = "FAILED";
  let vaultRead: Awaited<ReturnType<typeof readEarlyAccessVault>> = null;
  try {
    vaultRead = await readEarlyAccessVault(deps.connection, record.vault, wallet ?? null);
    read = vaultRead ? "OK" : "MISSING";
  } catch {
    read = "FAILED";
  }
  const nowSeconds = vaultRead ? vaultRead.clockUnix : seconds(deps);
  const vault = vaultRead?.vault ?? null;
  const escrow = vaultRead?.escrow ?? null;
  const claim = vault ? claimInfoOf(vault, escrow, nowSeconds) : null;
  return {
    mint: record.mint,
    pool: record.pool,
    vault: record.vault,
    creator: record.creator,
    name: record.name,
    symbol: record.symbol,
    rules: record.rules,
    schedule: record.schedule,
    lines: { uk: earlyAccessRuleLines(record.rules, "uk"), en: earlyAccessRuleLines(record.rules, "en") },
    state: earlyAccessPhase(record.schedule, nowSeconds),
    creation: { state: record.state, steps: record.steps },
    terms: { startPriceUsd: startPriceUsd(record.rules), presaleBps: presaleBpsOf(record.rules), ryntraShareBps: RYNTRA_EARLY_ACCESS_SHARE_BPS, atCap: earlyAccessFill(record.rules) },
    read,
    depositedRaw: vault?.totalDeposit ?? null,
    capRaw: record.rules.maxCapRaw,
    depositors: vault?.totalEscrow ?? null,
    boughtRaw: vault?.boughtToken ?? null,
    filled: vault ? BigInt(vault.swappedAmount) > 0n : null,
    atDeposited: vault ? earlyAccessFill(record.rules, vault.totalDeposit) : null,
    chainProblems: vault ? vaultProblems(vault, record) : [],
    mine:
      vault && wallet
        ? {
            depositedRaw: escrow?.totalDeposit ?? "0",
            claimableRaw: claim!.claimableRaw,
            claimedRaw: claim!.claimedRaw,
            allocatedRaw: claim!.allocatedRaw,
            remainingQuoteRaw: BigInt(vault.swappedAmount) > 0n || nowSeconds >= record.schedule.activatesAt ? remainingQuoteOf(vault, escrow) : "0",
            roomRaw: depositRoomOf(vault, escrow)?.toString() ?? null,
            refunded: escrow?.refunded ?? false,
          }
        : null,
  };
}
