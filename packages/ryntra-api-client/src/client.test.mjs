// Run from repo root: node --test packages/ryntra-api-client/src/client.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { needsDevelopmentRepository } from "../../../lib/development-repository.mjs";
import { API_CONTRACT_VERSION, API_HEADER, RyntraApiError, createRyntraApiClient } from "./index.ts";

function fakeFetch(handlers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const handler = handlers[`${init.method} ${path}`];
    if (!handler) return { status: 404, headers: { get: () => null }, text: async () => "not found" };
    const { status = 200, body } = handler(init);
    return { status, headers: { get: (name) => (name === "X-Ryntra-API-Version" ? API_CONTRACT_VERSION : null) }, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

const ADDRESS = "36C2y1TLdGEBjwEKaCF2MBeR9Xw9oanY6So3UyiE1SPm";

test("every request names the contract major; authenticated calls carry the bearer and nothing else identifies the wallet", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /api/v1/capabilities": () => ({ body: { api: { major: 1 } } }),
    "GET /api/v1/watchlist": () => ({ body: { address: ADDRESS, mints: [], version: 0, updatedAt: null } }),
  });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io/", fetch, token: () => "sess.token" });
  await api.capabilities();
  await api.watchlist.get();
  assert.equal(calls[0].url, "https://ryntra.io/api/v1/capabilities", "no double slash from a trailing base");
  assert.equal(calls[0].init.headers[API_HEADER], "1");
  assert.equal(calls[0].init.headers.authorization, undefined, "a public read carries no bearer");
  assert.equal(calls[1].init.headers.authorization, "Bearer sess.token");
  assert.equal(calls[1].init.headers.cookie, undefined);
});

test("a signed-out client refuses an authenticated call before the network, with the code the app switches on", async () => {
  const { fetch, calls } = fakeFetch({});
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => null });
  await assert.rejects(api.auth.session(), (error) => error instanceof RyntraApiError && error.code === "UNAUTHORIZED" && error.needsSignIn);
  assert.equal(calls.length, 0);
});

test("a refusal in the contract's shape becomes a RyntraApiError with its code, status, minimum version and contract version", async () => {
  const { fetch } = fakeFetch({
    "POST /api/v1/auth/challenge": () => ({ status: 426, body: { error: { code: "UNSUPPORTED_CLIENT", message: "App 0.9.0 is below the minimum 1.0.0.", minimumAppVersion: "1.0.0" } } }),
    "GET /api/v1/auth/session": () => ({ status: 401, body: { error: { code: "SESSION_EXPIRED", message: "The session is expired." } } }),
  });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  await assert.rejects(api.auth.challenge({ address: ADDRESS, client: { platform: "android", appVersion: "0.9.0" } }), (error) => {
    assert.ok(error instanceof RyntraApiError);
    assert.equal(error.code, "UNSUPPORTED_CLIENT");
    assert.equal(error.status, 426);
    assert.equal(error.minimumAppVersion, "1.0.0");
    assert.equal(error.contractVersion, API_CONTRACT_VERSION);
    assert.equal(error.needsSignIn, false);
    return true;
  });
  await assert.rejects(api.auth.session(), (error) => error.code === "SESSION_EXPIRED" && error.needsSignIn === true);
});

test("an answer that is not JSON, or a failure without the contract's shape, is MALFORMED; a network failure is NETWORK", async () => {
  const api = createRyntraApiClient({
    baseUrl: "https://ryntra.io",
    fetch: async () => ({ status: 502, headers: { get: () => null }, text: async () => "<html>bad gateway</html>" }),
  });
  await assert.rejects(api.capabilities(), (error) => error.code === "MALFORMED" && error.status === 502);
  const offline = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch: async () => { throw new Error("offline"); } });
  await assert.rejects(offline.capabilities(), (error) => error.code === "NETWORK" && error.status === 0 && error.message === "offline");
});

