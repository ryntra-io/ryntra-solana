/**
 * «Комісія за переказ» on the server (SOL-L10): a launch's withheld cycle read from the chain, and the creator's two steps
 * of it built for their wallet alone to sign.
 *
 * The token program keeps a transfer's fee in the receiving account. «Зібрати» (harvest) moves what holders' accounts hold
 * to the mint — the token program lets anyone do it; Ryntra builds it for the creator. «Вивести» (withdraw) moves what the
 * mint holds to the creator's own token account, signed by the mint's withdraw-withheld authority — the creator's wallet,
 * as the launch's config set it (`../core/launch/transfer-fee.ts`). Ryntra signs nothing and takes nothing.
 *
 * A step is one transaction, built once, compared byte for byte with what the wallet signed (its own fee and guard
 * instructions aside) and sent once: a second press finds the build used, and a step with nothing to move is not built —
 * so the same step never acts twice. Each step that landed is kept with its signature: the cycle's «withdrawn» is the
 * sum of the creator's receipts here, every one a transaction anyone can open.
 *
 * Server-only.
 */

import { randomBytes } from "node:crypto";

import { deriveDbcPoolAuthority } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  getAssociatedTokenAddressSync,
  getTransferFeeAmount,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { PublicKey, Transaction, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";

import type { ApiErrorCode, LaunchTransferFeeBuildResponse, LaunchTransferFeeReceipt, LaunchTransferFeeResponse, LaunchTransferFeeStep, LaunchTransferFeeSubmitResponse } from "../api/v1/contract.ts";
import { transferFeeActions, transferFeeTimeline, type MintTransferFee } from "../core/launch/transfer-fee.ts";
import { mintTransferFeeOf } from "../core/venues/meteora-dbc/launch.server.ts";
import { dbcClientOf } from "../core/venues/meteora-clients.server.ts";
import { readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import type { CabinetDeps } from "./creator.server.ts";
import { byDeadline, readLaunchRecord, sendOnce, type LaunchRecord } from "./flow.server.ts";

/** How long a step's bytes may wait for the wallet. */
const BUILD_TTL_MS = 90 * 1000;
const ROUTE_MS = 50_000;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 8_000 } as const;
/** Holders' accounts one harvest names: the most a legacy transaction carries beside the mint and the program. */
export const HARVEST_MAX_ACCOUNTS = 24;
/** Receipts a launch's read lists, the newest first. */
const RECEIPTS_SHOWN = 50;

const BUILDS = "launchTransferFeeBuilds";
const SENDS = "launchTransferFeeSends";
const STEPS = "launchTransferFeeSteps";

export type TransferFeeFailure = Readonly<{ ok: false; code: ApiErrorCode; message: string }>;
const fail = (code: ApiErrorCode, message: string): TransferFeeFailure => ({ ok: false, code, message });
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;
const stepKey = (cluster: string, token: string, signature: string) => `${cluster}:${token}:${signature}`;

type BuildRecord = Readonly<{
  id: string;
  cluster: string;
  token: string;
  wallet: string;
  step: LaunchTransferFeeStep;
  wire: string;
  validUntil: string;
  expectedRaw: string;
  accounts: number;
  createdAt: string;
  expiresAt: string;
}>;

/**
 * A step sent through Ryntra. `settled` — its transaction was read: a withdraw's amount is then what the creator's token
 * account gained in it (0 when the mint held nothing by then); unsettled — sent without an answer, settled on a later read.
 */
type StepRecord = LaunchTransferFeeReceipt & Readonly<{ cluster: string; token: string; wallet: string; settled: boolean }>;

/** A step not seen on chain this long after it was sent never lands: its blockhash is gone. */
const UNSETTLED_DROP_MS = 5 * 60 * 1000;
/** Unsettled steps a read settles at most. */
const SETTLE_PER_READ = 8;

/** A holder's account with something withheld in it. */
type Withheld = Readonly<{ account: PublicKey; raw: bigint }>;

/** The launch's transfer fee as the chain shows it now. */
type Read = Readonly<{
  record: LaunchRecord;
  decimals: number;
  fee: MintTransferFee;
  curveBps: number;
  epoch: bigint;
  migrated: boolean;
  /** Holders' accounts with something withheld, the largest first; null — not read now. */
  withheld: readonly Withheld[] | null;
}>;

async function launchRecordOf(deps: CabinetDeps, token: string): Promise<LaunchRecord | TransferFeeFailure> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return fail("LAUNCH_NOT_FOUND", "No Ryntra launch of this token here.");
  return record;
}

