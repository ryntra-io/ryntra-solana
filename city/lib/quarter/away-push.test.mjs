// Run from repo root: node --test city/lib/quarter/away-push.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { AWAY_CHANNELS, awayChannels } = await import("./away-store.ts");
const { isRyntraApp } = await import("../app-mode.ts");

// CITY-6e: the Ryntra app 1.18.0 registers no push, so inside the app the city shows no «Push» switch; a browser keeps
// it as it was.

const APP = "Mozilla/5.0 (Linux; Android 14; Seeker) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36 RyntraApp/1.18.0";
const PHONE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36";

test("in the app the «While you were away» switches are Telegram only; in a browser Telegram and Push", () => {
  assert.deepEqual(awayChannels(isRyntraApp(APP)).map((c) => c.label), ["Telegram"]);
  assert.deepEqual(awayChannels(isRyntraApp(PHONE)).map((c) => c.label), ["Telegram", "Push"]);
  assert.deepEqual(awayChannels(false), AWAY_CHANNELS);
});

test("the reel's switches come from the app-aware list", () => {
  const reel = readFileSync(new URL("../../components/quarter/AwayReel.tsx", import.meta.url), "utf8");
  assert.match(reel, /const channels = awayChannels\(useRyntraApp\(\)\);/);
  assert.match(reel, /\{channels\.map\(\(c\) => \(/);
});

test("no other switch in the city offers push", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(root);
  // The push's name lives in the away reel's dictionary (CITY-79); only the reel's channel list reads it.
  const offering = files.filter((path) => /label: ['"]Push['"]|push: ['"]Push['"]|>\s*Push\s*</.test(readFileSync(path, "utf8")));
  assert.deepEqual(offering.map((path) => path.slice(root.length).replaceAll("\\", "/")), ["lib/quarter/words.ts"]);
  const readers = files.filter((path) => /AWAY_WORDS\)\.push\b/.test(readFileSync(path, "utf8")));
  assert.deepEqual(readers.map((path) => path.slice(root.length).replaceAll("\\", "/")), ["lib/quarter/away-store.ts"]);
});
