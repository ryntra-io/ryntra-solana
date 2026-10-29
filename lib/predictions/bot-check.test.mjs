// Run from repo root: node --test lib/predictions/bot-check.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { getPredictionProvider, resetAggAdapterCache } from "./agg/adapter.ts";
import { challengeFailure, challengeOf, isTurnstileToken, readBotSiteKey, resetBotSiteKey, startThroughBotCheck, withTurnstile } from "./bot-check.ts";
import { PREDICTION_FAILURE_STATUS, failureBody } from "./failure.ts";
import { startLink } from "./link.ts";

const SITE_KEY = "0x4AAAAAAATESTKEYforRyntra";
/* Cloudflare's own test answer: what its always-passing test key hands the page. */
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const EVM_WALLET = "0x4480dcf81d177a4295b4ff32393ebeda35bb02e2";
const savedSecret = process.env.BETA_TOKEN_SECRET;
process.env.BETA_TOKEN_SECRET = "test-secret-of-sufficient-length";
test.after(() => {
  if (savedSecret === undefined) delete process.env.BETA_TOKEN_SECRET;
  else process.env.BETA_TOKEN_SECRET = savedSecret;
});

/**
 * The provider's sign-in start as it behaves under load: more than `limit`
 * starts at once without a token answer `challenge_required`; a start that
 * carries a token is let through. Wallet providers get a nonce, email a
 * magic link.
 */
function busyProvider({ limit = 50, siteKey = SITE_KEY, asError = false, refuseTokens = false } = {}) {
  let open = 0;
  const seen = [];
  const start = async (body) => {
    seen.push(body);
    open += 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if ((!body.turnstileToken || refuseTokens) && open > limit) {
        if (asError) throw Object.assign(new Error("challenge"), { status: 403, code: "challenge_required" });
        return { type: "challenge_required", ...(siteKey ? { siteKey } : {}) };
      }
      return body.provider === "email" ? { type: "magic_link", success: true } : { type: "nonce", nonce: `n-${seen.length}` };
    } finally {
      open -= 1;
    }
  };
  return { start, seen };
}

const noLookup = async () => null;

test("a quiet start reads exactly as before: no token field, the nonce comes back", async () => {
  const provider = busyProvider();
  const answer = await startThroughBotCheck(provider.start, { provider: "siws" }, null, noLookup);
  assert.deepEqual(answer, { ok: true, value: { type: "nonce", nonce: "n-1" } });
  assert.deepEqual(provider.seen[0], { provider: "siws" });
});

test("under load the wallet start answers CHALLENGE_REQUIRED with the site key; the same start with the token gets the nonce", async () => {
  const provider = busyProvider({ limit: 0 });
  const first = await startThroughBotCheck(provider.start, { provider: "siwe" }, null, noLookup);
  assert.equal(first.ok, false);
  assert.equal(first.code, "CHALLENGE_REQUIRED");
  assert.equal(first.siteKey, SITE_KEY);
  assert.equal(PREDICTION_FAILURE_STATUS.CHALLENGE_REQUIRED, 428);

  const again = await startThroughBotCheck(provider.start, { provider: "siwe" }, TOKEN, noLookup);
  assert.equal(again.ok, true);
  assert.equal(again.value.type, "nonce");
  assert.deepEqual(provider.seen[1], { provider: "siwe", turnstileToken: TOKEN });
});

test("the email start goes through the same check: challenge, then the magic link with the token", async () => {
  const provider = busyProvider({ limit: 0 });
  const body = { provider: "email", email: "person@example.com", redirectUrl: "https://predict.ryntra.io/auth" };
  const first = await startThroughBotCheck(provider.start, body, null, noLookup);
  assert.equal(first.code, "CHALLENGE_REQUIRED");
  const again = await startThroughBotCheck(provider.start, body, TOKEN, noLookup);
  assert.deepEqual(again, { ok: true, value: { type: "magic_link", success: true } });
  assert.deepEqual(provider.seen[1], { ...body, turnstileToken: TOKEN });
});

test("sixty people at once: the starts while more than fifty are open are asked for the check, and every one of them gets in on the retry", async () => {
  const provider = busyProvider({ limit: 50 });
  const firsts = await Promise.all(Array.from({ length: 60 }, () => startThroughBotCheck(provider.start, { provider: "siws" }, null, noLookup)));
  const asked = firsts.filter((r) => !r.ok);
  assert.ok(asked.length >= 10, `at least the ten past the limit are asked (${asked.length})`);
  assert.ok(asked.every((r) => r.code === "CHALLENGE_REQUIRED" && r.siteKey === SITE_KEY));
  assert.ok(firsts.filter((r) => r.ok).every((r) => r.value.type === "nonce"));
  const retries = await Promise.all(asked.map(() => startThroughBotCheck(provider.start, { provider: "siws" }, TOKEN, noLookup)));
  assert.ok(retries.every((r) => r.ok && r.value.type === "nonce"), "every retry with a token gets its nonce");
});

