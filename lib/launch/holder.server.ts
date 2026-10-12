/**
 * A holder's position in a graduated launch's pool — the server's half (the
 * decision of 2026-10-07: Ryntra's collector pays the fees to the
 * owner's wallet; it cannot add them back, the program takes liquidity only
 * from the signer's own accounts).
 *
 * 1. **Read**: the token's pool, whether the entry is open to this wallet, the
 *    collector and the two bits it asks for, Ryntra's share at entry, and the
 *    wallet's positions in the pool entered through Ryntra — each read from the
 *    chain now: what it holds and is worth, the fees waiting and claimed, its
 *    permission, and what the collector brought to the wallet.
 * 2. **Quote / build**: one coin in, through Zap; Ryntra's share before the
 *    signature; the collector's permission in the same signature where the
 *    network has a collector. The bytes are kept to compare the signed ones with.
 * 3. **Submit**: the signed bytes must be the built ones — the wallet may add
 *    only its own fee and guard instructions — sent once and confirmed; the
 *    position is written down before the send, so a lost answer keeps it.
 * 4. **The permission**: «Увімкнути» and «Відкликати», one signature each.
 *
 * **Who may enter.** `HOLDER_OPEN_TO_PEOPLE` is the switch: on, everyone — once our own security review of the
 * permission is clean (the decision of 2026-10-08: its boundary in the program's code, the collector's tries refused on
 * devnet and again on mainnet with Ryntra's own wallet). Off, on mainnet the entry is built only for the operator's own
 * wallets — the list the admin keeps and the deployment's `RYNTRA_INTERNAL_WALLETS` — and only once the request proved,
 * by a wallet sign-in, that it signs for that wallet. `open` then reads the same for every address merely named. (The
 * positions a wallet holds are public chain facts — the collector is the delegate on each — and are read as such.) The
 * devnet stand has no people and is open.
 */

import { randomBytes } from "node:crypto";

import { getBase58Decoder } from "@solana/kit";
import { PublicKey, Transaction } from "@solana/web3.js";

import type {
  ApiErrorCode,
  LaunchHolderBuildRequest,
  LaunchHolderBuildResponse,
  LaunchHolderPermissionBuildRequest,
  LaunchHolderPermissionBuildResponse,
  LaunchHolderPermissionSubmitRequest,
  LaunchHolderPermissionSubmitResponse,
  LaunchHolderPositionView,
  LaunchHolderPositionsResponse,
  LaunchHolderQuoteRequest,
  LaunchHolderQuoteResponse,
  LaunchHolderResponse,
  LaunchHolderSubmitRequest,
  LaunchHolderSubmitResponse,
} from "../api/v1/contract.ts";
import { resolveInternalWallets } from "../admin/internal-wallets.ts";
import { HOLDER_GRANT_BITMASK, collectorNextClaim, holderEarningsCard, holderGrantState, permissionsOf, type HolderCardRow } from "../core/launch/holder.ts";
import { createHolderVenue, HolderRefusal, type HolderPool, type HolderPositionRead, type HolderVenue } from "../core/venues/meteora-damm-v2/holder.server.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import { launchExecutorAddress, launchPair, launchPoolFee } from "./config.server.ts";
import type { LaunchDeps, LaunchReadDeps, LaunchRecord } from "./flow.server.ts";
import { readLaunchRecord, sendOnce, signatureOutcome } from "./flow.server.ts";
import { forgetLaunchMarket } from "./market.server.ts";
import { launchMarketReader } from "./trade-index.server.ts";

export type HolderDeps = Pick<LaunchDeps, "network" | "connection" | "store" | "now"> &
  Pick<LaunchReadDeps, "second" | "adopt"> &
  Readonly<{
    env?: NodeJS.ProcessEnv;
    /** The wallet this request proved it signs for (a wallet sign-in), read only while the entry is closed to people. */
    proven?: (() => Promise<string | null>) | null;
    /** The switch as the tests set it; the deployment always reads `HOLDER_OPEN_TO_PEOPLE`. */
    openToPeople?: boolean;
  }>;

