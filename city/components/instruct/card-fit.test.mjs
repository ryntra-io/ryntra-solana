// CITY-201: the agent's card is one tight column. The window it stands in is taller than the card — a bay on a desk, the
// sheet on a phone — so nothing in the card may be pushed to the window's foot: that left a dark hole of 160–355 px
// between the plan and «Connect wallet». The walk that measures it on the rendered page: city/lib/autopilot/qa-walk-shots.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./instruct.module.css", import.meta.url), "utf8");

/** The declarations of one rule of the card's sheet, by its class. */
function rule(name) {
  const found = css.match(new RegExp(`(?:^|\\n)\\.${name}\\s*\\{([^}]*)\\}`));
  assert.ok(found, `.${name} is in instruct.module.css`);
  return found[1];
}

test("the dock follows the card straight on: no auto margin pushes it to the window's foot", () => {
  assert.doesNotMatch(rule("dock"), /margin(-top)?\s*:[^;]*auto/u);
});

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("both agent cards ask the frame to stand as tall as they are", () => {
  assert.match(read("./InstructLayer.tsx"), /id: 'agent',[^}]*\bfit: true\b/u);
  assert.match(read("../autopilot/AutopilotLayer.tsx"), /id: 'autopilot',[^}]*\bfit: true\b/u);
});

test("the frame honours `fit`: a ceiling instead of a height on a desk, the sheet's height as a ceiling on a phone", () => {
  const frame = read("../window/WindowFrame.tsx");
  assert.match(frame, /fit \? \{ maxHeight: rect\.height \} : \{ height: rect\.height \}/u);
  assert.match(frame, /const fit = Boolean\(spec\.fit\) && !full;/u, "the whole screen is never fitted");
  assert.match(read("../window/WindowSheet.tsx"), /full \? s\.sheetFull : spec\?\.fit \? s\.sheetFit : ''/u);
  const css = read("../window/window.module.css");
  assert.match(css, /\.fit \.panel \{[^}]*position: relative;[^}]*max-height: inherit;/u);
  assert.match(css, /\.sheetFit \{[^}]*height: auto;[^}]*max-height: min\(64dvh/u);
});

test("no block of the card is pushed apart from its neighbours", () => {
  for (const [, name, body] of css.matchAll(/(?:^|\n)\.([A-Za-z]+)\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(body, /margin-top\s*:\s*auto/u, `.${name} pushes itself to the foot of the window`);
  }
  assert.doesNotMatch(rule("body"), /justify-content\s*:\s*space-between/u);
});

test("Earn's «Mine» with no wallet and with nothing yet: the action follows its line, no spacer pushes it down", () => {
  const mine = read("../earn/Mine.tsx");
  for (const line of ["connectLine", "emptyLine"]) {
    assert.match(mine, new RegExp(`\\{w\\.${line}\\}</p>\\n\\s*<(Wallets|button)`, "u"), `«Mine» ${line}: straight on to the action`);
  }
});

test("the Guard stands as tall as it is: in the flow, and its window fits", () => {
  assert.match(read("../guard/GuardLayer.tsx"), /id: 'guard',[\s\S]*?\bfit: true,/u);
  const framed = read("../guard/guard.module.css").match(/\n\.framed \{([^}]*)\}/u)?.[1] ?? "";
  assert.match(framed, /position: relative;/u);
  assert.doesNotMatch(framed, /inset: 0/u, "an absolute box gives the fitted frame no height");
});
