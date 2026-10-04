// Run from repo root: node --test lib/beta/token.test.mjs
// The HMAC signer reads BETA_TOKEN_SECRET at module load, so set it BEFORE importing token.ts
// (ES `import` is hoisted; a dynamic import after the env write is the reliable way).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

process.env.BETA_TOKEN_SECRET = process.env.BETA_TOKEN_SECRET || "test-secret-for-token-suite";
const {
  issueLoginToken,
  issueSessionToken,
  issueAdminLoginToken,
  issueAdminSessionToken,
  issueWalletSessionToken,
  verifyLoginToken,
  verifySession,
  statusPageUrl,
  sessionUrl,
  adminSessionUrl,
  demoUrl,
} = await import("./token.ts");

const TID = 123456789;
const ADMIN_TID = 987654321;

test("issue produces opaque base64url tokens", () => {
  for (const t of [issueLoginToken(TID), issueSessionToken(TID), issueAdminLoginToken(ADMIN_TID), issueAdminSessionToken(ADMIN_TID)]) {
    assert.equal(typeof t, "string");
    assert.match(t, /^[A-Za-z0-9_-]+$/); // base64url, no padding/=
  }
});

test("new login tokens carry unique, bounded JTI credentials", () => {
  const first = verifyLoginToken(issueLoginToken(TID));
  const second = verifyLoginToken(issueLoginToken(TID));
  assert.equal(typeof first?.jti, "string");
  assert.match(first.jti, /^[A-Za-z0-9_-]{24}$/);
  assert.match(second.jti, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(first.jti, second.jti, "every issued login link needs a unique replay key");
  assert.ok(first.expiresAt > Date.now());
  assert.ok(first.expiresAt <= Date.now() + 7 * 24 * 3600 * 1000 + 1000);
});

test("PURPOSE SEPARATION: a login token is NOT a session/API credential", () => {
  const login = issueLoginToken(TID);
  assert.equal(verifySession(login), null, "login token must be rejected as a session");
  // but it IS accepted at the exchange
  assertLoginCredential(verifyLoginToken(login), TID, false, true);
});

test("PURPOSE SEPARATION: a session token is NOT a login link", () => {
  const sess = issueSessionToken(TID);
  assert.equal(verifyLoginToken(sess), null, "session token must be rejected at the login exchange");
  // but it IS accepted as an HttpOnly-cookie session
  assert.deepEqual(verifySession(sess), { subject: { kind: "telegram", telegramId: TID }, admin: false });
});

test("ADMIN separation: admin login exchanges to an admin-only session", () => {
  const alogin = issueAdminLoginToken(ADMIN_TID);
  assertLoginCredential(verifyLoginToken(alogin), ADMIN_TID, true, true);
  assert.equal(verifySession(alogin), null, "admin LOGIN token is not a session");

  const asess = issueAdminSessionToken(ADMIN_TID);
  assert.deepEqual(verifySession(asess), { subject: { kind: "telegram", telegramId: ADMIN_TID }, admin: true });
  assert.equal(verifyLoginToken(asess), null, "admin session is not a login link");
});

test("WALLET SUBJECT: an address is its own subject, never a Telegram id", () => {
  const WALLET = "0x" + "ab".repeat(20);

  /* The address is lowercased at issue, so a mixed-case spelling of the same
     wallet cannot become a second account. */
  const mixed = issueWalletSessionToken("0x" + "Ab".repeat(20));
  assert.deepEqual(verifySession(mixed), { subject: { kind: "wallet", wallet: WALLET }, admin: false });

  /* The two subject kinds are distinguishable by a parser and by a person
     reading a payload — which is the whole reason a synthetic Telegram id was
     refused for wallet accounts. */
  const sess = issueWalletSessionToken(WALLET);
  const parsed = verifySession(sess);
  assert.equal(parsed.subject.kind, "wallet");
  assert.equal(parsed.subject.telegramId, undefined, "a wallet subject must carry no Telegram id at all");

  /* There is no wallet login link and no wallet admin. */
  assert.equal(verifyLoginToken(sess), null, "a wallet session is not a login link");
  assert.equal(issueWalletSessionToken("not-an-address"), null);
  assert.equal(issueWalletSessionToken("0x" + "zz".repeat(20)), null);
});

test("cross-type: login credentials are never accepted as sessions", () => {
  assert.equal(verifySession(issueLoginToken(TID)), null);
  assert.equal(verifySession(issueAdminLoginToken(ADMIN_TID)), null);
});

test("malformed / tampered / empty tokens are rejected everywhere", () => {
  for (const bad of ["", "not-a-token", "AAAA", "....", "deadbeef"]) {
    assert.equal(verifyLoginToken(bad), null);
    assert.equal(verifySession(bad), null);
  }
  // tamper: flip a char in a valid token's body
  const good = issueSessionToken(TID);
  const tampered = good.slice(0, -3) + (good.slice(-3) === "AAA" ? "BBB" : "AAA");
  assert.equal(verifySession(tampered), null);
});

test("expiry is enforced (source: TTLs are bounded, not 45 days)", () => {
  const src = readFileSyncSafe();
  // the old 45-day user token constant must be gone; login TTLs are days/hours, not 45d
  assert.ok(!src.includes("45 * 24 * 3600 * 1000"), "the 45-day user TTL must be gone");
  assert.ok(src.includes("LOGIN_TTL_MS"), "login TTL constant present");
  assert.ok(src.includes("SESSION_TTL_MS"), "session TTL constant present");
  assert.ok(!src.includes("LEGACY_SUNSET_MS"), "legacy compatibility must not assume an undeployed commit date");
});

test("LEGACY COMPAT: ordinary user tokens survive, but legacy admin credentials fail closed", () => {
  // Hand-mint a legacy-format token with the same signer the module uses.
  const legacy = mintLegacy(`${TID}~${Date.now() + 3600_000}`);
  assertLoginCredential(verifyLoginToken(legacy), TID, false, false);
  assert.deepEqual(
    verifySession(legacy),
    { subject: { kind: "telegram", telegramId: TID }, admin: false },
    "legacy accepted as session",
  );

  const legacyAdmin = mintLegacy(`admin:${ADMIN_TID}~${Date.now() + 3600_000}`);
  assert.equal(verifyLoginToken(legacyAdmin), null, "admin login must always be purpose-bound and replayable only once");
  assert.equal(verifySession(legacyAdmin), null, "admin session must always be explicitly purpose-bound");

  // expired legacy is rejected
  const expired = mintLegacy(`${TID}~${Date.now() - 1000}`);
  assert.equal(verifySession(expired), null);
});

test("ROLLOUT COMPAT: pre-JTI purpose-separated login links remain valid until signed expiry", () => {
  const exp = Date.now() + 3600_000;
  const oldLogin = mintLegacy(`login:${TID}~${exp}`);
  assertLoginCredential(verifyLoginToken(oldLogin), TID, false, false);
  assert.equal(verifySession(oldLogin), null);

  const oldAdminLogin = mintLegacy(`login:admin:${ADMIN_TID}~${exp}`);
  assert.equal(verifyLoginToken(oldAdminLogin), null, "admin login without a JTI must not bypass one-time exchange");

  const sessionWithJti = mintLegacy(`sess:${TID}~${exp}~AAAAAAAAAAAAAAAAAAAAAAAA`);
  assert.equal(verifySession(sessionWithJti), null, "session credentials must never accept a JTI suffix");
});

test("bot deep-links carry LOGIN tokens (exchangeable), and are clean URLs", () => {
  const su = sessionUrl(TID, "en", "/robinhood/workspace/terminal");
  assert.match(su, /^https:\/\/ryntra\.io\/api\/session\?t=/);
  const tokenInUrl = new URL(su).searchParams.get("t");
  assertLoginCredential(verifyLoginToken(tokenInUrl), TID, false, true);
  assert.equal(verifySession(tokenInUrl), null, "the URL token is a login token, not a session");

  const bu = statusPageUrl(TID, "en");
  assert.equal(new URL(bu).searchParams.get("next"), "/app/beta");
  assert.match(bu, /^https:\/\/ryntra\.io\/api\/session\?t=/);
  assertLoginCredential(verifyLoginToken(new URL(bu).searchParams.get("t")), TID, false, true);

  const au = adminSessionUrl(ADMIN_TID);
  assertLoginCredential(verifyLoginToken(new URL(au).searchParams.get("t")), ADMIN_TID, true, true);

  const du = demoUrl(TID, "en");
  assert.equal(new URL(du).searchParams.get("next"), "/robinhood/workspace/terminal");
});

test("/api/session mints a DISTINCT session token, never stores the raw login token", () => {
  const src = sessionRouteSrc();
  assert.ok(src.includes("verifyLoginToken"), "exchange verifies a login token");
  assert.ok(/issueSessionToken|issueAdminSessionToken/.test(src), "exchange mints a fresh session token");
  assert.ok(!/cookies\.set\("rt", t,/.test(src), "must NOT store the raw ?t= login token as the cookie");
  assert.ok(src.includes("sessionToken"), "cookie value is the minted session token");
  assert.ok(src.includes("loginNavigationAllowed"), "exchange must allow only user-initiated cross-site navigations");
  assert.ok(src.includes("consumeLoginNonce"), "exchange must atomically consume new login JTIs");
  assert.match(src, /consumeLoginNonce\(login\.jti, login\.expiresAt\)/);
  assert.ok(
    src.indexOf("consumeLoginNonce(login.jti") < src.indexOf("const sessionToken ="),
    "JTI must be consumed before any session is minted"
  );
  assert.match(src, /searchParams\.set\("auth", "refresh"\)/, "invalid, used or unavailable login links need a recovery URL");
});
test("login tokens are consumed only by /api/session; beta/demo pages never authorize them directly", () => {
  for (const rel of ["../../app/beta/page.tsx", "../../app/demo/page.tsx"]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!src.includes("verifyLoginToken"), `${rel} must not verify login tokens directly`);
    assert.ok(!src.includes("issueSessionToken"), `${rel} must not mint session tokens`);
    assert.ok(src.includes("/api/session"), `${rel} must redirect legacy token URLs through the exchange`);
  }
});

test("terminal APIs use the HttpOnly session cookie, never client/query/body bearer tokens", () => {
  const terminalPage = readFileSync(new URL("../../app/robinhood/workspace/terminal/page.tsx", import.meta.url), "utf8");
  const terminalClient = readFileSync(new URL("../../app/demo/terminal.tsx", import.meta.url), "utf8");
  assert.ok(!terminalPage.includes("issueSessionToken"));
  assert.ok(!terminalPage.includes("token={"));
  assert.ok(!terminalClient.includes("Authorization: `Bearer ${token}`"));
  assert.ok(!terminalClient.includes("JSON.stringify({ t: token"));

  for (const rel of ["../../app/api/paper/route.ts", "../../app/api/live/route.ts"]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(src.includes("getSession"), `${rel} must authenticate with the HttpOnly cookie`);
    assert.ok(!src.includes('searchParams.get("t")'), `${rel} must reject query-string session tokens`);
    assert.ok(!/typeof body\.t\s*===/.test(src), `${rel} must reject body session tokens`);
    assert.ok(src.includes("mutationOriginAllowed"), `${rel} POST must enforce same-origin requests`);
  }
});

test("used or expired login links render a clear recovery state", () => {
  const beta = readFileSync(new URL("../../app/beta/page.tsx", import.meta.url), "utf8");
  assert.match(beta, /sp\.auth === "refresh"/);
  assert.match(beta, /authRecovery/);
  assert.match(beta, /role="status"/);
  assert.match(beta, /robots: sp\.t \|\| sp\.auth/);
});

// --- helpers ---
function readFileSyncSafe() {
  return readFileSync(new URL("./token.ts", import.meta.url), "utf8");
}
function sessionRouteSrc() {
  return readFileSync(new URL("../../app/api/session/route.ts", import.meta.url), "utf8");
}
/** Re-create a legacy (pre-purpose) token with the module's own secret + scheme. */
function mintLegacy(payload) {
  const mac = createHmac("sha256", process.env.BETA_TOKEN_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${mac}`).toString("base64url");
}

function assertLoginCredential(actual, telegramId, admin, hasJti) {
  assert.ok(actual);
  assert.equal(actual.telegramId, telegramId);
  assert.equal(actual.admin, admin);
  assert.ok(actual.expiresAt > Date.now());
  if (hasJti) {
    assert.match(actual.jti, /^[A-Za-z0-9_-]{24}$/);
  } else {
    assert.equal(actual.jti, null);
  }
}

test("a recorded-session reference is a session credential and nothing else", async () => {
  const { issueSessionRefToken } = await import("./token.ts");
  const id = "0f2c4d9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  const exp = Date.now() + 3600_000;
  const customer = issueSessionRefToken(id, exp);
  const admin = issueSessionRefToken(id, exp, true);
  assert.ok(customer && admin);
  assert.deepEqual(verifySession(customer), { subject: { kind: "session", sessionId: id }, admin: false });
  assert.deepEqual(verifySession(admin), { subject: { kind: "session", sessionId: id }, admin: true });
  assert.equal(verifyLoginToken(customer), null, "a session reference is never a login link");
  assert.equal(verifyLoginToken(admin), null);
  assert.equal(issueSessionRefToken("not-a-uuid", exp), null);
  assert.equal(issueSessionRefToken(id, Date.now() - 1), null, "an already-expired reference is not issued");
  assert.equal(issueSessionRefToken(id.toUpperCase(), exp)?.length, customer.length, "ids are lowercased, never two forms");
});
