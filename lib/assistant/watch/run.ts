/**
 * One pass of «Стежити за токеном» (AI-05) — what the cron runs every minute,
 * with the reads and the clock passed in, so a test runs the whole pass on a
 * memory store with a fake market.
 *
 * The pass:
 * - takes every watch that is on and the tokens they name — each token once;
 * - reads the market for all of them at once (`reads.ts`: Jupiter in batches
 *   of 50, DexScreener in batches of 30), so a thousand rules on SOL are one
 *   read of SOL;
 * - adds the read to the token's short history, shared by everyone;
 * - judges each watch without a model (`evaluate.ts`);
 * - for a watch that rings, writes one note into the inbox of Нагляд
 *   (`lib/monitoring`) under an id made from the crossing, so a pass retried
 *   after a crash or a restart finds the note and writes nothing new, and
 *   queues its deliveries on Telegram and push as the person's preferences
 *   and the watch's own channels say — at most 20 an hour per person, past
 *   that the inbox alone; in the person's quiet hours the inbox alone too
 *   (a night of alerts is not sent at once in the morning). The pass sends
 *   its own new deliveries at once — the minute matters for a 5 min move —
 *   under a hold the monitoring cron respects, and the monitoring cron
 *   retries any that failed. The delivery decision is recorded per
 *   crossing, so a pass cut short after the note finishes on its retry.
 *
 * Nothing here signs, sends money, trades or calls a model: the only writes
 * are the watches' state, the tokens' history, the notes and their queued
 * deliveries.
 */

import { createHash } from "node:crypto";

import type { GuardStore } from "../../guard/store.ts";
import { inboxKeyOf } from "../../monitoring/apply.ts";
import { inQuietHours } from "../../monitoring/quiet-hours.ts";
import { inboxOf, outboxKey, outboxOf, readPreferences, type InboxRecord, type OutboxRecord } from "../../monitoring/store.ts";
import { judgeWatch, type WatchFigure, type WatchJudgement } from "./evaluate.ts";
import { addSample, type MintRead, type Sample } from "./market.ts";
import type { WatchReads } from "./reads.ts";
import { DELIVERIES_PER_HOUR } from "./rules.ts";
import { claimDelivery, dropMarket, listMarketMints, listWatches, pruneDeliveries, pruneRates, readMarket, readWatch, writeMarket, writeRun, writeWatch, type MarketRecord, type WatchRecord, type WatchRun } from "./store.ts";
import { noteWords, WATCH_CTA } from "./words.ts";

/** The pass starts no new watch after this, inside the function's minute; the rest are judged a minute on. */
export const PASS_BUDGET_MS = 40_000;
/** The pass's own deliveries are held this long from the monitoring cron, which takes over any the pass did not finish. */
export const DELIVERY_HOLD_MS = 90_000;
/** The pass's own sending stops waiting here; the monitoring cron sends what is left after the hold. */
export const DELIVER_BUDGET_MS = 50_000;
/** Store reads and writes at once — a few hundred tokens stay well inside the minute. */
const POOL = 8;

export type WatchPassDeps = Readonly<{
  store: GuardStore;
  read: (mints: readonly string[]) => Promise<WatchReads>;
  clock: () => number;
  /** Send this pass's new deliveries now (the outbox rows it wrote, by id; the clock past the hold); absent — the monitoring cron sends them. */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
  /** Store reads and writes at once; the stand's single-connection store takes one. */
  concurrency?: number;
}>;

/** A watch's notes stand under no monitor of their own; the contract's note carries one, so it is the watch's, derived and stable. */
export function watchMonitorId(watchId: string): string {
  return `mon_${createHash("sha256").update(`token-watch:${watchId}`).digest("hex").slice(0, 24)}`;
}

