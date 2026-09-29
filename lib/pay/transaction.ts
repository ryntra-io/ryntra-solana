/**
 * Payment requests — the transaction a payer's wallet signs.
 *
 * This is the Solana Pay *transaction request* idea in the product's own
 * terms: the server builds the transfer that satisfies one request — the
 * recipient, the mint, the amount, and the request's reference key as a
 * read-only account — through the same builders the Send lane uses, simulates
 * it, and remembers the exact message it handed out. The payer's own wallet
 * signs; nothing here can. The submit boundary then accepts only bytes whose
 * message hash is the one it pinned, and broadcasts them once.
 *
 * What it deliberately is not: a policy engine. The Send lane's owner policy,
 * canary review and issuer-signed review proof exist to keep *this product's
 * user* from being harmed by their own transfer. A payer on `/pay/:id` is
 * sending money to an address they were handed; the protections that apply
 * are the ones about the bytes — the transaction does exactly what the page
 * says and nothing else — and those are kept.
 */

import { getTransactionDecoder } from "@solana/kit";

import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SPL_TRANSFER_ACTION_REF,
} from "../agent-control/adapters/solana-token-2022.ts";
import type { GuardStore } from "../guard/store.ts";
import { readMintAccount } from "../solana/mint.ts";
import { buildNativeSolTransaction } from "../solana/native-sol.ts";
import { buildPassport } from "../solana/passport.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";
import { verifySignatureOnly } from "../solana/signature.ts";
import { sendTransactionOnce } from "../solana/submit-rpc.ts";
import { buildTransferTransaction, type TransferPlan } from "../solana/transaction.ts";
import { compareWalletTransaction } from "../solana/wallet-modification.ts";
import { newPublicId, type PaymentRequestRecord } from "./model.ts";
import {
  createPaymentIntent,
  markPaymentIntentSubmitted,
  readPaymentIntent,
  type PaymentIntentRecord,
} from "./store.ts";

/** How long a handed-out transaction stays acceptable at the submit boundary. */
export const PAYMENT_INTENT_TTL_MS = 3 * 60 * 1_000;

export type PaymentTransactionFailure = Readonly<{
  ok: false;
  code:
    | "REQUEST_NOT_PAYABLE"
    | "AMOUNT_REQUIRED"
    | "AMOUNT_INVALID"
    | "SELF_PAYMENT"
    | "MINT_UNREADABLE"
    | "EPOCH_UNAVAILABLE"
    | "BUILD_FAILED"
    | "SIMULATION_FAILED"
    | "STORE_FAILED";
  reason: string;
}>;

export type PaymentTransactionSuccess = Readonly<{
  ok: true;
  intentId: string;
  unsignedWireBase64: string;
  messageHash: string;
  amountRaw: string;
  mint: string | null;
  /** What the simulation said. `null` when the endpoint would not simulate. */
  simulated: Readonly<{ succeeded: boolean; error: string | null }> | null;
  createsRecipientAccount: boolean;
  networkFeeLamports: string;
}>;

/**
 * Build the paying transaction for one request.
 *
 * `amountRaw` is the request's own amount for a fixed request, and the payer's
 * choice for an open one. Self-payment is refused because the builders refuse
 * it and because paying your own request settles nothing.
 */
