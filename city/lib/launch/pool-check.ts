import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { DLMM_PRO_PROGRAM_ID } from '../../../lib/core/launch/dlmm-pro.ts';
import type { PoolStage } from './pool.ts';

/**
 * A step of a launch into a pool, read before the wallet sees it. The review showed one launch — this
 * coin, by this creator, into this pool. The engine builds the bytes and holds the signed ones to them itself
 * (`signedAsBuilt`); this is the city's own second look at the top level of each transaction. What it holds:
 *
 * - the creator pays for every transaction, and at most one key signs beside it — the coin's own mint in the first
 *   step; the pool's creation is signed by the creator alone; no address table hides an account;
 * - only the programs the step is made of are called at the top level: the token programs, the associated-token
 *   program and the system program for the coin; Meteora's DLMM Pro beside them for the pool and the supply;
 * - the system program makes one account in the first step — the coin's mint, owned by Token-2022, with no more SOL
 *   than a mint's rent — and later moves no more than the single lamport a pool against SOL is proved with;
 * - no top-level token instruction moves or hands out the creator's tokens: no transfer, no approval, no authority
 *   given to anyone; a transfer of exactly one indivisible token — Ryntra's position's NFT handed over — is the one
 *   transfer it lets through, at most once a step and only where the launch has the split; an authority may only be
 *   given up;
 * - every call of DLMM Pro names the launch's pool, and the pool's step makes one; an account a step closes pays its
 *   lamports back to the creator, and nothing is burnt.
 *
 * What it does not read: the inside of a DLMM Pro instruction — which pool's call it is beyond naming the launch's
 * pool, how much it deposits. That is the engine's to build and its own check to hold.
 */

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

/** Token-2022's address as its 32 bytes, for the owner a CreateAccount names. */
const TOKEN_2022_BYTES = Array.from(new PublicKey(TOKEN_2022).toBytes());

const ALLOWED: Readonly<Record<PoolStage, ReadonlySet<string>>> = {
  COIN: new Set([COMPUTE_BUDGET, SYSTEM, TOKEN_2022, ASSOCIATED]),
  POOL: new Set([COMPUTE_BUDGET, SYSTEM, TOKEN, TOKEN_2022, ASSOCIATED, DLMM_PRO_PROGRAM_ID]),
  SUPPLY: new Set([COMPUTE_BUDGET, SYSTEM, TOKEN, TOKEN_2022, ASSOCIATED, DLMM_PRO_PROGRAM_ID]),
};

/** The most the system program may move in the pool's and the supply's steps: the lamport a pool against SOL is proved with, and room for nothing else. */
export const MAX_PROOF_LAMPORTS = 1_000n;
/** The most the coin's own account may be given: a Token-2022 mint with its metadata is some 0.004 SOL of rent. */
export const MAX_MINT_RENT_LAMPORTS = 20_000_000n;

/**
 * Whether a top-level token instruction moves or hands out tokens — by the token programs' own opcodes and their exact
 * lengths, so an instruction of another interface the token program also serves (its metadata's) is not taken for one.
 */
function movesTokens(data: Uint8Array): boolean {
  const op = data[0];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  /* Transfer, Approve: an amount. */
  if ((op === 3 || op === 4) && data.length === 9) return true;
  /* ApproveChecked: an amount and the decimals. */
  if (op === 13 && data.length === 10) return true;
  /* TransferChecked: one indivisible token — an NFT handed over — and nothing else. */
  if (op === 12 && data.length === 10) return !(view.getBigUint64(1, true) === 1n && data[9] === 0);
  /* SetAuthority: giving an authority up (no new authority) is the coin's honesty; giving it to anyone is not. */
  if (op === 6 && (data.length === 3 || data.length === 35)) return data[2] !== 0;
  /* Token-2022's transfer with a fee. */
  if (op === 26 && data[1] === 1) return true;
  /* Burn, BurnChecked; Token-2022's withdrawal of an account's spare lamports. */
  if ((op === 8 && data.length === 9) || (op === 15 && data.length === 10) || (op === 38 && data.length === 1)) return true;
  return false;
}

/** TransferChecked of one indivisible token: a position's NFT handed over. */
const handsOverNft = (data: Uint8Array): boolean => data.length === 10 && data[0] === 12 && new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(1, true) === 1n && data[9] === 0;

/** CloseAccount: one byte, 9 — its lamports go to the account named second. */
const closesTo = (data: Uint8Array, accounts: readonly string[]): string | null => (data.length === 1 && data[0] === 9 ? (accounts[1] ?? '') : null);

