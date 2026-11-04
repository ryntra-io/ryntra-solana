import assert from "node:assert/strict";
import test from "node:test";

import { DBC_TOKEN_AUTHORITY, LAUNCH_PRESETS } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { launchNetwork } from "../../../lib/launch/config.server.ts";
import { launchPresetsView } from "../../../lib/launch/runtime.server.ts";
import { pct, sinceLaunch, sol, span, usd } from "./format.ts";
import { CITY_DEFAULT_PRESET, CITY_LAUNCH_MAINNET, CITY_LAUNCH_SWITCH, CITY_PRESETS, cityLaunchOpen, cityPreset, cityPresets } from "./gate.ts";
import { costLine, launchFacts, reviewRows, ruleLines, shieldLine } from "./terms.ts";
import { clockText, launchWindowNow, windowLine } from "./launch-window.ts";
import { TERMS_WORDS } from "./words.ts";
import { LAUNCH } from "../../components/launch/words.ts";
import { useLangStore } from "../i18n/lang.ts";

/* The engine's own answers: the devnet stand and mainnet, as their servers build them. */
const DEVNET = launchPresetsView(launchNetwork({ RYNTRA_LAUNCH_STAND: "devnet", RYNTRA_LAUNCH_PUBLIC_ORIGIN: "https://stand.example.org" }));
const MAINNET = launchPresetsView(launchNetwork({}));

test("the city launches on Protected where the engine offers it, then Classic, never on a preset that locks", () => {
  assert.equal(cityPreset(DEVNET)?.id, "protected");
  assert.equal(cityPreset(MAINNET)?.id, "protected");
  assert.equal(cityPreset({ presets: DEVNET.presets.filter((preset) => preset.id !== "protected") })?.id, "classic");
  assert.equal(cityPreset({ presets: DEVNET.presets.filter((preset) => preset.id === "micro" || preset.id === "community") }), null);
  assert.equal(cityPreset(null), null);
  for (const id of CITY_PRESETS) assert.equal(LAUNCH_PRESETS[id].creatorLockMinDays, null, id);
});

test("the default preset is one line, and the other is one switch away; a choice the engine does not serve falls to the other", () => {
  /* The 29.10 strategy flips this to Classic only on the operator's confirmation. */
  assert.equal(CITY_DEFAULT_PRESET, "protected");
  assert.equal(cityPreset(DEVNET, "classic")?.id, "classic");
  assert.equal(cityPreset(DEVNET, "protected")?.id, "protected");
  assert.equal(cityPreset(MAINNET, "classic")?.id, "classic");
  assert.equal(cityPreset({ presets: DEVNET.presets.filter((preset) => preset.id !== "classic") }, "classic")?.id, "protected");
  const served = cityPresets(DEVNET);
  assert.equal(served.classic?.id, "classic");
  assert.equal(served.protected?.id, "protected");
  assert.deepEqual(cityPresets(null), { classic: null, protected: null });
});

test("devnet is open; mainnet opens, given in this one value", () => {
  assert.equal(CITY_LAUNCH_MAINNET, true);
  assert.equal(cityLaunchOpen("solana:devnet", undefined, true), true);
  assert.equal(cityLaunchOpen("solana:mainnet", undefined, true), true);
  assert.equal(cityLaunchOpen("solana:mainnet", false, true), false);
  assert.equal(cityLaunchOpen(null, true, true), false);
});

test("without the deployment's switch set to open, Launch stays closed on every network", () => {
  assert.equal(CITY_LAUNCH_SWITCH, process.env.NEXT_PUBLIC_RYNTRA_CITY_LAUNCH === "open");
  for (const network of ["solana:devnet", "solana:mainnet", null]) assert.equal(cityLaunchOpen(network, true, false), false, String(network));
});

