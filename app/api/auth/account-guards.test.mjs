/*
 * Structural guarantees on the account entrypoints.
 *
 * These pin the shape of the fixes whose failure mode is silence: a default
 * that attaches, a revocation whose result is dropped, a door that is only
 * closed in the browser. The behavioural half lives in the unit tests beside
 * the helpers and in the route-level run over HTTP
 * (`scripts/access-qa/negative-cases.mjs`).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const code = (path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const ACCOUNT_SESSION = code("lib/auth/account-session.ts");
const CALLBACK = code("app/auth/callback/route.ts");
const CONFIRM = code("app/auth/confirm/route.ts");
const EMAIL = code("app/api/auth/email/route.ts");
const PASSWORD = code("app/api/auth/password/route.ts");
const IDENTITY = code("app/api/auth/identity/route.ts");
const LOGOUT = code("app/api/auth/logout/route.ts");
const ADMIN_AUTH = code("app/api/admin/auth/route.ts");
const SUPABASE = code("lib/auth/supabase.ts");

test("establishAccount cannot attach on its own: it never reads the browser's sessions", () => {
  /*
   * The finding. `attachToCurrent !== false` meant «unless told otherwise»,
   * and the two callers that passed nothing — the email confirmation link and
   * the password reset — went down the attach branch. Inside it the admin
   * session was consulted unconditionally, so a signup confirmed in the
   * operator's browser bound that identity to the operator's account.
   *
   * The structural fix is that the function has no access to a session at all:
   * a caller that wants an attach has to name the account.
   */
  assert.doesNotMatch(ACCOUNT_SESSION, /getSession|getAdminSessionDetail/);
  assert.match(ACCOUNT_SESSION, /options: \{ attachTo\?: string \| null \} = \{\}/);
  assert.match(ACCOUNT_SESSION, /const target = options\.attachTo \?\? null;/);
  assert.doesNotMatch(ACCOUNT_SESSION, /attachToCurrent/);
});

test("a password reset never attaches, and a confirmation only on a named instruction", () => {
  assert.match(PASSWORD, /establishAccount\(identity, \{ attachTo: null \}\)/);
  /* The confirmation link finishes in a mailbox, so the instruction cannot ride
     on the link — anyone could add it there. It is a signed cookie naming this
     session, this account and this exact address, and it is spent on the way
     out whatever the outcome. */
  assert.match(CONFIRM, /establishAccount\(identity, \{ attachTo: instructed \? live\.accountId : null \}\)/);
  assert.match(CONFIRM, /attachIntentMatches\(readAttachIntent\(req\.cookies\.get\(ATTACH_COOKIE\)\?\.value\), live\)/);
  assert.match(CONFIRM, /purpose: "email_signup" as const/);
  assert.match(CONFIRM, /res\.cookies\.delete\(ATTACH_COOKIE\)/);
  assert.match(EMAIL, /issueAttachIntent\(\{ purpose: "email_signup", context, accountId, subject: parsed\.email \}\)/);
  /* The instruction is only minted for a session that qualifies to be attached
     to, so a browser signed in through an account door mints none. */
  assert.match(EMAIL, /const accountId = attachableAccountId\(session\);/);
});

test("an attach happens only against an account this browser may attach to", () => {
  /* Both remaining callers resolve a concrete target through the qualifying
     rule instead of passing a bare boolean deeper. */
  assert.match(EMAIL, /const attachTo = attach \? attachableAccountId\(await getSession\(\)\) : null;/);
  assert.match(CALLBACK, /const attachTo = trip\?\.attach === true \? attachableAccountId\(await getSession\(\)\) : null;/);
});

test("linking checks that the account and the returned identity are the same person", () => {
  /* Before: the account named by `rt` was bound to whatever user came back
     from the provider. The database refused a *different* binding, but a
     legacy account with no identity was bound silently to a stranger. */
  const linkBlock = CALLBACK.slice(CALLBACK.indexOf('if (trip?.purpose === "link")'), CALLBACK.indexOf("/* Recovery links land here"));
  assert.match(linkBlock, /await matchIdentity\(session, identity\.authUserId\)/);
  assert.match(linkBlock, /agreement === "mismatch"/);
  assert.match(linkBlock, /attachableAccountId\(session\)/);
  const guardAt = linkBlock.indexOf("matchIdentity");
  const bindAt = linkBlock.indexOf("accountBindAuth");
  assert.ok(guardAt > 0 && bindAt > guardAt, "the agreement is checked before anything is bound");
});

