/**
 * The second signature, produced in the tab and nowhere else.
 *
 * Circle's Solana program stores the outgoing CCTP message in an account it
 * creates during the burn, and it requires that account to sign for its own
 * creation. So a burn needs a signature from a key that exists for one
 * transaction and controls nothing: it authorizes the creation of an event
 * account and can move no money, ever.
 *
 * That key is generated here, used once, and never leaves the browser. The
 * server receives only its public half. This is the one place in the Solana
 * lane where a key is created at all, and the reason it is tolerable is exactly
 * its powerlessness — the alternative is a server that holds a signing key,
 * which this product does not do for any amount of convenience.
 *
 * ## Wallet first, then this
 *
 * The order is fixed and is a safety property, not a preference:
 *
 * 1. The wallet receives **unsigned** bytes. Nothing about the prompt is
 *    unusual and no wallet has to support countersigning a partially-signed
 *    transaction — a capability wallets vary on.
 * 2. The returned message is compared to what was reviewed — not by hashing it,
 *    which the first version of this file did and which made the card unusable
 *    with a real wallet. Wallets add their own instructions: Phantom prepends a
 *    ComputeBudget request and appends Lighthouse assertions that check the
 *    transfer did what it said. Those change the bytes and change nothing about
 *    the transfer, so refusing them refuses every honest signature. The
 *    comparison therefore runs through `compareWalletTransaction`, the same
 *    audited comparator Send uses: identical business instructions, identical
 *    signers, identical blockhash, and only the two guard programs added.
 *    Anything else is still a full stop.
 * 3. Only then is the empty slot filled, over whatever message the wallet
 *    actually returned. A signature cannot change the message it covers, so the
 *    sole difference between what the wallet signed and what reaches the
 *    network is one slot that used to be zero.
 *
 * Browser-safe by construction: Web Crypto and `@noble/ed25519`, no `node:`
 * anything.
 */

import * as ed from "@noble/ed25519";
import { getTransactionDecoder, getTransactionEncoder } from "@solana/kit";

