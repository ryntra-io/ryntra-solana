// Run from repo root: node --test city/lib/quarter/objects.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { ENGINE_KINDS, freshness, linkKey, linkKindOf, linkRefusalLine, listMine, onEngine, readObject } = await import("./objects.ts");
const { KINDS } = await import("../../../lib/world/catalog.ts");

/**
 * A building on the engine shows the object it is linked to as the engine reads it now: every figure from one read,
 * with its moment, a figure the engine did not give left out (never a zero), and a read that did not answer said as
 * such. The world never counts: nothing here adds, keeps or invents a number.
 */

const MINT = "So1aNaCoinMint1111111111111111111111111111";
const WALLET = "WaLLet1111111111111111111111111111111111111";
const POSITION = "Pos1tion111111111111111111111111111111111111";
const POOL = "Poo1111111111111111111111111111111111111111";
const NOW = Date.parse("2026-10-27T12:00:00.000Z");

/** An engine that answers from a table of url → [status, body]; anything else is a 404. */
function engine(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: { code: "NOT_FOUND" } }) };
    const [status, body] = typeof hit[1] === "function" ? hit[1](url) : hit[1];
    if (status === 0) throw new TypeError("network");
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

const ctx = (routes, more = {}) => {
  const e = engine(routes);
  return { ctx: { fetch: e.fetch, wallet: WALLET, accountId: null, now: () => NOW, ...more }, calls: e.calls };
};

const launchView = { token: MINT, name: "Orbit Cat", symbol: "OCAT", image: "https://ryntra.io/i.png", progressBps: 4250, migrated: false, observedAt: "2026-10-27T11:59:30.000Z" };
const launchStats = {
  token: MINT,
  pair: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9, dollar: false },
  holders: { count: 1204, atLeast: false },
  marketCap: { pair: 412.37, usd: 61234 },
  volume: { day: { raw: "12500000000", atLeast: true }, week: { raw: null, atLeast: false }, all: { raw: null, atLeast: false } },
  observedAt: "2026-10-27T11:58:00.000Z",
};

test("the engine buildings and the objects they show are the world's own rule", () => {
  assert.deepEqual([...ENGINE_KINDS], ["coin_tower", "harbor", "workshop", "crew_hq", "garage", "oracle"]);
  for (const kind of ENGINE_KINDS) assert.equal(linkKindOf(kind), KINDS[kind].links[0], kind);
  assert.equal(linkKindOf("home"), null);
  assert.equal(linkKindOf("decor"), null);
  assert.equal(linkKindOf("showcase"), null, "the showcase comes with its own step");
  assert.equal(onEngine("billboard"), false);
  assert.equal(linkKey({ kind: "prediction_book", accountId: "a" }), linkKey({ kind: "prediction_book", accountId: "b" }), "a book is read as one's own");
  assert.notEqual(linkKey({ kind: "mint", mint: MINT }), linkKey({ kind: "lp_position", position: MINT }));
});

test("a coin tower reads its coin from Ryntra Launch: holders, cap, volume and the curve, as old as its oldest read", async () => {
  const { ctx: c, calls } = ctx({ [`/api/v1/launch/${MINT}/stats`]: [200, launchStats], [`/api/v1/launch/${MINT}`]: [200, launchView] });
  const read = await readObject({ kind: "mint", mint: MINT }, c);
  assert.equal(read.state, "ok");
  assert.equal(read.view.title, "Orbit Cat");
  assert.equal(read.view.line, "$OCAT · Ryntra Launch");
  assert.deepEqual(read.view.figures, [
    { label: "Holders", value: "1,204" },
    { label: "Market cap", value: "$61K" },
    { label: "Volume · 24H", value: "≥ 12.5 SOL" },
    { label: "Curve", value: "42.5%" },
  ]);
  assert.equal(read.view.at, launchStats.observedAt, "the stats were read earlier, so the view is that old");
  assert.deepEqual(read.view.action, { kind: "trade", label: "Trade $OCAT", mint: MINT, symbol: "OCAT", name: "Orbit Cat", icon: "https://ryntra.io/i.png" });
  assert.equal(calls.length, 2);
});

