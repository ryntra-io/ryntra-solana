/**
 * The treasury's build and submit (SOL-4): the routes' whole logic. A build checks the request against the chain's
 * own state and the rules of `model.ts`, makes the transactions for the person's wallet, keeps their unsigned bytes and
 * answers them with a Review; a submit takes the signed bytes, compares each with the kept one (the wallet may add only
 * its own fee and guard instructions), sends them once, in order, and stops at the first that does not land.
 *
 * Served only where the deployment names the network (`NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK`): devnet first; mainnet is
 * the operator's canary. The server signs nothing: a new multisig's one-time `createKey` is made in the person's browser and
 * signs there after the wallet (`create-key.client.ts`).
 *
 * A wallet that signs v1 transactions (SIMD-0385) gets v1 bytes, the limits in the message's config, as Phantom asks
 * («Use Solana v1 transactions… set compute unit and loaded account data limits explicitly», docs.phantom.com); any
 * other wallet gets legacy bytes with the loaded-data limit as a Compute Budget instruction.
 */

import { randomBytes } from "node:crypto";
import * as multisig from "@sqds/multisig";
import { getBase58Decoder } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";

import { getGuardRuntime } from "../../guard/runtime.ts";
import { storeSupportsConcurrentInstances, type GuardStore } from "../../guard/store.ts";
import { launchClaimsV2Open, launchPartnerVault } from "../../launch/config.server.ts";
import { sendOnce, type Sendable } from "../../launch/flow.server.ts";
import { planPartnerClaims, readPartnerJournal, recordPartnerExecutions, recordPartnerProposal, type PartnerJournalLine } from "../../launch/partner-claims.server.ts";
import { launchMarketDeps } from "../../launch/runtime.server.ts";
import { NEXT_TRANSACTION_MARGIN_MS, readBuildWindows, web3ChainReader } from "../blockhash-life.ts";
import { ed25519Valid } from "../limits/trigger-tx.ts";
import { resolveEndpoint } from "../rpc.ts";
import { buildV1Wire, instructionsOfView, kitInstruction, readV1, v1MatchesBuilt } from "../v1-tx.ts";
import { compareWalletTransaction } from "../wallet-modification.ts";
import type { ConfigChange, ConfigChangeView, TreasuryBuildRequest, TreasuryBuildResponse, TreasuryInfo, TreasuryReview, TreasuryState, TreasurySubmitRequest, TreasurySubmitResponse } from "./contract.ts";
import {
  TREASURY_CHAIN,
  agentIssues,
  assetMint,
  chainRefusalOf,
  limitIssues,
  payoutsTotal,
  treasuryIssues,
  treasuryNetworkFrom,
  type TreasuryIssue,
  type TreasuryNetwork,
} from "./model.ts";
import {
  TreasuryRefusal,
  addMemberRent,
  batchRemaining,
  buildConfig,
  buildCreate,
  buildCreateAgent,
  buildDeposit,
  CLAIM_LINES_PER_EXECUTION,
  buildLaunchClaims,
  claimsRemaining,
  buildExecute,
  buildPayouts,
  buildSpend,
  buildVote,
  failedInstructionIndex,
  legacyInstructions,
  limitAvailable,
  limitBytes,
  LOADED_ACCOUNTS_LIMIT,
  memberRoles,
  pack,
  payerOf,
  readBalances,
  readLimit,
  tokenHeld,
  readMultisig,
  readProgramConfig,
  readProposals,
  readTreasury,
  emptyAccountRent,
  refreshRentRate,
  rentDestination,
  rentExemptLamports,
  tokenAccountRent,
  squadsErrorName,
  v1Parts,
  type BatchRemaining,
  type Group,
  type MultisigRead,
} from "./squads.server.ts";

export type TreasuryDeps = Readonly<{ network: TreasuryNetwork; connection: Connection; store: GuardStore; now: () => Date }>;

export function treasuryNetwork(env: Readonly<Record<string, string | undefined>> = process.env): TreasuryNetwork | null {
  return treasuryNetworkFrom(env.NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK);
}

let cached: { url: string; connection: Connection } | null = null;

/**
 * What the routes need, or null where the treasury is not served: no network named, or a deployment whose store is
 * not one every instance shares (a build kept on one instance must be found by the submit on another).
 */
export function treasuryDeps(): TreasuryDeps | null {
  const network = treasuryNetwork();
  if (!network) return null;
  const store = getGuardRuntime().store;
  if (process.env.VERCEL && !storeSupportsConcurrentInstances(store)) return null;
  const url = resolveEndpoint(network);
  if (!cached || cached.url !== url) cached = { url, connection: new Connection(url, "confirmed") };
  return { network, connection: cached.connection, store, now: () => new Date() };
}

export type TreasuryFailure = Readonly<{ ok: false; code: string; message: string; issues?: readonly TreasuryIssue[] }>;
const fail = (code: string, message: string, issues?: readonly TreasuryIssue[]): TreasuryFailure => ({ ok: false, code, message, ...(issues?.length ? { issues } : {}) });

type BuildRecord = Readonly<{
  id: string;
  network: TreasuryNetwork;
  wallet: string;
  kind: TreasuryBuildRequest["kind"];
  multisig: string;
  index: string | null;
  wires: readonly string[];
  validUntil: readonly string[];
  /** v1 bytes or legacy; a build kept before v1 existed has none and is legacy. */
  format?: "legacy" | "v1";
  /**
   * SOL-L1d: what the revenue journal records once it lands — a launch-claims proposal's lines, or an execution of one
   * with the batch's items each transaction runs, in order.
   */
  journal?: Readonly<{ kind: "proposal"; vault: string; lines: readonly PartnerJournalLine[] }> | Readonly<{ kind: "execution"; items: readonly number[] }>;
  createdAt: string;
  expiresAt: string;
}>;
type SendRecord = Readonly<{ network: TreasuryNetwork; id: string; at: string }>;

const BUILDS = "solanaTreasuryBuilds" as const;
const SENDS = "solanaTreasurySends" as const;
const buildKey = (network: TreasuryNetwork, id: string) => `${network}:${id}`;
/** How long a build may wait for its signature at most; the blockhash usually decides first. */
const BUILD_TTL_MS = 90_000;
const SEND_BUDGET = { confirmMs: 20_000, settleMs: 4_000 } as const;
/** Every part of a submit inside the route's 60 s. */
const SUBMIT_ROUTE_MS = 52_000;
const PART_MIN_MS = 8_000;
const SIGNATURE_FEE_LAMPORTS = 5_000n;

/** Builds an hour past their expiry are removed: anyone may ask for a build, nobody can fill the store with them. */
async function sweep(deps: TreasuryDeps): Promise<void> {
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  const builds = deps.store.collection<BuildRecord>(BUILDS);
  for (const build of await builds.valuesWithPrefix(`${deps.network}:`)) if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.network, build.id));
  const sends = deps.store.collection<SendRecord>(SENDS);
  for (const send of await sends.valuesWithPrefix(`${deps.network}:`)) if (Date.parse(send.at) < stale) await sends.delete(buildKey(send.network, send.id));
}