/**
 * Whether the entry is open to people — the switch. On since 2026-10-11, once our own security review of the permission
 * came out clean; turned off again, on mainnet only the operator's own wallets enter, each proven by its sign-in.
 */
export const HOLDER_OPEN_TO_PEOPLE = true;

/** How long a built entry or permission waits for the signature. */
export const HOLDER_BUILD_TTL_MS = 90 * 1000;
const SEND_BUDGET = { confirmMs: 25_000, settleMs: 10_000 } as const;
const ROUTE_MS = 50_000;

const BUILDS = "launchHolderBuilds";
const SENDS = "launchHolderSends";
const POSITIONS = "launchHolderPositions";
const CLAIMS = "launchHolderClaims";
/** The collector's own pace per position (`launch/autopilot.server.ts`): when it reads each one again. */
export const HOLDER_CHECKS = "launchHolderChecks";

export type HolderFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string }>;
const fail = (code: ApiErrorCode, message: string): HolderFailure => ({ ok: false, code, message });

type HolderBuild = Readonly<{
  id: string;
  cluster: string;
  token: string;
  wallet: string;
  kind: "entry" | "grant" | "revoke";
  pool: string;
  position: string;
  nftMint: string;
  wireBase64: string;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
  input: "pair" | "token" | null;
  amountRaw: string | null;
  enteredPairRaw: string | null;
  feeRaw: string | null;
  granted: boolean;
}>;

/** A position entered through Ryntra: written before the entry is sent, settled by the chain's answer. */
export type HolderPositionRecord = Readonly<{
  cluster: string;
  wallet: string;
  token: string;
  pool: string;
  position: string;
  nftMint: string;
  state: "PENDING" | "OPEN";
  enteredAt: string;
  entrySignature: string;
  validUntil: string;
  input: "pair" | "token";
  /** What the entry spent of the input coin, Ryntra's share included, raw. */
  enteredRaw: string;
  /** Its value in the pair currency at the entry's price, raw. */
  enteredPairRaw: string;
  feeRaw: string;
  granted: boolean;
  /** The pair currency is a dollar: the collector claims only such positions. */
  pairDollar: boolean;
}>;

/** A claim Ryntra's collector made for a position's owner: the owner's own gain read from the confirmed transaction. */
export type HolderClaimReceipt = Readonly<{
  cluster: string;
  position: string;
  owner: string;
  token: string;
  pairMint: string;
  signature: string;
  /** PENDING — written before the send, its transaction not read yet; CONFIRMED — read, the amounts are the owner's own gain. */
  state: "PENDING" | "CONFIRMED";
  sentAt: string;
  validUntil: number;
  at: string | null;
  pairRaw: string;
  tokenRaw: string;
  /** The collector's SOL the claim took. */
  lamports: string | null;
}>;

const key = (...parts: string[]) => parts.join(":");
export const holderPositionKey = (cluster: string, wallet: string, position: string) => key(cluster, wallet, position);
export const holderClaimKey = (cluster: string, position: string, signature: string) => key(cluster, position, signature);

/**
 * Whether the entry is built for this wallet here: the stand and — once open to people — mainnet for anyone; closed, on
 * mainnet only an operator's own wallet that this request proved it signs for. An address merely named reads closed
 * like every other: `open` never tells whose wallets are the operator's.
 */
export async function holderOpenFor(deps: HolderDeps, wallet: string): Promise<boolean> {
  if (deps.network.cluster !== "mainnet" || (deps.openToPeople ?? HOLDER_OPEN_TO_PEOPLE)) return true;
  try {
    const proven = deps.proven ? await deps.proven() : null;
    if (proven !== wallet) return false;
    const { wallets } = await resolveInternalWallets(deps.store, deps.env ?? process.env);
    return wallets.has(wallet);
  } catch {
    return false;
  }
}

function venueOf(deps: HolderDeps): HolderVenue {
  return createHolderVenue({ connection: deps.connection, zap: deps.network.zap, collector: launchExecutorAddress(deps.network, deps.env ?? process.env), fee: launchPoolFee(deps.network) });
}

