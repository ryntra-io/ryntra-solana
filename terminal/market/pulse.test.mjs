import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { FLAG_CREATOR_LAUNCHES } from "../../lib/spot/pulse.ts";
import {
  CARD_CREATOR_LAUNCHES,
  COLUMN_FILTER_NONE,
  NEW_FILL_HOLDERS,
  NEW_FILL_VOLUME_USD,
  NEW_MIN_HOLDERS,
  NEW_MIN_VOLUME_USD,
  PULSE_COLUMNS,
  PULSE_LIST,
  PULSE_SHOWN,
  bornAt,
  cardLogo,
  cardName,
  cardOneTap,
  cardRisks,
  columnFilterOn,
  columnState,
  curvePct,
  freshMints,
  heldCards,
  ourLive,
  padWord,
  passesColumn,
  pulseBoard,
  pulseCards,
  pulseLive,
  pulseLogo,
  readColumnFilter,
  riskLineOf,
  ryntraMints,
  shareText,
} from "./pulse-view.ts";
import { DEPTH } from "./depth-words.ts";

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
  assert.match(screen, /onPointerEnter=.*setPointer\(true\)/);
  assert.match(screen, /onPointerDown=.*touched\(\)/, "a finger holds the column too");
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

test("a crude name never stands in the Pulse — «ASSHOLE» came in live (release check 19.11); the board reads the same rule", () => {
  const base = RECORDED.dex[0];
  const crude = [
    { ...base, mint: "Crude11111111111111111111111111111111111111", symbol: "ASSHOLE", name: "ASSHOLE" },
    { ...base, mint: "Crude21111111111111111111111111111111111111", symbol: "KITE", name: "Assholes Club" },
    { ...base, mint: "Crude31111111111111111111111111111111111111", symbol: "A$$HOLE", name: "token" },
  ];
  for (const column of PULSE_COLUMNS) {
    const cards = pulseCards(column, [...crude, ...RECORDED[column]]);
    assert.ok(!cards.some((row) => row.mint.startsWith("Crude")), column);
  }
  const board = pulseBoard({ new: [...crude, ...RECORDED.new], soon: RECORDED.soon, dex: [...crude, ...RECORDED.dex] });
  assert.ok(!PULSE_COLUMNS.some((id) => board[id].some((row) => row.mint.startsWith("Crude"))));
  assert.ok(pulseCards("dex", RECORDED.dex).length > 0, "the ordinary coins stay");
  assert.equal(pulseCards("dex", [{ ...base, mint: "Plain11111111111111111111111111111111111111", symbol: "CLASS", name: "Classic Pass" }]).length, 1, "«ass» inside an ordinary word stays");
});

test("a card's risk line: the top ten, the creator's share, what the creator launched — only what the engine read", () => {
  const row = RECORDED.dex.find((r) => r.symbol === "SSB");
  assert.deepEqual(riskLineOf(row), { top10: row.top10Pct, dev: row.devPct, launched: 1, out: 1 });
  // A creator's count of DEX coins is said only beside the launches.
  assert.deepEqual(riskLineOf({ top10Pct: null, devPct: null, creatorLaunches: null, creatorGraduated: 4 }), null, "nothing read — no line at all");
  assert.deepEqual(riskLineOf({ top10Pct: 27.4, devPct: null, creatorLaunches: 186010, creatorGraduated: null }), { top10: 27.4, dev: null, launched: 186010, out: null });
  // Every recorded card with a figure has a line; one with none has none.
  for (const r of [...RECORDED.new, ...RECORDED.soon, ...RECORDED.dex]) {
    const line = riskLineOf(r);
    assert.equal(line === null, r.top10Pct === null && r.devPct === null && r.creatorLaunches === null, r.symbol);
  }
  assert.equal(shareText(27.38), "27%");
  assert.equal(shareText(0.21), "0.2%");
  assert.equal(shareText(0.04), "<0.1%");
  assert.equal(shareText(0), "0%");
});

test("a card's facts against it: concentration, a busy creator, a right kept — facts, never a score", () => {
  const plain = { top10Pct: 20, devPct: 2, creatorLaunches: 1, creatorGraduated: 1, notices: [] };
  assert.deepEqual(cardRisks(plain), []);
  assert.deepEqual(cardRisks({ ...plain, top10Pct: 79.7 }), ["top"]);
  assert.deepEqual(cardRisks({ ...plain, devPct: 12 }), ["dev"]);
  assert.deepEqual(cardRisks({ ...plain, creatorLaunches: 5077 }), ["serial"]);
  assert.deepEqual(cardRisks({ ...plain, notices: ["MINT_AUTHORITY", "FLAGGED"] }), ["mint", "flagged"]);
  assert.deepEqual(cardRisks({ top10Pct: null, devPct: null, creatorLaunches: null, creatorGraduated: null, notices: [] }), [], "unread is not a risk");
  assert.equal(CARD_CREATOR_LAUNCHES, FLAG_CREATOR_LAUNCHES, "one rule with the engine for a busy creator");
});

