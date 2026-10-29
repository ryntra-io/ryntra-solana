/**
 * The partner's claims through its Squads multisig (SOL-L1d) — Ryntra's share of every launch on «Класичний»,
 * «Захищений», «Спільнота» and «Розширений», whose config names the multisig's vault as its fee claimer.
 *
 * - `planPartnerClaims` — every Ryntra launch whose config's fee claimer on chain is this vault, each source holding
 *   something now: the curve's partner fee, the partner's migration fee, the partner's share of the surplus and the fees
 *   of the partner's locked position in the graduated pool — found where the move to the DEX names it, never from a
 *   node's index of the vault's positions. Each claim is built for the vault as its only signer, paying only into the
 *   vault's own token accounts; an account the vault does not have yet is opened by whoever proposes, out of their SOL,
 *   so the vault's own SOL pays for nothing. The treasury page wraps the claims in one Squads proposal its members vote
 *   on (`lib/solana/treasury`); nothing here signs.
 * - The revenue journal (`launchPartnerClaims`) — each proposal made through Ryntra with the claims it carries, and each
 *   execution sent through Ryntra with its signature: Ryntra's own record of the vault's claims, which the financial
 *   panel (SOL-F1) holds against what the chain shows the vault claimed — a claim the chain shows that the journal does
 *   not name, or one the journal names that the chain does not, is a difference with its proof.
 *
 * Server-only.
 */

import * as multisig from "@sqds/multisig";
import { getUnClaimLpFee } from "@meteora-ag/cp-amm-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, TransactionMessage, type Connection, type TransactionInstruction } from "@solana/web3.js";

import type { BudgetSource } from "../core/launch/budget.ts";
import { readExitPositions } from "../core/venues/meteora-dbc/exit-positions.server.ts";
import { readClaimLine } from "../core/venues/meteora-dbc/partner-claim-lines.ts";
import { PartnerClaimRefusal, buildPartnerClaim, readPartnerFees, type PartnerFeesRead } from "../core/venues/meteora-dbc/partner.server.ts";
import { launchPreset } from "../core/venues/meteora-dbc/presets.ts";
import { cpAmmOf } from "../core/venues/meteora-clients.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { autopilotReceipts } from "./autopilot.server.ts";
import { launchHistoryConnection, type LaunchNetwork } from "./config.server.ts";
import type { LaunchRecord } from "./flow.server.ts";

export type PartnerClaimDeps = Readonly<{ network: LaunchNetwork; connection: Connection; store: GuardStore; second?: Connection | null }>;

/** The sources a claim takes, in the order a line carries them. */
export const PARTNER_SOURCES: readonly BudgetSource[] = ["curve", "migration", "surplus", "lp"];
/**
 * The most launches with something to claim one proposal carries: each is a line or two of the batch, and a proposal's
 * transactions are signed in one prompt and sent inside one route's minute (`lib/solana/treasury`). The others wait for
 * the next proposal — the ones claimed longest ago first, so every launch comes round.
 */
export const LAUNCHES_PER_PROPOSAL = 4;
/* Launches last read with nothing to claim, by when: kept a process, bounded. */
const EMPTY_AT = new Map<string, number>();

/**
 * The partner's locked position, read where the chain names it — in the move to the DEX —, with its unclaimed fees; the
 * index's answer is never used for a claim. The exit not read leaves the position unread (`lpUnread`), never «none».
 */
export async function partnerLpFromExit(deps: PartnerClaimDeps, record: Pick<LaunchRecord, "token" | "pool">, read: PartnerFeesRead): Promise<PartnerFeesRead> {
  if (!read.dammPool) return read;
  try {
    const known = (await autopilotReceipts(deps.store, deps.network.cluster, record.token).catch(() => [])).find((receipt) => receipt.kind === "GRADUATED")?.signature ?? null;
    const exit = await readExitPositions({ connection: deps.connection, readers: [deps.second ?? null, launchHistoryConnection(deps.network)], indexed: deps.second ?? null, curve: record.pool, pool: read.dammPool, finishedAt: null, known });
    const mine = exit.positions.find((position) => position.owner === read.feeClaimer);
    if (!mine) return { ...read, lp: null, lpUnread: false };
    const poolState = await cpAmmOf(deps.connection).fetchPoolState(new PublicKey(read.dammPool));
    const unclaimed = getUnClaimLpFee(poolState, mine.state);
    const pairIsB = poolState.tokenBMint.toBase58() === read.pairMint;
    return {
      ...read,
      lp: {
        pool: read.dammPool,
        position: mine.position,
        positionNftAccount: mine.nftAccount,
        pairRaw: BigInt((pairIsB ? unclaimed.feeTokenB : unclaimed.feeTokenA).toString()),
        tokenRaw: BigInt((pairIsB ? unclaimed.feeTokenA : unclaimed.feeTokenB).toString()),
      },
      lpUnread: false,
    };
  } catch {
    return { ...read, lp: null, lpUnread: true };
  }
}

