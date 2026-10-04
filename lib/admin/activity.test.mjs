import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repo = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repo), "utf8");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:1";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "test-anon";
process.env.BETA_APP_SECRET = process.env.BETA_APP_SECRET || "test-secret";

const activityUrl = new URL("./activity.ts", import.meta.url);
activityUrl.searchParams.set("t", String(Date.now()));
const {
  classifyRpcFailure,
  loginTargetOf,
  parseActivitySummary,
  parseUserActivity,
  recordAccountLogin,
  recordProductEvent,
} = await import(activityUrl.href);

function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a bot link's next target is classified, and anything else is unknown", () => {
  assert.equal(loginTargetOf("/admin"), "admin");
  assert.equal(loginTargetOf("/app/beta?x=1"), "app");
  assert.equal(loginTargetOf("/beta"), "beta");
  assert.equal(loginTargetOf("/demo"), "demo");
  assert.equal(loginTargetOf("/administrator"), null);
  assert.equal(loginTargetOf(""), null);
  assert.equal(loginTargetOf(null), null);
});

test("a store failure is an error the operator sees; a refused rule is not an activity", () => {
  assert.deepEqual(classifyRpcFailure("temporarily unavailable"), { outcome: "error", errorClass: "store_unavailable" });
  assert.deepEqual(classifyRpcFailure("not configured"), { outcome: "error", errorClass: "store_unavailable" });
  assert.deepEqual(classifyRpcFailure("trade not found"), { outcome: "refused", errorClass: "not_found" });
  assert.deepEqual(classifyRpcFailure("bad size"), { outcome: "refused", errorClass: "validation" });
});

test("recording a login tells recorded, duplicate, not collected and unavailable apart", async () => {
  const calls = [];
  await withFetch(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return json(200, { ok: true, recorded: true, first: true });
  }, async () => {
    assert.equal(await recordAccountLogin({ telegramId: 7, kind: "telegram_link", admin: false, target: "app", nonce: "nonce-000000000001" }), "recorded");
  });
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/account_login_record$/);
  assert.deepEqual(calls[0].body, { p_secret: "test-secret", p_account_id: null, p_telegram_id: 7, p_wallet: null, p_kind: "telegram_link", p_admin: false, p_target: "app", p_nonce: "nonce-000000000001" });

  await withFetch(async () => json(200, { ok: true, recorded: false, first: false }), async () => {
    assert.equal(await recordAccountLogin({ telegramId: 7, kind: "telegram_link", admin: false, target: "app", nonce: "nonce-000000000001" }), "duplicate");
  });
  await withFetch(async () => json(404, { code: "PGRST202", message: "Could not find the function" }), async () => {
    assert.equal(await recordAccountLogin({ telegramId: 7, kind: "telegram_link", admin: true, target: "admin", nonce: "n" }), "not_collected");
  });
  await withFetch(async () => json(500, { message: "boom" }), async () => {
    assert.equal(await recordAccountLogin({ telegramId: 7, kind: "telegram_link", admin: false, target: null, nonce: "n" }), "unavailable");
  });
  await withFetch(async () => { throw new Error("network down"); }, async () => {
    assert.equal(await recordAccountLogin({ wallet: "0x" + "a".repeat(40), kind: "wallet_siwe", admin: false, target: "app", nonce: "n" }), "unavailable");
  });
  assert.equal(await recordAccountLogin({ kind: "telegram_link", admin: false, target: "app", nonce: "n" }), "refused", "no subject, no row");
});

test("a slow store never holds the caller past the deadline", async () => {
  const startedAt = Date.now();
  await withFetch(() => new Promise((resolve) => setTimeout(() => resolve(json(200, { ok: true, recorded: true })), 500)), async () => {
    assert.equal(await recordAccountLogin({ telegramId: 7, kind: "telegram_link", admin: false, target: "app", nonce: "n" }, { timeoutMs: 40 }), "unavailable");
  });
  assert.ok(Date.now() - startedAt < 400);
});

test("a product event strips forbidden props at every depth and refuses an unknown name", async () => {
  let sent = null;
  await withFetch(async (_url, init) => {
    sent = JSON.parse(String(init.body));
    return json(200, { ok: true });
  }, async () => {
    const outcome = await recordProductEvent({
      actor: { kind: "account", telegramId: 9 },
      name: "paper_plan_opened",
      outcome: "ok",
      surface: "app",
      props: { first: true, steps: [{ wallet_address: "0xabc", note: "x" }], pnl: 3, market: "SOL-USDC" },
    });
    assert.equal(outcome, "recorded");
  });
  assert.deepEqual(sent.p_props, { first: true, steps: [{ note: "x" }], market: "SOL-USDC" });
  assert.equal(sent.p_actor_kind, "account");
  assert.equal(sent.p_telegram_id, 9);
  assert.equal(await recordProductEvent({ actor: { kind: "anonymous" }, name: "page_viewed", outcome: "ok" }), "refused", "page views are not events");
  await withFetch(async () => json(404, {}), async () => {
    assert.equal(await recordProductEvent({ actor: { kind: "anonymous" }, name: "feedback_sent", outcome: "ok", surface: "site" }), "not_collected");
  });
});