test("a coin whose stats did not answer shows what was read and says what was not, never a zero", async () => {
  const { ctx: c } = ctx({ [`/api/v1/launch/${MINT}/stats`]: [503, { error: { code: "UNAVAILABLE" } }], [`/api/v1/launch/${MINT}`]: [200, { ...launchView, migrated: true }] });
  const read = await readObject({ kind: "mint", mint: MINT }, c);
  assert.equal(read.state, "ok");
  assert.deepEqual(read.view.figures, [{ label: "Curve", value: "On the DEX" }]);
  assert.match(read.view.source, /holders not read/);
  assert.equal(read.view.figures.some((f) => /^0|\$0/.test(f.value)), false);
});

test("a coin the engine does not know is gone; an engine that does not answer is unavailable", async () => {
  assert.deepEqual(await readObject({ kind: "mint", mint: MINT }, ctx({}).ctx), { state: "gone" });
  assert.deepEqual(await readObject({ kind: "mint", mint: MINT }, ctx({ "/api/v1/launch/": [0, null] }).ctx), { state: "unavailable" });
  assert.deepEqual(await readObject({ kind: "mint", mint: MINT }, ctx({ "/api/v1/launch/": [200, { nope: true }] }).ctx), { state: "unavailable" });
});

const positions = (rangeState, extra = {}) => ({
  owner: WALLET,
  positions: [{ kind: "meteora-dlmm", address: POSITION, pool: POOL, name: "SOL-USDC", rangeState, valueUsd: 1520.4, unclaimedUsd: 12.3, at: NOW - 20_000, pricesAt: "2026-10-27T11:59:00.000Z", ...extra }],
  venues: { "meteora-dlmm": { ok: true }, "meteora-damm2": { ok: true } },
  at: NOW - 20_000,
});

test("a harbor reads its position by its wallet: value, unclaimed fees and the range, red when the price left it", async () => {
  const inRange = await readObject({ kind: "lp_position", position: POSITION }, ctx({ "/api/liquidity/positions": [200, positions("in_range")] }).ctx);
  assert.equal(inRange.state, "ok");
  assert.deepEqual(inRange.view.figures, [
    { label: "Value", value: "$1.5K" },
    { label: "Unclaimed fees", value: "$12" },
    { label: "Price", value: "In range" },
  ]);
  assert.equal(inRange.view.signal, "value");
  assert.equal(inRange.view.line, "Meteora DLMM");
  assert.equal(inRange.view.at, new Date(NOW - 20_000).toISOString());
  assert.deepEqual(inRange.view.action, { kind: "route", label: "Open pool", href: `/app/markets/pools/${POOL}` });
  const out = await readObject({ kind: "lp_position", position: POSITION }, ctx({ "/api/liquidity/positions": [200, positions("below", { valueUsd: null })] }).ctx);
  assert.equal(out.view.signal, "danger");
  assert.deepEqual(out.view.figures.map((f) => f.label), ["Unclaimed fees", "Price"], "a value without a price is left out");
});

test("a harbor waits for a wallet; a position missing from a full read is gone, from a partial read unknown", async () => {
  assert.deepEqual(await readObject({ kind: "lp_position", position: POSITION }, ctx({}, { wallet: null }).ctx), { state: "wallet" });
  const empty = { ...positions("in_range"), positions: [] };
  assert.deepEqual(await readObject({ kind: "lp_position", position: POSITION }, ctx({ "/api/liquidity/positions": [200, empty] }).ctx), { state: "gone" });
  const partial = { ...empty, venues: { "meteora-dlmm": { ok: true }, "meteora-damm2": { ok: false } } };
  assert.deepEqual(await readObject({ kind: "lp_position", position: POSITION }, ctx({ "/api/liquidity/positions": [200, partial] }).ctx), { state: "unavailable" });
});

