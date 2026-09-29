import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { evaluateTradingPlan, nextObservations } from "./engine.ts";
import { inQuietHours } from "./quiet-hours.ts";
import { registerDevice, revokeDevice } from "./devices.ts";
import { applyMonitorResult, pushDeliveryState } from "./apply.ts";
import {
  claimTrigger,
  inboxOf,
  devicePrefix,
  devicesOf,
  listDevices,
  listInbox,
  listMonitors,
  monitorKey,
  monitorsOf,
  newInboxId,
  newMonitorId,
  outboxKey,
  outboxOf,
  readPreferences,
} from "./store.ts";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const OWNER = "So11111111111111111111111111111111111111112";
const OTHER = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function seedMonitor(store, owner = OWNER) {
  const id = newMonitorId();
  const at = new Date(NOW).toISOString();
  const row = {
    version: 0,
    id,
    owner,
    subjectKind: "trading-plan",
    subjectId: "plan_test",
    label: "NVDAx",
    href: "/app/strategies/plans/plan_test",
    paper: false,
    status: "watching",
    paused: false,
    observations: [],
    lastCheckedAt: null,
    lastTriggeredAt: null,
    createdAt: at,
    updatedAt: at,
  };
  await monitorsOf(store).compareAndSet(monitorKey(owner, id), null, row);
  return row;
}

test("a crossing writes one inbox row; a retry of the same identity writes none", async () => {
  const store = createMemoryGuardStore();
  const first = await claimTrigger(store, "plan_test:plan.price_bound:fail", new Date(NOW).toISOString());
  assert.equal(first, true);
  const inboxId = newInboxId();
  await inboxOf(store).insertIfAbsent(`solana:mainnet:${OWNER}:${inboxId}`, {
    id: inboxId,
    owner: OWNER,
    monitorId: "mon_1",
    triggerId: "plan_test:plan.price_bound:fail",
    title: "NVDAx is above your price bound",
    reason: "The market moved through the bound you wrote.",
    context: "NVDAx",
    href: `/app/alerts/open?n=${inboxId}`,
    cta: "Review plan",
    paper: false,
    unread: true,
    createdAt: new Date(NOW).toISOString(),
    locale: "en",
  });
  const retry = await claimTrigger(store, "plan_test:plan.price_bound:fail", new Date(NOW + 1).toISOString());
  assert.equal(retry, false);
  const rows = await listInbox(store, OWNER);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unread, true);
});

test("another wallet cannot read this inbox", async () => {
  const store = createMemoryGuardStore();
  const inboxId = newInboxId();
  await inboxOf(store).insertIfAbsent(`solana:mainnet:${OWNER}:${inboxId}`, {
    id: inboxId,
    owner: OWNER,
    monitorId: "mon_1",
    triggerId: "x",
    title: "t",
    reason: "r",
    context: "c",
    href: "/app/alerts",
    cta: "Review plan",
    paper: false,
    unread: true,
    createdAt: new Date(NOW).toISOString(),
    locale: "en",
  });
  const other = await listInbox(store, OTHER);
  assert.equal(other.length, 0);
});

test("device register then revoke drops the token and leaves the row revoked", async () => {
  const store = createMemoryGuardStore();
  const registered = await registerDevice(store, OWNER, {
    platform: "android",
    token: "a".repeat(32),
    appVersion: "1.0.0",
    locale: "en",
    categories: ["plan"],
    quietHours: null,
  }, NOW);
  assert.ok(registered.deviceId.startsWith("dev_"));
  const revoked = await revokeDevice(store, OWNER, registered.deviceId, NOW + 1);
  assert.equal(revoked, true);
  const again = await revokeDevice(store, OWNER, registered.deviceId, NOW + 2);
  assert.equal(again, true);
});

