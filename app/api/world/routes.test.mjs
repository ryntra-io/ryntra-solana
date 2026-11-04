/*
 * The route files of /api/world only hand the request to the world's API
 * (`lib/world/api.ts`, tested route by route in `lib/world/api.test.mjs`).
 * This checks each file names the right method, runs on node, is never
 * cached by the framework and passes the right handler.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ROUTES = [
  ["claim/route.ts", "POST", "claim(req)"],
  ["me/route.ts", "GET", "me(req)"],
  ["quarter/[id]/route.ts", "GET", "quarter(req, (await params).id)"],
  ["district/[id]/route.ts", "GET", "district(req, (await params).id)"],
  ["build/route.ts", "POST", "build(req)"],
  ["link/route.ts", "POST", "link(req)"],
  ["away/route.ts", "GET", "away(req)"],
  ["consent/route.ts", "GET", "consent(req)", "POST", "setConsent(req)"],
  ["visit/route.ts", "POST", "visit(req)"],
  ["version/[id]/route.ts", "GET", "version(req, (await params).id)"],
];

/* The beacons (CITY-72) hand the request to their own API in `lib/world/beacons/`. */
const BEACON_ROUTES = [["beacons/route.ts", "GET", "list(req)", "POST", "save(req)"]];

for (const [file, ...pairs] of ROUTES) {
  const methods = pairs.filter((_, i) => i % 2 === 0);
  test(`/api/world/${file.replace("/route.ts", "")} answers ${methods.join(" and ")} through the world's API`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /^import \{ worldApi \} from "@\/lib\/world\/server";$/m);
    assert.match(source, /export const runtime = "nodejs";/);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.equal((source.match(/export async function/g) ?? []).length, methods.length);
    for (let i = 0; i < pairs.length; i += 2) {
      const [method, call] = [pairs[i], pairs[i + 1]];
      const handler = new RegExp(`export async function ${method}\\(req: Request[^)]*\\)[^{]*\\{\\n  return worldApi\\(\\)\\.([^;]+);`).exec(source);
      assert.equal(handler?.[1], call, `${method} → ${call}`);
    }
  });
}

for (const [file, ...pairs] of BEACON_ROUTES) {
  test(`/api/world/${file.replace("/route.ts", "")} answers through the beacons' API`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /^import \{ beaconApi \} from "@\/lib\/world\/beacons\/server";$/m);
    assert.match(source, /export const runtime = "nodejs";/);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    /* Closed unless the deployment opens the account's beacons. */
    assert.match(source, /^import \{ beaconsMode \} from "@\/lib\/world\/beacons\/switch";$/m);
    for (let i = 0; i < pairs.length; i += 2) {
      const handler = new RegExp(`export async function ${pairs[i]}\\(req: Request\\) \\{\\n  if \\(beaconsMode\\(process\\.env\\.NEXT_PUBLIC_RYNTRA_CITY_BEACONS\\) !== "open"\\) return closed\\(\\);\\n  return beaconApi\\(\\)\\.([^;]+);`).exec(source);
      assert.equal(handler?.[1], pairs[i + 1]);
    }
  });
}

/* Crews (CITY-20) hand the request to their own API, closed unless the deployment opens them. */
const CREW_ROUTES = [
  ["crew/route.ts", "GET", "mine(req)", "POST", "create(req)"],
  ["crew/join/route.ts", "POST", "join(req)"],
  ["crew/leave/route.ts", "POST", "leave(req)"],
  ["crew/gift/route.ts", "POST", "gift(req)"],
  ["crew/invite/[code]/route.ts", "GET", "invite(req, (await params).code)"],
  ["crews/route.ts", "GET", "streets(req)"],
];

for (const [file, ...pairs] of CREW_ROUTES) {
  test(`/api/world/${file.replace("/route.ts", "")} answers through the crews' API, closed until opened`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /^import \{ crewApi \} from "@\/lib\/world\/server";$/m);
    assert.match(source, /^import \{ crewsClosed \} from "[./]+(crew\/)?closed";$/m);
    assert.match(source, /export const runtime = "nodejs";/);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.equal((source.match(/export async function/g) ?? []).length, pairs.length / 2);
    for (let i = 0; i < pairs.length; i += 2) {
      const handler = new RegExp(`export async function ${pairs[i]}\\(req: Request[^)]*\\)[^{]*\\{\\n  return crewsClosed\\(\\) \\?\\? crewApi\\(\\)\\.([^;]+);`).exec(source);
      assert.equal(handler?.[1], pairs[i + 1], `${pairs[i]} → ${pairs[i + 1]}`);
    }
  });
}

test("crews answer nothing until the owner opens them on the server", async () => {
  const source = readFileSync(new URL("crew/closed.ts", import.meta.url), "utf8");
  assert.match(source, /crewsMode\(process\.env\.NEXT_PUBLIC_RYNTRA_CITY_CREWS\) === "open"\) return null;/);
  assert.match(source, /status: 404/);
});