test("a token the provider refuses ends the attempt with CHALLENGE_FAILED — never a new check for the same start", async () => {
  const provider = busyProvider({ limit: 0, refuseTokens: true });
  const first = await startThroughBotCheck(provider.start, { provider: "siws" }, null, noLookup);
  assert.equal(first.code, "CHALLENGE_REQUIRED");
  const again = await startThroughBotCheck(provider.start, { provider: "siws" }, TOKEN, noLookup);
  assert.equal(again.ok, false);
  assert.equal(again.code, "CHALLENGE_FAILED");
  assert.equal(again.siteKey, undefined, "no site key: the browser draws no new box");
  assert.equal(PREDICTION_FAILURE_STATUS.CHALLENGE_FAILED, 403);
  const thrown = busyProvider({ limit: 0, refuseTokens: true, asError: true });
  assert.equal((await startThroughBotCheck(thrown.start, { provider: "siws" }, TOKEN, noLookup)).code, "CHALLENGE_FAILED");
});

test("the SDK's own TurnstileChallengeError is read as the challenge, with its site key", async () => {
  const start = async () => {
    throw Object.assign(new Error("challenge"), { name: "TurnstileChallengeError", siteKey: SITE_KEY });
  };
  const answer = await startThroughBotCheck(start, { provider: "email", email: "person@example.com" }, null, noLookup);
  assert.equal(answer.code, "CHALLENGE_REQUIRED");
  assert.equal(answer.siteKey, SITE_KEY);
});

test("a challenge the provider throws instead of answering is the same CHALLENGE_REQUIRED; any other error is the caller's", async () => {
  const provider = busyProvider({ limit: 0, asError: true });
  const answer = await startThroughBotCheck(provider.start, { provider: "siws" }, null, async () => SITE_KEY);
  assert.equal(answer.code, "CHALLENGE_REQUIRED");
  assert.equal(answer.siteKey, SITE_KEY);
  await assert.rejects(
    startThroughBotCheck(async () => Promise.reject(Object.assign(new Error("down"), { status: 502 })), { provider: "siws" }, null, noLookup),
    /down/,
  );
});

test("no site key in the challenge: it is read from GET /bot-protection/site-key, kept ten minutes; none at all is an honest outage", async () => {
  resetBotSiteKey();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, appId: init.headers["x-app-id"] });
    return new Response(JSON.stringify({ siteKey: SITE_KEY }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const env = { baseUrl: "https://api.example", appId: "app-1" };
  const provider = busyProvider({ limit: 0, siteKey: null });
  const answer = await startThroughBotCheck(provider.start, { provider: "siws" }, null, () => readBotSiteKey(env, fetchImpl, 1_000));
  assert.equal(answer.code, "CHALLENGE_REQUIRED");
  assert.equal(answer.siteKey, SITE_KEY);
  assert.deepEqual(calls, [{ url: "https://api.example/bot-protection/site-key", appId: "app-1" }]);
  assert.equal(await readBotSiteKey(env, fetchImpl, 1_000 + 9 * 60_000), SITE_KEY);
  assert.equal(calls.length, 1, "kept, not read again");

  resetBotSiteKey();
  let misses = 0;
  const failing = async () => {
    misses += 1;
    return new Response("no", { status: 503 });
  };
  const down = await challengeFailure(null, () => readBotSiteKey(env, failing, 5_000));
  assert.equal(down.code, "PROVIDER_UNAVAILABLE");
  await Promise.all([readBotSiteKey(env, failing, 6_000), readBotSiteKey(env, failing, 7_000)]);
  assert.equal(misses, 1, "a miss is kept thirty seconds: a burst does not ask again");
  resetBotSiteKey();
  let reads = 0;
  const slow = async () => {
    reads += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({ siteKey: SITE_KEY }), { status: 200 });
  };
  const keys = await Promise.all(Array.from({ length: 20 }, () => readBotSiteKey(env, slow, 50_000)));
  assert.ok(keys.every((k) => k === SITE_KEY));
  assert.equal(reads, 1, "twenty starts at once share one read");
  const thrown = await challengeFailure(null, () => {
    throw new Error("not configured");
  });
  assert.equal(thrown.code, "PROVIDER_UNAVAILABLE");
});