/*
 * The holders' scan is one program-wide read per mint: the public read and the cabinet share it for half a minute, so a
 * page refreshed in a loop does not become a scan in a loop. A build always scans afresh — it names the accounts it moves.
 */
const SCAN_MS = 30_000;
const SCANS = new Map<string, Readonly<{ at: number; value: Promise<readonly Withheld[] | null> }>>();

/** Every Token-2022 account of the mint holding a withheld fee; null when a node will not list them. */
async function withheldAccounts(deps: CabinetDeps, mint: PublicKey, fresh = false): Promise<readonly Withheld[] | null> {
  const key = `${deps.network.cluster}:${mint.toBase58()}`;
  const now = Date.now();
  const cached = SCANS.get(key);
  if (!fresh && cached && now - cached.at < SCAN_MS) return cached.value;
  const value = scanWithheld(deps, mint);
  SCANS.set(key, { at: now, value });
  if (SCANS.size > 500) SCANS.delete(SCANS.keys().next().value!);
  return value;
}

async function scanWithheld(deps: CabinetDeps, mint: PublicKey): Promise<readonly Withheld[] | null> {
  try {
    const accounts = await deps.connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }] });
    const out: Withheld[] = [];
    for (const { pubkey, account } of accounts) {
      try {
        const amount = getTransferFeeAmount(unpackAccount(pubkey, account, TOKEN_2022_PROGRAM_ID));
        if (amount && amount.withheldAmount > 0n) out.push({ account: pubkey, raw: amount.withheldAmount });
      } catch {
        /* Not a token account of this layout: nothing withheld to name. */
      }
    }
    return out.sort((a, b) => (a.raw === b.raw ? 0 : a.raw > b.raw ? -1 : 1));
  } catch {
    return null;
  }
}

async function readTransferFeeState(deps: CabinetDeps, token: string, fresh = false): Promise<Read | TransferFeeFailure> {
  const record = await launchRecordOf(deps, token);
  if ("ok" in record) return record;
  const mintKey = new PublicKey(token);
  const info = await deps.connection.getAccountInfo(mintKey, "confirmed");
  if (!info) return fail("LAUNCH_NOT_FOUND", "The token's mint is not on the network.");
  if (!info.owner.equals(TOKEN_2022_PROGRAM_ID)) return fail("LAUNCH_NO_TRANSFER_FEE", "This token takes no fee on transfers.");
  const mint = unpackMint(mintKey, info, TOKEN_2022_PROGRAM_ID);
  const fee = mintTransferFeeOf(mint);
  if (!fee) return fail("LAUNCH_NO_TRANSFER_FEE", "This token takes no fee on transfers.");
  const [epochInfo, curve, withheld] = await Promise.all([
    deps.connection.getEpochInfo("confirmed"),
    dbcClientOf(deps.connection).state.getPool(new PublicKey(record.pool)),
    withheldAccounts(deps, mintKey, fresh),
  ]);
  const migrated = (curve as unknown as { isMigrated?: number } | null)?.isMigrated === 1;
  /* The rate the launch was made with — its kept terms; the creation wrote it as the older rate, which stays until 0 % applies. */
  const curveBps = record.advanced?.transferFeeBps ?? fee.olderBps;
  return { record, decimals: mint.decimals, fee, curveBps, epoch: BigInt(epochInfo.epoch), migrated, withheld };
}

