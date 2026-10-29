/**
 * The spending limits' build, submit and state (SOL-7): the routes' whole logic. A build checks the request against the
 * chain's own state and the rules of `model.ts`, makes one transaction for the person's wallet, keeps its unsigned
 * bytes and answers them with a Review; a submit takes the signed bytes, compares them with the kept ones (the wallet
 * may add only its own fee and guard instructions) and sends them once. A state read says, for every limit the wallet
 * gave or was given, who may take what now — and «unknown» wherever a read failed.
 *
 * Served only where the deployment names the network (`NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK`): devnet first; mainnet
 * is the operator's canary. The server signs nothing.
 */

import { randomBytes } from "node:crypto";
import { getBase58Decoder } from "@solana/kit";
import { getSubscriptionsErrorMessage, type SubscriptionsError } from "@solana/subscriptions";
import { Connection, PublicKey, Transaction, type AccountInfo, type TransactionInstruction } from "@solana/web3.js";

import { getGuardRuntime } from "../../guard/runtime.ts";
import { storeSupportsConcurrentInstances, type GuardStore } from "../../guard/store.ts";
import { EXPIRY_MARGIN_BLOCKS, readSignature, sendOnce } from "../../launch/flow.server.ts";
import { readBuildWindows, web3ChainReader } from "../blockhash-life.ts";
import { resolveEndpoint } from "../rpc.ts";
import { compareWalletTransaction } from "../wallet-modification.ts";
import type {
  AllowanceBuildRequest,
  AllowanceBuildResponse,
  AllowanceInfo,
  AllowanceReview,
  AllowanceRow,
  AllowanceSendStatus,
  AllowanceSentState,
  AllowanceState,
  AllowanceSubmitRequest,
  AllowanceSubmitResponse,
  PlanView,
} from "./contract.ts";
import {
  ALLOWANCE_CHAIN,
  ACCOUNT_BYTES,
  PERIODS,
  TERMINAL,
  SUBSCRIPTIONS_PROGRAM,
  TOKEN_PROGRAM,
  allowanceNetworkFrom,
  allowanceNow,
  periodNow,
  delegatorActions,
  limitIssues,
  rentExemptLamports,
  rentOf,
  usdcMint,
  type AllowanceIssue,
  type AllowanceNetwork,
  type AuthorityRead,
  type DelegationRead,
  type PeriodId,
  type PlanRead,
  type TokenAccountRead,
} from "./model.ts";
import {
  AllowanceRefusal,
  authorityAddress,
  cancelIx,
  closeAuthorityIx,
  closeSubscriptionIx,
  createFixedIx,
  createRecurringIx,
  decodeAuthority,
  decodeDelegation,
  decodeMint,
  decodePlan,
  decodeTokenAccount,
  initAuthorityIx,
  openTokenAccountIx,
  readDelegations,
  readFixedOriginal,
  readMany,
  resolveReceiver,
  revokeIx,
  stopAllIx,
  subscribeIx,
  subscriptionAddress,
  tokenAccountAddress,
  transferIx,
  type MintRead,
} from "./program.server.ts";

export type AllowanceDeps = Readonly<{
  network: AllowanceNetwork;
  connection: Connection;
  store: GuardStore;
  now: () => Date;
  /** A new limit's nonce; random, so two limits to one delegatee never share an address. */
  nonce?: () => bigint;
}>;

export function allowanceNetwork(env: Readonly<Record<string, string | undefined>> = process.env): AllowanceNetwork | null {
  return allowanceNetworkFrom(env.NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK);
}

let cached: { url: string; connection: Connection } | null = null;

/**
 * What the routes need, or null where the limits are not served: no network named, or a deployment whose store is not
 * one every instance shares (a build kept on one instance must be found by the submit on another).
 */
export function allowanceDeps(): AllowanceDeps | null {
  const network = allowanceNetwork();
  if (!network) return null;
  const store = getGuardRuntime().store;
  if (process.env.VERCEL && !storeSupportsConcurrentInstances(store)) return null;
  const url = resolveEndpoint(network);
  if (!cached || cached.url !== url) cached = { url, connection: new Connection(url, "confirmed") };
  return { network, connection: cached.connection, store, now: () => new Date() };
}

export type AllowanceFailure = Readonly<{ ok: false; code: string; message: string; issues?: readonly AllowanceIssue[] }>;
const fail = (code: string, message: string, issues?: readonly AllowanceIssue[]): AllowanceFailure => ({ ok: false, code, message, ...(issues?.length ? { issues } : {}) });

type BuildRecord = Readonly<{
  id: string;
  network: AllowanceNetwork;
  wallet: string;
  kind: AllowanceBuildRequest["kind"];
  delegation: string | null;
  wire: string;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;
/** The one send of a build, kept before the bytes go out: its signature is what a read after a lost answer asks for. */
type SendRecord = Readonly<{ network: AllowanceNetwork; id: string; at: string; signature: string; /** The chain's final word once known; absent — not known yet. */ outcome?: "CONFIRMED" | "FAILED" | "NOT_LANDED" }>;

const BUILDS = "solanaAllowanceBuilds" as const;
const SENDS = "solanaAllowanceSends" as const;
const buildKey = (network: AllowanceNetwork, id: string) => `${network}:${id}`;
/** How long a build may wait for its signature at most; the blockhash usually decides first. */
const BUILD_TTL_MS = 90_000;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 4_000 } as const;
const SUBMIT_ROUTE_MS = 52_000;
const SIGNATURE_FEE_LAMPORTS = 5_000n;
/** Rows a list answers at most; a merchant with thousands is not this page's reader. */
const MAX_ROWS = 100;
/** Fixed limits whose original amount is read from their history per list. */
const MAX_ORIGINALS = 10;

const seconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000));

/** Builds an hour past their expiry are removed: anyone may ask for a build, nobody can fill the store with them. */
async function sweep(deps: AllowanceDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  const builds = deps.store.collection<BuildRecord>(BUILDS);
  for (const build of await builds.valuesWithPrefix(`${deps.network}:`)) if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.network, build.id));
  /* A send outlives its build by an hour: a read of a build that is gone says «not found», never «not landed». */
  const sends = deps.store.collection<SendRecord>(SENDS);
  for (const send of await sends.valuesWithPrefix(`${deps.network}:`)) if (Date.parse(send.at) < stale - 60 * 60 * 1000) await sends.delete(buildKey(send.network, send.id));
}

export function allowanceInfo(deps: AllowanceDeps): AllowanceInfo {
  return { network: ALLOWANCE_CHAIN[deps.network], program: SUBSCRIPTIONS_PROGRAM, usdcMint: usdcMint(deps.network) };
}

/* ─── Reading ──────────────────────────────────────────────────────────────── */

type Holder = Readonly<{ authority: AuthorityRead; tokenAccount: TokenAccountRead }>;

/** A delegator's authority and token account for each mint, read in one go; a failed read leaves both «unread». */
async function readHolders(connection: Connection, pairs: readonly Readonly<{ delegator: string; mint: string }>[], mints: ReadonlyMap<string, MintRead | null>): Promise<Map<string, Holder>> {
  const out = new Map<string, Holder>();
  const named = await Promise.all(
    pairs.map(async (pair) => {
      const mint = mints.get(pair.mint);
      return { ...pair, authority: await authorityAddress(pair.delegator, pair.mint), tokenAccount: mint ? tokenAccountAddress(pair.delegator, pair.mint, mint.program) : null };
    }),
  );
  let infos: Map<string, AccountInfo<Buffer> | null> | null = null;
  try {
    infos = await readMany(connection, named.flatMap((entry) => [entry.authority, ...(entry.tokenAccount ? [entry.tokenAccount] : [])]));
  } catch {
    infos = null;
  }
  for (const entry of named) {
    const id = `${entry.delegator}:${entry.mint}`;
    if (!infos || !entry.tokenAccount) {
      out.set(id, { authority: { state: "unread" }, tokenAccount: { state: "unread" } });
      continue;
    }
    let authority: AuthorityRead;
    try {
      authority = decodeAuthority(entry.authority, infos.get(entry.authority) ?? null);
    } catch {
      authority = { state: "unread" };
    }
    out.set(id, { authority, tokenAccount: decodeTokenAccount(entry.tokenAccount, infos.get(entry.tokenAccount) ?? null, entry.mint, entry.delegator) });
  }
  return out;
}

type Rowed = Readonly<{ delegation: DelegationRead; plan: PlanRead; mint: string | null; holder: Holder }>;

/** Plans, mints, authorities and token accounts behind a list of limits; every failure is carried as «unread». */
async function readBehind(connection: Connection, delegations: readonly DelegationRead[], extraMints: readonly string[] = []): Promise<Readonly<{ rows: Rowed[]; mints: Map<string, MintRead | null> }>> {
  const planAddresses = delegations.filter((row) => row.kind === "subscription").map((row) => row.header.delegatee);
  const plans = new Map<string, PlanRead>();
  try {
    const infos = await readMany(connection, planAddresses);
    for (const address of planAddresses) plans.set(address, decodePlan(address, infos.get(address) ?? null));
  } catch {
    for (const address of planAddresses) plans.set(address, { state: "unread" });
  }
  const mintOf = (row: DelegationRead): string | null => {
    if (row.kind !== "subscription") return row.mint;
    const plan = plans.get(row.header.delegatee);
    return plan?.state === "present" ? plan.mint : null;
  };
  const mintAddresses = [...new Set([...extraMints, ...delegations.map(mintOf).filter((mint): mint is string => mint !== null)])];
  const mints = new Map<string, MintRead | null>();
  try {
    const infos = await readMany(connection, mintAddresses);
    for (const mint of mintAddresses) mints.set(mint, decodeMint(mint, infos.get(mint) ?? null));
  } catch {
    for (const mint of mintAddresses) mints.set(mint, null);
  }
  const pairs = new Map<string, { delegator: string; mint: string }>();
  for (const row of delegations) {
    const mint = mintOf(row);
    if (mint) pairs.set(`${row.header.delegator}:${mint}`, { delegator: row.header.delegator, mint });
  }
  const holders = await readHolders(connection, [...pairs.values()], mints);
  const unread: Holder = { authority: { state: "unread" }, tokenAccount: { state: "unread" } };
  return {
    mints,
    rows: delegations.map((delegation) => {
      const mint = mintOf(delegation);
      const plan: PlanRead = delegation.kind === "subscription" ? (plans.get(delegation.header.delegatee) ?? { state: "unread" }) : { state: "absent" };
      return { delegation, plan, mint, holder: (mint && holders.get(`${delegation.header.delegator}:${mint}`)) || unread };
    }),
  };
}