test("one tap never buys a coin passing for a stock or with a crude name; its name stands beside the ticker unless it repeats it", () => {
  const base = RECORDED.dex[0];
  assert.equal(cardOneTap(base), true);
  assert.equal(cardOneTap({ ...base, passesFor: { ticker: "NVDAx", company: "NVIDIA", mint: "x" } }), false);
  assert.equal(cardOneTap({ ...base, symbol: "FART", name: "Fart Coin" }), false);
  assert.equal(cardName({ symbol: "$WIF", name: "wif" }), null);
  assert.equal(cardName({ symbol: "SSB", name: "Super Saiyan Blob" }), "Super Saiyan Blob");
  const screen = readFileSync(new URL("./Pulse.tsx", import.meta.url), "utf8");
  assert.match(screen, /cardOneTap\(row\) \? <ZapButton/);
});

test("a column's own filter: the pool from, the age under, no risky coin — an unread figure never passes a bound", () => {
  const now = Date.parse("2026-11-17T18:00:00Z");
  const row = { ...RECORDED.dex.find((r) => r.symbol === "SSB"), liquidityUsd: 20_000, firstPoolAt: "2026-11-17T17:30:00Z" };
  assert.equal(passesColumn(row, COLUMN_FILTER_NONE, now), true);
  assert.equal(passesColumn(row, { ...COLUMN_FILTER_NONE, liquidity: 10_000 }, now), true);
  assert.equal(passesColumn(row, { ...COLUMN_FILTER_NONE, liquidity: 50_000 }, now), false);
  assert.equal(passesColumn({ ...row, liquidityUsd: null }, { ...COLUMN_FILTER_NONE, liquidity: 1_000 }, now), false);
  assert.equal(passesColumn(row, { ...COLUMN_FILTER_NONE, age: "1h" }, now), true);
  assert.equal(passesColumn(row, { ...COLUMN_FILTER_NONE, age: "10m" }, now), false);
  assert.equal(passesColumn({ ...row, firstPoolAt: null, ryntra: null }, { ...COLUMN_FILTER_NONE, age: "24h" }, now), false);
  // SSB: the top ten keep ~80% — a fact against it.
  assert.equal(passesColumn(row, { ...COLUMN_FILTER_NONE, safe: true }, now), false);
  assert.equal(columnFilterOn({ liquidity: 1_000, age: "1h", safe: true }), 3);
  assert.deepEqual(readColumnFilter({ liquidity: 7, age: "2y", safe: "yes" }), COLUMN_FILTER_NONE, "what is not ours reads as none");
  assert.deepEqual(readColumnFilter({ liquidity: 10_000, age: "10m", safe: true }), { liquidity: 10_000, age: "10m", safe: true });
});

test("a column scrolls past five cards and holds still under the hand: a new coin waits, the cards on screen keep their place", () => {
  assert.ok(PULSE_LIST > PULSE_SHOWN);
  const [a, b, c, n] = RECORDED.dex;
  const fresher = { ...b, marketCapUsd: 99_999 };
  const held = heldCards([a, b, c], [n, fresher, a]);
  assert.deepEqual(held.cards.map((r) => r.mint), [a.mint, b.mint, c.mint], "the same cards in the same order");
  assert.equal(held.cards[1].marketCapUsd, 99_999, "with their newest figures");
  assert.equal(held.waiting, 1, "one new coin waits above them");
  const css = readFileSync(new URL("./depth.module.css", import.meta.url), "utf8");
  assert.match(css, /\.pulseBody \{[^}]*overflow-y: auto/);
  assert.match(css, /\.cardSym \{[^}]*flex: none/, "the ticker stands whole");
});

test("the card's words say the figures and the facts in both languages, without a dash for what is not read", () => {
  for (const lang of ["en", "uk"]) {
    const w = DEPTH[lang];
    assert.ok(w.riskTop("27%").includes("27%"));
    assert.ok(w.riskMade("5.1K", "35").includes("35"));
    assert.ok(!w.riskMade("5.1K", null).includes("—"));
    assert.ok(w.factMade("1", null).length > 0);
  }
});


const FEED = (status, missed = false) => ({ status, missed });

