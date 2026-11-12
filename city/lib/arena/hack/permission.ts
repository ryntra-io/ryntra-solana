/**
 * The owner's permission for a Hack order (CITY-223). An audit runs only with the protocol owner's written consent:
 * the owner signs «this protocol lets agents attack this copy, within this scope, during this window». Without a valid
 * grant there is no order — the rules refuse every finding (`rules.ts`, `NO_PERMISSION`).
 *
 * The signed text is the canonical JSON of the grant body (the judge's `canonicalJson`, so every machine names the same
 * bytes). This file does not verify a signature itself — a Solana wallet signature needs base58 and ed25519 that belong
 * to the sandbox and the server (CITY-224/226). It defines the shape, the canonical text, and an injected verifier, the
 * same way the Ring's judge takes its stamp check from outside. So the library stays pure and holds no keys.
 *
 * Pure: no store, no clock, no network, no keys.
 */

import { canonicalJson, hashOf } from "../../../../lib/ring/judge/index.ts";
import { checkScope, checkTarget, isAddress, type Scope, type TargetRef } from "./scope.ts";

export const GRANT_FORMAT = "ryntra-hack-grant/1";

/** What the owner signs: the order, the copy, the scope and the window — never a live mainnet target. */
export type GrantBody = {
  readonly format: typeof GRANT_FORMAT;
  /** The order this grant opens. */
  readonly order: string;
  /** The protocol owner's wallet (base58) — the signer. */
  readonly protocol: string;
  readonly target: TargetRef;
  readonly scope: Scope;
  /** The window the grant is good for (unix ms); a submission is judged against the order's own window too. */
  readonly opensAt: number;
  readonly closesAt: number;
  /** A replay guard: 1–64 of A-Z a-z 0-9 . _ : - */
  readonly nonce: string;
};

/** The owner's signature over `grantText(body)`: the signer (its wallet) and the signature, as the verifier reads them. */
export type GrantSignature = { readonly signer: string; readonly signature: string };

export type PermissionGrant = GrantBody & { readonly signature: GrantSignature };

/**
 * Checks a grant's signature against its body. Injected — the crypto lives in the server/sandbox, not here. It is given
 * the exact body the owner signed and the signature, and says only whether the signature is the signer's over that body.
 */
export type PermissionVerifier = (body: GrantBody, signature: GrantSignature) => boolean;

export type GrantIssueCode = "BAD_GRANT" | "NO_PERMISSION" | "WRONG_ORDER" | "WRONG_PROTOCOL" | "SCOPE_MISMATCH" | "WINDOW";
export type GrantIssue = { readonly code: GrantIssueCode; readonly detail: string };

const NONCE = /^[A-Za-z0-9._:-]{1,64}$/;
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** The canonical text the owner signs — the body as canonical JSON. */
export const grantText = (body: GrantBody): string => canonicalJson(body);

/** True when the value is a well-formed grant body (shape, a copy target, a scope that names it, a sane window). */
export function isGrantBody(body: unknown): body is GrantBody {
  if (body === null || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.format !== GRANT_FORMAT) return false;
  if (typeof b.order !== "string" || !NONCE.test(b.order)) return false;
  if (!isAddress(b.protocol) || typeof b.nonce !== "string" || !NONCE.test(b.nonce)) return false;
  if (!isCount(b.opensAt) || !isCount(b.closesAt) || (b.opensAt as number) > (b.closesAt as number)) return false;
  if (checkTarget(b.target) || checkScope(b.scope, b.target as TargetRef)) return false;
  return true;
}

/**
 * Everything wrong with a grant for an order; empty when the grant is valid. The checks run in a fixed order and each
 * is independent, so a window the compiler, an owner or an attacker got wrong is caught here rather than deeper in.
 *
 * `expect` is what the order requires: its id, its owner, its scope hash and its window. The grant must match all four
 * and carry the owner's signature over its own body.
 */
export function checkGrant(
  grant: unknown,
  expect: { order: string; protocol: string; scopeHash: string; opensAt: number; closesAt: number },
  verify: PermissionVerifier,
): GrantIssue[] {
  if (grant === null || typeof grant !== "object") return [{ code: "BAD_GRANT", detail: "grant is not an object" }];
  const g = grant as Record<string, unknown>;
  const signature = g.signature as GrantSignature | undefined;
  const { signature: _omit, ...bodyFields } = g;
  const body = bodyFields as unknown;
  const issues: GrantIssue[] = [];

  if (!isGrantBody(body)) issues.push({ code: "BAD_GRANT", detail: "grant body is malformed or names a non-copy target" });
  if (signature === null || typeof signature !== "object" || typeof signature.signer !== "string" || typeof signature.signature !== "string") {
    issues.push({ code: "BAD_GRANT", detail: "grant needs a signature { signer, signature }" });
  }
  // Only go on to the binding checks when the body itself is sound.
  if (issues.length > 0) return issues;
  const sound = body as GrantBody;

  if (sound.order !== expect.order) issues.push({ code: "WRONG_ORDER", detail: "the grant is for another order" });
  if (sound.protocol !== expect.protocol) issues.push({ code: "WRONG_PROTOCOL", detail: "the grant's protocol is not the order's owner" });
  if (signature!.signer !== sound.protocol) issues.push({ code: "WRONG_PROTOCOL", detail: "the signature's signer is not the protocol owner" });
  if (scopeHash(sound.scope) !== expect.scopeHash) issues.push({ code: "SCOPE_MISMATCH", detail: "the grant opens a different scope than the order" });
  if (sound.opensAt > expect.opensAt || sound.closesAt < expect.closesAt) {
    issues.push({ code: "WINDOW", detail: "the grant's window does not cover the order's window" });
  }
  // The signature last: an owner's consent over exactly this body, by the injected verifier. A forged or stale one fails here.
  let ok = false;
  try {
    ok = verify(sound, signature!);
  } catch {
    ok = false;
  }
  if (!ok) issues.push({ code: "NO_PERMISSION", detail: "the owner's signature does not cover this grant" });
  return issues;
}

/**
 * The scope's canonical hash, used to tie a grant to an order's scope. Only what bounds the audit is hashed — the
 * programs, instructions and accounts, each sorted — not the `excluded` notes, which are words for the window alone.
 */
export function scopeHash(scope: Scope): string {
  return hashOf({ programs: [...scope.programs].sort(), instructions: norm(scope.instructions), accounts: norm(scope.accounts) });
}

const norm = (list: readonly string[] | undefined): string[] => (list ? [...list].sort() : []);