test("the three lines under the fields are the engine's figures", () => {
  assert.deepEqual(ruleLines(cityPreset(DEVNET)), ["Bots pay 50% → 1% in the first 10 min", "Liquidity locked forever at $75K", "32% of every trading fee is yours"]);
  const classic = DEVNET.presets.find((preset) => preset.id === "classic");
  assert.deepEqual(ruleLines(classic), ["Bots pay 20% → 1% in the first 2 min", "Liquidity locked forever at $75K", "32% of every trading fee is yours"]);
  /* Another figure from the engine is another line: nothing is written into the city. */
  const changed = { ...classic, graduationMarketCapUsd: 120_000, terms: { ...classic.terms, curveSplit: { creatorBps: 2400, ryntraBps: 5600, meteoraBps: 2000 } } };
  assert.deepEqual(ruleLines(changed).slice(1), ["Liquidity locked forever at $120K", "24% of every trading fee is yours"]);
});

test("the review says what the launch signs up to: the one line first, then rows of at most two lines behind «i»", () => {
  const rows = reviewRows(cityPreset(DEVNET), "solana:devnet");
  assert.deepEqual(
    rows.map((row) => row.id),
    ["line", "fees", "yours", "pool", "forever", "route", "cost", "network"],
  );
  const details = rows.filter((row) => row.id !== "line");
  for (const row of details) assert.ok(row.lines.length >= 1 && row.lines.length <= 2, row.id);
  /* One line each on a 390 px phone, so a row never grows past two. */
  for (const preset of DEVNET.presets) for (const row of reviewRows(preset, "solana:devnet", "9874320").filter((r) => r.id !== "line")) for (const line of row.lines) assert.ok(line.length <= 52, `${preset.id} ${row.id}: ${line}`);
  for (const row of details) for (const line of row.lines) assert.ok(line.length <= 52, `${row.id}: ${line}`);
  const text = (id) => rows.find((row) => row.id === id).lines.join(" ");
  assert.equal(text("fees"), "Bots pay 50% → 1% in the first 10 min. Then 1% a trade, more when the price swings.");
  assert.equal(text("yours"), "32% of every trading fee, from the first trade. 40% of the 2% fee when it moves to the pool.");
  assert.equal(rows.find((row) => row.id === "pool").label, "At $75K");
  assert.equal(text("pool"), "Moves to a Meteora pool. Liquidity locked forever. Your locked part earns up to 20% of the pool’s fees.");
  assert.equal(text("forever"), "Name, ticker and picture can never be changed. 1,000,000,000 coins, and no one can mint more.");
  assert.match(text("cost"), /^No launch fee/);
  assert.equal(text("network"), "Solana devnet: test coins, no real money.");
  assert.equal(reviewRows(cityPreset(MAINNET), "solana:mainnet").find((row) => row.id === "network").lines[0], "Solana mainnet.");
});

test("once the engine simulated the launch, the review says its cost, rounded up", () => {
  const cost = reviewRows(cityPreset(DEVNET), "solana:devnet", "9874320").find((row) => row.id === "cost");
  assert.deepEqual(cost.lines, ["0.0099 SOL of rent and fee, simulated by Solana."]);
});

test("«can never be changed» holds for every preset the city launches on", () => {
  for (const id of CITY_PRESETS) {
    assert.equal(LAUNCH_PRESETS[id].token.authority, DBC_TOKEN_AUTHORITY.IMMUTABLE, id);
    assert.equal(LAUNCH_PRESETS[id].poolCreationFeeLamports, 0, id);
  }
});

test("figures read short and are never rounded into more than they are", () => {
  assert.equal(pct(5000), "50%");
  assert.equal(pct(250), "2.5%");
  assert.equal(pct(3333), "33.33%");
  assert.equal(usd(75_000), "$75K");
  assert.equal(usd(3594.74), "$3.6K");
  assert.equal(usd(18_400), "$18K");
  assert.equal(usd(1_250_000), "$1.25M");
  assert.equal(usd(640), "$640");
  assert.equal(span(600), "10 min");
  assert.equal(span(45), "45 s");
  assert.equal(span(5400), "1.5 h");
  assert.equal(sol("9874320"), "0.0099");
  assert.equal(sol("10000000"), "0.0100");
  assert.equal(sol("1"), "0.0001");
  const at = Date.parse("2026-10-26T12:00:00Z");
  assert.equal(sinceLaunch("2026-10-26T12:00:00Z", at + 42_000), "T+00:42");
  assert.equal(sinceLaunch("2026-10-26T12:00:00Z", at + 3_725_000), "T+1:02:05");
  assert.equal(sinceLaunch("2026-10-26T12:00:00Z", at + 12.5 * 86_400_000), "Day 12");
  assert.equal(sinceLaunch(null, at), null);
});

