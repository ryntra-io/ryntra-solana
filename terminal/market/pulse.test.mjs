import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NEW_FILL_HOLDERS, NEW_FILL_VOLUME_USD, NEW_MIN_HOLDERS, NEW_MIN_VOLUME_USD, PULSE_COLUMNS, PULSE_SHOWN, bornAt, cardLogo, curvePct, ourLive, padWord, pulseBoard, pulseCards, ryntraMints } from "./pulse-view.ts";

/** The engine's own answers of 17.11.2026 (`/api/spot/pulse?feed=…&mode=meme` on ryntra.io), trimmed to a row's fields. */
const RECORDED = JSON.parse(readFileSync(new URL("./fixtures/pulse-2026-11-17.json", import.meta.url), "utf8"));

test("«New» at a quiet hour: one busy coin, and the column fills with coins that do trade — never «3 holders, $7»", () => {
  const base = RECORDED.new[0];
  const coin = (i, holders, volumeUsd) => ({
    ...base,
    ryntra: null,
    mint: `Quiet${String(i).padStart(39, "1")}`,
    symbol: `Q${i}`,
    name: `Quiet ${i}`,
    holders,
    windows: { ...base.windows, m5: { ...base.windows.m5, volumeUsd }, h1: { ...base.windows.h1, volumeUsd } },
  });
  const rows = [coin(1, 40, 2_000), coin(2, 3, 7), coin(3, 6, 150), coin(4, 8, 300), coin(5, 2, 900), coin(6, 5, 120), coin(7, 7, 99), coin(8, 9, 400)];
  const cards = pulseCards("new", rows);
  assert.ok(cards.length >= PULSE_SHOWN, `filled to ${cards.length}`);
  // Q2 («3 holders, $7») and Q7 ($99) stay out.
  assert.deepEqual(cards.map((row) => row.symbol), ["Q1", "Q3", "Q4", "Q5", "Q6", "Q8"], "the busy coins and the coins that trade, in the engine's order");
  for (const row of cards) {
    const volume = Math.max(row.windows.m5.volumeUsd ?? 0, row.windows.h1.volumeUsd ?? 0);
    assert.ok((row.holders >= NEW_MIN_HOLDERS || volume >= NEW_MIN_VOLUME_USD) || (row.holders >= NEW_FILL_HOLDERS && volume >= NEW_FILL_VOLUME_USD), `${row.symbol} ${row.holders} ${volume}`);
  }
  // A busy hour keeps the stricter word: with five busy coins, none of the fill ones stands.
  const busy = [1, 2, 3, 4, 5].map((i) => coin(10 + i, 30, 1_000));
  assert.deepEqual(pulseCards("new", [...busy, coin(20, 6, 150)]).map((row) => row.symbol), busy.map((row) => row.symbol));
});
const key = (row) => `${row.symbol.toLowerCase()}\u0000${row.name.toLowerCase()}`;

test("«New» on the engine's recorded answer: no coin twice, no empty coin (a handful of holders and a few dollars)", () => {
  const raw = RECORDED.new;
  // The answer as it came had both: a ticker and name twice, and coins with 3 holders and $7 traded.
  assert.ok(new Set(raw.map(key)).size < raw.length, "the recorded answer names a coin twice");
  assert.ok(raw.some((row) => (row.holders ?? 0) < NEW_MIN_HOLDERS), "the recorded answer has empty coins");
  const cards = pulseCards("new", raw);
  assert.equal(new Set(cards.map(key)).size, cards.length);
  for (const row of cards) {
    const volume = Math.max(row.windows.m5.volumeUsd ?? 0, row.windows.h1.volumeUsd ?? 0);
    // Not empty: ten holders, or real trading — never «3 holders, $7».
    assert.ok(row.holders > 0 && volume > 0 && (row.holders >= NEW_MIN_HOLDERS || volume >= NEW_MIN_VOLUME_USD), `${row.symbol} ${row.holders} ${volume}`);
  }
  assert.ok(!cards.some((row) => row.holders < NEW_MIN_HOLDERS && Math.max(row.windows.m5.volumeUsd ?? 0, row.windows.h1.volumeUsd ?? 0) < 10), "no «3 holders, $7»");
  // Of two coins with one ticker and name, the one more people hold stands.
  const a = { ...raw[0], mint: "Twin1111111111111111111111111111111111111111", symbol: "TWIN", name: "Twin", holders: 40, windows: { ...raw[0].windows, h1: { ...raw[0].windows.h1, volumeUsd: 900 } } };
  const b = { ...a, mint: "Twin2222222222222222222222222222222222222222", holders: 80 };
  const twins = pulseCards("new", [a, b]);
  assert.equal(twins.length, 1);
  assert.equal(twins[0].mint, b.mint);
});

