import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { needsDevelopmentRepository } from "../development-repository.mjs";
import { LaunchMarketHealthResponseSchema, LaunchMarketsResponseSchema } from "../api/v1/contract.ts";
import { JOURNAL_ENFORCEMENT, JOURNAL_KINDS } from "../core/launch/autopilot.ts";
import { marketBudget } from "./budget.server.ts";
import { launchNetwork } from "./config.server.ts";
import { marketHealth, marketRow } from "./health.server.ts";
import { marketOrder, unreadRow } from "./markets.server.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const example = (name) => JSON.parse(read(`docs/api/examples/v1/${name}`));
const EXAMPLES = { skip: needsDevelopmentRepository("the API's examples under docs/api/examples") };
const NETWORK = launchNetwork({});

const row = (overrides) => ({
  token: "So11111111111111111111111111111111111111112",
  launchedAt: "2026-10-08T00:00:00.000Z",
  traded24h: null,
  state: null,
  ...overrides,
});

test("the list's order is the data's own: a trade in the last day first, then the furthest along the cycle, then the newest", () => {
  const rows = [
    row({ token: "A", traded24h: false, state: { code: "CORE_MARKET_LIVE", since: null }, launchedAt: "2026-10-01T00:00:00.000Z" }),
    row({ token: "B", traded24h: true, state: { code: "PRICE_DISCOVERY", since: null }, launchedAt: "2026-10-02T00:00:00.000Z" }),
    row({ token: "C", traded24h: null, state: null, launchedAt: "2026-10-09T00:00:00.000Z" }),
    row({ token: "D", traded24h: false, state: { code: "CORE_MARKET_LIVE", since: null }, launchedAt: "2026-10-05T00:00:00.000Z" }),
    row({ token: "E", traded24h: false, state: { code: "LADDER_ACTIVE", since: null }, launchedAt: "2026-09-30T00:00:00.000Z" }),
  ];
  assert.deepEqual([...rows].sort(marketOrder).map((entry) => entry.token), ["B", "E", "D", "A", "C"], "live first; then the ladder, the core markets newest first; a row not read last");
});

test("a market not read says so: every figure null, never a zero, and its budget not counted", () => {
  const record = {
    cluster: "mainnet",
    state: "LAUNCHED",
    token: "So11111111111111111111111111111111111111112",
    pool: "So11111111111111111111111111111111111111112",
    config: "B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G",
    pairMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    preset: "classic",
    creator: "So11111111111111111111111111111111111111112",
    name: "Unread",
    symbol: "UNRD",
    metadataUri: "https://ryntra.io/api/launch/metadata/x",
    signature: "1".repeat(64),
    validUntil: "0",
    firstBuyInRaw: "0",
    firstBuyOutRaw: "0",
    lock: null,
    buildId: "0".repeat(32),
    referralCode: null,
    launchedAt: "2026-10-08T00:00:00.000Z",
  };
  const failed = {
    record,
    name: "Unread",
    symbol: "UNRD",
    image: null,
    technicalValidation: false,
    walletsComplete: true,
    executor: null,
    runs: { acts: false, ladder: false },
    ladder: { state: "NONE" },
    lastAction: null,
    lock: null,
    basics: null,
    figures: null,
    observedAt: "2026-10-09T12:00:00.000Z",
  };
  const unread = marketRow(failed, NETWORK);
  assert.equal(unread.read, false);
  for (const key of ["state", "venue", "progress", "poolLiquidity", "depth5Raw", "daysSinceDex", "traded24h", "holders", "creatorLock", "creatorSold"]) assert.equal(unread[key], null, `${key} is null when not read`);
  assert.deepEqual(unread.budget, { state: "NOT_COUNTED", earnedRaw: null, reserveRaw: null, ladder: "NONE", deployed: null });
  assert.ok(LaunchMarketsResponseSchema.safeParse({ network: "solana:mainnet", markets: [unread], complete: false, observedAt: "2026-10-09T12:00:00.000Z" }).success);
  assert.equal(marketHealth(failed, NETWORK, null), null, "no health is made up from a read that failed");
  /* A row the budget did not reach keeps the lock its record holds — never «no lock» for a creator who locked. */
  const deps = { network: NETWORK, now: () => new Date("2026-10-09T12:00:00.000Z") };
  const locked = unreadRow({ ...record, lock: { schedule: "3m-6m", escrow: "So11111111111111111111111111111111111111112", signature: null, state: "LOCKED", reason: null } }, deps, false);
  assert.deepEqual(locked.creatorLock, { escrow: "So11111111111111111111111111111111111111112", cliffAt: null, endsAt: null });
  assert.equal(locked.read, false);
  assert.equal(unreadRow({ ...record, lock: { schedule: "3m-6m", escrow: "So11111111111111111111111111111111111111112", signature: null, state: "PENDING", reason: null } }, deps, false).creatorLock, null, "a lock not confirmed is not said");
  assert.equal(unreadRow(record, deps, false).creatorLock, null);
});

