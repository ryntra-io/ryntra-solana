import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { missionLaunchOpen, MISSION_LAUNCH_PATH } from "./gates.ts";
import { startLiveFeed, tradeCandidates } from "./live.ts";
import {
  eventWords,
  eventsBetween,
  missionFromMarket,
  postIntentUrl,
  postMoments,
  postWords,
  reachedMoments,
  shipGenome,
  snapshotFrom,
  tradeEvents,
  tradeUsd,
  withMarket,
} from "./scene.ts";
import { MISSION_CONTROL_WORDS } from "./words.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const DAY = 86_400_000;
const MINT_A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT_B = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const CREATOR = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

function row(over = {}) {
  return {
    token: MINT_A,
    name: "Kite",
    symbol: "KITE",
    image: null,
    preset: "classic",
    launchedAt: new Date(NOW - 3 * DAY).toISOString(),
    creator: CREATOR,
    technicalValidation: false,
    pair: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, dollar: true },
    read: true,
    state: null,
    venue: "curve",
    progress: { bps: 6310, migrated: false },
    poolLiquidity: null,
    budget: {},
    depth5Raw: null,
    daysSinceDex: null,
    traded24h: true,
    holders: 120,
    holdersAtLeast: false,
    creatorLock: null,
    creatorSold: false,
    observedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

const markets = (rows, over = {}) => ({ network: "solana:mainnet", markets: rows, complete: true, observedAt: new Date(NOW).toISOString(), ...over });

function survivalOf(token, states) {
  return {
    network: "solana:mainnet",
    windowDays: 7,
    horizons: [],
    markets: [{ token, symbol: "KITE", launchedAt: new Date(NOW - 100 * DAY).toISOString(), own: false, outcomes: [7, 30, 90].map((days, i) => ({ days, state: states[i], proof: null })) }],
    listedAll: true,
    ownWalletsComplete: true,
    complete: true,
    observedAt: new Date(NOW).toISOString(),
  };
}

function market(over = {}) {
  return {
    network: "solana:mainnet",
    token: MINT_A,
    venue: "curve",
    pair: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, dollar: true },
    progress: { bps: 6400, migrated: false, reserveRaw: "0", thresholdRaw: "0" },
    marketCap: { pair: 21000, usd: 21000 },
    sinceLaunchBps: 24_000,
    liquidity: { pair: 9800, usd: 9800 },
    holders: { count: 131, atLeast: true, rows: [], groups: {} },
    trades: {
      rows: [
        { signature: "s".repeat(64) + "3", at: new Date(NOW - 60_000).toISOString(), side: "buy", pairRaw: "214000000" },
        { signature: "s".repeat(64) + "2", at: new Date(NOW - 120_000).toISOString(), side: "sell", pairRaw: "50500000" },
        { signature: "s".repeat(64) + "1", at: new Date(NOW - 2 * DAY).toISOString(), side: "buy", pairRaw: "1000000" },
      ],
      complete: true,
      read: 3,
    },
    ...over,
  };
}

test("a ship is the mint's: the same address draws the same hull, never the action's orange", () => {
  assert.deepEqual(shipGenome(MINT_A), shipGenome(MINT_A));
  assert.notDeepEqual(shipGenome(MINT_A), shipGenome(MINT_B));
  for (const mint of [MINT_A, MINT_B, "x", "y", "z"]) {
    const ship = shipGenome(mint);
    assert.notEqual(ship.base.toUpperCase(), "#FF681C");
    assert.notEqual(ship.base, ship.accent);
    assert.ok([3, 4].includes(ship.fins));
  }
});

test("a market on its curve is a mission in ascent with the API's numbers and nothing more", () => {
  const mission = missionFromMarket(row(), undefined, NOW);
  assert.equal(mission.phase, "ascent");
  assert.equal(mission.ticker, "$KITE");
  assert.equal(mission.altitude, 63.1);
  assert.equal(mission.day, 3);
  assert.deepEqual(mission.checks, ["young", "young", "young"]);
  assert.deepEqual(mission.crew, ["4Nd1…DB4T"], "without a crew in flight the crew is the creator alone");
  assert.equal(mission.href, `/mission/${MINT_A}`);
  /* Not in the list's row: never guessed. */
  assert.equal(mission.marketCapUsd, null);
  assert.equal(mission.sinceLiftoff, null);
  assert.equal(mission.liquidityUsd, null);
});