/**
 * A withdraw's own transaction read: what the wallet's token account of the mint gained in it; null — not read (not found,
 * or no meta yet); `failed` — the network refused it.
 */
async function withdrawnBy(deps: CabinetDeps, step: Pick<StepRecord, "token" | "wallet">, signature: string): Promise<Readonly<{ failed: boolean; movedRaw: string }> | null> {
  const tx = await deps.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!tx?.meta) return null;
  if (tx.meta.err) return { failed: true, movedRaw: "0" };
  type Balances = readonly Readonly<{ mint: string; owner?: string; uiTokenAmount: Readonly<{ amount: string }> }>[] | null | undefined;
  const balance = (list: Balances) => (list ?? []).filter((entry) => entry.mint === step.token && entry.owner === step.wallet).reduce((sum, entry) => sum + BigInt(entry.uiTokenAmount.amount), 0n);
  const moved = balance(tx.meta.postTokenBalances) - balance(tx.meta.preTokenBalances);
  return { failed: false, movedRaw: (moved > 0n ? moved : 0n).toString() };
}

/** The launch's steps, the newest first — the unsettled ones read from the chain first: settled, dropped, or left for later. */
async function receiptsOf(deps: CabinetDeps, token: string): Promise<readonly StepRecord[]> {
  const collection = deps.store.collection<StepRecord>(STEPS);
  const steps = [...(await collection.valuesWithPrefix(`${deps.network.cluster}:${token}:`))];
  const now = deps.now().getTime();
  for (const step of steps.filter((entry) => !entry.settled).slice(0, SETTLE_PER_READ)) {
    const key = stepKey(step.cluster, step.token, step.signature);
    /* The chain's word on the signature: undefined — the node did not answer, nothing is decided on it. */
    const status = await deps.connection
      .getSignatureStatuses([step.signature], { searchTransactionHistory: true })
      .then((answer) => answer.value[0] ?? null)
      .catch(() => undefined);
    if (status === undefined) continue;
    const landed = status !== null && status.err === null && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");
    /* A withdraw counts what its transaction moved; a harvest that landed keeps what its accounts held at the build. */
    const read = !landed ? null : step.step === "WITHDRAW" ? await withdrawnBy(deps, step, step.signature) : { failed: false, movedRaw: step.amountRaw };
    const gone = status === null && now - Date.parse(step.at) > UNSETTLED_DROP_MS;
    if (status?.err || read?.failed || gone) {
      await collection.delete(key);
      steps.splice(steps.indexOf(step), 1);
    } else if (read) {
      const settled = { ...step, amountRaw: read.movedRaw, settled: true };
      await collection.set(key, settled);
      steps.splice(steps.indexOf(step), 1, settled);
    }
  }
  return steps.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** `GET /api/v1/launch/{mint}/transfer-fee`: the rate, the timeline by epoch and the withheld cycle with its receipts. */
export async function readLaunchTransferFee(deps: CabinetDeps, token: string): Promise<Readonly<{ ok: true; view: LaunchTransferFeeResponse }> | TransferFeeFailure> {
  const read = await readTransferFeeState(deps, token);
  if ("ok" in read) return read;
  const timeline = transferFeeTimeline(read.fee, { curveBps: read.curveBps, epoch: read.epoch, migrated: read.migrated, poolAuthority: deriveDbcPoolAuthority().toBase58() });
  const receipts = await receiptsOf(deps, token);
  /* Withdrawn is what the withdraw authority's own receipts moved; any other wallet's step is not the creator's. */
  const withdrawn = receipts.filter((step) => step.step === "WITHDRAW" && step.settled && step.wallet === read.fee.withdrawAuthority).reduce((sum, step) => sum + BigInt(step.amountRaw), 0n);
  const cycle = {
    inAccountsRaw: read.withheld === null ? null : read.withheld.reduce((sum, entry) => sum + entry.raw, 0n).toString(),
    accountsWithWithheld: read.withheld === null ? null : read.withheld.length,
    onMintRaw: read.fee.withheldOnMintRaw,
    withdrawnRaw: withdrawn.toString(),
  };
  return {
    ok: true,
    view: {
      network: deps.network.chain,
      token,
      decimals: read.decimals,
      bps: read.curveBps,
      mode: "REVOKE_ZERO_FEE",
      withdrawAuthority: read.fee.withdrawAuthority,
      timeline: { ...timeline, epoch: read.epoch.toString() },
      cycle,
      actions: transferFeeActions(cycle),
      /* What landed: a withdraw by its own transaction; a harvest with the accounts it named and what they held at its build. */
      receipts: receipts
        .filter((step) => step.settled)
        .slice(0, RECEIPTS_SHOWN)
        .map(({ step, signature, amountRaw, accounts, at }) => ({ step, signature, amountRaw, accounts, at })),
      observedAt: deps.now().toISOString(),
    },
  };
}

/** What the wallet's balance loses when the network simulates the step; null when it would not say. */
async function walletSpend(deps: CabinetDeps, tx: Transaction, wallet: PublicKey): Promise<string | null> {
  try {
    const before = BigInt(await deps.connection.getBalance(wallet, "confirmed"));
    const simulated = await deps.connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [wallet.toBase58()] },
    });
    const after = simulated.value.accounts?.[0]?.lamports;
    if (simulated.value.err || after === undefined || after === null) return null;
    return (before - BigInt(after)).toString();
  } catch {
    return null;
  }
}

