import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { applyMonitorResult } from "./apply.ts";
import { telegramText } from "./copy.ts";
import { evaluateTradingPlan } from "./engine.ts";
import { deliverOutbox } from "./deliver.ts";
import { markInboxRead, resolveInboxLink } from "./inbox.ts";
import {
  inboxOf,
  listInbox,
  listMonitors,
  monitorKey,
  monitorsOf,
  newMonitorId,
  outboxKey,
  outboxOf,
  preferencesOf,
} from "./store.ts";

/**
 * Ten explicit acceptance checks for monitoring and push delivery
 * (2026-09-20), the first eight at the durable layer with a controlled clock
 * and a memory store — checks 9 and 10 (the stock pages healthy after the
 * merge; the stock quotes' resilience intact) are production reads and
 * `lib/stocks/quote-breaker.test.mjs`. Nothing here talks to Telegram, a push
 * provider, a wallet or a venue: the Telegram side is injected, and a note is
 * never permission to trade.
 */

const NOW = Date.parse("2026-09-20T18:00:00.000Z");
const OWNER = "So11111111111111111111111111111111111111112";
const OTHER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const PLAN = "plan_acceptance";
const iso = (ms) => new Date(ms).toISOString();

const planRules = (overrides = {}) => ({
  planId: PLAN,
  symbol: "NVDAx",
  status: "active",
  paused: false,
  maxPricePerShare: 224,
  invalidationPerShare: 197.75,
  validUntil: null,
  maxReferenceDeviationPct: null,
  evidence: [],
  ...overrides,
});
const market = (lastPriceUsd) => ({ lastPriceUsd, referencePerShare: 219, deviationPct: 0, observedAt: iso(NOW) });

async function seedMonitor(store, owner = OWNER) {
  const id = newMonitorId();
  const row = {
    version: 0,
    id,
    owner,
    subjectKind: "trading-plan",
    subjectId: PLAN,
    label: "NVDAx",
    href: `/app/strategies/plans/${PLAN}`,
    paper: false,
    status: "watching",
    paused: false,
    observations: [],
    lastCheckedAt: null,
    lastTriggeredAt: null,
    createdAt: iso(NOW),
    updatedAt: iso(NOW),
  };
  await monitorsOf(store).compareAndSet(monitorKey(owner, id), null, row);
  return row;
}

/** One scheduler pass for one plan: evaluate on the monitor's own observations, then apply. */
async function tick(store, owner, rules, price, nowMs) {
  const monitor = (await listMonitors(store, owner))[0];
  const result = evaluateTradingPlan({ plan: rules, market: market(price), evidence: [], nowMs, previous: monitor.observations });
  await applyMonitorResult(store, monitor, result.status, result.findings, result.crossings, nowMs, "en", monitor.href);
  return result;
}

async function seedTelegramChannel(store) {
  await store.collection("notificationChannels").set(ACCOUNT, {
    schema: "ryntra.notification-channel",
    schemaVersion: "1.0.0",
    version: 0,
    accountId: ACCOUNT,
    telegramId: 700000001,
    username: "owner",
    connectedAt: iso(NOW),
  });
}

function fakeTelegram(sent) {
  return {
    accountByWallet: async (_chain, address) => (address === OWNER ? ACCOUNT : null),
    send: async (chatId, text, keyboard) => {
      sent.push({ chatId, text, keyboard });
      return { message_id: sent.length };
    },
  };
}

test("1 · a condition that is false writes no note and no outbox row", async () => {
  const store = createMemoryGuardStore();
  await seedMonitor(store);
  const result = await tick(store, OWNER, planRules(), 210, NOW);
  assert.equal(result.status, "watching");
  assert.equal(result.crossings.length, 0);
  assert.equal((await listInbox(store, OWNER)).length, 0);
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 0);
});

