import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { movesOf, scanPageOf } from "./creator-chain.ts";
import { creatorDaySpent, resetCreatorScan } from "./creator-scan.server.ts";
import { HOLDER_MOVES, HOLDER_SCAN_BUDGET, LINKS_MOST_CREDITS, LINK_HOLDERS, isPersonKey, readHolderLinks, resetHolderLinks } from "./holder-links.server.ts";
import { holderLinksOf } from "./holder-links.ts";

/*
 * The links between a coin's largest holders: only what the chain shows (the coin or SOL from one wallet,
 * transfers between them), never a pool, never a relayer's fee — read on recorded answers in the published shape
 * (`fixtures/holder-links-scan.json`), one call per holder, behind a closed switch.
 */

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/holder-links-scan.json", import.meta.url), "utf8"));
const A = FIXTURE.addresses;
const T0 = 1_795_000_000;
const ENDPOINT = "https://mainnet.helius-rpc.com/v1/parsed-events/scan?api-key=0123abcd-4567-89ef-0123-456789abcdef";
const ON = { RYNTRA_SPOT_CREATOR: "on" };
const people = FIXTURE.holders.filter((row) => !row.labels.length).map(({ owner, sharePct }) => ({ owner, sharePct }));
const movesFor = () => new Map(people.map((holder) => [holder.owner, movesOf([scanPageOf(FIXTURE.pages[holder.owner])], holder.owner, A.MINT)]));

test("a person's key is on the curve; a curve, a pool or a vault is not", () => {
  assert.equal(isPersonKey(A.H1), true);
  assert.equal(isPersonKey(A.CURVE), false);
  assert.equal(isPersonKey("not an address"), false);
});

test("the groups the chain shows: one wallet sent the coin to two, one passed it on; one wallet sent SOL to two buyers", () => {
  const links = holderLinksOf({ holders: people, moves: movesFor(), isWallet: isPersonKey, skip: new Set([A.CURVE]), creator: A.CREATOR });
  assert.equal(links.groups.length, 2);
  const [first, second] = links.groups;
  assert.deepEqual(first.wallets, [A.H1, A.H2, A.H6]);
  assert.equal(first.sharePct, 24);
  assert.deepEqual(first.ties, ["coin", "between"]);
  assert.deepEqual(first.sources, [A.SOURCE_S]);
  assert.equal(first.creator, false);
  assert.deepEqual(second.wallets, [A.H3, A.H4]);
  assert.equal(second.sharePct, 11);
  assert.deepEqual(second.ties, ["sol"]);
  assert.deepEqual(second.sources, [A.SOURCE_F]);
  assert.equal(links.nodes.find((node) => node.owner === A.H5).group, null, "a relayer's fee and a curve's payout tie no one");
  assert.deepEqual(links.nodes.map((node) => node.group), [1, 1, 2, 2, null, 1]);
  assert.deepEqual(
    links.edges.map((edge) => [edge.from, edge.to, edge.kind]),
    [
      [A.H1, A.H6, "between"],
      [A.SOURCE_S, A.H1, "coin"],
      [A.SOURCE_S, A.H2, "coin"],
      [A.SOURCE_F, A.H3, "sol"],
      [A.SOURCE_F, A.H4, "sol"],
    ],
  );
  assert.equal(links.sources.length, 2);
  assert.ok(!links.edges.some((edge) => edge.from === A.CURVE || edge.to === A.CURVE || edge.from === A.RELAYER), "never a curve, never a relayer");
});

test("a fee the creator paid ties its buyers; a source that sent to one holder alone ties no one", () => {
  const move = (owner, extra) => ({ signature: `s-${owner}`, at: T0, dir: "in", amount: 1, kind: "trade", party: null, paidBy: null, solFrom: [], ...extra });
  const moves = new Map([
    [A.H1, [move(A.H1, { paidBy: A.CREATOR })]],
    [A.H2, [move(A.H2, { paidBy: A.CREATOR })]],
    [A.H3, [move(A.H3, { paidBy: A.RELAYER })]],
    [A.H4, [move(A.H4, { paidBy: A.RELAYER })]],
    [A.H5, [move(A.H5, { kind: "transfer", party: A.SOURCE_S })]],
  ]);
  const holders = people.slice(0, 5);
  const links = holderLinksOf({ holders, moves, isWallet: isPersonKey, creator: A.CREATOR });
  assert.equal(links.groups.length, 1);
  assert.deepEqual(links.groups[0].wallets, [A.H1, A.H2]);
  assert.equal(links.groups[0].creator, true, "the creator ties them");
  assert.deepEqual(links.groups[0].ties, ["sol"]);
  assert.equal(links.sources.some((source) => source.wallet === A.SOURCE_S), false);
  assert.equal(links.sources.some((source) => source.wallet === A.RELAYER), false);

  const none = holderLinksOf({ holders, moves: new Map(), isWallet: isPersonKey });
  assert.deepEqual(none.groups, []);
  assert.deepEqual(none.edges, []);
  assert.equal(none.nodes.length, 5);
});

