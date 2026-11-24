import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { creatorOf, didLineOf, launchedOf, othersFirst, shareText } from "./creator-view.ts";
import { CREATOR } from "./words.ts";

/*
 * The creator's tab reads the engine's answer as it is: its shape checked, what the creator did in one line
 * with its tone, when each coin was launched; and every word in both languages, plural forms included.
 */

const MINT = "2HWPiGWWTmRj2zThV1sLSoTVqPQL96ito2X6NCPkRUKN";
const CREATOR_WALLET = "7v54NWdBtkjuAFJrLGsS2SXnuk8nKam81mZJeeYxVFi9";
const W1 = "mBKqcnGotbsSb5vNrdyhzZ5EhqZdids9QYiTRckvi7v";
const NOW = Date.UTC(2026, 10, 20, 12);

const action = (extra) => ({ did: "holds", soldPct: 0, movedPct: 0, holds: 1_000, holdsPct: 0.1, movedTo: [], moves: 1, whole: true, ...extra });

test("the answer is read only in the engine's shape; a coin or an action of another shape is left out", () => {
  const body = {
    creator: CREATOR_WALLET,
    launched: 3,
    listed: 1,
    coinsWhole: true,
    coins: [{ mint: MINT, symbol: "THIS", name: "This coin", icon: true, launchedAt: "2026-11-18T00:00:00.000Z", capUsd: 90_000, peakCapUsd: 200_000, listed: false, current: true }, { mint: "nope" }],
    action: action({ did: "moved", movedTo: [W1, "nope"] }),
    observedAt: "2026-11-20T12:00:00.000Z",
    stale: false,
  };
  const read = creatorOf(body);
  assert.equal(read.coins.length, 1);
  assert.equal(read.coins[0].icon, true);
  assert.deepEqual(read.action.movedTo, [W1]);
  assert.equal(creatorOf({ ...body, action: { did: "rugged" } }).action, null, "a word the engine does not say is not drawn");
  assert.equal(creatorOf({ ...body, creator: "nope" }), null);
  assert.equal(creatorOf({ none: { code: "NO_CREATOR" } }), null);
  assert.equal(creatorOf(null), null);
});

test("what the creator did, in its tone: moving and selling all are a risk, selling part a warning, holding plain", () => {
  const moved = didLineOf(action({ did: "moved", soldPct: 40, movedPct: 30, holds: 15_000_000, holdsPct: 1.5, movedTo: [W1, CREATOR_WALLET] }));
  assert.deepEqual(moved, { did: "moved", tone: "down", moved: { share: "30%", wallets: 2 }, sold: "40%", holds: "1.5%", empty: false });
  assert.deepEqual(didLineOf(action({ did: "soldAll", soldPct: 100, holds: 0, holdsPct: 0 })), { did: "soldAll", tone: "down", moved: null, sold: null, holds: null, empty: true });
  assert.equal(didLineOf(action({ did: "soldSome", soldPct: 12.345 })).sold, "12%");
  assert.equal(didLineOf(action({ did: "soldSome", soldPct: 12.345 })).tone, "warn");
  assert.equal(didLineOf(action()).tone, "plain");
  assert.equal(didLineOf(action({ did: "never", holds: 0 })).empty, false, "never held is not «nothing left»");
  assert.equal(didLineOf(action({ did: "never", holds: 0 })).tone, "dim");
  assert.equal(didLineOf(action({ holds: null, holdsPct: null })).holds, null, "a balance not read is not said");
});

test("shares and launch times as the tab writes them", () => {
  assert.equal(shareText(30), "30%");
  assert.equal(shareText(1.54), "1.5%");
  assert.equal(shareText(0.044), "0.04%");
  assert.equal(shareText(0.001), "<0.01%");
  assert.equal(shareText(0), "0%");
  assert.deepEqual(launchedOf(new Date(NOW - 20_000).toISOString(), NOW), { kind: "ago", unit: "m", n: 1 });
  assert.deepEqual(launchedOf(new Date(NOW - 5 * 3_600_000).toISOString(), NOW), { kind: "ago", unit: "h", n: 5 });
  assert.deepEqual(launchedOf(new Date(NOW - 3 * 86_400_000).toISOString(), NOW), { kind: "ago", unit: "d", n: 3 });
  assert.deepEqual(launchedOf(new Date(NOW - 40 * 86_400_000).toISOString(), NOW), { kind: "date", at: NOW - 40 * 86_400_000 });
  assert.equal(launchedOf(null, NOW), null);
});

test("the creator's other coins come first, the newest first; this coin last, for the measure", () => {
  const coin = (mint, current = false) => ({ mint, current });
  assert.deepEqual(othersFirst([coin("this", true), coin("a"), coin("b")]).map((row) => row.mint), ["a", "b", "this"]);
  assert.deepEqual(othersFirst([coin("this", true)]).map((row) => row.mint), ["this"]);
});

test("the words count in both languages: one coin, a few, many", () => {
  assert.equal(CREATOR.en.launched(1), "Launched 1 coin");
  assert.equal(CREATOR.en.launched(14), "Launched 14 coins");
  assert.equal(CREATOR.uk.launched(1), "Запустив 1 монету");
  assert.equal(CREATOR.uk.launched(3), "Запустив 3 монети");
  assert.equal(CREATOR.uk.launched(11), "Запустив 11 монет");
  assert.equal(CREATOR.uk.launched(21), "Запустив 21 монету");
  assert.equal(CREATOR.uk.listed(1), "1 вийшла на пул");
  assert.equal(CREATOR.uk.listed(5), "5 вийшли на пул");
  assert.equal(CREATOR.uk.movedShare("30%", 2), "30% на 2 гаманці");
  assert.equal(CREATOR.uk.movedShare("30%", 5), "30% на 5 гаманців");
  assert.equal(CREATOR.en.movedShare("30%", 1), "30% to 1 wallet");
});

test("the tab is mounted where the screen brings it, and only there: the bottom panel and the phone's «About»", () => {
  const screen = readFileSync(new URL("../CoinScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /id: 'creator', label: cw\.tab, draw: \(\) => <CreatorTab mint=\{mint\} \/>/);
  assert.match(screen, /<CreatorTab mint=\{mint\} phone \/>/);
  assert.match(screen, /const withCreator = creator && !stock && !isNativeToken\(mint\)/, "no creator's tab for SOL or a company's token");
  const page = readFileSync(new URL("../../../app/(terminal)/coin/[mint]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /creator=\{creatorOpen\(\)\}/, "the server's switch opens it");
});