test("2 · a condition that becomes true writes exactly one note and one outbox row per enabled channel", async () => {
  const store = createMemoryGuardStore();
  await seedMonitor(store);
  await tick(store, OWNER, planRules(), 210, NOW);
  const crossed = await tick(store, OWNER, planRules(), 230, NOW + 300_000);
  assert.equal(crossed.status, "needs_attention");
  assert.equal(crossed.crossings.length, 1);
  const inbox = await listInbox(store, OWNER);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0].title, /above your price bound/);
  const outbox = await outboxOf(store).valuesWithPrefix("");
  assert.deepEqual(outbox.map((row) => row.channel).sort(), ["push", "telegram"]);
  assert.ok(outbox.every((row) => row.inboxId === inbox[0].id));
});

test("3 · repeated scheduler runs in the same state write no second note; a failure after a recovery is a new note", async () => {
  const store = createMemoryGuardStore();
  await seedMonitor(store);
  await tick(store, OWNER, planRules(), 210, NOW);
  await tick(store, OWNER, planRules(), 230, NOW + 300_000);
  for (let n = 2; n <= 6; n += 1) await tick(store, OWNER, planRules(), 230 + n, NOW + n * 300_000);
  assert.equal((await listInbox(store, OWNER)).length, 1, "five more passes in the same state: still one note");
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 2, "still one outbox row per channel");
  /* A retry of the very same tick — the same prior observations — claims the same identity and writes nothing. */
  const monitor = (await listMonitors(store, OWNER))[0];
  const priorObservations = monitor.observations;
  const replay = evaluateTradingPlan({ plan: planRules(), market: market(236), evidence: [], nowMs: NOW + 6 * 300_000, previous: priorObservations });
  assert.equal(replay.crossings.length, 0);
  /* The price returns inside the bound, then breaks it again: that is a second crossing and a second note. */
  const back = await tick(store, OWNER, planRules(), 210, NOW + 7 * 300_000);
  assert.equal(back.status, "watching");
  assert.equal(back.crossings.length, 0);
  const firstNote = (await listInbox(store, OWNER))[0];
  const again = await tick(store, OWNER, planRules(), 240, NOW + 8 * 300_000);
  assert.equal(again.crossings.length, 1);
  assert.notEqual(again.crossings[0].identity, firstNote.triggerId, "a different transition is a different identity");
  assert.equal((await listInbox(store, OWNER)).length, 2, "the second failure is told, once");
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 4);
});

test("4 · the note carries the exact deep link, which resolves to the owned record as it stands and marks the note read", async () => {
  const store = createMemoryGuardStore();
  const seeded = await seedMonitor(store);
  await tick(store, OWNER, planRules(), 210, NOW);
  await tick(store, OWNER, planRules(), 230, NOW + 300_000);
  const [note] = await listInbox(store, OWNER);
  assert.match(note.href, /^\/app\/alerts\/open\?n=inb_[0-9a-f]{24}$/);
  assert.equal(note.href, `/app/alerts/open?n=${note.id}`);
  const target = await resolveInboxLink(store, OWNER, note.id);
  assert.equal(target, `${seeded.href}?from=monitoring`, "the link opens the plan the note is about, never an execution");
  assert.equal((await listInbox(store, OWNER))[0].unread, false, "opening the note marks it read");
  assert.equal(await resolveInboxLink(store, OWNER, "inb_000000000000000000000000"), null);
  /* A note carries words, a link, the exact record it is about, both languages of its words and the figures behind them (2026-09-22) — never a quote, an amount to send or an authorization. */
  assert.deepEqual(Object.keys(note).sort(), ["context", "createdAt", "cta", "finding", "href", "id", "locale", "monitorId", "owner", "paper", "reason", "subject", "text", "title", "triggerId", "unread"]);
  assert.deepEqual(note.subject, { kind: "trading-plan", id: PLAN }, "the note names the exact plan, never a symbol to match on");
  assert.equal(note.text.en.title, note.title, "the tick's own words are the English pair");
  assert.match(note.text.uk.title, /вище твоєї цінової межі/, "the Ukrainian pair is stored beside them");
  assert.equal(note.finding.kind, "plan.price_bound");
  assert.equal(note.finding.outcome, "fail");
  assert.equal(note.finding.facts.price, 230);
  assert.equal(note.finding.facts.bound, planRules().maxPricePerShare);
  assert.equal(note.finding.facts.symbol, planRules().symbol);
});