export async function treasuryInfo(deps: TreasuryDeps): Promise<TreasuryInfo> {
  const config = await readProgramConfig(deps.connection).catch(() => null);
  return { network: TREASURY_CHAIN[deps.network], creationFeeLamports: config ? config.feeLamports.toString() : null, usdcMint: assetMint("USDC", deps.network) ?? "" };
}

/**
 * The deps the partner's launch claims read with — only where Launch is served on the treasury's own network and the
 * claims are open there (`launchClaimsV2Open`: the devnet stand; mainnet by the operator's switch). Closed, the page offers
 * no launch claims, and a claims proposal is voted on and run in Squads' own app, as before SOL-L1d.
 */
function launchClaimDeps(deps: TreasuryDeps) {
  const launch = launchMarketDeps();
  return launch && launch.network.cluster === deps.network && launchClaimsV2Open(launch.network) ? launch : null;
}

export async function treasuryState(deps: TreasuryDeps, address: string): Promise<Readonly<{ ok: true; state: TreasuryState }> | TreasuryFailure> {
  try {
    const launch = launchClaimDeps(deps);
    return { ok: true, state: await readTreasury(deps.connection, address, deps.network, deps.now(), launch ? launchPartnerVault(launch.network) : null) };
  } catch (error) {
    if (error instanceof TreasuryRefusal) return fail(error.code, error.message);
    return fail("UNAVAILABLE", "The network could not be read now.");
  }
}

/** The plan's Review; what the wallet lacks, and whether that blocks the signature, is read once the bytes are counted. */
type Planned = Readonly<{
  groups: readonly Group[];
  journal?: BuildRecord["journal"];
  review: Omit<TreasuryReview, "walletShortfall" | "blockedBy" | OptionalReview> & Partial<Pick<TreasuryReview, OptionalReview>>;
}>;
type OptionalReview = "configAuthority" | "rentTo" | "to" | "changes" | "vaultRentLamports" | "control" | "claims";

/**
 * Addresses that are not a wallet, so could never spend what is paid to them: the treasury's own multisig and vault,
 * and any existing account a wallet does not own — a program, a mint, another program's data. A wallet is a System
 * account (or none yet); for SOL, a token or stake account too, whose owner takes the lamports back on closing.
 */
const STAKE_PROGRAM_ID = new PublicKey("Stake11111111111111111111111111111111111111");
async function notWallets(connection: Connection, addresses: readonly string[], asset: "SOL" | "USDC" | "OTHER", own: readonly string[]): Promise<Set<string>> {
  const out = new Set(addresses.filter((address) => own.includes(address)));
  const infos = addresses.length ? await connection.getMultipleAccountsInfo(addresses.map((address) => new PublicKey(address)), "confirmed") : [];
  infos.forEach((info, at) => {
    if (!info) return;
    const wallet = info.owner.equals(SystemProgram.programId) || (asset === "SOL" && [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, STAKE_PROGRAM_ID].some((owner) => info.owner.equals(owner)));
    if (info.executable || !wallet) out.add(addresses[at]!);
  });
  return out;
}

/** A change asked for, as the page says it: the same view a proposal read from the chain gets. */
function changeOfRequest(change: ConfigChange): ConfigChangeView {
  switch (change.type) {
    case "addLimit":
      return { type: "addLimit", limit: "", asset: change.asset, amountRaw: change.amountRaw, period: change.period, spenders: change.spenders, destinations: change.destinations };
    case "removeLimit":
      return { type: "removeLimit", limit: change.limit };
    case "addMember":
      return { type: "addMember", member: change.member };
    case "removeMember":
      return { type: "removeMember", address: change.address };
    case "threshold":
      return { type: "threshold", threshold: change.threshold };
    case "timeLock":
      return { type: "timeLock", seconds: change.seconds };
  }
}

/** What a batch still pays, for its Review: per asset with its own count, the recipients, the vault's rent for accounts. */
function batchReview(remaining: BatchRemaining): Pick<TreasuryReview, "outflow" | "to" | "newTokenAccounts" | "vaultRentLamports"> {
  return {
    outflow: remaining.sums.map((sum) => ({ asset: sum.asset, raw: sum.raw.toString(), recipients: sum.lines })),
    to: remaining.recipients,
    newTokenAccounts: remaining.newTokenAccounts,
    vaultRentLamports: (BigInt(remaining.newTokenAccounts) * tokenAccountRent()).toString(),
  };
}

/** A batch of claims as its vote or execution says it: what is claimed, never what it will come to — the claims take what each source holds then. */
function claimsView(remaining: Readonly<{ claims: readonly Readonly<{ source: "curve" | "migration" | "surplus" | "lp"; pool: string; launch: string }>[] }>, lines: number): NonNullable<TreasuryReview["claims"]> {
  const bySource = (["curve", "migration", "surplus", "lp"] as const).map((source) => ({ source, count: remaining.claims.filter((claim) => claim.source === source).length })).filter((row) => row.count > 0);
  return { claims: remaining.claims.length, launches: new Set(remaining.claims.map((claim) => claim.launch)).size, lines, bySource, holding: [], unread: 0, later: 0, opens: 0 };
}

/**
 * An open proposal of launch-fee claims in this multisig — voted on, approved or partly run — whose lines a second
 * proposal would claim again: one of the latest the page reads, or one the revenue journal knows is not run whole,
 * read by its own number however far back it is. A draft cut short is not open: it never reached the votes.
 */
async function openClaimsProposal(deps: TreasuryDeps, read: MultisigRead): Promise<string | null> {
  const OPEN = ["active", "approved", "executing"];
  const latest = (await readProposals(deps.connection, read, deps.network)).find((row) => row.type === "claims" && OPEN.includes(row.state));
  if (latest) return latest.index;
  const journal = await readPartnerJournal(deps.store, deps.network);
  const pending = journal.filter((entry) => entry.multisig === read.address.toBase58() && entry.executions.filter((run) => !run.pending).length < entry.lines.length).map((entry) => entry.index);
  if (pending.length === 0) return null;
  const infos = await deps.connection.getMultipleAccountsInfo(pending.map((index) => multisig.getProposalPda({ multisigPda: read.address, transactionIndex: BigInt(index) })[0]), "confirmed");
  for (const [at, info] of infos.entries()) {
    if (!info) continue;
    const [proposal] = multisig.accounts.Proposal.fromAccountInfo(info);
    const state = proposal.status.__kind.toLowerCase();
    /* Squads still runs a batch approved before a change of the rules; only one still being voted on goes stale. */
    if (OPEN.includes(state) && (state !== "active" || BigInt(pending[at]!) > read.staleTransactionIndex)) return pending[at]!;
  }
  return null;
}

/**
 * What the vault lacks to pay this now: SOL for the sums and the USDC accounts it opens — left rent-exempt, unless one
 * step empties it to the last lamport (`mayEmpty`) — and USDC for its sums. A balance not read is not said as a lack.
 */
