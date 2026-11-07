import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FRAME, frameLayers, frameWindow } from "./frames.ts";

// CITY-213: on the phone «Back» left the app from every window no one had listed by hand.

const components = fileURLToPath(new URL("../../components/", import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
});

test("a window no named layer speaks for stands on Back by itself", () => {
  const seen = ["earn", "bots", "agent", "instructions", "intent", "pilot", "autopilot", "guard", "learn", "launched", "new-launches"];
  assert.deepEqual(frameLayers(seen), seen.map((id) => FRAME + id));
});

test("a window a named layer closes does not stand on Back twice", () => {
  assert.deepEqual(frameLayers(["predict", "money", "chart", "exchange", "swap", "spot", "scouts", "partners", "partners-landing", "berth", "garage", "guides", "settings", "page-privacy"]), []);
});

test("a window that comes tomorrow is on Back without anyone adding it", () => {
  assert.deepEqual(frameLayers(["tomorrow"]), ["frame:tomorrow"]);
});

test("a frame layer says its window; any other layer is none", () => {
  assert.equal(frameWindow("frame:earn"), "earn");
  assert.equal(frameWindow("tower"), null);
  assert.equal(frameWindow("panel:search"), null);
});

test("every window the city opens in the frame is either named or covered", () => {
  const ids = new Set();
  for (const file of walk(components)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("useCityWindow(")) continue;
    for (const match of text.matchAll(/\bid: '([a-z-]+)'/g)) ids.add(match[1]);
  }
  assert.ok(ids.has("earn") && ids.has("bots") && ids.has("pilot"), "the windows are found");
  // Named or not, none falls through: each is either a frame layer or one `useBackLayers.ts` closes by its store.
  const hook = readFileSync(new URL("../../components/hud/useBackLayers.ts", import.meta.url), "utf8");
  for (const id of ids) {
    if (frameLayers([id]).length) continue;
    const owner = { swap: "trade", spot: "trade", "partners-landing": "partners" }[id] ?? id;
    assert.match(hook, new RegExp(`^  ${owner}: \\(\\) =>`, "m"), `${id} is closed by a named layer`);
  }
});

test("the hook reads the frame and closes its windows as the frame's own Close does", () => {
  const hook = readFileSync(new URL("../../components/hud/useBackLayers.ts", import.meta.url), "utf8");
  assert.match(hook, /frameLayers\(useWindows\.getState\(\)\.layout\.windows\.map\(\(w\) => w\.id\)\)/);
  assert.match(hook, /useWindows\.getState\(\)\.dismiss\(framed\)/);
});