/** The launch and its graduated pool, or why there is none. */
async function poolOf(deps: HolderDeps, venue: HolderVenue, token: string): Promise<Readonly<{ record: LaunchRecord; pool: HolderPool | null }> | HolderFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  const state = await launchMarketReader(deps).state({ token, pool: record.pool });
  if (!state.graduated) return { record, pool: null };
  return { record, pool: await venue.pool(state.graduated.pool, token) };
}

function refused(error: unknown): HolderFailure {
  if (error instanceof HolderRefusal) {
    if (error.code === "BALANCE_LOW") return fail("LAUNCH_BALANCE_LOW", "The wallet does not hold that much.");
    if (error.code === "AMOUNT_ZERO") return fail("VALIDATION_ERROR", "amountRaw: more than zero");
    if (error.code === "NO_POOL") return fail("LAUNCH_NOT_GRADUATED", error.message);
    if (error.code === "NOT_OWNER" || error.code === "MOVED") return fail("WALLET_MISMATCH", error.message);
    if (error.code === "NO_COLLECTOR") return fail("LAUNCH_PAUSED", "The collector is not set up here yet; nothing was built.");
  }
  return fail("UNAVAILABLE", error instanceof Error ? error.message.slice(0, 300) : "The pool could not be read now.");
}

/* ------------------------------------------------------------ reading */

async function positionsOf(deps: HolderDeps, wallet: string, token: string | null): Promise<HolderPositionRecord[]> {
  const rows = await deps.store.collection<HolderPositionRecord>(POSITIONS).valuesWithPrefix(key(deps.network.cluster, wallet, ""));
  return [...rows].filter((row) => row.wallet === wallet && (token === null || row.token === token)).sort((a, b) => Date.parse(b.enteredAt) - Date.parse(a.enteredAt));
}

export async function holderClaims(deps: Readonly<{ store: HolderDeps["store"]; network: Pick<HolderDeps["network"], "cluster"> }>, position: string): Promise<HolderClaimReceipt[]> {
  const rows = await deps.store.collection<HolderClaimReceipt>(CLAIMS).valuesWithPrefix(key(deps.network.cluster, position, ""));
  return [...rows].sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
}

/** A pending entry settled by the chain: the position exists — open; the entry can no longer land — gone. */
async function settled(deps: HolderDeps, record: HolderPositionRecord): Promise<HolderPositionRecord | null> {
  if (record.state === "OPEN") return record;
  const outcome = await signatureOutcome(deps.connection, record.entrySignature, Number(record.validUntil), deps.second ?? null);
  const positions = deps.store.collection<HolderPositionRecord>(POSITIONS);
  const recordKey = holderPositionKey(record.cluster, record.wallet, record.position);
  if (outcome === "CONFIRMED") {
    const open: HolderPositionRecord = { ...record, state: "OPEN" };
    await positions.set(recordKey, open);
    return open;
  }
  if (outcome === "FAILED" || outcome === "REJECTED" || outcome === "EXPIRED") {
    const exists = await deps.connection.getAccountInfo(new PublicKey(record.position), "confirmed").catch(() => undefined);
    if (exists === null) {
      await positions.delete(recordKey);
      return null;
    }
    if (exists) {
      const open: HolderPositionRecord = { ...record, state: "OPEN" };
      await positions.set(recordKey, open);
      return open;
    }
  }
  return record;
}

