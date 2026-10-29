import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Predictions in the city lead nowhere out of it: no link to the old cabinet or to predict.ryntra.io, no navigation, no
// import of the frozen screens. The window reaches money only through the engine's own routes, from one module.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const components = path.resolve(here, "../../../components/districts");

const sources = [
  ...readdirSync(here)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => path.join(here, f)),
  ...readdirSync(components)
    .filter((f) => /^(Predict\w*\.tsx|predict[\w.]*\.(ts|tsx|css))$/.test(f))
    .map((f) => path.join(components, f)),
];

test("the window's code holds no way to the old cabinet or to predict.ryntra.io", () => {
  assert.ok(sources.some((f) => f.endsWith("PredictWindow.tsx")) && sources.some((f) => f.endsWith("store.ts")) && sources.some((f) => f.endsWith("predict.module.css")), "the sources are found");
  for (const file of sources) {
    const code = readFileSync(file, "utf8");
    const name = path.relative(root, file);
    assert.doesNotMatch(code, /predict(-[a-z0-9]+)?\.ryntra\.io|app\.ryntra\.io/i, `${name}: no host of the old Predictions`);
    assert.doesNotMatch(code, /["'`]\/app\/|\/solana\/workspace/, `${name}: no route of the old cabinet`);
    assert.doesNotMatch(code, /RYNTRA_PREDICT_URL|predictUrl|PREDICT_ORIGIN|predict-host/, `${name}: no way to name one`);
    assert.doesNotMatch(code, /router\.push|location\.(href|assign|replace)\s*=|location\.(assign|replace)\(|window\.open\(/, `${name}: no navigation`);
    assert.doesNotMatch(code, /from ['"][^'"]*(app\/app|app\/solana|\/components\/(?!districts|hud))[^'"]*['"]/, `${name}: nothing of the frozen screens`);
    // The one link the window has is a wallet's own download, for a browser without one.
    for (const href of code.matchAll(/href=\{([^}]+)\}|href="([^"]+)"/g)) {
      assert.match(href[1] ?? href[2], /phantomBrowseUrl|PHANTOM_DOWNLOAD_URL/, `${name}: a link that is not the wallet's download`);
    }
  }
  assert.equal(existsSync(path.resolve(here, "../oracle")), false, "the paper Oracle's list over the city is gone");
});

test("only the engine module asks the network, and only Predictions' own routes", () => {
  for (const file of sources) {
    const code = readFileSync(file, "utf8");
    const name = path.relative(root, file);
    if (file.endsWith("engine.ts")) {
      const urls = [...code.matchAll(/[`'"](\/api\/[^`'"?$]*)/g)].map((m) => m[1]);
      assert.ok(urls.length >= 10, "the engine names its routes");
      for (const url of urls) assert.match(url, /^\/api\/predictions\//, `${url}: Predictions' own route`);
      continue;
    }
    assert.doesNotMatch(code, /\bfetch\(/, `${name}: no fetch outside the engine module`);
  }
});

test("the window stands in the city's one frame (CITY-65), held while real money is on its way, and counts as open", () => {
  const layer = readFileSync(path.join(components, "PredictLayer.tsx"), "utf8");
  assert.match(layer, /import \{ useCityWindow \} from '\.\.\/window\/useCityWindow';/);
  assert.match(layer, /id: 'predict', title, icon: <PredictGlyph \/>/);
  assert.match(layer, /held, onClose: closePredict/);
  assert.match(layer, /useCityWindow\(open && \(!running \|\| held\), spec\)/, "a run never hides money on its way");
  assert.equal(existsSync(path.join(components, "PredictFrame.tsx")), false, "no frame of its own beside the city's");
  const body = readFileSync(path.join(components, "PredictWindow.tsx"), "utf8");
  assert.doesNotMatch(body, /aria-label="Close"|role="dialog"|setPointerCapture/, "the frame closes, is the dialog and moves");
  const windows = readFileSync(path.resolve(here, "../../city/windows.ts"), "utf8");
  assert.match(windows, /predict: \(s\) => !!s\.predict\?\.open/, "the home's feed, banners and hint give way while it is open");
  const open = readFileSync(path.resolve(components, "../hud/useWindowOpen.ts"), "utf8");
  assert.match(open, /usePredict\(\(st\) => st\.open\)/);
});

test("the real switch is read in one place, and the window opens in Practice", () => {
  const flag = readFileSync(path.join(here, "flag.ts"), "utf8");
  assert.match(flag, /process\.env\.NEXT_PUBLIC_RYNTRA_CITY_PREDICT_REAL/);
  for (const file of sources) {
    if (file.endsWith("flag.ts")) continue;
    assert.doesNotMatch(readFileSync(file, "utf8"), /NEXT_PUBLIC_RYNTRA_CITY_PREDICT_REAL/, `${path.relative(root, file)} reads the flag module, not the variable`);
  }
  const store = readFileSync(path.join(here, "store.ts"), "utf8");
  assert.match(store, /mode: 'practice',/, "Practice is where the window starts");
  const head = readFileSync(path.join(components, "PredictWindow.tsx"), "utf8");
  assert.match(head, /PREDICT_REAL \? <ModeSwitch \/> : null/, "the switch to Real is drawn only where real money is open");
});