test("one owner per token (2026-09-22): the same token registered under a second wallet is revoked under the first; the first wallet's other device stays", async () => {
  const store = createMemoryGuardStore();
  const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  const shared = { platform: "android", token: "c".repeat(32), appVersion: "1.2.0", locale: "en", categories: ["plan"], quietHours: null };
  const first = await registerDevice(store, OWNER, shared, NOW);
  const own = await registerDevice(store, OWNER, { ...shared, token: "d".repeat(32) }, NOW + 1);
  const second = await registerDevice(store, OTHER, shared, NOW + 2);
  assert.notEqual(second.deviceId, first.deviceId, "a registration under another wallet is that wallet's own device");
  /* The live list of the first wallet no longer carries the shared token; the raw row says why. */
  const firstLive = await listDevices(store, OWNER);
  assert.equal(firstLive.some((row) => row.deviceId === first.deviceId), false, "the shared token is revoked under the first wallet");
  assert.equal(firstLive.some((row) => row.deviceId === own.deviceId), true, "the first wallet's other device is untouched");
  const revokedShared = (await devicesOf(store).valuesWithPrefix(devicePrefix(OWNER))).find((row) => row.deviceId === first.deviceId);
  assert.ok(revokedShared?.revokedAt, "the row is revoked, not deleted");
  assert.equal(revokedShared.token, "revoked", "the token itself is forgotten there");
  assert.equal((await listDevices(store, OTHER)).some((row) => row.deviceId === second.deviceId), true, "the token stands under its new owner");
  /* Registered again under the first wallet: it moves back, and the second wallet loses it. */
  await registerDevice(store, OWNER, shared, NOW + 3);
  assert.equal((await listDevices(store, OTHER)).some((row) => row.deviceId === second.deviceId), false, "the token has one owner at a time");
});

test("quiet hours skip external channels while the inbox still exists", () => {
  assert.equal(inQuietHours(Date.parse("2026-09-18T20:30:00.000Z"), { start: "22:00", end: "07:00", timezone: "Europe/Kyiv" }), true);
});

test("engine plus observations keep a monitor watching until a real crossing", () => {
  const result = evaluateTradingPlan({
    plan: {
      planId: "plan_test",
      symbol: "NVDAx",
      status: "active",
      paused: false,
      maxPricePerShare: 224,
      invalidationPerShare: 197.75,
      validUntil: null,
      maxReferenceDeviationPct: null,
      evidence: [],
    },
    market: { lastPriceUsd: 219, referencePerShare: 219, deviationPct: 0, observedAt: null },
    evidence: [],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(result.status, "watching");
  const later = evaluateTradingPlan({
    plan: {
      planId: "plan_test",
      symbol: "NVDAx",
      status: "active",
      paused: false,
      maxPricePerShare: 224,
      invalidationPerShare: 197.75,
      validUntil: null,
      maxReferenceDeviationPct: null,
      evidence: [],
    },
    market: { lastPriceUsd: 230, referencePerShare: 219, deviationPct: 0, observedAt: null },
    evidence: [],
    nowMs: NOW + 1,
    previous: nextObservations(new Date(NOW).toISOString(), result.findings),
  });
  assert.equal(later.crossings.length, 1);
});

test("a monitor row is wallet-prefixed", async () => {
  const store = createMemoryGuardStore();
  const id = newMonitorId();
  const at = new Date(NOW).toISOString();
  const written = await monitorsOf(store).compareAndSet(monitorKey(OWNER, id), null, {
    version: 0,
    id,
    owner: OWNER,
    subjectKind: "trading-plan",
    subjectId: "plan_test",
    label: "NVDAx",
    href: "/app/strategies/plans/plan_test",
    paper: false,
    status: "watching",
    paused: false,
    observations: [],
    lastCheckedAt: null,
    lastTriggeredAt: null,
    createdAt: at,
    updatedAt: at,
  });
  assert.equal(written, true);
  const prefs = await readPreferences(store, OWNER);
  assert.equal(prefs.telegram, true);
  assert.equal(prefs.inbox, true);
});

test("applyMonitorResult writes one inbox and one outbox row per channel; a retry of the same crossing writes none", async () => {
  const store = createMemoryGuardStore();
  const monitor = await seedMonitor(store);
  const first = evaluateTradingPlan({
    plan: {
      planId: "plan_test",
      symbol: "NVDAx",
      status: "active",
      paused: false,
      maxPricePerShare: 224,
      invalidationPerShare: 197.75,
      validUntil: null,
      maxReferenceDeviationPct: null,
      evidence: [],
    },
    market: { lastPriceUsd: 230, referencePerShare: 219, deviationPct: 0, observedAt: null },
    evidence: [],
    nowMs: NOW,
    previous: [],
  });
  assert.equal(first.crossings.length, 1);
  await applyMonitorResult(store, monitor, first.status, first.findings, first.crossings, NOW, "en", monitor.href);
  const inbox = await listInbox(store, OWNER);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].unread, true);
  assert.match(inbox[0].title, /above your price bound/);
  assert.equal(inbox[0].title.includes("BUY") || inbox[0].title.includes("SELL"), false);
  const telegram = await outboxOf(store).get(outboxKey(OWNER, first.crossings[0].identity, "telegram"));
  const push = await outboxOf(store).get(outboxKey(OWNER, first.crossings[0].identity, "push"));
  assert.equal(telegram?.state, "pending");
  assert.equal(push?.state, "pending");

  const again = evaluateTradingPlan({
    plan: {
      planId: "plan_test",
      symbol: "NVDAx",
      status: "active",
      paused: false,
      maxPricePerShare: 224,
      invalidationPerShare: 197.75,
      validUntil: null,
      maxReferenceDeviationPct: null,
      evidence: [],
    },
    market: { lastPriceUsd: 231, referencePerShare: 219, deviationPct: 0, observedAt: null },
    evidence: [],
    nowMs: NOW + 1,
    previous: nextObservations(new Date(NOW).toISOString(), first.findings),
  });
  const current = (await listMonitors(store, OWNER))[0];
  await applyMonitorResult(store, current, again.status, again.findings, again.crossings, NOW + 1, "en", monitor.href);
  assert.equal((await listInbox(store, OWNER)).length, 1);
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 2);
});