test("the budget: not counted until Ryntra accounts it — earned and reserve null, what stands in the ladder read from it", () => {
  assert.deepEqual(marketBudget({ state: "NONE" }), { state: "NOT_COUNTED", earnedRaw: null, reserveRaw: null, ladder: "NONE", deployed: null });
  assert.deepEqual(marketBudget({ state: "UNREAD", pool: "p", position: null }), { state: "NOT_COUNTED", earnedRaw: null, reserveRaw: null, ladder: "UNREAD", deployed: null });
  const placed = marketBudget({ state: "PLACED", pool: "p", position: "q", pairRaw: "59989995", tokensRaw: "0", bins: [], lowerPrice: 1, upperPrice: 2 });
  assert.deepEqual(placed.deployed, { pairRaw: "59989995", tokensRaw: "0" });
  assert.equal(placed.earnedRaw, null);
});

test("the examples' health: depth rises with the drop, Ryntra's steps a part of it, the line of rules and policies marked", EXAMPLES, () => {
  const list = example("launch-markets.response.json");
  for (const name of ["launch-health.response.json", "launch-health-curve.response.json"]) {
    const health = example(name);
    assert.ok(LaunchMarketHealthResponseSchema.safeParse(health).success, name);
    const depth = health.depth.map((level) => BigInt(level.pairRaw));
    assert.ok(depth[0] < depth[1] && depth[1] < depth[2], `${name}: depth at −2 < −5 < −10 %`);
    for (const level of health.depth) if (level.ladderRaw !== null) assert.ok(BigInt(level.ladderRaw) <= BigInt(level.pairRaw));
    assert.equal(health.budget.state, "NOT_COUNTED");
    assert.equal(health.budget.earnedRaw, null);
    assert.ok(health.rules.every((rule) => (rule.enforcement === "policy") === (rule.by === "ryntra")), "a policy is Ryntra's server's, a rule a program's");
  }
  const curve = example("launch-health-curve.response.json");
  assert.equal(curve.technicalValidation, true, "Ryntra's own launch is marked");
  assert.equal(curve.survival.daysSinceDex, null);
  assert.deepEqual(
    curve.rules.filter((rule) => rule.enforcement === "rule").map((rule) => rule.code),
    ["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK", "CONFIG_FIXED", "CURVE_HOLDS_FUNDS", "GRADUATION_AT_THRESHOLD"],
    "the token's own rules, the config, the curve's",
  );
  assert.equal(curve.rulesComplete, true);
  assert.ok(!curve.rules.some((rule) => rule.code === "GRADUATION_BY_RYNTRA"), "no executor acts there: no graduation of Ryntra's is claimed");
  assert.equal(curve.engine.acts, false);
  const owl = example("launch-health.response.json");
  assert.deepEqual(owl.rules.filter((rule) => rule.code === "LP_LOCKED_FOREVER").map((rule) => rule.values.owner), ["creator", "partner"], "each locked share named by whose it is");
  assert.equal(owl.engine.acts, true);
  assert.equal(owl.state.code, "LADDER_ACTIVE");
  assert.ok(owl.ladder && owl.ladder.pairFrom !== null && owl.ladder.pairFrom <= owl.ladder.pairTo);
  assert.ok((String(list.markets[0].poolLiquidity.pair).split(".")[1] ?? "").length <= 6, "no float noise in an answer");
  assert.deepEqual(list.markets.map((entry) => entry.symbol), ["EXOWL", "EXCAT"], "the market traded in the last day stands first");
  assert.equal(example("launch-journal.response.json").total, example("launch-journal.response.json").events.length);
});

test("every flight-log entry names what governs it: the launch, the lock, the shared fees and the graduation are rules; Ryntra's liquidity a policy; a sale of the creator's is observed", EXAMPLES, () => {
  assert.deepEqual(Object.keys(JOURNAL_ENFORCEMENT).sort(), [...JOURNAL_KINDS].sort());
  assert.equal(JOURNAL_ENFORCEMENT.CREATOR_SOLD, null);
  for (const kind of ["LAUNCHED", "CREATOR_LOCKED", "FEES_SHARED", "GRADUATED"]) assert.equal(JOURNAL_ENFORCEMENT[kind], "rule", kind);
  for (const kind of JOURNAL_KINDS.filter((kind) => kind.startsWith("FLOOR_"))) assert.equal(JOURNAL_ENFORCEMENT[kind], "policy", kind);
  const log = example("launch-journal.response.json");
  assert.ok(log.events.every((entry) => entry.enforcement === JOURNAL_ENFORCEMENT[entry.kind]));
});

test("«Лаунчі на Ryntra» is a page anyone opens, in the Launch section, and its words promise no price", () => {
  const board = read("app/app/launch/markets/markets-board.tsx");
  assert.doesNotMatch(board, /useSolanaConnection|useWalletProof/, "the list needs no wallet");
  assert.match(read("app/shell/domains.ts"), /id: "launch-markets"[^\n]*href: "\/app\/launch\/markets"/);
  const health = read("app/app/launch/[mint]/market-health.tsx");
  for (const source of [board, health]) assert.match(source, /word\("noGuarantee"\)/, "the line that no price is guaranteed stands under the figures");
  assert.doesNotMatch(board + health, /рекомендуємо|recommended|\btop\b/i, "no hand-picked top, no recommendation");
});