const STATUS_ORDER = ["active", "cancelled", "scheduled", "blocked", "unknown", "stopped", "spent", "expired", "ended"] as const;

function toRow(rowed: Rowed, args: Readonly<{ network: AllowanceNetwork; now: bigint; side: "given" | "received"; originals: ReadonlyMap<string, bigint | null>; mints: ReadonlyMap<string, MintRead | null> }>): AllowanceRow {
  const { delegation, plan, mint, holder } = rowed;
  const now = allowanceNow(delegation, { ...holder, plan, now: args.now });
  const usdc = mint === usdcMint(args.network);
  const original = delegation.kind === "fixed" ? (args.originals.get(delegation.address) ?? null) : null;
  const amountRaw = delegation.kind === "fixed" ? delegation.remainingRaw : delegation.kind === "recurring" ? delegation.perPeriodRaw : delegation.amountRaw;
  const spentRaw = delegation.kind === "fixed" ? (original !== null && original >= delegation.remainingRaw ? original - delegation.remainingRaw : null) : now.spentInPeriodRaw;
  const periodSeconds = delegation.kind === "recurring" ? Number(delegation.periodSeconds) : delegation.kind === "subscription" ? Number(delegation.periodHours) * 3_600 : null;
  const actions: AllowanceRow["actions"] =
    args.side === "given" ? delegatorActions(delegation, now, args.now) : delegation.kind !== "subscription" && usdc && now.status === "active" && (now.availableRaw ?? 0n) > 0n ? ["spend"] : [];
  return {
    address: delegation.address,
    kind: delegation.kind,
    asset: usdc ? "USDC" : "OTHER",
    mint,
    decimals: mint ? (args.mints.get(mint)?.decimals ?? null) : null,
    delegator: delegation.header.delegator,
    delegatee: delegation.kind === "subscription" ? (plan.state === "present" ? plan.owner : null) : delegation.header.delegatee,
    plan: delegation.kind === "subscription" ? delegation.header.delegatee : null,
    amountRaw: amountRaw.toString(),
    originalRaw: original === null ? null : original.toString(),
    spentRaw: spentRaw === null ? null : spentRaw.toString(),
    availableRaw: now.availableRaw === null ? null : now.availableRaw.toString(),
    periodSeconds,
    periodEndsAt: now.periodEndsAt === null ? null : now.periodEndsAt.toString(),
    endsAt: now.endsAt.toString(),
    status: now.status,
    blockedBy: now.blockedBy,
    actions,
  };
}

async function originalsOf(connection: Connection, delegations: readonly DelegationRead[]): Promise<Map<string, bigint | null>> {
  const fixed = delegations.filter((row) => row.kind === "fixed").slice(0, MAX_ORIGINALS);
  const entries = await Promise.all(fixed.map(async (row) => [row.address, await readFixedOriginal(connection, row.address, row.expiryTs).catch(() => null)] as const));
  return new Map(entries);
}

export async function allowanceState(deps: AllowanceDeps, wallet: string): Promise<Readonly<{ ok: true; state: AllowanceState }> | AllowanceFailure> {
  const now = seconds(deps.now());
  const mint = usdcMint(deps.network);
  const [given, received] = await Promise.all([
    readDelegations(deps.connection, "delegator", wallet).catch(() => null),
    readDelegations(deps.connection, "delegatee", wallet).catch(() => null),
  ]);
  const givenList = (given ?? []).slice(0, MAX_ROWS);
  const receivedList = (received ?? []).filter((row) => row.kind !== "subscription").slice(0, MAX_ROWS);
  const [behindGiven, behindReceived, originals] = await Promise.all([
    readBehind(deps.connection, givenList, [mint]),
    readBehind(deps.connection, receivedList),
    originalsOf(deps.connection, [...givenList, ...receivedList]),
  ]);
  const order = (row: AllowanceRow) => STATUS_ORDER.indexOf(row.status);
  const sort = (rows: AllowanceRow[]) => rows.sort((a, b) => order(a) - order(b) || Number(BigInt(b.endsAt) - BigInt(a.endsAt)));
  const own = (await readHolders(deps.connection, [{ delegator: wallet, mint }], new Map([[mint, { address: mint, program: TOKEN_PROGRAM, decimals: 6 }]]))).get(`${wallet}:${mint}`)!;
  const authority = await authorityAddress(wallet, mint);
  const tokenAccount = tokenAccountAddress(wallet, mint);
  return {
    ok: true,
    state: {
      network: ALLOWANCE_CHAIN[deps.network],
      wallet,
      usdc: {
        mint,
        tokenAccount,
        balanceRaw: own.tokenAccount.state === "present" ? own.tokenAccount.balanceRaw.toString() : own.tokenAccount.state === "absent" ? "0" : null,
        hasAccount: own.tokenAccount.state === "unread" ? null : own.tokenAccount.state === "present",
        delegate: own.tokenAccount.state === "present" ? own.tokenAccount.delegate : null,
        delegatedRaw: own.tokenAccount.state === "present" ? own.tokenAccount.delegatedRaw.toString() : null,
        frozen: own.tokenAccount.state === "present" ? own.tokenAccount.frozen : null,
        authority,
        authorityOpen: own.authority.state === "unread" ? null : own.authority.state === "present",
      },
      given: sort(behindGiven.rows.map((row) => toRow(row, { network: deps.network, now, side: "given", originals, mints: behindGiven.mints }))),
      received: sort(behindReceived.rows.map((row) => toRow(row, { network: deps.network, now, side: "received", originals, mints: behindReceived.mints }))),
      givenUnread: given === null,
      receivedUnread: received === null,
      readAt: deps.now().toISOString(),
    },
  };
}

