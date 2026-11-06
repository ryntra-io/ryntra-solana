import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { cohort, demandMessage, demandTrigger, demandWeekSends, lastClosedWeek, mondayOf, projectDemand, readWeek, recentWeeks, NOT_READ } from "./demand-week.ts";
import { ourWallets, readDemandInputs } from "./demand-week.server.ts";
import { runDemandWeek } from "./demand-week-telegram.server.ts";

/* CITY-197: the owner's week of demand — people's launches, agents and turnover, return on day 7 and 30, partners, and
   the one metric — from the engine's records, every unread figure «не прочитано». */

const DAY = 86_400_000;
const WEEK = "2026-10-26";
const START = Date.parse(`${WEEK}T00:00:00.000Z`);
const NOW = Date.UTC(2026, 10, 4, 9, 0);
const PERSON = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OURS = "E1w1XFq33ft6rGz19qTSzKKNuFvChbrUCZuY47adMfLV";
const COIN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const at = (days, hours = 12) => new Date(START + days * DAY + hours * 3_600_000).toISOString();
const ms = (days, hours = 12) => START + days * DAY + hours * 3_600_000;

const INPUTS = {
  week: WEEK,
  ours: new Set([OURS]),
  launches: [
    { creator: PERSON, launchedAt: at(1), state: "LAUNCHED" },
    { creator: PERSON, launchedAt: at(2), state: "LAUNCHED" },
    { creator: OURS, launchedAt: at(2), state: "LAUNCHED" },
    { creator: OTHER, launchedAt: at(3), state: "PENDING" },
    { creator: OTHER, launchedAt: at(8), state: "LAUNCHED" },
  ],
  agents: [
    { owner: PERSON, receiveMint: COIN, trades: [{ at: ms(1), status: "ok", spentRaw: "20000000" }, { at: ms(2), status: "failed", spentRaw: "0" }, { at: ms(-1), status: "ok", spentRaw: "20000000" }] },
    { owner: OURS, receiveMint: COIN, trades: [{ at: ms(1), status: "ok", spentRaw: "20000000" }] },
    { owner: OTHER, receiveMint: COIN, trades: [] },
  ],
  sales: [{ owner: OTHER, status: "sold", at: ms(4), gotRaw: "30000000", feeRaw: "300000" }],
  agentFeeBps: new Map([[COIN, 100]]),
  activity: [
    // D7 cohort (first came 19–25.10): the person came back on another day; the other did not.
    { wallet: PERSON, at: ms(-6) },
    { wallet: PERSON, at: ms(-3) },
    { wallet: OTHER, at: ms(-5) },
    { wallet: OURS, at: ms(-5) },
  ],
  referred: [{ wallet: OTHER, at: ms(2) }],
  poolPartners: [{ wallet: OTHER, at: ms(3) }, { wallet: PERSON, at: ms(-2) }],
  swapsUsd: 12.345,
  partnersUsd: 2,
  solUsd: 150,
};

test("the week: a closed Monday-to-Monday, UTC; a week not closed or not a Monday is not read", () => {
  assert.equal(mondayOf(NOW), "2026-11-02");
  assert.equal(lastClosedWeek(NOW), WEEK);
  assert.equal(readWeek(null, NOW), WEEK);
  assert.equal(readWeek("2026-10-19", NOW), "2026-10-19");
  assert.equal(readWeek("2026-11-02", NOW), null, "this week has not closed");
  assert.equal(readWeek("2026-10-27", NOW), null, "a Tuesday");
  assert.equal(readWeek("26.10.2026", NOW), null);
  assert.deepEqual(recentWeeks(NOW, 3), [WEEK, "2026-10-19", "2026-10-12"]);
});

test("five figures from the engine's records: people only, the week only", () => {
  const week = projectDemand(INPUTS);
  assert.equal(week.from, `${WEEK}T00:00:00.000Z`);
  assert.deepEqual(week.launches, { coins: 2, people: 1 }, "Ryntra's own launch, a pending one and next week's are not counted");
  // The person's buy in the week and the other's sale; Ryntra's agent is not a person's.
  assert.equal(week.agents.active, 2);
  assert.equal(week.agents.turnoverSol, 0.05);
  assert.deepEqual(week.returns.d7, { back: 1, of: 2 });
  assert.equal(week.partners.people, 1, "one wallet once, the week's arrivals only");
  // Agents' fees: 1 % of 0.02 SOL + 0.0003 SOL of the sale = 0.0005 SOL = $0.075 → $0.08.
  assert.equal(week.revenue.agentsSol, 0.0005);
  assert.equal(week.revenue.agentsUsd, 0.08);
  assert.equal(week.revenue.netUsd, 10.43);
});