test("the sign-in and the merge send exactly the contract's bodies and read the contract's answers", async () => {
  const { fetch, calls } = fakeFetch({
    "POST /api/v1/auth/verify": (init) => ({ body: { tokenType: "Bearer", accessToken: "sess.new", session: { id: "s1", address: JSON.parse(init.body).address, network: "solana:mainnet", issuedAt: "2026-09-15T12:00:00.000Z", expiresAt: "2026-09-16T12:00:00.000Z" } } }),
    "POST /api/v1/watchlist/merge": (init) => ({ body: { address: ADDRESS, mints: JSON.parse(init.body).mints, notKept: [], droppedByServer: [], version: 1, syncedAt: "2026-09-15T12:00:00.000Z" } }),
    "DELETE /api/v1/auth/session": () => ({ body: { revoked: true } }),
  });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.new" });
  const verified = await api.auth.verify({ address: ADDRESS, signedMessage: "bWVzc2FnZQ==", signature: "c2ln", client: { platform: "android", appVersion: "1.0.0" } });
  assert.equal(verified.session.address, ADDRESS);
  assert.equal(JSON.parse(calls[0].init.body).client.platform, "android");
  const merged = await api.watchlist.merge({ address: ADDRESS, mints: ["So11111111111111111111111111111111111111112"], syncedAt: null });
  assert.deepEqual(merged.mints, ["So11111111111111111111111111111111111111112"]);
  assert.deepEqual(await api.auth.revoke(), { revoked: true });
  assert.equal(calls[2].init.method, "DELETE");
});

test("1.11.0: the consumed reads go to their own paths with their own queries, carry no bearer when public, and refuse as RyntraRouteError with the route's code", async () => {
  const { RyntraRouteError } = await import("./index.ts");
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });
    const { pathname } = new URL(url);
    if (pathname === "/api/stocks/asset") return { status: 404, headers: { get: () => null }, text: async () => JSON.stringify({ error: { code: "UNKNOWN_ASSET", message: "That token is not a confirmed stock representation." } }) };
    if (pathname === "/api/spot/candles") return { status: 404, headers: { get: () => null }, text: async () => JSON.stringify({ error: { code: "CANDLES_NO_POOL", message: "No pool." } }) };
    if (pathname === "/api/rewards") return { status: 401, headers: { get: () => null }, text: async () => JSON.stringify({ error: "proof required", proof: false }) };
    if (pathname === "/api/spot/market") return { status: 502, headers: { get: () => null }, text: async () => "<html>bad gateway</html>" };
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ rows: [], observedAt: "2026-09-22T20:00:00.000Z", stale: false }) };
  };
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  await api.markets.list("meme", 100);
  await api.markets.search("bonk");
  await api.markets.byMints(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]);
  await api.stocks.slim({ q: "nvidia", limit: 5 });
  await api.stocks.quote("SPYx", 100, "SELL");
  await api.holdings({ owner: ADDRESS });
  assert.deepEqual(seen.map((call) => `${call.init.method} ${call.url.replace("https://ryntra.io", "")}`), [
    "GET /api/spot/markets?view=meme&limit=100",
    "GET /api/spot/markets?q=bonk",
    "GET /api/spot/markets?mints=So11111111111111111111111111111111111111112%2CEPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "GET /api/stocks/universe?shape=slim&q=nvidia&limit=5",
    "GET /api/stocks/quote?ticker=SPYx&side=SELL&usd=100",
    "POST /api/solana/holdings",
  ]);
  assert.ok(seen.every((call) => call.init.headers.authorization === undefined), "a public read carries no bearer, even when the app holds one");
  assert.equal(seen.at(-1).init.body, JSON.stringify({ owner: ADDRESS }));
  await assert.rejects(api.stocks.asset("NOPEx"), (error) => error instanceof RyntraRouteError && error.code === "UNKNOWN_ASSET" && error.status === 404);
  await assert.rejects(api.markets.candles("So11111111111111111111111111111111111111112", "5m", 120), (error) => error instanceof RyntraRouteError && error.code === "CANDLES_NO_POOL");
  assert.equal(seen.at(-1).url, "https://ryntra.io/api/spot/candles?mint=So11111111111111111111111111111111111111112&tf=5m&limit=120");
  await assert.rejects(api.markets.get("So11111111111111111111111111111111111111112"), (error) => error instanceof RyntraRouteError && error.code === "MALFORMED" && error.status === 502);
  const failing = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch: async () => { throw new Error("offline"); } });
  await assert.rejects(failing.stocks.universe(), (error) => error instanceof RyntraRouteError && error.code === "NETWORK");
});

