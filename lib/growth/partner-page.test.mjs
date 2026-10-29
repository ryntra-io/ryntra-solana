import assert from "node:assert/strict";
import test from "node:test";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { ACHIEVEMENT_METAL, LOCKED_METAL, PARTNER_LEVEL_IDS, TRACK_BADGE_IDS, trackBadgeSvg, trackMarksOf } from "./badges.ts";
import { isLinkPreview, linkOpensKey, openCountAllowed, OPENS_PER_ADDRESS_PER_MINUTE, OPENS_PER_CODE_PER_DAY, readLinkOpens, recordLinkOpen, LINK_OPENS_COLLECTION } from "./link-opens.ts";
import { readFileSync } from "node:fs";
import { accrueNetwork } from "./network-store.ts";
import { bestShare, partnerFunnel } from "./partner-page.ts";
import { readPartnerPage } from "./partner-page-store.ts";
import { creatorTrack, partnerLevel, partnerTrack, RETURNING_DAYS } from "./partner-tracks.ts";
import { PARTNER_RULES_VERSION } from "./partner.ts";
import { poolSubject } from "./review.ts";
import { actOnCase } from "./review-store.ts";
import { appendPoolShareRows } from "./pool-share-store.ts";

const registry = ATTRIBUTION_REGISTRY;
const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const DEMO = "GVDLyxgHraJcbmzds6i6hMgb3jSUUhSaHq5XVFnq6AS5";
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const POOL_2 = "AFoxY8SRfJ2SmCYNRWgXsMN27PpJyy2iUk2zGYsrXc7K";
const POOL_3 = "9qyVyLMRoCwGxDRscUJ6Ae8QV1vUKoQRy8NZch3XvRaX";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CREATOR = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const CREATOR_2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const PARTNER = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const FRIEND = "FriendCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const TX = "5".repeat(88);
const DAY = 86_400_000;
const T0 = "2026-10-20T00:00:00.000Z";
const at = (days) => new Date(Date.parse(T0) + days * DAY).toISOString();
const clean = { profileOf: async () => null, team: async () => new Set() };

const binding = (over = {}) => ({
  schema: 1, network: "solana", factory: PROTECTED, pool: POOL, creator: CREATOR, creationTx: TX, launchedAt: at(-1), partner: PARTNER, partnerCode: "BCDFGHJKLMNP",
  source: "inviter", decided: true, rulesVersion: PARTNER_RULES_VERSION, checks: { status: "measured", reasons: [], at: at(-1) }, recordedAt: at(-1), version: 1, ...over,
});
async function activate(store, row, when) {
  await store.versioned("growthActivations").compareAndSet(`pool:${row.network}:${row.pool}`, null, {
    version: 1, network: row.network, pool: row.pool, creator: row.creator, activatedAt: when, recordedAt: when, rulesVersion: "protect-1.0.0",
    last: { at: when, independent: 3, external: 3, unknown: 0, volumeUsdMicros: "3000000", teamVolumeUsdMicros: "0", insiderVolumeUsdMicros: "0", roundTripVolumeUsdMicros: "0", unvaluedTrades: 0, tradesComplete: true, partiesComplete: true, sharedSources: [] },
  });
}
async function bind(store, over = {}, activatedAt = at(-1)) {
  const row = binding(over);
  await store.collection("growthPoolPartners").set(`pool:${row.network}:${row.pool}`, row);
  if (activatedAt) await activate(store, row, activatedAt);
  return row;
}
let serial = 0;
const claim = (when, usd, over = {}) => ({
  kind: "CLAIM", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, venuePool: null, config: PROTECTED, creator: CREATOR, source: "curve", claimer: SAFE,
  claim: { tx: `claim${++serial}`, index: "1.0", block: serial, at: when, finality: "finalized" },
  asset: { mint: USDC, symbol: "USDC", decimals: 6 }, claimedRaw: usd, receivedRaw: usd, tokenRaw: "0", rule: "ALL", usdMicros: usd,
  valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null }, allocation: null, recordedAt: when, ...over,
});
const launch = (creator, pool, token, symbol, launchedAt, state = "LAUNCHED", preset = "protected") => ({ token, pool, name: `${symbol} coin`, symbol, creator, launchedAt, state, preset });
const noLaunches = { launchesOf: async () => [] };
const referral = { code: "BCDFGHJKLMNP", link: "https://ryntra.io/r/BCDFGHJKLMNP" };