test("phases follow the chain: the DEX is orbit, a Day 90 pass a star, a quiet week a lost signal", () => {
  const graduated = row({ venue: "pool", progress: { bps: 10_000, migrated: true }, poolLiquidity: { pair: 30_000, usd: 30_000 } });
  assert.equal(missionFromMarket(graduated, undefined, NOW).phase, "orbit");
  assert.equal(missionFromMarket(graduated, undefined, NOW).liquidityUsd, 30_000);
  assert.equal(missionFromMarket(graduated, survivalOf(MINT_A, ["alive", "alive", "alive"]).markets[0], NOW).phase, "star");
  assert.equal(missionFromMarket(graduated, survivalOf(MINT_A, ["alive", "quiet", "young"]).markets[0], NOW).phase, "lost");
  /* An unread week is never a lost signal. */
  assert.equal(missionFromMarket(graduated, survivalOf(MINT_A, ["alive", "unread", "young"]).markets[0], NOW).phase, "orbit");
});

test("a token still on its curve never reads as orbit: a quiet check is lost where it is, a day 90 pass is no star", () => {
  const quiet = missionFromMarket(row(), survivalOf(MINT_A, ["quiet", "young", "young"]).markets[0], NOW);
  assert.equal(quiet.phase, "lost");
  assert.equal(quiet.migrated, false);
  assert.equal(quiet.altitude, 63.1, "the altitude it was lost at, not 100");
  assert.deepEqual(reachedMoments(quiet), ["launch", "booster25", "booster50"], "no ORBIT card for a pool that does not exist — the boosters it climbed to stay");
  const before = snapshotFrom(markets([row()]), null, NOW);
  const after = snapshotFrom(markets([row()]), survivalOf(MINT_A, ["quiet", "young", "young"]), NOW);
  assert.deepEqual(eventsBetween(before, after, NOW).map((event) => event.type), ["lost"], "lost, never orbit");
  const old = missionFromMarket(row(), survivalOf(MINT_A, ["alive", "alive", "alive"]).markets[0], NOW);
  assert.equal(old.phase, "ascent");
  assert.deepEqual(reachedMoments(old), ["launch", "booster25", "booster50", "day7", "day30"], "no Day 90 star off the curve");
});

test("a Control Room's own mission is always in its snapshot, however long the list", () => {
  const rows = Array.from({ length: 60 }, (_, i) => row({ token: `${MINT_A.slice(0, 40)}${String(i).padStart(4, "1")}` }));
  const last = rows.at(-1).token;
  assert.equal(snapshotFrom(markets(rows), null, NOW).missions.some((m) => m.id === last), false);
  const focused = snapshotFrom(markets(rows), null, NOW, last);
  assert.equal(focused.missions.length, 48);
  assert.ok(focused.missions.some((m) => m.id === last));
});

test("Ryntra's own launches stay on the sky, marked as technical validation", () => {
  const snapshot = snapshotFrom(markets([row({ technicalValidation: true })]), null, NOW);
  assert.equal(snapshot.source, "live");
  assert.equal(snapshot.missions[0].ryntraTest, true);
  assert.equal(snapshot.complete, false, "no survival read: not complete");
});

test("between two reads: boosters at the quarters, orbit at the DEX, checks passed and lost — and a fresh launch ignites", () => {
  const before = snapshotFrom(markets([row({ progress: { bps: 4900, migrated: false } })]), null, NOW);
  const after = snapshotFrom(markets([row({ progress: { bps: 7600, migrated: false } }), row({ token: MINT_B, symbol: "NOVA", launchedAt: new Date(NOW - 60_000).toISOString() })]), null, NOW);
  const events = eventsBetween(before, after, NOW);
  assert.deepEqual(
    events.map((event) => [event.type, event.n ?? null]),
    [
      ["booster", 2],
      ["booster", 3],
      ["ignite", null],
    ],
  );
  const orbit = snapshotFrom(markets([row({ venue: "pool", progress: { bps: 10_000, migrated: true } })]), survivalOf(MINT_A, ["alive", "young", "young"]), NOW);
  const later = eventsBetween(before, orbit, NOW);
  assert.deepEqual(later.map((event) => event.type), ["orbit", "check"]);
  assert.equal(later[0].payoutUsd, null, "the crew's amount is never assumed");
  const lost = snapshotFrom(markets([row({ venue: "pool", progress: { bps: 10_000, migrated: true } })]), survivalOf(MINT_A, ["alive", "quiet", "young"]), NOW);
  assert.deepEqual(eventsBetween(orbit, lost, NOW).map((event) => event.type), ["lost"]);
});

