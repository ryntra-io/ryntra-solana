// MC-3: orbit and survival on the scene — rings for the checks passed, a signal lost said calmly with its reason, the
// Day 90 sky with its crews' names on Orbit and in the Control Room, and no bonus rate on the home page before it is paid.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ORBIT_BONUS_LIVE } from "../core/launch/orbit-bonus.ts";
import { HOME_FACTS } from "./home-facts.ts";
import { eventWords, eventsBetween, missionFromMarket, reachedMoments, shipGrowth, signalLost, skyStars, snapshotFrom } from "./scene.ts";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const DAY = 86_400_000;
const MINT_A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const MINT_B = "9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT";
const CREATOR = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const MATE = "CrewMate1Fixture1111111111111111111111111";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function row(over = {}) {
  return {
    token: MINT_A,
    name: "Kite",
    symbol: "KITE",
    image: null,
    preset: "classic",
    launchedAt: new Date(NOW - 100 * DAY).toISOString(),
    creator: CREATOR,
    technicalValidation: false,
    pair: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, dollar: true },
    read: true,
    state: null,
    venue: "pool",
    progress: { bps: 10_000, migrated: true },
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

const markets = (rows) => ({ network: "solana:mainnet", markets: rows, complete: true, observedAt: new Date(NOW).toISOString() });

function survival(entries) {
  return {
    network: "solana:mainnet",
    windowDays: 7,
    horizons: [],
    markets: entries.map(([token, states]) => ({ token, symbol: "KITE", launchedAt: new Date(NOW - 100 * DAY).toISOString(), own: false, outcomes: [7, 30, 90].map((days, i) => ({ days, state: states[i], proof: null })) })),
    listedAll: true,
    ownWalletsComplete: true,
    complete: true,
    observedAt: new Date(NOW).toISOString(),
  };
}

test("signal lost: the first quiet check, said calmly with its reason and what stays true", () => {
  assert.equal(signalLost(["alive", "alive", "young"], true), null);
  const lost = signalLost(["alive", "quiet", "unread"], true);
  assert.equal(lost.day, 30);
  assert.match(lost.reason, /^Signal lost at Day 30: in the week before it, nobody besides the creator and Ryntra traded the token/);
  assert.match(lost.reason, /the whole week was read on chain/, "a week not read whole is never a lost signal");
  assert.match(lost.reason, /Its pool stays open/);
  assert.match(signalLost(["quiet", "young", "young"], false).reason, /Its curve stays open/);
  assert.equal(lost.line, "Signal lost at Day 30: nobody besides the creator and Ryntra traded it that week.");
  for (const words of [lost.reason, lost.line, lost.short]) assert.doesNotMatch(words, /fail|dead|rug|scam|crash|!/i, "calm: a fact, never a verdict");
});

test("a mission whose check went quiet carries its signal; the lost event and its line carry the reason", () => {
  const before = snapshotFrom(markets([row()]), survival([[MINT_A, ["alive", "unread", "unread"]]]), NOW);
  const after = snapshotFrom(markets([row()]), survival([[MINT_A, ["alive", "quiet", "unread"]]]), NOW);
  const mission = after.missions[0];
  assert.equal(mission.phase, "lost");
  assert.equal(mission.signal.day, 30);
  const [event] = eventsBetween(before, after, NOW).filter((item) => item.type === "lost");
  assert.equal(event.reason, mission.signal.short);
  assert.equal(eventWords(event, "$KITE"), "$KITE: signal lost at Day 30 — no trade beyond the creator and Ryntra in the week before Day 30.");
  assert.equal(eventWords({ type: "lost", id: MINT_A, day: 7 }, "$KITE"), "$KITE: signal lost at Day 7.");
  assert.equal(before.missions[0].signal, null);
});

test("the ship's rings: one for each check passed — kept when the signal is lost later", () => {
  assert.deepEqual(shipGrowth({ altitude: 100, migrated: true, checks: ["alive", "alive", "young"] }).rings, [7, 30]);
  assert.deepEqual(shipGrowth({ altitude: 100, migrated: true, checks: ["alive", "quiet", "unread"] }).rings, [7]);
  assert.deepEqual(shipGrowth({ altitude: 100, migrated: true, checks: ["alive", "alive", "alive"] }).rings, [7, 30, 90]);
  assert.deepEqual(shipGrowth({ altitude: 40, migrated: false, checks: ["unread", "alive", "young"] }).rings, [30]);
  const card = read("../../app/brand/mission-card.tsx");
  assert.match(card, /const \{ boosters, wings, rings \} = shipGrowth\(mission\)/, "the card's ship wears the rings the sky draws");
  assert.match(card, /rings\.map\(/);
  const orbit = read("./engines/orbit.js");
  assert.match(orbit, /if \(m\.live\) \{ for \(let k = 0; k < 3; k\+\+\) if \(m\.ck\[k\]\) addDayRing\(s, k, false\); \}/, "the sky's ships wear a ring per check passed");
});

test("the Day 90 sky: every star drawn, with its crew's names as the sky gives them, the oldest first", () => {
  const older = row({ token: MINT_B, symbol: "OWL", name: "Owl", launchedAt: new Date(NOW - 120 * DAY).toISOString() });
  const crews = { network: "solana:mainnet", crews: [{ token: MINT_A, symbol: "KITE", creator: CREATOR, creatorBps: 8_000, members: [{ wallet: MATE, bps: 2_000 }], window: null, launchedAt: null }], observedAt: new Date(NOW).toISOString() };
  const snapshot = snapshotFrom(markets([row(), older, row({ token: CREATOR, symbol: "LOST" })]), survival([[MINT_A, ["alive", "alive", "alive"]], [MINT_B, ["alive", "alive", "alive"]], [CREATOR, ["alive", "quiet", "unread"]]]), NOW, undefined, crews);
  const sky = skyStars({ ...snapshot, stars: 3 });
  assert.deepEqual(sky.stars.map((star) => star.ticker), ["$OWL", "$KITE"], "a lost signal is no star; the oldest star first");
  assert.deepEqual(sky.stars[1].crew, ["4Nd1…DB4T", "Crew…1111"], "the creator and the vault's rows, by short address — no handle");
  assert.deepEqual(sky.stars[0].crew, ["4Nd1…DB4T"], "without a crew: the creator alone");
  assert.equal(sky.stars[1].href, `/mission/${MINT_A}`);
  assert.equal(sky.more, 3);
  assert.ok(reachedMoments(snapshot.missions[0]).includes("day90"));
  /* A curve token alive at day 90 never reached orbit: no star. */
  const curve = missionFromMarket(row({ venue: "curve", progress: { bps: 5_000, migrated: false } }), survival([[MINT_A, ["alive", "alive", "alive"]]]).markets[0], NOW);
  assert.equal(skyStars({ missions: [curve], stars: 0 }).stars.length, 0);
});

test("the sky's names on Orbit and in the Control Room — live snapshots only, words only, no orange", () => {
  const sky = read("../../app/components/mission-control/star-sky.tsx");
  assert.match(sky, /snapshot\?\.source === "live"/, "never the DEMO show's stars");
  assert.match(sky, /take\(lastSnapshot\(root\)\)/, "a list mounted after the first read takes the snapshot already carried");
  assert.match(read("../../app/components/mission-control/stage.tsx"), /rememberSnapshot\(element, snapshot\)/);
  assert.doesNotMatch(sky, /primary|launchBtn|#FF681C|MISSION_LAUNCH_PATH/i, "no action of its own beside the one orange");
  assert.doesNotMatch(read("../../app/components/mission-control/star-sky.module.css"), /#ff681c/i);
  assert.match(read("../../app/components/mission-control/mission-sections.tsx"), /<StarSky scene="orbit" variant="section" \/>/);
  assert.match(read("../../app/mission/[mint]/mission-post.tsx"), /<StarSky scene="control-room" variant="room" \/>/);
  const orbit = read("./engines/orbit.js");
  assert.match(orbit, /d\.names/, "a live star's tip names its crew");
  assert.match(orbit, /m\.signal \? m\.signal\.reason/, "the lost mission's panel gives its reason");
  const room = read("./engines/control-room.js");
  assert.match(room, /f\.phase === "lost" && f\.signal \? f\.signal\.line/, "the room's hero says it in one line");
  assert.match(room, /lost: "#B9C6D6"/, "a lost signal is calm grey, never the alarm's red");
  assert.doesNotMatch(read("./engines/orbit.css"), /\.chip\.lost\{color:#f3a3a3/);
  assert.match(read("./engines/launch-night.js"), /Signal lost<\/span> · Day \$\{e\.day\} check\$\{why/);
});

test("the home page names no bonus rate before the bonus is truly accrued", () => {
  const crew = HOME_FACTS.earn.earners.find((card) => card.who === "Crew");
  assert.equal(crew.live, false);
  if (!ORBIT_BONUS_LIVE) assert.doesNotMatch(crew.text, /\d+\s*%/, "NEXT, without numbers");
  assert.match(crew.text, /bonus at the checks of days 7, 30 and 90/);
});