function vaultShortfall(balances: TreasuryState["balances"], need: Readonly<{ sol: bigint; usdc: bigint }>, mayEmpty: boolean): { asset: "SOL" | "USDC"; raw: string }[] {
  const out: { asset: "SOL" | "USDC"; raw: string }[] = [];
  const sol = BigInt(balances.solRaw);
  if (need.sol > 0n) {
    const keep = mayEmpty && sol === need.sol ? 0n : emptyAccountRent();
    if (sol < need.sol + keep) out.push({ asset: "SOL", raw: (need.sol + keep - sol).toString() });
  }
  if (need.usdc > 0n && balances.usdcRaw !== null && BigInt(balances.usdcRaw) < need.usdc) out.push({ asset: "USDC", raw: (need.usdc - BigInt(balances.usdcRaw)).toString() });
  return out;
}

const noRules = null;

async function plan(deps: TreasuryDeps, request: TreasuryBuildRequest): Promise<Planned | TreasuryFailure> {
  const { network, connection } = deps;
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  const base = (read: MultisigRead, index: bigint | null): Pick<TreasuryReview, "multisig" | "vault" | "index"> => ({ multisig: read.address.toBase58(), vault: read.vault.toBase58(), index: index?.toString() ?? null });

  switch (request.kind) {
    case "create": {
      const issues = treasuryIssues({ creator: request.wallet, members: request.members, threshold: request.threshold, timeLockSeconds: request.timeLockSeconds });
      if (issues.length) return fail("VALIDATION_ERROR", "The treasury's rules are not complete.", issues);
      const config = await readProgramConfig(connection);
      if (!request.createKey) return fail("VALIDATION_ERROR", "createKey: the new multisig's seed key is missing");
      const built = buildCreate({ wallet: request.wallet, createKey: new PublicKey(request.createKey), members: request.members, threshold: request.threshold, timeLockSeconds: request.timeLockSeconds, programTreasury: config.treasury });
      /* A seed key already used seeds an address already taken: the network would refuse the creation. */
      if (await connection.getAccountInfo(built.multisig, "confirmed")) return fail("VALIDATION_ERROR", "createKey: this seed key was already used; prepare it again");
      return {
        groups: built.groups,
        review: {
          kind: "create",
          multisig: built.multisig.toBase58(),
          vault: built.vault.toBase58(),
          index: null,
          outflow: [],
          rules: { threshold: request.threshold, voters: request.members.filter((member) => member.vote).length, members: request.members.length, timeLockSeconds: request.timeLockSeconds },
          creationFeeLamports: config.feeLamports.toString(),
          rentLamports: built.rentLamports.toString(),
          alsoApproves: false,
          newTokenAccounts: 0,
          shortfall: [],
        },
      };
    }
    case "createAgent": {
      const draft = {
        creator: request.wallet,
        agent: request.agent,
        timeLockSeconds: request.timeLockSeconds,
        limit: { asset: request.asset, amountRaw: BigInt(request.amountRaw), period: request.period, destinations: request.destinations },
      };
      const issues = agentIssues(draft);
      if (issues.length) return fail("VALIDATION_ERROR", "The agent's mandate is not complete.", issues);
      const stuck = await notWallets(connection, request.destinations, request.asset, []);
      if (stuck.size) return fail("VALIDATION_ERROR", "A destination is not a wallet.", [...stuck].map((at) => ({ code: "LIMIT_DESTINATION_NOT_WALLET" as const, at })));
      const config = await readProgramConfig(connection);
      if (!request.createKey) return fail("VALIDATION_ERROR", "createKey: the new multisig's seed key is missing");
      const built = buildCreateAgent({ network, wallet: request.wallet, createKey: new PublicKey(request.createKey), agent: request.agent, timeLockSeconds: request.timeLockSeconds, asset: request.asset, amountRaw: BigInt(request.amountRaw), period: request.period, destinations: request.destinations, programTreasury: config.treasury });
      if (await connection.getAccountInfo(built.multisig, "confirmed")) return fail("VALIDATION_ERROR", "createKey: this seed key was already used; prepare it again");
      return {
        groups: built.groups,
        review: {
          kind: "createAgent",
          multisig: built.multisig.toBase58(),
          vault: built.vault.toBase58(),
          index: "1",
          outflow: [],
          rules: { threshold: 1, voters: 1, members: 1, timeLockSeconds: request.timeLockSeconds },
          creationFeeLamports: config.feeLamports.toString(),
          rentLamports: built.rentLamports.toString(),
          alsoApproves: true,
          newTokenAccounts: 0,
          shortfall: [],
        },
      };
    }
    case "payouts": {
      const read = await readMultisig(connection, request.multisig);
      const roles = memberRoles(read, request.wallet);
      if (!roles?.initiate) return fail("TREASURY_NOT_INITIATOR", "This wallet may not propose in this treasury.");
      const payouts = request.payouts.map((payout) => ({ to: payout.to, amountRaw: BigInt(payout.amountRaw) }));
      const vault = read.vault.toBase58();
      if (payouts.some((payout) => payout.to === vault)) return fail("VALIDATION_ERROR", "A payout to the vault itself.", [{ code: "PAYOUT_TO_VAULT" }]);
      /* Paid where it could never be spent — the treasury's own accounts, Squads', a token account for USDC: refused. */
      const stuck = await notWallets(connection, payouts.map((payout) => payout.to), request.asset, [read.address.toBase58(), vault]);
      if (stuck.size) return fail("VALIDATION_ERROR", "A recipient is not a wallet.", payouts.flatMap((payout, at) => (stuck.has(payout.to) ? [{ code: "PAYOUT_NOT_WALLET" as const, line: at + 1, at: payout.to }] : [])));
      if (new Set(payouts.map((payout) => payout.to)).size !== payouts.length) return fail("VALIDATION_ERROR", "A recipient is named twice.", [{ code: "PAYOUT_TWICE" }]);
      const usdc = assetMint(request.asset, network);
      /* Who has no account yet: a USDC recipient's is opened by the vault at execution, out of its SOL; a SOL recipient
         must be paid at least the network's minimum for a new account, or that line could never run. */
      const recipients = await connection.getMultipleAccountsInfo(payouts.map((payout) => (usdc ? getAssociatedTokenAddressSync(new PublicKey(usdc), new PublicKey(payout.to), true) : new PublicKey(payout.to))), "confirmed");
      if (!usdc) {
        const small = payouts.flatMap((payout, at) => (recipients[at] === null && payout.amountRaw < emptyAccountRent() ? [{ code: "PAYOUT_BELOW_RENT" as const, line: at + 1, at: payout.to }] : []));
        if (small.length) return fail("VALIDATION_ERROR", "A new address must be paid at least the network's minimum for an account.", small);
      }
      const built = buildPayouts({ network, read, wallet: request.wallet, asset: request.asset, payouts, alsoApprove: roles.vote });
      const total = payoutsTotal(payouts);
      const newAccounts = usdc ? recipients.filter((account) => account === null).length : 0;
      /* Said, not refused: a proposal may wait for its funding. */
      const shortfall = vaultShortfall(await readBalances(connection, read.vault, network), { sol: (usdc ? 0n : total) + BigInt(newAccounts) * tokenAccountRent(), usdc: usdc ? total : 0n }, built.items === 1 && newAccounts === 0);
      return {
        groups: built.groups,
        review: {
          kind: "payouts",
          ...base(read, built.index),
          outflow: [{ asset: request.asset, raw: total.toString(), recipients: payouts.length }],
          rules: noRules,
          creationFeeLamports: null,
          rentLamports: built.rentLamports.toString(),
          alsoApproves: roles.vote,
          newTokenAccounts: newAccounts,
          shortfall,
          rentTo: rentDestination(read),
          to: payouts.map((payout) => payout.to),
          vaultRentLamports: (BigInt(newAccounts) * tokenAccountRent()).toString(),
        },
      };
    }
    case "config": {
      const read = await readMultisig(connection, request.multisig);
      const roles = memberRoles(read, request.wallet);
      if (!roles?.initiate) return fail("TREASURY_NOT_INITIATOR", "This wallet may not propose in this treasury.");
      if (!read.account.configAuthority.equals(PublicKey.default)) return fail("TREASURY_HAS_AUTHORITY", "This multisig has a config authority; its rules change there, not by a vote.");
      const change = request.change;
      /* The rules after the change must still be complete: someone to propose, enough voters, someone to execute. */
      let members = read.members.map((member) => ({ ...member }));
      let threshold = read.account.threshold;
      let timeLock = read.account.timeLock;
      if (change.type === "addMember") {
        if (members.some((member) => member.address === change.member.address)) return fail("VALIDATION_ERROR", "Already a member.", [{ code: "MEMBER_TWICE", at: change.member.address }]);
        members = [...members, change.member];
      }
      if (change.type === "removeMember") {
        if (!members.some((member) => member.address === change.address)) return fail("VALIDATION_ERROR", "Not a member.", [{ code: "MEMBER_ADDRESS", at: change.address }]);
        members = members.filter((member) => member.address !== change.address);
      }
      if (change.type === "threshold") threshold = change.threshold;
      if (change.type === "timeLock") timeLock = change.seconds;
      if (change.type === "addLimit") {
        const issues = limitIssues({ asset: change.asset, amountRaw: BigInt(change.amountRaw), period: change.period, spenders: change.spenders, destinations: change.destinations });
        if (issues.length) return fail("VALIDATION_ERROR", "The limit is not complete.", issues);
        const stuck = await notWallets(connection, change.destinations, change.asset, [read.address.toBase58(), read.vault.toBase58()]);
        if (stuck.size) return fail("VALIDATION_ERROR", "A destination is not a wallet.", [...stuck].map((at) => ({ code: "LIMIT_DESTINATION_NOT_WALLET" as const, at })));
      }
      if (change.type === "addMember" || change.type === "removeMember" || change.type === "threshold" || change.type === "timeLock") {
        const issues = treasuryIssues({ creator: members[0]?.address ?? "", members, threshold, timeLockSeconds: timeLock }).filter((issue) => issue.code !== "CREATOR_NOT_MEMBER");
        if (issues.length) return fail("VALIDATION_ERROR", "The rules after this change would not be complete.", issues);
      }
      const built = buildConfig({ network, read, wallet: request.wallet, change, alsoApprove: roles.vote });
      return {
        groups: built.groups,
        review: {
          kind: "config",
          ...base(read, built.index),
          outflow: [],
          rules: { threshold, voters: members.filter((member) => member.vote).length, members: members.length, timeLockSeconds: timeLock },
          creationFeeLamports: null,
          rentLamports: built.rentLamports.toString(),
          alsoApproves: roles.vote,
          newTokenAccounts: 0,
          shortfall: [],
          rentTo: rentDestination(read),
          changes: [changeOfRequest(change)],
        },
      };
    }
    case "vote": {
      const read = await readMultisig(connection, request.multisig);
      const roles = memberRoles(read, request.wallet);
      if (!roles?.vote) return fail("TREASURY_NOT_VOTER", "This wallet does not vote in this treasury.");
      const index = BigInt(request.index);
      const proposal = (await readProposals(connection, read, network)).find((row) => row.index === request.index);
      if (!proposal) return fail("TREASURY_PROPOSAL_NOT_FOUND", "No proposal under this number among the latest.");
      const wanted = request.vote === "cancel" ? "approved" : "active";
      if (proposal.state !== wanted) return fail("TREASURY_PROPOSAL_STATE", request.vote === "cancel" ? "Only an approved proposal can be cancelled." : "This proposal is not open for votes.");
      /* A «for» authorises what the proposal does: its Review says it — every line a batch pays, every change — and a
         proposal this page cannot show (made in another app) gets no «for» here. «Against» and a cancel move nothing. */
      let content: Partial<Pick<TreasuryReview, "outflow" | "to" | "newTokenAccounts" | "vaultRentLamports" | "changes" | "claims">> = {};
      if (request.vote === "approve") {
        if (proposal.type === "payouts") {
          const remaining = await batchRemaining(connection, read, index, network);
          if (remaining.foreign) return fail("TREASURY_EXECUTE_ELSEWHERE", "A line of this batch is not a SOL or USDC payout from the vault; vote on it in Squads' own app.");
          if ((await notWallets(connection, remaining.recipients, remaining.sums.some((sum) => sum.asset === "USDC") ? "USDC" : "SOL", [read.address.toBase58(), read.vault.toBase58()])).size) return fail("TREASURY_NOT_WALLET", "A recipient of this batch is not a wallet.");
          content = batchReview(remaining);
        } else if (proposal.type === "claims" && proposal.readable && launchClaimDeps(deps)) {
          /* What a «for» authorises: claims into the vault, every line read again — nothing leaves the vault. */
          const remaining = await claimsRemaining(connection, read, index);
          if (remaining.foreign) return fail("TREASURY_EXECUTE_ELSEWHERE", "A line of this batch is not a launch fee claimed into the vault; vote on it in Squads' own app.");
          content = { claims: claimsView(remaining, proposal.claims?.items ?? remaining.items) };
        } else if (proposal.type === "config" && proposal.changes && proposal.readable) {
          content = { changes: proposal.changes };
        } else {
          return fail("TREASURY_EXECUTE_ELSEWHERE", "This proposal was made in another app; vote on it there, where what it does is shown.");
        }
      }
      return {
        groups: buildVote({ read, wallet: request.wallet, index, vote: request.vote }),
        review: { kind: "vote", ...base(read, index), outflow: [], rules: noRules, creationFeeLamports: null, rentLamports: "0", alsoApproves: false, newTokenAccounts: 0, shortfall: [], ...content },
      };
    }
    case "execute": {
      const read = await readMultisig(connection, request.multisig);
      const roles = memberRoles(read, request.wallet);
      if (!roles?.execute) return fail("TREASURY_NOT_EXECUTOR", "This wallet may not execute in this treasury.");
      const index = BigInt(request.index);
      const proposal = (await readProposals(connection, read, network)).find((row) => row.index === request.index);
      if (!proposal) return fail("TREASURY_PROPOSAL_NOT_FOUND", "No proposal under this number among the latest.");
      if (proposal.state !== "approved" && proposal.state !== "executing") return fail("TREASURY_PROPOSAL_STATE", "Only an approved proposal runs.");
      if (proposal.executableAt !== null && proposal.executableAt > nowSeconds) return fail("TREASURY_DELAY", `The delay ends at ${new Date(proposal.executableAt * 1000).toISOString()}.`);
      /* A transaction made in another app does what this page cannot show: it runs there, never blind here. */
      if ((proposal.type !== "payouts" && proposal.type !== "config" && proposal.type !== "claims") || ((proposal.type === "config" || proposal.type === "claims") && !proposal.readable) || (proposal.type === "claims" && !launchClaimDeps(deps))) return fail("TREASURY_EXECUTE_ELSEWHERE", "This transaction was made in another app; run it there, where what it does is shown.");
      if (proposal.type === "claims") {
        /* Claims into the vault: every line still to run read again, the vault's money untouched — its accounts were opened at the proposal. */
        const remaining = await claimsRemaining(connection, read, index);
        if (remaining.foreign) return fail("TREASURY_EXECUTE_ELSEWHERE", "A line of this batch is not a launch fee claimed into the vault; run it in Squads' own app.");
        const built = await buildExecute(connection, { read, wallet: request.wallet, index });
        /* A few lines a signature: each runs in a transaction of its own, sent inside the route's minute; the rest run
           with the next press, the proposal «executing» meanwhile. */
        const groups = built.groups.slice(0, CLAIM_LINES_PER_EXECUTION);
        const first = built.firstItem ?? 1;
        const items = groups.map((_, at) => first + at);
        return {
          groups,
          journal: { kind: "execution", items },
          /* What this signature runs: its lines' claims; the lines after it are said as the next press's. */
          review: {
            kind: "execute",
            ...base(read, index),
            outflow: [],
            to: [],
            newTokenAccounts: 0,
            vaultRentLamports: "0",
            claims: { ...claimsView({ claims: remaining.perLine.slice(0, groups.length).flat() }, groups.length), later: Math.max(0, remaining.items - groups.length) },
            rules: noRules,
            creationFeeLamports: null,
            rentLamports: "0",
            alsoApproves: false,
            shortfall: [],
          },
        };
      }
      let content: Pick<TreasuryReview, "outflow" | "to" | "newTokenAccounts" | "vaultRentLamports"> = { outflow: [], to: [], newTokenAccounts: 0, vaultRentLamports: "0" };
      let shortfall: TreasuryReview["shortfall"] = [];
      if (proposal.type === "payouts") {
        /* What the batch still pays, read line by line whatever the page's list read: the Review says all of it, and the
           vault must hold it — the sums, the recipients' USDC accounts it opens, and its own rent between the lines. */
        const remaining = await batchRemaining(connection, read, index, network);
        if (remaining.foreign) return fail("TREASURY_EXECUTE_ELSEWHERE", "A line of this batch is not a SOL or USDC payout from the vault; run it in Squads' own app.");
        if ((await notWallets(connection, remaining.recipients, remaining.sums.some((sum) => sum.asset === "USDC") ? "USDC" : "SOL", [read.address.toBase58(), read.vault.toBase58()])).size) return fail("TREASURY_NOT_WALLET", "A recipient of this batch is not a wallet.");
        content = batchReview(remaining);
        const sol = remaining.sums.find((sum) => sum.asset === "SOL")?.raw ?? 0n;
        const usdc = remaining.sums.find((sum) => sum.asset === "USDC")?.raw ?? 0n;
        const balances = await readBalances(connection, read.vault, network);
        /* Emptied to the last lamport is fine if every step on the way leaves it empty or rent-exempt. */
        let left = BigInt(balances.solRaw);
        const steps = remaining.itemSol.map((spent) => (left -= spent));
        const mayEmpty = steps.at(-1) === 0n && steps.slice(0, -1).every((rest) => rest === 0n || rest >= emptyAccountRent());
        shortfall = vaultShortfall(balances, { sol: sol + BigInt(remaining.newTokenAccounts) * tokenAccountRent(), usdc }, mayEmpty);
      }
      const built = await buildExecute(connection, { read, wallet: request.wallet, index });
      /* Executing a change pays for what it opens: a spending limit's account; places for members, when the multisig is full. */
      const added = (proposal.changes ?? []).filter((change) => change.type === "addMember").length;
      const rent =
        (proposal.changes ?? []).reduce((sum, change) => (change.type === "addLimit" ? sum + rentExemptLamports(limitBytes(change.spenders.length, change.destinations.length)) : sum), 0n) +
        (added > 0 ? addMemberRent(read, read.members.length + added) : 0n);
      return { groups: built.groups, review: { kind: "execute", ...base(read, index), ...content, changes: proposal.changes, rules: noRules, creationFeeLamports: null, rentLamports: rent.toString(), alsoApproves: false, shortfall } };
    }
    case "launchClaims": {
      const read = await readMultisig(connection, request.multisig);
      const roles = memberRoles(read, request.wallet);
      if (!roles?.initiate) return fail("TREASURY_NOT_INITIATOR", "This wallet may not propose in this treasury.");
      const launch = launchClaimDeps(deps);
      if (!launch) return fail("TREASURY_LAUNCH_ELSEWHERE", "Launch is not served on this network here.");
      /* One open claims proposal at a time: a second would claim what the first claims, and its line would fail and stop
         the batch. The open one is voted on, run or cancelled first. */
      const open = await openClaimsProposal(deps, read);
      if (open) return fail("TREASURY_CLAIMS_OPEN", `Proposal № ${open} already claims the launch fees; vote on it, run it or cancel it first.`);
      const plan = await planPartnerClaims(launch, read.vault.toBase58(), { deadline: Date.now() + 30_000 });
      if (plan.parts.length === 0) return fail("TREASURY_NOTHING_TO_CLAIM", plan.unread.length ? "The launch fees could not be read now; nothing was built. Try again." : "No launch fee waits for this vault now.");
      /* Only accounts that do not exist yet are opened: one the vault already has costs nothing. */
      const existing = plan.opens.length ? await connection.getMultipleAccountsInfo(plan.opens.map((open) => new PublicKey(open.account)), "confirmed") : [];
      const opens = plan.opens.filter((_, at) => existing[at] === null);
      const built = buildLaunchClaims({ read, wallet: request.wallet, parts: plan.parts, opens, alsoApprove: roles.vote });
      const lines: PartnerJournalLine[] = built.lines.map((indexes, at) => {
        const first = plan.parts[indexes[0]!]!;
        return { item: at + 1, token: first.token, pool: first.pool, pairMint: first.pairMint, claims: indexes.map((part) => ({ source: plan.parts[part]!.source, pairRaw: plan.parts[part]!.pairRaw.toString(), tokenRaw: plan.parts[part]!.tokenRaw.toString() })) };
      });
      const holding = new Map<string, bigint>();
      for (const part of plan.parts) holding.set(part.pairMint, (holding.get(part.pairMint) ?? 0n) + part.pairRaw);
      const pairs = launch.network.pairs;
      const pairOf = (mint: string) => Object.values(pairs).find((pair) => pair?.mint === mint) ?? launch.network.communities.find((pair) => pair.mint === mint) ?? null;
      const bySource = (["curve", "migration", "surplus", "lp"] as const).map((source) => ({ source, count: plan.parts.filter((part) => part.source === source).length })).filter((row) => row.count > 0);
      return {
        groups: built.groups,
        journal: { kind: "proposal", vault: read.vault.toBase58(), lines },
        review: {
          kind: "launchClaims",
          ...base(read, built.index),
          outflow: [],
          rules: noRules,
          creationFeeLamports: null,
          rentLamports: built.rentLamports.toString(),
          alsoApproves: roles.vote,
          newTokenAccounts: 0,
          shortfall: [],
          rentTo: rentDestination(read),
          claims: {
            claims: plan.parts.length,
            launches: new Set(plan.parts.map((part) => part.token)).size,
            lines: built.lines.length,
            bySource,
            holding: [...holding].map(([mint, raw]) => ({ mint, symbol: pairOf(mint)?.symbol ?? mint.slice(0, 4), decimals: pairOf(mint)?.decimals ?? 6, raw: raw.toString() })),
            unread: plan.unread.length,
            later: plan.later.length,
            opens: opens.length,
          },
        },
      };
    }
    case "spend": {
      const read = await readMultisig(connection, request.multisig);
      /* Read by its own address and checked to be this multisig's: a node that refuses scans still serves a spend. */
      const limit = await readLimit(connection, read, request.limit, network);
      if (!limit) return fail("TREASURY_LIMIT_NOT_FOUND", "No spending limit under this address in this treasury.");
      if (!limit.spenders.includes(request.wallet)) return fail("TREASURY_NOT_SPENDER", "This wallet may not spend from this limit.");
      /* A limit read from the chain with an empty list pays anywhere (this page makes none such): the address typed is
         then the only check, and the Review names it in full. */
      if (limit.destinations.length > 0 && !limit.destinations.includes(request.to)) return fail("TREASURY_DESTINATION", "This limit does not pay to this address.");
      const amountRaw = BigInt(request.amountRaw);
      if ((await notWallets(connection, [request.to], limit.asset, [read.address.toBase58(), read.vault.toBase58()])).size) return fail("TREASURY_NOT_WALLET", "This address could never spend what is paid to it.");
      if (amountRaw > limitAvailable(limit, nowSeconds)) return fail("TREASURY_LIMIT_EXCEEDED", "More than the limit allows now.");
      if (limit.asset === "OTHER") return fail("TREASURY_LIMIT_ASSET", "This limit's token is not one this page pays in.");
      /* A USDC recipient without an account: the wallet opens it, out of its own SOL. */
      const usdc = assetMint(limit.asset, network);
      const opens = usdc ? (await connection.getAccountInfo(getAssociatedTokenAddressSync(new PublicKey(usdc), new PublicKey(request.to), true), "confirmed")) === null : false;
      /* SOL to an address with no account must be at least the network's minimum for one: less is refused on chain. */
      if (!usdc && amountRaw < emptyAccountRent() && (await connection.getAccountInfo(new PublicKey(request.to), "confirmed")) === null) return fail("TREASURY_BELOW_RENT", "A new address must receive at least the network's minimum for an account.");
      /* The limit allows it; the vault must also hold it. */
      const shortfall = vaultShortfall(await readBalances(connection, read.vault, network), { sol: usdc ? 0n : amountRaw, usdc: usdc ? amountRaw : 0n }, true);
      return {
        groups: buildSpend({ network, read, wallet: request.wallet, limit, amountRaw, to: request.to }),
        review: { kind: "spend", ...base(read, null), to: [request.to], outflow: [{ asset: limit.asset, raw: amountRaw.toString(), recipients: 1 }], rules: noRules, creationFeeLamports: null, rentLamports: opens ? tokenAccountRent().toString() : "0", alsoApproves: false, newTokenAccounts: opens ? 1 : 0, shortfall },
      };
    }
    case "deposit": {
      const read = await readMultisig(connection, request.multisig);
      /* A member's own top-up: a stranger's link opens a treasury to read, not one to pay into from this page. */
      if (!memberRoles(read, request.wallet)) return fail("TREASURY_NOT_MEMBER", "This wallet is not a member of this treasury.");
      const amountRaw = BigInt(request.amountRaw);
      /* The vault's USDC account, opened by the wallet when it has none: its rent is the wallet's. */
      const usdc = assetMint(request.asset, network);
      const opens = usdc ? (await connection.getAccountInfo(getAssociatedTokenAddressSync(new PublicKey(usdc), read.vault, true), "confirmed")) === null : false;
      /* A vault never paid has no account yet: its first SOL must be at least the network's minimum for one. */
      if (!usdc && amountRaw < emptyAccountRent() && (await connection.getBalance(read.vault, "confirmed")) === 0) return fail("TREASURY_BELOW_RENT", "An empty vault's first SOL must be at least the network's minimum for an account.");
      const configAuthority = read.account.configAuthority.equals(PublicKey.default) ? null : read.account.configAuthority.toBase58();
      return {
        groups: buildDeposit({ network, vault: read.vault, wallet: request.wallet, asset: request.asset, amountRaw }),
        review: {
          kind: "deposit",
          ...base(read, null),
          outflow: [{ asset: request.asset, raw: amountRaw.toString(), recipients: 1 }],
          /* Who can move the money once it is in: the treasury's own rules, and an authority over them if it has one. */
          rules: { threshold: read.account.threshold, voters: read.members.filter((member) => member.vote).length, members: read.members.length, timeLockSeconds: read.account.timeLock },
          creationFeeLamports: null,
          rentLamports: opens ? tokenAccountRent().toString() : "0",
          alsoApproves: false,
          newTokenAccounts: opens ? 1 : 0,
          shortfall: [],
          configAuthority,
          /* Whether this wallet votes in it, and whether the others reach the threshold without it: a member with no say
             over the money is told so before paying in. */
          control: {
            youVote: read.members.some((member) => member.address === request.wallet && member.vote),
            othersAlone: read.members.filter((member) => member.vote && member.address !== request.wallet).length >= read.account.threshold,
          },
        },
      };
    }
  }
}