import type { CctpBurnPlan } from "./cctp-plan.ts";
import { compareWalletTransaction } from "./wallet-modification.ts";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58, the encoding a Solana address is written in. */
export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out === "" ? "1" : out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return `0x${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

export type EphemeralMessageAccount = Readonly<{
  /** The address the plan names and the program creates. */
  address: string;
  /** Sign exactly these bytes. The private half is captured, never returned. */
  sign: (message: Uint8Array) => Promise<Uint8Array>;
  /**
   * Forget the key.
   *
   * Called once the burn is submitted or abandoned. It cannot un-write memory
   * the runtime has already copied, so this is hygiene rather than a guarantee
   * — and the key it clears could never move funds in the first place.
   */
  discard: () => void;
}>;

/** Generate the one-transaction key. Nothing about it is stored or transmitted. */
export async function createEphemeralMessageAccount(): Promise<EphemeralMessageAccount> {
  let secret: Uint8Array | null = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(secret);
  return {
    address: encodeBase58(publicKey),
    sign: async (message) => {
      if (!secret) throw new Error("The message account key has already been discarded.");
      return ed.signAsync(message, secret);
    },
    discard: () => {
      if (secret) secret.fill(0);
      secret = null;
    },
  };
}

export const EPHEMERAL_SIGN_FAILURES = [
  "UNREADABLE",
  "BYTES_CHANGED",
  "WALLET_SIGNATURE_MISSING",
  "SLOT_NOT_EMPTY",
  "ACCOUNT_NOT_REQUIRED",
  "ENCODING_CHANGED",
] as const;
export type EphemeralSignFailure = (typeof EPHEMERAL_SIGN_FAILURES)[number];

export type EphemeralSignResult =
  | Readonly<{
      ok: true;
      signedWireBase64: string;
      messageHash: string;
      /** `EXACT`, or `WALLET_GUARDS_ONLY` when the wallet added its own guards. */
      lane: "EXACT" | "WALLET_GUARDS_ONLY";
      addedPrograms: readonly string[];
    }>
  | Readonly<{ ok: false; code: EphemeralSignFailure; reason: string }>;

/**
 * Fill the message account's slot in what the wallet returned.
 *
 * Refuses on anything unexpected rather than repairing it. A burn that does not
 * match its Review is not a burn to fix — it is a burn not to send.
 */
export async function addEphemeralSignature(args: {
  plan: CctpBurnPlan;
  signedWireBase64: string;
  account: EphemeralMessageAccount;
}): Promise<EphemeralSignResult> {
  let messageBytes: Uint8Array;
  let signatures: Record<string, Uint8Array | null>;
  let decoded: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  try {
    decoded = getTransactionDecoder().decode(base64Decode(args.signedWireBase64));
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
    signatures = decoded.signatures as unknown as Record<string, Uint8Array | null>;
  } catch (cause) {
    return {
      ok: false,
      code: "UNREADABLE",
      reason: `The wallet's reply could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  /* The operator's own check, before this tab's key touches anything.
   *
   * `expectsTokenGuard` is false deliberately. That flag does not permit a
   * token assertion — it *requires* one, and whether a wallet adds it depends
   * on the wallet and the message shape. Demanding a guard that may never
   * arrive would reject an honest signature on a guess. Every assertion that
   * is present is still validated in full. */
  const comparison = compareWalletTransaction({
    expectedWireBase64: args.plan.unsignedWireBase64,
    actualWireBase64: args.signedWireBase64,
    expectsTokenGuard: false,
    guardPolicy: "BOUNDED",
  });
  if (comparison.verdict !== "EXACT" && comparison.verdict !== "WALLET_GUARDS_ONLY") {
    return {
      ok: false,
      code: "BYTES_CHANGED",
      reason: `${comparison.detail} Nothing was signed here.`,
    };
  }
  const messageHash = await sha256Hex(messageBytes);

  const wallet = signatures[args.plan.owner];
  if (!wallet || wallet.every((byte) => byte === 0)) {
    return {
      ok: false,
      code: "WALLET_SIGNATURE_MISSING",
      reason: "The wallet returned the transaction without signing it.",
    };
  }

  if (!(args.account.address in signatures)) {
    return {
      ok: false,
      code: "ACCOUNT_NOT_REQUIRED",
      reason: "This transaction does not require the message account that was generated for it.",
    };
  }
  const existing = signatures[args.account.address];
  if (existing && !existing.every((byte) => byte === 0)) {
    return {
      ok: false,
      code: "SLOT_NOT_EMPTY",
      reason: "The message account's signature slot is already filled, so this transaction has been signed before.",
    };
  }

  const signature = await args.account.sign(messageBytes);
  const completed = {
    ...decoded,
    signatures: { ...signatures, [args.account.address]: signature },
  } as typeof decoded;
  const wire = getTransactionEncoder().encode(completed) as unknown as Uint8Array;

  /* Re-decode and re-hash. Encoding must not move a single byte of the message
     — if it did, the signature the wallet gave would no longer cover what is
     about to be sent, and that is the failure this whole ordering exists to
     prevent. */
  try {
    const roundTrip = getTransactionDecoder().decode(wire);
    const afterHash = await sha256Hex(roundTrip.messageBytes as unknown as Uint8Array);
    /* Against the message the wallet actually returned, not against Review:
       the guards the wallet added are part of what it signed. */
    if (afterHash !== messageHash) {
      return {
        ok: false,
        code: "ENCODING_CHANGED",
        reason: "Re-encoding the transaction changed its message, so the wallet's signature would no longer cover it.",
      };
    }
  } catch (cause) {
    return {
      ok: false,
      code: "ENCODING_CHANGED",
      reason: `The completed transaction could not be re-read: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  return {
    ok: true,
    signedWireBase64: base64Encode(wire),
    messageHash,
    lane: comparison.verdict === "EXACT" ? "EXACT" : "WALLET_GUARDS_ONLY",
    addedPrograms: comparison.addedPrograms,
  };
}
