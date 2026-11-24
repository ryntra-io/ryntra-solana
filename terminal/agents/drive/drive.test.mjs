import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DRIVE } from "./words.ts";

/* The agent's drive on screen: «Stop» is the person's own switch, proven by one signed message and never a
   transaction; one amber action per screen; the week stands under her bots; the pages answer only with the terminal. */

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|(^|[^:])\/\/.*$/gm, "$1");

test("both halves of the drive's words alike, and none of them a promise", () => {
  assert.deepEqual(Object.keys(DRIVE.uk).sort(), Object.keys(DRIVE.en).sort());
  for (const lang of ["en", "uk"]) {
    for (const [key, value] of Object.entries(DRIVE[lang])) {
      const said = typeof value === "string" ? value : value("JUP", "×1.24");
      assert.doesNotMatch(said, /profit|guarantee|x1000|100x|прибуток|гарант|!/i, `${lang}.${key}: «${said}»`);
    }
  }
});

test("«Stop» freezes the agent through the person's own switch: one signed message, never a transaction or a key", () => {
  const pulse = code("terminal/agents/drive/PulseScreen.tsx");
  assert.match(pulse, /tapFreeze\(\{ wallet: connection\.wallet, owner: connection\.address \}, record, !frozen\)/u);
  assert.doesNotMatch(pulse, /signTransaction|signAllTransactions|sendTransaction|tapStop/u, "no transaction from this page");
  for (const path of ["terminal/agents/drive/DriveSettings.tsx", "terminal/agents/drive/read.ts", "terminal/agents/drive/push.ts", "terminal/agents/drive/DriveWeek.tsx", "terminal/agents/drive/XScreen.tsx"]) {
    assert.doesNotMatch(code(path), /signTransaction|signAllTransactions|sendTransaction|secretKey|privateKey/u, path);
  }
});

test("one amber action on each screen: «Stop» or «Resume», «Connect wallet», «Try your own agent»", () => {
  const pulse = code("terminal/agents/drive/PulseScreen.tsx");
  assert.equal((pulse.match(/<Action[\s>]/g) ?? []).length, 3, "the agent's action, «Connect wallet» without a wallet, or «Show my agents» where the engine wants this device's proof — one branch each, never two");
  assert.equal((code("terminal/agents/drive/XScreen.tsx").match(/<Action[\s>]/g) ?? []).length, 1);
  assert.equal((code("terminal/agents/drive/DriveWeek.tsx").match(/<Action[\s>]/g) ?? []).length, 0, "the week under the bots leaves the bot's own action alone");
  assert.equal((code("terminal/agents/drive/DriveSettings.tsx").match(/<Action[\s>]/g) ?? []).length, 0);
});

test("the week stands under the person's bots; the agent's page and the card's page answer only with the terminal", () => {
  const budget = code("terminal/bots/Budget.tsx");
  assert.match(budget, /<History views=\{data\.views\} past=\{data\.past\} \/> : null\}\s*<DriveWeek \/>/u);
  const week = code("terminal/agents/drive/DriveWeek.tsx");
  assert.match(week, /if \(!DRIVE_OPEN \|\| !owner/u, "nothing where the drive is not open, or without a wallet");
  for (const page of ["app/(terminal)/agent/pulse/page.tsx", "app/(terminal)/x/[id]/page.tsx"]) {
    const source = code(page);
    assert.match(source, /if \(!shelfOn\("agents"\)\) notFound\(\);/u, page);
    assert.match(source, /index: false/u, `${page}: a person's own page is never offered to the index`);
  }
  const x = code("app/(terminal)/x/[id]/page.tsx");
  assert.match(x, /card: "summary_large_image"/u);
  assert.match(x, /cardImage\(card\.id\)/u, "X shows the server's card");
});

test("the drive's notes open the agent's page, and «Share» goes through the kept card, never through words in an address", () => {
  const week = code("terminal/agents/drive/DriveWeek.tsx");
  assert.match(week, /window\.open\(`\/api\/v1\/agent-drive\/card\/\$\{id\}\/post\?l=\$\{lang\}`/u);
  const post = code("app/api/v1/agent-drive/card/[id]/post/route.ts");
  assert.match(post, /postUrl\(card, lang\)/u);
  assert.doesNotMatch(post, /searchParams\.get\("(text|x|entry|exit)"\)/u);
});
