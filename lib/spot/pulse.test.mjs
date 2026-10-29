import assert from "node:assert/strict";
import test from "node:test";

import {
  activeFilters,
  dbcCurveOf,
  feedRows,
  isPulseFeed,
  launchlabCurveOf,
  launchpadName,
  mergeRows,
  MOVERS_MIN_LIQUIDITY_USD,
  passesFilter,
  PULSE_FILTER_NONE,
  pulseHref,
  pulseRowOf,
  pulseWindowOf,
  pumpCurveOf,
  readPulseFilter,
  SOON_MIN_PCT,
} from "./pulse.ts";

const NOW = Date.parse("2026-10-12T12:00:00Z");
const MINT = "4CJfADKLXAKzv8meQ3rywzQULGN535WAMJJUGWZnpump";

function raw(overrides = {}) {
  return {
    id: MINT,
    name: "Three Fen",
    symbol: "3FEN",
    decimals: 6,
    launchpad: "pump.fun",
    mcap: 3694.5,
    usdPrice: 0.0000036945,
    liquidity: 3280.1,
    holderCount: 12,
    stats5m: { priceChange: 17.9, buyVolume: 7.8, sellVolume: 1.3 },
    stats1h: { priceChange: 17.9, buyVolume: 7.8, sellVolume: 1.3 },
    stats6h: { priceChange: 17.9, buyVolume: 7.8, sellVolume: 1.3 },
    stats24h: { priceChange: 17.9, buyVolume: 7.8, sellVolume: 1.3 },
    firstPool: { id: MINT, createdAt: "2026-10-12T11:59:00Z" },
    audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devBalancePercentage: 0.1, topHoldersPercentage: 31.5 },
    organicScoreLabel: "low",
    tags: ["unknown", "token-2022"],
    ...overrides,
  };
}

function row(overrides = {}) {
  const base = pulseRowOf(raw(), NOW);
  assert.ok(base);
  return { ...base, ...overrides };
}

function u64le(value) {
  const bytes = new Uint8Array(8);
  let rest = BigInt(value);
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

test("the five feeds and their windows", () => {
  for (const feed of ["new", "soon", "dex", "trending", "movers"]) assert.equal(isPulseFeed(feed), true);
  assert.equal(isPulseFeed("toptraders"), false, "«Топ-трейдери» comes with the signals task, not before");
  assert.equal(pulseWindowOf("trending", "m5"), "m5");
  assert.equal(pulseWindowOf("movers", "m5"), "h24", "movers are the hour or the day");
  assert.equal(pulseWindowOf("movers", "h1"), "h1");
});

test("a Jupiter row becomes a Pulse row with the four windows and the launchpad's own name", () => {
  const value = pulseRowOf(raw(), NOW);
  assert.ok(value);
  assert.equal(value.launchpad, "pump.fun");
  assert.equal(value.windows.m5.changePct, 17.9);
  assert.ok(Math.abs(value.windows.h24.volumeUsd - 9.1) < 1e-9);
  assert.equal(value.top10Pct, 31.5);
  assert.deepEqual(value.notices, []);
  assert.equal(value.auditRead, true);
  assert.equal(pulseRowOf(raw({ audit: undefined }), NOW).auditRead, false, "a row with no audit has its facts unread");
  assert.equal(launchpadName("met-dbc"), "Meteora", "a launchpad by its name, not the engine's (B2b)");
  assert.equal(launchpadName("letsbonk.fun"), "bonk.fun");
});

test("the facts against a token are the token page's own — a right still on, Jupiter's flag", () => {
  const value = pulseRowOf(raw({ audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: true, isSus: true } }), NOW);
  assert.deepEqual([...value.notices].sort(), ["FLAGGED", "MINT_AUTHORITY"]);
});

test("a right still on is read from its authority at the top of the row: Jupiter sends no *Disabled key for it", () => {
  /* ORCA as Jupiter answers it: freezing off, minting on by an address, no mintAuthorityDisabled. */
  const orca = pulseRowOf(raw({ audit: { freezeAuthorityDisabled: true }, mintAuthority: "GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV" }), NOW);
  assert.deepEqual([...orca.notices], ["MINT_AUTHORITY"]);
  assert.equal(orca.auditRead, true);
  /* USDC: both rights on by their addresses, an audit with neither key. */
  const usdc = pulseRowOf(raw({ audit: {}, mintAuthority: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG", freezeAuthority: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar" }), NOW);
  assert.deepEqual([...usdc.notices].sort(), ["FREEZE_AUTHORITY", "MINT_AUTHORITY"]);
  /* Neither stated: not read, never «none». */
  const unstated = pulseRowOf(raw({ audit: { topHoldersPercentage: 30 } }), NOW);
  assert.equal(unstated.auditRead, false);
  assert.equal(passesFilter(unstated, { ...PULSE_FILTER_NONE, noNotices: true }, "h1", NOW), false);
});

