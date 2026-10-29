/**
 * The win that arrives on its own.
 *
 * The pilot before this gave the person a *Collect winnings* button. This takes the button
 * off the critical path: once a market is decided, Ryntra asks the venue for
 * the payout itself, follows it to the end and tells the person — the money
 * arrives whether or not anybody opened the page.
 *
 * How it never pays twice:
 *
 * 1. **One record per market, under one request id.** `collectRequestId`
 *    names it from the wallet and the market, so every sweep, every instance
 *    and every restart lands on the same record. It is created with
 *    `compareAndSet(key, null, …)` *before* the provider is asked.
 * 2. **A lease.** A record being asked right now is not asked again until
 *    its lease runs out; the count of asks is written before the request
 *    leaves.
 * 3. **Asked again, never asked anew.** An ask whose answer never came
 *    (a timeout, a 5xx, a dropped connection) leaves the record `unknown` —
 *    never «paid», never «nothing happened». The next sweep asks again only
 *    while the provider itself still marks those outcomes payable: once the
 *    venue has paid, the provider stops marking them, the position reads
 *    `redeemed`, and the record closes as paid from the position rather than
 *    from our own request. So the second ask cannot become a second credit.
 * 4. **Nothing of the browser's.** The outcomes asked for are the ones the
 *    provider marks payable now, read in this same pass.
 *
 * Everything else here is reading: the settlement calendar, the notes
 * (market decided, winnings credited, delayed, disputed) and the payout
 * receipts. Paper is the default and loses nothing: the provider settles a
 * simulated position itself, so paper gets the calendar and the notes and no
 * collect is ever asked for. Live money stays behind
 * `PREDICTIONS_LIVE_FUNDING`, `PREDICTIONS_LIVE_WALLETS`,
 * `PREDICTIONS_LIVE_VENUES` and `PREDICTIONS_LIVE_MAX_USD`, which this code
 * never sets for itself.
 *
 * Server only.
 */

import { createHash } from "node:crypto";

import { withBoundedCasRetry, type GuardStore } from "../guard/store.ts";
import { failure } from "./failure.ts";
import { fundingEnabled } from "./funding.ts";
import { liveWalletAllowed } from "./live.ts";
import type { PaperPosition } from "./model.ts";
import { deliverNotes, listNotes, note, pruneNotes, readPrefs, type Note, type NotifyTransports } from "./notify/channel.ts";
import { predictionNoteWords } from "./notify/words.ts";
import type { NoteLocale } from "./notify/words.ts";
import type { PredictionProvider, RedeemLeg, Result } from "./provider.ts";
import { redeemPositions, redeemable } from "./redeem.ts";
import { collectRequestId, redeemPhase, settleCalendar, settleRow, type SettleCalendar, type SettleRow } from "./settle.ts";
import { LINK_KEY_PREFIX, withProviderSession } from "./session.ts";

/** How long one ask holds its record; longer than the session refresh and the request it may wait on. */
const ASK_LEASE_MS = 60_000;
/**
 * Past this age a payout nobody confirmed is not asked for again on its own:
 * it is shown as *state unknown* for the person to take to support, and the
 * market's own row says so. Asking for ever would be asking blind.
 */
const ASK_WINDOW_MS = 24 * 3_600_000;
/** How many markets one sweep collects, so one pass cannot run away with the request budget. */
const COLLECTS_PER_SWEEP = 5;
/** How many positions one sweep reads a calendar and notes from. */
const ROWS_PER_SWEEP = 120;

const KEY_PREFIX = "settle:solana:mainnet:";
/** The prefix Ryntra's own order records are written under (`paper.ts`). */
const ORDER_KEY_PREFIX = "solana:mainnet:";

/** Where a payout Ryntra asked for stands. */
export type CollectPhase = "asking" | "collecting" | "collected" | "unknown" | "refused";