/** One claim of one source of one launch, for the vault to sign: its instructions without any account opening. */
export type PartnerClaimPart = Readonly<{
  token: string;
  symbol: string;
  pool: string;
  pairMint: string;
  source: BudgetSource;
  /** What the source holds now, in the pair currency and in the token; the claim takes all it holds when it runs. */
  pairRaw: bigint;
  tokenRaw: bigint;
  instructions: readonly TransactionInstruction[];
}>;

/** A token account of the vault's that a claim pays into and that does not exist yet: the proposer opens it. */
export type VaultAccountOpen = Readonly<{ account: string; mint: string; program: string }>;

export type PartnerClaimPlan = Readonly<{
  vault: string;
  parts: readonly PartnerClaimPart[];
  opens: readonly VaultAccountOpen[];
  /** Launches of this vault read whole. */
  launches: number;
  /** Launches whose fees, or a part of them, could not be read now: claimed later, said here. */
  unread: readonly string[];
  /** Launches not reached because this proposal is full: the next proposal takes them first. */
  later: readonly string[];
}>;

/** What a source holds now, in the pair currency and in the token; nothing when it holds nothing or is not read. */
function holding(read: PartnerFeesRead, source: BudgetSource): Readonly<{ pairRaw: bigint; tokenRaw: bigint }> | null {
  switch (source) {
    case "curve":
      return read.curveRaw > 0n || read.curveTokenRaw > 0n ? { pairRaw: read.curveRaw, tokenRaw: read.curveTokenRaw } : null;
    case "migration":
      return read.migrated && !read.migration.withdrawn && read.migration.raw > 0n ? { pairRaw: read.migration.raw, tokenRaw: 0n } : null;
    case "surplus":
      return !read.surplus.withdrawn && read.surplus.raw > 0n ? { pairRaw: read.surplus.raw, tokenRaw: 0n } : null;
    case "lp":
      return read.lp && (read.lp.pairRaw > 0n || read.lp.tokenRaw > 0n) ? { pairRaw: read.lp.pairRaw, tokenRaw: read.lp.tokenRaw } : null;
  }
}

/**
 * A claim's instructions as the vault signs them, and the vault's accounts it would open: the SDK opens a missing
 * account with the claimer as payer — in a vault transaction that is the vault's SOL —, so the opening is taken out and
 * the proposer makes it instead. What stays must read as a claim line (`readClaimLine`), or the part is not offered.
 */
export function splitOpenings(instructions: readonly TransactionInstruction[], vault: PublicKey): Readonly<{ claim: TransactionInstruction[]; opens: VaultAccountOpen[] }> | null {
  const claim: TransactionInstruction[] = [];
  const opens: VaultAccountOpen[] = [];
  for (const instruction of instructions) {
    if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      /* create / create_idempotent: payer, account, owner, mint, system, token program. Only the vault's own. */
      const [, account, owner, mint, , program] = instruction.keys.map((meta) => meta.pubkey);
      if (!account || !owner || !mint || !program || !owner.equals(vault)) return null;
      opens.push({ account: account.toBase58(), mint: mint.toBase58(), program: program.toBase58() });
      continue;
    }
    claim.push(instruction);
  }
  const message = new TransactionMessage({ payerKey: vault, recentBlockhash: PublicKey.default.toBase58(), instructions: claim });
  const bytes = multisig.utils.transactionMessageToMultisigTransactionMessageBytes({ message, vaultPda: vault });
  const [stored] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(bytes));
  if (readClaimLine(stored, vault).foreign) return null;
  return { claim, opens };
}

