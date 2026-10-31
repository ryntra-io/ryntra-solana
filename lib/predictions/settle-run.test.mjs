// Run from repo root: node --test lib/predictions/settle-run.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { getPredictionProvider, resetAggAdapterCache } from "./agg/adapter.ts";
import { listNotes, readPrefs, writePrefs } from "./notify/channel.ts";
import { listRedeemReceipts } from "./redeem.ts";
import { collectMarkets, listCollects, sweepSettlement, sweepWallets } from "./settle-run.ts";
import { writeLink } from "./session.ts";
import { seal } from "./vault.ts";

/*
 * The win that arrives on its own, replayed against the aggregator's answers
 * (`fixtures/agg-live.json`): a market decided, the payout asked for once
 * under the market's one request id, the receipt kept, the position read back
 * as paid, and the person told. Then the refusals: an answer that never came,
 * a second sweep over a payout already made, and paper — which asks for
 * nothing. The real adapter and SDK talk to a local server that answers as
 * the aggregator does; nothing leaves this machine.
 */

const LIVE = JSON.parse(readFileSync(new URL("./fixtures/agg-live.json", import.meta.url), "utf8"));
const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SECRET = "test-secret-of-sufficient-length";
process.env.BETA_TOKEN_SECRET = SECRET;
const ON = { PREDICTIONS_LIVE_FUNDING: "on", PREDICTIONS_LIVE_WALLETS: WALLET, PREDICTIONS_LIVE_VENUES: "polymarket", BETA_TOKEN_SECRET: SECRET };
const PAPER = { BETA_TOKEN_SECRET: SECRET };

/**
 * The same closed-and-won position the live pilot's fixture holds, with the provider's redeem status swapped. The
 * market is decided an hour before the clock reads, so it is news on any day the suite runs (a decision is news for
 * seven days; the recorded moment, 24.10.2026, stopped being news on 31.10).
 */
function positions(redeemStatus, over = {}) {
  const body = structuredClone(LIVE.positionsClosedWon.body);
  body.data[0].redeemStatus = redeemStatus;
  body.data[0].resolutionDate = new Date(Date.now() - 3_600_000).toISOString();
  Object.assign(body.data[0], over);
  return { status: 200, body };
}

const NONE = { status: 200, body: { data: [], nextCursor: null, hasMore: false } };