export async function buildPaymentTransaction(args: {
  store: GuardStore;
  handle: SolanaRpcHandle;
  request: PaymentRequestRecord;
  payer: string;
  amountRaw: string | null;
  now?: Date;
}): Promise<PaymentTransactionSuccess | PaymentTransactionFailure> {
  const now = args.now ?? new Date();
  const { request } = args;
  if (args.payer === request.recipient) {
    return { ok: false, code: "SELF_PAYMENT", reason: "This request is addressed to the wallet you connected." };
  }
  const amountRaw = request.amountRaw ?? args.amountRaw;
  if (amountRaw === null || !/^[1-9][0-9]*$/.test(amountRaw)) {
    return { ok: false, code: "AMOUNT_REQUIRED", reason: "Enter the amount you want to pay." };
  }

  let plan: TransferPlan;
  if (request.mint === null) {
    const built = await buildNativeSolTransaction({
      handle: args.handle,
      input: {
        schemaVersion: "1.0.0",
        actionRef: NATIVE_SOL_TRANSFER_ACTION_REF,
        network: "mainnet",
        sender: args.payer,
        recipient: request.recipient,
        amountRaw,
      },
      references: [request.reference],
      now,
    });
    if (!built.ok) return { ok: false, code: "BUILD_FAILED", reason: built.reason };
    plan = built.plan;
  } else {
    const read = await readMintAccount(args.handle, request.mint);
    if (!read.ok) return { ok: false, code: "MINT_UNREADABLE", reason: read.reason };
    const passport = buildPassport(read.raw);
    if (!passport.ok) return { ok: false, code: "MINT_UNREADABLE", reason: passport.reason };
    let epoch: bigint;
    try {
      const current = await withRpcDiscipline(args.handle, (abortSignal) => args.handle.rpc.getEpochInfo().send({ abortSignal }));
      epoch = BigInt(current.epoch);
    } catch (cause) {
      return { ok: false, code: "EPOCH_UNAVAILABLE", reason: cause instanceof Error ? cause.message : String(cause) };
    }
    const built = await buildTransferTransaction({
      handle: args.handle,
      read,
      passport: passport.passport,
      input: {
        schemaVersion: "1.0.0",
        actionRef: SPL_TRANSFER_ACTION_REF,
        network: "mainnet",
        mint: request.mint,
        sender: args.payer,
        recipient: request.recipient,
        amountRaw,
      },
      epoch,
      references: [request.reference],
      now,
    });
    if (!built.ok) return { ok: false, code: "BUILD_FAILED", reason: built.reason };
    plan = built.plan;
  }

  const simulated = await simulate(args.handle, plan.unsignedWireBase64);
  if (simulated && !simulated.succeeded) {
    return { ok: false, code: "SIMULATION_FAILED", reason: simulated.error ?? "The network says this transfer would not succeed." };
  }

  const intent: PaymentIntentRecord = {
    schema: "ryntra.pay.intent",
    schemaVersion: "1.0.0",
    intentId: newPublicId(),
    requestId: request.id,
    payer: args.payer,
    messageHash: plan.fingerprint.messageHash,
    unsignedWireBase64: plan.unsignedWireBase64,
    amountRaw,
    mint: request.mint,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PAYMENT_INTENT_TTL_MS).toISOString(),
    signature: null,
  };
  try {
    const stored = await createPaymentIntent(args.store, intent);
    if (!stored) return { ok: false, code: "STORE_FAILED", reason: "The transaction could not be recorded. Try again." };
  } catch {
    return { ok: false, code: "STORE_FAILED", reason: "The transaction could not be recorded. Try again." };
  }

  return {
    ok: true,
    intentId: intent.intentId,
    unsignedWireBase64: plan.unsignedWireBase64,
    messageHash: plan.fingerprint.messageHash,
    amountRaw,
    mint: request.mint,
    simulated,
    createsRecipientAccount: plan.createsRecipientAccount,
    networkFeeLamports: plan.baseFeeLamports,
  };
}

async function simulate(
  handle: SolanaRpcHandle,
  unsignedWireBase64: string,
): Promise<Readonly<{ succeeded: boolean; error: string | null }> | null> {
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .simulateTransaction(unsignedWireBase64 as never, {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
        })
        .send({ abortSignal }),
    );
    const err = response.value.err;
    return {
      succeeded: err === null || err === undefined,
      error: err === null || err === undefined ? null : JSON.stringify(err, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry)),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Submit boundary
 * ------------------------------------------------------------------ */

export type PaymentSubmitFailure = Readonly<{
  ok: false;
  code:
    | "INTENT_UNKNOWN"
    | "INTENT_MISMATCH"
    | "INTENT_EXPIRED"
    | "ALREADY_SUBMITTED"
    | "BYTES_UNREADABLE"
    | "BYTES_MISMATCH"
    | "SIGNATURE_MISSING"
    | "SUBMIT_FAILED";
  reason: string;
}>;

export type PaymentSubmitSuccess = Readonly<{ ok: true; signature: string; intent: PaymentIntentRecord }>;

/**
 * Accept signed bytes for a pinned intent and broadcast them once.
 *
 * The check is on the message: the SHA-256 of the signed transaction's message
 * bytes must equal the hash pinned when the unsigned bytes were built. A
 * wallet that returned different bytes — another amount, another recipient,
 * an added instruction — is refused here with the mismatch named, and never
 * reaches the network through this route.
 */