test("the first read is no news: nothing ignites, and an old market appearing later joins quietly", () => {
  const first = snapshotFrom(markets([row()]), null, NOW);
  assert.deepEqual(eventsBetween(null, first, NOW), []);
  const withOld = snapshotFrom(markets([row(), row({ token: MINT_B, launchedAt: new Date(NOW - 5 * DAY).toISOString() })]), null, NOW);
  assert.deepEqual(eventsBetween(first, withOld, NOW), []);
});

test("trades become buys and sells, the oldest first, dollars only on a dollar pair", () => {
  const events = tradeEvents(market(), new Set(["s".repeat(64) + "1"]), false);
  assert.deepEqual(events.map((event) => [event.type, event.usd, event.altitude]), [
    ["sell", 50.5, null],
    ["buy", 214, 64],
  ]);
  assert.equal(tradeUsd({ pairRaw: "1000000000" }, { mint: "x", symbol: "SOL", decimals: 9, dollar: false }), null);
  assert.ok(tradeEvents(market(), new Set(), true).every((event) => event.quiet === true));
});

test("a market read whole adds what only it carries", () => {
  const mission = withMarket(missionFromMarket(row(), undefined, NOW), market());
  assert.equal(mission.marketCapUsd, 21000);
  assert.equal(mission.sinceLiftoff, 3.4);
  assert.equal(mission.holders, 131);
  assert.equal(mission.holdersAtLeast, true);
});

test("words are data, never a promise; posts go through X's intent, cards only for moments reached", () => {
  const lines = [
    eventWords({ type: "buy", id: MINT_A, at: null, usd: 214, altitude: 63.1, signature: null }, "$KITE"),
    eventWords({ type: "orbit", id: MINT_A, at: null, payoutUsd: null, signature: null }, "$KITE"),
    eventWords({ type: "check", id: MINT_A, day: 30, at: null, signature: null }, "$KITE"),
    eventWords({ type: "lost", id: MINT_A, day: 7 }, "$KITE"),
  ];
  assert.equal(lines[0], "Buy $214 on $KITE · 63.1% to orbit.");
  for (const line of lines) assert.doesNotMatch(line, /moon|100x|guarantee|profit/i);
  assert.match(postIntentUrl("hi", "https://ryntra.io/mission/x"), /^https:\/\/x\.com\/intent\/tweet\?text=hi&url=https%3A%2F%2Fryntra\.io/);
  const flying = missionFromMarket(row(), undefined, NOW);
  assert.deepEqual(reachedMoments(flying), ["launch", "booster25", "booster50"], "MC-2: a booster card for each quarter climbed");
  const surviving = missionFromMarket(row({ venue: "pool", progress: { bps: 10_000, migrated: true } }), survivalOf(MINT_A, ["alive", "alive", "young"]).markets[0], NOW);
  assert.deepEqual(reachedMoments(surviving), ["launch", "orbit", "day7", "day30"]);
});

test("a mission's day is whole — «DAY 18», never «DAY 18.32» — while the checks read the exact age", () => {
  const mission = missionFromMarket(row({ launchedAt: new Date(NOW - 18.32 * DAY).toISOString() }), undefined, NOW);
  assert.equal(mission.day, 18);
  /* 6.9 days old: still young at the day-7 check, shown as day 6. */
  const almost = missionFromMarket(row({ launchedAt: new Date(NOW - 6.9 * DAY).toISOString() }), undefined, NOW);
  assert.equal(almost.day, 6);
  assert.equal(almost.checks[0], "young");
});