export type CollectRecord = Readonly<{
  version: number;
  kind: "collect";
  wallet: string;
  /** The one id this market's payout is ever asked under. */
  requestId: string;
  venueEventId: string;
  question: string;
  /** What was asked for, with what the provider marked each outcome at — the receipt the person reads. */
  asked: readonly Readonly<{ outcomeId: string; label: string; valueUsd: number }>[];
  legs: readonly RedeemLeg[];
  phase: CollectPhase;
  /** The provider's redeem id, once it gave one. */
  redeemId: string | null;
  /** The provider's own last word on the position, kept for Details. */
  providerRedeemStatus: string | null;
  /** Ryntra's code for a refusal; null otherwise. */
  note: string | null;
  asks: number;
  askingUntil: string | null;
  /** When the provider itself confirmed the position paid. */
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

/** A payout as the browser sees it. */
export type CollectView = Readonly<{
  requestId: string;
  venueEventId: string;
  question: string;
  phase: CollectPhase;
  amountUsd: number;
  legs: readonly RedeemLeg[];
  providerRedeemStatus: string | null;
  note: string | null;
  /** Unknown past the window in which it is asked again on its own: nothing more is sent for it. */
  aged: boolean;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

function records(store: GuardStore) {
  return store.versioned<CollectRecord>("predictionOrders");
}

/** The market's id reduced to a key the store can hold, whatever the provider spells it with. */
const keyOf = (wallet: string, venueEventId: string) => `${KEY_PREFIX}${wallet}:${createHash("sha256").update(venueEventId).digest("hex").slice(0, 24)}`;

const amountOf = (record: CollectRecord) => record.asked.reduce((sum, a) => sum + a.valueUsd, 0);

/**
 * Nothing confirmed this long after the ask: it is not asked about on its
 * own any more. Shown as it is, for the person to take to AGG or support —
 * never shown as paid, and never asked anew.
 */
function isAged(record: CollectRecord, nowMs: number): boolean {
  if (record.phase === "collected" || record.phase === "refused") return false;
  return nowMs - Date.parse(record.createdAt) >= ASK_WINDOW_MS;
}

export function collectView(record: CollectRecord, nowMs: number = Date.now()): CollectView {
  return {
    requestId: record.requestId,
    venueEventId: record.venueEventId,
    question: record.question,
    phase: record.phase,
    amountUsd: amountOf(record),
    legs: record.legs,
    providerRedeemStatus: record.providerRedeemStatus,
    note: record.note,
    aged: isAged(record, nowMs),
    confirmedAt: record.confirmedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function listRecords(store: GuardStore, wallet: string): Promise<CollectRecord[]> {
  const rows = await records(store).valuesWithPrefix(`${KEY_PREFIX}${wallet}:`).catch(() => []);
  return [...rows].filter((r) => r.kind === "collect" && r.wallet === wallet).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

async function patch(store: GuardStore, wallet: string, venueEventId: string, change: (current: CollectRecord) => Partial<CollectRecord>, nowMs: number): Promise<CollectRecord | null> {
  const collection = records(store);
  const key = keyOf(wallet, venueEventId);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current) return null as never;
      const next: CollectRecord = { ...current, ...change(current), version: current.version + 1, updatedAt: new Date(nowMs).toISOString() };
      return (await collection.compareAndSet(key, current.version, next)) ? next : false;
    });
  } catch {
    return null;
  }
}

/**
 * Take the record for one ask: refused when the venue has already answered
 * this market's payout, when it is paid, refused or past the window, or when
 * another ask holds it right now. The lease and the count are written before
 * the request leaves.
 *
 * A record the venue answered (`collecting`) is never asked again: the
 * request is with the venue, and whether it paid is read off the position.
 * Only a request whose answer never came (`unknown`), or one whose ask was
 * lost before it was recorded (`asking` with no live lease), is asked again —
 * and then under the same request id.
 */
async function claimAsk(store: GuardStore, wallet: string, venueEventId: string, nowMs: number): Promise<Readonly<{ claimed: CollectRecord } | { current: CollectRecord | null }>> {
  const collection = records(store);
  const key = keyOf(wallet, venueEventId);
  try {
    return await withBoundedCasRetry(async () => {
      const current = await collection.get(key);
      if (!current) return { current: null };
      if (current.phase !== "unknown" && current.phase !== "asking") return { current };
      if (isAged(current, nowMs)) return { current };
      if (current.askingUntil && Date.parse(current.askingUntil) > nowMs) return { current };
      const next: CollectRecord = { ...current, phase: "asking", asks: current.asks + 1, askingUntil: new Date(nowMs + ASK_LEASE_MS).toISOString(), version: current.version + 1, updatedAt: new Date(nowMs).toISOString() };
      return (await collection.compareAndSet(key, current.version, next)) ? { claimed: next } : false;
    });
  } catch {
    return { current: null };
  }
}

/** Refusals the provider answers before it creates anything: the same market may be asked again at once. */
const NOTHING_ASKED: ReadonlySet<string> = new Set(["VALIDATION_ERROR", "ORDER_REFUSED", "FORBIDDEN", "NOT_FOUND", "FUNDING_OFF", "NOT_LINKED", "LINK_UNAVAILABLE", "UNAUTHORIZED"]);

/**
 * Ask one market's payout, under its own record. The outcomes are the ones
 * the provider marks payable in this pass; the answer is kept as the receipt.
 */
async function askPayout(
  store: GuardStore,
  provider: PredictionProvider,
  wallet: string,
  row: SettleRow,
  payable: readonly Readonly<{ outcomeId: string; label: string; valueUsd: number }>[],
  env: NodeJS.ProcessEnv,
  nowMs: number,
): Promise<CollectRecord | null> {
  const collection = records(store);
  const key = keyOf(wallet, row.venueEventId);
  const stamp = new Date(nowMs).toISOString();
  const fresh: CollectRecord = {
    version: 1,
    kind: "collect",
    wallet,
    requestId: collectRequestId(wallet, row.venueEventId),
    venueEventId: row.venueEventId,
    question: row.question,
    asked: payable,
    legs: [],
    phase: "asking",
    redeemId: null,
    providerRedeemStatus: row.providerRedeemStatus,
    note: null,
    asks: 0,
    askingUntil: null,
    confirmedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const existing = await collection.get(key).catch(() => undefined);
  if (!existing) {
    /* Written before the provider is asked: a crash between the two leaves a record to read, not a payout nobody knows about. */
    const created = await collection.compareAndSet(key, null, fresh).catch(() => false);
    if (!created) return (await collection.get(key).catch(() => undefined)) ?? null;
  }
  const claim = await claimAsk(store, wallet, row.venueEventId, nowMs);
  if (!("claimed" in claim)) return claim.current;
  /* An ask before this one may already have reached the venue: from then on no refusal of a later ask says the payout did not happen. */
  const earlier = claim.claimed.asks > 1;
  /*
   * Asked through the collect that already shipped: it reads the provider's payable marks
   * again just before the request and keeps the provider's answer as the
   * receipt beside the orders. The record around it is what keeps a market
   * from being asked twice.
   */
  const sent = await redeemPositions(store, provider, wallet, payable.map((p) => p.outcomeId), env, new Date(nowMs)).catch(() => failure("UNAVAILABLE", "The payout request did not answer."));
  if (sent.ok) {
    const legs = sent.value.legs;
    const refused = legs.length > 0 && legs.every((l) => l.status === "ineligible" || l.status === "rejected");
    return patch(
      store,
      wallet,
      row.venueEventId,
      (current) => ({
        legs,
        redeemId: sent.value.redeemId || current.redeemId,
        asked: payable.length > 0 ? payable : current.asked,
        /* The venue was asked; whether it paid is read off the position, never off this answer. */
        phase: refused ? "refused" : "collecting",
        note: refused ? (legs.find((l) => l.reason)?.reason?.slice(0, 200) ?? "INELIGIBLE") : null,
        askingUntil: null,
      }),
      nowMs,
    );
  }
  if (!earlier && NOTHING_ASKED.has(sent.code)) {
    /* This first request never left: the record is closed as refused and the market may be asked again when the provider marks it payable. */
    return patch(store, wallet, row.venueEventId, () => ({ phase: "refused", note: sent.code, askingUntil: null }), nowMs);
  }
  return patch(store, wallet, row.venueEventId, () => ({ phase: "unknown", note: sent.code, askingUntil: null }), nowMs);
}

/**
 * Read the position back and close the record by what the provider says
 * about it — the only thing that turns a payout into *collected*.
 */
function confirmFrom(record: CollectRecord, position: PaperPosition | undefined, nowMs: number): Partial<CollectRecord> | null {
  if (!position) return null;
  const phase = redeemPhase(position.redeemStatus);
  const status = String(position.redeemStatus ?? "").slice(0, 40);
  if (phase === "paid") return { phase: "collected", providerRedeemStatus: status, confirmedAt: new Date(nowMs).toISOString(), askingUntil: null };
  if (phase === "disputed") return { phase: "unknown", providerRedeemStatus: status, note: "DISPUTED", askingUntil: null };
  /* Nothing moved: the record is left alone rather than rewritten on every pass. */
  return record.providerRedeemStatus === status ? null : { providerRedeemStatus: status };
}

/* ------------------------------------------------------------------ the sweep */

export type SettleSweep = Readonly<{
  wallet: string;
  mode: "paper" | "live";
  calendar: SettleCalendar;
  collects: readonly CollectView[];
  notes: readonly Note[];
  /** Set when the provider could not be read; the rest is what the store holds. */
  providerFailure: Readonly<{ code: string; message: string }> | null;
  readAt: string;
}>;

export type SweepDeps = Readonly<{
  transports?: NotifyTransports;
  locale?: NoteLocale;
  /** False for a read: the calendar, the notes and the open payouts are refreshed, and no new payout is asked for. */
  ask?: boolean;
}>;

/**
 * One pass for one wallet: read the positions, write what happened, ask for
 * the payouts the provider marks payable, follow the open ones to the end,
 * and send what is due.
 *
 * `ask: false` makes it a read — it writes notes and follows what is already
 * out, and asks for nothing new. A wallet live money is not open to, or a
 * deployment with it switched off, is a paper sweep: the calendar and the
 * notes, no payout.
 */
export async function sweepSettlement(store: GuardStore, provider: PredictionProvider, wallet: string, env: NodeJS.ProcessEnv = process.env, nowMs: number = Date.now(), deps: SweepDeps = {}): Promise<Result<SettleSweep>> {
  const live = fundingEnabled(env) && liveWalletAllowed(wallet, env);
  const mode = live ? "live" : "paper";
  const read = await withProviderSession(store, provider, wallet, async (session) => {
    const [active, closed] = await Promise.all([provider.paperPositions(session, "active", mode), provider.paperPositions(session, "closed", mode)]);
    if (!active.ok) return active;
    if (!closed.ok) return closed;
    return { ok: true as const, value: [...active.value, ...closed.value].slice(0, ROWS_PER_SWEEP) };
  }, env, nowMs);
  const stored = await listRecords(store, wallet);
  if (!read.ok) {
    /* The provider did not answer: nothing is asked for and nothing is guessed — what the store holds is what is shown. */
    return {
      ok: true,
      value: {
        wallet,
        mode,
        calendar: settleCalendar([], nowMs),
        collects: stored.map((r) => collectView(r, nowMs)),
        notes: await listNotes(store, wallet),
        providerFailure: { code: read.code, message: read.message },
        readAt: new Date(nowMs).toISOString(),
      },
    };
  }
  const positions = read.value;
  const byMarket = new Map(positions.map((p) => [p.venueEventId, p] as const));
  const asked = new Set(stored.filter((r) => r.phase === "asking" || r.phase === "collecting" || r.phase === "collected").map((r) => r.venueEventId));

  /* Close what is already out, from the provider's own word on the position. */
  for (const record of stored) {
    if (record.phase === "collected" || record.phase === "refused") continue;
    const change = confirmFrom(record, byMarket.get(record.venueEventId), nowMs);
    if (change) await patch(store, wallet, record.venueEventId, () => change, nowMs);
  }

  /* Ask for what the provider marks payable now — live only, and only for markets with no open record of their own. */
  if (live && deps.ask !== false) {
    const payableByMarket = new Map<string, Readonly<{ outcomeId: string; label: string; valueUsd: number }>[]>();
    for (const position of positions) {
      const lines = redeemable([position]);
      if (lines.length > 0) payableByMarket.set(position.venueEventId, lines.map((l) => ({ outcomeId: l.outcomeId, label: l.label, valueUsd: l.valueUsd })));
    }
    let done = 0;
    for (const [venueEventId, lines] of payableByMarket) {
      if (done >= COLLECTS_PER_SWEEP) break;
      const row = settleRow(byMarket.get(venueEventId)!, nowMs);
      const held = stored.find((r) => r.venueEventId === venueEventId);
      /* Already paid, refused by the venue, or past the window in which it is asked again: nothing is sent. */
      if (held && (held.phase === "collected" || held.phase === "refused" || isAged(held, nowMs))) continue;
      await askPayout(store, provider, wallet, row, lines, env, nowMs);
      done += 1;
    }
  }

  const after = await listRecords(store, wallet);
  const byEvent = new Map(after.map((r) => [r.venueEventId, r] as const));
  /* The calendar is drawn from the records as they stand now, so a market just asked for reads as on its way, not as still due. */
  const calendar = settleCalendar(positions, nowMs, new Set([...asked, ...after.filter((r) => r.phase !== "refused").map((r) => r.venueEventId)]));

  /* What happened, as notes. Each is written under its own identity, so a sweep that runs every ten minutes writes each one once. */
  for (const position of positions) {
    const row = settleRow(position, nowMs, byEvent.has(position.venueEventId));
    const record = byEvent.get(position.venueEventId);
    await writeNotes(store, wallet, row, record, mode === "paper", nowMs);
  }
  const prefs = await readPrefs(store, wallet, nowMs);
  if (deps.transports) {
    const locale = deps.locale ?? "en";
    /* Every note the channel holds, each in its own vocabulary: a market watch's note may be waiting beside settlement's. */
    await deliverNotes(store, wallet, { transports: deps.transports, words: (n) => predictionNoteWords(n, locale), prefs }, nowMs).catch(() => undefined);
  }
  await pruneNotes(store, wallet, nowMs).catch(() => undefined);

  return {
    ok: true,
    value: {
      wallet,
      mode,
      calendar,
      collects: after.map((r) => collectView(r, nowMs)),
      notes: await listNotes(store, wallet),
      providerFailure: null,
      readAt: new Date(nowMs).toISOString(),
    },
  };
}

/** The portfolio's link, where every settlement note points when it is about money. */
const PORTFOLIO_HREF = "/app/predictions/portfolio";

/**
 * How long a decision is news. The first pass of a deployment reads a whole
 * trading history at once; a market decided months ago is not something to
 * tell anybody now. A market whose moment the provider does not state is
 * told about — there is nothing better to go on than that it is decided.
 */
const DECIDED_FRESH_MS = 7 * 86_400_000;

function recentlyDecided(row: SettleRow, nowMs: number): boolean {
  const at = row.resolutionDate ? Date.parse(row.resolutionDate) : Number.NaN;
  return Number.isNaN(at) || nowMs - at <= DECIDED_FRESH_MS;
}

/**
 * The notes one market's row calls for. A note is written once per thing that
 * happened: the market being decided, the win landing, the payout left
 * unconfirmed, a settlement overdue, a result disputed, and one warning
 * before the deadline.
 */
async function writeNotes(store: GuardStore, wallet: string, row: SettleRow, record: CollectRecord | undefined, paper: boolean, nowMs: number): Promise<void> {
  const href = row.eventId ? `/app/predictions/${encodeURIComponent(row.eventId)}` : PORTFOLIO_HREF;
  const facts = { question: row.question, market: row.venueEventId };
  /* Every one of these is a standing fact, not something that happens again: said once, whatever the number of passes. */
  const write = (kind: string, identity: string, extra: Readonly<Record<string, string | number | null>> = {}, to = href) => note(store, wallet, { kind, identity, facts: { ...facts, ...extra }, href: to, paper, once: true }, nowMs);

  if (row.phase === "due_soon") await write("settle_due", `settle_due:${row.venueEventId}:${row.resolutionDate ?? ""}`, { resolutionDate: row.resolutionDate });
  if (row.phase === "late") await write("settle_late", `settle_late:${row.venueEventId}`, { resolutionDate: row.resolutionDate });
  if (row.phase === "disputed") await write("settle_disputed", `settle_disputed:${row.venueEventId}`);
  const news = recentlyDecided(row, nowMs);
  /* Decided — said once per market, whichever side won. */
  if (news && (row.phase === "payable" || row.phase === "collecting" || row.phase === "paid" || row.phase === "venue_pays" || row.phase === "lost")) {
    await write("market_resolved", `resolved:${row.venueEventId}`, { won: row.winningLabel === null ? 0 : 1, outcome: row.winningLabel });
  }
  /* The money landed: the provider itself says the position is paid, or the venue pays it without being asked. */
  if (record?.phase === "collected" || (news && record === undefined && (row.phase === "paid" || row.phase === "venue_pays"))) {
    await write("win_credited", `credited:${row.venueEventId}`, { amountUsd: record ? amountOf(record) : row.valueUsd }, PORTFOLIO_HREF);
  }
  if (record?.phase === "unknown") await write("win_unknown", `unknown:${row.venueEventId}:${record.requestId}`, { amountUsd: amountOf(record) }, PORTFOLIO_HREF);
}

/* ------------------------------------------------------------------ the person's own press */

export type CollectNow = Readonly<{
  /** The provider's answer across the markets asked, in the collect's own receipt shape. */
  receipt: Readonly<{ redeemId: string | null; legs: readonly RedeemLeg[] }>;
  collects: readonly CollectView[];
}>;

/**
 * *Collect* pressed by the person, on the named outcomes — the same path the
 * sweep takes, so a press during a sweep, or two presses, ask each market's
 * payout once under its own request id. The outcomes are matched against
 * what the provider marks payable now; an id it does not is refused.
 */
export async function collectMarkets(store: GuardStore, provider: PredictionProvider, wallet: string, outcomeIds: readonly string[], env: NodeJS.ProcessEnv = process.env, nowMs: number = Date.now()): Promise<Result<CollectNow>> {
  if (!collectsLive(wallet, env)) return failure("FUNDING_OFF", "Live money is not switched on here.");
  const wanted = new Set(outcomeIds);
  if (wanted.size === 0) return failure("VALIDATION_ERROR", "Name the outcomes to collect.");
  const read = await withProviderSession(store, provider, wallet, async (session) => {
    const [active, closed] = await Promise.all([provider.paperPositions(session, "active", "live"), provider.paperPositions(session, "closed", "live")]);
    if (!active.ok) return active;
    if (!closed.ok) return closed;
    return { ok: true as const, value: [...active.value, ...closed.value] };
  }, env, nowMs);
  if (!read.ok) return read;
  const asked: CollectRecord[] = [];
  for (const position of read.value.slice(0, ROWS_PER_SWEEP)) {
    const lines = redeemable([position]).filter((line) => wanted.has(line.outcomeId));
    if (lines.length === 0) continue;
    if (asked.length >= COLLECTS_PER_SWEEP) break;
    const record = await askPayout(store, provider, wallet, settleRow(position, nowMs), lines.map((l) => ({ outcomeId: l.outcomeId, label: l.label, valueUsd: l.valueUsd })), env, nowMs);
    if (record) asked.push(record);
  }
  if (asked.length === 0) return failure("ORDER_REFUSED", "The provider does not mark these as payable now; reload the positions.");
  return {
    ok: true,
    value: {
      receipt: { redeemId: asked.find((r) => r.redeemId)?.redeemId ?? null, legs: asked.flatMap((r) => r.legs) },
      collects: asked.map((r) => collectView(r, nowMs)),
    },
  };
}

/* ------------------------------------------------------------------ reads */

/** The payout receipts of one wallet, newest first — Ryntra's own records beside the provider's legs. */
export async function listCollects(store: GuardStore, wallet: string, nowMs: number = Date.now()): Promise<readonly CollectView[]> {
  return (await listRecords(store, wallet)).map((r) => collectView(r, nowMs));
}

/** Whether the deployment can collect for this wallet at all; paper otherwise, which is the default. */
export function collectsLive(wallet: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return fundingEnabled(env) && liveWalletAllowed(wallet, env);
}

/** How many wallets one operator pass sweeps, so the pass stays inside one request's budget. */
export const SWEEP_WALLETS_LIMIT = 50;

/**
 * The wallets a pass has anything to sweep for: every wallet with an
 * account here (a provider link — those are the people with positions),
 * plus the ones that placed an order or already hold a payout record. A
 * wallet that only ever read markets is waiting for nothing.
 */
export async function sweepWallets(store: GuardStore, limit = SWEEP_WALLETS_LIMIT): Promise<readonly string[]> {
  type Row = Readonly<{ version: number; wallet?: unknown; state?: unknown }>;
  const wallets = new Set<string>();
  const add = (row: Row) => {
    if (typeof row.wallet === "string" && row.wallet.length > 0) wallets.add(row.wallet);
    return wallets.size >= limit;
  };
  /* A revoked link is no account any more: nothing is read for it. */
  for (const row of await store.versioned<Row>("predictionLinks").valuesWithPrefix(LINK_KEY_PREFIX).catch((): Row[] => [])) {
    if (row.state !== "revoked" && add(row)) return [...wallets];
  }
  const orders = store.versioned<Row>("predictionOrders");
  for (const prefix of [ORDER_KEY_PREFIX, KEY_PREFIX]) {
    for (const row of await orders.valuesWithPrefix(prefix).catch((): Row[] => [])) if (add(row)) return [...wallets];
  }
  return [...wallets];
}