test("5 · stale evidence needs a review and never passes; an unavailable source is not a trigger", () => {
  const rules = planRules({ evidence: [{ conditionId: "ev-0-dex_volume_usd-24h", metric: "dex_volume_usd", required: true }] });
  const stale = evaluateTradingPlan({
    plan: rules,
    market: market(210),
    evidence: [{ conditionId: "ev-0-dex_volume_usd-24h", metric: "dex_volume_usd", outcome: "pass", reason: "held", state: "STALE", served: "stale-cache" }],
    nowMs: NOW,
    previous: [],
  });
  const staleFinding = stale.findings.find((row) => row.kind === "plan.evidence");
  assert.equal(staleFinding.outcome, "stale");
  assert.equal(staleFinding.material, true);
  assert.equal(stale.status, "needs_attention");
  assert.equal(stale.crossings.length, 1, "a stale reading is told once, as a review, not as a pass");
  const unavailable = evaluateTradingPlan({
    plan: rules,
    market: market(210),
    evidence: [{ conditionId: "ev-0-dex_volume_usd-24h", metric: "dex_volume_usd", outcome: "unknown", reason: "The source did not answer.", state: "UNAVAILABLE", served: "none" }],
    nowMs: NOW,
    previous: [],
  });
  const missing = unavailable.findings.find((row) => row.kind === "plan.evidence");
  assert.equal(missing.outcome, "unavailable");
  assert.equal(missing.material, false);
  assert.equal(unavailable.crossings.length, 0, "a provider fault is not a change in the market");
  assert.equal(unavailable.status, "unavailable");
  const unknown = evaluateTradingPlan({
    plan: rules,
    market: market(210),
    evidence: [{ conditionId: "ev-0-dex_volume_usd-24h", metric: "dex_volume_usd", outcome: "unknown", reason: "This figure could not be judged.", state: "FRESH", served: "provider" }],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(unknown.findings.find((row) => row.kind === "plan.evidence").outcome, "unknown");
  assert.notEqual(unknown.findings.find((row) => row.kind === "plan.evidence").outcome, "pass");
});

test("6 · inside quiet hours the Telegram row waits until the window ends while the note is already in Ryntra", async () => {
  const store = createMemoryGuardStore();
  await seedMonitor(store);
  await seedTelegramChannel(store);
  await preferencesOf(store).compareAndSet(`solana:mainnet:${OWNER}`, null, {
    version: 1,
    owner: OWNER,
    inbox: true,
    telegram: true,
    push: false,
    quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
    updatedAt: iso(NOW),
  });
  const night = Date.parse("2026-09-20T23:30:00.000Z");
  await tick(store, OWNER, planRules(), 210, night - 300_000);
  await tick(store, OWNER, planRules(), 230, night);
  assert.equal((await listInbox(store, OWNER)).length, 1, "the note is in Ryntra at once");
  const sent = [];
  await deliverOutbox(store, night, { telegram: fakeTelegram(sent) });
  assert.equal(sent.length, 0, "nothing leaves during quiet hours");
  const [row] = await outboxOf(store).valuesWithPrefix("");
  assert.equal(row.state, "pending");
  assert.equal(row.nextAttemptAt, "2026-09-21T07:00:00.000Z", "held until the window ends");
  await deliverOutbox(store, Date.parse("2026-09-21T07:05:00.000Z"), { telegram: fakeTelegram(sent) });
  assert.equal(sent.length, 1, "delivered once the window has passed");
  assert.equal((await outboxOf(store).valuesWithPrefix(""))[0].state, "sent");
});

test("6b · Telegram: one event is one message with the exact link, no buy or sell wording, no secret; a second pass resends nothing", async () => {
  const store = createMemoryGuardStore();
  await seedMonitor(store);
  await seedTelegramChannel(store);
  await tick(store, OWNER, planRules(), 210, NOW);
  await tick(store, OWNER, planRules(), 230, NOW + 300_000);
  const sent = [];
  await deliverOutbox(store, NOW + 300_001, { telegram: fakeTelegram(sent) });
  assert.equal(sent.length, 1);
  const [note] = await listInbox(store, OWNER);
  const link = `https://ryntra.io${note.href}`;
  assert.ok(sent[0].text.includes(link), "the message carries the exact deep link");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Review plan", url: link }]]);
  assert.doesNotMatch(sent[0].text, /\b(buy|sell|long|short|купуй|продавай)\b/i);
  assert.doesNotMatch(sent[0].text, /token|secret|key=|Bearer/i);
  assert.equal(sent[0].chatId, 700000001);
  assert.equal(telegramText({ label: "NVDAx", reason: "x", href: link, paper: false }).includes("Review plan"), true);
  await deliverOutbox(store, NOW + 900_000, { telegram: fakeTelegram(sent) });
  await deliverOutbox(store, NOW + 1_800_000, { telegram: fakeTelegram(sent) });
  assert.equal(sent.length, 1, "a sent row is never sent again");
  const telegramRow = await outboxOf(store).get(outboxKey(OWNER, note.triggerId, "telegram"));
  assert.equal(telegramRow.state, "sent");
  assert.equal(telegramRow.attempts, 1);
  const pushRow = await outboxOf(store).get(outboxKey(OWNER, note.triggerId, "push"));
  assert.equal(pushRow.state, "skipped_no_destination", "no device registered: skipped honestly, never counted as sent");
});

test("7 · a disabled channel gets no row; a wallet without a Telegram channel is skipped as no destination", async () => {
  const store = createMemoryGuardStore();
  await seedMonitor(store);
  await preferencesOf(store).compareAndSet(`solana:mainnet:${OWNER}`, null, {
    version: 1,
    owner: OWNER,
    inbox: true,
    telegram: false,
    push: false,
    quietHours: null,
    updatedAt: iso(NOW),
  });
  await tick(store, OWNER, planRules(), 210, NOW);
  await tick(store, OWNER, planRules(), 230, NOW + 300_000);
  assert.equal((await listInbox(store, OWNER)).length, 1, "the note is still in Ryntra");
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 0, "no external row for a channel the person turned off");

  const other = createMemoryGuardStore();
  await seedMonitor(other);
  await tick(other, OWNER, planRules(), 210, NOW);
  await tick(other, OWNER, planRules(), 230, NOW + 300_000);
  const sent = [];
  await deliverOutbox(other, NOW + 300_001, { telegram: { accountByWallet: async () => ACCOUNT, send: async (...args) => { sent.push(args); return {}; } } });
  assert.equal(sent.length, 0);
  const row = (await outboxOf(other).valuesWithPrefix("")).find((item) => item.channel === "telegram");
  assert.equal(row.state, "skipped_no_destination", "no channel connected: nothing sent, the state says so");
});

test("8 · two wallets stay apart: the other wallet reads no note, resolves no link, and its own monitor is its own", async () => {
  const store = createMemoryGuardStore();
  await seedMonitor(store, OWNER);
  await seedMonitor(store, OTHER);
  await tick(store, OWNER, planRules(), 210, NOW);
  await tick(store, OWNER, planRules(), 230, NOW + 300_000);
  const [note] = await listInbox(store, OWNER);
  assert.equal((await listInbox(store, OTHER)).length, 0);
  assert.equal(await resolveInboxLink(store, OTHER, note.id), null, "another wallet cannot open this note");
  assert.equal(await markInboxRead(store, OTHER, note.id), false);
  assert.equal((await listInbox(store, OWNER))[0].unread, true, "the other wallet's attempt changed nothing");
  assert.equal((await listMonitors(store, OTHER)).length, 1);
  assert.equal((await listMonitors(store, OTHER))[0].status, "watching", "the other wallet's monitor did not move");
  assert.equal((await inboxOf(store).valuesWithPrefix(`solana:mainnet:${OTHER}:`)).length, 0, "the store keys are wallet-prefixed");
});