/* --------------------------------------------------------------------------------------------- tracks */

test("partner levels: Scout · Partner · Builder · Council at 1 · 3 · 10 · 25 activated creators, each dated by the creator that reached it", () => {
  assert.deepEqual(partnerLevel(0), { current: null, next: { id: "SCOUT", creators: 1 }, activated: 0 });
  assert.deepEqual(partnerLevel(1).current, "SCOUT");
  assert.deepEqual(partnerLevel(2), { current: "SCOUT", next: { id: "PARTNER", creators: 3 }, activated: 2 });
  assert.equal(partnerLevel(10).current, "BUILDER");
  assert.deepEqual(partnerLevel(25), { current: "COUNCIL", next: null, activated: 25 });
  const creators = [at(5), at(1), at(3)].map((when, index) => ({ creator: `c${index}`, at: when }));
  assert.deepEqual(partnerTrack(creators).map((badge) => [badge.id, badge.earned, badge.at]), [
    ["SCOUT", true, at(1)],
    ["PARTNER", true, at(5)],
    ["BUILDER", false, null],
    ["COUNCIL", false, null],
  ]);
});

test("the creator track: a confirmed launch, a DEX, and a second real market 30 or more days after the first", () => {
  assert.deepEqual(creatorTrack([]).map((badge) => badge.earned), [false, false, false]);
  const first = { launchedAt: at(0), activatedAt: at(4), graduatedAt: null };
  const soon = { launchedAt: at(RETURNING_DAYS - 1), activatedAt: at(RETURNING_DAYS + 2), graduatedAt: null };
  assert.deepEqual(creatorTrack([first, soon]).map((badge) => [badge.id, badge.earned]), [["LAUNCHED", true], ["GRADUATED", false], ["RETURNING_BUILDER", false]]);
  /* A second launch with no real market yet is not a return. */
  const quiet = { launchedAt: at(40), activatedAt: null, graduatedAt: null };
  assert.equal(creatorTrack([first, quiet])[2].earned, false);
  const back = { launchedAt: at(40), activatedAt: null, graduatedAt: at(45) };
  const track = creatorTrack([first, back]);
  assert.deepEqual(track.map((badge) => [badge.id, badge.earned, badge.at]), [["LAUNCHED", true, at(0)], ["GRADUATED", true, at(45)], ["RETURNING_BUILDER", true, at(45)]]);
  /* The first real market counts by its launch, so one made real late is still the first. */
  assert.equal(creatorTrack([{ launchedAt: at(0), activatedAt: at(50), graduatedAt: null }, { launchedAt: at(31), activatedAt: at(33), graduatedAt: null }])[2].at, at(33));
});

test("track badges are achievements: round, teal, the partner levels with one to four orange marks; not held, slate with no orange", () => {
  const ORANGE = "#FF681C";
  for (const id of TRACK_BADGE_IDS) {
    const held = trackBadgeSvg(id, { id: "t", earned: true });
    const locked = trackBadgeSvg(id, { id: "u", earned: false });
    const marks = trackMarksOf(id);
    assert.ok(held.includes(ACHIEVEMENT_METAL.mid), id);
    assert.equal((held.match(/data-mark=""/g) ?? []).length, marks, id);
    assert.equal(held.includes(ORANGE), marks > 0, id);
    assert.ok(!locked.includes(ORANGE) && !locked.includes(ACHIEVEMENT_METAL.mid) && locked.includes(LOCKED_METAL.mid), id);
    assert.doesNotMatch(held, /<text|<image/);
  }
  assert.deepEqual(PARTNER_LEVEL_IDS.map(trackMarksOf), [1, 2, 3, 4]);
});

/* --------------------------------------------------------------------------------------------- opens */

