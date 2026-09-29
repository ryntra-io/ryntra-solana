// Run from repo root: node --test --test-isolation=none lib/admin-auth.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sessionRoute = readFileSync(new URL("../app/api/session/route.ts", import.meta.url), "utf8");
const session = readFileSync(new URL("./session.ts", import.meta.url), "utf8");
const adminRoute = readFileSync(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("./admin/store.ts", import.meta.url), "utf8");

test("admin login exchange revalidates operator authority before spending the one-time nonce", () => {
  const verifyAt = sessionRoute.indexOf("verifyLoginToken(t)");
  const roleAt = sessionRoute.indexOf("await isAdminOperator(");
  const nonceAt = sessionRoute.indexOf("consumeLoginNonce(login.jti");
  const mintAt = sessionRoute.indexOf("const sessionToken =");

  assert.ok(sessionRoute.includes('from "@/lib/admin/store"'), "exchange must use operator authority");
  assert.ok(roleAt > verifyAt, "role lookup must happen only after the login credential is verified");
  assert.ok(roleAt < nonceAt, "a removed operator or lookup failure must fail closed before spending the nonce");
  assert.ok(roleAt < mintAt, "admin session must never be minted before the live role check");
});

test("every protected admin request revalidates current operator membership", () => {
  const verifyAt = session.indexOf("verifySession(token)");
  const roleAt = session.indexOf("await isAdminOperator(");

  assert.ok(session.includes('from "@/lib/admin/store"'), "admin cookie validation must include a live operator check");
  assert.ok(roleAt > verifyAt, "only a valid admin session token may reach the operator store");
  assert.match(session, /if \(!parsed\?\.admin \|\| parsed\.subject\.kind !== "telegram"\) return null;/);
  assert.ok(
    session.slice(roleAt).includes("? telegramId : null"),
    "non-admin, removed-admin, and lookup failure outcomes must return null"
  );
});

test("admin POST rejects cross-site requests before session or side effects", () => {
  const originAt = adminRoute.indexOf("mutationOriginAllowed(");
  /* RYN-ACCESS-002: the POST gate is the second-factor freshness check, which
     itself reads the admin session. */
  const sessionAt = adminRoute.indexOf("requireFreshMfa()", adminRoute.indexOf("export async function POST"));
  const jsonAt = adminRoute.indexOf("req.json()", adminRoute.indexOf("export async function POST"));

  assert.ok(adminRoute.includes('from "@/lib/security"'), "admin POST must use the shared exact-origin guard");
  assert.ok(originAt > adminRoute.indexOf("export async function POST"), "origin guard must be in POST");
  assert.ok(originAt < sessionAt, "cross-site requests must be rejected before session work");
  assert.ok(originAt < jsonAt, "cross-site requests must be rejected before body parsing or action work");
  assert.match(adminRoute, /return NextResponse.json\(\{ error: "forbidden" \}, \{ status: 403 \}\)/);
});

test("operator store uses the channel only as empty-table bootstrap or unmigrated fallback", () => {
  assert.match(store, /isChannelAdmin/);
  assert.match(store, /bootstrapOperator/);
  assert.match(store, /decideAdminAuthority/);
});

test("runtime Telegram role matrix accepts only creator/admin and fails closed", async () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  process.env.TELEGRAM_BOT_TOKEN = "unit-test-bot-token";

  const apiUrl = new URL("./telegram/api.ts", import.meta.url);
  apiUrl.searchParams.set("admin-role-test", String(Date.now()));
  const { isChannelAdmin } = await import(apiUrl.href);
  let status = "creator";
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { chat_id: "@Ryntra_io", user_id: 123 });
    return { json: async () => ({ ok: true, result: { status } }) };
  };
  console.error = () => {};

  try {
    for (const allowed of ["creator", "administrator"]) {
      status = allowed;
      assert.equal(await isChannelAdmin("@Ryntra_io", 123), true, allowed);
    }
    for (const denied of ["member", "left", "kicked", "restricted"]) {
      status = denied;
      assert.equal(await isChannelAdmin("@Ryntra_io", 123), false, denied);
    }
    globalThis.fetch = async () => { throw new Error("network down"); };
    assert.equal(await isChannelAdmin("@Ryntra_io", 123), false, "Telegram failure must deny");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  }
});