/* ─── Building ─────────────────────────────────────────────────────────────── */

type Planned = Readonly<{ instructions: readonly TransactionInstruction[]; review: AllowanceReview }>;

const emptyReview = (kind: AllowanceBuildRequest["kind"]): AllowanceReview => ({
  kind,
  asset: "USDC",
  revokes: null,
  delegation: null,
  counterparty: null,
  amountRaw: null,
  periodSeconds: null,
  endsAt: null,
  plan: null,
  approves: null,
  replacesDelegate: null,
  rentLamports: "0",
  refundLamports: "0",
  stops: null,
  grace: null,
  graceUnknown: false,
  remainsDelegate: null,
  closesOnly: false,
  to: null,
  opensTokenAccount: false,
});

/** The wallet's USDC authority and token account, read now: a build never guesses either. */
async function ownHolder(deps: AllowanceDeps, wallet: string): Promise<Holder & Readonly<{ authorityAddress: string; tokenAccountAddress: string }>> {
  const mint = usdcMint(deps.network);
  const authority = await authorityAddress(wallet, mint);
  const tokenAccount = tokenAccountAddress(wallet, mint);
  const infos = await readMany(deps.connection, [authority, tokenAccount]);
  return {
    authority: decodeAuthority(authority, infos.get(authority) ?? null),
    tokenAccount: decodeTokenAccount(tokenAccount, infos.get(tokenAccount) ?? null, mint, wallet),
    authorityAddress: authority,
    tokenAccountAddress: tokenAccount,
  };
}

/**
 * The approval a new limit needs: the authority opened with the token's approval (its first limit), or the approval
 * given again when another app replaced it — the Review says which, and whose approval it replaces.
 */
async function approval(deps: AllowanceDeps, wallet: string): Promise<Readonly<{ instructions: TransactionInstruction[]; approves: AllowanceReview["approves"]; replacesDelegate: string | null; initId: bigint | null; rent: bigint }> | AllowanceFailure> {
  const own = await ownHolder(deps, wallet);
  if (own.tokenAccount.state !== "present") return fail("ALLOWANCE_NO_TOKEN_ACCOUNT", "This wallet has no USDC account yet; receive USDC first.");
  if (own.tokenAccount.frozen) return fail("ALLOWANCE_TOKEN_FROZEN", "This wallet's USDC account is frozen.");
  const mint = usdcMint(deps.network);
  const init = () => initAuthorityIx({ wallet, mint, tokenAccount: own.tokenAccountAddress });
  const other = own.tokenAccount.delegate && own.tokenAccount.delegate !== own.authorityAddress ? own.tokenAccount.delegate : null;
  if (own.authority.state === "absent") return { instructions: [await init()], approves: "first", replacesDelegate: other, initId: null, rent: rentExemptLamports(ACCOUNT_BYTES.authority) };
  if (own.authority.state !== "present") return fail("UNAVAILABLE", "The token's authority could not be read.");
  const approved = own.tokenAccount.delegate === own.authorityAddress && own.tokenAccount.delegatedRaw > 0n;
  return approved
    ? { instructions: [], approves: null, replacesDelegate: null, initId: own.authority.initId, rent: 0n }
    : { instructions: [await init()], approves: "again", replacesDelegate: other, initId: own.authority.initId, rent: 0n };
}

async function readOne(deps: AllowanceDeps, address: string): Promise<Readonly<{ delegation: DelegationRead; lamports: bigint }> | null> {
  const infos = await readMany(deps.connection, [address]);
  const info = infos.get(address) ?? null;
  if (!info || info.owner.toBase58() !== SUBSCRIPTIONS_PROGRAM) return null;
  const delegation = decodeDelegation(address, info.data);
  return delegation ? { delegation, lamports: BigInt(info.lamports) } : null;
}

function planView(plan: Extract<PlanRead, { state: "present" }>): PlanView {
  return {
    address: plan.address,
    merchant: plan.owner,
    planId: plan.planId.toString(),
    amountRaw: plan.amountRaw.toString(),
    periodHours: plan.periodHours.toString(),
    endTs: plan.endTs.toString(),
    destinations: plan.destinations,
    pullers: plan.pullers,
  };
}

const randomNonce = () => BigInt(`0x${randomBytes(6).toString("hex")}`);

