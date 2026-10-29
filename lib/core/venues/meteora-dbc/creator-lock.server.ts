/**
 * The creator's lock on Met Lock — the escrow a creator's first purchase goes
 * into when they choose to lock it, and the chain's word on it afterwards.
 *
 * The escrow is built from Met Lock's own program (`@meteora-ag/met-lock-sdk`)
 * with its instruction called directly: the SDK's helper reads the mint for a
 * transfer hook, and the mint does not exist yet when the lock is built beside
 * the launch — a preset's mint never carries a hook, so there is nothing to
 * read. The creator is sender, recipient and payer; the escrow's base is a
 * fresh key signed in here, like the mint of a launch, and handed back with the
 * build so a caller whose wallet signs first can sign with it after. Nobody may cancel the
 * escrow or change its recipient (`cancelMode` and `updateRecipientMode` 0).
 *
 * Server-only: it reads the chain through the connection it is given.
 */

import { LOCK_PROGRAM_ID, LockClient, deriveEscrow } from "@meteora-ag/met-lock-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";

import type { Address, UnsignedTx } from "../../contracts.ts";
import { MET_LOCK_NOBODY, creatorLockTerms, type CreatorLockSchedule } from "../../launch/creator-lock.ts";
import { tokenAccountOf } from "./exit.ts";

export const MET_LOCK_PROGRAM = LOCK_PROGRAM_ID.toBase58();

/** A built lock: the bytes the creator signs and the escrow they open. */
export type CreatorLockBuild = UnsignedTx & Readonly<{ escrow: Address; amountRaw: string; cliffAt: number; endsAt: number; /** The creator's SOL it takes: the escrow's and its token account's rent, and the fee of two signatures. */ costLamports: string; /** The escrow's fresh base key. */ baseKey: Keypair }>;

/** A lock as the chain stores it. */
export type CreatorLockObservation = Readonly<{
  escrow: Address;
  program: Address;
  mint: Address;
  creator: Address;
  recipient: Address;
  /** Everything the escrow will ever release, raw: the cliff's share and every period's. */
  totalRaw: string;
  claimedRaw: string;
  /** The tokens the escrow's own account holds now, raw. */
  heldRaw: string;
  cliffAt: number;
  endsAt: number;
  cancelMode: number;
  updateRecipientMode: number;
  cancelledAt: number;
}>;

export function buildCreatorLockTransaction(args: Readonly<{
  connection: Connection;
  mint: Address;
  creator: Address;
  amountRaw: bigint;
  schedule: CreatorLockSchedule;
  startSeconds: number;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}>): Promise<CreatorLockBuild> {
  return (async () => {
    const lock = new LockClient(args.connection, "confirmed");
    const mint = new PublicKey(args.mint);
    const creator = new PublicKey(args.creator);
    const base = Keypair.generate();
    const escrow = deriveEscrow(base.publicKey);
    const terms = creatorLockTerms(args.amountRaw, args.schedule, args.startSeconds);
    const senderToken = getAssociatedTokenAddressSync(mint, creator, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const escrowToken = getAssociatedTokenAddressSync(mint, escrow, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const instruction = await lock.program.methods
      .createVestingEscrowV2(
        {
          vestingStartTime: new BN(terms.vestingStartTime),
          cliffTime: new BN(terms.cliffTime),
          frequency: new BN(terms.frequency),
          cliffUnlockAmount: new BN(terms.cliffUnlockAmount.toString()),
          amountPerPeriod: new BN(terms.amountPerPeriod.toString()),
          numberOfPeriod: new BN(terms.numberOfPeriod),
          updateRecipientMode: MET_LOCK_NOBODY,
          cancelMode: MET_LOCK_NOBODY,
        },
        null,
      )
      .accountsPartial({ base: base.publicKey, senderToken, recipient: creator, tokenMint: mint, sender: creator, tokenProgram: TOKEN_2022_PROGRAM_ID })
      .instruction();
    const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(creator, escrowToken, escrow, mint, TOKEN_2022_PROGRAM_ID), instruction);
    tx.feePayer = creator;
    tx.recentBlockhash = args.recentBlockhash;
    tx.partialSign(base);
    /* What the lock costs the creator: rent for the escrow and its token account (Token-2022, the mint's metadata extension makes it no larger), and the fee. */
    const escrowSize = (lock.program.account as unknown as { vestingEscrow: { size: number } }).vestingEscrow.size;
    const rent = await Promise.all([args.connection.getMinimumBalanceForRentExemption(escrowSize), args.connection.getMinimumBalanceForRentExemption(170)]);
    const fee = (await args.connection.getFeeForMessage(tx.compileMessage(), "confirmed").catch(() => ({ value: 10_000 }))).value ?? 10_000;
    return {
      network: "solana",
      wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"),
      validUntil: String(args.lastValidBlockHeight),
      escrow: escrow.toBase58(),
      amountRaw: args.amountRaw.toString(),
      cliffAt: terms.cliffTime,
      endsAt: terms.endTime,
      costLamports: String(rent[0] + rent[1] + fee),
      baseKey: base,
    };
  })();
}

/** The escrow as the chain stores it, with what its token account holds; null when there is no escrow at the address. A read that fails throws. */
export async function observeCreatorLock(connection: Connection, escrow: Address): Promise<CreatorLockObservation | null> {
  const info = await connection.getAccountInfo(new PublicKey(escrow), "confirmed");
  if (!info || !info.owner.equals(LOCK_PROGRAM_ID)) return null;
  const lock = new LockClient(connection, "confirmed");
  const state = await lock.getEscrow(new PublicKey(escrow));
  const escrowToken = getAssociatedTokenAddressSync(state.tokenMint, new PublicKey(escrow), true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  /*
   * What the escrow holds, from its token account's own bytes: `getTokenAccountBalance` is an indexed request the public
   * node refuses, and a refusal read as «0» once made $WICK's lock vanish. An account that is not there holds nothing; a
   * read that fails throws — the lock is then not read, never empty.
   */
  const fetched = await connection.getAccountInfo(escrowToken, "confirmed");
  /* A closed account that someone sent lamports to is the system program's with no data: it holds nothing too. */
  const account = fetched && fetched.data.length === 0 && fetched.owner.equals(SystemProgram.programId) ? null : fetched;
  const held = account ? tokenAccountOf(account.data) : null;
  if (account && (!held || !account.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error(`The escrow's token account ${escrowToken.toBase58()} is not a Token-2022 account.`);
  const total = new BN(state.cliffUnlockAmount.toString()).add(new BN(state.amountPerPeriod.toString()).mul(new BN(state.numberOfPeriod.toString())));
  const cliffAt = Number(state.cliffTime.toString());
  return {
    escrow,
    program: info.owner.toBase58(),
    mint: state.tokenMint.toBase58(),
    creator: state.creator.toBase58(),
    recipient: state.recipient.toBase58(),
    totalRaw: total.toString(),
    claimedRaw: state.totalClaimedAmount.toString(),
    heldRaw: (held?.amount ?? 0n).toString(),
    cliffAt,
    endsAt: cliffAt + Number(state.frequency.toString()) * Number(state.numberOfPeriod.toString()),
    cancelMode: state.cancelMode,
    updateRecipientMode: state.updateRecipientMode,
    cancelledAt: Number(state.cancelledAt.toString()),
  };
}
