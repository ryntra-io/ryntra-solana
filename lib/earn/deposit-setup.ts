/**
 * CITY-204 — what a first deposit into Jupiter Lend needs around the Lend API's own instruction.
 *
 * `POST /lend/v1/earn/deposit` answers one legacy transaction with one instruction — the program's `Deposit` — and nothing
 * else (read live 5.11.2026 for USDC and for SOL: 714 bytes, no lookup tables). That instruction expects two token
 * accounts that already exist: the wallet's account of the asset it takes from (`depositor_token_account`) and its account
 * of the jlToken it pays into (`recipient_token_account`). A wallet that never held the jlToken has no such account, and a
 * SOL deposit takes wrapped SOL, which a wallet holding native SOL does not have: on the mainnet fork both fail with
 * `AccountNotInitialized` (`docs/research/city-204-autopilot/REPORT.md`). So the bytes the person signs carry, before the
 * deposit: the jlToken account, created if absent (idempotent); for SOL, the wrapped-SOL account, the SOL moved into it and
 * synced; and after the deposit, that wrapped-SOL account closed again when it held nothing before — the rent comes back.
 *
 * Every added instruction moves only the person's own SOL into her own accounts; the deposit is the API's, byte for byte.
 * Pure: the accounts are read off the deposit itself and checked against the addresses they must be; anything unexpected
 * leaves the bytes as the API built them.
 */

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";

export const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
/** The deposit's accounts, as the Lend program's IDL names them: the signer, what it takes from, what it pays into. */
export const DEPOSIT_ACCOUNTS = Object.freeze({ signer: 0, depositor: 1, recipient: 2 });
const PACKET = 1232;

export type DepositSetup = Readonly<{
  owner: string;
  assetMint: string;
  shareMint: string;
  amountRaw: bigint;
  /** What the wallet holds of wrapped SOL now; null — not read. Closed after the deposit only when it held none. */
  heldWsolRaw: bigint | null;
}>;

/** The token program whose associated account of `mint` for `owner` is `account`; null — neither. */
function programOf(account: PublicKey, mint: PublicKey, owner: PublicKey): PublicKey | null {
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) if (getAssociatedTokenAddressSync(mint, owner, true, program).equals(account)) return program;
  return null;
}

/**
 * The API's deposit with what a first deposit needs around it; the very bytes it came with when anything is not as it must
 * be (a version-0 message, a second instruction, accounts that are not her associated ones) or when the result would not
 * fit a packet.
 */
export function withDepositSetup(wireBase64: string, setup: DepositSetup): Readonly<{ wireBase64: string; added: readonly string[] }> {
  const unchanged = { wireBase64, added: [] as string[] };
  let tx: Transaction;
  try {
    const bytes = Buffer.from(wireBase64, "base64");
    /* A legacy message's first byte after the signatures has no version bit. */
    tx = Transaction.from(bytes);
  } catch {
    return unchanged;
  }
  if (tx.instructions.length !== 1 || !tx.recentBlockhash) return unchanged;
  const owner = new PublicKey(setup.owner);
  const deposit = tx.instructions[0]!;
  const keys = deposit.keys;
  if (keys.length <= DEPOSIT_ACCOUNTS.recipient || !keys[DEPOSIT_ACCOUNTS.signer]!.pubkey.equals(owner) || !tx.feePayer?.equals(owner)) return unchanged;
  const asset = new PublicKey(setup.assetMint);
  const share = new PublicKey(setup.shareMint);
  const depositor = keys[DEPOSIT_ACCOUNTS.depositor]!.pubkey;
  const recipient = keys[DEPOSIT_ACCOUNTS.recipient]!.pubkey;
  const shareProgram = programOf(recipient, share, owner);
  const assetProgram = programOf(depositor, asset, owner);
  if (!shareProgram || !assetProgram) return unchanged;

  const before: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(owner, recipient, owner, share, shareProgram, ASSOCIATED_TOKEN_PROGRAM_ID)];
  const after: TransactionInstruction[] = [];
  const added = ["share-account"];
  if (asset.equals(WSOL)) {
    if (setup.amountRaw <= 0n) return unchanged;
    before.push(
      createAssociatedTokenAccountIdempotentInstruction(owner, depositor, owner, WSOL, assetProgram, ASSOCIATED_TOKEN_PROGRAM_ID),
      SystemProgram.transfer({ fromPubkey: owner, toPubkey: depositor, lamports: setup.amountRaw }),
      createSyncNativeInstruction(depositor, assetProgram),
    );
    added.push("wrap");
    if (setup.heldWsolRaw === 0n) {
      after.push(createCloseAccountInstruction(depositor, owner, owner, [], assetProgram));
      added.push("unwrap-empty");
    }
  }
  const next = new Transaction({ feePayer: owner, blockhash: tx.recentBlockhash, lastValidBlockHeight: 0 }).add(...before, deposit, ...after);
  let wire: Buffer;
  try {
    wire = next.serialize({ requireAllSignatures: false, verifySignatures: false });
  } catch {
    return unchanged;
  }
  return wire.length <= PACKET ? { wireBase64: wire.toString("base64"), added } : unchanged;
}