test("identity reads and unlinks require the two sessions to agree", () => {
  assert.match(IDENTITY, /const agreement = user \? await matchIdentity\(session, user\.id\) : "signed_out";/);
  assert.match(IDENTITY, /identityStore = "mismatch"/);
  const post = IDENTITY.slice(IDENTITY.indexOf("export async function POST"));
  assert.match(post, /if \(agreement !== "match"\) return json\(/);
  const checkAt = post.indexOf("matchIdentity");
  const unlinkAt = post.indexOf("unlinkIdentity(identity)");
  assert.ok(checkAt > 0 && unlinkAt > checkAt, "the agreement is checked before the unlink");
});

test("the admin bootstrap is a named, confirmed, single-context action", () => {
  assert.match(ADMIN_AUTH, /action: z\.literal\("attach_intent"\)/);
  assert.match(ADMIN_AUTH, /action: z\.literal\("attach"\), intent: z\.string\(\)[^,]*, accountId: z\.string\(\)\.uuid\(\)/);
  assert.match(ADMIN_AUTH, /if \(body\.accountId !== accountId\) return json\(\{ status: "context_changed" \}, 409\);/);
  assert.match(ADMIN_AUTH, /attachIntentMatches\(readAttachIntent\(body\.intent\), live\)/);
  const matchAt = ADMIN_AUTH.indexOf("attachIntentMatches");
  const bindAt = ADMIN_AUTH.indexOf("await accountBindAuth(accountId, user.id)");
  assert.ok(matchAt > 0 && bindAt > matchAt, "the intent is checked before the bind");
});

test("the admin session is opened for the identity the state was computed for", () => {
  assert.match(ADMIN_AUTH, /if \(user\.id !== state\.authUserId\) return json\(\{ status: "signed_out" \}, 401\);/);
  assert.match(ADMIN_AUTH, /mfaFresh: mfaIsFresh\(state\.mfaAt\)/);
  assert.doesNotMatch(ADMIN_AUTH, /mfa: true/);
});

test("the status answer carries the factor the panel has to verify against", () => {
  assert.match(ADMIN_AUTH, /factorId: state\.status === "verify" \? state\.factorId : null/);
});

test("no revocation result is dropped, and a cleared cookie is not reported as one", () => {
  /* Logout used to answer `ok: true` whatever the store said. */
  assert.match(LOGOUT, /const count = await sessionRevokeAccount\(/);
  assert.match(LOGOUT, /revoked = count !== null;/);
  assert.match(LOGOUT, /await accountLegacyClose\(session\.accountId, "logout_all"\)/);
  assert.match(LOGOUT, /const complete = revoked && identityEnded;/);
  assert.match(LOGOUT, /\{ status: complete \? 200 : 503/);
  assert.doesNotMatch(LOGOUT, /NextResponse\.json\(\{ ok: true, scope \}/);
});

test("a password reset that could not end the other sessions says so", () => {
  assert.match(PASSWORD, /const complete = revoked !== null && identitySignedOut && legacy !== "unavailable";/);
  assert.match(PASSWORD, /status: complete \? "updated" : "updated_sessions_open"/);
  assert.match(PASSWORD, /accountLegacyClose\(account\.accountId, "password_reset"\)/);
});

test("a mail that was not sent is never reported as sent", () => {
  assert.match(EMAIL, /deliveryJson\(deliveryOutcome\(error\), \{ status: "confirm_email" \}\)/);
  assert.match(EMAIL, /deliveryJson\(deliveryOutcome\(recoveryError\), \{ status: "recovery_sent" \}\)/);
  assert.doesNotMatch(EMAIL, /await client\.auth\.resend\(\{[^}]*\}\);\s*\n\s*return json\(\{ status: "confirm_email" \}\)/);
});

test("both email landings accept both link forms", () => {
  assert.match(CONFIRM, /if \(!tokenHash && code\)/);
  assert.match(CONFIRM, /"\/auth\/callback"/);
  assert.match(CALLBACK, /if \(!code && url\.searchParams\.get\("token_hash"\)\)/);
  assert.match(CALLBACK, /"\/auth\/confirm"/);
});

test("a method that is off is refused by the server, not only hidden in the sheet", () => {
  assert.match(CALLBACK, /if \(!methods\[tripMethod\]\) return redirect\(url\.origin, withAuthMarker\(next, "error", "method_off"\)\)/);
  assert.match(CONFIRM, /if \(!accountMethods\(\)\.email\) return redirect\(url\.origin, withAuthMarker\(next, "error", "method_off"\)\)/);
  assert.match(IDENTITY, /if \(!accountMethods\(\)\.email\) return json\(\{ error: "unavailable", status: "off" \}, 503\)/);
  assert.match(ADMIN_AUTH, /if \(!accountMethods\(\)\.email\) return json\(\{ status: "unavailable" \}, 503\)/);
});

test("identity cookies are written with stated attributes and cleared with their chunks", () => {
  /* The rules themselves are exercised in `lib/auth/cookie-policy.test.mjs`;
     what is pinned here is that the writer and the logout actually use them. */
  assert.match(SUPABASE, /httpOnly: true, sameSite: "lax", path: "\/", secure: secureCookies\(\)/);
  assert.match(LOGOUT, /supabaseAuthCookieNames\(req\.cookies\.getAll\(\)\.map\(\(c\) => c\.name\)\)/);
});