/**
 * What the wallet lacks for one build, read as it is built: its SOL against the network, the rent it puts down,
 * Squads' fee and a SOL top-up — with the wallet left rent-exempt after; a USDC top-up against its USDC.
 */
async function walletShortfall(deps: TreasuryDeps, request: TreasuryBuildRequest, review: Planned["review"], networkLamports: bigint): Promise<TreasuryReview["walletShortfall"]> {
  const wallet = new PublicKey(request.wallet);
  const solOut = request.kind === "deposit" && request.asset === "SOL" ? BigInt(request.amountRaw) : 0n;
  const need = networkLamports + BigInt(review.rentLamports) + BigInt(review.creationFeeLamports ?? "0") + solOut + emptyAccountRent();
  const balance = BigInt(await deps.connection.getBalance(wallet, "confirmed"));
  const out: { asset: "SOL" | "USDC"; raw: string }[] = [];
  if (balance < need) out.push({ asset: "SOL", raw: (need - balance).toString() });
  if (request.kind === "deposit" && request.asset === "USDC") {
    const mint = new PublicKey(assetMint("USDC", deps.network) ?? "");
    /* No USDC account is no USDC; an account not read is not said as a lack. */
    const held = await tokenHeld(deps.connection, wallet, mint).catch(() => null);
    const amount = BigInt(request.amountRaw);
    if (held !== null && held < amount) out.push({ asset: "USDC", raw: (amount - held).toString() });
  }
  return out;
}

