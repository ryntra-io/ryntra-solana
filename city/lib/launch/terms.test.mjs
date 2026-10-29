import assert from "node:assert/strict";
import test from "node:test";

import { DBC_TOKEN_AUTHORITY, LAUNCH_PRESETS } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { launchNetwork } from "../../../lib/launch/config.server.ts";
import { launchPresetsView } from "../../../lib/launch/runtime.server.ts";
import { pct, sinceLaunch, sol, span, usd } from "./format.ts";
import { CITY_LAUNCH_MAINNET, CITY_LAUNCH_SWITCH, CITY_PRESETS, cityLaunchOpen, cityPreset } from "./gate.ts";
import { reviewRows, ruleLines } from "./terms.ts";

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

test("devnet is open;", () => {
  assert.equal(CITY_LAUNCH_MAINNET, false);
  assert.equal(cityLaunchOpen("solana:devnet", undefined, true), true);
  assert.equal(cityLaunchOpen("solana:mainnet", undefined, true), false);
  assert.equal(cityLaunchOpen("solana:mainnet", true, true), true);
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

test("the review says what the launch signs up to, every row at most two lines", () => {
  const rows = reviewRows(cityPreset(DEVNET), "solana:devnet");
  assert.deepEqual(
    rows.map((row) => row.id),
    ["fees", "yours", "pool", "forever", "cost", "network"],
  );
  for (const row of rows) assert.ok(row.lines.length >= 1 && row.lines.length <= 2, row.id);
  /* One line each on a 390 px phone, so a row never grows past two. */
  for (const preset of DEVNET.presets) for (const row of reviewRows(preset, "solana:devnet", "9874320")) for (const line of row.lines) assert.ok(line.length <= 52, `${preset.id} ${row.id}: ${line}`);
  for (const row of rows) for (const line of row.lines) assert.ok(line.length <= 52, `${row.id}: ${line}`);
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
