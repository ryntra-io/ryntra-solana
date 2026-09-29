/**
 * The native sign-in — server only.
 *
 * `RYN-API-CONTRACT-001`. The same Sign In With Solana the web does
 * (`lib/auth/siws.ts`), the same nonce discipline (issued with an HMAC tag,
 * spent in the store *before* the signature is verified, so a captured
 * signature finds its nonce gone), the same recorded `wallet` session — and a
 * bearer in the JSON body instead of a cookie. The nonce context is native-only,
 * so a challenge minted here is refused by the web routes and a web nonce is
 * refused here.
 *
 * Nothing here touches a transaction; a session proves control of a wallet
 * and grants private reads and writes for that wallet, never a signature.
 */

import { isAddress } from "@solana/kit";

import { accountByWallet, sessionOpen, sessionRevoke } from "../../account/rpc.ts";
import { recordAccountLogin } from "../../admin/activity.ts";
import { recordWalletVerified } from "../../admin/wallet-presence.ts";
import { buildSiwsInput, siwsMessageText, verifySiws } from "../../auth/siws.ts";
import { issueWalletNonce, walletNonceIssuedHere } from "../../auth/wallet-nonce.ts";
import { consumeLoginNonce } from "../../beta/rpc.ts";
import { issueSessionRefToken } from "../../beta/token.ts";
import { getGuardRuntime } from "../../guard/runtime.ts";
import { minimumAppVersion } from "./capabilities.server.ts";
import {
  NATIVE_NONCE_CONTEXT_PREFIX,
  NATIVE_SESSION_TTL_SECONDS,
  NETWORK,
  versionAtLeast,
  type ApiClient,
  type ApiErrorCode,
  type ChallengeResponse,
  type VerifyResponse,
} from "./contract.ts";

type Locale = "en" | "uk";
const LOCALES: readonly Locale[] = ["en", "uk"];
const SIWS_ACTION = "signin" as const;

export type AuthFailure = Readonly<{ ok: false; code: ApiErrorCode; reason: string; minimumAppVersion?: string }>;

export function nativeNonceContext(locale: Locale): string {
  return `${NATIVE_NONCE_CONTEXT_PREFIX}${locale}`;
}

/** Below the minimum the client is told the version it needs; nothing degrades silently. */
export function clientRefusal(client: ApiClient, env: NodeJS.ProcessEnv = process.env): AuthFailure | null {
  const minimum = minimumAppVersion(env).android;
  if (versionAtLeast(client.appVersion, minimum)) return null;
  return { ok: false, code: "UNSUPPORTED_CLIENT", reason: `App ${client.appVersion} is below the minimum ${minimum}.`, minimumAppVersion: minimum };
}

export function buildChallenge(
  input: Readonly<{ address: string; locale: Locale; client: ApiClient; domain: string; uri: string; now?: number; env?: NodeJS.ProcessEnv }>,
): Readonly<{ ok: true; challenge: ChallengeResponse }> | AuthFailure {
  const refused = clientRefusal(input.client, input.env);
  if (refused) return refused;
  if (!isAddress(input.address)) return { ok: false, code: "VALIDATION_ERROR", reason: "address: not a Solana address." };
  const nonce = issueWalletNonce(nativeNonceContext(input.locale));
  /* No secret means no verifiable nonce; handing out an unverifiable one
     would reopen the hole the nonce closes, so this fails closed. */
  if (!nonce) return { ok: false, code: "UNAVAILABLE", reason: "No nonce secret is configured." };
  const siws = buildSiwsInput({ domain: input.domain, uri: input.uri, address: input.address, nonce, now: input.now ?? Date.now(), action: SIWS_ACTION, locale: input.locale });
  return {
    ok: true,
    challenge: { input: { ...siws, version: "1", chainId: NETWORK }, message: siwsMessageText(siws), nonce, expiresAt: siws.expirationTime },
  };
}

function presenceStore(): ReturnType<typeof getGuardRuntime>["store"] | null {
  try {
    return getGuardRuntime().store;
  } catch {
    return null;
  }
}

