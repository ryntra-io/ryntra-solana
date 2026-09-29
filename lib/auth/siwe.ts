import { verifySiweMessage, createSiweMessage, parseSiweMessage } from "viem/siwe";
import type { PublicClient } from "viem";

/**
 * Sign-In With Ethereum — the identity core, and nothing else.
 *
 * This module proves one fact and refuses to imply any other: **the browser
 * that produced this signature controls this address, right now, for this
 * site.** It mints no session, reads no account, and writes nothing. Those
 * belong to the packet that has somewhere to put an account; see
 * `supabase/prepared/20260812_wallet_identity_v1.sql` and the note at the end
 * of this comment for why they cannot land yet.
 *
 * A wallet signature is a bearer credential the moment it leaves the wallet, so
 * every field below exists to bound what a captured one can do. Each is
 * enforced rather than parsed-and-hoped:
 *
 *   domain        must equal the host actually serving the request. A signature
 *                 farmed on another site carries that site's domain and dies
 *                 here. This is the single most important check in the file.
 *   statement     pinned to one exact sentence. The wallet shows the statement
 *                 to the human, so an attacker who gets someone to sign *their*
 *                 prompt has a signature whose statement is not ours.
 *   nonce         server-issued and single-use. Uniqueness is not enough — a
 *                 nonce that can be replayed is a password.
 *   expirationTime required, and the window is capped here rather than trusted
 *                 from the message: a client that asks for a year gets refused,
 *                 not obeyed.
 *   chainId       allowlisted. A signature scoped to one chain must not be
 *                 replayed as another.
 *   uri / version standard EIP-4361 fields, checked so a malformed message
 *                 cannot pass by omission.
 *
 * `verifySiweMessage` from viem does the cryptography for both account kinds:
 * secp256k1 recovery for an EOA, and an on-chain `isValidSignature` call for a
 * smart account (EIP-1271) when a public client is supplied. Smart-account
 * verification therefore needs a live RPC and is opt-in — passing no client
 * verifies EOAs only, which fails closed rather than silently accepting.
 *
 * What this module deliberately does **not** do, because the schema cannot yet
 * hold the answer: resolve the address to an account. `beta_users.telegram_id`
 * is `bigint unique not null`, so no account exists without Telegram, and
 * `beta_users.wallet_address` is an *unverified watch address a user pastes to
 * look at* — treating it as an identity would let anyone sign in as any account
 * that had ever watched their address. The verified address gets its own
 * column, or it does not exist.
 */

/** The exact sentence a wallet shows the human. Pinned, and checked on return. */
export const SIWE_STATEMENT = "Sign in to Ryntra. This proves you control this address. It authorizes no transaction and moves no funds.";

/** EIP-4361 requires "1"; anything else is a message we did not build. */
const SIWE_VERSION = "1";

/**
 * How long a login message may stay valid.
 *
 * Short on purpose: this is the window in which a captured signature is worth
 * something. Two minutes is comfortably longer than a wallet prompt and far
 * shorter than the time it takes to notice one has leaked.
 */
export const SIWE_TTL_MS = 2 * 60 * 1000;

/**
 * Tolerance for a client clock ahead of ours.
 *
 * `issuedAt` comes from the signer, so a browser thirty seconds fast would
 * otherwise have every message rejected as issued in the future. The allowance
 * is one-directional: a message from the past is fine, one from the future is
 * fine only within this skew.
 */
const CLOCK_SKEW_MS = 60 * 1000;

export type SiweFailure =
  | "malformed"
  | "domain_mismatch"
  | "uri_mismatch"
  | "version_unsupported"
  | "statement_mismatch"
  | "nonce_mismatch"
  | "chain_not_allowed"
  | "address_mismatch"
  | "no_expiry"
  | "no_issued_at"
  | "expired"
  | "not_yet_valid"
  | "window_too_long"
  | "issued_in_future"
  | "bad_signature";

export type SiweResult =
  | { ok: true; address: `0x${string}`; chainId: number }
  | { ok: false; reason: SiweFailure };

export type SiweBuildInput = Readonly<{
  domain: string;
  uri: string;
  address: `0x${string}`;
  chainId: number;
  nonce: string;
  /** Injected so the message is deterministic in tests and in a replay probe. */
  now: number;
}>;

/**
 * Build the message the wallet will show and sign.
 *
 * The server builds it, not the client. A client that supplies its own message
 * chooses its own domain, its own expiry and its own statement, which turns
 * every check below into a formality it can satisfy.
 */
export function buildSiweMessage(input: SiweBuildInput): string {
  return createSiweMessage({
    domain: input.domain,
    address: input.address,
    statement: SIWE_STATEMENT,
    uri: input.uri,
    version: SIWE_VERSION,
    chainId: input.chainId,
    nonce: input.nonce,
    issuedAt: new Date(input.now),
    expirationTime: new Date(input.now + SIWE_TTL_MS),
  });
}

