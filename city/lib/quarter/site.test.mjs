// Run from repo root: node --test city/lib/quarter/site.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createMockWorld } = await import("./mock.ts");
const { createQuarterStore } = await import("./store.ts");
const { createSiteStore } = await import("./site.ts");
const { WorldError } = await import("./types.ts");

/**
 * Linking a building, from the owner's side: a wallet, its one signed message (no transaction), the owner's own
 * objects from the engine, a tap; the world keeps the link and the building reads its object. A refusal keeps the
 * picker open with one line; a read is kept for a minute and read again after.
 */

const MINT = "So1aNaCoinMint1111111111111111111111111111";
const WALLET = "WaLLet1111111111111111111111111111111111111";
const connection = { wallet: "Phantom", address: WALLET };

function setup({ linkFails = [], proofFails = false } = {}) {
  const mock = createMockWorld({ storage: null });
  const links = [];
  let accountId = null;
  // The server's link: the version moves on and the building shows the object.
  const client = {
    ...mock,
    async me() {
      const me = await mock.me();
      return me && { ...me, resident: { ...me.resident, accountId }, buildings: me.buildings.map((b) => ({ ...b, link: links.findLast((l) => l.slot === b.slot)?.link ?? null })) };
    },
    async link(input, key) {
      const f = linkFails.shift();
      if (f) throw f;
      links.push({ ...input, key });
      const me = await client.me();
      const building = me.buildings.find((b) => b.slot === input.slot);
      return { quarter: { ...me.quarter, version: input.version + 1 }, building: { ...building, link: input.link } };
    },
  };
  let keys = 0;
  const quarter = createQuarterStore({ client: () => client, newKey: () => `key-${++keys}`, retryMs: 0 });
  const proofs = [];
  const fetches = [];
  let clock = 1_000_000;
  const site = createSiteStore({
    quarter,
    now: () => clock,
    prove: async (c) => {
      proofs.push(c);
      if (proofFails) return { ok: false, state: "declined", message: "Nothing was signed." };
      accountId = "acc-1";
      return { ok: true };
    },
    fetch: async (url) => {
      fetches.push(url);
      if (url.startsWith(`/api/v1/launch/creators/`)) return { ok: true, status: 200, json: async () => ({ launches: [{ token: MINT, name: "Orbit Cat", symbol: "OCAT", role: "creator" }] }) };
      if (url.endsWith("/stats")) return { ok: false, status: 503, json: async () => ({}) };
      if (url.startsWith(`/api/v1/launch/${MINT}`)) return { ok: true, status: 200, json: async () => ({ name: "Orbit Cat", symbol: "OCAT", progressBps: 1000, migrated: false, observedAt: new Date(clock).toISOString() }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  return { quarter, site, links, proofs, fetches, tick: (ms) => (clock += ms) };
}

async function withTower(quarter) {
  await quarter.getState().load();
  await quarter.getState().claim();
  quarter.getState().arrived();
  quarter.getState().pick(1);
  quarter.getState().choose("coin_tower");
  assert.equal(await quarter.getState().place(), true);
  return quarter.getState().me.buildings.find((b) => b.slot === 1);
}

test("a coin tower links its coin: wallet, one signed message, the owner's coin, a tap", async () => {
  const { quarter, site, links, proofs } = setup();
  const tower = await withTower(quarter);
  assert.equal(tower.link, null, "a fresh tower shows nothing until linked");

  await site.getState().startLink(1);
  assert.equal(site.getState().picking.step, "wallet", "no wallet yet: connect one first");
  site.getState().setConnection(connection);
  assert.equal(site.getState().picking.step, "proof");

  await site.getState().prove();
  assert.deepEqual(proofs, [connection]);
  assert.equal(quarter.getState().me.resident.accountId, "acc-1", "the sign-in gave the resident an account, read again");
  const picking = site.getState().picking;
  assert.equal(picking.step, "list");
  assert.deepEqual(picking.list, { state: "ok", items: [{ link: { kind: "mint", mint: MINT }, title: "Orbit Cat", line: "$OCAT · Ryntra Launch" }] });

  const version = quarter.getState().me.quarter.version;
  assert.equal(await site.getState().choose(picking.list.items[0]), true);
  assert.equal(links.length, 1);
  assert.deepEqual({ slot: links[0].slot, link: links[0].link, version: links[0].version }, { slot: 1, link: { kind: "mint", mint: MINT }, version });
  assert.equal(site.getState().picking, null);
  assert.deepEqual(quarter.getState().me.buildings.find((b) => b.slot === 1).link, { kind: "mint", mint: MINT });
  assert.equal(quarter.getState().me.quarter.version, version + 1);
  const read = site.getState().reads[`mint:${MINT}`];
  assert.equal(read.read.state, "ok", "the building reads its coin straight away");
  assert.equal(read.read.view.title, "Orbit Cat");
});

test("a second link in the same tab needs no new signature", async () => {
  const { quarter, site, proofs } = setup();
  await withTower(quarter);
  site.getState().setConnection(connection);
  await site.getState().startLink(1);
  await site.getState().prove();
  site.getState().cancel();
  await site.getState().startLink(1);
  assert.equal(site.getState().picking.step, "list");
  assert.equal(proofs.length, 1);
  site.getState().setConnection({ wallet: "Phantom", address: "Other111111111111111111111111111111111111111" });
  await site.getState().startLink(1);
  assert.equal(site.getState().picking.step, "proof", "another wallet proves itself");
});

test("a declined signature or a refused link keeps the picker, with one plain line", async () => {
  const declined = setup({ proofFails: true });
  await withTower(declined.quarter);
  declined.site.getState().setConnection(connection);
  await declined.site.getState().startLink(1);
  await declined.site.getState().prove();
  assert.equal(declined.site.getState().picking.step, "proof");
  assert.equal(declined.site.getState().picking.error, "Nothing was signed.");

  const refused = setup({ linkFails: [new WorldError(422, "LINK_REFUSED", { reason: "not_yours" })] });
  await withTower(refused.quarter);
  refused.site.getState().setConnection(connection);
  await refused.site.getState().startLink(1);
  await refused.site.getState().prove();
  const item = refused.site.getState().picking.list.items[0];
  assert.equal(await refused.site.getState().choose(item), false);
  assert.equal(refused.site.getState().picking.step, "list");
  assert.equal(refused.site.getState().picking.error, "Ryntra sees this is not yours.");
  assert.equal(refused.quarter.getState().me.buildings.find((b) => b.slot === 1).link, null, "nothing is shown that the world did not keep");

  const expired = setup({ linkFails: [new WorldError(401, "WALLET_REQUIRED")] });
  await withTower(expired.quarter);
  expired.site.getState().setConnection(connection);
  await expired.site.getState().startLink(1);
  await expired.site.getState().prove();
  await expired.site.getState().choose(expired.site.getState().picking.list.items[0]);
  assert.equal(expired.site.getState().picking.step, "proof", "the proof expired: sign again");
  assert.equal(expired.site.getState().proven, null);
});

test("a link that met no answer is tried once more with the same key; a stale version takes the quarter as it is", async () => {
  const { quarter, site, links } = setup({ linkFails: [new WorldError(0, "OFFLINE")] });
  await withTower(quarter);
  site.getState().setConnection(connection);
  await site.getState().startLink(1);
  await site.getState().prove();
  assert.equal(await site.getState().choose(site.getState().picking.list.items[0]), true);
  assert.equal(links.length, 1);

  const stale = setup();
  await withTower(stale.quarter);
  const now = stale.quarter.getState().me;
  const current = { quarter: { ...now.quarter, version: now.quarter.version + 5 }, buildings: now.buildings };
  const conflict = setup({ linkFails: [new WorldError(409, "VERSION_CONFLICT", { current })] });
  await withTower(conflict.quarter);
  const out = await conflict.quarter.getState().link(1, { kind: "mint", mint: MINT });
  assert.deepEqual(out, { ok: false, code: "VERSION_CONFLICT", reason: null });
  assert.equal(conflict.quarter.getState().me.quarter.version, now.quarter.version + 5);
});

test("a read is kept for a minute, then read again; a building with no link reads nothing", async () => {
  const { site, fetches, tick } = setup();
  const link = { kind: "mint", mint: MINT };
  await site.getState().refresh(link);
  const first = fetches.length;
  assert.equal(first, 2, "the launch and its stats");
  await site.getState().refresh(link);
  assert.equal(fetches.length, first, "fresh: kept");
  tick(61_000);
  await site.getState().refresh(link);
  assert.equal(fetches.length, first * 2, "a minute later: read again");
  const entry = site.getState().reads[`mint:${MINT}`];
  assert.equal(entry.read.view.at, new Date(1_061_000).toISOString(), "the view carries the engine's own moment");

  await site.getState().startLink(7);
  assert.equal(site.getState().picking, null, "no building on the plot, nothing to link");
});

test("closing the picker while the wallet signs keeps the signature: the next link asks for none", async () => {
  const { quarter, site, proofs } = setup();
  await withTower(quarter);
  site.getState().setConnection(connection);
  await site.getState().startLink(1);
  const signing = site.getState().prove();
  site.getState().cancel();
  await signing;
  assert.equal(site.getState().proven, WALLET, "the proof is kept although the picker closed");
  assert.equal(site.getState().picking, null, "the closed picker stays closed");
  await site.getState().startLink(1);
  assert.equal(site.getState().picking.step, "list");
  assert.equal(proofs.length, 1, "one signature in all");
});

test("a read that finishes after the wallet changed is dropped and read again under the new wallet", async () => {
  const OTHER = "Other111111111111111111111111111111111111111";
  const owners = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const site = createSiteStore({
    quarter: createQuarterStore({ client: () => createMockWorld({ storage: null }), retryMs: 0 }),
    now: () => 1_000_000,
    prove: async () => ({ ok: true }),
    fetch: async (url) => {
      const owner = new URL(url, "https://x").searchParams.get("owner");
      owners.push(owner);
      if (owner === WALLET) await gate;
      return { ok: true, status: 200, json: async () => ({ positions: [{ address: "Pos1", name: `of ${owner}`, kind: "meteora-dlmm" }], venues: { a: { ok: true } } }) };
    },
  });
  const link = { kind: "lp_position", position: "Pos1" };
  site.getState().setConnection(connection);
  const first = site.getState().refresh(link);
  site.getState().setConnection({ wallet: "Phantom", address: OTHER });
  release();
  await first;
  const entry = site.getState().reads["lp_position:Pos1"];
  assert.deepEqual(owners, [WALLET, OTHER]);
  assert.equal(entry.wallet, OTHER);
  assert.equal(entry.read.view.title, `of ${OTHER}`, "the first wallet's answer is never shown as the second's");
  await site.getState().refresh(link);
  assert.equal(owners.length, 2, "fresh under the same wallet: kept");
});