async function plan(deps: AllowanceDeps, request: AllowanceBuildRequest): Promise<Planned | AllowanceFailure> {
  const now = seconds(deps.now());
  const mint = usdcMint(deps.network);
  const wallet = request.wallet;

  switch (request.kind) {
    case "fixed":
    case "recurring": {
      const period = request.kind === "recurring" ? (request.period as PeriodId) : null;
      const issues = limitIssues({ kind: request.kind, wallet, delegatee: request.delegatee, amountRaw: BigInt(request.amountRaw), termSeconds: request.termSeconds, period });
      if (issues.length) return fail("VALIDATION_ERROR", "The limit is not complete.", issues);
      const approve = await approval(deps, wallet);
      if ("ok" in approve) return approve;
      const own = await authorityAddress(wallet, mint);
      if (request.delegatee === own) return fail("VALIDATION_ERROR", "The token's own authority cannot be a delegatee.", [{ code: "DELEGATEE_ADDRESS", at: request.delegatee }]);
      const expiryTs = now + BigInt(request.termSeconds);
      const nonce = (deps.nonce ?? randomNonce)();
      const built =
        request.kind === "fixed"
          ? await createFixedIx({ wallet, delegatee: request.delegatee, mint, nonce, amountRaw: BigInt(request.amountRaw), expiryTs, initId: approve.initId })
          : await createRecurringIx({ wallet, delegatee: request.delegatee, mint, nonce, perPeriodRaw: BigInt(request.amountRaw), periodSeconds: BigInt(PERIODS[period!]), expiryTs, initId: approve.initId });
      return {
        instructions: [...approve.instructions, built.instruction],
        review: {
          ...emptyReview(request.kind),
          delegation: built.delegation,
          counterparty: request.delegatee,
          amountRaw: request.amountRaw,
          periodSeconds: period ? PERIODS[period] : null,
          endsAt: expiryTs.toString(),
          approves: approve.approves,
          replacesDelegate: approve.replacesDelegate,
          rentLamports: (approve.rent + rentOf(request.kind)).toString(),
        },
      };
    }
    case "subscribe": {
      const infos = await readMany(deps.connection, [request.plan]);
      const read = decodePlan(request.plan, infos.get(request.plan) ?? null);
      if (read.state !== "present") return fail("ALLOWANCE_PLAN_NOT_FOUND", "No plan of the Subscriptions program at this address on this network.");
      if (read.mint !== mint) return fail("ALLOWANCE_PLAN_ASSET", "This plan is not paid in USDC.");
      if (!read.active) return fail("ALLOWANCE_PLAN_SUNSET", "This plan takes no new subscribers.");
      if (read.endTs !== 0n && now > read.endTs) return fail("ALLOWANCE_PLAN_ENDED", "This plan has ended.");
      if (read.owner === wallet) return fail("ALLOWANCE_PLAN_OWN", "This is this wallet's own plan.");
      const subscription = await subscriptionAddress(request.plan, wallet);
      if ((await readMany(deps.connection, [subscription])).get(subscription)) return fail("ALLOWANCE_ALREADY_SUBSCRIBED", "This wallet already has a subscription to this plan; close the old one first.");
      const approve = await approval(deps, wallet);
      if ("ok" in approve) return approve;
      return {
        instructions: [...approve.instructions, await subscribeIx({ wallet, plan: read, initId: approve.initId })],
        review: {
          ...emptyReview("subscribe"),
          delegation: subscription,
          counterparty: read.owner,
          amountRaw: read.amountRaw.toString(),
          periodSeconds: Number(read.periodHours) * 3_600,
          endsAt: read.endTs.toString(),
          plan: planView(read),
          approves: approve.approves,
          replacesDelegate: approve.replacesDelegate,
          rentLamports: (approve.rent + rentOf("subscription")).toString(),
        },
      };
    }
    case "revoke": {
      const read = await readOne(deps, request.delegation);
      if (!read) return fail("ALLOWANCE_NOT_FOUND", "No limit at this address on this network.");
      const delegation = read.delegation;
      if (delegation.header.delegator !== wallet) return fail("ALLOWANCE_NOT_YOURS", "This limit was not given by this wallet.");
      /* The account's own lamports go back to whoever paid its rent: to this wallet only when it paid. */
      const refund = delegation.header.payer === wallet ? read.lamports.toString() : "0";
      if (delegation.kind !== "subscription") {
        const behind = await readBehind(deps.connection, [delegation]);
        const status = allowanceNow(delegation, { ...behind.rows[0]!.holder, now }).status;
        return {
          instructions: [revokeIx({ wallet, delegation: delegation.address, payer: delegation.header.payer })],
          review: { ...emptyReview("revoke"), revokes: TERMINAL.has(status) || status === "stopped" ? "close" : "limit", delegation: delegation.address, counterparty: delegation.header.delegatee, refundLamports: refund },
        };
      }
      const planAddress = delegation.header.delegatee;
      if (delegation.expiresAtTs !== 0n) {
        if (now < delegation.expiresAtTs) return fail("ALLOWANCE_ALREADY_CANCELLED", `Already cancelled; it can be closed after ${new Date(Number(delegation.expiresAtTs) * 1000).toISOString()}.`);
        return {
          instructions: [closeSubscriptionIx({ wallet, plan: planAddress, subscription: delegation.address, payer: delegation.header.payer })],
          review: { ...emptyReview("revoke"), revokes: "close", delegation: delegation.address, refundLamports: refund },
        };
      }
      /* Cancel: no charge after this period. What the merchant may still take of it is said, with its last moment. */
      const behind = await readBehind(deps.connection, [delegation]);
      const row = behind.rows[0]!;
      const left = allowanceNow(delegation, { ...row.holder, plan: row.plan, now });
      const planRead = row.plan;
      const ghost = planRead.state === "absent" || (planRead.state === "present" && (planRead.amountRaw !== delegation.amountRaw || planRead.periodHours !== delegation.periodHours || planRead.createdAt !== delegation.createdAt));
      /* The program's own end of a cancelled subscription: the current period's end, capped one second past the plan's. */
      const period = periodNow(delegation.periodStartTs, delegation.periodHours * 3_600n, delegation.pulledInPeriodRaw, planRead.state === "present" ? planRead.endTs : 0n, now);
      let until = period.startTs + delegation.periodHours * 3_600n;
      if (planRead.state === "present" && planRead.endTs !== 0n && until > planRead.endTs + 1n) until = planRead.endTs + 1n;
      /* Said only when it can be taken: a stopped, blocked or unread limit gives the merchant nothing — or is not known. */
      const grace = !ghost && left.status === "active" && left.roomRaw > 0n && until > now ? { raw: left.roomRaw.toString(), until: until.toString() } : null;
      return {
        instructions: [await cancelIx({ wallet, plan: planAddress, subscription: delegation.address })],
        review: { ...emptyReview("revoke"), revokes: "cancel", delegation: delegation.address, counterparty: planRead.state === "present" ? planRead.owner : null, grace, graceUnknown: left.status === "unknown" },
      };
    }
    case "stopAll": {
      const own = await ownHolder(deps, wallet);
      if (own.authority.state !== "present") return fail("ALLOWANCE_NOTHING_TO_STOP", "No limit on USDC is open for this wallet.");
      let stops: number | null = null;
      try {
        const given = await readDelegations(deps.connection, "delegator", wallet);
        const behind = await readBehind(deps.connection, given);
        /* A subscription whose plan was not read has no known token: then the count is not known either. */
        stops = behind.rows.some((row) => row.mint === null)
          ? null
          : behind.rows.filter((row) => row.mint === mint && ["active", "scheduled", "cancelled", "blocked", "unknown"].includes(allowanceNow(row.delegation, { ...row.holder, plan: row.plan, now }).status)).length;
      } catch {
        stops = null;
      }
      /* No USDC account left, or a frozen one (its approval cannot be revoked then): the authority is closed alone — every
         take needs it, and one opened later is a new generation — and the Review says the approval itself stays. */
      const gone = own.tokenAccount.state === "absent" || (own.tokenAccount.state === "present" && own.tokenAccount.frozen);
      return {
        instructions: [gone ? await closeAuthorityIx({ wallet, mint, payer: own.authority.payer }) : await stopAllIx({ wallet, mint, payer: own.authority.payer })],
        review: {
          ...emptyReview("stopAll"),
          stops,
          refundLamports: own.authority.payer === wallet ? rentExemptLamports(ACCOUNT_BYTES.authority).toString() : "0",
          /* The program revokes the approval only when it is its own; another app's stays, and the Review says so. */
          remainsDelegate: own.tokenAccount.state === "present" && own.tokenAccount.delegate && own.tokenAccount.delegate !== own.authorityAddress ? own.tokenAccount.delegate : null,
          closesOnly: gone,
        },
      };
    }
    case "spend": {
      const read = await readOne(deps, request.delegation);
      if (!read) return fail("ALLOWANCE_NOT_FOUND", "No limit at this address on this network.");
      const delegation = read.delegation;
      if (delegation.kind === "subscription") return fail("ALLOWANCE_KIND", "A subscription is collected by its merchant's own tools.");
      if (delegation.header.delegatee !== wallet) return fail("ALLOWANCE_NOT_DELEGATEE", "This limit was not given to this wallet.");
      if (delegation.mint !== mint) return fail("ALLOWANCE_ASSET", "This limit is not in USDC.");
      const amountRaw = BigInt(request.amountRaw);
      const behind = await readBehind(deps.connection, [delegation]);
      const row = behind.rows[0]!;
      const left = allowanceNow(delegation, { ...row.holder, plan: row.plan, now });
      if (left.status !== "active") return fail("ALLOWANCE_NOT_ACTIVE", `Nothing can be taken from this limit now (${left.status}).`);
      /* The limit's own room first: over it, the program would refuse — said here before anything is signed. */
      if (amountRaw > left.roomRaw) return fail("ALLOWANCE_LIMIT_EXCEEDED", "More than the limit allows now.");
      if (amountRaw > (left.availableRaw ?? 0n)) return fail("ALLOWANCE_BALANCE_SHORT", "The giver's USDC balance holds less than this now.");
      const receiver = await resolveReceiver(deps.connection, request.to, mint);
      if (!receiver.ok) return fail(receiver.code, receiver.message);
      const opens = receiver.opens;
      return {
        instructions: [
          ...(opens ? [openTokenAccountIx({ payer: wallet, owner: request.to, mint })] : []),
          await transferIx({ kind: delegation.kind, wallet, delegation: delegation.address, delegator: delegation.header.delegator, mint, amountRaw, receiverAta: receiver.tokenAccount }),
        ],
        review: {
          ...emptyReview("spend"),
          delegation: delegation.address,
          counterparty: delegation.header.delegator,
          amountRaw: amountRaw.toString(),
          to: request.to,
          opensTokenAccount: opens,
          rentLamports: opens ? rentExemptLamports(ACCOUNT_BYTES.tokenAccount).toString() : "0",
        },
      };
    }
  }
}