test("1.11.0: the Telegram channel is a v1 path over the bearer — read, connect with a language, disconnect", async () => {
  const { fetch, calls } = fakeFetch({
    "GET /api/v1/notifications/telegram": () => ({ body: { telegram: { connected: false, username: null, connectedAt: null } } }),
    "POST /api/v1/notifications/telegram": () => ({ body: { link: "https://t.me/RyntraBeta_bot?start=ntf_x", expiresAt: "2026-09-22T20:15:00.000Z" } }),
    "DELETE /api/v1/notifications/telegram": () => ({ body: { telegram: { connected: false, username: null, connectedAt: null } } }),
  });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  assert.equal((await api.notifications.telegram()).telegram.connected, false);
  assert.match((await api.notifications.connectTelegram({ locale: "uk" })).link, /^https:\/\/t\.me\//);
  await api.notifications.disconnectTelegram();
  assert.deepEqual(calls.map((call) => call.init.method), ["GET", "POST", "DELETE"]);
  assert.ok(calls.every((call) => call.init.headers.authorization === "Bearer sess.token" && call.init.headers[API_HEADER] === "1"));
  assert.equal(calls[1].init.body, JSON.stringify({ locale: "uk" }));
  const signedOut = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => null });
  await assert.rejects(signedOut.notifications.connectTelegram(), (error) => error instanceof RyntraApiError && error.needsSignIn);
});

test("1.11.0: the statement, the archive, the rewards, the monitoring and the swap go to their own routes, with the bearer where the route needs it", async () => {
  const { RyntraRouteError } = await import("./index.ts");
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });
    const { pathname } = new URL(url);
    if (pathname === "/api/solana/swap/order") {
      return { status: 409, headers: { get: () => null }, text: async () => JSON.stringify({ error: { code: "PLAN_REVIEW_BLOCKED", message: "The plan's version refuses this order.", planReview: { verdict: "blocked" } } }) };
    }
    if (pathname === "/api/rewards") return { status: 401, headers: { get: () => null }, text: async () => JSON.stringify({ error: "proof required", proof: false }) };
    if (pathname === "/api/solana/swap/recover") return { status: 202, headers: { get: () => null }, text: async () => JSON.stringify({ state: "PENDING", signature: "s", reason: "not yet" }) };
    return { status: 200, headers: { get: (name) => (name === "X-Ryntra-API-Version" ? API_CONTRACT_VERSION : null) }, text: async () => JSON.stringify({ ok: true }) };
  };
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  await api.activity({ owner: ADDRESS });
  await api.receipts.archive(ADDRESS);
  await api.monitoring.surface("uk");
  await api.monitoring.write({ read: "inb_0123456789abcdef01234567" });
  await api.swap.quote({ inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000" });
  assert.equal((await api.swap.recover({ owner: ADDRESS, signature: "s" })).state, "PENDING", "an open state is an answer, not a refusal");
  const byPath = Object.fromEntries(seen.map((call) => [`${call.init.method} ${new URL(call.url).pathname}`, call.init.headers]));
  assert.equal(byPath["POST /api/solana/activity"].authorization, "Bearer sess.token", "the owner's own rows come with the bearer when the app holds one");
  assert.equal(byPath["GET /api/solana/receipts/archive"].authorization, "Bearer sess.token");
  assert.equal(byPath["GET /api/monitoring"]["accept-language"], "uk");
  assert.equal(byPath["POST /api/solana/swap/quote"].authorization, undefined, "a quote is public");
  assert.equal(byPath["POST /api/solana/swap/recover"].authorization, "Bearer sess.token");
  await assert.rejects(
    api.swap.order({ input: { inputMint: "So11111111111111111111111111111111111111112", outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "1000000", taker: ADDRESS } }),
    (error) => error instanceof RyntraRouteError && error.code === "PLAN_REVIEW_BLOCKED" && error.status === 409 && error.details?.planReview?.verdict === "blocked",
    "the refusal keeps what the route sent beside its code",
  );
  await assert.rejects(api.rewards.get(ADDRESS), (error) => error instanceof RyntraRouteError && error.code === "HTTP_401" && error.message === "proof required" && error.details?.proof === false);
  const signedOut = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => null });
  await assert.rejects(signedOut.swap.execute({}), (error) => error instanceof RyntraRouteError && error.code === "UNAUTHORIZED", "a trade never leaves without the bearer");
  const before = seen.length;
  await signedOut.activity({ owner: ADDRESS });
  assert.equal(seen[before].init.headers.authorization, undefined, "a signed-out statement is the public one");
});

