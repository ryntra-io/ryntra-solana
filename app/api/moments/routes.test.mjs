/*
 * The route files of /api/moments only hand the request to the queue's API
 * (`city/lib/moments/drafts/api.ts`, tested route by route in
 * `city/lib/moments/drafts/queue.test.mjs`). This checks each file names the
 * right methods, runs on node, is never cached by the framework and passes
 * the right handler.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { test } from "node:test";

const ROUTES = [
  ["events/route.ts", [["POST", "events(req)"]]],
  ["drafts/route.ts", [["GET", "list(req)"]]],
  ["drafts/approve-all/route.ts", [["POST", "approveAll(req)"]]],
  ["drafts/[id]/approve/route.ts", [["POST", "approve(req, (await params).id)"]]],
  ["drafts/[id]/reject/route.ts", [["POST", "reject(req, (await params).id)"]]],
  ["drafts/[id]/clip/route.ts", [["GET", "getClip(req, (await params).id)"], ["PUT", "putClip(req, (await params).id)"]]],
  ["switch/route.ts", [["GET", "getSwitch(req)"], ["POST", "setSwitch(req)"]]],
];

for (const [file, methods] of ROUTES) {
  test(`/api/moments/${file.replace("/route.ts", "")} answers ${methods.map((m) => m[0]).join(", ")} through the queue's API`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /^import \{ momentsApi \} from "@\/city\/lib\/moments\/drafts\/server";$/m);
    assert.match(source, /export const runtime = "nodejs";/);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.equal((source.match(/export async function/g) ?? []).length, methods.length);
    for (const [method, call] of methods) {
      assert.match(source, new RegExp(`export async function ${method}\\(`));
      assert.ok(source.includes(`return momentsApi().${call};`), call);
    }
  });
}

test("the deployed door: the key for machines, a session for people, a fresh factor and the audit trail", () => {
  const server = readFileSync(new URL("../../../city/lib/moments/drafts/server.ts", import.meta.url), "utf8");
  assert.match(server, /import \{ requireFreshMfa \} from '@\/lib\/admin\/auth';/);
  assert.match(server, /appendAdminAudit/);
  assert.match(server, /fresh: async \(\) => \{\s+const gate = await requireFreshMfa\(\);/);
  assert.match(server, /createMomentsApi\(\{ store: draftStore\(\), authorize, audit, sender: xSender\(\) \}\)/, "x-sender (CITY-39), off until the owner's switch and keys");
  assert.match(server, /^import \{ xSender \} from '@\/city\/lib\/x\/connect';$/m);
  assert.doesNotMatch(server, /headers\.get\(.authorization/i, "the bearer rule lives in door.ts alone");
  const api = readFileSync(new URL("../../../city/lib/moments/drafts/api.ts", import.meta.url), "utf8");
  for (const [route, kind] of [["events", "machine"], ["list", "operator"], ["approveAll", "fresh"], ["getSwitch", "operator"], ["setSwitch", "operator"]]) {
    assert.match(api, new RegExp(`${route}: guarded\\('${kind}'`), route);
  }
  const desk = readFileSync(new URL("../../../city/lib/moments/drafts/Desk.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(desk, /sessionStorage|localStorage|Authorization|Bearer/, "the desk in the browser holds no key");
});

test("no other route lives under /api/moments", () => {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(new URL(dir, import.meta.url))) {
      const rel = `${dir}${name}`;
      if (statSync(new URL(rel, import.meta.url)).isDirectory()) walk(`${rel}/`);
      else if (name === "route.ts") found.push(rel.slice(2));
    }
  };
  walk("./");
  assert.deepEqual(found.sort(), ROUTES.map((r) => r[0]).sort());
});