/**
 * What moves money or gives a right to move it: while one of a group that the wallet sent is not final, another of the
 * same group is not built — a limit given twice is two limits, a take sent twice is paid twice.
 */
const GIVES: ReadonlySet<AllowanceBuildRequest["kind"]> = new Set(["fixed", "recurring", "subscribe"]);
const TAKES: ReadonlySet<AllowanceBuildRequest["kind"]> = new Set(["spend"]);
/** Sends older than this are past any blockhash: their word is final whatever was kept. */
const UNSETTLED_MS = 10 * 60 * 1000;

/**
 * Whether a limit this wallet sent is still not known to have landed or not: the same limit given again then would be
 * two limits. Read from the chain, per send, and kept once final; a read that fails is «not final» — the person waits
 * a minute rather than risk a second limit. Holds across a reload and another tab: the server keeps the sends.
 */
async function unsettled(deps: AllowanceDeps, wallet: string, kinds: ReadonlySet<AllowanceBuildRequest["kind"]>): Promise<boolean> {
  const since = deps.now().getTime() - UNSETTLED_MS;
  const sends = deps.store.collection<SendRecord>(SENDS);
  const builds = deps.store.collection<BuildRecord>(BUILDS);
  for (const send of await sends.valuesWithPrefix(`${deps.network}:`)) {
    if (send.outcome || Date.parse(send.at) < since) continue;
    const build = await builds.get(buildKey(send.network, send.id));
    if (!build || build.wallet !== wallet || !kinds.has(build.kind)) continue;
    const read = await readSignature(deps.connection, send.signature, Number(build.validUntil), null);
    const outcome = read.outcome === "CONFIRMED" ? "CONFIRMED" : read.outcome === "FAILED" ? "FAILED" : read.outcome === "EXPIRED" ? "NOT_LANDED" : null;
    if (!outcome) return true;
    await sends.set(buildKey(send.network, send.id), { ...send, outcome });
  }
  return false;
}