test("link opens: one number per code per day, another code that shares the prefix is not this one's", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await readLinkOpens(store, "ABCDEFGH"), { opens: 0, since: null });
  await recordLinkOpen(store, "ABCDEFGH", at(0));
  await Promise.all([recordLinkOpen(store, "ABCDEFGH", at(0)), recordLinkOpen(store, "ABCDEFGH", at(0))]);
  await recordLinkOpen(store, "ABCDEFGH", at(2));
  await recordLinkOpen(store, "ABCDEFGHJK", at(1));
  assert.deepEqual(await readLinkOpens(store, "ABCDEFGH"), { opens: 4, since: at(0).slice(0, 10) });
  assert.deepEqual(await readLinkOpens(store, "ABCDEFGHJK"), { opens: 1, since: at(1).slice(0, 10) });
  const row = await store.collection(LINK_OPENS_COLLECTION).get(linkOpensKey("ABCDEFGH", at(0).slice(0, 10)));
  assert.deepEqual(Object.keys(row).sort(), ["code", "day", "opens", "version"], "nothing about whoever opened it");
});

test("one code counts a capped number of opens a day: a loop cannot run its funnel up without end", async () => {
  const store = createMemoryGuardStore();
  for (let i = 0; i < OPENS_PER_CODE_PER_DAY + 3; i += 1) await recordLinkOpen(store, "CAPPEDCODE", at(0));
  await recordLinkOpen(store, "CAPPEDCODE", at(1));
  assert.deepEqual(await readLinkOpens(store, "CAPPEDCODE"), { opens: OPENS_PER_CODE_PER_DAY + 1, since: at(0).slice(0, 10) });
});

