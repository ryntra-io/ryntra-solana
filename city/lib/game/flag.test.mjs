import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { playOpen } from "./flag.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Play's switch and dock stand only where its flag says `open` (decision 86: one menu of seven places)", () => {
  assert.equal(playOpen("open"), true);
  for (const value of [undefined, "", "closed", "OPEN", "true"]) assert.equal(playOpen(value), false, String(value));
  // Without it: the brand alone, the Deck in Play's places too, and home is the City.
  assert.match(read("../../components/game/LayerSwitch.tsx"), /if \(!PLAY_OPEN\) return children;/);
  const hud = read("../../components/hud/Hud.tsx");
  assert.match(hud, /const playDock = play && PLAY_OPEN;/);
  assert.match(hud, /\{playDock && <GameDock/);
  // Launch Night's stage (CITY-146) takes the bottom of the screen only while its show plays.
  assert.match(hud, /\{!playDock && !launch\.showing && !nightPlaying && \(/);
  assert.match(hud, /if \(!PLAY_OPEN\) useLayer\.getState\(\)\.set\('city'\);/);
});
