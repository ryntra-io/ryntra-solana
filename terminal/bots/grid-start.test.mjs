import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { pricesLive, startPrice, startStep, startsNow } from "./grid-start.ts";

/* Release check 19.11: in 2 of 6 loads «Grid» started at 0.334–0.408 over MET at 0.264 — the DLMM Pro pool (quoted in
   SOL) answered before the live market, and its price was turned into dollars at the bundled SOL ($101). The band starts
   on one named price, only once it is read; read again, it moves a band the person has not touched. */

const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const SOL_BUNDLED = 101.25;
const SOL_LIVE = 73;
const MET_IN_SOL = 0.264 / SOL_LIVE;

const base = { venue: null, venuesKnown: false, venuePrice: null, perQuote: null, quoteIsDollar: false, marketLive: false, coinUsd: null };

test("the start price: the venue's own price in dollars, only once its quote coin's dollars are live", () => {
  // The bundled first frame and the pool's answer: not read — never 0.371.
  assert.equal(startPrice({ ...base, venue: "pro", venuesKnown: true, venuePrice: MET_IN_SOL, perQuote: SOL_BUNDLED, marketLive: false, coinUsd: 0.312 }), null);
  // The live market: the pool's price at the live SOL.
  const live = startPrice({ ...base, venue: "pro", venuesKnown: true, venuePrice: MET_IN_SOL, perQuote: SOL_LIVE, marketLive: true, coinUsd: 0.265 });
  assert.ok(Math.abs(live - 0.264) < 1e-9);
  // A dollar-quoted pool needs no market read.
  assert.equal(startPrice({ ...base, venue: "pro", venuesKnown: true, venuePrice: 0.264, perQuote: 1, quoteIsDollar: true, marketLive: false }), 0.264);
  // The venue answered, its quote coin's dollars not known: not read.
  assert.equal(startPrice({ ...base, venue: "dlmm", venuesKnown: true, venuePrice: MET_IN_SOL, perQuote: null, marketLive: true }), null);
  // No venue yet, or the venues still reading: not read — the market's price is not the pool's.
  assert.equal(startPrice({ ...base, venuesKnown: false, marketLive: true, coinUsd: 0.264 }), null);
  // No venue takes the coin: the market's live price (a picture), never the bundled one.
  assert.equal(startPrice({ ...base, venuesKnown: true, marketLive: true, coinUsd: 0.264 }), 0.264);
  assert.equal(startPrice({ ...base, venuesKnown: true, marketLive: false, coinUsd: 0.312 }), null);
  assert.equal(startPrice({ ...base, venue: "pro", venuesKnown: true, venuePrice: 0, perQuote: SOL_LIVE, marketLive: true }), null);
});

test("the band starts on a price read, again when it is read anew and untouched, never over the person's own", () => {
  assert.equal(startsNow(null, MET, null, false), false, "nothing read: nothing started — the form reads");
  assert.equal(startsNow(null, MET, 0.264, false), true);
  const at = { mint: MET, usd: 0.264 };
  assert.equal(startsNow(at, MET, 0.2641, false), false, "the same price: the band stands");
  assert.equal(startsNow(at, MET, 0.27, false), true, "read again and moved: the untouched band follows");
  assert.equal(startsNow(at, MET, 0.27, true), false, "a band she touched stays hers");
  assert.equal(startsNow(at, "SOL", 73, true), true, "another coin starts again");
});

/** The screen's order of arrival, as the start rule sees it: each frame's inputs, and the band it leaves standing. */
function play(frames) {
  let started = null;
  let low = null;
  for (const frame of frames) {
    const usd = startPrice(frame);
    if (startsNow(started, MET, usd, false)) {
      started = { mint: MET, usd };
      low = usd * 0.9;
    }
  }
  return { started, low };
}