test("the summary parser is tolerant and keeps units, and a bad payload is null", () => {
  assert.equal(parseActivitySummary({ ok: false }), null);
  assert.equal(parseActivitySummary("nope"), null);
  const parsed = parseActivitySummary({ ok: true, accounts: { total: "4" }, daily_30d: [{ day: "2026-09-04", signed_in: 2 }, { nope: 1 }], cohorts: [{ week: "2026-08-03", n: 1, returned_w1: 1, complete: true }] });
  assert.equal(parsed.accounts.total, 0, "a string is not a count");
  assert.deepEqual(parsed.daily30d, [{ day: "2026-09-04", signedIn: 2, acted: 0, errors: 0 }]);
  assert.deepEqual(parsed.cohorts, [{ week: "2026-08-03", n: 1, returnedW1: 1, complete: true }]);
  const user = parseUserActivity({ ok: true, is_operator: false, login_count: 2, timeline: [{ at: "2026-09-04T09:00:00Z", type: "login", name: "telegram_link", outcome: "ok", admin: false, target: "app" }, { type: "event" }] });
  assert.equal(user.loginCount, 2);
  assert.equal(user.timeline.length, 1, "a timeline entry without a time is dropped");
});

test("logins are recorded only by the server exchanges, after the nonce is spent and the session minted", () => {
  const session = read("app/api/session/route.ts");
  const mintAt = session.indexOf("const sessionToken =");
  const nonceAt = session.indexOf("consumeLoginNonce(login.jti");
  const recordAt = session.indexOf("await recordAccountLogin(");
  const redirectAt = session.indexOf("NextResponse.redirect(new URL(next, url.origin))");
  assert.ok(nonceAt > 0 && mintAt > nonceAt && recordAt > mintAt && redirectAt > recordAt, "verify → spend nonce → mint → record → redirect");
  assert.match(session, /nonce: login\.jti/);
  assert.match(session, /admin: login\.admin/);
  assert.match(session, /target: loginTargetOf\(next\)/);

  const wallet = read("app/api/auth/wallet/route.ts");
  /* A signature is a proof, recorded as that account's login only when an
     account has linked the address. */
  assert.equal((wallet.match(/await recordAccountLogin\(/g) ?? []).length, 1, "the proof door records once");
  assert.ok(wallet.indexOf("await recordAccountLogin(") > wallet.indexOf("verifySiwe("), "only after the signature is verified");
  assert.match(wallet, /kind: "wallet_siwe"/);
  assert.doesNotMatch(wallet.slice(wallet.indexOf('action === "link"'), wallet.indexOf("const proof = await sessionOpen")), /recordAccountLogin/, "linking a wallet is not a login");
  const solana = read("app/api/auth/solana/route.ts");
  assert.equal((solana.match(/await recordAccountLogin\(/g) ?? []).length, 1);
  assert.ok(solana.indexOf("await recordAccountLogin(") > solana.indexOf("await verifySiws("), "only after the signature is verified");
  assert.match(solana, /kind: "solana_siws"/);
  assert.doesNotMatch(solana.slice(solana.indexOf('action === "link"'), solana.indexOf("const proof = await sessionOpen")), /recordAccountLogin/, "linking a wallet is not a login");

  /* No other file mints a login row. */
  for (const file of ["lib/session.ts", "app/api/track/route.ts", "app/api/telegram/route.ts"]) {
    assert.doesNotMatch(read(file), /recordAccountLogin/, file);
  }
});

test("product events are recorded after the permitted action completed, without amounts or texts", () => {
  const paper = read("app/api/paper/route.ts");
  for (const name of ["paper_plan_opened", "paper_plan_closed", "paper_journal_saved"]) assert.match(paper, new RegExp(`name: "${name}", outcome: "ok"`));
  for (const line of paper.split("\n").filter((l) => l.includes("recordProductEvent("))) {
    assert.doesNotMatch(line, /entry|size|sl\b|tp\b|pnl|exit|fee|market/, line);
  }
  const live = read("app/api/live/route.ts");
  assert.match(live, /name: "journal_note_saved", outcome: "ok"/);
  for (const line of live.split("\n").filter((l) => l.includes("recordProductEvent("))) assert.doesNotMatch(line, /pnl|market|lesson|mistake/, line);
  const feedback = read("app/api/feedback/route.ts");
  assert.match(feedback, /name: "feedback_sent", outcome: "ok"/);
  for (const line of feedback.split("\n").filter((l) => l.includes("recordProductEvent("))) assert.doesNotMatch(line, /body: text|text\b/, line);
  assert.match(read("app/api/strategy-lab/approve/route.ts"), /name: "strategy_approved", outcome: "ok"/);
  assert.match(read("app/api/strategy-lab/formalize/route.ts"), /name: "strategy_formalized", outcome: "ok"/);
  /* Financial execution routes stay untouched by this instrumentation. */
  for (const file of ["app/api/solana/swap/execute/route.ts", "app/api/solana/transfer/settle/route.ts", "app/api/solana/bridge/burn/route.ts", "app/api/solana/bridge/receive/route.ts"]) {
    assert.doesNotMatch(read(file), /recordProductEvent|recordAccountLogin/, file);
  }
  assert.match(read("app/api/track/route.ts"), /"workspace_cta_click"/, "the site's workspace CTA is accepted");
});
