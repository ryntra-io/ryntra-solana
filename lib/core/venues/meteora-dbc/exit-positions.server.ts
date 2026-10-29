/**
 * The exit positions of a graduated launch, read without an indexed request.
 *
 * The public node production reads through refuses the requests a wallet's
 * positions are usually found with (`getTokenAccountsByOwner` behind the SDK's
 * `getUserPositionByPool`: «Indexed requests require a personal token», 403).
 * So the two positions are found where the chain itself names them — in the
 * move to the DEX (`./exit.ts`):
 *
 * 1. the move's signature: the one the caller knows (the executor's receipt of
 *    the graduation), or the curve's own signature list from when it was
 *    filled — on a node whose list reaches back that far — each transaction
 *    read until the one that migrated this curve into this pool;
 * 2. the positions and their NFT accounts, by address, in two reads;
 * 3. whose each one is: the holder of its NFT — the account it was minted into,
 *    or, when the NFT has moved, its largest account on a node that answers.
 *
 * What the move opened never changes, so it is found once a process; who holds
 * each NFT and what each position holds are read every time. A read that fails
 * throws `ExitUnread` — never an empty list, never a position counted as none.
 *
 * Server-only.
 */

import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, type Connection } from "@solana/web3.js";
import { getBase58Encoder } from "@solana/kit";

import { cpAmmOf } from "../meteora-clients.server.ts";
import { migrationExitOf, tokenAccountOf, type ExitSlot, type ExitTransaction } from "./exit.ts";
import { getTransactionAnyVersion } from "../../../solana/v1-tx.ts";

/** The exit could not be read now: said as not read by whoever asked. */
export class ExitUnread extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExitUnread";
  }
}

type PositionState = NonNullable<Awaited<ReturnType<CpAmm["fetchPositionState"]>>>;

/** One exit position now: where it is, whose NFT it is, and what it holds. */
export type ExitPosition = Readonly<{ position: string; nftMint: string; nftAccount: string; owner: string; state: PositionState }>;

export type ExitRead = Readonly<{ signature: string; pool: string; positions: readonly ExitPosition[] }>;

/** How many of the curve's signature pages a lookup lists, and how many of its transactions it reads. */
const PAGES = 5;
const TRANSACTIONS = 12;
const KEPT = 500;
/* What a move opened, by curve: found once a process — a failed lookup is asked again after a minute. */
const EXITS = new Map<string, Promise<Readonly<{ signature: string; slots: readonly ExitSlot[] }>>>();
const MISSED = new Map<string, number>();
const MISSED_PAUSE_MS = 60_000;

const distinct = (nodes: readonly (Connection | null | undefined)[]) => nodes.filter((node, index, all): node is Connection => Boolean(node) && all.findIndex((other) => other?.rpcEndpoint === node!.rpcEndpoint) === index);

async function transactionOf(nodes: readonly Connection[], signature: string): Promise<ExitTransaction | null> {
  for (const node of nodes) {
    const tx = await getTransactionAnyVersion(node, signature).catch(() => null);
    if (!tx?.meta) continue;
    const message = tx.transaction.message;
    const keys = message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const all: string[] = [];
    for (let index = 0; index < keys.length; index += 1) all.push(keys.get(index)?.toBase58() ?? "");
    const instructions: { programIndex: number; accounts: number[]; data: Uint8Array }[] = message.compiledInstructions.map((ix) => ({ programIndex: ix.programIdIndex, accounts: [...ix.accountKeyIndexes], data: Uint8Array.from(ix.data) }));
    for (const group of tx.meta.innerInstructions ?? []) {
      for (const ix of group.instructions) instructions.push({ programIndex: ix.programIdIndex, accounts: [...ix.accounts], data: Uint8Array.from(getBase58Encoder().encode(ix.data)) });
    }
    return { failed: tx.meta.err !== null, keys: all, instructions };
  }
  return null;
}

/**
 * The move's transaction and what it opened. A known signature is read first; else the curve's list, newest first, back
 * to the moment it was filled — trusted only from a node whose list reaches past that moment.
 */
async function findExit(args: Readonly<{ readers: readonly Connection[]; listers: readonly Connection[]; curve: string; pool: string; finishedAt: number | null; known: string | null }>) {
  const opened = async (signature: string) => {
    const tx = await transactionOf(args.readers, signature);
    const slots = tx ? migrationExitOf(tx, args.curve, args.pool) : null;
    return slots ? { signature, slots } : null;
  };
  if (args.known) {
    const found = await opened(args.known);
    if (found) return found;
  }
  for (const node of args.listers) {
    const candidates: string[] = [];
    let reached = args.finishedAt === null;
    let before: string | undefined;
    try {
      for (let page = 0; page < PAGES; page += 1) {
        const batch = await node.getSignaturesForAddress(new PublicKey(args.curve), { before, limit: 1_000 }, "confirmed");
        for (const entry of batch) {
          const at = entry.blockTime ?? null;
          if (args.finishedAt !== null && at !== null && at < args.finishedAt) reached = true;
          else if (entry.err === null) candidates.push(entry.signature);
        }
        if (reached || batch.length < 1_000) break;
        before = batch.at(-1)?.signature;
      }
    } catch {
      continue;
    }
    /* A list a node cut short says nothing of what came before its end: the next node is asked. */
    if (!reached && args.finishedAt !== null) continue;
    /* The oldest first: the move comes right after the curve was filled. */
    for (const signature of candidates.reverse().slice(0, TRANSACTIONS)) {
      const found = await opened(signature);
      if (found) return found;
    }
  }
  throw new ExitUnread("The move to the DEX was not found on any node.");
}