test("«Post to X» comes from the live snapshot too: the moments, their cards and the intents, without the server's read", () => {
  const surviving = missionFromMarket(row({ venue: "pool", progress: { bps: 10_000, migrated: true } }), survivalOf(MINT_A, ["alive", "young", "young"]).markets[0], NOW);
  const posts = postMoments(surviving);
  assert.deepEqual(posts.map((post) => post.moment), ["launch", "orbit", "day7"]);
  assert.equal(posts[1].card, `/api/launch/mission-card?mint=${MINT_A}&moment=orbit`);
  assert.match(posts[1].intent, /^https:\/\/x\.com\/intent\/tweet\?text=%24KITE\+reached\+orbit/);
  assert.equal(postWords("day30", "$KITE"), "$KITE passed its Day 30 check on Ryntra.");
  const post = readFileSync(new URL("../../app/mission/[mint]/mission-post.tsx", import.meta.url), "utf8");
  assert.match(post, /addEventListener\(SCENE_SNAPSHOT_EVENT/, "the button listens to the room's snapshots");
  assert.match(post, /setChosen\(item\.moment\)/, "the picked tab is kept by name when the list grows");
  assert.match(post, /fresh\.every\(\(post\) => known\.has\(post\.moment\)\)/, "a late survival read never takes a tab away");
  const room = readFileSync(new URL("./engines/control-room.js", import.meta.url), "utf8");
  assert.match(room, /function lostDayOf\(r\) \{ if \(r\.lostDay != null\) return r\.lostDay; const i = r\.checks\.indexOf\("quiet"\)/, "SIGNAL LOST names the check's day, not the age");
  const stage = readFileSync(new URL("../../app/components/mission-control/stage.tsx", import.meta.url), "utf8");
  assert.match(stage, /dispatchEvent\(new CustomEvent\(SCENE_SNAPSHOT_EVENT, \{ detail: snapshot \}\)\)/);
  const page = readFileSync(new URL("../../app/mission/[mint]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<MissionPost mint=\{mint\} initial=\{mission \? postMoments\(mission\) : \[\]\} \/>/, "rendered even when the server's read was late");
});

test("the one orange action is closed opens it after MC-1; since decision 70 `/` is the city, without it", () => {
  assert.equal(missionLaunchOpen({}), false);
  assert.equal(missionLaunchOpen({ RYNTRA_MISSION_LAUNCH: "1" }), false);
  assert.equal(missionLaunchOpen({ RYNTRA_MISSION_LAUNCH: "open" }), true);
  assert.equal(MISSION_LAUNCH_PATH, "/app/launch");
  /* The Orbit scene, its orange action and the sections under it are mounted by no page now: `/` is Ryntra City. */
  const page = readFileSync(new URL("../../app/(home)/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /MissionStage|MissionSections|btn primary/, "Mission Control's scene and its orange action are not on `/`");
  assert.match(page, /<CityApp /, "the city is");
});

test("The home page is English only", async () => {
  const { HOME_ENGLISH_ONLY, HOME_TO_APP, LANDING_IS_LIVE } = await import("../site/home-to-app.ts");
  assert.deepEqual(HOME_TO_APP, [], "no door into the app: `/`, `/live` and `/mission/<mint>` are pages");
  assert.equal(LANDING_IS_LIVE, true);
  assert.deepEqual(HOME_ENGLISH_ONLY.map((row) => [row.source, row.destination, row.permanent, row.has[0].value]), [["/uk", "/", false, "ryntra\\.io"], ["/ua", "/", false, "ryntra\\.io"]]);
  const seo = readFileSync(new URL("../../app/seo.ts", import.meta.url), "utf8");
  assert.match(seo, /robots: \{ index: LANDING_IS_LIVE, follow: true \}/);
});

test("under the scene: every share on the home page is the Classic preset's own, and the orange action stays one", async () => {
  const { HOME_FACTS, CLASSIC_TERMS: t } = await import("./home-facts.ts");
  const { presetTerms } = await import("../core/launch/preset-terms.ts");
  assert.deepEqual(t, presetTerms("classic"));
  const p = (bps) => `${bps / 100}%`;
  const [curve, exit, pool] = HOME_FACTS.earn.rows;
  assert.deepEqual([curve.creator, curve.ryntra, curve.meteora], [p(t.curve.split.creatorBps), p(t.curve.split.ryntraBps), p(t.curve.split.meteoraBps)]);
  assert.deepEqual([exit.creator, exit.ryntra, exit.meteora], [p(t.graduation.creatorBps), p(t.graduation.ryntraBps), "—"]);
  assert.deepEqual([pool.creator, pool.ryntra, pool.meteora], [p(t.pool.creatorPositionBps), p(t.pool.ryntraPositionBps), p(t.pool.meteoraBps)]);
  /* Today's Classic: 32 / 48 / 20 on the curve, 40 / 60 at the DEX, 20 / 20 / 20 in the pool. */
  assert.deepEqual([curve.creator, exit.creator, pool.creator], ["32%", "40%", "20%"]);
  const words = JSON.stringify(HOME_FACTS);
  assert.doesNotMatch(words, /moon|100x|guarantee|profit|Powered by Meteora|Orbit Bonus/i);
  assert.match(words, /BUILT WITH METEORA INFRASTRUCTURE/);
  assert.doesNotMatch(words, /start equal/i, "the creator's first buy is made in the creation itself");
  assert.match(HOME_FACTS.earn.traders, new RegExp(`at most ${t.firstBuy.capBps / 100}% of the supply`));
  assert.match(HOME_FACTS.earn.pool, /only liquidity/, "the pool shares hold only while the locked positions are its only liquidity");
  const sections = readFileSync(new URL("../../app/components/mission-control/mission-sections.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sections, /primary|launchBtn|MISSION_LAUNCH_PATH/, "no second orange action below the scene besides the dock's own");
  assert.match(sections, /\{launchOpen \? \(\s*<section[^>]*id="launch"[\s\S]*?<LaunchDock \/>/, "the dock is drawn only while the launch is open");
  const dock = readFileSync(new URL("../../app/components/mission-control/launch-dock.tsx", import.meta.url), "utf8");
  assert.equal((dock.match(/styles\.launchBtn/g) ?? []).length, 1, "the dock's one orange action: its submit");
  assert.match(dock, /HOME_DRAFT_PATH/, "the dock leads to the launch form, nowhere else");
  /* Since decision 70 the sections are mounted by no page; their facts stay true for the district that shows them. */
});

test("the home page's words: decision 68's H1, decision 64's title and descriptor, within a result's limits", () => {
  assert.equal(MISSION_CONTROL_WORDS.h1, "Launch is just the beginning.");
  assert.equal(MISSION_CONTROL_WORDS.descriptor, "Solana-native financial operations platform for people, teams and autonomous agents.");
  assert.ok(MISSION_CONTROL_WORDS.title.length <= 60);
  assert.ok(MISSION_CONTROL_WORDS.description.length <= 160);
  assert.ok(MISSION_CONTROL_WORDS.description.includes(MISSION_CONTROL_WORDS.descriptor.slice(0, 40)));
});

test("the live feed reads the list, the checks and the busiest flights' trades — and opens with quiet history", async () => {
  const calls = [];
  const answers = {
    "/api/v1/launch/markets": markets([row(), row({ token: MINT_B, symbol: "NOVA", progress: { bps: 9100, migrated: false } })]),
    "/api/v1/launch/survival": survivalOf(MINT_A, ["young", "young", "young"]),
    [`/api/v1/launch/${MINT_A}/market`]: market(),
    [`/api/v1/launch/${MINT_B}/market`]: market({ token: MINT_B, trades: { rows: [], complete: true, read: 0 } }),
  };
  const fetcher = async (path) => {
    calls.push(path);
    return { ok: path in answers, json: async () => answers[path] };
  };
  const snapshots = [];
  const batches = [];
  const states = [];
  const feed = startLiveFeed({ fetcher, now: () => NOW, onSnapshot: (s) => snapshots.push(s), onEvents: (e) => batches.push(e), onState: (s) => states.push(s) });
  await feed.readNow();
  feed.stop();
  assert.ok(calls.includes("/api/v1/launch/markets") && calls.includes("/api/v1/launch/survival"));
  assert.deepEqual(tradeCandidates(answers["/api/v1/launch/markets"], undefined), [MINT_B, MINT_A], "highest flight first");
  assert.equal(snapshots.at(-1).missions.find((m) => m.id === MINT_A).marketCapUsd, 21000);
  const opening = batches[0];
  assert.ok(opening.length === 2 && opening.every((event) => event.quiet === true), "the last day's trades, quiet");
  assert.equal(states[0], "reading");
  assert.equal(states.at(-1), "live");
});

test("a failed read keeps nothing invented: no snapshot, the state says unavailable", async () => {
  const states = [];
  const snapshots = [];
  const feed = startLiveFeed({ fetcher: async () => ({ ok: false, json: async () => ({}) }), now: () => NOW, onSnapshot: (s) => snapshots.push(s), onEvents: () => {}, onState: (s) => states.push(s) });
  await feed.readNow();
  feed.stop();
  assert.equal(snapshots.length, 0);
  assert.equal(states.at(-1), "unavailable");
});

test("why Ryntra and who gets what: every number is a preset's own, and nothing not on mainnet carries one", async () => {
  const { HOME_FACTS } = await import("./home-facts.ts");
  const { presetTerms } = await import("../core/launch/preset-terms.ts");
  const classic = presetTerms("classic");
  const guarded = presetTerms("protected");
  const p = (bps) => `${bps / 100}%`;
  const start = HOME_FACTS.why.rows.find((row) => row.topic === "The first minutes");
  assert.ok(start.ryntra.includes(`${p(classic.curve.sniperFee.startBps)} → ${p(classic.curve.sniperFee.endBps)}`));
  assert.ok(start.ryntra.includes(`${p(guarded.curve.sniperFee.startBps)} over`), "Protected's start is its own");
  assert.doesNotMatch(JSON.stringify(HOME_FACTS.why), /buyers don't|snipers pay and/i, "every buyer in the window pays the same falling fee");
  assert.ok(HOME_FACTS.why.rows.some((row) => row.topic === "What it costs" && /partner's share/.test(row.ryntra)), "the comparison says what Ryntra takes");
  /* The console's shares are Classic's and Protected's alike, as its head says. */
  for (const key of ["split", "splitThroughRyntra"]) assert.deepEqual(classic.curve[key], guarded.curve[key]);
  assert.deepEqual([classic.graduation.creatorBps, classic.pool.creatorPositionBps], [guarded.graduation.creatorBps, guarded.pool.creatorPositionBps]);
  const live = HOME_FACTS.earn.earners.filter((card) => card.live).map((card) => card.who);
  assert.deepEqual(live, ["Creator", "Ryntra", "Meteora"], "only those mainnet pays today are LIVE — Ryntra and Meteora among them");
  for (const card of HOME_FACTS.earn.earners.filter((entry) => !entry.live)) assert.doesNotMatch(card.text, /\d+\s?%|\$\d/, `${card.who}: no share before its rate is set`);
  assert.match(HOME_FACTS.earn.rows[2].detail, /only liquidity/, "20 / 20 in the pool holds only while the locked positions are its only liquidity");
  assert.match(HOME_FACTS.earn.buyers, new RegExp(`${p(guarded.firstBuy.capBps)} on Protected`));
  assert.doesNotMatch(JSON.stringify(HOME_FACTS), /one Claim|every claim to the chain|partner of Meteora|Meteora partner|official/i);
});

/* ---------------------------------------------------------------- MC-2: windows, crews, the ship's growth */

const { COUNTDOWN_FROM_SEC, momentWords, shipGrowth, windowEvents, withCrew } = await import("./scene.ts");

test("MC-2: the windows' beats come from the published schedule — T-10 … T-1, the opening, the closing with the chain's count", () => {
  const opens = Date.parse("2026-10-25T21:00:00Z");
  const beats = [];
  for (let t = opens - 11_000; t < opens + 1_000; t += 1_000) beats.push(...windowEvents(t, t + 1_000, null));
  assert.deepEqual(beats.filter((e) => e.type === "countdown").map((e) => e.sec), Array.from({ length: COUNTDOWN_FROM_SEC }, (_, i) => COUNTDOWN_FROM_SEC - i));
  assert.ok(beats.every((e) => e.window === "2026-10-25T21:00Z" && e.clock === "21:00 UTC"));
  assert.deepEqual(beats.filter((e) => e.type === "window").map((e) => e.state), ["open"]);
  /* A hidden tab coming back an hour later says nothing late. */
  assert.deepEqual(windowEvents(opens - 3_600_000, opens + 5_000, null), []);
  /* The closing counts the missions whose creation landed in the window, from the snapshot. */
  const inside = missionFromMarket(row({ launchedAt: new Date(opens + 120_000).toISOString() }), undefined, opens + 600_000);
  const between = missionFromMarket(row({ token: MINT_B, launchedAt: new Date(opens + 1_800_000).toISOString() }), undefined, opens + 600_000);
  assert.equal(inside.window, "2026-10-25T21:00Z");
  assert.equal(between.window, null, "a launch between windows is in none");
  const closing = windowEvents(opens + 599_000, opens + 600_500, { missions: [inside, between] });
  assert.deepEqual(closing, [{ type: "window", window: "2026-10-25T21:00Z", clock: "21:00 UTC", state: "closed", count: 1 }]);
  assert.equal(eventWords(closing[0], ""), "Launch window 21:00 UTC closed · 1 mission lifted off in it.");
  assert.match(eventWords({ type: "countdown", sec: 3, window: "x", clock: "21:00 UTC" }, ""), /^Launch window 21:00 UTC · T-3\.$/);
});

test("MC-2: a crew flies only as the vault pays it — the creator's own, by wallet; else the creator alone", () => {
  const mission = missionFromMarket(row(), undefined, NOW);
  const crew = { token: MINT_A, symbol: "KITE", creator: CREATOR, creatorBps: 6000, members: [{ wallet: MINT_B, bps: 2000 }, { wallet: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", bps: 2000 }], window: null, launchedAt: null };
  assert.deepEqual(withCrew(mission, crew, CREATOR).crew, ["4Nd1…DB4T", "9wFF…BzvT", "DezX…B263"], "the vault's rows by wallet — never a handle");
  assert.deepEqual(withCrew(mission, crew, MINT_B).crew, ["4Nd1…DB4T"], "another creator's crew is never this mission's");
  const crews = { network: "solana:mainnet", crews: [crew], observedAt: new Date(NOW).toISOString() };
  const flying = snapshotFrom(markets([row()]), null, NOW, undefined, crews).missions[0];
  assert.equal(flying.crew.length, 3);
  assert.ok(reachedMoments(flying).includes("crew"));
  assert.equal(momentWords("crew", flying).title, "CREW OF 3");
  assert.equal(postWords("crew", "$KITE", flying.crew), "$KITE flies with a crew of 3 on Ryntra — watch it live.");
  assert.doesNotMatch(momentWords("crew", flying).line, /@/, "no handle on a card");
});

test("MC-2: the ship grows with the chain — a booster per quarter climbed, wings in orbit; the card draws it", () => {
  assert.deepEqual(shipGrowth({ altitude: 24.9, migrated: false }), { boosters: 0, wings: false, rings: [] });
  assert.deepEqual(shipGrowth({ altitude: 50, migrated: false }), { boosters: 2, wings: false, rings: [] });
  assert.deepEqual(shipGrowth({ altitude: null, migrated: false }), { boosters: 0, wings: false, rings: [] }, "an unread curve grows nothing");
  assert.deepEqual(shipGrowth({ altitude: 100, migrated: true }), { boosters: 3, wings: true, rings: [] });
  const orbit = missionFromMarket(row({ venue: "pool", progress: { bps: 10_000, migrated: true } }), undefined, NOW);
  assert.ok(!reachedMoments(orbit).some((moment) => moment.startsWith("booster")), "in orbit the orbit's card says it");
  assert.equal(momentWords("booster75", orbit).title, "BOOSTER · 75%");
  const card = readFileSync(new URL("../../app/brand/mission-card.tsx", import.meta.url), "utf8");
  assert.match(card, /shipGrowth\(mission\)/, "the card's ship is grown as on the sky");
  assert.doesNotMatch(card.slice(card.indexOf("<svg"), card.indexOf("</svg>")), /<>|<\/>/, "the card's renderer takes no fragment inside an <svg>");
  const orbitEngine = readFileSync(new URL("./engines/orbit.js", import.meta.url), "utf8");
  assert.match(orbitEngine, /addBoostersTo\(s, orb \? 3 : Math\.floor\(m\.alt \/ 25\), false\)/);
  assert.match(orbitEngine, /event\.type === 'countdown' \|\| event\.type === 'window'/, "the sky takes the live windows' beats");
  /* A window's clock on every scene; the orange action stays one. */
  for (const page of ["../../app/live/page.tsx", "../../app/mission/[mint]/mission-post.tsx"]) {
    assert.match(readFileSync(new URL(page, import.meta.url), "utf8"), /<WindowClock variant=/, page);
  }
  const clock = readFileSync(new URL("../../app/components/mission-control/window-clock.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(clock, /primary|<button|href=/, "the clock is a label, never an action");
});

test("MC-2: the launch window and its words on the card — the launch's own time, never claimed", () => {
  const opens = Date.parse("2026-10-25T20:00:00Z");
  const evening = missionFromMarket(row({ launchedAt: new Date(opens + 60_000).toISOString() }), undefined, opens + 3_600_000);
  assert.equal(evening.window, "2026-10-25T20:00Z");
  assert.equal(momentWords("launch", evening).line, "$KITE lifted off in the evening launch window at 20:00 UTC.");
  const off = missionFromMarket(row({ launchedAt: new Date(opens + 40 * 60_000).toISOString() }), undefined, opens + 3_600_000);
  assert.equal(momentWords("launch", off).line, "$KITE lifted off on Ryntra.");
});
