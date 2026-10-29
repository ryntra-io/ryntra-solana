/**
 * The proven wallet behind a v1 route both clients call.
 *
 * The plan routes are one set of routes for the web and the phone (no
 * parallel addresses for a function that exists once). The phone proves its
 * wallet with the native bearer; the web with the `rw` proof cookie the
 * wallet signed. A bearer that is present and fails is a refusal with its
 * own code and never falls through to a cookie (`lib/session.ts`); a cookie
 * carrier is ambient, so a mutation on it keeps the site's origin check,
 * while a bearer needs none.
 *
 * Server only.
 */

import type { NextResponse } from "next/server";

import { bearerToken, resolveNativeSession } from "../../auth/native-session.ts";
import { intentWalletProof } from "../../account/wallet-session.ts";
import { mutationOriginAllowed } from "../../security.ts";
import { readWalletProof, type WalletProof } from "../../session.ts";
import { apiFailure } from "./http.ts";

export type WalletProofRead =
  /** 1.22.0: `sessionId` — the session that proved the wallet, for a record that keeps who made it (a payment link's owner). */
  | Readonly<{ ok: true; address: string; carrier: "bearer" | "cookie"; sessionId: string | null; via: WalletProof["via"] }>
  | Readonly<{ ok: false; response: NextResponse }>;

/**
 * A read takes a wallet linked to the signed-in account (`via: "link"`).
 */
export async function requireWalletProof(request: Request, intent: "read" | "mutation"): Promise<WalletProofRead> {
  if (bearerToken(request.headers)) {
    const session = await resolveNativeSession(request.headers);
    if (!session.ok) return { ok: false, response: apiFailure(session.code, session.reason) };
    return { ok: true, address: session.session.address, carrier: "bearer", sessionId: session.session.sessionId, via: "signin" };
  }
  /* 1.22.0: an Authorization header without a bearer's grammar asked to be a
     native request and is refused as one — never judged as a browser's. */
  if (request.headers.get("authorization") !== null) {
    return { ok: false, response: apiFailure("UNAUTHORIZED", "The Authorization header does not carry a bearer session.") };
  }
  if (intent === "mutation" && !mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return { ok: false, response: apiFailure("FORBIDDEN", "A change from a browser must come from this site.") };
  }
  const read = await intentWalletProof(intent, readWalletProof);
  if (read.status === "unavailable") return { ok: false, response: apiFailure("UNAVAILABLE", "The session store did not answer. Try again in a moment.") };
  const proof = read.status === "ok" ? read.proof : null;
  if (!proof || proof.chain !== "solana") {
    return { ok: false, response: apiFailure("UNAUTHORIZED", "No proven wallet: sign in with the wallet first.") };
  }
  return { ok: true, address: proof.address, carrier: "cookie", sessionId: proof.sessionId ?? null, via: proof.via };
}

export type PredictionWalletProofRead =
  | Readonly<{ ok: true; address: string; chain: "solana" | "evm"; carrier: "bearer" | "cookie"; sessionId: string | null; via: WalletProof["via"] }>
  | Readonly<{ ok: false; response: NextResponse }>;

/**
 * The same proof for the prediction routes only, which also take an EVM
 * wallet proven by Sign-In with Ethereum: the prediction venues settle on EVM
 * chains, so a person may come with that wallet alone. Every other route keeps
 * `requireWalletProof`, which accepts a Solana wallet and nothing else. The
 * order of the checks is the same: bearer, then a malformed header, then the
 * origin of a change, then the cookie. The phone's bearer is a Solana wallet.
 */
export async function requirePredictionWalletProof(request: Request, intent: "read" | "mutation"): Promise<PredictionWalletProofRead> {
  if (bearerToken(request.headers)) {
    const session = await resolveNativeSession(request.headers);
    if (!session.ok) return { ok: false, response: apiFailure(session.code, session.reason) };
    return { ok: true, address: session.session.address, chain: "solana", carrier: "bearer", sessionId: session.session.sessionId, via: "signin" };
  }
  if (request.headers.get("authorization") !== null) {
    return { ok: false, response: apiFailure("UNAUTHORIZED", "The Authorization header does not carry a bearer session.") };
  }
  if (intent === "mutation" && !mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return { ok: false, response: apiFailure("FORBIDDEN", "A change from a browser must come from this site.") };
  }
  const read = await intentWalletProof(intent, readWalletProof);
  if (read.status === "unavailable") return { ok: false, response: apiFailure("UNAVAILABLE", "The session store did not answer. Try again in a moment.") };
  const proof = read.status === "ok" ? read.proof : null;
  if (!proof || (proof.chain !== "solana" && proof.chain !== "evm")) {
    return { ok: false, response: apiFailure("UNAUTHORIZED", "No proven wallet: sign in with the wallet first.") };
  }
  /* The EVM proof keeps the address in lower case; it is the one spelling the prediction records use. */
  const address = proof.chain === "evm" ? proof.address.toLowerCase() : proof.address;
  return { ok: true, address, chain: proof.chain, carrier: "cookie", sessionId: proof.sessionId ?? null, via: proof.via };
}