/**
 * The claims waiting for this vault now, for one proposal: launch by launch, those the journal shows claimed longest
 * ago — never first — leading, until `LAUNCHES_PER_PROPOSAL` launches have something to claim; the rest are named for
 * the next proposal (`later`). A launch read in part is named unread and its sources that were read are still offered; a
 * launch whose config pays another claimer is not this vault's.
 */
export async function planPartnerClaims(deps: PartnerClaimDeps, vault: string, options: Readonly<{ deadline?: number; launches?: number }> = {}): Promise<PartnerClaimPlan> {
  const deadline = options.deadline ?? Date.now() + 40_000;
  const cap = options.launches ?? LAUNCHES_PER_PROPOSAL;
  const vaultKey = new PublicKey(vault);
  /* When each launch was last claimed through this vault's proposals (a line run), or last found holding nothing: never —
     the oldest moment there is. A proposal never run claimed nothing, and does not push its launches back. */
  const journal = await readPartnerJournal(deps.store, deps.network.cluster).catch(() => [] as PartnerJournalEntry[]);
  const lastClaimed = new Map<string, number>();
  for (const entry of journal) {
    if (entry.vault !== vault) continue;
    for (const run of entry.executions) {
      const line = entry.lines.find((row) => row.item === run.item);
      if (line) lastClaimed.set(line.token, Math.max(lastClaimed.get(line.token) ?? 0, Date.parse(run.at)));
    }
    /* A proposal put to the votes whole and run nowhere Ryntra saw — its members may run it in Squads' own app — dates
       its launches by when it was proposed, so the same few never lead every plan. */
    if (entry.executions.length === 0 && entry.complete) for (const line of entry.lines) lastClaimed.set(line.token, Math.max(lastClaimed.get(line.token) ?? 0, Date.parse(entry.proposedAt)));
  }
  for (const [token, at] of EMPTY_AT) if (at > (lastClaimed.get(token) ?? 0)) lastClaimed.set(token, at);
  const records = (await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${deps.network.cluster}:`))
    .filter((record) => record.state === "LAUNCHED" && record.cluster === deps.network.cluster && launchPreset(record.preset)?.feeClaimer === "multisig")
    .sort((a, b) => (lastClaimed.get(a.token) ?? 0) - (lastClaimed.get(b.token) ?? 0) || Date.parse(a.launchedAt) - Date.parse(b.launchedAt));
  const parts: PartnerClaimPart[] = [];
  const opens = new Map<string, VaultAccountOpen>();
  const unread: string[] = [];
  const later: string[] = [];
  let launches = 0;
  let carried = 0;
  for (const record of records) {
    /* A full proposal leaves the rest to the next one; past the route's time a launch is unread, never «nothing». */
    if (carried >= cap) {
      later.push(record.token);
      continue;
    }
    if (Date.now() > deadline) {
      unread.push(record.token);
      continue;
    }
    let read: PartnerFeesRead;
    try {
      /* The locked position is read from the move to the DEX below: no index lookup the public node refuses. */
      read = await readPartnerFees(deps.connection, { token: record.token, pool: record.pool }, { lpFromIndex: false });
    } catch {
      unread.push(record.token);
      continue;
    }
    if (read.feeClaimer !== vault) continue;
    if (read.dammPool) read = await partnerLpFromExit(deps, record, read);
    let whole = !read.lpUnread;
    let any = false;
    for (const source of PARTNER_SOURCES) {
      const held = holding(read, source);
      if (!held) continue;
      try {
        const tx = await buildPartnerClaim(deps.connection, { read, source, claimer: vault });
        const split = splitOpenings(tx.instructions, vaultKey);
        if (!split) {
          whole = false;
          continue;
        }
        for (const open of split.opens) opens.set(open.account, open);
        parts.push({ token: record.token, symbol: record.symbol, pool: record.pool, pairMint: read.pairMint, source, ...held, instructions: split.claim });
        any = true;
      } catch (error) {
        if (error instanceof PartnerClaimRefusal && error.code === "NOTHING_TO_CLAIM") continue;
        whole = false;
      }
    }
    if (any) carried += 1;
    /* A launch read whole with nothing to claim goes to the back of the next plan's order (this process's memory). */
    else if (whole) {
      EMPTY_AT.delete(record.token);
      EMPTY_AT.set(record.token, Date.now());
    }
    if (whole) launches += 1;
    else unread.push(record.token);
  }
  while (EMPTY_AT.size > 2_000) EMPTY_AT.delete(EMPTY_AT.keys().next().value as string);
  return { vault, parts, opens: [...opens.values()], launches, unread, later };
}

/* ---------------------------------------------------------------- the revenue journal */

export const PARTNER_JOURNAL = "launchPartnerClaims" as const;

/** One line of a proposal: the batch's item and the claims it carries. */
export type PartnerJournalLine = Readonly<{
  item: number;
  token: string;
  pool: string;
  pairMint: string;
  /** Each claim with what its source held when it was proposed; the execution takes what it holds then. */
  claims: readonly Readonly<{ source: BudgetSource; pairRaw: string; tokenRaw: string }>[];
}>;

export type PartnerJournalEntry = Readonly<{
  cluster: string;
  multisig: string;
  vault: string;
  /** The proposal's number in the multisig. */
  index: string;
  proposedBy: string;
  proposedAt: string;
  /** The transactions that made the proposal, in order; `complete` — every one of them landed. */
  signatures: readonly string[];
  complete: boolean;
  lines: readonly PartnerJournalLine[];
  /**
   * Each line run through Ryntra, with its transaction; `pending` — sent and not confirmed when written: a later run of
   * the same line (the first one's bytes expired) replaces it.
   */
  executions: readonly Readonly<{ item: number; signature: string; at: string; by: string; pending?: boolean }>[];
}>;

const journalKey = (cluster: string, multisig: string, index: string) => `${cluster}:${multisig}:${index.padStart(20, "0")}`;

export async function recordPartnerProposal(store: GuardStore, entry: Omit<PartnerJournalEntry, "executions">): Promise<void> {
  const key = journalKey(entry.cluster, entry.multisig, entry.index);
  const known = await store.collection<PartnerJournalEntry>(PARTNER_JOURNAL).get(key);
  await store.collection<PartnerJournalEntry>(PARTNER_JOURNAL).set(key, { ...entry, executions: known?.executions ?? [] });
}

/**
 * Lines run through Ryntra, by their transactions — each item once: a confirmed run stays, a pending one gives way to a
 * later run of the same line.
 */
export async function recordPartnerExecutions(store: GuardStore, args: Readonly<{ cluster: string; multisig: string; index: string; runs: readonly Readonly<{ item: number; signature: string; pending?: boolean }>[]; at: string; by: string }>): Promise<boolean> {
  const key = journalKey(args.cluster, args.multisig, args.index);
  const known = await store.collection<PartnerJournalEntry>(PARTNER_JOURNAL).get(key);
  /* A proposal not made through Ryntra is not in the journal: its execution is not Ryntra's to record. */
  if (!known) return false;
  const executions = [...known.executions];
  for (const run of args.runs) {
    const row = { item: run.item, signature: run.signature, at: args.at, by: args.by, ...(run.pending ? { pending: true } : {}) };
    const at = executions.findIndex((existing) => existing.item === run.item);
    if (at < 0) executions.push(row);
    else if (executions[at]!.pending && executions[at]!.signature !== run.signature) executions[at] = row;
  }
  await store.collection<PartnerJournalEntry>(PARTNER_JOURNAL).set(key, { ...known, executions });
  return true;
}

export async function readPartnerJournal(store: GuardStore, cluster: string): Promise<readonly PartnerJournalEntry[]> {
  return store.collection<PartnerJournalEntry>(PARTNER_JOURNAL).valuesWithPrefix(`${cluster}:`);
}

/**
 * The journal's claims of one launch, as the financial panel compares them with the chain: each execution's signature
 * with the sources its line carried. The amount is the program's event's — the chain's, not the journal's — so none is
 * written here (`pairRaw: null`).
 */
export function partnerLedgerOf(entries: readonly PartnerJournalEntry[], token: string, vault: string): readonly Readonly<{ signature: string; source: BudgetSource; pairRaw: null }>[] {
  const out: { signature: string; source: BudgetSource; pairRaw: null }[] = [];
  for (const entry of entries) {
    if (entry.vault !== vault) continue;
    for (const execution of entry.executions) {
      const line = entry.lines.find((row) => row.item === execution.item && row.token === token);
      if (line) for (const claim of line.claims) out.push({ signature: execution.signature, source: claim.source, pairRaw: null });
    }
  }
  return out;
}
