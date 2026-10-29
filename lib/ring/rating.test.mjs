// Run from repo root: node --test lib/ring/rating.test.mjs
/*
 * CITY-50 «Ринг · агенти»: the rating model. Elo per format with a 95 % interval from the Fisher information of the
 * games so far — wide before a game, narrowing as the agent plays; provisional for the first ten games; the matches
 * (CITY-51) move it through `applyResult`, which never changes the row it is given.
 */
import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { ELO, applyResult, emptyRating, expectedScore, interval, ratingView } = await import("./rating.ts");
const { FORMATS } = await import("./contract.ts");

const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ""} ${actual} ≉ ${expected}`);

test("a new row: 1200, no games, the prior's interval ±686", () => {
  for (const format of FORMATS) {
    const row = emptyRating(format);
    assert.deepEqual(row, { format, rating: 1200, games: 0, wins: 0, draws: 0, losses: 0, info: 0 });
    const view = ratingView(row);
    assert.deepEqual(view, { format, rating: 1200, low: 514, high: 1886, games: 0, wins: 0, draws: 0, losses: 0, provisional: true });
  }
  near(interval(emptyRating("code")).sd, ELO.priorSd, 1e-9);
});

test("the expected score: even at equal ratings, 10:1 at 400 points, the two sides sum to one", () => {
  assert.equal(expectedScore(1200, 1200), 0.5);
  near(expectedScore(1600, 1200), 10 / 11, 1e-12);
  for (const [a, b] of [[1000, 1300], [1500, 1499], [2400, 900]]) near(expectedScore(a, b) + expectedScore(b, a), 1, 1e-12);
});

test("a game moves the rating by K × (score − expected): 48 while provisional, then 32", () => {
  const start = emptyRating("duo-crack");
  const won = applyResult(start, 1200, 1);
  assert.equal(won.rating, 1224);
  assert.deepEqual([won.games, won.wins, won.draws, won.losses], [1, 1, 0, 0]);
  const lost = applyResult(start, 1200, 0);
  assert.equal(lost.rating, 1176);
  assert.deepEqual([lost.games, lost.wins, lost.draws, lost.losses], [1, 0, 0, 1]);
  const drew = applyResult(start, 1200, 0.5);
  assert.equal(drew.rating, 1200);
  assert.deepEqual([drew.games, drew.wins, drew.draws, drew.losses], [1, 0, 1, 0]);

  let row = start;
  for (let i = 0; i < ELO.provisionalGames; i += 1) row = applyResult(row, row.rating, 0.5);
  assert.equal(row.games, ELO.provisionalGames);
  assert.equal(applyResult(row, row.rating, 1).rating - row.rating, ELO.k / 2, "past the provisional games K is 32");
  assert.deepEqual(start, emptyRating("duo-crack"), "the row given is never changed");
});

test("an upset moves more than an expected win", () => {
  const underdog = { ...emptyRating("code"), rating: 1000, games: 20 };
  const favourite = { ...emptyRating("code"), rating: 1400, games: 20 };
  const upset = applyResult(underdog, 1400, 1).rating - 1000;
  const expected = applyResult(favourite, 1000, 1).rating - 1400;
  assert.ok(upset > 25 && expected < 7, `${upset} vs ${expected}`);
});

test("the interval narrows with every game: about ±68 after a hundred even ones", () => {
  let row = emptyRating("market-replay");
  let last = interval(row).sd;
  for (let i = 0; i < 100; i += 1) {
    row = applyResult(row, row.rating, i % 2 === 0 ? 1 : 0);
    const sd = interval(row).sd;
    assert.ok(sd < last, `game ${i + 1}`);
    last = sd;
  }
  const { low, high } = interval(row);
  near((high - low) / 2, 68, 1.5, "half-width after 100 even games");
  const view = ratingView(row);
  assert.equal(view.provisional, false);
  assert.ok(view.low < view.rating && view.rating < view.high);
});

test("games against far stronger or weaker opponents say less than even ones", () => {
  const even = applyResult(emptyRating("code"), 1200, 1);
  const lopsided = applyResult(emptyRating("code"), 2400, 0);
  assert.ok(lopsided.info < even.info);
});

test("the rating stays inside its floor and ceiling", () => {
  // A loss to an equal takes 16 points: from 5 above the floor it stops at the floor, and the same at the ceiling.
  const low = applyResult({ ...emptyRating("code"), rating: ELO.floor + 5, games: 50 }, ELO.floor + 5, 0);
  assert.equal(low.rating, ELO.floor);
  const high = applyResult({ ...emptyRating("code"), rating: ELO.ceiling - 5, games: 50 }, ELO.ceiling - 5, 1);
  assert.equal(high.rating, ELO.ceiling);
});

test("a score other than 1, 0.5 or 0, or an opponent that is not a number, is refused", () => {
  assert.throws(() => applyResult(emptyRating("code"), 1200, 0.7), RangeError);
  assert.throws(() => applyResult(emptyRating("code"), Number.NaN, 1), RangeError);
});