export async function submitPaymentTransaction(args: {
  store: GuardStore;
  handle: SolanaRpcHandle;
  /** The request the page is showing; an intent built for another one is refused. */
  requestId: string;
  intentId: string;
  signedWireBase64: string;
  now?: Date;
}): Promise<PaymentSubmitSuccess | PaymentSubmitFailure> {
  const now = args.now ?? new Date();
  const intent = await readPaymentIntent(args.store, args.intentId);
  if (!intent) return { ok: false, code: "INTENT_UNKNOWN", reason: "This payment was not prepared here. Start again from the page." };
  if (intent.requestId !== args.requestId) {
    return { ok: false, code: "INTENT_MISMATCH", reason: "This payment was prepared for a different request." };
  }
  if (intent.signature) return { ok: false, code: "ALREADY_SUBMITTED", reason: "This payment was already sent." };
  if (now.getTime() > Date.parse(intent.expiresAt)) {
    return { ok: false, code: "INTENT_EXPIRED", reason: "This payment took too long to sign. Start again from the page." };
  }

  const check = await checkSignedBytes(args.signedWireBase64, intent.messageHash, {
    unsignedWireBase64: intent.unsignedWireBase64,
    expectsTokenGuard: intent.mint !== null,
    expectedSigner: intent.payer,
  });
  if (!check.ok) return check;

  let signature: string;
  try {
    signature = await sendTransactionOnce({ handle: args.handle, signedWireBase64: args.signedWireBase64 });
  } catch (failure) {
    return { ok: false, code: "SUBMIT_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  await markPaymentIntentSubmitted(args.store, intent, signature);
  return { ok: true, signature, intent: { ...intent, signature } };
}

/**
 * Accept the bytes the wallet returned, on the same terms the Send lane uses.
 *
 * Byte equality with the pinned message is the strongest answer and the fast
 * path. It cannot be the only one: Wallet Standard models browser wallets as
 * transaction-modifying signers, and Phantom in particular recompiles the
 * message with a ComputeBudget pair and its own Lighthouse guard assertions
 * before signing. The first release refused exactly that as "a different
 * transaction", and the founder's second wallet could not pay. So a mismatch
 * goes to `compareWalletTransaction`, the shared module that proves every
 * business instruction, account role, signer and blockhash stayed the same
 * and that the additions are the recognised fee and guard programs only —
 * anything else is still refused with the reason named. The payer's own
 * signature is then verified on the returned bytes.
 */
export async function checkSignedBytes(
  signedWireBase64: string,
  expectedMessageHash: string,
  tolerance?: Readonly<{ unsignedWireBase64: string; expectsTokenGuard: boolean; expectedSigner: string }>,
): Promise<Readonly<{ ok: true; adopted: boolean }> | PaymentSubmitFailure> {
  let messageBytes: Uint8Array;
  try {
    const decoded = getTransactionDecoder().decode(fromBase64(signedWireBase64));
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
  } catch {
    return { ok: false, code: "BYTES_UNREADABLE", reason: "The wallet returned bytes that are not a Solana transaction." };
  }
  const actual = await sha256Hex(messageBytes);
  let adopted = false;
  if (actual !== expectedMessageHash) {
    if (!tolerance) {
      return { ok: false, code: "BYTES_MISMATCH", reason: "The wallet returned a different transaction than the one this page prepared. Nothing was sent." };
    }
    const comparison = compareWalletTransaction({
      expectedWireBase64: tolerance.unsignedWireBase64,
      actualWireBase64: signedWireBase64,
      expectsTokenGuard: tolerance.expectsTokenGuard,
    });
    if (comparison.verdict !== "EXACT" && comparison.verdict !== "WALLET_GUARDS_ONLY") {
      return {
        ok: false,
        code: "BYTES_MISMATCH",
        reason: `The wallet returned a different transaction than the one this page prepared. Nothing was sent. ${comparison.detail}`,
      };
    }
    adopted = comparison.verdict === "WALLET_GUARDS_ONLY";
  }
  if (tolerance) {
    const signature = verifySignatureOnly({ signedWireBase64, expectedSigner: tolerance.expectedSigner });
    if (signature.verdict !== "CLEARED") {
      return { ok: false, code: "SIGNATURE_MISSING", reason: signature.detail };
    }
    return { ok: true, adopted };
  }
  let signatures: Record<string, Uint8Array | null>;
  try {
    signatures = getTransactionDecoder().decode(fromBase64(signedWireBase64)).signatures as unknown as Record<string, Uint8Array | null>;
  } catch {
    return { ok: false, code: "BYTES_UNREADABLE", reason: "The wallet returned bytes that are not a Solana transaction." };
  }
  const signed = Object.values(signatures).some((entry) => entry instanceof Uint8Array && entry.some((byte) => byte !== 0));
  if (!signed) return { ok: false, code: "SIGNATURE_MISSING", reason: "The wallet did not sign the transaction." };
  return { ok: true, adopted };
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