test("a tokenized stock is not a Pulse row", () => {
  assert.equal(pulseRowOf(raw({ tags: ["verified", "xstocks"], name: "Apple xStock", symbol: "AAPLx" }), NOW), null);
});

test("a pump.fun curve is as far as the share of its 793.1 M tokens sold, and full when it says so", () => {
  const data = new Uint8Array(166);
  data.set(u64le(698_609_410_983_915n), 24);
  const curve = pumpCurveOf(data);
  assert.equal(curve.venue, "pump");
  assert.ok(Math.abs(curve.progressPct - 11.91) < 0.02);
  assert.equal(curve.complete, false);
  /* More tokens than the curve started with (sold back): nothing sold, not a negative share. */
  data.set(u64le(797_454_078_947_948n), 24);
  assert.equal(pumpCurveOf(data).progressPct, 0);
  data[48] = 1;
  assert.deepEqual(pumpCurveOf(data), { venue: "pump", progressPct: 100, complete: true });
  assert.equal(pumpCurveOf(new Uint8Array(20)), null);
});

test("a LaunchLab curve is the quote raised against the quote it raises before the DEX", () => {
  const data = new Uint8Array(429);
  data.set(u64le(1_611_465_162n), 61);
  data.set(u64le(85_000_000_000n), 69);
  const curve = launchlabCurveOf(data);
  assert.equal(curve.venue, "launchlab");
  assert.ok(Math.abs(curve.progressPct - 1.89) < 0.01);
  data[17] = 2;
  assert.equal(launchlabCurveOf(data).complete, true, "a status off the curve is full");
});

test("a DBC curve is its quote against the config's threshold", () => {
  assert.equal(dbcCurveOf(50n, 200n, false).progressPct, 25);
  assert.equal(dbcCurveOf(10n, 200n, true).complete, true);
  assert.equal(dbcCurveOf(10n, 0n, false), null);
});

test("filters: a bound left empty asks nothing, an unstated figure never passes a bound", () => {
  assert.equal(passesFilter(row(), PULSE_FILTER_NONE, "h1", NOW), true);
  assert.equal(passesFilter(row(), { ...PULSE_FILTER_NONE, marketCapMin: 5_000 }, "h1", NOW), false);
  assert.equal(passesFilter(row(), { ...PULSE_FILTER_NONE, marketCapMax: 5_000 }, "h1", NOW), true);
  assert.equal(passesFilter(row({ holders: null }), { ...PULSE_FILTER_NONE, holdersMin: 1 }, "h1", NOW), false);
  assert.equal(passesFilter(row(), { ...PULSE_FILTER_NONE, ageMaxHours: 1 }, "h1", NOW), true);
  assert.equal(passesFilter(row(), { ...PULSE_FILTER_NONE, top10Max: 30 }, "h1", NOW), false);
  assert.equal(passesFilter(row({ notices: ["FLAGGED"] }), { ...PULSE_FILTER_NONE, noNotices: true }, "h1", NOW), false);
  /* A token a minute old carries «under ten minutes on the market» (SOL-C5): an hour old, with nothing past a threshold, it passes. */
  assert.equal(passesFilter(row(), { ...PULSE_FILTER_NONE, noNotices: true }, "h1", NOW), false);
  assert.equal(passesFilter(row({ firstPoolAt: "2026-10-12T11:00:00Z", creatorLaunches: 1 }), { ...PULSE_FILTER_NONE, noNotices: true }, "h1", NOW), true);
  assert.equal(passesFilter(row({ firstPoolAt: "2026-10-12T11:00:00Z" }), { ...PULSE_FILTER_NONE, noNotices: true }, "h1", NOW), false, "the creator's history not stated is not «none»");
  assert.equal(passesFilter(row({ auditRead: false }), { ...PULSE_FILTER_NONE, noNotices: true }, "h1", NOW), false, "facts not read are not «none»");
  assert.equal(activeFilters({ ...PULSE_FILTER_NONE, marketCapMin: 1, noNotices: true }), 2);
  assert.deepEqual(readPulseFilter({ marketCapMin: -3, liquidityMin: 5_000, noNotices: "yes" }), { ...PULSE_FILTER_NONE, liquidityMin: 5_000 });
  assert.deepEqual(readPulseFilter("nonsense"), PULSE_FILTER_NONE);
});

const ours = (overrides = {}) => ({ preset: "protected", technicalValidation: true, launchedAt: "2026-10-12T10:00:00Z", traded24h: true, daysSinceDex: null, dollarPair: true, ...overrides });

test("«Нові»: first pools under an hour old, the newest first; Ryntra's markets of the last day first", () => {
  const older = row({ mint: "A".repeat(32), firstPoolAt: "2026-10-12T11:00:00Z" });
  const trending = row({ mint: "T".repeat(32), firstPoolAt: "2026-10-12T08:00:00Z" });
  const newer = row({ mint: "B".repeat(32), firstPoolAt: "2026-10-12T11:59:00Z" });
  const ryntra = row({ mint: "C".repeat(32), firstPoolAt: "2026-10-12T10:00:00Z", ryntra: ours() });
  const stale = row({ mint: "D".repeat(32), firstPoolAt: "2026-10-01T10:00:00Z", ryntra: ours({ launchedAt: "2026-10-01T10:00:00Z" }) });
  assert.deepEqual(feedRows("new", [older, trending, newer, ryntra, stale], "m5", NOW).map((value) => value.mint), ["C".repeat(32), "B".repeat(32), "A".repeat(32)], "a four-hour-old token is not «new»");
});

