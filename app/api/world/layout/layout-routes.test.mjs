/*
 * The route files of /api/world/layout only hand the request to the layout's API (`lib/world/layout-api.ts`, tested
 * in `lib/world/layout-api.test.mjs`): each names the right method, runs on node and is never cached by the framework.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ROUTES = [
  ["route.ts", "GET", "mine(req)", "POST", "save(req)"],
  ["[id]/route.ts", "GET", "ofQuarter(req, (await params).id)"],
];

for (const [file, ...pairs] of ROUTES) {
  const methods = pairs.filter((_, i) => i % 2 === 0);
  test(`/api/world/layout/${file.replace("route.ts", "")} answers ${methods.join(" and ")} through the layout's API`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /^import \{ layoutApi \} from "@\/lib\/world\/server";$/m);
    assert.match(source, /export const runtime = "nodejs";/);
    assert.match(source, /export const dynamic = "force-dynamic";/);
    /* Closed unless the deployment opens free building: nothing read or written before that. */
    assert.match(source, /^import \{ freeBuildOpen \} from "@\/lib\/world\/layout";$/m);
    assert.equal((source.match(/export async function/g) ?? []).length, methods.length);
    for (let i = 0; i < pairs.length; i += 2) {
      const [method, call] = [pairs[i], pairs[i + 1]];
      const handler = new RegExp(`export async function ${method}\\(req: Request[^)]*\\)[^{]*\\{\\n  if \\(!freeBuildOpen\\(process\\.env\\.NEXT_PUBLIC_RYNTRA_CITY_FREE_BUILD\\)\\) return closed\\(\\);\\n  return layoutApi\\(\\)\\.([^;]+);`).exec(source);
      assert.equal(handler?.[1], call, `${method} → ${call}`);
    }
  });
}