function positionView(deps: HolderDeps, record: HolderPositionRecord, read: HolderPositionRead | null, claims: readonly HolderClaimReceipt[], price: number, decimals: Readonly<{ token: number; pair: number }>, collector: string | null): LaunchHolderPositionView {
  const confirmed = claims.filter((claim) => claim.state === "CONFIRMED");
  const collected = confirmed.reduce((total, claim) => total + BigInt(claim.pairRaw), 0n);
  const toPair = (tokenRaw: string) => BigInt(Math.floor((Number(tokenRaw) / 10 ** decimals.token) * price * 10 ** decimals.pair));
  let now: LaunchHolderPositionView["now"] = null;
  if (read && read.closed) now = { state: "CLOSED", tokenRaw: "0", pairRaw: "0", valuePairRaw: "0", feesPairRaw: "0", unclaimedPairRaw: "0", unclaimedTokenRaw: "0", claimedPairRaw: "0", grant: "NONE" };
  else if (read && !read.closed) {
    const value = BigInt(read.pairRaw) + toPair(read.tokenRaw);
    now = {
      state: read.owner === null ? "MOVED" : read.owner === record.wallet ? "OPEN" : "MOVED",
      tokenRaw: read.tokenRaw,
      pairRaw: read.pairRaw,
      valuePairRaw: value.toString(),
      feesPairRaw: (BigInt(read.claimedPairRaw) + BigInt(read.unclaimedPairRaw)).toString(),
      unclaimedPairRaw: read.unclaimedPairRaw,
      unclaimedTokenRaw: read.unclaimedTokenRaw,
      claimedPairRaw: read.claimedPairRaw,
      grant: holderGrantState({ delegate: read.delegate, delegatedAmount: read.delegatedAmount, bitmask: read.bitmask, collector }),
      closedAccounts: closedAccountsOf(read),
    };
  }
  return {
    token: record.token,
    pool: record.pool,
    position: record.position,
    nftMint: record.nftMint,
    pending: record.state === "PENDING",
    enteredAt: record.enteredAt,
    entrySignature: record.entrySignature,
    input: record.input,
    enteredRaw: record.enteredRaw,
    enteredPairRaw: record.enteredPairRaw,
    feeRaw: record.feeRaw,
    now,
    collectedPairRaw: collected.toString(),
    claimsCount: confirmed.length,
    claims: confirmed.slice(0, 20).map((claim) => ({ signature: claim.signature, at: claim.at, pairRaw: claim.pairRaw, tokenRaw: claim.tokenRaw })),
    /* The queue as the collector itself reads it: its last attempt in any state (newest first), the same dollar rule. */
    nextCollection:
      now && now.state === "OPEN" && now.grant === "GRANTED" && record.pairDollar && !now.closedAccounts?.length
        ? (({ notBefore, enoughWaiting }) => ({ notBefore, enoughWaiting }))(collectorNextClaim({ claimablePairRaw: BigInt(now.unclaimedPairRaw), pairDecimals: decimals.pair, lastClaimAt: claims[0]?.sentAt ?? null, now: deps.now().getTime() }))
        : null,
  };
}

/** The owner's accounts a claim pays into that are closed now: the collector does not reopen them at its cost and waits. */
export function closedAccountsOf(read: Readonly<{ ownerAccounts?: Readonly<{ token: boolean; pair: boolean }> | null }>): Array<"token" | "pair"> {
  if (!read.ownerAccounts) return [];
  return (["token", "pair"] as const).filter((side) => !read.ownerAccounts![side]);
}

