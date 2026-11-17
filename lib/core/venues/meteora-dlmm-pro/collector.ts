/**
 * What a collector's key may sign: the bytes of one collect of one DLMM Pro limit order, read again
 * before the signature.
 *
 * A person may let a wallet collect their order — the program's one delegate permission. Meteora's program then lets
 * that wallet do exactly one thing: `cancel_limit_order` on the order, paying only into the holder's own associated
 * accounts. That is the program's rule, not this file's, and the rehearsal walks around the venue to show the chain
 * holding it. This file guards the other side — the collector's own key and the lamports it pays fees from: whatever
 * built the bytes, the key signs only a transaction that
 *
 * - is version 0 with no lookup table, paid for and signed by the collector alone;
 * - sets its compute budget within a ceiling, and nothing else of the kind;
 * - calls the program once, `cancel_limit_order`, for the order it was told, the collector as its signer, the holder's
 *   associated accounts as where both coins go, and for a referral either none or an account it was told;
 * - does nothing more: no account opened on the collector's rent, no transfer, no second call.
 *
 * So a collect that would open the holder a token account is not signed — the holder's accounts are opened by the
 * holder, when the order is placed — and nobody can have the collector's lamports spent on rent by resting orders.
 *
 * Pure: bytes in, a reason or null out. No SDK: the program's discriminator and account places are written here and
 * held to the IDL by `./collector.test.mjs`.
 */

import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, PublicKey, VersionedTransaction } from "@solana/web3.js";

import type { Address } from "../../contracts.ts";

/** `cancel_limit_order`, as the program's IDL names it. */
export const CANCEL_LIMIT_ORDER_DISCRIMINATOR = "849c841f4328e861";
/** Where the instruction keeps what the judge reads, and how many accounts it names before its tick arrays. */
export const CANCEL_ACCOUNTS = Object.freeze({ pool: 0, tokenXMint: 5, tokenYMint: 6, limitOrder: 7, nftAccount: 8, userTokenX: 9, userTokenY: 10, referralToken: 11, signer: 12, tokenXProgram: 13, tokenYProgram: 14, fixed: 18 });
/** The most compute a collect of 25 prices is given, and the most a collector pays for priority. */
export const COLLECTOR_MAX_UNITS = 400_000;
export const COLLECTOR_MAX_PRIORITY_LAMPORTS = 20_000;

export type CollectorFacts = Readonly<{
  program: Address;
  collector: Address;
  /** The holder of the order's NFT: what is collected goes to its associated accounts and nowhere else. */
  owner: Address;
  pool: Address;
  order: Address;
  nftAccount: Address;
  tokenX: Readonly<{ mint: Address; program: Address }>;
  tokenY: Readonly<{ mint: Address; program: Address }>;
  /** The referral token accounts the collect may pay: the order's own referral in the fee's coin. None — the collect names no referral. */
  referralAccounts: readonly Address[];
}>;

const COMPUTE_BUDGET = ComputeBudgetProgram.programId.toBase58();

/** Why the collector does not sign these bytes; null — it may. */
export function collectorRefusal(wireBase64: string, facts: CollectorFacts): string | null {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  } catch {
    return "The bytes are not a transaction.";
  }
  const message = tx.message;
  if (tx.version !== 0) return "Not a version-0 transaction.";
  if (message.addressTableLookups.length > 0) return "The transaction reads a lookup table.";
  if (message.header.numRequiredSignatures !== 1) return "The collector is not the only signer.";
  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  if (keys[0] !== facts.collector) return "The collector does not pay for the transaction.";

  let limit: number | null = null;
  let price = 0n;
  let calls = 0;
  for (const instruction of message.compiledInstructions) {
    const program = keys[instruction.programIdIndex];
    const data = Buffer.from(instruction.data);
    if (program === COMPUTE_BUDGET) {
      if (data[0] === 2 && data.length === 5 && limit === null) limit = data.readUInt32LE(1);
      else if (data[0] === 3 && data.length === 9) price = data.readBigUInt64LE(1);
      else return "A compute-budget setting the collector does not take.";
      continue;
    }
    if (program !== facts.program) return `An instruction of ${program}: a collect calls the program and nothing else.`;
    calls += 1;
    if (calls > 1) return "More than one call of the program.";
    if (data.subarray(0, 8).toString("hex") !== CANCEL_LIMIT_ORDER_DISCRIMINATOR) return "The call is not a collect.";
    if (instruction.accountKeyIndexes.length < CANCEL_ACCOUNTS.fixed) return "The collect names too few accounts.";
    const at = (index: number) => keys[instruction.accountKeyIndexes[index] ?? -1];
    if (at(CANCEL_ACCOUNTS.signer) !== facts.collector) return "The collect is not signed by the collector.";
    /* The collector's key stands in the call as its signer and nowhere else: not among a coin's transfer-hook accounts, where a program could take its signature for its own. */
    if (instruction.accountKeyIndexes.some((index, place) => place !== CANCEL_ACCOUNTS.signer && keys[index] === facts.collector)) return "The collector stands in the collect where only its signature should be.";
    if (at(CANCEL_ACCOUNTS.pool) !== facts.pool || at(CANCEL_ACCOUNTS.limitOrder) !== facts.order || at(CANCEL_ACCOUNTS.nftAccount) !== facts.nftAccount) return "The collect is of another order.";
    if (at(CANCEL_ACCOUNTS.tokenXMint) !== facts.tokenX.mint || at(CANCEL_ACCOUNTS.tokenYMint) !== facts.tokenY.mint) return "The collect names other coins than the pool's.";
    if (at(CANCEL_ACCOUNTS.tokenXProgram) !== facts.tokenX.program || at(CANCEL_ACCOUNTS.tokenYProgram) !== facts.tokenY.program) return "The collect names other token programs than the coins'.";
    const owner = new PublicKey(facts.owner);
    const own = (coin: CollectorFacts["tokenX"]) => getAssociatedTokenAddressSync(new PublicKey(coin.mint), owner, true, new PublicKey(coin.program), ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();
    if (at(CANCEL_ACCOUNTS.userTokenX) !== own(facts.tokenX) || at(CANCEL_ACCOUNTS.userTokenY) !== own(facts.tokenY)) return "What is collected would not go to the holder's own accounts.";
    const referral = at(CANCEL_ACCOUNTS.referralToken);
    /* An optional account left out is the program's own address. */
    if (referral !== facts.program && !facts.referralAccounts.includes(referral ?? "")) return "The collect pays a referral it was not told.";
  }
  if (calls !== 1) return "The transaction does not collect.";
  if (limit === null || limit > COLLECTOR_MAX_UNITS) return "The compute limit is unset or above the collector's ceiling.";
  if ((BigInt(limit) * price + 999_999n) / 1_000_000n > BigInt(COLLECTOR_MAX_PRIORITY_LAMPORTS)) return "The priority fee is above the collector's ceiling.";
  return null;
}
