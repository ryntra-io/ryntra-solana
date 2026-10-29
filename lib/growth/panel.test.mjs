import assert from "node:assert/strict";
import test from "node:test";

import { projectBusiness } from "../admin/business.ts";
import { csvCell, exportWeek, weeklyCsv } from "./panel-csv.ts";
import { isPanelRange, projectPanel, returnedWithin, STAGE_GATES } from "./panel.ts";

const NOW = "2026-10-24T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const DAY = 86_400_000;
const ago = (days, hours = 0) => new Date(NOW_MS - days * DAY - hours * 3_600_000).toISOString();
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
/* Base58 addresses, one per person in the story below. */
const wallet = (name) => `${name}${"x".repeat(40 - name.length)}`;
const A = wallet("Abuyer"); // came by the post, bought, came back the next day
const B = wallet("Butm"); // came by a UTM link, connected, never bought
const C = wallet("Cknown"); // Ryntra knew it for two months; the post brought it back
const D = wallet("Dfriend"); // a friend's, bound on the referral graph, no touch
const E = wallet("Einviter");
const F = wallet("Fdirect"); // came on its own and bought
const G = wallet("Gbackdated"); // its touch is newer than its first appearance
const H = wallet("Hnew"); // came by the post this week, bought today
const I = wallet("Iinternal"); // the owner's test wallet
const POST = "7KD2F9X";