/** The token's pool as the page's holder card reads it, with this wallet's positions in it. */
export async function readLaunchHolder(deps: HolderDeps, token: string, wallet: string): Promise<Readonly<{ ok: true; holder: LaunchHolderResponse }> | HolderFailure> {
  const venue = venueOf(deps);
  try {
    const found = await poolOf(deps, venue, token);
    if ("ok" in found) return found;
    const { record, pool } = found;
    const pair = launchPair(deps.network, record.preset);
    const collector = launchExecutorAddress(deps.network, deps.env ?? process.env);
    const fee = launchPoolFee(deps.network);
    const open = pool !== null && pair.dollar && (await holderOpenFor(deps, wallet));
    const positions: LaunchHolderPositionView[] = [];
    if (pool) {
      for (const row of await positionsOf(deps, wallet, token)) {
        const current = await settled(deps, row).catch(() => row);
        if (!current) continue;
        const read = current.state === "OPEN" ? await venue.readPosition(pool, current).catch(() => null) : null;
        positions.push(positionView(deps, current, read, await holderClaims(deps, current.position), pool.price, { token: pool.tokenDecimals, pair: pool.pairDecimals }, collector));
      }
    }
    return {
      ok: true,
      holder: {
        network: deps.network.chain,
        token,
        pool: pool?.address ?? null,
        open,
        collector,
        grant: { bitmask: HOLDER_GRANT_BITMASK, permissions: permissionsOf(HOLDER_GRANT_BITMASK) },
        fee: { bps: fee?.bps ?? 0, charged: Boolean(fee) },
        compoundingBps: pool && pool.collectFeeMode === 2 ? pool.compoundingBps : null,
        pair: { mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
        tokenDecimals: pool?.tokenDecimals ?? 6,
        price: pool?.price ?? null,
        positions,
        observedAt: deps.now().toISOString(),
      },
    };
  } catch (error) {
    return refused(error);
  }
}

/* ------------------------------------------------------------ the entry */

async function entryGate(deps: HolderDeps, venue: HolderVenue, token: string, wallet: string): Promise<Readonly<{ record: LaunchRecord; pool: HolderPool }> | HolderFailure> {
  if (!(await holderOpenFor(deps, wallet))) return fail("LAUNCH_HOLDER_CLOSED", "Entering the pool is not open yet.");
  const found = await poolOf(deps, venue, token);
  if ("ok" in found) return found;
  if (!found.pool) return fail("LAUNCH_NOT_GRADUATED", "The token is still on its curve; its pool opens when it reaches the DEX.");
  if (!launchPair(deps.network, found.record.preset).dollar) return fail("LAUNCH_HOLDER_CLOSED", "Entering is open for pools paired with a dollar.");
  return { record: found.record, pool: found.pool };
}

export async function quoteLaunchHolder(deps: HolderDeps, token: string, input: LaunchHolderQuoteRequest): Promise<Readonly<{ ok: true; quote: LaunchHolderQuoteResponse }> | HolderFailure> {
  const venue = venueOf(deps);
  try {
    const gate = await entryGate(deps, venue, token, input.wallet);
    if ("ok" in gate) return gate;
    const { swapMinOutRaw: _min, ...figures } = await venue.quote(gate.pool, input.input, BigInt(input.amountRaw));
    return { ok: true, quote: { quote: { ...figures, grant: Boolean(launchExecutorAddress(deps.network, deps.env ?? process.env)) }, price: gate.pool.price, observedAt: deps.now().toISOString() } };
  } catch (error) {
    return refused(error);
  }
}

/** Builds older than an hour past their expiry are removed — at most once in five minutes an instance: a sweep lists them all. */
let sweptAt = 0;
async function sweep(deps: HolderDeps): Promise<void> {
  const at = deps.now().getTime();
  if (at - sweptAt < 5 * 60 * 1000) return;
  sweptAt = at;
  const stale = at - 60 * 60 * 1000;
  const builds = deps.store.collection<HolderBuild>(BUILDS);
  for (const build of await builds.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(build.expiresAt) < stale) await builds.delete(key(build.cluster, build.id));
  const sends = deps.store.collection<Readonly<{ cluster: string; id: string; at: string }>>(SENDS);
  for (const send of await sends.valuesWithPrefix(`${deps.network.cluster}:`)) if (Date.parse(send.at) < stale) await sends.delete(key(send.cluster, send.id));
}

export async function buildLaunchHolder(deps: HolderDeps, token: string, input: LaunchHolderBuildRequest): Promise<Readonly<{ ok: true; build: LaunchHolderBuildResponse }> | HolderFailure> {
  const venue = venueOf(deps);
  try {
    const gate = await entryGate(deps, venue, token, input.wallet);
    if ("ok" in gate) return gate;
    const built = await venue.buildEntry({ pool: gate.pool, wallet: input.wallet, input: input.input, amountRaw: BigInt(input.amountRaw), slippageBps: input.slippageBps });
    await sweep(deps).catch(() => undefined);
    const now = deps.now();
    const { swapMinOutRaw: _min, ...figures } = built.quote;
    const record: HolderBuild = {
      id: randomBytes(16).toString("hex"),
      cluster: deps.network.cluster,
      token,
      wallet: input.wallet,
      kind: "entry",
      pool: gate.pool.address,
      position: built.position,
      nftMint: built.nftMint,
      wireBase64: built.wireBase64,
      validUntil: built.validUntil,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + HOLDER_BUILD_TTL_MS).toISOString(),
      input: input.input,
      amountRaw: input.amountRaw,
      enteredPairRaw: figures.valuePairRaw,
      feeRaw: figures.feeRaw,
      granted: built.granted,
    };
    await deps.store.collection<HolderBuild>(BUILDS).insertIfAbsent(key(record.cluster, record.id), record);
    return {
      ok: true,
      build: { buildId: record.id, network: deps.network.chain, unsignedWireBase64: built.wireBase64, position: built.position, quote: { ...figures, grant: built.granted }, expiresAt: record.expiresAt },
    };
  } catch (error) {
    return refused(error);
  }
}

