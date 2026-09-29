/**
 * Monitoring service — sync monitors from plans, evaluate, write inbox and outbox.
 * A notification is never permission to trade.
 */

import { accountByWallet } from "../account/rpc.ts";
import { reminderStates } from "../autoinvest/service.ts";
import { tickAutoinvest } from "../autoinvest/tick.ts";
import { sendPlainMessage } from "../telegram/api.ts";
import { judgeEvidenceCondition } from "../evidence/conditions.ts";
import { readMarketEvidence } from "../evidence/service.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { applyMonitorResult } from "./apply.ts";
import { deliverOutbox as deliverOutboxWith, type TelegramDelivery } from "./deliver.ts";
import { markInboxRead, resolveInboxLink } from "./inbox.ts";
import { readHeldOnChain } from "./issuer-balance.server.ts";
import { checkIssuerEvents, checkIssuerPages, READ_EVERY_MS, tickIssuerEvents } from "./issuer-events.ts";
import { isTokenPlanAsset } from "../api/v1/contract.ts";
import { listTradingPlans, projectTradingPlan, currentVersionOf, readTradingPlan } from "../plans/store.ts";
import { listSolanaWalletActions, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { competingOf, planIsWatched } from "./position.ts";
import { closePositionWatch, listPositionWatches, readPositionWatch } from "./position-watch.ts";
import { freshPrice } from "./watch-state.ts";
import { words as monitoringWords } from "./copy.ts";
import { companyHref } from "../autoinvest/links.ts";
import { readSpotMarket } from "../spot/markets.server.ts";
import { getPredictionProvider } from "../predictions/agg/adapter.ts";
import { listPredictionPlans, readPredictionPlan } from "../predictions/plan.ts";
import { isRetiredMint } from "../stocks/retired.ts";
import { findStockRow } from "../stocks/universe.server.ts";
import {
  evaluatePredictionPlan,
  evaluateTradingPlan,
  type EvidenceJudgement,
} from "./engine.ts";
import { composeMonitoringSurface, type MonitoringSurface } from "./surface.ts";
import {
  listDevices,
  listInbox,
  listMonitors,
  monitorKey,
  monitorsOf,
  newMonitorId,
  type MonitorRecord,
} from "./store.ts";

/* The surface's shape and its composition are pure (`./surface.ts`); this module reads, syncs and hands them over. */
export type { MonitoringSurface, SurfaceCard } from "./surface.ts";


function localeOf(value: string | null | undefined): "en" | "uk" {
  return value === "uk" ? "uk" : "en";
}

/** The wallet's own History, for telling an open position from a sold one; a History that cannot be read watches on — a missed warning costs more than a spare one. */
async function walletRows(store: GuardStore, owner: string): Promise<readonly SolanaWalletAction[]> {
  try {
    return (await listSolanaWalletActions(store, { network: "mainnet", wallet: owner })).actions;
  } catch {
    return [];
  }
}

export async function syncMonitorsForWallet(store: GuardStore, owner: string, nowMs: number): Promise<void> {
  const at = new Date(nowMs).toISOString();
  const { records } = await listTradingPlans(store, owner);
  const existing = await listMonitors(store, owner);
  const bySubject = new Map(existing.map((row) => [`${row.subjectKind}:${row.subjectId}`, row]));
  const rows = records.some((record) => record.status === "executed") ? await walletRows(store, owner) : [];

  for (const record of records) {
    const plan = projectTradingPlan(record, nowMs);
    const idKey = `trading-plan:${plan.id}`;
    const found = bySubject.get(idKey);
    const href = `/app/strategies/plans/${plan.id}`;
    const label = plan.asset.symbol;
    const paused = !planIsWatched(record, plan.status, rows, competingOf(records, record), nowMs);
    if (!found) {
      const id = newMonitorId();
      await monitorsOf(store).compareAndSet(monitorKey(owner, id), null, {
        version: 0,
        id,
        owner,
        subjectKind: "trading-plan",
        subjectId: plan.id,
        label,
        href,
        paper: false,
        status: paused ? "paused" : "watching",
        paused,
        observations: [],
        lastCheckedAt: null,
        lastTriggeredAt: null,
        createdAt: at,
        updatedAt: at,
      });
    } else if (found.paused !== paused || found.label !== label || found.href !== href) {
      await monitorsOf(store).compareAndSet(monitorKey(owner, found.id), found.version, {
        ...found,
        version: found.version + 1,
        label,
        href,
        paused,
        status: paused ? "paused" : found.status === "paused" ? "watching" : found.status,
        updatedAt: at,
      });
    }
  }

  /* «Ryntra попередить» on a position (1.21.0): one monitor per token the person turned it on for — its card opens the company; paused once the position closed. */
  for (const watch of await listPositionWatches(store, owner)) {
    const found = bySubject.get(`position:${watch.mint}`);
    const href = companyHref(watch.symbol);
    const label = watch.symbol;
    const paused = watch.closedAt !== null;
    if (!found) {
      const id = newMonitorId();
      await monitorsOf(store).compareAndSet(monitorKey(owner, id), null, {
        version: 0,
        id,
        owner,
        subjectKind: "position",
        subjectId: watch.mint,
        label,
        href,
        paper: false,
        status: paused ? "paused" : "watching",
        paused,
        observations: [],
        lastCheckedAt: null,
        lastTriggeredAt: null,
        createdAt: at,
        updatedAt: at,
      });
    } else if (found.paused !== paused || found.label !== label || found.href !== href) {
      await monitorsOf(store).compareAndSet(monitorKey(owner, found.id), found.version, {
        ...found,
        version: found.version + 1,
        label,
        href,
        paused,
        status: paused ? "paused" : found.status === "paused" ? "watching" : found.status,
        updatedAt: at,
      });
    }
  }

  const predictionPlans = await listPredictionPlans(store, owner, nowMs);
  for (const plan of predictionPlans) {
    const idKey = `prediction-plan:${plan.id}`;
    const found = bySubject.get(idKey);
    const href = `/app/predictions/${plan.current.rules.eventId}`;
    const label = plan.current.rules.eventTitle;
    const paused = plan.status !== "active";
    if (!found) {
      const id = newMonitorId();
      await monitorsOf(store).compareAndSet(monitorKey(owner, id), null, {
        version: 0,
        id,
        owner,
        subjectKind: "prediction-plan",
        subjectId: plan.id,
        label,
        href,
        paper: true,
        status: paused ? "paused" : "watching",
        paused,
        observations: [],
        lastCheckedAt: null,
        lastTriggeredAt: null,
        createdAt: at,
        updatedAt: at,
      });
    } else if (found.paused !== paused || found.label !== label || found.href !== href) {
      await monitorsOf(store).compareAndSet(monitorKey(owner, found.id), found.version, {
        ...found,
        version: found.version + 1,
        label,
        href,
        paper: true,
        paused,
        status: paused ? "paused" : found.status === "paused" ? "watching" : found.status,
        updatedAt: at,
      });
    }
  }
}

/**
 * «Ryntra попередить» on a position (canon v5 §6.1, §11; 1.21.0): the price
 * against the loss limit and the target the person's preset set, every pass —
 * the engine's position words, the note in the language it was turned on in,
 * its one action the sale. Before a note leaves, the chain is asked whether the
 * wallet still holds the token: a position sold in full is closed and told
 * nothing; a read that fails warns — a missed warning costs more than a spare.
 */
async function evaluatePosition(store: GuardStore, monitor: MonitorRecord, nowMs: number): Promise<void> {
  const watch = await readPositionWatch(store, monitor.owner, monitor.subjectId);
  const href = companyHref(watch?.symbol ?? monitor.label);
  if (!watch || watch.closedAt !== null || monitor.paused || isRetiredMint(watch.mint)) {
    await applyMonitorResult(store, monitor, "paused", [], [], nowMs, watch?.locale ?? "en", href);
    return;
  }
  const found = await findStockRow(watch.mint).catch(() => null);
  const row = found && "ok" in found && found.ok ? found.row : null;
  const result = evaluateTradingPlan({
    plan: {
      /* The identity of a crossing: this wallet, this token, this watch — a watch turned on afresh is a new line. */
      planId: `watch:${watch.owner}:${watch.mint}:${watch.createdAt}`,
      symbol: watch.symbol,
      status: "executed",
      paused: false,
      maxPricePerShare: null,
      invalidationPerShare: watch.limitPerUnit,
      targetPerShare: watch.targetPerUnit,
      validUntil: null,
      maxReferenceDeviationPct: null,
      evidence: [],
    },
    /* A price nobody saw in the last half hour decides nothing — the same rule the states on the page follow (`watch-state.ts`). */
    market: { lastPriceUsd: freshPrice(row?.market.priceUsd ?? null, row?.market.observedAt ?? null, nowMs), referencePerShare: null, deviationPct: null, observedAt: row?.market.observedAt ?? null },
    evidence: [],
    nowMs,
    previous: monitor.observations,
  });
  if (result.crossings.length > 0) {
    const held = (await readHeldOnChain(watch.owner, [watch.mint]).catch(() => null))?.get(watch.mint);
    if (held === 0n) {
      await closePositionWatch(store, watch.owner, watch.mint, nowMs);
      await applyMonitorResult(store, monitor, "paused", [], [], nowMs, watch.locale, href);
      return;
    }
  }
  await applyMonitorResult(store, monitor, result.status, result.findings, result.crossings, nowMs, watch.locale, href, { cta: monitoringWords(watch.locale).openSale });
}

async function evaluateOne(store: GuardStore, monitor: MonitorRecord, nowMs: number, locale: "en" | "uk"): Promise<void> {
  if (monitor.subjectKind === "position") {
    await evaluatePosition(store, monitor, nowMs);
    return;
  }
  if (monitor.subjectKind === "trading-plan") {
    const record = await readTradingPlan(store, monitor.owner, monitor.subjectId);
    if (!record) return;
    const plan = projectTradingPlan(record, nowMs);
    const href = `/app/strategies/plans/${plan.id}`;
    /* A plan on a token Ryntra no longer supports (canon v5.2 В26) is history: nothing is watched on it and no note is written about it. */
    if (isRetiredMint(plan.asset.mint)) {
      await applyMonitorResult(store, monitor, "paused", [], [], nowMs, locale, href);
      return;
    }
    const watched =
      plan.status === "active" ||
      (plan.status === "executed" &&
        planIsWatched(record, plan.status, await walletRows(store, monitor.owner), competingOf((await listTradingPlans(store, monitor.owner)).records, record), nowMs));
    if (monitor.paused || !watched) {
      await applyMonitorResult(store, monitor, "paused", [], [], nowMs, locale, href);
      return;
    }
    const current = currentVersionOf(record);
    /* A stock plan reads the desk's row (the reference and the deviation with it); a token plan (1.7.0) reads the catalogue by mint — the token's own price, no reference. */
    const market = isTokenPlanAsset(plan.asset)
      ? await readSpotMarket(plan.asset.mint)
          .then((read) => (read.ok && read.market ? { lastPriceUsd: read.market.price, referencePerShare: null, deviationPct: null, observedAt: read.market.updatedAt ?? read.observedAt } : { lastPriceUsd: null, referencePerShare: null, deviationPct: null, observedAt: null }))
          .catch(() => ({ lastPriceUsd: null, referencePerShare: null, deviationPct: null, observedAt: null }))
      : await (async () => {
          const found = await findStockRow(plan.asset.symbol).catch(() => null);
          const row = found && "ok" in found && found.ok ? found.row : null;
          return {
            lastPriceUsd: row?.market.priceUsd ?? null,
            referencePerShare: row?.reference.perShare ?? null,
            deviationPct: row?.deviationPct ?? null,
            observedAt: row?.market.observedAt ?? null,
          };
        })();
    const evidence: EvidenceJudgement[] = [];
    for (const [index, condition] of current.rules.evidenceConditions.entries()) {
      const conditionId = `ev-${index}-${condition.metric}-${condition.window}`;
      const read = await readMarketEvidence({ mint: plan.asset.mint, window: condition.window, nowMs });
      const judged = read.snapshot ? judgeEvidenceCondition(condition, read, nowMs) : null;
      evidence.push({
        conditionId,
        metric: condition.metric,
        outcome: judged?.outcome === "pass" ? "pass" : judged?.outcome === "fail" ? "fail" : "unknown",
        reason: judged?.reason ?? read.reason ?? "",
        state: read.state === "FRESH" || read.state === "STALE" || read.state === "UNAVAILABLE" ? read.state : "UNKNOWN",
        served: read.served,
      });
    }
    const result = evaluateTradingPlan({
      plan: {
        planId: plan.id,
        symbol: plan.asset.symbol,
        status: plan.status,
        paused: monitor.paused,
        maxPricePerShare: current.rules.entry.maxPricePerShare,
        invalidationPerShare: current.rules.risk.invalidationPerShare,
        /* 1.21.0: once bought, the plan's target is watched too — «Дія» at the limit or the target (canon §11). */
        targetPerShare: current.rules.exit.targetPerShare ?? null,
        validUntil: current.rules.entry.validUntil,
        maxReferenceDeviationPct: current.rules.execution.maxReferenceDeviationPct,
        evidence: current.rules.evidenceConditions.map((condition, index) => ({
          conditionId: `ev-${index}-${condition.metric}-${condition.window}`,
          metric: condition.metric,
          required: condition.mode === "required",
        })),
      },
      market,
      evidence,
      nowMs,
      previous: monitor.observations,
    });
    await applyMonitorResult(store, monitor, result.status, result.findings, result.crossings, nowMs, locale, href);
    return;
  }

  const loaded = await readPredictionPlan(store, monitor.owner, monitor.subjectId, nowMs);
  if (!loaded.ok) return;
  const plan = loaded.value;
  const rules = plan.current.rules;
  const href = `/app/predictions/${rules.eventId}`;
  if (monitor.paused || plan.status !== "active") {
    await applyMonitorResult(store, monitor, "paused", [], [], nowMs, locale, href);
    return;
  }

  let probability: number | null = null;
  let signalFingerprint: string | null = null;
  try {
    const prices = await getPredictionProvider().prices([rules.venueMarketId]);
    if (prices.ok) {
      const market = prices.value.find((row) => row.venueMarketId === rules.venueMarketId);
      const outcome = market?.outcomes.find((row) => row.outcomeId === rules.outcomeId);
      probability = outcome?.midpoint ?? market?.midpoint ?? null;
    }
  } catch {
    probability = null;
  }
  if (rules.monitoring.some((rule) => rule.metric === "signal")) {
    try {
      const signals = await getPredictionProvider().signals(rules.venueMarketId);
      if (signals.ok && signals.value) {
        signalFingerprint = signals.value.signals.map((row) => row.id).sort().join(",") || null;
      }
    } catch {
      signalFingerprint = null;
    }
  }

  const result = evaluatePredictionPlan({
    plan: {
      planId: plan.id,
      title: rules.eventTitle,
      status: plan.status,
      paused: monitor.paused,
      paper: true,
      maxProbability: rules.maxProbability,
      invalidationProbability: rules.invalidation.probabilityBelow,
      resolutionDeadline: rules.resolutionDeadline,
      monitoring: rules.monitoring.map((rule, index) => ({
        conditionId: `pm-${index}-${rule.metric}`,
        metric: rule.metric,
        direction: rule.direction,
        threshold: rule.threshold,
      })),
    },
    market: { probability, endsAt: rules.resolutionDeadline, signalFingerprint, paper: true },
    nowMs,
    previous: monitor.observations,
  });
  await applyMonitorResult(store, monitor, result.status, result.findings, result.crossings, nowMs, locale, href);
}

export async function tickMonitoring(store: GuardStore, nowMs: number, locale: "en" | "uk" = "en"): Promise<void> {
  const owners = new Set<string>();
  for (const row of await listMonitors(store)) owners.add(row.owner);
  for (const row of await store.versioned<{ version: number; owner: string }>("tradingPlans").valuesWithPrefix("solana:mainnet:")) {
    if (row.owner) owners.add(row.owner);
  }
  for (const row of await store.versioned<{ version: number; owner: string }>("predictionPlans").valuesWithPrefix("solana:mainnet:")) {
    if (row.owner) owners.add(row.owner);
  }
  /* 1.21.0: every wallet that turned «Ryntra попередить» on for a position. */
  for (const row of await listPositionWatches(store).catch(() => [])) {
    if (row.owner && row.closedAt === null) owners.add(row.owner);
  }
  for (const owner of owners) {
    try {
      await syncMonitorsForWallet(store, owner, nowMs);
    } catch {
      /* a failed sync must not stop the others */
    }
  }
  const monitors = await listMonitors(store);
  for (const monitor of monitors) {
    try {
      await evaluateOne(store, monitor, nowMs, locale);
    } catch {
      /* a failed evaluation must not stop the others */
    }
  }
  /* «Автоінвест» (canon v5.1 §4.1): the rules that fell due remind now, so their deliveries leave in this same pass. */
  await tickAutoinvest(store, nowMs).catch(() => undefined);
  /* The IPO and conversion watch (canon v5.2 В27, §11): a wallet holding a token whose swap window is open is reminded now, so its deliveries leave in this same pass. */
  await tickIssuerEvents(store, nowMs, { readHeld: readHeldOnChain }).catch(() => undefined);
  await deliverOutbox(store, nowMs);
  /* Once a day, after the deliveries: the issuer's product pages read against the registry of events. */
  await checkIssuerPages(store, nowMs).catch(() => undefined);
}

/** The production Telegram side: the account service for the wallet → account lookup, the bot for the send. */
const PRODUCTION_TELEGRAM: TelegramDelivery = {
  accountByWallet: (chain, address) => accountByWallet(chain, address),
  send: (chatId, text, keyboard) => sendPlainMessage(chatId, text, keyboard),
};

/** Deliver the outbox with the production Telegram side; tests call `deliver.ts` with a fake. */
export function deliverOutbox(store: GuardStore, nowMs: number): Promise<void> {
  return deliverOutboxWith(store, nowMs, { telegram: PRODUCTION_TELEGRAM });
}

/** How long the notes' read waits for the watch's balance read before answering with the notes as they are. */
const ISSUER_READ_WAIT_MS = 2_500;

export async function readMonitoringSurface(store: GuardStore, owner: string, nowMs: number, locale: "en" | "uk"): Promise<MonitoringSurface> {
  await syncMonitorsForWallet(store, owner, nowMs);
  /* A token the wallet holds whose issuer opened a swap window (canon v5.2 В27): read while the person's own app reads its notes, so the note of a token just bought arrives while they look. A read that fails leaves the notes as they are. */
  await Promise.race([
    checkIssuerEvents(store, owner, nowMs, { readHeld: readHeldOnChain, everyMs: READ_EVERY_MS, locale }).catch(() => undefined),
    /* The bell never waits on a slow chain: past this, the notes answer as they are and the read finishes on its own. */
    new Promise((settle) => setTimeout(settle, ISSUER_READ_WAIT_MS)),
  ]);
  const notes = await listInbox(store, owner);
  /* A rule's reminder says what became of it (1.13.0): read through the rule and History, only when there is one. */
  const ruleStateOf = notes.some((row) => row.subject?.kind === "autoinvest-rule") ? await reminderStates(store, owner, nowMs).catch(() => () => null) : () => null;
  return composeMonitoringSurface(await listMonitors(store, owner), notes, locale, ruleStateOf);
}

export { localeOf };
export { markInboxRead, resolveInboxLink };
export type { TelegramDelivery };
export { listDevices };
export { devicesOf } from "./store.ts";
export { applyMonitorResult } from "./apply.ts";
