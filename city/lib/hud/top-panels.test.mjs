// Run from repo root: node --test city/lib/hud/top-panels.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { topPanelTakesEscape, WALLET_PANEL, walletPanelOpen } from "./top-panels.ts";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* CITY-240: Escape with a panel of the top bar open over a window closed more than the panel. With «Events» open over
   the Ring's making screen the screen closed, and the draft with it — its listener hears the key before the panel's;
   the same on a bot's page. With the wallet's panel over the Ring or the Vault, the panel and the window went together. */

const el = (inside) => ({ closest: (selector) => (selector === "[data-feed-bell], #city-feed" && inside ? {} : null) });
const body = el(false);
const page = ({ focus = body, wallet = false, modal = false } = {}) => ({
  body,
  activeElement: focus,
  querySelector: (selector) => ((selector === WALLET_PANEL && wallet) || (selector === '[aria-modal="true"]' && modal) ? {} : null),
});

test("the wallet's panel takes Escape whenever it is open, whatever holds the keyboard", () => {
  assert.equal(walletPanelOpen(page({ wallet: true })), true);
  assert.equal(walletPanelOpen(page()), false);
  assert.equal(topPanelTakesEscape(false, page({ wallet: true })), true);
  assert.equal(topPanelTakesEscape(false, page({ wallet: true, focus: el(false) })), true, "the keyboard in the script's field under it");
  assert.equal(topPanelTakesEscape(false, page({ wallet: true, modal: true })), true);
});

test("the events' panel takes it by its own rule; with neither open a window's Escape is its own", () => {
  assert.equal(topPanelTakesEscape(true, page()), true);
  assert.equal(topPanelTakesEscape(true, page({ focus: el(true) })), true, "the bell, or a control inside the panel");
  assert.equal(topPanelTakesEscape(true, page({ focus: el(false) })), false, "the keyboard is elsewhere: that field's Escape");
  assert.equal(topPanelTakesEscape(true, page({ modal: true })), false);
  assert.equal(topPanelTakesEscape(false, page()), false);
  assert.equal(topPanelTakesEscape(false, page({ focus: el(false) })), false);
});

test("the Ring's making screen and a bot's page stand down for a panel of the top bar", () => {
  const guard = "if (topPanelTakesEscape(useFeedPanel.getState().open, document)) return;";
  const editor = read("../../components/ring/RingEditor.tsx");
  const at = editor.indexOf(guard);
  assert.ok(at > 0 && at < editor.indexOf("ringStore.getState().closeEditor();"), "asked before the screen closes");
  assert.ok(at < editor.indexOf("event.preventDefault();"), "and before the press is marked as taken: the panel's own listener still hears it");
  const bots = read("../../components/bots/BotsWindow.tsx");
  const bot = bots.indexOf(guard);
  assert.ok(bot > 0 && bot < bots.indexOf("useBots.getState().back();"), "asked before the page steps back");
  assert.ok(bot < bots.indexOf("event.preventDefault();\n      useBots.getState().back();"));
});

test("the wallet's panel hears Escape first and marks it taken: the window under it waits for the next press", () => {
  const chip = read("../../components/quarter/WalletChip.tsx");
  // Heard on the way down, and marked: the Ring's window, the Vault's room and every other window of the city read
  // `defaultPrevented` in their own listeners and close nothing with this press.
  assert.match(chip, /const key = \(event: KeyboardEvent\) => \{\s+if \(event\.key !== 'Escape'\) return;\s+event\.preventDefault\(\);\s+event\.stopImmediatePropagation\(\);\s+close\(\);\s+\};/u);
  assert.match(chip, /window\.addEventListener\('keydown', key, true\);/u);
  assert.match(chip, /window\.removeEventListener\('keydown', key, true\);/u);
  assert.match(chip, /data-wallet-menu=""/u, "the mark the rule looks for");
  assert.match(read("../../components/ring/duel/DuelsLayer.tsx"), /if \(event\.key !== 'Escape' \|\| event\.defaultPrevented\) return;\s+arenaStore\.getState\(\)\.close\(\);/u);
  assert.match(read("../../components/vault/VaultLayer.tsx"), /if \(event\.key === 'Escape' && !event\.defaultPrevented\) leave\(\);/u);
  // «Back» is as it was: the panel is one layer of its own (CITY-150).
  assert.match(chip, /useBackPanel\('wallet', showing, close\);/u);
});