test("not read is never zero: a source that failed leaves its figures null, and the one metric with it", () => {
  const blind = projectDemand({ ...INPUTS, ours: null });
  assert.equal(blind.launches.coins, null, "without Ryntra's own list nobody can be told apart");
  assert.equal(blind.agents.active, null);
  assert.equal(blind.returns.d7, null);
  assert.equal(blind.partners.people, null);
  assert.equal(projectDemand({ ...INPUTS, swapsUsd: null }).revenue.netUsd, null);
  assert.equal(projectDemand({ ...INPUTS, partnersUsd: null }).revenue.netUsd, null);
  assert.equal(projectDemand({ ...INPUTS, solUsd: null }).revenue.netUsd, null, "SOL fees with no price are not dollars");
  assert.equal(projectDemand({ ...INPUTS, agentFeeBps: new Map() }).revenue.agentsUsd, null, "a coin whose rate did not read");
  assert.equal(projectDemand({ ...INPUTS, sales: null }).agents.turnoverSol, null);
  assert.equal(projectDemand({ ...INPUTS, launches: null }).launches.coins, null);
  assert.equal(projectDemand({ ...INPUTS, referred: null }).partners.people, null);
  // A week with nothing is a measured nothing.
  const empty = projectDemand({ ...INPUTS, launches: [], agents: [], sales: [], activity: [], referred: [], poolPartners: [], swapsUsd: 0, partnersUsd: 0, solUsd: null });
  assert.deepEqual({ launches: empty.launches.coins, agents: empty.agents.active, net: empty.revenue.netUsd }, { launches: 0, agents: 0, net: 0 });
});

test("return: of those who first came in a week, who came back on a later day within the days", () => {
  const rows = [
    { wallet: PERSON, at: ms(0, 1) },
    { wallet: PERSON, at: ms(0, 20) },
    { wallet: OTHER, at: ms(0) },
    { wallet: OTHER, at: ms(6) },
  ];
  assert.deepEqual(cohort(rows, new Set(), START, 7), { back: 1, of: 2 }, "the same day is not a return");
  assert.deepEqual(cohort([{ wallet: OTHER, at: ms(0) }, { wallet: OTHER, at: ms(9) }], new Set(), START, 7), { back: 0, of: 1 }, "too late for day 7");
  assert.deepEqual(cohort(rows, new Set([PERSON, OTHER]), START, 7), { back: 0, of: 0 });
});

test("the owner's message: one line a figure, «не прочитано» where a figure did not read", () => {
  const text = demandMessage(projectDemand(INPUTS));
  assert.equal(
    text,
    ["Ryntra · тиждень 26.10–01.11", "", "Чистий дохід: $10,43", "Запуски людей: 2", "Агенти: 2 · обіг 0,05 SOL", "Повернення D7: 1 з 2 · D30: нікого в когорті", "Від партнерів: 1"].join("\n"),
  );
  const blind = demandMessage(projectDemand({ ...INPUTS, ours: null, swapsUsd: null }));
  assert.ok(blind.includes(`Чистий дохід: ${NOT_READ}`));
  assert.ok(blind.includes(`Запуски людей: ${NOT_READ}`));
  assert.ok(!/\b0\b/u.test(blind.replace(/\d{2}\.\d{2}/gu, "")), "no zero stands for an unread figure");
});

