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
    assert.match(layer, new RegExp(`id: '${w.id}',\\s*title: '${w.title}'`), w.layer);
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
  assert.match(frame, /aria-label="Open in a new window"/);
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
  assert.match(page, /\.\.\.\(EXCHANGE_OPEN \? \{ exchange:/);
  assert.match(read("city/components/exchange/ExchangeLayer.tsx"), /if \(!EXCHANGE_OPEN\) return null;/);
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
