import { getAddressEncoder, isAddress } from "@solana/kit";
import { verifyAsync } from "@noble/ed25519";

import { SIWS_CHAIN, SIWS_TTL_MS, SIWS_VERSION, parseSiwsMessage, siwsMessageText, type SiwsInput } from "../auth/siws.ts";

/**
 * The consent a person gives with their wallet: one Sign In With Solana message whose statement says exactly what the
 * connection may do, built by the server, signed by the wallet, checked by the server.
 *
 * The message is the city's own SIWS format (`lib/auth/siws.ts`), so Phantom, Solflare, Backpack and Seeker show it as
 * a sign-in. Only its statement differs: it names the client and the host its redirect goes to, so the words on the
 * wallet's own screen — the one place a page cannot paint over — say who is being let in and that nothing can move.
 *
 * The verification here repeats `verifySiws` field for field with one change: the statement it expects is the one
 * this consent issued, not one of the sign-in statements. `verifySiws` itself is not touched — the city's sign-in keeps
 * the exact code it has.
 */

/** Strip what a wallet or a reader should never be shown from a name a client chose for itself. */
export function cleanClientName(raw: string, max = 48): string {
  const cleaned = raw
    .normalize("NFKC")
    /* C0 and C1 controls, bidi overrides and isolates, zero-width marks, the BOM. */
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const short = cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
  return short || "An MCP client";
}

/** The host a client's redirect goes to — the part of its identity this server can actually verify. */
export function redirectHost(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost" ? "this computer" : url.hostname;
  } catch {
    return "an unknown address";
  }
}

/** The words the wallet shows. One line: SIWS keeps the statement on a single line. */
export function consentStatement(clientName: string, host: string): string {
  return `Allow ${cleanClientName(clientName)} (${host}) to read Solana market data from Ryntra. This moves no funds, signs no transaction and cannot trade.`;
}

export function buildConsentInput(input: Readonly<{ domain: string; uri: string; address: string; nonce: string; statement: string; nowMs: number }>): SiwsInput {
  return {
    domain: input.domain,
    address: input.address,
    statement: input.statement,
    uri: input.uri,
    version: SIWS_VERSION,
    chainId: SIWS_CHAIN,
    nonce: input.nonce,
    issuedAt: new Date(input.nowMs).toISOString(),
    expirationTime: new Date(input.nowMs + SIWS_TTL_MS).toISOString(),
  };
}

export { siwsMessageText as consentMessageText };

export type ConsentVerification =
  | Readonly<{ ok: true; address: string }>
  | Readonly<{
      ok: false;
      reason: "unparseable" | "domain" | "uri" | "address" | "version" | "chain" | "nonce" | "statement" | "expired" | "issued_at" | "signature" | "extra_fields";
    }>;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Verify the signed consent against what this server issued for its nonce. Every bound is checked before the curve. */
export async function verifyConsentSignature(input: Readonly<{
  signedMessage: Uint8Array;
  signature: Uint8Array;
  expected: Readonly<{ domain: string; uri: string; nonce: string; address: string; statement: string }>;
  nowMs: number;
}>): Promise<ConsentVerification> {
  const text = new TextDecoder().decode(input.signedMessage);
  const fields = parseSiwsMessage(text);
  if (!fields) return { ok: false, reason: "unparseable" };
  if (fields.domain !== input.expected.domain) return { ok: false, reason: "domain" };
  if (fields.uri !== input.expected.uri) return { ok: false, reason: "uri" };
  if (fields.address !== input.expected.address || !isAddress(fields.address)) return { ok: false, reason: "address" };
  if (fields.version !== SIWS_VERSION) return { ok: false, reason: "version" };
  if (fields.chainId !== SIWS_CHAIN) return { ok: false, reason: "chain" };
  if (fields.nonce !== input.expected.nonce) return { ok: false, reason: "nonce" };
  if (fields.statement !== input.expected.statement) return { ok: false, reason: "statement" };
  if (fields.notBefore !== null || fields.requestId !== null || fields.resources !== null) return { ok: false, reason: "extra_fields" };
  const issuedAt = parseTime(fields.issuedAt);
  const expiresAt = parseTime(fields.expirationTime);
  if (issuedAt === null || issuedAt > input.nowMs + 60_000) return { ok: false, reason: "issued_at" };
  if (expiresAt === null || expiresAt <= input.nowMs) return { ok: false, reason: "expired" };
  if (expiresAt - issuedAt > SIWS_TTL_MS + 1_000) return { ok: false, reason: "expired" };
  if (input.signature.length !== 64) return { ok: false, reason: "signature" };
  const publicKey = new Uint8Array(getAddressEncoder().encode(fields.address as Parameters<ReturnType<typeof getAddressEncoder>["encode"]>[0]));
  let valid = false;
  try {
    valid = await verifyAsync(input.signature, input.signedMessage, publicKey);
  } catch {
    valid = false;
  }
  return valid ? { ok: true, address: fields.address } : { ok: false, reason: "signature" };
}
