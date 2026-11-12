// Run from repo root: node --test city/components/settings/tab-in-view.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/* CITY-237: on a phone the settings' sections are one row that scrolls sideways. A section opened from elsewhere —
   «Notifications» from the menu or the bell's gear — stood cut by the sheet's edge («Сповіще»); the open section's tab
   now comes into view whole. */
test("the open section's tab is brought into view in the row", () => {
  const win = readFileSync(new URL("./SettingsWindow.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(win, /<nav className=\{s\.rail\} aria-label=\{w\.sections\} ref=\{rail\}>/u);
  assert.match(win, /if \(row && tab && row\.scrollWidth > row\.clientWidth\) \{\n\s+const at = tab\.getBoundingClientRect\(\);\n\s+row\.scrollLeft \+= at\.left - row\.getBoundingClientRect\(\)\.left - \(row\.clientWidth - at\.width\) \/ 2;\n\s+\}\n  \}, \[section\]\);/u);
  // The row alone is moved: nothing here may scroll the window or the city's page with it.
  assert.doesNotMatch(win, /\.scrollIntoView\(/u);
});
