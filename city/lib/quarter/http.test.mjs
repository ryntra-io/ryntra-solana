// Run from repo root: node --test city/lib/quarter/http.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createHttpWorld } from "./http.ts";
import { WorldError } from "./types.ts";

/**
 * How the client talks (what it understands is in contract.test.mjs, against the server itself): every route at
 * its address, every POST with an Idempotency-Key — the caller's when it has one, so a retry repeats it — and
 * same-origin cookies; no network is status 0, an answer the screens cannot stand on is a bad answer.
 */

const QUARTER = { id: "q-1", ownerId: "r-1", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 1, version: 3, updatedAt: "" };
const BUILDING = { id: "b-1", quarterId: "q-1", slot: 1, kind: "home", level: 1, modules: ["base.stone", "roof.flat"], link: null, updatedAt: "" };

function server(answer) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body), credentials: init.credentials });
    const [status, body] = typeof answer === "function" ? answer(url, init) : answer;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, world: createHttpWorld({ fetch, newKey: () => "made-key-1" }) };
}

test("writes carry a key, the caller's own on a retry; reads carry none", async () => {
  const { calls, world } = server((url) => (url.endsWith("/build") ? [200, { quarter: QUARTER, building: BUILDING, tasks: [], points: { total: 0 } }] : [201, { resident: { id: "r-1" }, quarter: QUARTER, created: true }]));
  await world.claim();
  const input = { quarterId: "q-1", slot: 1, kind: "home", modules: ["base.stone", "roof.flat"], version: 3 };
  await world.build(input, "tap-7");
  await world.build(input, "tap-7");
  assert.deepEqual(calls.map((c) => [c.method, c.url, c.headers["idempotency-key"]]), [
    ["POST", "/api/world/claim", "made-key-1"],
    ["POST", "/api/world/build", "tap-7"],
    ["POST", "/api/world/build", "tap-7"],
  ]);
  assert.deepEqual(calls[0].body, {});
  assert.deepEqual(calls[1].body, input);
  assert.ok(calls.every((c) => c.credentials === "same-origin"));
});

test("reads go to their addresses, ids and cursors encoded", async () => {
  const { calls, world } = server((url) =>
    url.includes("/away") ? [200, { since: "a", until: "b", events: [], report: { beats: [], counts: { quarter: 0, object: 0, district: 0, city: 0 } } }] : url.includes("/district") ? [200, { district: "arrivals", quarters: [], nextCursor: null }] : [200, { quarter: QUARTER, buildings: [] }],
  );
  await world.quarter("q/1");
  await world.district("arrivals", "next page");
  await world.away("2026-10-27T10:00:00.000Z");
  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.headers["idempotency-key"]]),
    [
      ["GET", "/api/world/quarter/q%2F1", undefined],
      ["GET", "/api/world/district/arrivals?cursor=next%20page", undefined],
      ["GET", "/api/world/away?since=2026-10-27T10%3A00%3A00.000Z", undefined],
    ],
  );
});

test("a newcomer reads as null; a world that is down is an error, not a newcomer", async () => {
  assert.equal(await server([401, { error: { code: "NO_RESIDENT", message: "" } }]).world.me(), null);
  await assert.rejects(server([503, { error: { code: "UNAVAILABLE", message: "" } }]).world.me(), (e) => e instanceof WorldError && e.code === "UNAVAILABLE");
});

test("no network is status 0; a body the screens cannot read is a bad answer", async () => {
  const offline = createHttpWorld({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(offline.claim(), (e) => e instanceof WorldError && e.status === 0 && e.code === "OFFLINE");
  await assert.rejects(server([200, { quarter: QUARTER }]).world.build({ quarterId: "q-1", slot: 1, kind: "home", modules: ["base.stone"], version: 3 }), (e) => e.code === "BAD_ANSWER");
  await assert.rejects(server([200, { quarter: QUARTER }]).world.claim(), (e) => e.code === "BAD_ANSWER");
  await assert.rejects(server([502, null]).world.claim(), (e) => e.status === 502 && e.code === "UNAVAILABLE");
});