let seq = 0;
function purchase(who, at, overrides = {}) {
  seq += 1;
  const id = `${"5".repeat(80)}${String(seq).padStart(8, "1")}`.replace(/0/g, "9");
  return {
    schema: "ryntra.solana.wallet-action",
    schemaVersion: "1.0.0",
    version: 1,
    network: "mainnet",
    wallet: who,
    actionId: id,
    lane: "SWAP",
    outcome: "DONE",
    out: { mint: USDC, amountRaw: "10000000", decimals: null, symbol: null },
    in: { mint: SOL, amountRaw: "50000000", decimals: null, symbol: null },
    destination: null,
    signature: id,
    receiptHash: null,
    sourceTx: null,
    destinationTx: null,
    fee: null,
    startedAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const presence = (who, firstSeenAt) => ({ wallet: who, firstSeenAt, lastSeenAt: firstSeenAt, sessions: 1, firstVerifiedAt: null, lastVerifiedAt: null, verifications: 0 });
const touch = (who, channel, source, touchAt, boundAt) => ({
  schema: "ryntra.growth-touch-wallet",
  schemaVersion: "1.0.0",
  wallet: who,
  channel,
  source,
  touchAt,
  boundAt,
  proven: false,
});

function story(overrides = {}) {
  return {
    now: NOW,
    range: "30d",
    business: {
      now: NOW,
      range: "30d",
      scope: "external",
      actions: [
        purchase(A, ago(20)),
        purchase(A, ago(19)),
        purchase(C, ago(60)),
        purchase(C, ago(2)),
        purchase(D, ago(10)),
        purchase(F, ago(12)),
        purchase(F, ago(12, -2)), // two hours later, the same day: not a return
        purchase(H, ago(0, 1)),
        purchase(I, ago(5)),
        purchase(D, ago(10), { outcome: "FAILED" }),
      ],
      orders: [],
      rewards: [],
      edges: [{ referrer: E, wallet: D, level: 1, at: ago(11) }],
      presence: [presence(A, ago(20, 1)), presence(B, ago(15)), presence(C, ago(61)), presence(D, ago(11)), presence(F, ago(12, 1)), presence(G, ago(8)), presence(I, ago(5))],
      internalWallets: new Set([I]),
      sources: { actions: "measured", rewards: "measured", presence: "measured" },
      rewardsSince: null,
    },
    visits: [
      { day: ago(21).slice(0, 10), source: `post:${POST}`, visits: 6 },
      { day: ago(1).slice(0, 10), source: `post:${POST}`, visits: 4 },
      { day: ago(40).slice(0, 10), source: `post:${POST}`, visits: 100 },
      { day: ago(15).slice(0, 10), source: "utm:x|social|weekly", visits: 5 },
      { day: ago(11).slice(0, 10), source: "friend", visits: 3 },
    ],
    touches: [
      touch(A, "post", POST, ago(20, 2), ago(20, 1)),
      touch(B, "utm", "x|social|weekly", ago(15, 1), ago(15)),
      touch(C, "post", POST, ago(3), ago(3)),
      touch(G, "post", POST, ago(7), ago(7)),
      touch(H, "post", POST, ago(0, 3), ago(0, 2)),
      touch(I, "post", POST, ago(5, 1), ago(5)),
    ],
    posts: [
      { schema: "ryntra.growth-post-code", schemaVersion: "1.0.0", code: POST, kind: "post", network: "x", title: "Thread: why Solana", landing: "/app/swap", createdAt: ago(25), createdBy: "admin:9001" },
      { schema: "ryntra.growth-post-code", schemaVersion: "1.0.0", code: "8KD2F9X", kind: "contest", network: "telegram", title: "Contest", landing: "/", createdAt: ago(1), createdBy: "admin:9001" },
    ],
    budget: { month: "2026-10", limitUsd: 300, spentUsd: 30, leftUsd: 270, reconciled: true },
    sources: { visits: "measured", touches: "measured", posts: "measured", budget: "measured" },
    internalWallets: "measured",
    touchSigning: true,
    ...overrides,
  };
}

test("ranges", () => {
  assert.equal(isPanelRange("7d"), true);
  assert.equal(isPanelRange("24h"), false);
});

test("a return is another purchase on a later day, judged only once the window has passed", () => {
  const first = NOW_MS - 10 * DAY;
  assert.equal(returnedWithin([first, first + 2 * DAY], 7, NOW_MS), true);
  const morning = Date.parse("2026-10-10T08:00:00.000Z");
  assert.equal(returnedWithin([morning, morning + 2 * 3_600_000], 7, NOW_MS), false, "the same day is the same visit");
  assert.equal(returnedWithin([morning, morning + 18 * 3_600_000], 7, NOW_MS), true, "the next morning is a return");
  assert.equal(returnedWithin([first, first + 8 * DAY], 7, NOW_MS), false, "after the seventh day");
  assert.equal(returnedWithin([first], 30, NOW_MS), null, "not yet thirty days old");
  assert.equal(returnedWithin([], 7, NOW_MS), null);
});

test("a 7-day window counts seven whole days of visits", () => {
  const visits = [{ day: ago(7).slice(0, 10), source: `post:${POST}`, visits: 50 }, { day: ago(6).slice(0, 10), source: `post:${POST}`, visits: 2 }];
  const model = projectPanel(story({ range: "7d", visits }));
  assert.equal(model.rows.find((row) => row.key === `post:${POST}`).visits, 2, "the window starts at noon seven days ago: that day's visits are not in it");
});

test("the story: where every wallet came from, and where it stopped", () => {
  const model = projectPanel(story());
  const row = (key) => model.rows.find((candidate) => candidate.key === key);
  const post = row(`post:${POST}`);
  assert.equal(post.label, "Thread: why Solana");
  assert.equal(post.detail, `X · ${POST}`);
  assert.equal(post.visits, 10, "visits of the window only — the 40-day-old ones are outside it");
  assert.equal(post.wallets, 2, "A and H; C was known, G's touch came after it appeared, I is internal");
  assert.equal(post.purchased, 2);
  assert.deepEqual([post.returned7, post.mature7, post.returned30, post.mature30], [1, 1, 0, 0], "A came back the next day; H is too new to judge");
  assert.equal(post.known, 2, "C and G — wallets Ryntra already knew, brought back by the post");
  const utm = row("utm:x|social|weekly");
  assert.deepEqual([utm.label, utm.detail, utm.visits, utm.wallets, utm.purchased], ["x", "social · weekly", 5, 1, 0]);
  const friend = row("friend");
  assert.deepEqual([friend.visits, friend.wallets, friend.purchased], [3, 1, 1], "D, a friend by the referral graph");
  const contest = row("contest:8KD2F9X");
  assert.deepEqual([contest.channel, contest.visits, contest.wallets], ["contest", 0, 0], "an issued code has a row before its first visit");
  assert.deepEqual([model.totals.direct.visits, model.totals.direct.wallets, model.totals.direct.purchased], [null, 2, 1], "F bought; G stays without a tag; visits are not counted without one");
  assert.deepEqual([model.totals.tagged.visits, model.totals.tagged.wallets, model.totals.tagged.purchased], [18, 4, 3]);
  assert.equal(model.totals.all.wallets, 6, "A B D F G H — C is two months old, I is internal");
  assert.deepEqual(model.funnel.map((step) => [step.id, step.value, step.of]), [
    ["visits", 18, null],
    ["wallets", 4, 18],
    ["purchased", 3, 4],
    ["returned7", 1, 2],
    ["returned30", 0, 0],
  ]);
});

test("active investors of the month and the stage gates", () => {
  const model = projectPanel(story());
  /* A (20 and 19 days), C (2 days), D (10), F (12), H (today): five; I is internal. */
  assert.equal(model.aim.value, 5);
  assert.equal(model.aim.stage.stage, 0);
  assert.equal(model.aim.next.from, 100);
  assert.equal(model.aim.toNext, 95);
  assert.deepEqual(STAGE_GATES.map((gate) => gate.from), [0, 100, 300, 5_000]);
  const unread = projectPanel(story({ business: { ...story().business, sources: { actions: "unavailable", rewards: "measured", presence: "measured" } } }));
  assert.equal(unread.aim.value, null, "a ledger that did not read is no zero");
});

test("friends: invited → joined → first purchase → active, and who invites", () => {
  const model = projectPanel(story());
  assert.deepEqual([model.friends.arrivals, model.friends.joined, model.friends.purchased, model.friends.active], [3, 1, 1, 1]);
  assert.deepEqual(model.friends.inviters, [{ wallet: "Einv…xxxx", joined: 1, purchased: 1 }]);
  assert.equal(model.friends.shareOfNew, 1 / 6);
});

test("budget and the price of rewards", () => {
  const model = projectPanel(story());
  assert.deepEqual(model.budget, { month: "2026-10", limitUsd: 300, spentUsd: 30, leftUsd: 270, reconciled: true });
  assert.equal(model.budgetPerActivatedUsd, 30 / 4, "A D F H made their first purchase in October; C's was in August");
  assert.equal(model.money.costRatio, null, "no fee, nothing to divide by");
});

test("what did not read is never a zero", () => {
  const model = projectPanel(story({ sources: { visits: "unavailable", touches: "measured", posts: "measured", budget: "unavailable" }, budget: null }));
  assert.equal(model.funnel[0].value, null);
  assert.ok(model.rows.every((row) => row.visits === null));
  assert.equal(model.friends.arrivals, null);
  assert.equal(model.budget, null);
  assert.equal(model.budgetPerActivatedUsd, null);
});

test("the panel and «Аналітика» count the same new wallets and buyers", () => {
  for (const range of ["7d", "30d", "all"]) {
    const input = story({ range });
    const panel = projectPanel(input);
    const business = projectBusiness({ ...input.business, range, scope: "external" });
    assert.equal(panel.totals.all.wallets, business.audience.newWallets.value, `new wallets, ${range}`);
  }
  const panel = projectPanel(story({ range: "all" }));
  const business = projectBusiness({ ...story().business, range: "30d", scope: "external" });
  assert.equal(panel.aim.value, business.trading.traders.value, "active investors of the month are the thirty days' traders");
});

test("a wallet named by a touch alone, or named a day before it appeared, is nobody's new wallet", () => {
  const ghost = wallet("Zghost");
  const early = wallet("Yearly");
  const input = story({
    touches: [...story().touches, touch(ghost, "utm", "evil|-|-", ago(2), ago(2)), touch(early, "utm", "evil|-|-", ago(9), ago(9))],
    business: { ...story().business, presence: [...story().business.presence, presence(early, ago(5))] },
  });
  const model = projectPanel(input);
  const evil = model.rows.find((row) => row.key === "utm:evil|-|-");
  assert.equal(evil, undefined, "a bound address Ryntra never saw counts nowhere; one named in advance is not the source's");
  assert.equal(model.totals.all.wallets, 7, "the story's six and the early wallet — as «Без мітки»");
  assert.equal(model.totals.direct.wallets, 3);
  const lateBind = projectPanel(story({ touches: story().touches.map((row) => (row.wallet === A ? { ...row, boundAt: ago(17) } : row)) }));
  assert.equal(lateBind.rows.find((row) => row.key === `post:${POST}`).known, 2, "a wallet the post did bring, bound days late, is not «known» — only C and G are");
  const late = projectPanel(story({ touches: story().touches.map((row) => (row.wallet === A ? { ...row, boundAt: ago(2) } : row)) }));
  assert.equal(late.rows.find((row) => row.key === `post:${POST}`).wallets, 1, "a touch that met the wallet weeks after it appeared does not rewrite where it came from");
});

test("a record that did not answer leaves its figures empty, never zero", () => {
  const unread = (sources) => projectPanel(story({ business: { ...story().business, sources: { actions: "measured", rewards: "measured", presence: "measured", ...sources } } }));
  for (const sources of [{ actions: "unavailable" }, { presence: "unavailable" }, { rewards: "unavailable" }]) {
    const model = unread(sources);
    assert.equal(model.totals.all.wallets, null, JSON.stringify(sources));
    assert.ok(model.rows.every((row) => row.wallets === null && row.purchased === null && row.known === null));
    assert.equal(model.funnel[1].value, null);
    assert.ok(model.posts.every((post) => post.wallets === null));
  }
  const touches = projectPanel(story({ sources: { visits: "measured", touches: "unavailable", posts: "measured", budget: "measured" } }));
  assert.equal(touches.totals.tagged.wallets, null);
  assert.equal(touches.totals.tagged.visits, 18, "visits read on their own");
  const friends = unread({ rewards: "unavailable" });
  assert.deepEqual([friends.friends.joined, friends.friends.purchased, friends.friends.active, friends.friends.inviters.length], [null, null, null, 0]);
  const ledger = unread({ actions: "unavailable" });
  assert.equal(ledger.budgetPerActivatedUsd, null);
  const csv = weeklyCsv(story({ business: { ...story().business, sources: { actions: "unavailable", rewards: "measured", presence: "measured" } } }), exportWeek("2026-10-19", NOW));
  assert.ok(csv.includes(`,post:${POST},Thread: why Solana,X · ${POST},4,,,,,`), "the CSV leaves the cells empty too");
  assert.equal(projectPanel(story({ internalWallets: "unavailable" })).sources.internal, "unavailable");
});

test("the week as CSV: a row per source, totals, figures; never a formula", () => {
  assert.equal(exportWeek(null, NOW).start, "2026-10-12T00:00:00.000Z", "the last full week");
  assert.equal(exportWeek("2026-10-19", NOW).end, "2026-10-26T00:00:00.000Z");
  assert.equal(exportWeek("2026-10-20", NOW), null, "not a Monday");
  assert.equal(exportWeek("2026-11-02", NOW), null, "not yet");
  assert.equal(exportWeek("x", NOW), null);
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell('a, "b"'), '"a, ""b"""');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(0.5), "0.50");

  const csv = weeklyCsv(story(), exportWeek("2026-10-19", NOW));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "week_start,week_end,row,channel,source,label,detail,visits,new_wallets,bought_since,first_purchases_in_week,known_wallets,value");
  const post = lines.find((line) => line.includes(`,post:${POST},`));
  assert.equal(post, `2026-10-19,2026-10-25,source,post,post:${POST},Thread: why Solana,X · ${POST},4,1,1,1,1,`, "H came and bought this week; C was brought back");
  assert.ok(lines.some((line) => line.startsWith("2026-10-19,2026-10-25,metric,,new_external_wallets,Нові зовнішні гаманці,,,,,,,1")));
  assert.ok(lines.some((line) => line.includes(",metric,,first_purchases,") && line.endsWith(",1")));
  assert.ok(csv.endsWith("\r\n"));
});
