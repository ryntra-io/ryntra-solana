import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The windows in the one frame (CITY-65): the chart (CITY-5a), the Exchange (CITY-5d) and Money (CITY-63) open in the
// city's frame, with no frame of their own beside it; a signature holds the frame; Escape gives the whole screen back
// first and closes one window per press.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const WINDOWS = [
  { id: "chart", layer: "city/components/chart/ChartLayer.tsx", body: "city/components/chart/ChartWindow.tsx", title: "Chart" },
  { id: "exchange", layer: "city/components/exchange/ExchangeLayer.tsx", body: "city/components/exchange/ExchangeWindow.tsx", title: "Exchange" },
  { id: "money", layer: "city/components/money/MoneyLayer.tsx", body: "city/components/money/MoneyWindow.tsx", title: "Money" },
];

test("each window opens in the city's one frame, under its own id and title", () => {
  for (const w of WINDOWS) {
    const layer = read(w.layer);
    assert.match(layer, /import \{ useCityWindow \} from '\.\.\/window\/useCityWindow';/, w.layer);
    // The title comes from the district's words (CITY-79): its English half names the window as before.
    assert.match(layer, new RegExp(`id: '${w.id}',\\s*title[,\\s]`), w.layer);
    const key = layer.match(/const title = w\.(\w+);/)?.[1];
    assert.ok(key, `${w.layer}: the title from the words`);
    assert.match(read(w.layer.replace(/[^/]+$/, "words.ts")), new RegExp(`\\b${key}: '${w.title}'`), w.layer);
    assert.match(layer, /useCityWindow\(/, w.layer);
  }
});

test("no window keeps a frame of its own: no dragging, stretching, place or close button beside the frame's", () => {
  for (const w of WINDOWS) {
    const body = read(w.body);
    assert.doesNotMatch(body, /setPointerCapture|addEventListener\('pointermove'/, `${w.body}: moves by itself`);
    assert.doesNotMatch(body, /localStorage/, `${w.body}: a place of its own`);
    assert.doesNotMatch(body, /aria-label="Close/, `${w.body}: a close of its own`);
    assert.doesNotMatch(body, /role="dialog"/, `${w.body}: the frame is the dialog`);
  }
});

test("a signature in the wallet holds the frame: «Close» waits while money is mid-way", () => {
  const exchange = read("city/components/exchange/ExchangeLayer.tsx");
  assert.match(exchange, /const held = LOCKED\.has\(phase\);/);
  assert.match(exchange, /held,\s*onClose: hideExchange/);
  const money = read("city/components/money/MoneyLayer.tsx");
  assert.match(money, /held: busy,/);
  // Mid-way the window stays on screen through a run or a clip being filmed.
  assert.match(money, /const shown = open && \(!\(running \|\| filming\) \|\| busy\);/);
  assert.match(money, /useCityWindow\(shown, spec\)/);
  assert.match(exchange, /const shown = open && \(!\(running \|\| building\) \|\| LOCKED\.has\(phase\)\);/);
  // The owners' own closes still refuse while money is mid-way.
  assert.match(read("city/lib/money/open.ts"), /close: \(\) => \(get\(\)\.busy \? undefined : set\(\{ open: false \}\)\)/);
});

test("Escape: the whole screen given back first and marked as taken; every other Escape reads the mark", () => {
  const layer = read("city/components/window/WindowLayer.tsx");
  assert.match(layer, /event\.preventDefault\(\);\n\s*exitFull\(\);/);
  assert.match(layer, /window\.addEventListener\('keydown', onKey, true\)/, "heard before the windows' own");
  for (const path of ["city/components/money/MoneyLayer.tsx", "city/components/chart/ChartLayer.tsx", "city/components/exchange/ExchangeLayer.tsx", "city/components/hud/Hud.tsx"]) {
    assert.match(read(path), /event\.key !== 'Escape' \|\| event\.defaultPrevented/, path);
  }
});

test("the frame follows a window's data without bringing it forward", () => {
  const hook = read("city/components/window/useCityWindow.ts");
  assert.match(hook, /openWindow\(latest\.current\)/);
  assert.match(hook, /return \(\) => closeWindow\(id\)/);
  assert.match(hook, /if \(shown\) updateWindow\(spec\)/);
});

test("onto another screen (CITY-75): the chart and the Exchange say how; the frame's quiet button, never on a phone", () => {
  assert.match(read("city/components/chart/ChartLayer.tsx"), /detach: towerId \? \{ tower: towerId \} : undefined/);
  assert.match(read("city/components/exchange/ExchangeLayer.tsx"), /detach: \(symbol \? \{ symbol \} : \{\}\) as Params/);
  const frame = read("city/components/window/WindowFrame.tsx");
  assert.match(frame, /spec\.detach && !app && canGoOut\(\)/);
  // The button's words live in the frame's dictionary (CITY-79).
  assert.match(frame, /aria-label=\{w\.goOut\}/);
  assert.match(read("city/components/window/words.ts"), /goOut: 'Open in a new window'/);
  assert.doesNotMatch(read("city/components/window/WindowSheet.tsx"), /goOut|Open in a new window/, "the phone's sheet has no way out");
  // A chart out there stays when the tower card closes; home leaves the Exchange out there.
  assert.match(read("city/components/chart/ChartLayer.tsx"), /else if \(!useWindows\.getState\(\)\.out\.chart\) chart\.close\(\);/);
  assert.match(read("city/components/exchange/ExchangeLayer.tsx"), /useWindows\.getState\(\)\.out\.exchange\) return;/);
  // Reads keep running while a window out in Picture-in-Picture is seen.
  assert.match(read("city/lib/chart/use-chart.ts"), /const visible = \(\) => cityInView\(\);/);
  assert.match(read("city/components/exchange/ExchangeLayer.tsx"), /const visible = \(\) => cityInView\(\);/);
  // The page of one window draws no city.
  const page = read("city/components/window/OutPage.tsx");
  assert.doesNotMatch(page, /CityCanvas|CityScene/);
  assert.match(read("app/window/page.tsx"), /robots: \{ index: false, follow: false \}/);
});

test("a window on its own page keeps the city's switches and its signature; the city reads nothing twice", () => {
  const page = read("city/components/window/OutPage.tsx");
  // The Exchange's page exists only where the city has the Exchange; a closed switch sends the address to the city.
  assert.match(page, /\.\.\.\(EXCHANGE_SHOWN \? \{ exchange:/);
  assert.match(read("city/components/exchange/ExchangeLayer.tsx"), /if \(!EXCHANGE_SHOWN\) return null;/);
  // Neither Money nor Launch lives there.
  assert.doesNotMatch(page, /MoneyLayer|Launch/);
  // Only a page the city opened is a window; it lets go of the city's page at once.
  assert.match(page, /fromCity\(\) \? parseDetachUrl/);
  assert.match(page, /window\.opener = null/);
  // «Back» waits while a signature is out, there and in the city's tray.
  assert.match(page, /if \(held\.current\) returnAsked\.current = true;/);
  assert.match(read("city/components/window/OutWindow.tsx"), /disabled=\{Boolean\(spec\.held\)\}/);
  assert.match(read("city/components/window/OutWindow.tsx"), /disabled=\{Boolean\(specs\[id\]!\.held\)\}/);
  // The Exchange out on its own page reads there; the city's copy waits.
  const exchange = read("city/components/exchange/ExchangeLayer.tsx");
  assert.match(exchange, /const reading = shown && !away;/);
  assert.doesNotMatch(exchange, /useEvery\(shown/);
  // A window out is not over the city: the HUD's pieces stay.
  const hud = read("city/components/hud/useWindowOpen.ts");
  assert.match(hud, /chart: \{ mint: chartOut \? null : chart \}/);
  assert.match(hud, /exchange: \{ open: exchange && !exchangeOut \}/);
});

// ---------- CITY-84: the bays, the tray, the layouts, the city behind the windows ----------

test("behind both bays (or one window on the whole screen) the city is drawn lean, and its frame rate then moves no rung", () => {
  const canvas = read("city/components/city/CityCanvas.tsx");
  assert.match(canvas, /const lean = useWindows\(\(st\) => st\.desk && leanIn\(settledLayout\(st\)\)\);/);
  assert.match(canvas, /const dpr = lean \? Math\.min\(1, dprAt\(rung, device\.screen\)\) : dprAt\(rung, device\.screen\);/);
  assert.match(canvas, /if \(leanNow\(\)\) return;/, "the monitor's verdicts wait while the city is drawn lean");
  assert.match(canvas, /<Pacer on=\{warm\} lean=\{lean\} \/>/);
  const pacer = read("city/components/city/Pacer.tsx");
  assert.match(pacer, /const LEAN_FPS = 30;/);
  assert.match(pacer, /if \(leanNow\.current && t - drawn < 1000 \/ LEAN_FPS - 4\) return;/);
  // The shade over the city sits under the HUD (z-index 10): the top bar and the Deck stay bright.
  const css = read("city/components/window/window.module.css");
  assert.match(css, /\.dim \{\n  position: fixed;\n  inset: 0;\n  z-index: 9;\n  pointer-events: none;/);
  assert.match(read("city/components/hud/hud.module.css"), /\.layer \{[^}]*z-index: 10;/);
  const layer = read("city/components/window/WindowLayer.tsx");
  assert.match(layer, /bothBaysIn\(settledLayout\(st\)\)/);
  for (const part of ["<CityDim />", "<Tray />", "<Layouts />", "<Landing />"]) assert.ok(layer.includes(part), part);
});

test("minimise waits on a signature, on the computer and on the phone, and folds only a window the city can open again", () => {
  const frame = read("city/components/window/WindowFrame.tsx");
  assert.match(frame, /const fold = canOpen\(id\) \? \(/);
  assert.match(frame, /aria-label=\{w\.fold\} title=\{w\.fold\} disabled=\{spec\.held\} onClick=\{\(\) => foldWindow\(id\)\}/);
  const sheet = read("city/components/window/WindowSheet.tsx");
  assert.match(sheet, /\{canOpen\(active\.id\) && \(/);
  assert.match(sheet, /aria-label=\{words\.fold\} disabled=\{spec\.held\} onClick=\{\(\) => foldWindow\(active\.id\)\}/);
  // Folding closes the window as its own «Close» does: its owner hears of it, nothing of it stays over the city.
  const store = read("city/lib/window/store.ts");
  assert.match(store, /if \(!spec \|\| spec\.held \|\| !placed\(now\.layout, id\)\) return;/);
  assert.match(store, /get\(\)\.close\(id\);\n      spec\.onClose\?\.\(\);\n    \},\n    dropChip/);
  // A tab out of sight keeps its frame, inert, so what was typed is still there.
  assert.match(frame, /inert=\{hidden \|\| undefined\}/);
  // The tray steps aside while the Deck's doors are open over it.
  assert.match(read("city/components/window/Tray.tsx"), /const doors = useBackPanels\(\(st\) => st\.open\.includes\('tray'\)\);/);
});

test("the layouts open each window through its own owner, behind its own switch, and never sign or move money", () => {
  const openers = read("city/components/window/openers.ts");
  for (const id of ["spot", "money", "chart", "exchange", "predict"]) assert.match(openers, new RegExp(`\\n  ${id}: \\{`), id);
  assert.match(openers, /exchange: \{\n    can: \(\) => EXCHANGE_OPEN,/);
  // The trade card held out of sight behind the chart goes when a layout has no trade window (it would come back).
  assert.match(openers, /if \(wanted\.has\('swap'\) \|\| wanted\.has\('spot'\)\) shut\.delete\(tradeShut\);/);
  assert.match(read("city/components/window/Layouts.tsx"), /shutOutside\(wantedBy\(key\)\);\n  for \(const p of useWindows\.getState\(\)\.applyDesk\(key, canOpen\)\.later\)/);
  // A saved id that is a name on every object («constructor») is no window: only the openers' own keys count.
  assert.match(openers, /Object\.hasOwn\(OPENERS, id\)/);
  assert.match(openers, /predict: \{ can: \(\) => PREDICT_OPEN,/);
  assert.match(openers, /swap: \{ can: \(\) => TRADE_OPEN,/);
  // Nothing it imports signs, submits or reads the wallet.
  for (const from of openers.matchAll(/from '([^']+)'/g)) assert.doesNotMatch(from[1], /sign|submit|send|wallet|solana/i, from[1]);
  assert.doesNotMatch(openers, /\.(sign|submit|prepare|buy|sell)\(/);
  // Never through the coin's link, which lets the picked tower — and its chart — go.
  assert.doesNotMatch(openers, /openTradeCard/);
});

test("a folded trade card comes back on its own coin, through the Launch engine when it is a launch's", () => {
  const openers = read("city/components/window/openers.ts");
  // The chip keeps the coin and whether it trades through the Launch engine.
  assert.match(openers, /return \{ tower: tower\.mint, symbol: tower\.symbol, \.\.\.\(launch \? \{ launch: '1' \} : \{\}\) \};/);
  // Reopened on that coin — any tower in the city, named or not, or the coin itself — with its Launch flag.
  assert.match(openers, /const standing = mint \? \(useCity\.getState\(\)\.layout\.towers\.find\(\(t\) => t\.tower\.id === mint\)\?\.tower \?\? null\) : null;/);
  assert.match(openers, /const launch = params\?\.launch === '1' \|\| launchTowerIn\(useLaunch\.getState\(\), coin\.id\) !== null;/);
  assert.match(openers, /trade\.openFor\(coin, 'buy', \{ view, launch \}\);/);
  // A preset's chart and Exchange open on the coin in front of the person, taken before the card lets it go.
  assert.match(read("city/components/window/Layouts.tsx"), /const subject = layoutSubject\(\);\n  shutOutside\(wantedBy\(key\)\);/);
  // «Snap together» shows only where the city has room to spare.
  assert.match(read("city/components/window/WindowLayer.tsx"), /togetherIn\(st\.layout\) \|\| gridRoomIn\(st\.layout\) === null/);
});

test("what the window layer draws on the first paint is the same on the server and on a phone: the layouts wait for the page", () => {
  const layouts = read("city/components/window/Layouts.tsx");
  assert.match(layouts, /useEffect\(\(\) => setMounted\(true\), \[\]\);/);
  assert.match(layouts, /if \(!desk \|\| !mounted\) return null;/);
  // The tray has nothing before a window folds; the shade starts off.
  assert.match(read("city/components/window/Tray.tsx"), /if \(!chips\.length \|\| away \|\| doors\) return null;/);
});
