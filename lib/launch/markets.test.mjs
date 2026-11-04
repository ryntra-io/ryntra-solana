import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { needsDevelopmentRepository } from "../development-repository.mjs";
import { LaunchMarketHealthResponseSchema, LaunchMarketsResponseSchema } from "../api/v1/contract.ts";
import { JOURNAL_ENFORCEMENT, JOURNAL_KINDS } from "../core/launch/autopilot.ts";
import { marketBudget } from "./budget.server.ts";
import { launchNetwork } from "./config.server.ts";
import { lockedPositions, marketHealth, marketRow } from "./health.server.ts";
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

test("«Лаунчі на Ryntra» is a page anyone opens, the row «Лаунч» of «Торгівля», and its words promise no price", () => {
  const board = read("app/app/launch/markets/markets-board.tsx");
  assert.doesNotMatch(board, /useSolanaConnection|useWalletProof/, "the list needs no wallet");
  assert.match(read("app/shell/domains.ts"), /launch: row\("launch", "\/app\/launch\/markets"/);
  const health = read("app/app/launch/[mint]/market-health.tsx");
  for (const source of [board, health]) assert.match(source, /word\("noGuarantee"\)/, "the line that no price is guaranteed stands under the figures");
  assert.doesNotMatch(board + health, /рекомендуємо|recommended|\btop\b/i, "no hand-picked top, no recommendation");
});

test("the operator's stop is a market's pause at any stage, before steps that stand still", async () => {
  const { marketPause } = await import("./health.server.ts");
  const runs = { acts: true, ladder: true };
  assert.deepEqual(marketPause({ stop: { scope: "market", at: "2026-10-09T12:00:00.000Z" }, migrated: false, ladder: "NONE", runs, ours: true }), { code: "OPERATOR", at: Date.parse("2026-10-09T12:00:00.000Z") / 1000 }, "on the curve too");
  assert.deepEqual(marketPause({ stop: { scope: "all", at: "2026-10-09T12:00:00.000Z" }, migrated: true, ladder: "PLACED", runs: { acts: false, ladder: false }, ours: true }).code, "OPERATOR");
  assert.deepEqual(marketPause({ stop: null, migrated: true, ladder: "PLACED", runs: { acts: true, ladder: false }, ours: true }), { code: "STOPPED", at: null });
  /* SOL-L1a, 1.47.0: whether the executor acts, not read, is no stop said on a guess — the operator's stop still holds. */
  assert.equal(marketPause({ stop: null, migrated: true, ladder: "PLACED", runs: { acts: false, ladder: false, unread: true }, ours: true }), null);
  assert.equal(marketPause({ stop: null, migrated: true, ladder: "PLACED", runs: { acts: false, ladder: false, unread: true }, ours: true, risks: { codes: ["DROP"], at: 1 } }), null);
  assert.equal(marketPause({ stop: { scope: "market", at: "2026-10-09T12:00:00.000Z" }, migrated: true, ladder: "PLACED", runs: { acts: false, ladder: false, unread: true }, ours: true }).code, "OPERATOR");
  assert.equal(marketPause({ stop: null, migrated: true, ladder: "NONE", runs: { acts: false, ladder: false }, ours: true }), null, "no steps, no executor: nothing of Ryntra's is paused");
  assert.equal(marketPause({ stop: null, migrated: true, ladder: "PLACED", runs, ours: true }), null);
  assert.deepEqual(marketPause({ stop: null, migrated: true, ladder: "PLACED", runs, ours: false }), { code: "STOPPED", at: null }, "steps on a market Ryntra did not launch stand still: the executor moves none there");
});

test("a budget's ladder runs wherever the executor acts — the operator's ladder stop opens only the operator's own money", async () => {
  /* $STAIR, 10.10: the executor placed and raised the demo market's ladder while its health read «paused» — the stop is closed on production. */
  const { ladderRunsFor, marketPause } = await import("./health.server.ts");
  const closed = { acts: true, ladder: false };
  for (const preset of ["demo", "micro"]) {
    assert.deepEqual(ladderRunsFor({ preset }, closed), { acts: true, ladder: true }, `${preset}: the budget's ladder`);
    assert.equal(marketPause({ stop: null, migrated: true, ladder: "PLACED", runs: ladderRunsFor({ preset }, closed), ours: true }), null);
  }
  for (const preset of ["classic", "protected"]) assert.deepEqual(ladderRunsFor({ preset }, closed), closed, `${preset}: the operator's ladder waits for its stop`);
  assert.deepEqual(ladderRunsFor({ preset: "demo" }, { acts: false, ladder: false }), { acts: false, ladder: false }, "no executor here: nothing runs");
});

test("the flight log's marks: the example carries them, the contract takes them, the page draws them without a wallet", EXAMPLES, async () => {
  const { LaunchJournalResponseSchema } = await import("../api/v1/contract.ts");
  const log = example("launch-journal.response.json");
  assert.ok(LaunchJournalResponseSchema.safeParse(log).success);
  assert.deepEqual(log.marks.map((mark) => [mark.kind, mark.state]), [["WATCH_STARTED", null], ["STATE", "CORE_MARKET_LIVE"], ["STATE", "LADDER_ACTIVE"]]);
  const events = new Set(log.events.map((entry) => entry.signature));
  assert.ok(log.marks.filter((mark) => mark.signature).every((mark) => events.has(mark.signature)), "a state rests on an entry of the log");
  assert.ok(!LaunchJournalResponseSchema.safeParse({ ...log, marks: [{ ...log.marks[0], kind: "INVENTED" }] }).success, "an unknown mark is refused");
  const page = read("app/app/launch/[mint]/flight-log.tsx");
  assert.match(page, /log\.marks \?\? \[\]/, "a log from before 1.37.0 has no marks and still draws");
});

test("the switch in the admin: a token Ryntra did not launch here is refused; a stop and a resume each mark the market", async () => {
  const { createMemoryGuardStore } = await import("../guard/store.ts");
  const { flipExecutor } = await import("./executor-admin.server.ts");
  const { journalMarks } = await import("./executor.server.ts");
  const store = createMemoryGuardStore();
  const network = { ...NETWORK, cluster: "devnet" };
  const token = "Tokn1111111111111111111111111111111111111111";
  await store.collection("launches").set(`solana:devnet:${token}`, { cluster: "devnet", state: "LAUNCHED", token, launchedAt: "2026-10-09T10:00:00.000Z" });
  await store.collection("launches").set("solana:devnet:Pend1111111111111111111111111111111111111111", { cluster: "devnet", state: "PENDING", token: "Pend1111111111111111111111111111111111111111", launchedAt: "2026-10-09T10:00:00.000Z" });
  assert.equal(await flipExecutor(network, store, { token: "Pend1111111111111111111111111111111111111111", stopped: true, by: "admin:1" }), "UNKNOWN_MARKET", "a launch not confirmed is not a market");
  const stop = await flipExecutor(network, store, { token, stopped: true, by: "admin:1", now: new Date("2026-10-09T12:00:00.000Z") });
  assert.deepEqual(stop, { changed: true, marked: [token] });
  const all = await flipExecutor(network, store, { token: null, stopped: true, by: "admin:1", now: new Date("2026-10-09T12:01:00.000Z") });
  assert.deepEqual(all, { changed: true, marked: [] }, "already stopped here: every market's stop adds no second mark");
  const marks = await journalMarks(store, "devnet", token);
  assert.deepEqual(marks.map((mark) => [mark.kind, mark.actor, mark.scope]), [["STOPPED", "operator", "market"]]);
  assert.equal(JSON.stringify(marks).includes("admin:1"), false, "who flipped it stays in the admin, never in a log");
});

test("the executor's switch takes the operator's Telegram door; every other admin action keeps its second factor", async () => {
  const { switchAdmitted } = await import("./executor-admin.server.ts");
  const link = { telegramId: 7, method: "telegram_link", sessionId: null };
  assert.deepEqual(switchAdmitted({ ok: true, admin: { telegramId: 7, method: "google_oidc" } }, null), { telegramId: 7, door: "second-factor" });
  assert.deepEqual(switchAdmitted({ ok: true, admin: { telegramId: 7, method: "telegram_link" }, transitional: true }, null), { telegramId: 7, door: "telegram-link" }, "a link the policy leaves open is said as the link, never as a second factor");
  assert.deepEqual(switchAdmitted({ ok: false, reason: "reverify" }, link), { telegramId: 7, door: "telegram-link" }, "the bot's link opens the switch");
  assert.deepEqual(switchAdmitted({ ok: false, reason: "reverify" }, { ...link, sessionId: "row-1" }), { telegramId: 7, door: "telegram-link" }, "the link's recorded session takes it too — production mints a row for the link");
  assert.match(read("app/api/session/route.ts"), /method: "telegram_link"/, "the bot's link is what mints a session with this method");
  assert.equal(switchAdmitted({ ok: false, reason: "reverify" }, { telegramId: 7, method: "email_password", sessionId: "row-1" }), null, "an account session without its second factor does not");
  assert.equal(switchAdmitted({ ok: false, reason: "unauthorized" }, link), null, "a bot path the policy retired stays refused");
  assert.equal(switchAdmitted({ ok: false, reason: "reverify" }, null), null, "no admin session, no switch");
  const route = read("app/api/admin/launch-executor/route.ts");
  assert.match(route, /switchAdmitted\(gate, gate\.ok \? null : await getAdminSessionDetail\(\)\)/);
  assert.match(route, /door: admitted\.door/, "the audit names the door");
  /* MC-1: taking a token's details down protects people, as the stop does — the same door; putting them back does not take it. */
  const takedown = read("app/api/admin/launch-takedown/route.ts");
  assert.match(takedown, /action === "restore" \? \(gate\.ok && !gate\.transitional/);
  /* Every other admin route keeps its second factor: none of them asks this door. */
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
  const routes = walk(new URL("../../app/api/admin", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")).filter((file) => /route\.ts$/.test(file) && !/launch-executor|launch-takedown/.test(file));
  assert.ok(routes.length > 5, "the admin's routes were found");
  for (const file of routes) assert.doesNotMatch(readFileSync(file, "utf8"), /switchAdmitted/, `${file} keeps its second factor`);
});

test("SOL-L1a: an exit position is called the creator's or Ryntra's only by who holds it; anyone else's is just locked", () => {
  const creator = "So11111111111111111111111111111111111111112";
  const executor = "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU";
  const stranger = "Stake11111111111111111111111111111111111111";
  const current = "9o6PpWvnkoxeGHvKddzV6UgfzVxqBPimT9Q619bWYow6";
  const positions = [creator, executor, current, NETWORK.referralOwner, stranger].map((owner, index) => ({ position: `P${index}`.padEnd(32, "1"), owner, permanentLockedLiquidity: "1" }));
  const view = { receipt: { graduated: { positions } } };
  const named = lockedPositions({ record: { creator, feeSharing: null } }, NETWORK, view).map((position) => position.owner);
  assert.deepEqual(named, ["creator", "partner", "partner", "partner", "other"], "an exit NFT sold to a stranger is never «Ryntra's share»");
});

test("CITY-139: a token Ryntra took down says so in the list and points at no picture; one put back says nothing", async () => {
  const { withTakedowns } = await import("./markets.server.ts");
  const deps = { network: NETWORK, now: () => new Date("2026-10-29T12:00:00.000Z") };
  const record = {
    cluster: "mainnet",
    state: "LAUNCHED",
    token: "So11111111111111111111111111111111111111112",
    pool: "So11111111111111111111111111111111111111112",
    config: "B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G",
    pairMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    preset: "classic",
    creator: "So11111111111111111111111111111111111111112",
    name: "Kite",
    symbol: "KITE",
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
  const row = { ...unreadRow(record, deps, false), image: "https://ryntra.io/api/launch/image/" + "a".repeat(64) };
  const [down] = withTakedowns([row], new Set([record.token]));
  assert.equal(down.hidden, true);
  assert.equal(down.image, null);
  assert.equal(down.name, "Kite", "the name and ticker stay: the chain holds them");
  const [back] = withTakedowns([down], new Set());
  assert.equal("hidden" in back, false);
  assert.deepEqual(withTakedowns([down], null), [down], "takedowns not read: the row as it was read");
  assert.ok(LaunchMarketsResponseSchema.safeParse({ network: "solana:mainnet", markets: [down, row], complete: true, observedAt: "2026-10-29T12:00:00.000Z" }).success);
  assert.equal(LaunchMarketsResponseSchema.safeParse({ network: "solana:mainnet", markets: [{ ...row, hidden: false }], complete: true, observedAt: "2026-10-29T12:00:00.000Z" }).success, false, "absent, never false");
});