test("1.11.0: the prediction reads are public and the account, the link, the plans and the orders carry the bearer", async () => {
  const { RyntraRouteError } = await import("./index.ts");
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, init });
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true }) };
  };
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  await api.predictions.discover({ sort: "ending", limit: 10 });
  await api.predictions.events(["ev1", "ev2"]);
  await api.predictions.chart("o-yes", "1d", 30);
  await api.predictions.plans.update("pplan_000000000000000000000001", { version: 2, rules: {} });
  await api.predictions.link.start();
  const calls = seen.map((call) => `${call.init.method} ${call.url.replace("https://ryntra.io", "")} ${call.init.headers.authorization ? "bearer" : "public"}`);
  assert.deepEqual(calls, [
    "GET /api/predictions/discover?sort=ending&limit=10 bearer",
    "GET /api/predictions/events?ids=ev1%2Cev2 public",
    "GET /api/predictions/outcomes/o-yes/chart?resolution=1d&countBack=30 public",
    "PATCH /api/predictions/plans/pplan_000000000000000000000001 bearer",
    "POST /api/predictions/link/start bearer",
  ]);
  const signedOut = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => null });
  await assert.rejects(signedOut.predictions.account(), (error) => error instanceof RyntraRouteError && error.code === "UNAUTHORIZED");
  const before = seen.length;
  await signedOut.predictions.discover();
  assert.equal(seen[before].init.headers.authorization, undefined, "a signed-out discover is the public one");
});

test("1.20.0: «Популярне» is a public v1 path with its limit and the company to leave out; the swap's quote carries «Перевірка» as it is served", async () => {
  const check = { side: "buy", basis: "quote", spend: { unit: "usdc", amount: 10 }, get: { unit: "share", amount: 0.0431, atLeast: 0.0427 }, costs: { usd: 0.05, issuerFee: null }, reserve: null };
  const { fetch, calls } = fakeFetch({
    "GET /api/v1/stocks/popular": () => ({ body: { companies: [{ name: "NVIDIA", ticker: "NVDAx", mint: ADDRESS, icon: null, price: 181.7, change24h: 0.42, volume24h: 7_700_000, issuer: "xstocks" }], order: "volume-24h", fetchedAt: "2026-09-27T12:00:00.000Z" } }),
    "POST /api/solana/swap/quote": () => ({ body: { check } }),
  });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  const popular = await api.stocks.popular({ limit: 6, exclude: ADDRESS });
  assert.equal(calls[0].url, `https://ryntra.io/api/v1/stocks/popular?limit=6&exclude=${ADDRESS}`);
  assert.equal(calls[0].init.headers[API_HEADER], "1");
  assert.equal(calls[0].init.headers.authorization, undefined, "public: no bearer");
  assert.equal(popular.companies[0].name, "NVIDIA");
  await api.stocks.popular();
  assert.equal(calls[1].url, "https://ryntra.io/api/v1/stocks/popular", "no query when nothing is asked");
  const quote = await api.swap.quote({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: ADDRESS, amountRaw: "10000000" });
  assert.deepEqual(quote.check, check, "the client counts nothing: the server's lines arrive as they are");
});