test("a workshop, a crew HQ and the oracle board read their objects, and ask for the wallet's proof when the engine does", async () => {
  const strategy = await readObject(
    { kind: "strategy", strategyId: "11111111-1111-4111-8111-111111111111" },
    ctx({ "/api/strategy-lab/strategies?id=": [200, { strategy: { strategyId: "x", title: "Mean reversion", createdAt: "2026-10-12T08:00:00.000Z", updatedAt: "2026-10-26T08:00:00.000Z" }, versions: [], runs: [{}, {}, {}], proposals: [] }] }).ctx,
  );
  assert.equal(strategy.view.title, "Mean reversion");
  assert.deepEqual(strategy.view.figures, [
    { label: "Paper runs", value: "3" },
    { label: "Since", value: "12 Oct 2026" },
    { label: "Last change", value: "26 Oct 2026" },
  ]);

  const team = await readObject(
    { kind: "team", teamId: "a".repeat(24) },
    ctx({ "/api/v1/teams/": [200, { team: { name: "Orbit crew", kind: "COMMUNITY", treasury: null, you: { role: "OWNER" }, members: [{ status: "ACTIVE" }, { status: "ACTIVE" }, { status: "INVITED" }] } }] }).ctx,
  );
  assert.equal(team.view.line, "Community team");
  assert.deepEqual(team.view.figures, [
    { label: "Members", value: "2" },
    { label: "Your role", value: "Owner" },
    { label: "Treasury", value: "Not linked yet" },
  ]);

  const book = await readObject(
    { kind: "prediction_book", accountId: "acc" },
    ctx({ "/api/predictions/account": [200, { link: { state: "active" }, balance: { cashBalance: 9200, realizedPnl: 140, unrealizedPnl: -40.5, earnings: 77 }, positions: [{}, {}], readAt: "2026-10-27T11:59:50.000Z" }] }).ctx,
  );
  assert.deepEqual(book.view.figures, [
    { label: "Paper cash", value: "$9.2K" },
    { label: "Open calls", value: "2" },
    { label: "Paper P&L", value: "+$77" },
  ], "the engine's own total, not the city's sum of its parts");
  assert.equal(book.view.signal, "value");
  const parts = await readObject(
    { kind: "prediction_book", accountId: "acc" },
    ctx({ "/api/predictions/account": [200, { link: { state: "active" }, balance: { cashBalance: 9200, realizedPnl: 140, unrealizedPnl: -40.5 }, positions: [] }] }).ctx,
  );
  assert.deepEqual(parts.view.figures, [
    { label: "Paper cash", value: "$9.2K" },
    { label: "Open calls", value: "0" },
    { label: "Realized", value: "+$140" },
    { label: "Unrealized", value: "−$41" },
  ], "no total from the engine: its two figures side by side, never added");
  assert.equal(parts.view.signal, null);
  assert.deepEqual(await readObject({ kind: "prediction_book", accountId: "acc" }, ctx({ "/api/predictions/account": [200, { link: { state: "none" }, balance: null }] }).ctx), { state: "gone" }, "no paper account opened yet");

  for (const status of [401, 403]) {
    assert.deepEqual(await readObject({ kind: "team", teamId: "a".repeat(24) }, ctx({ "/api/v1/teams/": [status, {}] }).ctx), { state: "proof" });
    assert.deepEqual(await readObject({ kind: "strategy", strategyId: "s" }, ctx({ "/api/strategy-lab/strategies": [status, {}] }).ctx), { state: "proof" });
  }
  assert.deepEqual(await readObject({ kind: "agent", agentId: "x" }, ctx({}).ctx), { state: "unavailable" }, "nothing the world could vouch for");
});