test("«Майже на DEX»: curves not yet full, furthest first, from the floor; Ryntra's on a curve at any point, first", () => {
  const curve = (pct, complete = false) => ({ venue: "pump", progressPct: pct, complete });
  const rows = [
    row({ mint: "A".repeat(32), curve: curve(40) }),
    row({ mint: "B".repeat(32), curve: curve(90) }),
    row({ mint: "C".repeat(32), curve: curve(SOON_MIN_PCT - 1) }),
    row({ mint: "D".repeat(32), curve: curve(100, true) }),
    row({ mint: "E".repeat(32), curve: { venue: "meteora-dbc", progressPct: 0.03, complete: false }, ryntra: ours() }),
    row({ mint: "F".repeat(32), curve: null }),
  ];
  assert.deepEqual(feedRows("soon", rows, "h1", NOW).map((value) => value.mint), ["E".repeat(32), "B".repeat(32), "A".repeat(32)]);
});

test("«Вийшли на DEX»: left the curve within a day, the latest first", () => {
  const rows = [
    row({ mint: "A".repeat(32), graduatedAt: "2026-10-12T09:00:00Z" }),
    row({ mint: "B".repeat(32), graduatedAt: "2026-10-12T11:00:00Z" }),
    row({ mint: "C".repeat(32), graduatedAt: "2026-10-10T11:00:00Z" }),
  ];
  assert.deepEqual(feedRows("dex", rows, "h24", NOW).map((value) => value.mint), ["B".repeat(32), "A".repeat(32)]);
  /* A Ryntra market Jupiter dates nothing for, whose own read says it reached the DEX today, stands first. */
  const dexToday = row({ mint: "R".repeat(32), graduatedAt: null, curve: { venue: "meteora-dbc", progressPct: 100, complete: true }, ryntra: ours({ daysSinceDex: 0 }) });
  const dexEarlier = row({ mint: "S".repeat(32), graduatedAt: null, curve: { venue: "meteora-dbc", progressPct: 100, complete: true }, ryntra: ours({ daysSinceDex: 2 }) });
  assert.deepEqual(feedRows("dex", [...rows, dexToday, dexEarlier], "h24", NOW).map((value) => value.mint), ["R".repeat(32), "B".repeat(32), "A".repeat(32)]);
});

test("«Тренди» keep Jupiter's order; Ryntra's markets that traded today go first, the quiet ones are not there", () => {
  const rows = [row({ mint: "A".repeat(32) }), row({ mint: "B".repeat(32) }), row({ mint: "C".repeat(32), ryntra: ours() }), row({ mint: "D".repeat(32), ryntra: ours({ traded24h: false }) })];
  assert.deepEqual(feedRows("trending", rows, "h1", NOW).map((value) => value.mint), ["C".repeat(32), "A".repeat(32), "B".repeat(32)]);
});

test("«Рухи»: the window's rise or fall, markets deep enough to mean it", () => {
  const moving = (mint, change, liquidity = MOVERS_MIN_LIQUIDITY_USD) => row({ mint, liquidityUsd: liquidity, windows: { ...row().windows, h1: { changePct: change, volumeUsd: 1 } } });
  const rows = [moving("A".repeat(32), 12), moving("B".repeat(32), 80), moving("C".repeat(32), -40), moving("D".repeat(32), 300, 900), moving("E".repeat(32), -5)];
  assert.deepEqual(feedRows("movers", rows, "h1", NOW).map((value) => value.mint), ["B".repeat(32), "A".repeat(32)]);
  assert.deepEqual(feedRows("movers", rows, "h1", NOW, true).map((value) => value.mint), ["C".repeat(32), "E".repeat(32)]);
});

test("rows merge by mint, the first kept, gaps filled", () => {
  const first = row({ curve: null, icon: null });
  const second = row({ curve: { venue: "pump", progressPct: 50, complete: false }, icon: "https://example.com/i.png" });
  const [merged] = mergeRows([first, second]);
  assert.equal(merged.curve.progressPct, 50);
  assert.equal(merged.icon, "https://example.com/i.png");
});

test("a row opens its own page — a Ryntra market its launch page — with a quick sum when one was tapped", () => {
  assert.equal(pulseHref({ mint: MINT, ryntra: null }), `/app/spot?mint=${MINT}`);
  assert.equal(pulseHref({ mint: MINT, ryntra: null }, 50), `/app/spot?mint=${MINT}&buy=50`);
  assert.equal(pulseHref({ mint: MINT, ryntra: ours() }, 10), `/app/launch/${MINT}?buy=10`);
});