/* ---------------------------------------------------------------- the launch sheet (CITY-143) */

const line = (preset) => reviewRows(preset, "solana:devnet").find((row) => row.id === "line").lines;
const PROTECTED = cityPreset(DEVNET);
const CLASSIC = DEVNET.presets.find((preset) => preset.id === "classic");

test("the one line before the signature is the engine's split through Ryntra, the exit and the risk", () => {
  /* The strategy's line (SPEC «Створення»): «Комісія 1 % · тобі 32 % · Ryntra 52 % · Meteora 16 % · вихід 2 %: тобі 40 % / Ryntra 60 % · …». */
  assert.deepEqual(line(PROTECTED), ["Fee 1%", "you 32%", "Ryntra 52%", "Meteora 16%", "exit 2%: you 40% / Ryntra 60%", "most new coins lose value"]);
  assert.deepEqual(line(CLASSIC), line(PROTECTED));
  /* The same on mainnet: the presets' terms are one table. */
  assert.deepEqual(line(cityPreset(MAINNET)), line(PROTECTED));
  for (const part of line(PROTECTED)) assert.ok(part.length <= 40, part);
});

test("another app's route is the row behind «i», not the line", () => {
  const route = reviewRows(PROTECTED, "solana:devnet").find((row) => row.id === "route");
  assert.equal(route.label, "Through other apps");
  assert.deepEqual(route.lines, ["You 32% · Ryntra 48% · Meteora 20% of a fee.", "When a trade does not go through Ryntra."]);
  /* Where both routes split alike there is nothing to say behind «i». */
  const same = { ...CLASSIC, terms: { ...CLASSIC.terms, curveSplit: CLASSIC.terms.curveSplitThroughRyntra } };
  assert.equal(reviewRows(same, "solana:devnet").some((row) => row.id === "route"), false);
});

test("the line follows the engine's figures: nothing in it is written into the city", () => {
  const changed = {
    ...CLASSIC,
    sniperFee: { ...CLASSIC.sniperFee, endBps: 150 },
    terms: { ...CLASSIC.terms, curveSplitThroughRyntra: { creatorBps: 4000, ryntraBps: 4400, meteoraBps: 1600 }, graduation: { ...CLASSIC.terms.graduation, feeBps: 300, creatorBps: 5000, ryntraBps: 5000 } },
  };
  assert.deepEqual(line(changed), ["Fee 1.5%", "you 40%", "Ryntra 44%", "Meteora 16%", "exit 3%: you 50% / Ryntra 50%", "most new coins lose value"]);
  /* Ryntra's part of an exit that is the market's budget is not said as Ryntra's. */
  const budget = { ...CLASSIC, terms: { ...CLASSIC.terms, graduation: { ...CLASSIC.terms.graduation, toBudget: true } } };
  assert.equal(line(budget)[4], "exit 2%: you 40%");
  /* An older engine without the split: the creator's share alone, and no route row. */
  const older = { ...CLASSIC, terms: undefined };
  assert.deepEqual(line(older), ["Fee 1%", "you 40% after Meteora's part", "exit 2%: you 40%", "most new coins lose value"]);
  assert.equal(reviewRows(older, "solana:devnet").some((row) => row.id === "route"), false);
});

test("the cost line comes first: no launch fee, then the network's cost once Solana simulated it", () => {
  assert.deepEqual(costLine(PROTECTED), ["No launch fee", "network fee only"]);
  assert.deepEqual(costLine(PROTECTED, "9874320"), ["No launch fee", "network ≈ 0.0099 SOL"]);
  for (const id of CITY_PRESETS) assert.equal(LAUNCH_PRESETS[id].poolCreationFeeLamports, 0, id);
});