export async function buildTreasury(deps: TreasuryDeps, request: TreasuryBuildRequest): Promise<Readonly<{ ok: true; build: TreasuryBuildResponse }> | TreasuryFailure> {
  try {
    /* Rent at the network's own rate: a build that tells what an account costs reads it first. */
    await refreshRentRate(deps.connection);
    const planned = await plan(deps, request);
    if ("ok" in planned) return planned;
    const wallet = new PublicKey(request.wallet);
    const format = request.format === "v1" ? "v1" : "legacy";
    const packed = pack(planned.groups, wallet);
    await sweep(deps).catch(() => undefined);
    const { blockhash, lastValidBlockHeight } = await deps.connection.getLatestBlockhash("confirmed");
    let signatures = 0n;
    const wires = packed.map((groups) => {
      if (format === "v1") {
        const parts = v1Parts(groups);
        const wire = buildV1Wire({
          owner: request.wallet,
          instructions: parts.instructions.map(kitInstruction),
          blockhash,
          lastValidBlockHeight,
          /* No priority fee, as the legacy bytes: the network's 5,000 lamports a signature is the whole cost. */
          limits: { computeUnitLimit: parts.computeUnitLimit, loadedAccountsDataSizeLimit: LOADED_ACCOUNTS_LIMIT, priorityFeeLamports: 0n },
        });
        signatures += BigInt(readV1(Buffer.from(wire, "base64")).signers.length);
        return wire;
      }
      const tx = new Transaction({ feePayer: wallet, blockhash, lastValidBlockHeight }).add(...legacyInstructions(groups));
      const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
      /* Counted once the message is compiled: before it, a transaction no extra key signed lists no signer at all. */
      signatures += BigInt(tx.signatures.length);
      return wire;
    });
    const networkCost = signatures * SIGNATURE_FEE_LAMPORTS;
    const lacks = await walletShortfall(deps, request, planned.review, networkCost);
    /* Signing something the network must refuse for want of money is a prompt for nothing: the Review says what is
       missing instead. A proposal's vault may wait for its funding; an execution's and a spend's may not. */
    const blockedBy = lacks.length ? "wallet" : (request.kind === "execute" || request.kind === "spend") && planned.review.shortfall.length ? "vault" : null;
    const review: TreasuryReview = {
      ...planned.review,
      configAuthority: planned.review.configAuthority ?? null,
      rentTo: planned.review.rentTo ?? null,
      to: planned.review.to ?? [],
      changes: planned.review.changes ?? null,
      vaultRentLamports: planned.review.vaultRentLamports ?? "0",
      control: planned.review.control ?? null,
      claims: planned.review.claims ?? null,
      walletShortfall: lacks,
      blockedBy,
    };
    const now = deps.now();
    const windows = await readBuildWindows(web3ChainReader(deps.connection), lastValidBlockHeight, { transactions: wires.length, capMs: BUILD_TTL_MS });
    const build: BuildRecord = {
      id: randomBytes(16).toString("hex"),
      network: deps.network,
      wallet: request.wallet,
      kind: request.kind,
      multisig: planned.review.multisig,
      index: planned.review.index,
      wires,
      validUntil: wires.map(() => String(lastValidBlockHeight)),
      format,
      ...(planned.journal ? { journal: planned.journal } : {}),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + Math.max(0, windows.lifeMs - NEXT_TRANSACTION_MARGIN_MS * (wires.length - 1))).toISOString(),
    };
    await deps.store.collection<BuildRecord>(BUILDS).insertIfAbsent(buildKey(build.network, build.id), build);
    return {
      ok: true,
      build: {
        buildId: build.id,
        network: TREASURY_CHAIN[deps.network],
        unsignedWireBase64: wires,
        networkCostLamports: networkCost.toString(),
        signableMs: windows.signableMs,
        expiresAt: build.expiresAt,
        review,
      },
    };
  } catch (error) {
    if (error instanceof TreasuryRefusal) return fail(error.code, error.message);
    return fail("UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
}

const b58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);