test("only a token-shaped token travels; the site key travels in the error body only on CHALLENGE_REQUIRED", () => {
  assert.equal(isTurnstileToken(TOKEN), true);
  assert.equal(isTurnstileToken(""), false);
  assert.equal(isTurnstileToken("a b"), false);
  assert.equal(isTurnstileToken("x".repeat(2049)), false);
  assert.deepEqual(withTurnstile({ provider: "siws" }, "bad token"), { provider: "siws" });
  assert.equal(challengeOf({ type: "challenge_required", siteKey: "<script>" }).siteKey, null, "a key not shaped like one is not shown");
  assert.deepEqual(failureBody({ ok: false, code: "CHALLENGE_REQUIRED", message: "check", siteKey: SITE_KEY }), { error: { code: "CHALLENGE_REQUIRED", message: "check", siteKey: SITE_KEY } });
  assert.deepEqual(failureBody({ ok: false, code: "FORBIDDEN", message: "no", siteKey: SITE_KEY }), { error: { code: "FORBIDDEN", message: "no" } });
});

test("the link's start passes the browser's token to the provider and nothing else changes", async () => {
  const store = { ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" };
  const seen = [];
  const provider = {
    signInChallenge: async (input) => {
      seen.push(input.turnstileToken ?? null);
      if (!input.turnstileToken) return { ok: false, code: "CHALLENGE_REQUIRED", message: "check", siteKey: SITE_KEY };
      return { ok: true, value: { nonce: "N", statement: null, message: `${input.domain} wants you to sign in with your Solana account:\n${input.address}\n\nNonce: N` } };
    },
  };
  const site = { domain: "predict.ryntra.io", uri: "https://predict.ryntra.io", locale: "uk" };
  const first = await startLink(store, provider, WALLET, site);
  assert.equal(first.code, "CHALLENGE_REQUIRED");
  assert.equal(first.siteKey, SITE_KEY);
  const again = await startLink(store, provider, WALLET, { ...site, turnstileToken: TOKEN });
  assert.equal(again.ok, true);
  assert.equal(again.value.wallet, WALLET);
  assert.deepEqual(seen, [null, TOKEN]);
});

test("through the real SDK against a provider that is busy: CHALLENGE_REQUIRED, then the signed-in message with the token (Solana; EVM refused)", async (t) => {
  const bodies = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      if (request.method === "POST" && request.url === "/auth/start") {
        const body = JSON.parse(raw || "{}");
        bodies.push({ body, appId: request.headers["x-app-id"] });
        response.end(JSON.stringify(body.turnstileToken === TOKEN ? { type: "nonce", nonce: `nonce${bodies.length}`, statement: "Sign in to Ryntra." } : { type: "challenge_required", siteKey: SITE_KEY }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not here" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const saved = { id: process.env.AGG_APP_ID, base: process.env.AGG_API_BASE_URL };
  process.env.AGG_APP_ID = "app-under-test";
  process.env.AGG_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    process.env.AGG_APP_ID = saved.id ?? "";
    process.env.AGG_API_BASE_URL = saved.base ?? "";
    resetAggAdapterCache();
  });
  const provider = getPredictionProvider();
  const site = { domain: "predict.ryntra.io", uri: "https://predict.ryntra.io" };

  const asked = await provider.signInChallenge({ chain: "solana", address: WALLET, ...site });
  assert.equal(asked.code, "CHALLENGE_REQUIRED");
  assert.equal(asked.siteKey, SITE_KEY);
  const solana = await provider.signInChallenge({ chain: "solana", address: WALLET, ...site, turnstileToken: TOKEN });
  assert.equal(solana.ok, true);
  assert.match(solana.value.message, /^predict\.ryntra\.io wants you to sign in with your Solana account:\n/);
  assert.equal(solana.value.statement, "Sign in to Ryntra.");

  /* An EVM wallet opens nothing here: refused before the provider is asked. */
  const evm = await provider.signInChallenge({ chain: "evm", address: EVM_WALLET, ...site, turnstileToken: TOKEN });
  assert.equal(evm.ok, false);

  assert.deepEqual(
    bodies.map((b) => [b.body.provider, b.body.turnstileToken ?? null, b.appId]),
    [
      ["siws", null, "app-under-test"],
      ["siws", TOKEN, "app-under-test"],
    ],
  );
});