/** The note of one crossing: one id, whatever pass writes it. */
export function watchInboxId(identity: string): string {
  return `inb_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

type Tally = { fired: number; delivered: number; capped: number; quiet: number; queued: Set<string> };

async function pool<T, R>(items: readonly T[], work: (item: T) => Promise<R>, size = POOL): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (next < items.length) {
        const at = next++;
        out[at] = await work(items[at]);
      }
    }),
  );
  return out;
}

/** One delivery held from the monitoring cron for `DELIVERY_HOLD_MS` — the pass sends it first; written once per crossing and channel. Its id when this pass wrote it. */
async function queue(store: GuardStore, owner: string, identity: string, inboxId: string, channel: "telegram" | "push", nowMs: number): Promise<string | null> {
  const at = new Date(nowMs).toISOString();
  const id = outboxKey(owner, identity, channel);
  const row: OutboxRecord = { id, owner, triggerId: identity, inboxId, channel, state: "pending", attempts: 0, nextAttemptAt: new Date(nowMs + DELIVERY_HOLD_MS).toISOString(), lastError: null, createdAt: at, updatedAt: at };
  return (await outboxOf(store).insertIfAbsent(id, row)) ? id : null;
}

/**
 * The note of a crossing and its deliveries. The note is written once; the
 * delivery decision (send, over the hour's 20, quiet hours, no channel) is
 * recorded once per crossing and acted on every time — so a pass cut short
 * between the note and its deliveries finishes them on its retry.
 */
async function ring(store: GuardStore, watch: WatchRecord, identity: string, figure: WatchFigure, nowMs: number, tally: Tally): Promise<string> {
  const at = new Date(nowMs).toISOString();
  const inboxId = watchInboxId(identity);
  const en = noteWords(watch.rule, watch.symbol, figure, "en");
  const uk = noteWords(watch.rule, watch.symbol, figure, "uk");
  const own = watch.locale === "uk" ? uk : en;
  const note: InboxRecord = {
    id: inboxId,
    owner: watch.owner,
    monitorId: watchMonitorId(watch.id),
    triggerId: identity,
    title: own.title,
    reason: own.reason,
    context: watch.symbol,
    href: `/app/alerts/open?n=${inboxId}`,
    cta: WATCH_CTA[watch.locale],
    paper: false,
    unread: true,
    createdAt: at,
    locale: watch.locale,
    subject: { kind: "token-watch", id: watch.id },
    text: { en, uk },
  };
  if (await inboxOf(store).insertIfAbsent(inboxKeyOf(watch.owner, inboxId), note)) tally.fired += 1;
  const prefs = await readPreferences(store, watch.owner);
  const telegram = prefs.telegram && watch.channels.telegram;
  const push = prefs.push && watch.channels.push;
  const decision = await claimDelivery(store, watch.owner, identity, nowMs, {
    channels: telegram || push,
    /* In the quiet hours the inbox alone: a price at 02:14 is not news to be sent at 08:00. */
    quiet: inQuietHours(nowMs, prefs.quietHours),
    limit: DELIVERIES_PER_HOUR,
  });
  if (decision === "capped") tally.capped += 1;
  if (decision === "quiet") tally.quiet += 1;
  if (decision !== "send") return inboxId;
  const wrote = [telegram ? await queue(store, watch.owner, identity, inboxId, "telegram", nowMs) : null, push ? await queue(store, watch.owner, identity, inboxId, "push", nowMs) : null].filter((id): id is string => id !== null);
  /* Only the rows this pass wrote are sent by it, each by its own id: a second pass at once, or a retry, leaves a row to its writer and then to the monitoring cron — never a message twice. */
  if (wrote.length > 0) tally.delivered += 1;
  for (const id of wrote) tally.queued.add(id);
  return inboxId;
}

/** The token's history with this read, in memory; written after the judging. */
function historyOf(found: MarketRecord | null, read: MintRead, nowMs: number, namedPools: readonly string[]): Readonly<{ samples: Sample[]; record: MarketRecord }> {
  const answered = read.jupiter || read.dex;
  const samples = answered ? addSample(found?.samples ?? [], read, nowMs, namedPools) : [...(found?.samples ?? [])];
  /* A read nobody answered keeps the last good one: the card says how old it is, the judgement calls it «not read». */
  const kept = answered ? read : (found?.read ?? read);
  return { samples, record: { schema: "ryntra.assistant.watch-market", version: (found?.version ?? 0) + 1, mint: read.mint, read: kept, samples, updatedAt: new Date(nowMs).toISOString() } };
}

/** The state a fire leaves, written over the watch as it is now — a pause meanwhile keeps the fire's record of it. */
async function settleFire(store: GuardStore, watch: WatchRecord, judged: WatchJudgement, inboxId: string, nowMs: number): Promise<void> {
  const at = new Date(nowMs).toISOString();
  const figure = judged.figure as WatchFigure;
  let current: WatchRecord | null = watch;
  for (let attempt = 0; attempt < 3 && current; attempt += 1) {
    /* A rule changed meanwhile is a new watch: this fire is not its. */
    if (current.state.armedSince !== watch.state.armedSince || JSON.stringify(current.rule) !== JSON.stringify(watch.rule)) return;
    const next: WatchRecord = { ...current, version: current.version + 1, state: { ...current.state, armed: false, lastFiredAt: at }, last: { at, figure, inboxId }, fired: current.fired + 1, updatedAt: at };
    if (await writeWatch(store, next, current.version)) return;
    current = await readWatch(store, watch.owner, watch.id);
  }
}

export async function runWatchPass(deps: WatchPassDeps): Promise<WatchRun> {
  const started = deps.clock();
  const watches = (await listWatches(deps.store)).filter((watch) => watch.status === "active");
  const mints = [...new Set(watches.map((watch) => watch.mint))];
  const tally: Tally = { fired: 0, delivered: 0, capped: 0, quiet: 0, queued: new Set() };
  let requests = { jupiter: 0, dex: 0 };

  if (mints.length > 0) {
    const got = await deps.read(mints);
    requests = { ...got.requests };
    const nowMs = deps.clock();
    /* Every token's history read at once, extended in memory, judged on, then written at once. */
    const size = deps.concurrency ?? POOL;
    const found = await pool(mints, (mint) => readMarket(deps.store, mint).catch(() => null), size);
    const history = new Map<string, Readonly<{ samples: Sample[]; record: MarketRecord; expected: number | null; read: MintRead; named: readonly string[] }>>();
    mints.forEach((mint, index) => {
      const read = got.reads.get(mint);
      if (!read) return;
      const named = [...new Set(watches.flatMap((watch) => (watch.mint === mint && watch.rule.kind === "liquidity" && watch.rule.pool ? [watch.rule.pool] : [])))];
      history.set(mint, { ...historyOf(found[index], read, nowMs, named), expected: found[index]?.version ?? null, read, named });
    });
    for (const listed of watches) {
      if (deps.clock() - started > PASS_BUDGET_MS) break;
      const judge = (watch: WatchRecord) => judgeWatch({ watchId: watch.id, rule: watch.rule, state: watch.state, cooldownMinutes: watch.cooldownMinutes, read: got.reads.get(watch.mint), samples: history.get(watch.mint)?.samples ?? [], nowMs });
      const first = judge(listed);
      if (first.outcome !== "fire" && first.next === listed.state) continue;
      /* Something to write: read afresh — a watch paused, changed or removed since the list was read is judged as it is now, or not at all. */
      const watch = await readWatch(deps.store, listed.owner, listed.id);
      if (!watch || watch.status !== "active") continue;
      const judged = watch.version === listed.version ? first : judge(watch);
      if (judged.outcome === "fire" && judged.identity && judged.figure) {
        const inboxId = await ring(deps.store, watch, judged.identity, judged.figure, nowMs, tally);
        await settleFire(deps.store, watch, judged, inboxId, nowMs);
        continue;
      }
      const s = watch.state;
      const n = judged.next;
      if (s.armed !== n.armed || s.armedSince !== n.armedSince || s.lastFiredAt !== n.lastFiredAt) {
        await writeWatch(deps.store, { ...watch, version: watch.version + 1, state: n, updatedAt: new Date(nowMs).toISOString() }, watch.version);
      }
    }
    /* The history first — a long burst of sending must not cost the minute's read. A write that lost (another pass, a read that
       failed) is read and written once more, so a token's history never stops on one bad read. */
    await pool(
      [...history.values()],
      async (entry) => {
        if (await writeMarket(deps.store, entry.record, entry.expected).catch(() => false)) return;
        const now = await readMarket(deps.store, entry.read.mint).catch(() => null);
        await writeMarket(deps.store, historyOf(now, entry.read, nowMs, entry.named).record, now?.version ?? null).catch(() => false);
      },
      size,
    );
    /* The new deliveries leave now, inside the minute; one that fails or is not reached stays pending and the monitoring cron sends it after the hold. */
    if (deps.deliver && tally.queued.size > 0) {
      const left = Math.max(0, DELIVER_BUDGET_MS - (deps.clock() - started));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([deps.deliver(tally.queued, nowMs + DELIVERY_HOLD_MS).catch(() => undefined), new Promise((settle) => (timer = setTimeout(settle, left)))]);
      if (timer) clearTimeout(timer);
    }
  }

  /* A token nobody watches any more has no history kept; the hour's counters go after two hours. */
  if (deps.clock() - started <= PASS_BUDGET_MS) {
    const watched = new Set((await listWatches(deps.store)).map((watch) => watch.mint));
    for (const mint of await listMarketMints(deps.store)) if (!watched.has(mint)) await dropMarket(deps.store, mint);
    if (new Date(started).getUTCMinutes() === 0) {
      await pruneRates(deps.store, started);
      await pruneDeliveries(deps.store, started);
    }
  }

  const run: WatchRun = { at: new Date(started).toISOString(), watches: watches.length, tokens: mints.length, requests, fired: tally.fired, delivered: tally.delivered, capped: tally.capped, quiet: tally.quiet, durationMs: Math.max(0, deps.clock() - started) };
  await writeRun(deps.store, run);
  return run;
}