function durableStore() {
  return { ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" };
}

function jwt(expSeconds, sub = "u1") {
  return `h.${Buffer.from(JSON.stringify({ sub, exp: expSeconds })).toString("base64url")}.s`;
}

async function linked(store, wallet = WALLET) {
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  await writeLink(
    store,
    {
      wallet,
      externalId: `ryntra:solana:${wallet}`,
      providerUserId: "agguser",
      providerWallet: wallet,
      externalIdLinked: true,
      linkAttemptedAt: stamp,
      linkError: null,
      access: seal(jwt(now / 1000 + 3600), { BETA_TOKEN_SECRET: SECRET }),
      refresh: seal("refresh-1", { BETA_TOKEN_SECRET: SECRET }),
      accessExpiresAt: new Date(now + 3_600_000).toISOString(),
      state: "active",
      stateReason: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    null,
  );
  return store;
}

/**
 * The aggregator, answering from the fixtures. `script` names the answer per
 * call kind; a list is answered in turn (its last answer repeats); a function
 * decides from what was seen. `"drop"` closes the socket without an answer.
 * An answer given as an object is sent as it is.
 */
async function aggServer(t, script = {}) {
  const seen = [];
  const plan = { positionsActive: NONE, positionsClosed: positions("eligible"), redeem: "redeemSubmitted", ...script };
  const queues = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
  const answerFor = (kind) => {
    const q = queues[kind];
    if (typeof q === "function") return q(seen);
    if (Array.isArray(q)) return q.length > 1 ? q.shift() : q[0];
    return q;
  };
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://agg");
      const body = raw ? JSON.parse(raw) : null;
      const query = Object.fromEntries(url.searchParams);
      seen.push({ method: request.method, path: url.pathname, query, body });
      const p = url.pathname;
      const kind =
        request.method === "GET" && p === "/execution/positions" ? (query.status === "closed" ? "positionsClosed" : "positionsActive")
        : request.method === "POST" && p === "/execution/redeem" ? "redeem"
        : request.method === "GET" && p === "/app/config" ? "config"
        : null;
      const picked = kind ? answerFor(kind) : null;
      if (picked === "drop") {
        request.socket.destroy();
        return;
      }
      const answer = picked === null || picked === undefined ? { status: 404, body: { message: "not here" } } : typeof picked === "string" ? LIVE[picked] : picked;
      response.statusCode = answer.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { id: process.env.AGG_APP_ID, base: process.env.AGG_API_BASE_URL };
  process.env.AGG_APP_ID = "app-under-test";
  process.env.AGG_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  resetAggAdapterCache();
  t.after(() => {
    server.close();
    if (saved.id === undefined) delete process.env.AGG_APP_ID;
    else process.env.AGG_APP_ID = saved.id;
    if (saved.base === undefined) delete process.env.AGG_API_BASE_URL;
    else process.env.AGG_API_BASE_URL = saved.base;
    resetAggAdapterCache();
  });
  return { seen, redeems: () => seen.filter((s) => s.path === "/execution/redeem") };
}

/** Transports that only count what they were asked to send. */
function spy() {
  const calls = [];
  return { calls, transports: { webpush: async () => "none", telegram: async (wallet, words) => (calls.push(words), "sent") } };
}

const kinds = (notes) => notes.map((n) => n.kind).sort();

/* ------------------------------------------------------------------ the whole path */

test("the win arrives on its own: decided → asked once → receipt → read back as paid → the person told", async (t) => {
  /* The provider marks it payable, and after the ask the position reads `redeemed`. */
  let paid = false;
  const agg = await aggServer(t, { positionsClosed: () => (paid ? positions("redeemed") : positions("eligible")), redeem: () => ((paid = true), "redeemSubmitted") });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const sent = spy();

  const first = await sweepSettlement(store, provider, WALLET, ON, Date.now(), { transports: sent.transports, locale: "uk" });
  assert.equal(first.ok, true, first.message);
  assert.equal(first.value.mode, "live");
  assert.equal(agg.redeems().length, 1, "asked once, without anybody pressing anything");
  assert.deepEqual(agg.redeems()[0].body, { venueMarketOutcomeIds: ["o-yes"], mode: "live" });

  const asked = first.value.collects;
  assert.equal(asked.length, 1);
  assert.equal(asked[0].phase, "collecting");
  assert.equal(asked[0].amountUsd, 2.45);
  assert.equal(asked[0].legs[0].status, "submitted");
  assert.equal(asked[0].legs[0].txHash, "0xabc123def4567890");
  assert.equal((await listRedeemReceipts(store, WALLET)).length, 1, "the collect's own receipt is kept beside it");

  /* The next pass reads the position back: the provider says it is paid, so the record closes as paid — from the position, not from our request. */
  const second = await sweepSettlement(store, provider, WALLET, ON, Date.now(), { transports: sent.transports, locale: "uk" });
  assert.equal(agg.redeems().length, 1, "nothing is asked for twice");
  const done = second.value.collects[0];
  assert.equal(done.phase, "collected");
  assert.equal(done.providerRedeemStatus, "redeemed");
  assert.ok(done.confirmedAt, "the moment the provider confirmed it");

  /* The person was told, once each: the market decided, and the money credited. */
  const notes = await listNotes(store, WALLET);
  assert.deepEqual(kinds(notes), ["market_resolved", "win_credited"]);
  assert.equal(notes.every((n) => n.count === 1), true, "a sweep that runs every ten minutes says each thing once");
  assert.equal(notes.every((n) => n.paper === false), true);
  const credited = notes.find((n) => n.kind === "win_credited");
  assert.equal(credited.facts.amountUsd, 2.45);
  assert.equal(credited.href, "/app/predictions/portfolio");
  assert.equal(notes.every((n) => n.delivery === "sent"), true);
  assert.equal(sent.calls.length, 2);
  assert.match(sent.calls.map((w) => w.title).join(" "), /Виграш зараховано/);

  /* And the calendar has nothing left waiting. */
  assert.deepEqual(second.value.calendar.rows, []);
});

test("an answer that never came leaves the payout unknown, and the next sweep asks the same request — never a second credit", async (t) => {
  const agg = await aggServer(t, { redeem: ["drop", "redeemSubmitted"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();

  const lost = await sweepSettlement(store, provider, WALLET, ON, Date.now(), {});
  const unknown = lost.value.collects[0];
  assert.equal(unknown.phase, "unknown", "never «paid», never «nothing happened»");
  assert.equal(unknown.aged, false);
  assert.deepEqual(unknown.legs, []);
  const told = await listNotes(store, WALLET);
  assert.ok(told.some((n) => n.kind === "win_unknown"), "the person is told the state is unknown");

  /* The provider still marks the outcomes payable, so the same record is asked again — its own request id, not a new one. */
  const again = await sweepSettlement(store, provider, WALLET, ON, Date.now(), {});
  assert.equal(agg.redeems().length, 2);
  assert.equal(again.value.collects.length, 1, "one record for this market, whatever the number of asks");
  assert.equal(again.value.collects[0].requestId, unknown.requestId);
  assert.equal(again.value.collects[0].phase, "collecting");
});

test("a payout already made is not asked for again, even while a sweep and a person press at once", async (t) => {
  const agg = await aggServer(t, { positionsClosed: positions("redeemed") });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const [a, b] = await Promise.all([sweepSettlement(store, provider, WALLET, ON, Date.now(), {}), sweepSettlement(store, provider, WALLET, ON, Date.now(), {})]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(agg.redeems().length, 0, "the provider marks nothing payable, so nothing is asked");
  assert.deepEqual(a.value.collects, []);
  assert.deepEqual(a.value.calendar.rows, [], "a market paid waits for nothing");
  assert.ok((await listNotes(store, WALLET)).some((n) => n.kind === "win_credited"));
});

test("two sweeps at the same moment ask one market's payout once", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const at = Date.now();
  await Promise.all([sweepSettlement(store, provider, WALLET, ON, at, {}), sweepSettlement(store, provider, WALLET, ON, at, {})]);
  assert.equal(agg.redeems().length, 1, "the record is claimed before the request leaves");
  assert.equal((await listCollects(store, WALLET)).length, 1);
});

test("a read asks for nothing: it follows what is out and writes what happened", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const read = await sweepSettlement(store, provider, WALLET, ON, Date.now(), { ask: false });
  assert.equal(agg.redeems().length, 0, "looking at the page never starts a payment");
  assert.deepEqual(read.value.collects, []);
  assert.deepEqual(read.value.calendar.collecting.map((r) => r.phase), ["payable"], "it is shown as due, and the sweep or the button asks for it");
  assert.ok((await listNotes(store, WALLET)).some((n) => n.kind === "market_resolved"));
});

test("the person's own press takes the same record: a press during a sweep asks the venue once", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const at = Date.now();
  const [pressed, swept] = await Promise.all([collectMarkets(store, provider, WALLET, ["o-yes"], ON, at), sweepSettlement(store, provider, WALLET, ON, at, {})]);
  assert.equal(agg.redeems().length, 1, "one market, one request, whoever asked first");
  assert.equal(pressed.ok || swept.ok, true);
  assert.equal((await listCollects(store, WALLET)).length, 1);

  /* Pressed again over a payout the venue already answered: nothing is sent. */
  const again = await collectMarkets(store, provider, WALLET, ["o-yes"], ON, at + 1_000);
  assert.equal(agg.redeems().length, 1);
  assert.equal(again.ok, true, again.message);
  assert.equal(again.value.collects[0].phase, "collecting");
});

test("a press names an outcome the provider does not mark payable, or live money is off: nothing is asked", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const made = await collectMarkets(store, provider, WALLET, ["o-no"], ON, Date.now());
  assert.equal(made.code, "ORDER_REFUSED");
  const off = await collectMarkets(store, provider, WALLET, ["o-yes"], PAPER, Date.now());
  assert.equal(off.code, "FUNDING_OFF");
  assert.equal(agg.redeems().length, 0);
});

/* ------------------------------------------------------------------ paper and the switches */

test("paper asks for no payout and keeps the calendar and the notes", async (t) => {
  const agg = await aggServer(t, { positionsClosed: positions("not_eligible"), positionsActive: NONE });
  const store = await linked(durableStore());
  const swept = await sweepSettlement(store, getPredictionProvider(), WALLET, PAPER, Date.now(), {});
  assert.equal(swept.value.mode, "paper", "live money off is paper, which is the default");
  assert.equal(agg.redeems().length, 0);
  assert.deepEqual(swept.value.collects, []);
  assert.deepEqual(swept.value.calendar.rows, [], "a market the venue settles itself waits for nothing");
  const notes = await listNotes(store, WALLET);
  assert.deepEqual(kinds(notes), ["market_resolved", "win_credited"]);
  assert.equal(notes.every((n) => n.paper === true), true, "a paper note never reads as real money");
  assert.deepEqual(
    agg.seen.filter((s) => s.path === "/execution/positions").map((s) => s.query.mode),
    ["paper", "paper"],
    "the paper account is the one read",
  );
});

test("a wallet live money is not open to is swept as paper, and asked nothing", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore(), OTHER);
  const swept = await sweepSettlement(store, getPredictionProvider(), OTHER, ON, Date.now(), {});
  assert.equal(swept.value.mode, "paper");
  assert.equal(agg.redeems().length, 0);
});