/** The signed bytes against the built ones: the wallet's own fee and guard instructions are its right, nothing else. */
async function signedAsBuilt(deps: HolderDeps, kinds: readonly HolderBuild["kind"][], token: string, input: Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>): Promise<Readonly<{ build: HolderBuild; tx: Transaction }> | HolderFailure> {
  const build = await deps.store.collection<HolderBuild>(BUILDS).get(key(deps.network.cluster, input.buildId));
  if (!build || build.token !== token || !kinds.includes(build.kind)) return fail("LAUNCH_NOT_FOUND", "This was not built here.");
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", "This was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "It waited too long for the signature; prepare it again.");
  const verdict = compareWalletTransaction({ expectedWireBase64: build.wireBase64, actualWireBase64: input.signedWireBase64, guardPolicy: "BOUNDED" });
  if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(input.signedWireBase64, "base64"));
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (!tx.verifySignatures(true)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature is missing or does not match the transaction.");
  if (!(await deps.store.collection<Readonly<{ cluster: string; id: string; at: string }>>(SENDS).insertIfAbsent(key(build.cluster, build.id), { cluster: build.cluster, id: build.id, at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This was already sent.");
  }
  return { build, tx };
}

export async function submitLaunchHolder(deps: HolderDeps, token: string, input: LaunchHolderSubmitRequest): Promise<Readonly<{ ok: true; submit: LaunchHolderSubmitResponse }> | HolderFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const checked = await signedAsBuilt(deps, ["entry"], token, input);
  if ("ok" in checked) return checked;
  const { build, tx } = checked;
  const first = tx.signatures[0]?.signature;
  const signature = first ? getBase58Decoder().decode(new Uint8Array(first)) : "";
  const record: HolderPositionRecord = {
    cluster: build.cluster,
    wallet: build.wallet,
    token,
    pool: build.pool,
    position: build.position,
    nftMint: build.nftMint,
    state: "PENDING",
    enteredAt: deps.now().toISOString(),
    entrySignature: signature,
    validUntil: build.validUntil,
    input: build.input ?? "pair",
    enteredRaw: build.amountRaw ?? "0",
    enteredPairRaw: build.enteredPairRaw ?? "0",
    feeRaw: build.feeRaw ?? "0",
    granted: build.granted,
    pairDollar: true,
  };
  /* Written before the send: an answer lost on the way still leaves the position the wallet signed for. */
  const positions = deps.store.collection<HolderPositionRecord>(POSITIONS);
  const recordKey = holderPositionKey(record.cluster, record.wallet, record.position);
  await positions.set(recordKey, record);
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
  forgetLaunchMarket(deps.network.cluster, token);
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    await positions.delete(recordKey);
    if (/ExceededSlippage|0x1771|PriceSlippage/i.test(sent.detail ?? sent.reason ?? "")) return fail("LAUNCH_SLIPPAGE", "The price moved past the slippage before the entry landed; nothing moved.");
    return fail("LAUNCH_SUBMIT_FAILED", sent.reason ?? "The network refused the entry.");
  }
  if (sent.outcome === "CONFIRMED") await positions.set(recordKey, { ...record, entrySignature: sent.signature, state: "OPEN" });
  return { ok: true, submit: { signature: sent.signature, state: sent.outcome === "CONFIRMED" ? "CONFIRMED" : "PENDING", position: build.position } };
}

/* ------------------------------------------------------------ the permission */

export async function buildHolderPermission(deps: HolderDeps, token: string, input: LaunchHolderPermissionBuildRequest): Promise<Readonly<{ ok: true; build: LaunchHolderPermissionBuildResponse }> | HolderFailure> {
  const venue = venueOf(deps);
  try {
    const record = (await positionsOf(deps, input.wallet, token)).find((row) => row.position === input.position);
    if (!record) return fail("LAUNCH_NOT_FOUND", "No position of this wallet entered here.");
    /* «Відкликати» is always the owner's to sign; «Увімкнути» only where the entry is open. */
    if (input.action === "grant" && !(await holderOpenFor(deps, input.wallet))) return fail("LAUNCH_HOLDER_CLOSED", "Turning the collector on is not open yet.");
    const built = input.action === "grant" ? await venue.buildGrant({ wallet: input.wallet, position: record.position, nftMint: record.nftMint }) : await venue.buildRevoke({ wallet: input.wallet, position: record.position, nftMint: record.nftMint });
    const now = deps.now();
    const build: HolderBuild = {
      id: randomBytes(16).toString("hex"),
      cluster: deps.network.cluster,
      token,
      wallet: input.wallet,
      kind: input.action,
      pool: record.pool,
      position: record.position,
      nftMint: record.nftMint,
      wireBase64: built.wireBase64,
      validUntil: built.validUntil,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + HOLDER_BUILD_TTL_MS).toISOString(),
      input: null,
      amountRaw: null,
      enteredPairRaw: null,
      feeRaw: null,
      granted: input.action === "grant",
    };
    await deps.store.collection<HolderBuild>(BUILDS).insertIfAbsent(key(build.cluster, build.id), build);
    return { ok: true, build: { buildId: build.id, network: deps.network.chain, unsignedWireBase64: built.wireBase64, action: input.action, expiresAt: build.expiresAt } };
  } catch (error) {
    return refused(error);
  }
}