test("a revoked device is skipped as no destination; push without a provider is skipped honestly", async () => {
  const store = createMemoryGuardStore();
  const registered = await registerDevice(store, OWNER, {
    platform: "android",
    token: "b".repeat(32),
    appVersion: "1.0.0",
    locale: "en",
    categories: ["plan"],
    quietHours: null,
  }, NOW);
  await revokeDevice(store, OWNER, registered.deviceId, NOW + 1);
  const live = await listDevices(store, OWNER);
  assert.equal(live.length, 0);
  assert.equal(pushDeliveryState(0, false), "skipped_no_destination");
  assert.equal(pushDeliveryState(1, false), "skipped_no_provider");
});

test("the surface a wallet reads — cards, notes, the unread count and where notes go — is the contract's shape on the wire, in both languages (1.11.0)", async () => {
  const { composeMonitoringSurface } = await import("./surface.ts");
  const { MonitoringSurfaceResponseSchema } = await import("../api/v1/contract.ts");
  const store = createMemoryGuardStore();
  const monitor = await seedMonitor(store);
  const crossed = evaluateTradingPlan({
    plan: { planId: "plan_test", symbol: "NVDAx", status: "active", paused: false, maxPricePerShare: 224, invalidationPerShare: 197.75, validUntil: null, maxReferenceDeviationPct: null, evidence: [] },
    market: { lastPriceUsd: 230, referencePerShare: 219, deviationPct: 0, observedAt: null },
    evidence: [],
    nowMs: NOW,
    previous: [],
  });
  await applyMonitorResult(store, monitor, crossed.status, crossed.findings, crossed.crossings, NOW, "en", monitor.href);
  await seedMonitor(store);
  for (const locale of ["en", "uk"]) {
    /* As readMonitoringSurface composes it after its sync (the service module needs the account store to load). */
    const surface = composeMonitoringSurface(await listMonitors(store, OWNER), await listInbox(store, OWNER), locale);
    const preferences = await readPreferences(store, OWNER);
    /* As the route composes it. */
    const answer = JSON.parse(JSON.stringify({ ...surface, preferences: { telegram: preferences.telegram, push: preferences.push, quietHours: preferences.quietHours } }));
    const parsed = MonitoringSurfaceResponseSchema.safeParse(answer);
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; "));
    assert.equal(answer.attention.length, 1);
    assert.equal(answer.watching.length, 1);
    assert.equal(answer.unread, 1);
    assert.equal(answer.attention[0].subject.id, "plan_test");
  }
});