/** One step of the cycle for the creator's wallet: harvest the holders' accounts to the mint, or withdraw the mint to the wallet. */
export async function buildLaunchTransferFeeStep(
  deps: CabinetDeps,
  token: string,
  input: Readonly<{ wallet: string; step: LaunchTransferFeeStep }>,
): Promise<Readonly<{ ok: true; build: LaunchTransferFeeBuildResponse }> | TransferFeeFailure> {
  const read = await readTransferFeeState(deps, token, true);
  if ("ok" in read) return read;
  /* The creator's cabinet: the wallet that withdraws what is withheld takes both steps. */
  if (read.fee.withdrawAuthority !== input.wallet) return fail("WALLET_MISMATCH", "Only the creator's wallet collects this token's transfer fee.");
  const mint = new PublicKey(token);
  const wallet = new PublicKey(input.wallet);
  let instructions: TransactionInstruction[];
  let expected: bigint;
  let accounts = 0;
  if (input.step === "HARVEST") {
    if (read.withheld === null) return fail("UNAVAILABLE", "The holders' accounts could not be read now; nothing was built. Try again.");
    const sources = read.withheld.slice(0, HARVEST_MAX_ACCOUNTS);
    if (sources.length === 0) return fail("LAUNCH_NOTHING_TO_CLAIM", "Nothing is withheld in holders' accounts now.");
    instructions = [createHarvestWithheldTokensToMintInstruction(mint, sources.map((source) => source.account), TOKEN_2022_PROGRAM_ID)];
    expected = sources.reduce((sum, source) => sum + source.raw, 0n);
    accounts = sources.length;
  } else {
    expected = BigInt(read.fee.withheldOnMintRaw);
    if (expected <= 0n) return fail("LAUNCH_NOTHING_TO_CLAIM", "The mint holds nothing withheld now; collect it from holders' accounts first.");
    const destination = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID);
    instructions = [
      createAssociatedTokenAccountIdempotentInstruction(wallet, destination, wallet, mint, TOKEN_2022_PROGRAM_ID),
      createWithdrawWithheldTokensFromMintInstruction(mint, destination, wallet, [], TOKEN_2022_PROGRAM_ID),
    ];
  }
  const latest = await deps.connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: wallet, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(...instructions);
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  const [cost, windows] = await Promise.all([walletSpend(deps, tx, wallet), readBuildWindows(web3ChainReader(deps.connection), String(latest.lastValidBlockHeight), { capMs: BUILD_TTL_MS })]);
  const now = deps.now();
  const record: BuildRecord = {
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    token,
    wallet: input.wallet,
    step: input.step,
    wire,
    validUntil: String(latest.lastValidBlockHeight),
    expectedRaw: expected.toString(),
    accounts,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + windows.lifeMs).toISOString(),
  };
  await deps.store.collection<BuildRecord>(BUILDS).insertIfAbsent(buildKey(record.cluster, record.id), record);
  return {
    ok: true,
    build: {
      buildId: record.id,
      network: deps.network.chain,
      step: record.step,
      unsignedWireBase64: wire,
      expectedRaw: record.expectedRaw,
      accounts,
      networkCostLamports: cost,
      expiresAt: record.expiresAt,
      signableMs: windows.signableMs,
    },
  };
}