export async function verifyAndOpenSession(
  input: Readonly<{
    address: string;
    signedMessage: Uint8Array;
    signature: Uint8Array;
    client: ApiClient;
    domain: string;
    uri: string;
    now?: number;
    env?: NodeJS.ProcessEnv;
  }>,
): Promise<Readonly<{ ok: true; response: VerifyResponse }> | AuthFailure> {
  const refused = clientRefusal(input.client, input.env);
  if (refused) return refused;
  if (!isAddress(input.address)) return { ok: false, code: "VALIDATION_ERROR", reason: "address: not a Solana address." };
  if (input.signature.length !== 64 || input.signedMessage.length === 0) return { ok: false, code: "VALIDATION_ERROR", reason: "signature: 64 bytes expected." };
  const now = input.now ?? Date.now();
  /* The nonce is read out of the unverified message on purpose — it is the one
     field that has to be checked before the expensive work, and reading it
     grants nothing: an attacker-chosen value fails the issuance tag. The
     statement's language is part of the tag, so the locale is found by it. */
  const text = new TextDecoder().decode(input.signedMessage);
  const nonce = /^Nonce: ([0-9A-Za-z]+)$/m.exec(text)?.[1] ?? "";
  const locale = LOCALES.find((candidate) => walletNonceIssuedHere(nonce, nativeNonceContext(candidate)));
  if (!locale) return { ok: false, code: "NONCE_INVALID", reason: "The nonce was not issued for a native sign-in." };
  const spent = await consumeLoginNonce(nonce, now + 8 * 60_000);
  if (!spent) return { ok: false, code: "NONCE_INVALID", reason: "The nonce was already used or could not be spent." };
  const verified = await verifySiws({
    signedMessage: input.signedMessage,
    signature: input.signature,
    expected: { domain: input.domain, uri: input.uri, nonce, address: input.address, action: SIWS_ACTION, locale },
    now,
  });
  /* The specific reason stays server-side. */
  if (!verified.ok) return { ok: false, code: "SIGNATURE_INVALID", reason: "The signed message did not verify." };
  const address = verified.address;
  const session = await sessionOpen({ kind: "wallet", method: "solana_siws", walletChain: "solana", walletAddress: address, ttlSeconds: NATIVE_SESSION_TTL_SECONDS });
  if (!session) return { ok: false, code: "UNAVAILABLE", reason: "The session store did not answer." };
  const accessToken = issueSessionRefToken(session.id, Date.parse(session.expiresAt));
  if (!accessToken) {
    await sessionRevoke(session.id, "replaced");
    return { ok: false, code: "UNAVAILABLE", reason: "No session secret is configured." };
  }
  /* The admin's "wallet verified" fact and, when an account owns the address,
     its login by signature — bounded and non-fatal, exactly as on the web. */
  const store = presenceStore();
  const presence = store ? recordWalletVerified(store, { wallet: address, now: new Date(now).toISOString() }) : Promise.resolve("unavailable" as const);
  try {
    const owner = await accountByWallet("solana", address);
    if (owner) await recordAccountLogin({ accountId: owner, kind: "solana_siws", admin: false, target: "app", nonce: `native-${nonce}` }, { timeoutMs: 2_500 });
  } catch {
    /* A missing login row never blocks a sign-in. */
  }
  await presence;
  return {
    ok: true,
    response: {
      tokenType: "Bearer",
      accessToken,
      session: { id: session.id, address, network: NETWORK, issuedAt: new Date(now).toISOString(), expiresAt: isoUtc(session.expiresAt) },
    },
  };
}

/** The store answers with an offset; the contract states every instant in UTC. */
export function isoUtc(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

/** A new session for the same wallet, the old one revoked as replaced. */
export async function reissueSession(
  current: Readonly<{ sessionId: string; address: string }>,
  now: number = Date.now(),
): Promise<Readonly<{ ok: true; response: VerifyResponse }> | AuthFailure> {
  const session = await sessionOpen({ kind: "wallet", method: "solana_siws", walletChain: "solana", walletAddress: current.address, ttlSeconds: NATIVE_SESSION_TTL_SECONDS });
  if (!session) return { ok: false, code: "UNAVAILABLE", reason: "The session store did not answer." };
  const accessToken = issueSessionRefToken(session.id, Date.parse(session.expiresAt));
  if (!accessToken) {
    await sessionRevoke(session.id, "replaced");
    return { ok: false, code: "UNAVAILABLE", reason: "No session secret is configured." };
  }
  await sessionRevoke(current.sessionId, "replaced");
  return {
    ok: true,
    response: {
      tokenType: "Bearer",
      accessToken,
      session: { id: session.id, address: current.address, network: NETWORK, issuedAt: new Date(now).toISOString(), expiresAt: isoUtc(session.expiresAt) },
    },
  };
}
