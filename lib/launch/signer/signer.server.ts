/**
 * CITY-162 — one signer for each of Ryntra Launch's keys: the pool payer and the executor.
 *
 * A signer signs a transaction's message and gives back the signature; it never hands its key out. Under it stands one
 * of two adapters (`./select.server.ts`):
 * - `env` — the key in the deployment's environment, as before; it stays as the fallback until the operator switches;
 * - `kms` — the key in Google Cloud KMS (`EC_SIGN_ED25519`): the key never leaves KMS, and every signature is asked of
 *   its API.
 * Over the adapter, the same three things every time, whichever adapter it is:
 * 1. the bounds — the message is read from its own bytes and judged by the key's list (`./bounds.server.ts`); anything
 *    else is refused with its reason, and the key is never asked;
 * 2. the check — the signature is verified against the signer's public address before it is given back: a KMS key that
 *    is not the address the deployment names signs nothing that could ever be sent;
 * 3. the journal — what was signed, for which action, when, the message's hash and the signature: public data only
 *    (`./journal.server.ts`). No row, no signature: a signature the journal could not keep is not given back.
 *
 * Financial logic is not here: what a transaction pays, to whom and how much is built where it always was. This module
 * decides only whether a key signs the bytes it is handed.
 */

import { createHash } from "node:crypto";

import { PublicKey, type Transaction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";

import { ed25519Valid } from "../../solana/limits/trigger-tx.ts";
import { signedMessageView, type SignedMessageView } from "./message.ts";

export type LaunchSignerRole = "pool-payer" | "executor";
export type LaunchSignerMode = "env" | "kms";

/** What an adapter does: sign bytes with its key. Nothing else of the key ever leaves it. */
export type KeySigner = Readonly<{
  mode: LaunchSignerMode;
  /** A public name of the key: the KMS key version's resource name; null for a key in the environment. */
  keyRef: string | null;
  /** A raw ed25519 signature (64 bytes) over `message`. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}>;

/** What the caller may add to the request — the holders' collector names the position owners it pays (executor only). */
export type SignRequest = Readonly<{ payees?: readonly string[] }>;

/** A journal row: public data only — never a key, never a credential. */
export type SignatureRow = Readonly<{
  v: 1;
  cluster: string;
  role: LaunchSignerRole;
  mode: LaunchSignerMode;
  /** The signer's public address. */
  signer: string;
  keyRef: string | null;
  /** What the message does, read from its bytes (`actionOf`). */
  action: string;
  /** The token, pool or position it acts on, when one is named. */
  subject: string | null;
  messageSha256: string;
  /** The signature, base58 — for the fee payer, the transaction's own id. Null on a refusal. */
  signature: string | null;
  outcome: "SIGNED" | "REFUSED";
  reason: string | null;
  at: string;
}>;

export type SignJournal = (row: SignatureRow) => Promise<void>;

/** A journal that keeps nothing refuses: a signer without a journal signs nothing. */
export const NO_JOURNAL: SignJournal = async () => {
  throw new Error("no signing journal here");
};

export type LaunchSigner = Readonly<{
  role: LaunchSignerRole;
  mode: LaunchSignerMode;
  address: string;
  publicKey: PublicKey;
  keyRef: string | null;
  /** The signature over a transaction's message, once the bounds allow it and the journal kept it; throws `SignerRefused` otherwise. */
  signMessage(message: Uint8Array, request?: SignRequest): Promise<Uint8Array>;
}>;

export class SignerRefused extends Error {
  readonly role: LaunchSignerRole;
  readonly reason: string;
  constructor(role: LaunchSignerRole, reason: string) {
    super(`The ${role === "executor" ? "executor" : "pool payer"} refuses to sign: ${reason}.`);
    this.name = "SignerRefused";
    this.role = role;
    this.reason = reason;
  }
}

export type SignerBounds = Readonly<{
  /** Why the message is not this key's to sign; null when it is. */
  refusal(view: SignedMessageView, request: SignRequest): string | null;
  /** What the message does and what it acts on, for the journal. */
  describe(view: SignedMessageView): Readonly<{ action: string; subject: string | null }>;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const base58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);

/** A short, public reason: an adapter's error never carries more than its first line. */
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 200);

/**
 * A key under its bounds, its check and its journal. `address` is the public address the deployment names for the role;
 * a signature that does not verify against it is never given back.
 */
export function boundedSigner(
  key: KeySigner,
  options: Readonly<{ role: LaunchSignerRole; address: string; cluster: string; bounds: SignerBounds; journal: SignJournal; now?: () => Date }>,
): LaunchSigner {
  const publicKey = new PublicKey(options.address);
  const now = options.now ?? (() => new Date());
  const row = (fields: Pick<SignatureRow, "action" | "subject" | "messageSha256" | "signature" | "outcome" | "reason">): SignatureRow => ({
    v: 1,
    cluster: options.cluster,
    role: options.role,
    mode: key.mode,
    signer: options.address,
    keyRef: key.keyRef,
    ...fields,
    at: now().toISOString(),
  });
  const refuse = async (reason: string, messageSha256: string, described: Readonly<{ action: string; subject: string | null }>): Promise<never> => {
    /* A refusal is written down too; a journal that fails then does not hide the refusal itself. */
    await options.journal(row({ ...described, messageSha256, signature: null, outcome: "REFUSED", reason })).catch(() => undefined);
    throw new SignerRefused(options.role, reason);
  };
  return {
    role: options.role,
    mode: key.mode,
    address: options.address,
    publicKey,
    keyRef: key.keyRef,
    async signMessage(message, request = {}) {
      const messageSha256 = sha256(message);
      let view: SignedMessageView;
      try {
        view = signedMessageView(message);
      } catch (error) {
        return refuse(`not a transaction message (${reasonOf(error)})`, messageSha256, { action: "unreadable", subject: null });
      }
      const described = options.bounds.describe(view);
      if (!view.signers.includes(options.address)) return refuse("the message does not ask this key to sign", messageSha256, described);
      const refusal = options.bounds.refusal(view, request);
      if (refusal) return refuse(refusal, messageSha256, described);
      let signature: Uint8Array;
      try {
        signature = await key.sign(message);
      } catch (error) {
        return refuse(`the ${key.mode} key did not sign (${reasonOf(error)})`, messageSha256, described);
      }
      if (signature.length !== 64 || !ed25519Valid(message, signature, publicKey)) {
        return refuse(`the ${key.mode} key's signature is not ${options.address}'s`, messageSha256, described);
      }
      /* No row, no signature: the journal throws, and the bytes are never sent. */
      await options.journal(row({ ...described, messageSha256, signature: base58(signature), outcome: "SIGNED", reason: null }));
      return Uint8Array.from(signature);
    },
  };
}

/** A legacy transaction signed by a launch signer, its other signatures left as they are. */
export async function signTransaction(signer: LaunchSigner, tx: Transaction, request?: SignRequest): Promise<void> {
  const signature = await signer.signMessage(tx.serializeMessage(), request);
  tx.addSignature(signer.publicKey, Buffer.from(signature));
}