test("flaw 10: «live» only while a feed answers; a feed that does not answer is a failure, never a quiet market", () => {
  const all = (feed) => ({ new: feed, soon: feed, dex: feed });
  assert.equal(pulseLive(all(FEED("ready"))), "live");
  assert.equal(pulseLive({ new: FEED("failed", true), soon: FEED("ready"), dex: FEED("failed", true) }), "live", "one feed answering is live");
  assert.equal(pulseLive(all(FEED("reading"))), "reading");
  assert.equal(pulseLive(all(FEED("failed", true))), "down", "nothing answered: no «live»");
  assert.equal(pulseLive(all(FEED("ready", true))), "down", "the cards on screen are from before: no «live»");

  assert.equal(columnState(FEED("ready"), 3, 3), "cards");
  assert.equal(columnState(FEED("ready", true), 3, 3), "cards", "cards from before stay on screen");
  assert.equal(columnState(FEED("reading"), 0, 0), "reading");
  assert.equal(columnState(FEED("failed", true), 0, 0), "down");
  assert.equal(columnState(FEED("ready", true), 0, 0), "down", "an empty answer, then no answer: a failure");
  assert.equal(columnState(FEED("ready"), 0, 4), "filtered");
  assert.equal(columnState(FEED("ready"), 0, 0), "quiet");

  for (const lang of ["en", "uk"]) {
    const w = DEPTH[lang];
    assert.notEqual(w.pulseDown, w.pulseNone, "a failure and a quiet minute say different things");
    assert.ok(w.again && w.notUpdating && w.noCoins && w.failed);
    assert.notEqual(w.noCoins, w.none, "an empty market is not the person's filters");
  }
  const screen = readFileSync(new URL("./Pulse.tsx", import.meta.url), "utf8");
  assert.match(screen, /live === 'live' \? \(/, "the green mark stands only when live");
  assert.match(screen, /state === 'down' \?/, "a column that did not answer has its own state");
  assert.match(screen, /readPulseAgain/, "«Try again» reads the feeds now");
  const store = readFileSync(new URL("./pulse-store.ts", import.meta.url), "utf8");
  assert.doesNotMatch(store, /\{ \.\.\.had, status: 'ready' \}/, "a failed read is never passed off as an answer");
  const table = readFileSync(new URL("./DepthMarket.tsx", import.meta.url), "utf8");
  assert.match(table, /readDepthAgain/, "the table's failure has «Try again»");
});

test("flaw 11: a new coin flashes in place; no card fades in from nothing, so a column never stands empty mid-fade", () => {
  const [a, b, c] = RECORDED.dex;
  assert.equal(freshMints(new Set(), [a, b]).size, 0, "the first drawing flashes nothing");
  assert.deepEqual([...freshMints(new Set([a.mint, b.mint]), [c, a, b])], [c.mint]);
  const css = readFileSync(new URL("./depth.module.css", import.meta.url), "utf8");
  const card = /\n\.card \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(card.length > 0, "the card's rule is read");
  assert.doesNotMatch(card, /animation/, "a card does not animate as it mounts");
  assert.match(css, /\.card\[data-fresh\] \{[^}]*animation: cardIn/);
  const keyframes = /@keyframes cardIn \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  assert.doesNotMatch(keyframes, /opacity|transform/, "the flash is a colour, not a fade or a slide");
});

test("flaw 12: the risk line says one form for the creator's coins, and no faint sign without a fact against the coin", () => {
  for (const lang of ["en", "uk"]) {
    const w = DEPTH[lang];
    const alone = w.riskMade("1", null);
    const beside = w.riskMade("11K", "230");
    assert.ok(alone.startsWith(beside.split(" ")[0]), `${lang}: the label is the same with or without the creator's share`);
    // The DEX's count stands before the word, never «на DEX 3» read as an exchange's name.
    assert.match(beside, /230 (on|на) DEX$/);
  }
  const screen = readFileSync(new URL("./Pulse.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /data-level=\{risks\.length \? 'warn' : 'about'\}/);
  assert.doesNotMatch(screen, /riskAbout/);
});

test("flaw 13: a column with cards below its edge fades there, so a cut card reads as «more»", () => {
  const css = readFileSync(new URL("./depth.module.css", import.meta.url), "utf8");
  assert.match(css, /\.pulseBody\[data-more\] \{[^}]*mask-image: linear-gradient\(to bottom/);
  const screen = readFileSync(new URL("./Pulse.tsx", import.meta.url), "utf8");
  assert.match(screen, /data-more=\{below \? '' : undefined\}/);
});

test("flaw 116: a card's logo tries the logo the market already knows for its mint before a letter", () => {
  const row = { mint: "SiNu1111111111111111111111111111111111111pump", icon: null, ryntra: null };
  const known = "https://static.datapi.jup.ag/token-icons/si.webp";
  const bare = pulseLogo(row, undefined);
  assert.equal(bare.src, `/api/icon/${row.mint}`, "with nothing known, the engine's route by mint");
  const told = pulseLogo(row, known);
  assert.equal(told.src, `/api/spot/icon?mint=${row.mint}&u=${encodeURIComponent(known)}`, "the known logo first, through the engine's proxy");
  assert.ok(told.also.includes(`/api/icon/${row.mint}`), "then the route by mint");
  const own = pulseLogo({ ...row, icon: "https://example.org/own.png" }, known);
  assert.equal(own.src, cardLogo({ ...row, icon: "https://example.org/own.png" }), "the feed's own picture stays first");
  assert.ok(own.also.some((src) => src.includes(encodeURIComponent(known))), "the known logo is the next try");
  assert.equal(new Set([own.src, ...own.also]).size, own.also.length + 1, "no address twice");
  for (const src of [own.src, ...own.also]) assert.ok(src.startsWith("/api/"), "every address is the engine's own");
});
