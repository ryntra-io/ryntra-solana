import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { applyMonitorResult } from "./apply.ts";
import { words } from "./copy.ts";
import { deliverOutbox } from "./deliver.ts";
import { evaluateTradingPlan } from "./engine.ts";
import { resolveInboxLink } from "./inbox.ts";
import { positionSaleHref, setPositionWatch } from "./position-watch.ts";
import { isPositionNote, listInbox, listMonitors, monitorKey, monitorNotes, monitorsOf, newMonitorId, outboxOf } from "./store.ts";
import { composeMonitoringSurface } from "./surface.ts";

/*
 * RYN-PROTECT-SIGNAL-001, subtask 1 — «Ryntra попередить» on a position warns
 * at its loss limit and its target: one note in the language it was turned on
 * in, its one action «Відкрити продаж», its link the company with the sale
 * opening, and one Telegram message with the same button. A bought plan's
 * target is watched too. Nothing here sells: the sale is the person's own.
 */

const NOW = Date.parse("2026-09-28T12:00:00.000Z");
const OWNER = "So11111111111111111111111111111111111111112";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const iso = (ms) => new Date(ms).toISOString();

async function seedWatchMonitor(store) {
  const watch = await setPositionWatch(store, OWNER, { mint: NVDAX, symbol: "NVDAx", preset: "careful", basisPerUnit: 180, basisObservedAt: iso(NOW), locale: "uk" }, NOW);
  const id = newMonitorId();
  await monitorsOf(store).compareAndSet(monitorKey(OWNER, id), null, {
    version: 0, id, owner: OWNER, subjectKind: "position", subjectId: NVDAX, label: "NVDAx", href: "/app/stocks/NVDAx", paper: false,
    status: "watching", paused: false, observations: [], lastCheckedAt: null, lastTriggeredAt: null, createdAt: iso(NOW), updatedAt: iso(NOW),
  });
  return watch;
}

/** One pass over the watch as the tick makes it: the engine's position words, the note in the watch's language, «Відкрити продаж». */
async function pass(store, watch, price, nowMs) {
  const monitor = (await listMonitors(store, OWNER))[0];
  const result = evaluateTradingPlan({
    plan: { planId: `watch:${OWNER}:${NVDAX}:${watch.createdAt}`, symbol: "NVDAx", status: "executed", paused: false, maxPricePerShare: null, invalidationPerShare: watch.limitPerUnit, targetPerShare: watch.targetPerUnit, validUntil: null, maxReferenceDeviationPct: null, evidence: [] },
    market: { lastPriceUsd: price, referencePerShare: null, deviationPct: null, observedAt: iso(nowMs) },
    evidence: [],
    nowMs,
    previous: monitor.observations,
  });
  await applyMonitorResult(store, monitor, result.status, result.findings, result.crossings, nowMs, watch.locale, monitor.href, { cta: words(watch.locale).openSale });
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
    accountByWallet: async () => ACCOUNT,
    send: async (chatId, text, keyboard) => {
      sent.push({ chatId, text, keyboard });
      return { message_id: sent.length };
    },
  };
}

test("between the limit and the target nothing is written; the limit crossed writes one note, «Відкрити продаж», in the watch's language", async () => {
  const store = createMemoryGuardStore();
  const watch = await seedWatchMonitor(store);
  assert.deepEqual([watch.limitPerUnit, watch.targetPerUnit], [171, 198]);
  const calm = await pass(store, watch, 182, NOW);
  assert.equal(calm.status, "watching");
  assert.deepEqual(calm.findings.map((row) => [row.kind, row.outcome]), [["plan.invalidation", "pass"], ["plan.target", "pass"]]);
  assert.equal((await listInbox(store, OWNER)).length, 0);

  const crossed = await pass(store, watch, 170.5, NOW + 300_000);
  assert.equal(crossed.status, "needs_attention");
  const [note] = await listInbox(store, OWNER);
  assert.equal(note.subject.kind, "position");
  assert.equal(note.subject.id, NVDAX);
  assert.equal(note.cta, "Відкрити продаж");
  assert.equal(note.title, "NVDAx дійшов до твоєї межі збитку");
  assert.match(note.reason, /Ryntra не підписує за тебе/);
  /* The Ukrainian note writes money the way the Ukrainian screen does. */
  assert.match(note.reason, /^Ринок \$170,50; твоя межа збитку — \$171,00\./);
  assert.equal(note.finding.facts.target, 198);
  assert.equal(note.finding.facts.invalidation, 171);
  /* The same line held on the next pass is not a second note. */
  await pass(store, watch, 169, NOW + 600_000);
  assert.equal((await listInbox(store, OWNER)).length, 1);
});

