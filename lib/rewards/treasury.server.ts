import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token-2022";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

import { readMintAccount } from "../solana/mint.ts";
import { createSolanaRpcHandle, withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";
import { sendTransactionOnce } from "../solana/submit-rpc.ts";
import { associatedTokenAccount } from "../solana/token-account.ts";
import { unconfiguredReserve, type RewardReserve } from "./balance.ts";
import { REWARD_PAYOUT_DECIMALS } from "./model.ts";

/**
 * The account rewards are paid from, and the only place in this product that
 * signs a transaction on the server.
 *
 * ## Why a separate wallet, and why a small one
 *
 * The owner's instruction names the properties and they are all constraints on
 * blast radius: it holds only Ryntra's money set aside for rewards, it holds no
 * customer funds, it is not custody of anybody's assets, it is not the owner's
 * trading wallet, and its authority is its own. A key that can sign lives in
 * the environment of a web deployment, and the honest way to hold one is to
 * make sure it cannot reach anything that matters. Everything this key can do
 * is send USDC that was put there to be sent.
 *
 * **`Available` is bounded by this account's balance** (`lib/rewards/balance.ts`),
 * so the product cannot offer a number this wallet cannot pay. Under-funding it
 * makes claims wait; it cannot make a payout bounce.
 *
 * ## What is never done here
 *
 * The secret is read from the environment, used to build a signer, and never
 * logged, returned, embedded in an error, or placed in any record. This module
 * carries the `.server` suffix the client-bundle check watches for, and nothing
 * in `app/` may import it into a client component.
 *
 * Nothing here decides *whether* to pay. The claim record does that, before
 * this module is reached, and it is what makes a payout happen once.
 */

const ADDRESS_VARIABLE = "RYNTRA_REWARDS_TREASURY_SOLANA";
const SECRET_VARIABLE = "RYNTRA_REWARDS_TREASURY_SECRET";
const MINT_VARIABLE = "RYNTRA_REWARDS_PAYOUT_MINT";

/** USDC on Solana mainnet. Overridable only so a stand can point elsewhere. */
const DEFAULT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type RewardsTreasuryConfig =
  | Readonly<{ configured: true; treasury: string; mint: string; canSign: boolean }>
  | Readonly<{ configured: false; reason: string }>;

/**
 * What this deployment is set up to pay with.
 *
 * `canSign` is separate from `configured` on purpose: an address alone is
 * enough to *read* a reserve and to show honest figures, and a deployment that
 * can read but not sign is a legitimate state — a preview, or production before
 * the key is set. It shows what is owed and does not offer Claim.
 */
export function rewardsTreasuryConfig(env: NodeJS.ProcessEnv = process.env): RewardsTreasuryConfig {
  const treasury = (env[ADDRESS_VARIABLE] ?? "").trim();
  if (!treasury) {
    return { configured: false, reason: `${ADDRESS_VARIABLE} is not set, so there is no Rewards payout account.` };
  }
  if (!BASE58.test(treasury)) {
    return { configured: false, reason: `${ADDRESS_VARIABLE} is not a Solana address.` };
  }
  const mint = (env[MINT_VARIABLE] ?? "").trim() || DEFAULT_MINT;
  if (!BASE58.test(mint)) return { configured: false, reason: `${MINT_VARIABLE} is not a mint address.` };
  return { configured: true, treasury, mint, canSign: (env[SECRET_VARIABLE] ?? "").trim().length > 0 };
}

/**
 * The payout signer, or null.
 *
 * Accepts the two shapes a Solana key is handed over in — a JSON array of 64
 * bytes as `solana-keygen` writes it, and base58 as a wallet exports it — and
 * refuses anything else rather than guessing. The returned signer's address is
 * checked against the configured treasury by the caller, because a key that
 * signs for a different account would send from somewhere nobody is watching.
 */
export async function loadTreasurySigner(
  env: NodeJS.ProcessEnv = process.env,
): Promise<KeyPairSigner | null> {
  const raw = (env[SECRET_VARIABLE] ?? "").trim();
  if (!raw) return null;
  let bytes: Uint8Array | null = null;
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "number")) {
        bytes = Uint8Array.from(parsed as number[]);
      }
    } catch {
      bytes = null;
    }
  } else if (BASE58.test(raw) || /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(raw)) {
    bytes = decodeBase58(raw);
  }
  if (!bytes || (bytes.length !== 64 && bytes.length !== 32)) return null;
  try {
    /*
     * Two lengths, two constructors, and they are not interchangeable.
     *
     * `solana-keygen` writes 64 bytes — the private half followed by the public
     * one — and that is what `createKeyPairSignerFromBytes` expects. A 32-byte
     * value is the private half alone, which several wallets export and which
     * that function rejects. Passing one to the other threw inside the `catch`
     * below and reported "this deployment holds no payout key", which is a
     * true sentence about a false situation and would have cost an operator an
     * afternoon.
     */
    return bytes.length === 32
      ? await createKeyPairSignerFromPrivateKeyBytes(bytes, true)
      : await createKeyPairSignerFromBytes(bytes);
  } catch {
    /* Deliberately silent. A malformed key must not be echoed anywhere, and the
       only thing a caller needs to know is that this deployment cannot sign. */
    return null;
  }
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value: string): Uint8Array | null {
  let total = 0n;
  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) return null;
    total = total * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (total > 0n) {
    bytes.unshift(Number(total % 256n));
    total /= 256n;
  }
  for (const character of value) {
    if (character !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * Which program actually owns the payout mint, read from the chain.
 *
 * ## Why this is read rather than assumed
 *
 * `TOKEN_PROGRAM_ADDRESS` comes from `@solana-program/token-2022`, and the name
 * invites exactly the wrong conclusion. Its value is checked in
 * `treasury.test.mjs`: it is the **legacy** `Tokenkeg…`, which is correct for
 * USDC — but that is a fact about a constant in a package, not a fact about the
 * mint this deployment is configured to pay with. `RYNTRA_REWARDS_PAYOUT_MINT`
 * is overridable, and pointing it at a Token-2022 mint while three call sites
 * hard-code the legacy program would derive associated accounts that are not
 * that mint's associated accounts. The transfer would fail, which is the good
 * case; the bad case is creating and funding an account nobody can spend from.
 *
 * The mint's owner is a single account read and it answers the question
 * exactly. `readMintAccount` already refuses anything owned by neither token
 * program, so an address that is not a mint at all cannot reach a payout.
 *
 * Decimals come from the same read for the same reason: the payout amount is
 * counted in USD micro-units, and a mint with different decimals would move a
 * different amount of money than the ledger says was claimed.
 */
type PayoutMint = Readonly<{ programAddress: Address; decimals: number }>;

async function readPayoutMint(
  handle: SolanaRpcHandle,
  mint: string,
): Promise<PayoutMint | Readonly<{ reason: string }>> {
  const read = await readMintAccount(handle, mint);
  if (!read.ok) return { reason: `The payout mint could not be read: ${read.reason}` };
  if (read.decoded.decimals !== REWARD_PAYOUT_DECIMALS) {
    return {
      reason: `The payout mint reports ${read.decoded.decimals} decimals; rewards are counted in ${REWARD_PAYOUT_DECIMALS}.`,
    };
  }
  return { programAddress: read.raw.owner as Address, decimals: read.decoded.decimals };
}

/* ----------------------------------------------------------------- reserve */

/**
 * How much the payout account can actually pay, right now.
 *
 * Read live rather than cached. A cached reserve is a number that was true once
 * and is being used to promise something now, which is the failure this whole
 * bound exists to prevent.
 */
export async function readRewardsReserve(
  deps: Readonly<{ env?: NodeJS.ProcessEnv; handle?: SolanaRpcHandle; now?: () => Date }> = {},
): Promise<RewardReserve> {
  const config = rewardsTreasuryConfig(deps.env ?? process.env);
  if (!config.configured) return unconfiguredReserve(config.reason);
  const observedAt = (deps.now ?? (() => new Date()))().toISOString();
  const handle = deps.handle ?? createSolanaRpcHandle({ network: "mainnet" });
  let account: string;
  try {
    /* The mint's own program, not a constant: an associated account derived
       under the wrong program is not that mint's associated account, and its
       balance would read as zero forever. */
    const payoutMint = await readPayoutMint(handle, config.mint);
    if (!("programAddress" in payoutMint)) {
      return { state: "UNREADABLE", usdMicros: 0n, treasury: config.treasury, reason: payoutMint.reason };
    }
    account = await associatedTokenAccount({
      owner: config.treasury,
      mint: config.mint,
      tokenProgram: String(payoutMint.programAddress),
    });
  } catch (failure) {
    return {
      state: "UNREADABLE",
      usdMicros: 0n,
      treasury: config.treasury,
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .getTokenAccountBalance(account as never, { commitment: "confirmed" })
        .send({ abortSignal }),
    );
    const amount = (response as { value?: { amount?: unknown; decimals?: unknown } }).value;
    if (typeof amount?.amount !== "string" || !/^[0-9]+$/.test(amount.amount)) {
      return { state: "EMPTY", usdMicros: 0n, treasury: config.treasury, observedAt };
    }
    if (amount.decimals !== REWARD_PAYOUT_DECIMALS) {
      return {
        state: "UNREADABLE",
        usdMicros: 0n,
        treasury: config.treasury,
        reason: `The payout mint reports ${String(amount.decimals)} decimals; rewards are counted in six.`,
      };
    }
    const held = BigInt(amount.amount);
    return {
      state: held === 0n ? "EMPTY" : "FUNDED",
      usdMicros: held,
      treasury: config.treasury,
      observedAt,
    };
  } catch (failure) {
    /* A missing token account is an empty treasury rather than an error: it is
       exactly what an account that has never held USDC looks like. */
    const message = failure instanceof Error ? failure.message : String(failure);
    if (/could not find account|Invalid param|account not found/i.test(message)) {
      return { state: "EMPTY", usdMicros: 0n, treasury: config.treasury, observedAt };
    }
    return { state: "UNREADABLE", usdMicros: 0n, treasury: config.treasury, reason: message };
  }
}

/* ------------------------------------------------------------------ payout */

export type PayoutResult =
  | Readonly<{ ok: true; signature: string; destination: string }>
  | Readonly<{ ok: false; code: "NOT_CONFIGURED" | "NO_SIGNER" | "WRONG_KEY" | "BUILD_FAILED" | "NOT_ARMED"; reason: string }>
  | Readonly<{ ok: false; code: "SUBMIT_UNKNOWN"; reason: string; signature: string; destination: string }>;

/**
 * Send one claim's USDC to a person's own wallet.
 *
 * ## Three things this does that a naive transfer would not
 *
 * **It creates the destination token account when there is none.** A wallet
 * that has never held USDC has no associated token account, and a transfer to
 * one that does not exist fails with a message no customer should ever be shown.
 * The idempotent create is prepended and Ryntra pays its rent, which is part of
 * paying somebody their money rather than a favour.
 *
 * **It pays the network fee.** The treasury is the fee payer, so a person with
 * an empty SOL balance can still receive their rewards. Charging somebody a
 * transaction fee to collect cashback would be a strange kind of cashback.
 *
 * **It reports an unknown submission as unknown.** If the broadcast throws
 * after the bytes may have left, the signature is returned with
 * `SUBMIT_UNKNOWN` and the caller moves the claim to `SUBMITTED_UNKNOWN` and
 * reads it back. It never retries: the same claim retried is the same debt paid
 * twice.
 */
export async function payRewardClaim(
  args: Readonly<{
    wallet: string;
    usdMicros: bigint;
    beforeSubmit?: (prepared: Readonly<{ signature: string; destination: string; blockhash: string; lastValidBlockHeight: string }>) => Promise<boolean>;
    deps?: Readonly<{ env?: NodeJS.ProcessEnv; handle?: SolanaRpcHandle; submit?: typeof sendTransactionOnce }>;
  }>,
): Promise<PayoutResult> {
  if (!args.beforeSubmit) return { ok: false, code: "NOT_ARMED", reason: "A durable pre-broadcast record is required." };
  const env = args.deps?.env ?? process.env;
  const config = rewardsTreasuryConfig(env);
  if (!config.configured) return { ok: false, code: "NOT_CONFIGURED", reason: config.reason };
  const signer = await loadTreasurySigner(env);
  if (!signer) {
    return { ok: false, code: "NO_SIGNER", reason: "This deployment holds no Rewards payout key." };
  }
  if (String(signer.address) !== config.treasury) {
    /* The addresses are public; saying which two disagree is safe and is the
       only way an operator can fix it. The key itself never appears. */
    return {
      ok: false,
      code: "WRONG_KEY",
      reason: `The payout key signs for ${String(signer.address)}, not for the configured treasury ${config.treasury}.`,
    };
  }
  if (args.usdMicros <= 0n) {
    return { ok: false, code: "BUILD_FAILED", reason: "A payout must be for a positive amount." };
  }

  const handle = args.deps?.handle ?? createSolanaRpcHandle({ network: "mainnet" });

  /* One read, four uses: both associated accounts, the account this payout may
     have to create, and the transfer itself all have to name the same program,
     and it has to be the one that actually owns the mint. */
  const payoutMint = await readPayoutMint(handle, config.mint);
  if (!("programAddress" in payoutMint)) {
    return { ok: false, code: "BUILD_FAILED", reason: payoutMint.reason };
  }
  const tokenProgram = payoutMint.programAddress;

  let source: string;
  let destination: string;
  try {
    source = await associatedTokenAccount({
      owner: config.treasury,
      mint: config.mint,
      tokenProgram: String(tokenProgram),
    });
    destination = await associatedTokenAccount({
      owner: args.wallet,
      mint: config.mint,
      tokenProgram: String(tokenProgram),
    });
  } catch (failure) {
    return { ok: false, code: "BUILD_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
  }

  let signedWireBase64: string;
  let signature: string;
  let blockhash: string;
  let lastValidBlockHeight: string;
  try {
    const latest = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getLatestBlockhash({ commitment: "confirmed" }).send({ abortSignal }),
    );
    const lifetime = (latest as { value: { blockhash: Blockhash; lastValidBlockHeight: bigint } }).value;
    blockhash = String(lifetime.blockhash);
    lastValidBlockHeight = String(lifetime.lastValidBlockHeight);

    const instructions: Instruction[] = [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        ata: destination as Address,
        owner: args.wallet as Address,
        mint: config.mint as Address,
        systemProgram: "11111111111111111111111111111111" as Address,
        tokenProgram,
      }),
      getTransferCheckedInstruction(
        {
          source: source as Address,
          mint: config.mint as Address,
          destination: destination as Address,
          authority: signer,
          amount: args.usdMicros,
          /* From the mint, checked against what the ledger counts in. */
          decimals: payoutMint.decimals,
        },
        { programAddress: tokenProgram },
      ),
    ];

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayerSigner(signer, draft),
      (draft) => setTransactionMessageLifetimeUsingBlockhash(lifetime, draft),
      (draft) => appendTransactionMessageInstructions(instructions, draft),
    );
    const signed = await signTransactionMessageWithSigners(message);
    signedWireBase64 = getBase64EncodedWireTransaction(signed);
    signature = String(getSignatureFromTransaction(signed));
  } catch (failure) {
    return { ok: false, code: "BUILD_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
  }

  try {
    if (!await args.beforeSubmit({ signature, destination, blockhash, lastValidBlockHeight })) {
      return { ok: false, code: "NOT_ARMED", reason: "The prepared payout could not claim its durable broadcast boundary." };
    }
  } catch { return { ok: false, code: "NOT_ARMED", reason: "The prepared payout could not be recorded." }; }
  try {
    const returned = await (args.deps?.submit ?? sendTransactionOnce)({ handle, signedWireBase64 });
    if (returned && returned !== signature) return { ok: false, code: "SUBMIT_UNKNOWN", signature, destination, reason: "The network returned a different transaction identity." };
    // Acceptance is not confirmation. The caller keeps this claim unresolved
    // until an independent status read observes confirmed settlement.
    return { ok: true, signature, destination };
  } catch (failure) {
    /* The bytes may or may not have left. The signature is known either way,
       because it is a property of the signed message rather than of the
       broadcast, so the caller can go and look instead of sending again. */
    return {
      ok: false,
      code: "SUBMIT_UNKNOWN",
      reason: failure instanceof Error ? failure.message : String(failure),
      signature,
      destination,
    };
  }
}

export { ASSOCIATED_TOKEN_PROGRAM_ADDRESS };
