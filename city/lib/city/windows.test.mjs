import assert from "node:assert/strict";
import test from "node:test";

import { openWindow, openWindows, useHudPanels, windowOpen, WINDOWS } from "./windows.ts";

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
  berth: { open: false },
  agent: { panel: "none" },
  garage: { open: false },
  assistant: { open: false },
  how: { open: false },
  guides: { open: false },
  moments: { sheet: null },
  launch: { sheet: false },
  pages: { open: [] },
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
    partners: { partners: { open: true, landing: false } },
    vault: { vault: { open: true } },
    hall: { hall: { panel: true } },
    berth: { berth: { open: true } },
    agent: { agent: { panel: "rule" } },
    garage: { garage: { open: true } },
    beacon: { beacon: { openFor: "So11111111111111111111111111111111111111112" } },
    assistant: { assistant: { open: true } },
    how: { how: { open: true } },
    guides: { guides: { open: true } },
    moments: { moments: { sheet: { kind: "share" } } },
    launch: { launch: { sheet: true } },
    build: { build: { on: true } },
    pages: { pages: { open: ["help"] } },
    menu: { hud: { menu: true, settings: false } },
    settings: { hud: { menu: false, settings: true } },
  };
  assert.deepEqual(Object.keys(open).sort(), [...WINDOWS].sort(), "every window the selector knows is checked");
  for (const [name, src] of Object.entries(open)) {
    assert.equal(openWindow({ ...CLOSED, ...src }), name, name);
    assert.equal(windowOpen({ ...CLOSED, ...src }), true, name);
  }
});

test("the partners' landing counts as their window, closed or open", () => {
  assert.equal(openWindow({ partners: { open: false, landing: true } }), "partners");
  assert.equal(windowOpen({ partners: { open: false, landing: false } }), false);
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

test("every open window is named, in the order they are asked — the layers «Back» closes (CITY-6e)", () => {
  assert.deepEqual(openWindows(CLOSED), []);
  assert.deepEqual(openWindows({ ...CLOSED, hud: { menu: true, settings: false }, chart: { mint: "M" }, trade: { open: true } }), ["trade", "chart", "menu"]);
});

test("an early launch's window for its people is the launch's window too: the home gives way, «Back» closes it (CITY-236)", () => {
  const early = { ...CLOSED, launch: { sheet: false, entry: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" } };
  assert.equal(openWindow(early), "launch");
  assert.deepEqual(openWindows(early), ["launch"]);
  assert.equal(windowOpen({ ...CLOSED, launch: { sheet: false, entry: null } }), false);
  assert.equal(windowOpen({ ...CLOSED, launch: { sheet: false } }), false, "a source without the entry reads as before");
});
