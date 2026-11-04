import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WINDOWS } from "../city/windows.ts";

// CITY-6e in the city: the stack (`stack.ts`) is mounted once on the city's page, and every window the city knows,
// besides the tower's card, your quarter, the run, the «While you were away» reel and a window on the whole screen, is a
// layer «Back» closes.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const hook = read("../../components/hud/useBackLayers.ts");

test("the city's page mounts the stack once", () => {
  const app = read("../../components/CityApp.tsx");
  assert.match(app, /^import \{ useBackLayers \} from '\.\/hud\/useBackLayers';$/m);
  assert.equal(app.match(/useBackLayers\(\);/g)?.length, 1);
});

test("every window has its close, and the other layers are named", () => {
  for (const name of WINDOWS) assert.match(hook, new RegExp(`^  ${name}: \\(\\) =>`, "m"), `${name} closes on Back`);
  for (const id of ["play", "tower", "quarter", "run", "away", "predict-page", "full", "map", "feed"]) assert.match(hook, new RegExp(`id: '${id}'`), `${id} closes on Back`);
});

test("the stack follows every store a layer lives in", () => {
  const stores = hook.slice(hook.indexOf("const STORES"), hook.indexOf("];", hook.indexOf("const STORES")));
  for (const store of ["useLayer", "useGameMap", "useFeedPanel", "useBackPanels", "useCity", "quarterStore", "useRun", "awayStore", "useWindows", "usePredict", "useTrade", "useMoney", "useTowerChart", "useExchange", "useHarbor", "useMine", "useScouts", "usePartners", "vaultStore", "useHall", "useAgent", "useBeacons", "useAssistant", "howStore", "useMoments", "useLaunch", "freeStore", "useHudPanels"]) {
    assert.match(stores, new RegExp(`\\b${store}\\b`), `${store} is followed`);
  }
});

test("a window its frame holds (a signature, real money on its way) is not closed by Back", () => {
  const close = hook.slice(hook.indexOf("function close(id: string)"));
  const guard = close.indexOf("if (useWindows.getState().specs[id]?.held) return;");
  assert.ok(guard > 0, "the frame's hold is asked");
  assert.ok(guard < close.indexOf("CLOSE[id as WindowName]()"), "before any window's own close");
});

test("the panels with an «open» of their own stand on Back: the search, the wallet's menu, the Deck's tray (CITY-150)", () => {
  assert.match(read("../../components/search/CitySearch.tsx"), /useBackPanel\('search', open,/);
  assert.match(read("../../components/quarter/WalletChip.tsx"), /useBackPanel\('wallet', showing, close\)/);
  assert.match(read("../../components/deck/Deck.tsx"), /useBackPanel\('tray', tray !== null,/);
});
