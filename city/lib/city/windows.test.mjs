import assert from "node:assert/strict";
import test from "node:test";

import { openWindow, useHudPanels, windowOpen, WINDOWS } from "./windows.ts";

/* With a window open the feed, its gear and the moment banners piled up over it. One
   question — «a window is open» — for the feed, the banners, the hint and the card above the dock. */

const CLOSED = {
  predict: { open: false },
  trade: { open: false },
  money: { open: false },
  chart: { mint: null },
  exchange: { open: false },
  harbor: { open: false },
  mine: { open: false },
  scouts: { open: false },
  vault: { open: false },
  hall: { panel: false },
  agent: { panel: "none" },
  assistant: { open: false },
  how: { open: false },
  moments: { sheet: null },
  launch: { sheet: false },
  hud: { menu: false, settings: false },
};

test("a clear city has no window open, and a store not given counts as closed", () => {
  assert.equal(openWindow(CLOSED), null);
  assert.equal(windowOpen(CLOSED), false);
  assert.equal(windowOpen({}), false);
});

test("each window, open alone, is named", () => {
  const open = {
    predict: { predict: { open: true } },
    trade: { trade: { open: true } },
    money: { money: { open: true } },
    chart: { chart: { mint: "So11111111111111111111111111111111111111112" } },
    exchange: { exchange: { open: true } },
    harbor: { harbor: { open: true } },
    mine: { mine: { open: true } },
    scouts: { scouts: { open: true } },
    vault: { vault: { open: true } },
    hall: { hall: { panel: true } },
    agent: { agent: { panel: "rule" } },
    beacon: { beacon: { openFor: "So11111111111111111111111111111111111111112" } },
    assistant: { assistant: { open: true } },
    how: { how: { open: true } },
    moments: { moments: { sheet: { kind: "share" } } },
    launch: { launch: { sheet: true } },
    build: { build: { on: true } },
    menu: { hud: { menu: true, settings: false } },
    settings: { hud: { menu: false, settings: true } },
  };
  assert.deepEqual(Object.keys(open).sort(), [...WINDOWS].sort(), "every window the selector knows is checked");
  for (const [name, src] of Object.entries(open)) {
    assert.equal(openWindow({ ...CLOSED, ...src }), name, name);
    assert.equal(windowOpen({ ...CLOSED, ...src }), true, name);
  }
});

test("the agent's closed panel, an empty chart and no moments sheet are not windows", () => {
  assert.equal(windowOpen({ agent: { panel: "none" }, chart: { mint: null }, moments: { sheet: null } }), false);
  assert.equal(windowOpen({ agent: { panel: "status" } }), true);
});

test("the HUD's menu and its settings: one at a time, and both close together", () => {
  useHudPanels.setState({ menu: false, settings: false });
  useHudPanels.getState().toggleMenu();
  assert.deepEqual([useHudPanels.getState().menu, useHudPanels.getState().settings], [true, false]);
  useHudPanels.getState().openSettings();
  assert.deepEqual([useHudPanels.getState().menu, useHudPanels.getState().settings], [false, true], "Settings takes the menu's place");
  assert.equal(openWindow({ hud: useHudPanels.getState() }), "settings");
  useHudPanels.getState().toggleMenu();
  assert.deepEqual([useHudPanels.getState().menu, useHudPanels.getState().settings], [true, false], "the menu again closes Settings");
  useHudPanels.getState().closeMenu();
  assert.equal(windowOpen({ hud: useHudPanels.getState() }), false);
});