test("1.21.0: Нагляд over positions and «Ryntra попередить» are v1 paths behind the bearer; the states arrive as the server judged them", async () => {
  const position = { mint: ADDRESS, symbol: "AAPLx", name: "Apple", icon: null, unitBasis: "share", amountRaw: "5100000", valueUsd: 12.06, price: 236.4, observedAt: "2026-09-28T11:59:12.000Z", deviationPct: 0.12, exit: null, state: "exit-not-set", reason: "no-exit", action: "warn", toLimitPct: null };
  const watch = { mint: ADDRESS, symbol: "AAPLx", preset: "careful", stopPct: 5, targetPct: 10, basisPerUnit: 236.4, basisObservedAt: "2026-09-28T11:59:12.000Z", limitPerUnit: 224.58, targetPerUnit: 260.04, createdAt: "2026-09-28T12:00:00.000Z", updatedAt: "2026-09-28T12:00:00.000Z" };
  const { fetch, calls } = fakeFetch({
    "GET /api/v1/positions": () => ({ body: { address: ADDRESS, positions: [position], channel: { telegram: true }, read: { holdings: "complete", market: "ok", at: "2026-09-28T12:00:00.000Z" } } }),
    "PUT /api/v1/positions/watch": () => ({ body: { watch, position: { ...position, exit: { source: "watch", limit: 224.58, target: 260.04, preset: "careful", planId: null }, state: "on-plan", reason: "between", action: null, toLimitPct: 5 } } }),
  });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  const read = await api.positions.list();
  assert.equal(calls[0].url, "https://ryntra.io/api/v1/positions");
  assert.equal(calls[0].init.headers.authorization, "Bearer sess.token");
  assert.equal(read.positions[0].state, "exit-not-set");
  assert.equal(read.positions[0].action, "warn");
  const turned = await api.positions.watch({ mint: ADDRESS, preset: "careful", locale: "uk" });
  assert.equal(calls[1].init.method, "PUT");
  assert.deepEqual(JSON.parse(calls[1].init.body), { mint: ADDRESS, preset: "careful", locale: "uk" });
  assert.equal(turned.watch.limitPerUnit, 224.58, "the figures are the server's; the client counts none");
  assert.equal(turned.position.state, "on-plan");
});

test("1.23.0: «Ризик портфеля» is a v1 path behind the bearer; the verdict and its reasons arrive as the server judged them", async () => {
  const risk = {
    state: "attention",
    findings: [{ reason: "action", kind: "company", mint: ADDRESS, symbol: "TSLAx", name: "Tesla", sharePct: null, capPct: null, watchReason: "limit" }],
    gaps: [],
    totalUsd: 72.91,
    capsApplied: false,
  };
  const { fetch, calls } = fakeFetch({ "GET /api/v1/positions/risk": () => ({ body: { address: ADDRESS, risk, at: "2026-09-28T12:00:00.000Z" } }) });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  const read = await api.positions.risk();
  assert.equal(calls[0].url, "https://ryntra.io/api/v1/positions/risk");
  assert.equal(calls[0].init.headers.authorization, "Bearer sess.token");
  assert.equal(read.risk.state, "attention");
  assert.equal(read.risk.findings[0].watchReason, "limit", "the reason is the server's; the client judges none");
});

test("1.22.0: the package, its constant and the contract name one version", async () => {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const { API_CONTRACT_VERSION: contract } = await import("../../../lib/api/v1/contract.ts");
  assert.equal(API_CONTRACT_VERSION, contract, "the constant is the contract it implements");
  assert.equal(pkg.version, contract, "the package's version is the contract's");
  assert.equal(pkg.ryntra.contractVersion, contract);
});

