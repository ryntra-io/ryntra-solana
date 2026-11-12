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

// CITY-236 (CITY-235's asks 1–2): the early launch's window stands on «Back», and «Back» from a step inside a window
// returns a step instead of closing the whole window.

test("the early launch's window is the launch's layer: asked, followed and closed as its own «Close»", () => {
  assert.match(read("../city/windows.ts"), /launch: \(s\) => !!s\.launch\?\.sheet \|\| s\.launch\?\.entry != null,/);
  assert.match(read("../../components/hud/useWindowOpen.ts"), /launch: \{ sheet: launch, entry \},/);
  const launch = hook.slice(hook.indexOf("  launch: () => {"), hook.indexOf("  build: () =>"));
  assert.match(launch, /if \(sheet\.sheet\) \{\s+if \(closable\(sheet\.phase\)\) sheet\.closeSheet\(\);\s+\} else if \(sheet\.entry && !sheet\.entryBusy\) sheet\.closeEntry\(\);/, "the sheet first, and it keeps its hold; the entry only when no sheet stands, never with a step of its own in the wallet");
  assert.match(read("../../components/launch/EarlyEntry.tsx"), /useLaunch\.setState\(\{ entryBusy: stepOut \}\);\s+return \(\) => useLaunch\.setState\(\{ entryBusy: false \}\);/, "the window says when a step is out, and takes it back when it goes");
});

test("the launch's review is a layer over the sheet: Back returns to the fields", () => {
  assert.match(hook, /\{ id: 'launch-review', open: \(\) => reviewStepOpen\(useLaunch\.getState\(\)\), close: \(\) => useLaunch\.getState\(\)\.setStep\('form'\) \},/);
  const above = hook.slice(hook.indexOf("const EXTRA_ABOVE"), hook.indexOf("];", hook.indexOf("const EXTRA_ABOVE")));
  assert.ok(above.includes("'launch-review'"), "over the windows, so it closes before the sheet does");
  // Escape on a desk steps the same way, before the sheet's own close.
  const hud = read("../../components/hud/Hud.tsx");
  // CITY-242: the sheet is a window of the frame; it hears Escape when it is the window in front, and takes the press.
  // Before the windows behind it — a trade card's own early stand-down waits for it — and the press is taken even
  // while a launch is under way, so nothing behind closes in its place.
  assert.match(hud, /const launchFront = framed && top\(layout\)\?\.id === 'launch';/);
  assert.ok(hud.indexOf("const launchFront") < hud.indexOf("if (!launchFront && (useTrade.getState().open"));
  assert.match(hud, /if \(launchFront\) \{\s+event\.preventDefault\(\);\s+if \(reviewStepOpen\(sheet\)\) return sheet\.setStep\('form'\);\s+if \(closable\(sheet\.phase\)\) sheet\.closeSheet\(\);\s+return;\s+\}/);
  // The Deck's open tray stands over the windows and takes its own Escape first.
  assert.ok(hud.indexOf("if (document.querySelector('[data-deck-tray]')) return;") < hud.indexOf("const launchFront"));
  assert.match(hud, /if \(sheet\.entry\) return sheet\.entryBusy \? undefined : sheet\.closeEntry\(\);/, "Escape closes the early window too, and waits under its signature");
});

test("the steps of the windows that load later stand on Back as panels: a bot's page, the Ring's new agent", () => {
  const bots = read("../../components/bots/BotsWindow.tsx");
  assert.match(bots, /useBackPanel\('bots-page', tab === 'launch' && paged, \(\) => useBots\.getState\(\)\.back\(\)\);/);
  const ring = read("../../components/ring/RingEditor.tsx");
  assert.match(ring, /useBackPanel\('ring-editor', editor !== null, \(\) => \{/);
  const back = ring.slice(ring.indexOf("useBackPanel('ring-editor'"), ring.indexOf("if (!editor) return null;"));
  assert.match(back, /if \(!now \|\| now\.saving\) return;/, "a save on its way is never closed away");
  assert.match(back, /if \(at > 0\) ring\.goTo\(STEPS\[at - 1\]!\);\s+else ring\.closeEditor\(\);/, "a step back first, the screen last");
});