test("a holder that is the creator joins the group of those it sent the coin to", () => {
  const move = (owner, extra) => ({ signature: `s-${owner}`, at: T0, dir: "in", amount: 1, kind: "transfer", party: A.CREATOR, paidBy: null, solFrom: [], ...extra });
  const holders = [{ owner: A.CREATOR, sharePct: 10 }, { owner: A.H1, sharePct: 5 }, { owner: A.H2, sharePct: 4 }];
  const links = holderLinksOf({ holders, moves: new Map([[A.H1, [move(A.H1)]], [A.H2, [move(A.H2)]]]), isWallet: isPersonKey, creator: A.CREATOR });
  assert.deepEqual(links.groups.map((group) => [group.wallets, group.sharePct, group.ties, group.creator]), [[[A.CREATOR, A.H1, A.H2], 19, ["between"], true]]);
  assert.equal(links.nodes[0].creator, true);
});

/** A scan that answers each holder's call with its recorded page. */
function recordedScan(calls) {
  return async (url, init) => {
    assert.equal(url, ENDPOINT);
    const body = JSON.parse(init.body);
    calls.push(body);
    return new Response(JSON.stringify(FIXTURE.pages[body.address]), { status: 200 });
  };
}

function deps(calls, extra = {}) {
  let now = Date.UTC(2026, 10, 20, 12);
  return {
    env: ON,
    now: () => now,
    tick: (ms) => (now += ms),
    scan: { endpoint: ENDPOINT, fetch: recordedScan(calls) },
    holders: async () => ({ ok: true, holders: FIXTURE.holders.map((row) => ({ ...row, amount: 1, change: null, trades: 0 })) }),
    facts: async () => ({ ok: true, facts: { dev: A.CREATOR, createdAt: new Date(T0 * 1000).toISOString() } }),
    ...extra,
  };
}

test("the links read: one call per holder that is a person's key, since the coin's birth — then kept", async () => {
  resetHolderLinks();
  resetCreatorScan();
  const calls = [];
  const d = deps(calls);
  const read = await readHolderLinks(A.MINT, d);
  assert.equal(read.ok, true);
  assert.equal(read.checked, 6);
  assert.equal(read.of, 6);
  assert.equal(read.whole, true);
  assert.equal(read.groups.length, 2);
  assert.equal(calls.length, 6, "the curve is not asked about");
  assert.ok(calls.every((body) => body.limit === HOLDER_MOVES && body.budget.maxScannedTransactions === HOLDER_SCAN_BUDGET && body.time.gte === T0 - 60));
  assert.equal(creatorDaySpent(d.now()), 12 + 11 * 5);
  assert.equal(LINKS_MOST_CREDITS, LINK_HOLDERS * 13);

  calls.length = 0;
  assert.deepEqual(await readHolderLinks(A.MINT, d), read);
  assert.equal(calls.length, 0, "kept: nothing asked again");
  d.tick(16 * 60_000);
  await readHolderLinks(A.MINT, d);
  assert.equal(calls.length, 0, "each holder's moves are kept half an hour: a new answer from them");
});

test("closed or SOL: nothing asked; the chain silent for every holder: the source is quiet, not «no links»", async () => {
  resetHolderLinks();
  resetCreatorScan();
  const calls = [];
  assert.equal((await readHolderLinks(A.MINT, { ...deps(calls), env: {} })).code, "CLOSED");
  assert.equal((await readHolderLinks("So11111111111111111111111111111111111111112", deps(calls))).code, "NOT_READ");
  assert.equal(calls.length, 0);
  const silent = deps(calls, { scan: { endpoint: ENDPOINT, fetch: async () => new Response("down", { status: 503 }) } });
  assert.equal((await readHolderLinks(A.MINT, silent)).code, "UNREACHABLE");
  const noHolders = deps(calls, { holders: async () => ({ ok: false, code: "UNREACHABLE", reason: "node down" }) });
  resetHolderLinks();
  assert.equal((await readHolderLinks(A.MINT, noHolders)).code, "UNREACHABLE");
});

test("a day's ceiling: past it no holder is read and the tab says the source is quiet", async () => {
  resetHolderLinks();
  resetCreatorScan();
  const calls = [];
  const read = await readHolderLinks(A.MINT, deps(calls, { env: { ...ON, RYNTRA_SPOT_CREATOR_DAILY_CREDITS: "40" } }));
  assert.equal(read.code, "UNREACHABLE");
  assert.equal(calls.length, 0);
});
