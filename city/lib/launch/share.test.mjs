/**
 * CITY-232 · the devnet pass of the launch's doors (review 8.11): the owner's steps name every switch the stand's
 * doors read, so a pass on the stand never misses «Share earnings» behind a closed switch.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shareOpen } from "./share.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** The switch a door's file reads, by the name the deployment sets: `process.env.<NAME> === 'open'`. */
const switchOf = (path) => {
  const found = [...read(path).matchAll(/process\.env\.(NEXT_PUBLIC_RYNTRA_CITY_\w+) === 'open'/g)].map((m) => m[1]);
  assert.equal(found.length, 1, `${path}: one switch`);
  return found[0];
};

test("the devnet pass names the switches the stand's doors read: «Share earnings» and early access", () => {
  const report = read("docs/research/city-220-launch-doors/REPORT.md");
  const steps = report.slice(report.indexOf("## 6."), report.indexOf("## 7."));
  const pass = steps.slice(steps.indexOf("2. **"), steps.indexOf("3. **"));
  assert.ok(pass.includes("devnet"), "the pass is the second step");
  const share = switchOf("city/lib/launch/share.ts");
  assert.equal(share, "NEXT_PUBLIC_RYNTRA_CITY_SHARE");
  assert.ok(pass.includes(`\`${share}=open\``), "the share door's switch is in the devnet pass");
  const early = switchOf("city/lib/launch/early.ts");
  assert.ok(pass.includes(`\`${early}=open\``), "the early door's switch is in the devnet pass");
});

test("on the stand the share door shows only with its switch open", () => {
  assert.equal(shareOpen("solana:devnet", false, false), false, "devnet without the switch: no door");
  assert.equal(shareOpen("solana:devnet", false, true), true, "devnet with the switch: the door");
});