/**
 * The signature of `curve`'s migration into `pool`, alone — no read of the positions it opened or of who holds them: a
 * known signature checked first (the executor's receipt), else the curve's list after it was filled. Throws `ExitUnread`
 * when not found on any node.
 */
export async function findMigrationSignature(args: Readonly<{ connection: Connection; readers?: readonly (Connection | null | undefined)[]; curve: string; pool: string; finishedAt: number | null; known?: string | null }>): Promise<string> {
  const nodes = distinct([...(args.readers ?? []), args.connection]);
  return (await findExit({ readers: nodes, listers: nodes, curve: args.curve, pool: args.pool, finishedAt: args.finishedAt, known: args.known ?? null })).signature;
}

/**
 * The exit positions of `curve`'s graduation into `pool`, read now. `connection` reads accounts; `readers` — transactions
 * and signature lists, in order (a node with older transactions, one whose lists reach back); `indexed` — a node that
 * answers a mint's largest accounts, asked only when an NFT has left the account it was minted into.
 */
export async function readExitPositions(args: Readonly<{
  connection: Connection;
  readers?: readonly (Connection | null | undefined)[];
  indexed?: Connection | null;
  curve: string;
  pool: string;
  /** When the curve was filled (unix seconds); null when not known. */
  finishedAt: number | null;
  /** The move's signature when the caller knows it — the executor's receipt of the graduation. */
  known?: string | null;
}>): Promise<ExitRead> {
  /* An old transaction is kept by the nodes that keep history, not by the public main one: they are asked first. */
  const readers = distinct([...(args.readers ?? []), args.connection]);
  const listers = distinct([...(args.readers ?? []), args.connection]);
  const key = `${args.connection.rpcEndpoint}:${args.curve}`;
  let exit = EXITS.get(key);
  if (!exit) {
    const missed = MISSED.get(key);
    /* A recent miss pauses the search; a caller that names the move's signature still has that one read, and no list. */
    const paused = missed !== undefined && Date.now() - missed < MISSED_PAUSE_MS;
    if (paused && !args.known) throw new ExitUnread("The move to the DEX was not found a moment ago.");
    exit = findExit({ readers, listers: paused ? [] : listers, curve: args.curve, pool: args.pool, finishedAt: args.finishedAt, known: args.known ?? null });
    EXITS.set(key, exit);
    exit.catch(() => {
      EXITS.delete(key);
      MISSED.set(key, Date.now());
      while (MISSED.size > KEPT) MISSED.delete(MISSED.keys().next().value as string);
    });
    while (EXITS.size > KEPT) EXITS.delete(EXITS.keys().next().value as string);
  }
  const { signature, slots } = await exit;
  const cpAmm = cpAmmOf(args.connection);
  const program = cpAmm._program as unknown as { account: { position: { fetchMultiple(addresses: PublicKey[]): Promise<(PositionState | null)[]> } } };
  let states: (PositionState | null)[];
  let nftAccounts: Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>;
  try {
    [states, nftAccounts] = await Promise.all([
      program.account.position.fetchMultiple(slots.map((slot) => new PublicKey(slot.position))),
      args.connection.getMultipleAccountsInfo(slots.map((slot) => new PublicKey(slot.nftAccount)), "confirmed"),
    ]);
  } catch (error) {
    throw new ExitUnread(`The exit positions were not read: ${error instanceof Error ? error.message.slice(0, 200) : "the node failed"}.`);
  }
  const positions: ExitPosition[] = [];
  for (const [index, slot] of slots.entries()) {
    const state = states[index] ?? null;
    /* A locked position cannot be closed: one not found is a read gone wrong, not a position gone. */
    if (!state) throw new ExitUnread(`The exit position ${slot.position} was not read.`);
    if (state.pool.toBase58() !== args.pool || state.nftMint.toBase58() !== slot.nftMint) throw new ExitUnread(`The exit position ${slot.position} is not the move's.`);
    const minted = nftAccounts[index] ?? null;
    const held = minted ? tokenAccountOf(minted.data) : null;
    let owner: string | null = null;
    let nftAccount = slot.nftAccount;
    if (held && new PublicKey(held.mint).toBase58() === slot.nftMint && held.amount === 1n) owner = new PublicKey(held.owner).toBase58();
    else {
      /* The NFT has moved: its holder now is the one account of its mint that holds it. */
      const where = await holderOfNft(args.indexed ?? null, args.connection, slot.nftMint);
      if (!where) throw new ExitUnread(`Who holds the exit position ${slot.position} was not read.`);
      owner = where.owner;
      nftAccount = where.account;
    }
    positions.push({ position: slot.position, nftMint: slot.nftMint, nftAccount, owner, state });
  }
  return { signature, pool: args.pool, positions };
}

async function holderOfNft(indexed: Connection | null, connection: Connection, nftMint: string): Promise<Readonly<{ owner: string; account: string }> | null> {
  for (const node of distinct([indexed, connection])) {
    try {
      const largest = await node.getTokenLargestAccounts(new PublicKey(nftMint), "confirmed");
      const account = largest.value.find((entry) => entry.amount === "1")?.address ?? null;
      if (!account) continue;
      const info = await connection.getAccountInfo(account, "confirmed");
      const held = info && (info.owner.equals(TOKEN_2022_PROGRAM_ID) || info.owner.equals(TOKEN_PROGRAM_ID)) ? tokenAccountOf(info.data) : null;
      /* The node's answer is checked against the chain: an account of this NFT's mint that holds it. */
      if (held && new PublicKey(held.mint).toBase58() === nftMint && held.amount === 1n) return { owner: new PublicKey(held.owner).toBase58(), account: account.toBase58() };
    } catch {
      /* the next node */
    }
  }
  return null;
}
