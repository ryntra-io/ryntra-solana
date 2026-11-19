import assert from "node:assert/strict";
import test from "node:test";

import { keepMoves, newestMove } from "./day-move.ts";
import { allCoins, mixedRows, mixedScriptOf, withTwin, DEFAULT_FILTERS, DEFAULT_SORT } from "./depth-view.ts";
import { changeText, changeTone } from "../ui/figures.ts";

/* One day's move on every screen, «All» that adds up, twins in another script's letters, no «−0.00%». */

const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";

test("every screen says the newest read of a coin's day", () => {
  let moves = keepMoves({}, [{ mint: MET, change: 0.37 }], 1_000);
  moves = keepMoves(moves, [{ mint: MET, change: 1.26 }], 2_000);
  // An older read that answers late changes nothing.
  const late = keepMoves(moves, [{ mint: MET, change: 0.21 }], 1_500);
  assert.equal(late, moves);
  assert.equal(moves[MET].change, 1.26);
  // A move that was not measured is no move.
  assert.equal(keepMoves(moves, [{ mint: MET, change: null }], 3_000), moves);
  assert.equal(newestMove({ change: 1.03, at: 500 }, moves[MET], null, undefined), 1.26);
  assert.equal(newestMove(null, undefined), null);
});

test("a move that rounds to nothing is «0.00%» in no tone, never «−0.00%»", () => {
  assert.equal(changeText(-0.001, "en"), "0.00%");
  assert.equal(changeText(0.004, "en"), "0.00%");
  assert.equal(changeTone(-0.001), undefined);
  assert.equal(changeText(-0.01, "en"), "−0.01%");
  assert.equal(changeTone(-0.01), "down");
});

test("a ticker in Latin letters mixed with Cyrillic or Greek look-alikes is a twin; one script stays itself", () => {
  assert.equal(mixedScriptOf("TTWО"), "TTWO");
  assert.equal(mixedScriptOf("Nеil"), "Neil");
  assert.equal(mixedScriptOf("TTWO"), null);
  assert.equal(mixedScriptOf("ГУСЬ"), null);
  // Two scripts in two words, or a letter that reads as no Latin one, is no twin.
  assert.equal(mixedScriptOf("Pepe Козак"), null);
  assert.equal(mixedScriptOf("SOL Кіт"), null);
  assert.equal(mixedScriptOf("Doge Україна"), null);
  assert.equal(mixedScriptOf("μSOL"), null);
  const coin = { id: "x", symbol: "TTWО", name: "Take-Two", verified: false, copyOf: null };
  assert.equal(withTwin(coin).copyOf, "TTWO");
  assert.equal(withTwin({ ...coin, verified: true }).copyOf, null);
});

const coin = (id, kind, extra = {}) => ({
  id,
  symbol: id,
  name: id,
  kind,
  verified: true,
  copyOf: null,
  mint: "off",
  freeze: "off",
  topHolders: 5,
  liquidity: 1e6,
  holders: 10_000,
  mcap: 1e7,
  price: 1,
  bornAt: null,
  venue: kind === "meme" ? "pump" : null,
  stats: {},
  ...extra,
});

test("«All» is every meme and every crypto coin its two tabs hold, each once — its count is theirs added up", () => {
  const all = [coin("a", "meme"), coin("b", "crypto")];
  const memes = [coin("a", "meme"), coin("c", "meme")];
  const crypto = [coin("b", "crypto"), coin("d", "crypto"), coin("s", "stock")];
  const every = allCoins([all, memes, crypto]);
  assert.deepEqual(every.map((c) => c.id), ["a", "b", "c", "d"]);
  // A coin the All read holds but neither tab does is not counted once the tabs are read; before, the All read stands.
  assert.deepEqual(allCoins([[...all, coin("z", "meme")], memes, crypto]).map((c) => c.id), ["a", "b", "c", "d"]);
  assert.deepEqual(allCoins([all, memes, undefined]).map((c) => c.id), ["a", "b", "c"]);
  // A meme's own filter («Launched on») never cuts a crypto coin out of «All».
  const view = { filters: { ...DEFAULT_FILTERS, venue: "launchlab" }, window: "24h", sort: DEFAULT_SORT, query: "", now: 0 };
  assert.deepEqual(mixedRows(every, view).map((c) => c.id), ["b", "d"]);
});