export async function buildAllowance(deps: AllowanceDeps, request: AllowanceBuildRequest): Promise<Readonly<{ ok: true; build: AllowanceBuildResponse }> | AllowanceFailure> {
  try {
    if (GIVES.has(request.kind) && (await unsettled(deps, request.wallet, GIVES))) {
      return fail("ALLOWANCE_SEND_PENDING", "A limit this wallet sent is not final on the network yet; check the list in a minute before giving another.");
    }
    if (TAKES.has(request.kind) && (await unsettled(deps, request.wallet, TAKES))) {
      return fail("ALLOWANCE_SPEND_PENDING", "A take this wallet sent is not final on the network yet; check the list in a minute before taking again.");
    }
    const planned = await plan(deps, request);
    if ("ok" in planned) return planned;
    const wallet = new PublicKey(request.wallet);
    await sweep(deps).catch(() => undefined);
    const { blockhash, lastValidBlockHeight } = await deps.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: wallet, blockhash, lastValidBlockHeight });
    tx.add(...planned.instructions);
    const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const now = deps.now();
    const windows = await readBuildWindows(web3ChainReader(deps.connection), lastValidBlockHeight, { transactions: 1, capMs: BUILD_TTL_MS });
    const build: BuildRecord = {
      id: randomBytes(16).toString("hex"),
      network: deps.network,
      wallet: request.wallet,
      kind: request.kind,
      delegation: planned.review.delegation,
      wire,
      validUntil: String(lastValidBlockHeight),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + Math.max(0, windows.lifeMs)).toISOString(),
    };
    await deps.store.collection<BuildRecord>(BUILDS).insertIfAbsent(buildKey(build.network, build.id), build);
    return {
      ok: true,
      build: {
        buildId: build.id,
        network: ALLOWANCE_CHAIN[deps.network],
        unsignedWireBase64: [wire],
        networkCostLamports: (BigInt(tx.signatures.length) * SIGNATURE_FEE_LAMPORTS).toString(),
        signableMs: windows.signableMs,
        expiresAt: build.expiresAt,
        review: planned.review,
      },
    };
  } catch (error) {
    if (error instanceof AllowanceRefusal) return fail(error.code, error.message);
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
}

/** The program's own name for a refusal it gave («custom program error: 0x12c» → «Amount exceeds limit»). */
export function programRefusal(reason: string): string {
  const match = /custom program error: 0x([0-9a-f]+)/i.exec(reason);
  if (!match) return reason;
  const code = Number.parseInt(match[1]!, 16);
  try {
    const name = getSubscriptionsErrorMessage(code as SubscriptionsError);
    return name ? `${name} (${code})` : reason;
  } catch {
    return reason;
  }
}

const signatureOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array(64)));