/** One part ready to send: its bytes, its id (the wallet's signature), its instructions as signed and its accounts in their order. */
type Part = Readonly<{ send: Sendable; signature: string; instructions: Transaction; accountKeys: readonly string[] }>;
type PartRead = Part | Readonly<{ refused: string }>;

/**
 * The signed legacy bytes against the build: the built transaction, the wallet's own fee and guard instructions its
 * right and nothing else; the wallet the first signer, and every signature real — a new treasury's seed key's too.
 */
function legacyPart(expectedWire: string, actualWire: string, wallet: string): PartRead {
  const verdict = compareWalletTransaction({ expectedWireBase64: expectedWire, actualWireBase64: actualWire, guardPolicy: "BOUNDED" });
  if (verdict.verdict !== "EXACT" && verdict.verdict !== "WALLET_GUARDS_ONLY") return { refused: "The wallet signed a different transaction than the one built." };
  let exact: VersionedTransaction;
  try {
    exact = VersionedTransaction.deserialize(Buffer.from(actualWire, "base64"));
  } catch {
    return { refused: "The wallet returned bytes that are not a transaction." };
  }
  if (exact.version !== "legacy") return { refused: "The wallet signed a different transaction than the one built." };
  const message = exact.message.serialize();
  const signers = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures);
  const real = (at: number) => {
    const signature = exact.signatures[at];
    return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signers[at]!);
  };
  if (signers[0]?.toBase58() !== wallet || !signers.every((_, at) => real(at))) return { refused: "A signature is missing or does not match the transaction." };
  const tx = Transaction.from(exact.serialize());
  return { send: tx, signature: b58(exact.signatures[0]!), instructions: tx, accountKeys: exact.message.staticAccountKeys.map((key) => key.toBase58()) };
}