test("the reads: a store that answers gives every figure; Ryntra's wallets come from the owner's list, the signers and the agent", async () => {
  const store = createMemoryGuardStore();
  await store.collection("adminInternalWallets").set(OURS, { wallet: OURS, label: "owner", addedAt: at(0) });
  await store.collection("launches").set(`solana:mainnet:${COIN}`, { cluster: "mainnet", state: "LAUNCHED", token: COIN, creator: PERSON, launchedAt: at(1) });
  const env = { RYNTRA_LAUNCH_EXECUTOR_ADDRESS: OTHER };
  const ours = await ourWallets(store, env);
  assert.ok(ours.has(OURS) && ours.has(OTHER));
  const inputs = await readDemandInputs(store, WEEK, env, { feeBps: async () => 100, solUsd: async () => 150 });
  assert.equal(inputs.launches.length, 1);
  assert.deepEqual(inputs.agents, []);
  assert.equal(inputs.swapsUsd, 0);
  assert.equal(inputs.partnersUsd, 0, "no statement while payouts are shut: nothing owed");
  const week = projectDemand(inputs);
  assert.equal(week.launches.coins, 1);
  assert.equal(week.revenue.netUsd, 0);
  // Payouts on and no statement for a closed week: what is owed is not read.
  assert.equal((await readDemandInputs(store, WEEK, { ...env, RYNTRA_PARTNER_PAYOUTS: "on" }, { solUsd: async () => 150 })).partnersUsd, null);
});

test("Telegram: shut by default, once a week to the owner's chat, the claim given back when the send fails", async () => {
  const guard = { store: createMemoryGuardStore(), writes: { allowed: true } };
  const read = async () => projectDemand(INPUTS);
  const sent = [];
  const send = async (chat, text, keyboard) => (sent.push({ chat, text, keyboard }), true);
  assert.equal(demandWeekSends(undefined), false);
  assert.equal(demandWeekSends(" ON "), true);
  assert.deepEqual(await runDemandWeek({}, guard, { read, send }), { ran: false, why: "closed" });
  assert.deepEqual(await runDemandWeek({ RYNTRA_DEMAND_WEEK: "on" }, guard, { read, send }), { ran: false, why: "no-chat" });
  assert.deepEqual(await runDemandWeek({ RYNTRA_DEMAND_WEEK: "on", ALERT_TELEGRAM_ID: "42" }, { ...guard, writes: { allowed: false } }, { read, send }), { ran: false, why: "read-only" });
  const env = { RYNTRA_DEMAND_WEEK: "on", ALERT_TELEGRAM_ID: "42" };
  // A failed send leaves the week untold for the next pass.
  assert.deepEqual(await runDemandWeek(env, guard, { now: () => NOW, read, send: async () => false }), { ran: true, week: WEEK, sent: false });
  assert.deepEqual(await runDemandWeek(env, guard, { now: () => NOW, read, send }), { ran: true, week: WEEK, sent: true });
  assert.deepEqual(await runDemandWeek(env, guard, { now: () => NOW, read, send }), { ran: false, why: "told" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat, 42);
  assert.ok(sent[0].text.startsWith("Ryntra · тиждень 26.10–01.11"));
  assert.equal(sent[0].keyboard[0][0].url, "https://ryntra.io/admin/growth");
  assert.equal(demandTrigger(WEEK), "demand-week:2026-10-26");
});

test("the wiring: the cron is weekly and bearer-only, the admin route is the operator's and reads only", () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const cron = JSON.parse(read("vercel.json")).crons.find((row) => row.path === "/api/cron/demand-week");
  assert.equal(cron.schedule, "43 5 * * 1");
  const route = read("app/api/cron/demand-week/route.ts");
  assert.match(route, /decideBearerAuth/u);
  assert.match(route, /CRON_SECRET/u);
  const admin = read("app/api/admin/growth/demand/route.ts");
  assert.match(admin, /getAdminSession/u);
  assert.doesNotMatch(admin, /export async function (POST|PUT|PATCH|DELETE)/u);
  assert.match(read("app/admin/growth/growth-panel.tsx"), /<DemandWeekCard \/>/u);
});

test("the card's module stays client-safe and keeps the panel's rule of a return", async () => {
  const source = readFileSync(new URL("./demand-week.ts", import.meta.url), "utf8");
  assert.deepEqual(source.match(/^import .+$/gmu), ['import { agentFeeRaw } from "../mandate/fee-rates.ts";'], "one import, client-safe");
  const { returnedWithin: panelRule } = await import("./panel.ts");
  const { returnedWithin: ownRule } = await import("./demand-week.ts");
  for (const times of [[0, DAY * 2], [0, 3_600_000], [0, DAY * 8], []]) for (const now of [DAY * 3, DAY * 10]) assert.equal(ownRule(times, 7, now), panelRule(times, 7, now));
});