test("the target reached is «Дія» too: its own note, the same one action", async () => {
  const store = createMemoryGuardStore();
  const watch = await seedWatchMonitor(store);
  await pass(store, watch, 182, NOW);
  await pass(store, watch, 199, NOW + 300_000);
  const [note] = await listInbox(store, OWNER);
  assert.equal(note.finding.kind, "plan.target");
  assert.equal(note.title, "NVDAx дійшов до твоєї цілі");
  assert.equal(note.cta, "Відкрити продаж");
});

test("a position's note opens the company with the sale opening, and Telegram carries the same link and button", async () => {
  const store = createMemoryGuardStore();
  const watch = await seedWatchMonitor(store);
  await pass(store, watch, 182, NOW);
  await pass(store, watch, 170, NOW + 300_000);
  const [note] = await listInbox(store, OWNER);
  assert.equal(await resolveInboxLink(store, OWNER, note.id), `${positionSaleHref("NVDAx")}&from=monitoring`);
  assert.equal(positionSaleHref("NVDAx"), "/app/stocks/NVDAx?sell=1");

  const sent = [];
  await seedTelegramChannel(store);
  await deliverOutbox(store, NOW + 300_001, { telegram: fakeTelegram(sent) });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Ryntra\nNVDAx дійшов до твоєї межі збитку\n/);
  assert.equal(sent[0].keyboard[0][0].text, "Відкрити продаж");
  assert.match(sent[0].keyboard[0][0].url, /\/app\/stocks\/NVDAx\?sell=1$/);
  const rows = await outboxOf(store).valuesWithPrefix("");
  assert.deepEqual(rows.filter((row) => row.channel === "telegram").map((row) => row.state), ["sent"]);
});

test("a position's card on the surface opens the sale when it needs the person, the company otherwise; its notes are not a plan's", async () => {
  const store = createMemoryGuardStore();
  const watch = await seedWatchMonitor(store);
  await pass(store, watch, 182, NOW);
  let surface = composeMonitoringSurface(await listMonitors(store, OWNER), await listInbox(store, OWNER), "uk");
  assert.equal(surface.watching[0].cta, "Відкрити позицію");
  assert.deepEqual(surface.watching[0].subject, { kind: "position", id: NVDAX });
  await pass(store, watch, 170, NOW + 300_000);
  const notes = await listInbox(store, OWNER);
  surface = composeMonitoringSurface(await listMonitors(store, OWNER), notes, "uk");
  assert.equal(surface.attention[0].cta, "Відкрити продаж");
  assert.equal(isPositionNote(notes[0]), true);
  assert.equal(monitorNotes(notes).length, 0, "plan memory reads plans' notes, never a position's warning");
});

test("a bought plan's target is watched once the buy settled; a plan before its buy keeps its entry rules and no target", () => {
  const plan = { planId: "plan_target", symbol: "AAPLx", status: "executed", paused: false, maxPricePerShare: 350, invalidationPerShare: 306, targetPerShare: 408, validUntil: null, maxReferenceDeviationPct: null, evidence: [] };
  const reached = evaluateTradingPlan({ plan, market: { lastPriceUsd: 410, referencePerShare: null, deviationPct: null, observedAt: iso(NOW) }, evidence: [], nowMs: NOW, previous: [] });
  assert.deepEqual(reached.findings.map((row) => [row.kind, row.outcome]), [["plan.invalidation", "pass"], ["plan.target", "fail"]]);
  assert.equal(reached.crossings[0].finding.title.en, "AAPLx reached your target");
  const entry = evaluateTradingPlan({ plan: { ...plan, status: "active" }, market: { lastPriceUsd: 410, referencePerShare: null, deviationPct: null, observedAt: iso(NOW) }, evidence: [], nowMs: NOW, previous: [] });
  assert.ok(!entry.findings.some((row) => row.kind === "plan.target"), "before the buy the target is a plan's rule, not a warning");
  const noTarget = evaluateTradingPlan({ plan: { ...plan, targetPerShare: null }, market: { lastPriceUsd: 410, referencePerShare: null, deviationPct: null, observedAt: iso(NOW) }, evidence: [], nowMs: NOW, previous: [] });
  assert.deepEqual(noTarget.findings.map((row) => row.kind), ["plan.invalidation"]);
  const unread = evaluateTradingPlan({ plan, market: { lastPriceUsd: null, referencePerShare: null, deviationPct: null, observedAt: null }, evidence: [], nowMs: NOW, previous: [] });
  assert.ok(!unread.findings.some((row) => row.kind === "plan.target"), "no price, no judgement of the target");
});