export async function submitLaunchTransferFeeStep(
  deps: CabinetDeps,
  token: string,
  input: Readonly<{ buildId: string; wallet: string; signedWireBase64: string }>,
): Promise<Readonly<{ ok: true; submit: LaunchTransferFeeSubmitResponse }> | TransferFeeFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await deps.store.collection<BuildRecord>(BUILDS).get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.token !== token) return fail("LAUNCH_NOT_FOUND", "This step was not built here.");
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", "This step was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("LAUNCH_BUILD_EXPIRED", "The step waited too long for the signature; prepare it again.");
  const verdict = compareWalletTransaction({ expectedWireBase64: build.wire, actualWireBase64: input.signedWireBase64, guardPolicy: "BOUNDED" });
  if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(input.signedWireBase64, "base64"));
  } catch {
    return fail("LAUNCH_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (!tx.verifySignatures(true)) return fail("LAUNCH_SIGNED_OTHER_BYTES", "A signature is missing or does not match the transaction.");
  /* One send per build: a second press of the button finds it used. */
  if (!(await deps.store.collection<Readonly<{ at: string }>>(SENDS).insertIfAbsent(buildKey(build.cluster, build.id), { at: deps.now().toISOString() }))) {
    return fail("LAUNCH_BUILD_USED", "This step was already sent.");
  }
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline }, { second: deps.second });
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") return fail("LAUNCH_SUBMIT_FAILED", sent.reason ?? "The network refused the step.");
  const steps = deps.store.collection<StepRecord>(STEPS);
  const base = { step: build.step, signature: sent.signature, accounts: build.step === "HARVEST" ? build.accounts : null, at: deps.now().toISOString(), cluster: build.cluster, token, wallet: build.wallet };
  /* Sent without an answer: kept unsettled, so a later read counts it once it lands — or drops it once it cannot. */
  if (sent.outcome === "UNKNOWN") {
    await steps.insertIfAbsent(stepKey(build.cluster, token, sent.signature), { ...base, amountRaw: build.step === "HARVEST" ? build.expectedRaw : "0", settled: false });
    return { ok: true, submit: { step: build.step, state: "PENDING", signature: sent.signature, receipt: null } };
  }
  /* A withdraw counts what its own transaction moved — 0 when the mint held nothing by then; a harvest, what its accounts held at the build. */
  const read = build.step === "WITHDRAW" ? await byDeadline(() => withdrawnBy(deps, { token, wallet: build.wallet }, sent.signature), deadline, deps.now, null) : { failed: false, movedRaw: build.expectedRaw };
  const record: StepRecord = { ...base, amountRaw: read?.movedRaw ?? "0", settled: read !== null };
  await steps.insertIfAbsent(stepKey(build.cluster, token, sent.signature), record);
  const receipt: LaunchTransferFeeReceipt = { step: record.step, signature: record.signature, amountRaw: record.amountRaw, accounts: record.accounts, at: record.at };
  return { ok: true, submit: { step: build.step, state: "CONFIRMED", signature: sent.signature, receipt: record.settled ? receipt : null } };
}