test("the bot shield says what bots pay at the start; the two facts are the engine's", () => {
  assert.equal(shieldLine(PROTECTED), "50% → 1% · 10 min");
  assert.equal(shieldLine(CLASSIC), "20% → 1% · 2 min");
  assert.deepEqual(launchFacts(PROTECTED), [
    { id: "dex", label: "Moves to a DEX at", value: "$75K" },
    { id: "locked", label: "Liquidity locked", value: "Forever" },
  ]);
  assert.equal(launchFacts({ ...PROTECTED, graduationMarketCapUsd: 120_000 })[0].value, "$120K");
  assert.equal(PROTECTED.lpLockedForeverPct, 100);
});

test("in Ukrainian the sheet says the same figures in its own words", () => {
  useLangStore.setState({ lang: "uk" });
  try {
    assert.deepEqual(line(PROTECTED), ["Комісія 1%", "тобі 32%", "Ryntra 52%", "Meteora 16%", "вихід 2%: тобі 40% / Ryntra 60%", "більшість нових монет дешевшає"]);
    assert.deepEqual(costLine(PROTECTED, "9874320"), ["Без комісії за запуск", "мережа ≈ 0,0099 SOL"]);
    assert.equal(shieldLine(PROTECTED), "50% → 1% · 10 хв");
    assert.equal(reviewRows(PROTECTED, "solana:devnet").find((row) => row.id === "route").lines[0], "Тобі 32% · Ryntra 48% · Meteora 20% з комісії.");
    assert.equal(LAUNCH.uk.promise, "Твій гаманець підписує. Ryntra не може рухати твою монету чи твої кошти.");
  } finally {
    useLangStore.setState({ lang: "en" });
  }
});

test("the sheet never says a check found nothing: no word of it claims the picture or the coin passed", () => {
  /* The engine's store does not say whether the picture check ran (it may be off on the stand), and INCOMPLETE is never «no obstacles». */
  const claims = /no (known )?(blocker|obstacle|risk)|passed|verified|checked|safe|перешкод немає|перевірено|безпечн/i;
  for (const dict of [LAUNCH, TERMS_WORDS]) {
    for (const lang of ["en", "uk"]) {
      for (const [key, value] of Object.entries(dict[lang])) {
        if (key === "notVerified") continue; // «Not verified by Jupiter» says the opposite.
        const text = typeof value === "function" ? value(...Array.from({ length: value.length }, () => "1")) : value;
        assert.doesNotMatch(text, claims, `${lang}.${key}: ${text}`);
      }
    }
  }
});

test("the windows' clock reads the engine's schedule and promises nothing", () => {
  const at = (iso) => Date.parse(iso);
  assert.deepEqual(launchWindowNow(at("2026-10-31T12:04:00Z")), { open: true, kind: "hourly", ms: 6 * 60_000 });
  assert.deepEqual(launchWindowNow(at("2026-10-31T12:30:00Z")), { open: false, kind: "hourly", ms: 30 * 60_000 });
  assert.deepEqual(launchWindowNow(at("2026-10-31T20:05:00Z")), { open: true, kind: "evening", ms: 25 * 60_000 });
  assert.deepEqual(launchWindowNow(at("2026-10-31T19:40:00Z")), { open: false, kind: "evening", ms: 20 * 60_000 });
  assert.equal(clockText(6 * 60_000), "6:00");
  assert.equal(clockText(754_200), "12:35");
  assert.equal(clockText(3_729_000), "1:02:09");
  assert.equal(clockText(-5), "0:00");
  assert.equal(windowLine(at("2026-10-31T12:30:00Z")), "Launch window in 30:00");
  assert.equal(windowLine(at("2026-10-31T20:05:00Z")), "Evening window open · 25:00");
  for (const text of [windowLine(at("2026-10-31T12:04:00Z")), windowLine(at("2026-10-31T19:40:00Z"))]) assert.doesNotMatch(text, /fair|equal|guarantee/i);
});