test("1.22.0: payment links behind the bearer, one link for anyone; the recipient check and the returned bytes need no session; a link is paid on its page's routes as the session's wallet", async () => {
  const link = { id: "7mKq3x9ZpQv2Lr5t", url: "https://ryntra.io/pay/7mKq3x9ZpQv2Lr5t", payUrl: `solana:${ADDRESS}?reference=${ADDRESS}`, status: "AWAITING", note: null, token: { symbol: "SOL", mint: null, decimals: 9 }, amount: null, description: null, recipient: { abbreviated: "36C2…1SPm", address: ADDRESS }, reference: ADDRESS, createdAt: "2026-09-29T09:00:00.000Z", expiresAt: "2026-09-30T09:00:00.000Z", paid: null };
  const { fetch, calls } = fakeFetch({
    "POST /api/v1/pay/requests": () => ({ status: 201, body: { link } }),
    "GET /api/v1/pay/requests": () => ({ body: { address: ADDRESS, links: [link] } }),
    "GET /api/v1/pay/requests/7mKq3x9ZpQv2Lr5t": () => ({ body: { link } }),
    "GET /api/v1/money/recipient": () => ({ body: { input: "pay-link", next: "pay-link", problem: null, address: ADDRESS, asset: { mint: null }, destination: null, asked: null, link, checkedAt: "2026-09-29T09:00:00.000Z" } }),
    "POST /api/v1/money/send/returned": () => ({ body: { verdict: "BYTES_FEE_ADDED", next: "adopt", signature: null, detail: "fee" } }),
    "POST /api/pay/7mKq3x9ZpQv2Lr5t/transaction": () => ({ status: 403, body: { error: { code: "WALLET_MISMATCH", message: "The session's wallet is not the payer." } } }),
  });
  let token = "sess.token";
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => token });
  const created = await api.pay.create({ mint: null, amount: null, expiration: "24h" });
  assert.equal(created.link.payUrl.startsWith("solana:"), true);
  assert.equal(calls[0].init.headers.authorization, "Bearer sess.token");
  assert.deepEqual(JSON.parse(calls[0].init.body), { mint: null, amount: null, expiration: "24h" });
  assert.equal((await api.pay.list()).links.length, 1);

  token = null;
  await api.pay.get("7mKq3x9ZpQv2Lr5t");
  assert.equal(calls[2].init.headers.authorization, undefined, "one link reads without a session");
  const check = await api.money.recipient({ to: `solana:${ADDRESS}?amount=1&reference=${ADDRESS}`, from: ADDRESS });
  assert.equal(new URL(calls[3].url).searchParams.get("to"), `solana:${ADDRESS}?amount=1&reference=${ADDRESS}`, "the scanned request travels intact");
  assert.equal(new URL(calls[3].url).searchParams.get("mint"), null);
  assert.equal(check.next, "pay-link");
  const returned = await api.money.returned({ plan: { actionKind: "NATIVE_SOL", unsignedWireBase64: "A".repeat(64), fingerprint: { messageHash: `0x${"0".repeat(64)}`, feePayer: ADDRESS } }, signedWireBase64: "B".repeat(64) });
  assert.equal(returned.next, "adopt", "the next step is the server's");
  await assert.rejects(api.pay.create({}), (error) => error instanceof RyntraApiError && error.code === "UNAUTHORIZED", "making a link needs the bearer");

  token = "sess.token";
  await assert.rejects(api.pay.transaction("7mKq3x9ZpQv2Lr5t", { payer: ADDRESS }), (error) => error.code === "WALLET_MISMATCH" && error.status === 403);
  assert.equal(calls.at(-1).init.headers.authorization, "Bearer sess.token", "the bearer stands in for the page's origin");
});


test("1.36.0: the markets launched on Ryntra, one market's card, its health and its flight log — public reads, no bearer", { skip: needsDevelopmentRepository("the API's examples under docs/api/examples") }, async () => {
  const { readFileSync } = await import("node:fs");
  const example = (name) => JSON.parse(readFileSync(new URL(`../../../docs/api/examples/v1/${name}`, import.meta.url), "utf8"));
  const markets = example("launch-markets.response.json");
  const card = example("launch-market.response.json");
  const health = example("launch-health.response.json");
  const mint = health.token;
  const { fetch, calls } = fakeFetch({
    "GET /api/v1/launch/markets": () => ({ body: markets }),
    [`GET /api/v1/launch/markets/${mint}`]: () => ({ body: card }),
    [`GET /api/v1/launch/${mint}/health`]: () => ({ body: health }),
    [`GET /api/v1/launch/${mint}/journal`]: () => ({ status: 404, body: { error: { code: "LAUNCH_NOT_FOUND", message: "No Ryntra launch of this token here." } } }),
  });
  const api = createRyntraApiClient({ baseUrl: "https://ryntra.io", fetch, token: () => "sess.token" });
  assert.equal((await api.launch.markets()).markets.length, markets.markets.length);
  assert.equal((await api.launch.market(mint)).market.token, mint);
  const read = await api.launch.health(mint);
  assert.equal(read.state.code, health.state.code, "the state is the server's; the client derives none");
  await assert.rejects(api.launch.journal(mint), (error) => error instanceof RyntraApiError && error.code === "LAUNCH_NOT_FOUND" && error.status === 404);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    ["/api/v1/launch/markets", `/api/v1/launch/markets/${mint}`, `/api/v1/launch/${mint}/health`, `/api/v1/launch/${mint}/journal`],
  );
  assert.ok(calls.every((call) => call.init.headers.authorization === undefined), "a public read carries no bearer");
});