test("the quiet hour and the one touch reach settlement's own notes", async (t) => {
  await aggServer(t);
  const store = await linked(durableStore());
  const sent = spy();
  await writePrefs(store, WALLET, { on: false }, Date.now());
  await sweepSettlement(store, getPredictionProvider(), WALLET, ON, Date.now(), { transports: sent.transports, locale: "uk" });
  assert.equal(sent.calls.length, 0, "stopped means stopped");
  assert.equal((await listNotes(store, WALLET)).every((n) => n.delivery === "off"), true);
  assert.equal((await readPrefs(store, WALLET)).on, false);
});

test("the provider not answering leaves what the store holds, and asks for nothing", async (t) => {
  const agg = await aggServer(t, { positionsClosed: "drop", positionsActive: "drop" });
  const store = await linked(durableStore());
  const swept = await sweepSettlement(store, getPredictionProvider(), WALLET, ON, Date.now(), {});
  assert.equal(swept.ok, true);
  assert.ok(swept.value.providerFailure, "the failure is said, not guessed around");
  assert.deepEqual(swept.value.calendar.rows, []);
  assert.equal(agg.redeems().length, 0);
});

test("the operator's pass sweeps the wallets with an account here, and nobody else", async () => {
  const store = durableStore();
  assert.deepEqual(await sweepWallets(store), []);
  /* A person with an account here has positions, whether or not Ryntra recorded their order. */
  await linked(store);
  assert.deepEqual(await sweepWallets(store), [WALLET]);
  await store.versioned("predictionOrders").insertIfAbsent(`solana:mainnet:${OTHER}:q2`, { version: 1, wallet: OTHER, quoteId: "q2" });
  assert.deepEqual([...(await sweepWallets(store))].sort(), [OTHER, WALLET].sort());
  assert.equal((await sweepWallets(store, 1)).length, 1, "one pass stays inside one request's budget");
  /* A link the person revoked is no account any more. */
  const revoked = durableStore();
  await linked(revoked);
  const links = revoked.versioned("predictionLinks");
  const row = await links.get(`solana:mainnet:${WALLET}`);
  await links.compareAndSet(`solana:mainnet:${WALLET}`, row.version, { ...row, state: "revoked", version: row.version + 1 });
  assert.deepEqual(await sweepWallets(revoked), []);
});