export type SiweVerifyInput = Readonly<{
  message: string;
  signature: `0x${string}`;
  /** The host actually serving this request. Never taken from the message. */
  expectedDomain: string;
  expectedUri: string;
  /** The nonce this server issued and has just consumed exactly once. */
  expectedNonce: string;
  /** Chains a login is accepted on. Empty means none, which fails closed. */
  allowedChainIds: readonly number[];
  now: number;
  /**
   * Optional address the caller already expects — set when re-verifying a known
   * account, left unset during first sign-in where the message declares it.
   */
  expectedAddress?: `0x${string}`;
  /** Supply to accept EIP-1271 smart accounts. Omit to verify EOAs only. */
  publicClient?: PublicClient;
}>;

/**
 * Verify a signed login message against every bound the server controls.
 *
 * Structural checks run before the signature, deliberately: cryptography is the
 * expensive step and a message that fails the domain check is not worth the
 * elliptic-curve maths. The order also keeps the failure reasons honest — a
 * caller learns *which* bound rejected it rather than a blanket `false`.
 */
export async function verifySiwe(input: SiweVerifyInput): Promise<SiweResult> {
  const fields = parseSiweMessage(input.message);
  if (!fields || !fields.address || !fields.domain) return { ok: false, reason: "malformed" };

  /* Domain first. A signature harvested by another site carries that site's
     domain, and every other field on it may be perfectly well-formed. */
  if (fields.domain !== input.expectedDomain) return { ok: false, reason: "domain_mismatch" };
  if (fields.uri !== input.expectedUri) return { ok: false, reason: "uri_mismatch" };
  if (fields.version !== SIWE_VERSION) return { ok: false, reason: "version_unsupported" };
  if (fields.statement !== SIWE_STATEMENT) return { ok: false, reason: "statement_mismatch" };
  if (fields.nonce !== input.expectedNonce) return { ok: false, reason: "nonce_mismatch" };

  if (typeof fields.chainId !== "number" || !input.allowedChainIds.includes(fields.chainId)) {
    return { ok: false, reason: "chain_not_allowed" };
  }

  if (
    input.expectedAddress &&
    fields.address.toLowerCase() !== input.expectedAddress.toLowerCase()
  ) {
    return { ok: false, reason: "address_mismatch" };
  }

  /* An unexpiring login message is a permanent credential in a signature. */
  if (!fields.expirationTime) return { ok: false, reason: "no_expiry" };
  const expiresAt = fields.expirationTime.getTime();
  if (expiresAt <= input.now) return { ok: false, reason: "expired" };

  if (fields.notBefore && fields.notBefore.getTime() > input.now) {
    return { ok: false, reason: "not_yet_valid" };
  }

  /*
   * `Issued At` is required by EIP-4361, and it is required here for a reason
   * beyond conformance: it is the only field the window can be measured
   * against. An earlier draft of this function fell back to comparing the
   * expiry to `now` when the field was absent, which meant a message that
   * simply omitted it was held to a *weaker* rule than one that declared it —
   * the omission bought a longer life. A missing mandatory field is malformed.
   */
  if (!fields.issuedAt) return { ok: false, reason: "no_issued_at" };
  const issuedAt = fields.issuedAt.getTime();
  /* The client issues the message, so its window is checked against the
     server's policy rather than accepted as stated. */
  if (issuedAt > input.now + CLOCK_SKEW_MS) return { ok: false, reason: "issued_in_future" };
  if (expiresAt - issuedAt > SIWE_TTL_MS) return { ok: false, reason: "window_too_long" };

  /*
   * `verifySiweMessage(client, parameters)` runs viem's own field checks again
   * — deliberately, since defence that only exists in our wrapper disappears
   * the moment someone calls viem directly — and then verifies the hash.
   *
   * The client argument decides which account kinds can pass. An EOA is settled
   * by secp256k1 recovery, which touches no network, so the EOA-only path hands
   * viem an empty client object: it is never dereferenced on that branch. A
   * smart account needs an on-chain `isValidSignature` call, so without a real
   * `PublicClient` that branch throws and is caught below as a bad signature.
   * That is the intended shape — smart-account support is opt-in and its
   * absence fails closed rather than silently accepting.
   */
  const client = (input.publicClient ?? {}) as PublicClient;
  const valid = await verifySiweMessage(client, {
    message: input.message,
    signature: input.signature,
    domain: input.expectedDomain,
    nonce: input.expectedNonce,
    /* This request's clock, never the process clock. */
    time: new Date(input.now),
  }).catch(() => false);

  if (!valid) return { ok: false, reason: "bad_signature" };

  return { ok: true, address: fields.address, chainId: fields.chainId };
}