/** The same for v1 bytes (`v1MatchesBuilt`): what the wallet may add on v1, and every signature real. */
function v1Part(expectedWire: string, actualWire: string, wallet: string): PartRead {
  const checked = v1MatchesBuilt(expectedWire, actualWire, wallet);
  if (!checked.ok) return { refused: checked.reason };
  const read = checked.read;
  const bytes = Buffer.from(actualWire, "base64");
  if (read.signers[0] !== wallet || !read.signers.every((signer, at) => read.signatures[at] && ed25519Valid(read.messageBytes, read.signatures[at]!, new PublicKey(signer)))) return { refused: "A signature is missing or does not match the transaction." };
  const wire = Buffer.from(bytes);
  return {
    send: { serialize: () => wire, signatures: [{ signature: read.signatures[0]! }], recentBlockhash: read.view.lifetime },
    signature: b58(read.signatures[0]!),
    instructions: instructionsOfView(read.view),
    accountKeys: read.accounts,
  };
}

export async function submitTreasury(deps: TreasuryDeps, input: TreasurySubmitRequest): Promise<Readonly<{ ok: true; submit: TreasurySubmitResponse }> | TreasuryFailure> {
  const deadline = deps.now().getTime() + SUBMIT_ROUTE_MS;
  const build = await deps.store.collection<BuildRecord>(BUILDS).get(buildKey(deps.network, input.buildId));
  if (!build) return fail("TREASURY_BUILD_NOT_FOUND", "This was not built here.");
  if (build.wallet !== input.wallet) return fail("WALLET_MISMATCH", "This was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("TREASURY_BUILD_EXPIRED", "It waited too long for the signature; prepare it again.");
  if (input.signedWireBase64.length !== build.wires.length) return fail("TREASURY_SIGNED_OTHER_BYTES", "The wallet did not sign every transaction.");
  const txs: Part[] = [];
  for (let index = 0; index < build.wires.length; index += 1) {
    /* The wallet's own guard instructions — and on legacy bytes its fee — are its right; any other change is not what the person reviewed. */
    const part = (build.format === "v1" ? v1Part : legacyPart)(build.wires[index]!, input.signedWireBase64[index]!, build.wallet);
    if ("refused" in part) return fail("TREASURY_SIGNED_OTHER_BYTES", part.refused);
    txs.push(part);
  }
  /* One send per build: a second press finds it used. */
  if (!(await deps.store.collection<SendRecord>(SENDS).insertIfAbsent(buildKey(build.network, build.id), { network: build.network, id: build.id, at: deps.now().toISOString() }))) {
    return fail("TREASURY_BUILD_USED", "This was already sent.");
  }
  const vault = multisig.getVaultPda({ multisigPda: new PublicKey(build.multisig), index: 0 })[0];
  const signatures: string[] = [];
  const pending: string[] = [];
  const failed: { signature: string; code: string; reason: string }[] = [];
  /* Why the rest stays unsent, said as it is: a part refused, a part not yet confirmed, or the route's time. */
  const NOT_SENT = {
    failed: ["TREASURY_NOT_SENT_AFTER_FAILED", "not sent: the transaction before it did not land"],
    pending: ["TREASURY_NOT_SENT_AFTER_PENDING", "not sent: the transaction before it is not confirmed yet"],
    time: ["TREASURY_NOT_SENT_TIME", "not sent: the route's time ran out"],
  } as const;
  let stop: keyof typeof NOT_SENT | null = null;
  for (let index = 0; index < txs.length; index += 1) {
    /* Each part waits on the one before it: after one that did not land, or is not yet known to, the rest are not sent. */
    if (stop === null && deadline - deps.now().getTime() < PART_MIN_MS) stop = "time";
    if (stop !== null) {
      failed.push({ signature: txs[index]!.signature, code: NOT_SENT[stop][0], reason: NOT_SENT[stop][1] });
      continue;
    }
    const part = txs[index]!;
    const sent = await sendOnce(deps.connection, part.send, Number(build.validUntil[index] ?? "0"), deps.now, { ...SEND_BUDGET, deadline });
    if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
      /* What the refusal means, read against the transaction the wallet signed: which instruction was refused, whose
         money it spends, and Squads' own name for it when Squads itself refused. */
      const text = `${sent.reason ?? ""}\n${sent.detail ?? ""}`;
      const at = failedInstructionIndex(text);
      const vaultKeyIndex = part.accountKeys.indexOf(vault.toBase58());
      const code = chainRefusalOf({ kind: build.kind, text, squadsError: squadsErrorName(text, part.instructions, at), payer: payerOf(part.instructions, at), vaultKeyIndex: vaultKeyIndex >= 0 ? vaultKeyIndex : null });
      if (signatures.length === 0) return fail(code, (sent.reason ?? "The network refused it.").slice(0, 300));
      failed.push({ signature: sent.signature, code, reason: (sent.reason ?? "the network refused it").slice(0, 300) });
      stop = "failed";
      continue;
    }
    if (sent.outcome === "UNKNOWN") {
      pending.push(sent.signature);
      stop = "pending";
      continue;
    }
    signatures.push(sent.signature);
  }
  /* Parts held back only behind one not yet confirmed are pending too: the outcome is still the chain's to say. */
  const state = failed.some((part) => part.code !== NOT_SENT.pending[0]) ? "PARTIAL" : pending.length ? "PENDING" : "CONFIRMED";
  /* SOL-L1d: the revenue journal — the proposal with its claims once anything of it landed, each line run by its transaction. */
  await journalOf(deps, build, signatures, pending, state).catch((error) => console.error("[treasury] the revenue journal was not written", error instanceof Error ? error.message : error));
  return { ok: true, submit: { state, signatures, pending, failed, kind: build.kind, multisig: build.multisig, index: build.index, at: deps.now().toISOString() } };
}