test("the link picker lists only the person's own objects, as the world would accept them", async () => {
  const coins = await listMine(
    "coin_tower",
    ctx({ [`/api/v1/launch/creators/${WALLET}`]: [200, { launches: [{ token: MINT, name: "Orbit Cat", symbol: "OCAT", role: "creator" }, { token: POOL, name: "Shared", symbol: "SHR", role: "recipient" }] }] }).ctx,
  );
  assert.deepEqual(coins, { state: "ok", items: [{ link: { kind: "mint", mint: MINT }, title: "Orbit Cat", line: "$OCAT · Ryntra Launch" }] }, "a coin whose fees it only shares is not its coin");

  const teams = await listMine("crew_hq", ctx({ "/api/v1/teams": [200, { teams: [{ id: "a".repeat(24), name: "Orbit crew", kind: "COMMUNITY", status: "ACTIVE" }, { id: "b".repeat(24), name: "Invite", status: "INVITED" }] }] }).ctx);
  assert.deepEqual(teams.items.map((t) => t.link), [{ kind: "team", teamId: "a".repeat(24) }], "an invitation is not membership");

  const harbors = await listMine("harbor", ctx({ "/api/liquidity/positions": [200, positions("in_range")] }).ctx);
  assert.deepEqual(harbors.items, [{ link: { kind: "lp_position", position: POSITION }, title: "SOL-USDC", line: "Meteora DLMM" }]);

  assert.deepEqual(await listMine("coin_tower", ctx({}, { wallet: null }).ctx), { state: "wallet" });
  assert.deepEqual(await listMine("crew_hq", ctx({ "/api/v1/teams": [401, {}] }).ctx), { state: "proof" });
  assert.deepEqual(await listMine("oracle", ctx({}).ctx), { state: "proof" }, "the paper book is an account's");
  assert.deepEqual(await listMine("oracle", ctx({}, { accountId: "acc" }).ctx), { state: "ok", items: [{ link: { kind: "prediction_book", accountId: "acc" }, title: "Your paper predictions", line: "Predictions · paper" }] });
  assert.deepEqual(await listMine("garage", ctx({}).ctx), { state: "not_yet" }, "the engine keeps no owner for an agent yet");
  assert.deepEqual(await listMine("home", ctx({}).ctx), { state: "not_yet" });
  assert.deepEqual(await listMine("coin_tower", ctx({ "/api/v1/launch/creators/": [503, {}] }).ctx), { state: "unavailable" });
});

test("every figure carries its age; past five minutes it is delayed", () => {
  const at = (s) => new Date(NOW - s * 1000).toISOString();
  assert.deepEqual(freshness(at(3), NOW), { text: "just now", short: "now", stale: false });
  assert.deepEqual(freshness(at(42), NOW), { text: "42 s ago", short: "42s", stale: false });
  assert.deepEqual(freshness(at(299), NOW), { text: "4 min ago", short: "4m", stale: false });
  assert.deepEqual(freshness(at(301), NOW), { text: "5 min ago", short: "5m", stale: true });
  assert.deepEqual(freshness(at(7200), NOW), { text: "2 h ago", short: "2h", stale: true });
  assert.deepEqual(freshness("nope", NOW), { text: "time unknown", short: "?", stale: true });
});

test("every refused link reads as one plain sentence", () => {
  for (const [code, reason] of [["WALLET_REQUIRED"], ["LINK_TAKEN"], ["NOT_OWNER"], ["LINK_REFUSED", "not_yours"], ["LINK_REFUSED", "unverifiable"], ["LINK_REFUSED", "account_required"], ["VERSION_CONFLICT"], ["OFFLINE"], ["BAD_REQUEST"]]) {
    assert.match(linkRefusalLine(code, reason ?? null), /^[A-Z][^_]*\.$/, code);
  }
  assert.notEqual(linkRefusalLine("LINK_REFUSED", "not_yours"), linkRefusalLine("LINK_REFUSED", "unverifiable"));
});

test("a read that never answers is said as unavailable, and its request is aborted", async () => {
  let signal = null;
  const hung = { fetch: (_url, init) => ((signal = init.signal), new Promise(() => {})), wallet: WALLET, accountId: null, now: () => NOW, timeoutMs: 20 };
  assert.deepEqual(await readObject({ kind: "team", teamId: "a".repeat(24) }, hung), { state: "unavailable" });
  assert.equal(signal.aborted, true, "the hung request is cancelled");
  const slowBody = { fetch: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }), wallet: WALLET, accountId: null, now: () => NOW, timeoutMs: 20 };
  assert.deepEqual(await readObject({ kind: "prediction_book", accountId: "acc" }, slowBody), { state: "unavailable" }, "a body that never comes is no answer either");
});