test("Ryntra's own launches stand only while they live: «Almost on a DEX» drops the ones that stopped trading", () => {
  const raw = RECORDED.soon;
  const ours = raw.filter((row) => row.ryntra);
  assert.ok(ours.length > 0 && ours.every((row) => !ourLive(row)), "the recorded launches of Ryntra did not trade today");
  const cards = pulseCards("soon", raw);
  assert.ok(cards.every((row) => !row.ryntra));
  assert.ok(cards.every((row) => curvePct(row) !== null && curvePct(row) >= 25));
  // A launch that trades today stands first, as the engine put it.
  const live = { ...ours[0], ryntra: { ...ours[0].ryntra, traded24h: true }, marketCapUsd: 12_000, holders: 40 };
  assert.equal(pulseCards("soon", [live, ...raw.filter((row) => !row.ryntra)])[0].mint, live.mint);
});

test("«Out on a DEX»: every coin the engine names that someone holds", () => {
  const cards = pulseCards("dex", RECORDED.dex);
  assert.ok(cards.length >= 5);
  assert.ok(cards.every((row) => row.graduatedAt !== null || row.ryntra));
});

test("a card's words: the launchpad short, its age, the way to a DEX, and its logo through the engine's proxy", () => {
  assert.equal(padWord({ launchpad: "pump.fun", ryntra: null, venue: "pump" }), "pump");
  assert.equal(padWord({ launchpad: "Meteora", ryntra: null, venue: "meteora-dbc" }), "Meteora");
  assert.equal(padWord({ launchpad: null, ryntra: { preset: "x" }, venue: null }), "Ryntra");
  assert.equal(bornAt({ firstPoolAt: "2026-11-17T17:06:08.000Z", ryntra: null }), Date.parse("2026-11-17T17:06:08.000Z"));
  assert.equal(curvePct({ curve: { venue: "pump", progressPct: 75.6, complete: false } }), 75);
  assert.equal(curvePct({ curve: null }), null);
  const row = RECORDED.dex[0];
  assert.ok(cardLogo(row).startsWith(`/api/spot/icon?mint=${row.mint}&u=https%3A%2F%2F`));
  assert.equal(cardLogo({ mint: row.mint, icon: "http://x", ryntra: null }), null);
  assert.equal(cardLogo({ mint: row.mint, icon: null, ryntra: { preset: "x" } }), `/api/icon/${row.mint}`);
  assert.ok(ryntraMints(RECORDED.soon).length > 0);
  assert.deepEqual(PULSE_COLUMNS, ["new", "soon", "dex"]);
});

test("the Pulse reads the engine's feeds, holds a column under the pointer, and links each card to its coin", () => {
  const store = readFileSync(new URL("./pulse-store.ts", import.meta.url), "utf8");
  assert.match(store, /\/api\/spot\/pulse\?feed=\$\{column\}&mode=meme/);
  const screen = readFileSync(new URL("./Pulse.tsx", import.meta.url), "utf8");
  assert.match(screen, /onPointerEnter=.*setHeld\(true\)/);
  assert.match(screen, /coinHref\(row\.mint, 'live'\)/);
  assert.ok(!/pulseHref/.test(screen), "no way into the closed old interface");
});

test("one coin, one column: a coin out on a DEX or almost there never stands in «New» too", () => {
  const twin = { ...RECORDED.soon.find((row) => !row.ryntra), firstPoolAt: RECORDED.new[0].firstPoolAt };
  const board = pulseBoard({ new: [twin, ...RECORDED.new], soon: RECORDED.soon, dex: RECORDED.dex });
  const mints = PULSE_COLUMNS.flatMap((id) => board[id].map((row) => row.mint));
  assert.equal(new Set(mints).size, mints.length);
  assert.ok(board.soon.some((row) => row.mint === twin.mint));
  assert.ok(!board.new.some((row) => row.mint === twin.mint));
});

test("a copy with more holders never takes the place of Ryntra's own live launch", () => {
  const ours = { ...RECORDED.soon.find((row) => row.ryntra), marketCapUsd: 9_000, holders: 12 };
  const live = { ...ours, ryntra: { ...ours.ryntra, traded24h: true } };
  const copy = { ...live, mint: "Copy111111111111111111111111111111111111111", ryntra: null, holders: 900, curve: { venue: "pump", progressPct: 60, complete: false } };
  const cards = pulseCards("soon", [copy, live]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].mint, live.mint);
});