export async function submitHolderPermission(deps: HolderDeps, token: string, input: LaunchHolderPermissionSubmitRequest): Promise<Readonly<{ ok: true; submit: LaunchHolderPermissionSubmitResponse }> | HolderFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const checked = await signedAsBuilt(deps, ["grant", "revoke"], token, input);
  if ("ok" in checked) return checked;
  const { build, tx } = checked;
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") return fail("LAUNCH_SUBMIT_FAILED", sent.reason ?? "The network refused it.");
  return { ok: true, submit: { signature: sent.signature, state: sent.outcome === "CONFIRMED" ? "CONFIRMED" : "PENDING", action: build.kind === "revoke" ? "revoke" : "grant" } };
}

/* ------------------------------------------------------------ «Мої позиції» and the earnings card */

/**
 * Every position this wallet entered through Ryntra, across launches, read from the chain now, and the data the growth
 * module's earnings card draws — what went in, what it is worth, the fees, with the period.
 */
export async function readHolderPositions(deps: HolderDeps, wallet: string): Promise<Readonly<{ ok: true; positions: LaunchHolderPositionsResponse }> | HolderFailure> {
  const venue = venueOf(deps);
  const collector = launchExecutorAddress(deps.network, deps.env ?? process.env);
  try {
    const rows = await positionsOf(deps, wallet, null);
    const pools = new Map<string, HolderPool | null>();
    const views: LaunchHolderPositionsResponse["positions"] = [];
    const cardRows: HolderCardRow[] = [];
    const receipts: string[] = [];
    for (const row of rows) {
      const current = await settled(deps, row).catch(() => row);
      if (!current) continue;
      const launch = await readLaunchRecord(deps, deps.network.cluster, current.token).catch(() => null);
      if (!pools.has(current.pool)) pools.set(current.pool, await venue.pool(current.pool, current.token).catch(() => null));
      const pool = pools.get(current.pool) ?? null;
      const read = pool && current.state === "OPEN" ? await venue.readPosition(pool, current).catch(() => null) : null;
      const claims = await holderClaims(deps, current.position);
      receipts.push(...claims.filter((claim) => claim.state === "CONFIRMED").map((claim) => claim.signature));
      const view = positionView(deps, current, read, claims, pool?.price ?? 0, { token: pool?.tokenDecimals ?? 6, pair: pool?.pairDecimals ?? 6 }, collector);
      const pair = launch ? launchPair(deps.network, launch.preset) : null;
      views.push({ ...view, name: launch?.name ?? null, symbol: launch?.symbol ?? null, pair: pair ? { mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar } : null, tokenDecimals: pool?.tokenDecimals ?? null });
      if (pair) {
        cardRows.push({
          enteredAt: current.enteredAt,
          read: Boolean(view.now) && view.now?.state === "OPEN",
          pair: { mint: pair.mint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
          enteredRaw: current.enteredPairRaw,
          valueRaw: view.now && view.now.state === "OPEN" ? view.now.valuePairRaw : null,
          feesRaw: view.now?.feesPairRaw ?? "0",
          collectedRaw: view.collectedPairRaw,
        });
      }
    }
    const now = deps.now().toISOString();
    return {
      ok: true,
      positions: {
        network: deps.network.chain,
        wallet,
        open: await holderOpenFor(deps, wallet),
        collector,
        positions: views,
        card: mutableCard(holderEarningsCard({ wallet, network: deps.network.chain, rows: cardRows, receipts, now })),
        observedAt: now,
      },
    };
  } catch (error) {
    return refused(error);
  }
}

function mutableCard(card: ReturnType<typeof holderEarningsCard>): LaunchHolderPositionsResponse["card"] {
  return { ...card, period: { ...card.period }, amounts: card.amounts.map((amount) => ({ ...amount })), receipts: [...card.receipts] };
}

/** The data of a holder's earnings card through the core — what the growth module's card draws. */
export async function readHolderEarningsCard(deps: HolderDeps, wallet: string): Promise<LaunchHolderPositionsResponse["card"] | null> {
  const read = await readHolderPositions(deps, wallet);
  return read.ok ? read.positions.card : null;
}

/** Every position entered through Ryntra on this network, for the collector's pass. */
export async function allHolderPositions(store: HolderDeps["store"], cluster: string): Promise<HolderPositionRecord[]> {
  return (await store.collection<HolderPositionRecord>(POSITIONS).valuesWithPrefix(`${cluster}:`)).filter((row) => row.cluster === cluster);
}

/** A position's record as the collector's pass settles a lost entry: open once the chain shows it, gone when it never landed. */
export async function putHolderPosition(store: HolderDeps["store"], record: HolderPositionRecord): Promise<void> {
  await store.collection<HolderPositionRecord>(POSITIONS).set(holderPositionKey(record.cluster, record.wallet, record.position), record);
}

export async function dropHolderPosition(store: HolderDeps["store"], record: HolderPositionRecord): Promise<void> {
  await store.collection<HolderPositionRecord>(POSITIONS).delete(holderPositionKey(record.cluster, record.wallet, record.position));
  /* The collector's pace for it goes with it. */
  await store.collection(HOLDER_CHECKS).delete(`${record.cluster}:${record.position}`);
}

export async function writeHolderClaim(store: HolderDeps["store"], receipt: HolderClaimReceipt): Promise<void> {
  await store.collection<HolderClaimReceipt>(CLAIMS).insertIfAbsent(holderClaimKey(receipt.cluster, receipt.position, receipt.signature), receipt);
}

export async function setHolderClaim(store: HolderDeps["store"], receipt: HolderClaimReceipt): Promise<void> {
  await store.collection<HolderClaimReceipt>(CLAIMS).set(holderClaimKey(receipt.cluster, receipt.position, receipt.signature), receipt);
}

export async function dropHolderClaim(store: HolderDeps["store"], receipt: HolderClaimReceipt): Promise<void> {
  await store.collection<HolderClaimReceipt>(CLAIMS).delete(holderClaimKey(receipt.cluster, receipt.position, receipt.signature));
}