export type PoolCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

const no = (reason: string): PoolCheck => ({ ok: false, reason });

/**
 * `poolSigner` — the one wallet that may sign the pool's creation beside the creator: a dynamic config's own, where the
 * launch's pool is made from one (switched off until Meteora gives Ryntra its config, D-M1). Absent — nobody.
 * `handOvers` — how many NFTs the step may hand over: one in the supply's step of a launch with the split (Ryntra's
 * position), none otherwise. Absent — none.
 */
export function checkPoolStep(args: Readonly<{ wires: readonly string[]; stage: PoolStage; creator: string; mint: string; pool: string; poolSigner?: string | null; handOvers?: number }>): PoolCheck {
  const { stage, creator, mint, pool } = args;
  if (args.wires.length === 0 || args.wires.length > 4) return no('The step is not the transactions the launch is made of.');
  let callsPool = false;
  let handed = 0;
  const handOvers = stage === 'SUPPLY' ? Math.min(1, Math.max(0, args.handOvers ?? 0)) : 0;
  for (const [index, wire] of args.wires.entries()) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Uint8Array.from(atob(wire), (char) => char.charCodeAt(0)));
    } catch {
      return no('The step could not be read.');
    }
    const message = tx.message;
    /* An address table would hide the accounts a transaction names: the launch needs none. */
    if (message.addressTableLookups.length > 0) return no('The step names accounts the review cannot read.');
    const keys = message.staticAccountKeys.map((key) => key.toBase58());
    const signers = keys.slice(0, message.header.numRequiredSignatures);
    if (signers[0] !== creator) return no('The creator does not pay for the step.');
    if (signers.length > 2) return no('The step asks for a signature the launch does not need.');
    if (stage === 'COIN' && (signers.length !== 2 || signers[1] !== mint)) return no('The first step is not this coin’s creation.');
    if (stage === 'POOL' && signers.length !== 1 && !(signers.length === 2 && args.poolSigner && signers[1] === args.poolSigner)) return no('The pool’s creation asks for another signature.');
    for (const ix of message.compiledInstructions) {
      const program = keys[ix.programIdIndex];
      if (!program || !ALLOWED[stage].has(program)) return no('The step calls a program the launch is not made of.');
      /* Every call of DLMM Pro is a call on the launch's own pool; a transaction without one — a position's NFT handed over — calls none. */
      if (program === DLMM_PRO_PROGRAM_ID) {
        if (!ix.accountKeyIndexes.some((at) => keys[at] === pool)) return no('The step is not for this launch’s pool.');
        callsPool = true;
      }
      if ((program === TOKEN || program === TOKEN_2022) && movesTokens(ix.data)) return no('The step moves or hands out tokens the launch does not.');
      if ((program === TOKEN || program === TOKEN_2022) && handsOverNft(ix.data) && (handed += 1) > handOvers) return no('The step hands over more than Ryntra’s own position.');
      const closed = program === TOKEN || program === TOKEN_2022 ? closesTo(ix.data, ix.accountKeyIndexes.map((at) => keys[at] ?? '')) : null;
      if (closed !== null && closed !== creator) return no('The step closes an account into another wallet.');
      if (program !== SYSTEM) continue;
      const data = ix.data;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const kind = data.length >= 4 ? view.getUint32(0, true) : -1;
      if (stage === 'COIN') {
        /* CreateAccount — lamports, space, owner: the creator funds the coin's own account, a mint's rent and no more, owned by Token-2022. */
        const owner = data.length >= 52 ? data.subarray(20, 52) : null;
        const ownerOk = owner !== null && Array.from(owner).every((byte, at) => byte === TOKEN_2022_BYTES[at]);
        if (kind !== 0 || data.length < 52 || keys[ix.accountKeyIndexes[1] ?? -1] !== mint || index !== 0 || view.getBigUint64(4, true) > MAX_MINT_RENT_LAMPORTS || !ownerOk) return no('The first step moves SOL the coin does not need.');
      } else {
        /* Transfer: the one lamport a pool against SOL is proved with. */
        const lamports = kind === 2 && data.length >= 12 ? new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(4, true) : null;
        if (lamports === null || lamports > MAX_PROOF_LAMPORTS) return no('The step moves SOL the launch does not need.');
      }
    }
  }
  if (stage === 'POOL' && !callsPool) return no('The step is not for this launch’s pool.');
  return { ok: true };
}