export async function submitAllowance(deps: AllowanceDeps, input: AllowanceSubmitRequest): Promise<Readonly<{ ok: true; submit: AllowanceSubmitResponse }> | AllowanceFailure> {
  const deadline = deps.now().getTime() + SUBMIT_ROUTE_MS;
  const build = await deps.store.collection<BuildRecord>(BUILDS).get(buildKey(deps.network, input.buildId));
  if (!build) return fail("ALLOWANCE_BUILD_NOT_FOUND", "This was not built here.");
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", "This was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("ALLOWANCE_BUILD_EXPIRED", "It waited too long for the signature; prepare it again.");
  const signedWire = input.signedWireBase64[0]!;
  /* The wallet's own fee and guard instructions are its right; any other change is not what the person reviewed. */
  const verdict = compareWalletTransaction({ expectedWireBase64: build.wire, actualWireBase64: signedWire, guardPolicy: "BOUNDED" });
  if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return fail("ALLOWANCE_SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(signedWire, "base64"));
  } catch {
    return fail("ALLOWANCE_SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (!tx.verifySignatures(true)) return fail("ALLOWANCE_SIGNED_OTHER_BYTES", "A signature is missing or does not match the transaction.");
  /* One send per build: a second press finds it used. */
  if (!(await deps.store.collection<SendRecord>(SENDS).insertIfAbsent(buildKey(build.network, build.id), { network: build.network, id: build.id, at: deps.now().toISOString(), signature: signatureOf(tx) }))) {
    return fail("ALLOWANCE_BUILD_USED", "This was already sent.");
  }
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...SEND_BUDGET, deadline });
  /* The chain's word, kept: a final send no longer holds a new limit back. */
  if (sent.outcome !== "UNKNOWN") {
    const outcome = sent.outcome === "CONFIRMED" ? "CONFIRMED" : sent.outcome === "FAILED" ? "FAILED" : "NOT_LANDED";
    await deps.store
      .collection<SendRecord>(SENDS)
      .set(buildKey(build.network, build.id), { network: build.network, id: build.id, at: deps.now().toISOString(), signature: signatureOf(tx), outcome })
      .catch(() => undefined);
  }
  if (sent.outcome === "REJECTED" && /never saw the transaction/.test(sent.reason ?? "")) return fail("ALLOWANCE_NOT_LANDED", "It did not reach the network and no longer can; nothing changed.");
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    /* The program's own refusal by name when its code is in the logs (an amount over the limit, an expired limit). */
    const reason = sent.reason ?? "The network refused it.";
    const named = programRefusal(sent.detail ?? reason);
    return fail("ALLOWANCE_SUBMIT_FAILED", (named === (sent.detail ?? reason) ? reason : named).slice(0, 300));
  }
  return {
    ok: true,
    submit: { state: sent.outcome === "UNKNOWN" ? "PENDING" : "CONFIRMED", signature: sent.signature || signatureOf(tx), kind: build.kind, delegation: build.delegation, at: deps.now().toISOString() },
  };
}

/** How long past a build's expiry a submit already under way may still be keeping its send: a margin, not a promise. */
const LATE_SEND_MS = 30_000;

/**
 * A sent build's word from the chain, read again (SOL-7): after a PENDING, or after a submit whose answer was lost — the
 * page reads this until it is final instead of letting the person prepare the same limit twice. NOT_LANDED only when it
 * can never land: its signature absent past its blockhash (the chain's own word), or never sent — no send kept, the
 * build expired and the chain past its blockhash, so even a submit still under way cannot put it on chain.
 */
export async function allowanceSendStatus(deps: AllowanceDeps, query: Readonly<{ build: string; wallet: string }>): Promise<Readonly<{ ok: true; status: AllowanceSendStatus }> | AllowanceFailure> {
  const build = await deps.store.collection<BuildRecord>(BUILDS).get(buildKey(deps.network, query.build));
  if (!build) return fail("ALLOWANCE_BUILD_NOT_FOUND", "This was not built here.");
  if (build.wallet !== query.wallet) return fail("WALLET_MISMATCH", "This was built for another wallet.");
  const send = await deps.store.collection<SendRecord>(SENDS).get(buildKey(build.network, build.id));
  const answer = (state: AllowanceSentState, signature: string | null) => ({ ok: true as const, status: { state, signature, kind: build.kind, delegation: build.delegation, at: deps.now().toISOString() } });
  if (!send) {
    if (deps.now().getTime() < Date.parse(build.expiresAt) + LATE_SEND_MS) return answer("PENDING", null);
    const tip = await deps.connection.getEpochInfo("confirmed").catch(() => null);
    const past = tip?.blockHeight !== undefined && tip.blockHeight > Number(build.validUntil) + EXPIRY_MARGIN_BLOCKS;
    return answer(past ? "NOT_LANDED" : "PENDING", null);
  }
  if (send.outcome) return answer(send.outcome, send.signature);
  const read = await readSignature(deps.connection, send.signature, Number(build.validUntil), null);
  return answer(read.outcome === "CONFIRMED" ? "CONFIRMED" : read.outcome === "FAILED" ? "FAILED" : read.outcome === "EXPIRED" ? "NOT_LANDED" : "PENDING", send.signature);
}