test("whatever answers first — the pool or the live market — the band stands around the price, never over it", () => {
  const bundled = { ...base, marketLive: false, perQuote: SOL_BUNDLED, coinUsd: 0.312 };
  const pool = { venue: "pro", venuesKnown: true, venuePrice: MET_IN_SOL };
  const live = { marketLive: true, perQuote: SOL_LIVE, coinUsd: 0.265 };
  const orders = {
    "pool, then the live market (the release's 2 of 6)": [bundled, { ...bundled, ...pool }, { ...bundled, ...pool, ...live }],
    "the live market, then the pool": [bundled, { ...bundled, ...live }, { ...bundled, ...live, ...pool }],
    "both at once": [bundled, { ...bundled, ...pool, ...live }],
  };
  for (const [name, frames] of Object.entries(orders)) {
    const { started, low } = play(frames);
    assert.ok(started && Math.abs(started.usd - 0.264) < 1e-9, `${name}: started on the pool's live price`);
    assert.ok(low < 0.264 && low > 0.2, `${name}: the band's low ${low} stands under the price`);
  }
  // Before either answered: nothing started, the form reads.
  assert.equal(play([bundled]).started, null);
});

test("the Grid starts its band by the rule, says it reads until then, and keeps a band the person touched", () => {
  const grid = readFileSync(new URL("./Grid.tsx", import.meta.url), "utf8");
  assert.match(grid, /const startUsd = startPrice\(\{ venue, venuesKnown, venuePrice: marketPrice, perQuote,/);
  assert.match(grid, /marketLive = useMarket\(\)\.source === 'live'/);
  assert.match(grid, /startStep\(started\.current, shown\.mint, venue, startUsd, own\)/);
  assert.doesNotMatch(grid, /startKey/, "no start keyed on the coin and its venue alone");
  for (const own of ["ownLow", "ownHigh"]) assert.match(grid, new RegExp(`const ${own} = \\([^)]*\\) => \\{\\s*setOwnFor\\(shown\\.mint\\);`), `${own} marks the band as hers`);
  assert.match(grid, /\(edge: 'low' \| 'high', usd: number\) => \{\s*setOwnFor\(shown\.mint\);/, "an edge dragged on the chart is hers");
  assert.match(grid, /const ownBand = \(pct: number\) => \{[\s\S]*?setOwnFor\(shown\.mint\);\s*band\(pct\);/, "a quick width picked on a read price is hers");
  assert.match(grid, /const basis = !live \? null :/, "no plan on prices that are not live");
  assert.match(grid, /placeholder=\{waiting \? '—' : undefined\}/, "until the price is read: «—», not numbers");
});

test("no plan on prices that are not live: a venue's quote coin a dollar, or the market read live", () => {
  assert.equal(pricesLive({ venue: "pro", quoteIsDollar: false, marketLive: false }), false, "a SOL pool on the bundled SOL: nothing counted");
  assert.equal(pricesLive({ venue: "pro", quoteIsDollar: true, marketLive: false }), true);
  assert.equal(pricesLive({ venue: "dlmm", quoteIsDollar: false, marketLive: true }), true);
  assert.equal(pricesLive({ venue: null, quoteIsDollar: false, marketLive: false }), false);
  assert.equal(pricesLive({ venue: null, quoteIsDollar: false, marketLive: true }), true);
});

test("the start's steps: her band before the price stands; a re-read re-centres an untouched band and keeps the levels", () => {
  const at = { mint: MET, venue: "pro", usd: 0.264 };
  assert.equal(startStep(null, MET, "pro", null, false), "none", "nothing read yet");
  assert.equal(startStep(null, MET, "pro", 0.264, false), "first");
  assert.equal(startStep(null, MET, "pro", 0.264, true), "note", "typed or picked before the price came: hers stands");
  assert.equal(startStep(at, MET, "pro", 0.2641, false), "none");
  assert.equal(startStep(at, MET, "pro", 0.27, false), "recentre", "re-read: re-centred, not started over — the levels stay");
  assert.equal(startStep(at, MET, "pro", 0.27, true), "none", "hers stays");
  assert.equal(startStep(at, "SOL", "pro", null, false), "clear", "another coin, its price not read: the old band goes");
  assert.equal(startStep(at, "SOL", "pro", 73, false), "first", "another coin starts on its own");
  // Back to a coin: whatever was hers on it before, the band now in the fields is another coin's — it starts again.
  const onSol = { mint: "SOL", venue: "pro", usd: 73 };
  assert.equal(startStep(onSol, MET, "pro", 0.264, false), "first", "back to MET with its price at hand");
  assert.equal(startStep(onSol, MET, "pro", null, false), "clear", "back to MET, its price on the way: the fields wait");
  // The venue changed under an untouched band (the classic pool answered late): started over, levels fitted to its bins.
  const noVenue = { mint: MET, venue: null, usd: 0.264 };
  assert.equal(startStep(noVenue, MET, "dlmm", 0.264, false), "first");
  assert.equal(startStep(noVenue, MET, "dlmm", 0.264, true), "none", "her band stays on the new venue too");
});

/** The screen's start as it runs: the steps over a sequence of frames, the coin picked or a band touched between them. */
function run(frames) {
  let started = null;
  let fields = null;
  let ownFor = null;
  for (const frame of frames) {
    if (frame.pick) {
      ownFor = null;
      continue;
    }
    if (frame.touch) {
      ownFor = frame.mint;
      fields = frame.touch;
      continue;
    }
    const step = startStep(started, frame.mint, frame.venue ?? "pro", frame.usd, ownFor === frame.mint);
    if (step === "clear") {
      started = null;
      fields = null;
    } else if (step !== "none") {
      started = { mint: frame.mint, venue: frame.venue ?? "pro", usd: frame.usd };
      if (step !== "note") fields = `${frame.mint}@${frame.usd}`;
    }
  }
  return fields;
}

test("a band never carries over to another coin: dragged on MET, SOL opened, back to MET — MET's own band", () => {
  const fields = run([
    { mint: MET, usd: 0.264 },
    { touch: "MET-hers", mint: MET },
    { pick: true },
    { mint: "SOL", usd: 73 },
    { pick: true },
    { mint: MET, usd: 0.264 },
  ]);
  assert.equal(fields, `${MET}@0.264`);
  // Touched before MET's price came back: hers stands.
  assert.equal(run([{ mint: "SOL", usd: 73 }, { pick: true }, { mint: MET, usd: null }, { touch: "MET-hers", mint: MET }, { mint: MET, usd: 0.264 }]), "MET-hers");
  // MET's price on the way, nothing touched: the fields wait, then MET's band.
  assert.equal(run([{ mint: "SOL", usd: 73 }, { pick: true }, { mint: MET, usd: null }]), null);
  assert.equal(run([{ mint: "SOL", usd: 73 }, { pick: true }, { mint: MET, usd: null }, { mint: MET, usd: 0.264 }]), `${MET}@0.264`);
  const grid = readFileSync(new URL("./Grid.tsx", import.meta.url), "utf8");
  assert.match(grid, /const pickCoin = \(next: PickedCoin\) => \{[\s\S]*?if \(next\.mint !== shown\.mint\) \{\s*setOwnFor\(null\);/, "another coin picked forgets the band touched on the last one; the same coin keeps it");
  assert.match(grid, /onCoin=\{pickCoin\}/);
  const effect = grid.slice(grid.indexOf("const step = startStep("), grid.indexOf("}, [shown.mint, venue, startUsd, own]);"));
  assert.match(effect, /if \(step === 'first'\) \{[\s\S]*?setLevels\(/, "the levels are set on the first start only");
  assert.equal((effect.match(/setLevels\(/g) ?? []).length, 1);
  assert.match(grid, /if \(!startUsd\) \{\s*picked\.current = \{ mint: shown\.mint, pct \};/, "a width picked before the price waits for it");
});