/**
 * What a landed build writes in the revenue journal (SOL-L1d). A proposal: its claims, with the transactions that made
 * it — `complete` only when every one landed (a draft cut short is still the multisig's, and said as such). An execution:
 * each confirmed transaction with the batch item it ran, in order; one still pending is left for the chain to say.
 */
async function journalOf(deps: TreasuryDeps, build: BuildRecord, signatures: readonly string[], pending: readonly string[], state: TreasurySubmitResponse["state"]): Promise<void> {
  const journal = build.journal;
  if (!journal || build.index === null) return;
  const at = deps.now().toISOString();
  if (journal.kind === "proposal") {
    if (signatures.length === 0 && pending.length === 0) return;
    await recordPartnerProposal(deps.store, {
      cluster: deps.network,
      multisig: build.multisig,
      vault: journal.vault,
      index: build.index,
      proposedBy: build.wallet,
      proposedAt: at,
      signatures: [...signatures, ...pending],
      complete: state === "CONFIRMED",
      lines: journal.lines,
    });
    return;
  }
  /* A line still unconfirmed is recorded too: it may land, and a claim on chain that the journal never named would read
     as one made outside Ryntra. The panel holds each signature against the chain either way. */
  const runs = [...signatures.map((signature) => ({ signature, pending: false })), ...pending.map((signature) => ({ signature, pending: true }))]
    .map((run, position) => ({ item: journal.items[position]!, ...run }))
    .filter((run) => run.item !== undefined);
  if (runs.length) await recordPartnerExecutions(deps.store, { cluster: deps.network, multisig: build.multisig, index: build.index, runs, at, by: build.wallet });
}