test("a link preview is not an open, and one address counts a few a minute at most", () => {
  for (const agent of [
    "Twitterbot/1.0",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "TelegramBot (like TwitterBot)",
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "WhatsApp/2.23.20.0",
    "curl/8.4.0",
    "",
    null,
  ]) assert.equal(isLinkPreview(agent), true, String(agent));
  assert.equal(isLinkPreview("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), false);
  assert.equal(isLinkPreview("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"), false);
  const t = 1_000_000;
  const address = "203.0.113.7";
  for (let i = 0; i < OPENS_PER_ADDRESS_PER_MINUTE; i += 1) assert.equal(openCountAllowed(address, t + i), true);
  assert.equal(openCountAllowed(address, t + 10), false, "a loop from one address stops counting");
  assert.equal(openCountAllowed("203.0.113.8", t + 10), true, "another address is its own");
  assert.equal(openCountAllowed(address, t + 60_001), true, "a minute later it counts again");
});

test("the link route counts after the redirect, never a preview, never past the limit, never the code's owner", () => {
  const route = readFileSync(new URL("../../app/r/[code]/route.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(route, /after\(\(\) => countOpen\(/, "written after the response, never awaited by it");
  assert.match(route, /!isLinkPreview\(req\.headers\.get\("user-agent"\)\) && openCountAllowed\(clientIp\(req\.headers\)\)/);
  assert.match(route, /if \(!owner\) return;/, "a code nobody owns writes nothing");
  assert.match(route, /\?\.address === owner\) return;/, "the owner's own open is not counted");
  assert.match(route, /if \(normalized && !holds\) \{/, "only an open that remembers the code in this browser");
});

/* --------------------------------------------------------------------------------------------- the page */

test("an empty page is honest: no creators, no markets, zeros, paid zero and payouts not open", async () => {
  const store = createMemoryGuardStore();
  const page = await readPartnerPage(store, noLaunches, { wallet: PARTNER, referral, now: at(1) });
  assert.deepEqual(page.markets, []);
  assert.deepEqual(page.level, { current: null, next: { id: "SCOUT", creators: 1 }, activated: 0 });
  assert.deepEqual(page.funnel, { opened: 0, openedSince: null, signed: 0, launched: 0, earned: 0 });
  assert.deepEqual(page.money, { complete: true, earnedUsdMicros: "0", pendingUsdMicros: "0", availableUsdMicros: "0", heldUsdMicros: "0", paidUsdMicros: "0", nextAvailableAt: null, payoutsOpen: false });
  assert.equal(page.schedule.foundingSeats, 20);
  assert.equal(page.share, null);
  assert.deepEqual(page.schedule.steps.map((step) => step.bps), [2000, 1000]);
  assert.equal(page.referral, referral);
  assert.equal(page.badges.partner.every((badge) => !badge.earned), true);
  assert.equal(page.badges.ambassador.every((badge) => !badge.earned), true);
});

test("the partner's page: creators counted once, the funnel step by step, the markets by token, the share, nothing paid", async () => {
  const store = createMemoryGuardStore();
  await bind(store, {}, at(-1));
  await bind(store, { pool: POOL_2, launchedAt: at(-2) }, at(2));
  await bind(store, { pool: POOL_3, creator: CREATOR_2, launchedAt: at(-1) }, null);
  await appendPoolShareRows(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  await recordLinkOpen(store, referral.code, at(-3));
  await recordLinkOpen(store, referral.code, at(-2));
  /* A friend who chose the partner, and a creator who also did: one person each. */
  await store.collection("rewardReferralEdges").insertIfAbsent(`${PARTNER}:L1:${FRIEND}`, { referrer: PARTNER, wallet: FRIEND, level: 1, at: at(0) });
  await store.collection("rewardReferralEdges").insertIfAbsent(`${PARTNER}:L1:${CREATOR}`, { referrer: PARTNER, wallet: CREATOR, level: 1, at: at(0) });
  const launches = {
    [CREATOR]: [launch(CREATOR, POOL, "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "AAA", at(-1)), launch(CREATOR, POOL_2, "MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "BBB", at(-2))],
    [CREATOR_2]: [],
    [PARTNER]: [launch(PARTNER, "PoolOfMyOwnDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD", "MintOwnCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", "OWN", at(-40)), launch(PARTNER, "PendingPoolEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE", "MintPendingFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", "PEN", at(-1), "PENDING")],
  };
  const page = await readPartnerPage(store, { launchesOf: async (creator) => launches[creator] ?? [] }, { wallet: PARTNER, referral, now: at(2) });

  assert.equal(page.level.activated, 1, "two activated launches of one creator count once; an unactivated creator not at all");
  assert.equal(page.level.current, "SCOUT");
  assert.equal(page.badges.partner[0].at, at(-1), "dated by the first activation among the creator's launches");
  /* Three people chose the partner (a friend and two creators); two creators launched; one market came alive and its fee counted. */
  assert.deepEqual(page.funnel, { opened: 2, openedSince: at(-3).slice(0, 10), signed: 3, launched: 2, earned: 1 });
  const row = page.markets.find((market) => market.pool === POOL);
  assert.deepEqual([row.token, row.symbol, row.status, row.activated, row.shareBps, row.mayAppeal], ["MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "AAA", "EARNING", true, 2000, false]);
  assert.match(row.creator, /…/, "another person's address is masked");
  assert.equal(page.markets.find((market) => market.pool === POOL_3).symbol, null, "a launch this deployment does not know has no name");
  assert.deepEqual(page.share, { bps: 2000, until: row.shareUntil, pools: 1, nextEnd: row.shareUntil });
  assert.equal(page.money.paidUsdMicros, "0");
  assert.equal(page.money.payoutsOpen, false);
  assert.equal(BigInt(page.money.pendingUsdMicros) > 0n, true);
  assert.deepEqual(page.badges.creator.map((badge) => badge.earned), [true, false, false], "only the partner's own confirmed launch");
});

test("a pool the review holds: under review, not an activated creator, its partner may ask — and is never told why", async () => {
  const store = createMemoryGuardStore();
  await bind(store, {}, at(-1));
  await appendPoolShareRows(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, { profileOf: async () => null, team: async () => new Set([CREATOR]) }, { registry, clock: () => Date.parse(at(1)) });
  const page = await readPartnerPage(store, noLaunches, { wallet: PARTNER, referral, now: at(2) });
  const [row] = page.markets;
  assert.deepEqual([row.status, row.mayAppeal, row.shareBps], ["REVIEW", true, 0]);
  /* Nothing in the answer tells a held pool from a closed one: no figure, no activation. */
  assert.deepEqual([row.earnedUsdMicros, row.pendingUsdMicros, row.availableUsdMicros, row.heldUsdMicros, row.activated, row.shareUntil], ["0", "0", "0", "0", false, null]);
  assert.equal(page.level.activated, 0);
  assert.equal(JSON.stringify(page).includes("TEAM"), false);
});

test("the next available day comes only from pools that may pay; a creator not activated yet holds it", async () => {
  const store = createMemoryGuardStore();
  await bind(store, {}, null);
  await appendPoolShareRows(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const page = await readPartnerPage(store, noLaunches, { wallet: PARTNER, referral, now: at(2) });
  assert.equal(page.markets[0].status, "EARNING");
  assert.equal(page.markets[0].activated, false);
  assert.equal(page.money.nextAvailableAt, null, "its hold ends into «held», not «available»");
  assert.deepEqual([page.funnel.signed, page.funnel.launched, page.funnel.earned], [1, 1, 0], "a fee before activation is not yet the last step");
});

test("a demo launch of the partner's own makes no creator badge, even reaching a DEX twice 30 days apart", async () => {
  const store = createMemoryGuardStore();
  const demo = [
    launch(PARTNER, "DemoPoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "DemoMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "DEMA", at(-80), "LAUNCHED", "demo"),
    launch(PARTNER, "DemoPoolBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "DemoMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "DEMB", at(-40), "LAUNCHED", "demo"),
  ];
  const { recordLaunchGraduation } = await import("../rewards/rank-store.ts");
  for (const record of demo) await recordLaunchGraduation(store, { creator: PARTNER, mint: record.token, graduatedAt: record.launchedAt });
  const page = await readPartnerPage(store, { launchesOf: async (creator) => (creator === PARTNER ? demo : []) }, { wallet: PARTNER, referral, now: at(2) });
  assert.deepEqual(page.badges.creator.map((badge) => badge.earned), [false, false, false]);
});

test("the partner's own launch is never a step of their funnel", async () => {
  const store = createMemoryGuardStore();
  await bind(store, { creator: PARTNER, checks: { status: "measured", reasons: ["SAME_WALLET"], at: at(-1) } }, null);
  const page = await readPartnerPage(store, noLaunches, { wallet: PARTNER, referral, now: at(2) });
  assert.equal(page.markets[0].status, "REVIEW");
  assert.deepEqual([page.funnel.signed, page.funnel.launched, page.funnel.earned], [0, 0, 0]);
});

test("a question the partner sent is remembered: the row says it is with the reviewer, with no date, instead of offering to ask again", async () => {
  const store = createMemoryGuardStore();
  await bind(store, { checks: { status: "measured", reasons: ["TEAM"], at: at(-1) } }, null);
  const asked = await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "APPEAL", note: "Why?" }, by: "person", now: at(1) });
  assert.equal(asked.ok, true);
  const [row] = (await readPartnerPage(store, noLaunches, { wallet: PARTNER, referral, now: at(2) })).markets;
  assert.equal(row.mayAppeal, true);
  assert.equal(row.asked, true);
  assert.equal(JSON.stringify(row).includes("dueAt"), false, "no date that would tell a case from a blocked pool");
  assert.equal(JSON.stringify(row).includes("TEAM"), false);
});

test("a demo market is listed as not counted and earns nothing", async () => {
  const store = createMemoryGuardStore();
  await bind(store, { factory: DEMO }, at(-1));
  const page = await readPartnerPage(store, noLaunches, { wallet: PARTNER, referral, now: at(2) });
  assert.equal(page.markets[0].status, "NOT_COUNTED");
  assert.equal(page.level.activated, 0);
});

test("the funnel and the best share from the views alone", () => {
  const pool = (over) => ({ network: "solana", creator: CREATOR, status: "EARNING", shareBps: 2000, shareUntil: at(100), earnedUsdMicros: "0", ...over });
  const live = { activated: true };
  assert.deepEqual(
    partnerFunnel(
      [pool(live), pool({ creator: CREATOR_2, earnedUsdMicros: "1", ...live }), pool({ creator: "Another11111111111111111111111111111111111", activated: false, earnedUsdMicros: "5" }), pool({ creator: "Demo1111111111111111111111111111111111111111", status: "NOT_COUNTED" })],
      new Set([CREATOR, FRIEND]),
      { opens: 7, since: "2026-10-16" },
    ),
    { opened: 7, openedSince: "2026-10-16", signed: 4, launched: 3, earned: 1 },
  );
  assert.deepEqual(bestShare([pool({ shareBps: 1000, shareUntil: null }), pool({ shareBps: 3000, shareUntil: at(50) }), pool({ status: "REVIEW", shareBps: 4000 })]), { bps: 3000, until: null, pools: 2, nextEnd: at(50) }, "several pools: no one date stands for all, the nearest step end is told");
  assert.deepEqual(bestShare([pool({ shareUntil: at(10) })]), { bps: 2000, until: at(10), pools: 1, nextEnd: at(10) });
  assert.equal(bestShare([pool({ status: "WAITING" })]), null);
});
