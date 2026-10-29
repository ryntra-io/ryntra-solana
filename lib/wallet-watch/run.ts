/**
 * «Стеження за гаманцями» (SOL-R4) — the pass that tells people what the wallets they follow did, through the
 * assistant's engine: a note in the inbox (`lib/monitoring`, kind `wallet-watch`), and Telegram and push as the
 * person's Нагляд settings say — quiet hours and the hour's share kept.
 *
 * Every followed wallet is read once for everyone who follows it; only trades after the person followed it and after
 * the last one they were told of are news. Up to three trades of one wallet make a note each; more at once make one
 * note of the burst. «The creator sells» always has its own note — the trigger a holder needs first.
 *
 * Reads the chain and Jupiter, writes notes. Signs, sends and trades nothing.
 */

import { createHash } from "node:crypto";

import type { GuardStore } from "../guard/store.ts";
import { inboxKeyOf } from "../monitoring/apply.ts";
import { inQuietHours } from "../monitoring/quiet-hours.ts";
import { inboxOf, outboxKey, outboxOf, readPreferences, type InboxRecord, type OutboxRecord } from "../monitoring/store.ts";
import { burstNote, NOTE_CTA, shortAddress, tradeNote, type NoteWords } from "./notes.ts";
import { changePaper, fillCopy, listPapers, type FillFacts, type PaperRecord } from "./paper.ts";
import { birthsOf, refreshActivity, type FactsReader, type WalletChain } from "./read.ts";
import { claimSend, listFollows, pruneSent, pruneStale, readActivity, readTold, TOLD_KEPT, writeTold, type FollowsRecord, type WalletFollow } from "./store.ts";
import { labelsOf, WRAPPED_SOL, type WalletLabel, type WalletTrade } from "./trades.ts";

/** The pass stops starting new wallets after this; the cron's own limit is a minute. */
export const PASS_BUDGET_MS = 40_000;
/** A delivery is held from the monitoring cron this long: this pass sends it first. */
export const DELIVERY_HOLD_MS = 90_000;
/** A trade older than this is history, not news — a pass that missed hours does not ring for all of them. */
export const NEWS_WINDOW_S = 2 * 3_600;
/** Trades of one wallet that each get a note; more at once are one note. */
export const NOTES_PER_BURST = 3;

export type PassDeps = Readonly<{
  store: GuardStore;
  chain: WalletChain;
  facts: FactsReader;
  clock: () => number;
  /** Sends the rows this pass queued (production: the monitoring delivery narrowed to them). */
  deliver?: (rows: ReadonlySet<string>, atMs: number) => Promise<void>;
}>;

export type PassReport = Readonly<{ wallets: number; read: number; notes: number; delivered: number; capped: number; quiet: number; paperFills: number; pruned: number; ms: number }>;

export function walletNoteId(owner: string, identity: string): string {
  return `inb_${createHash("sha256").update(`wallet-watch:${owner}:${identity}`).digest("hex").slice(0, 24)}`;
}

function monitorIdOf(owner: string, wallet: string): string {
  return `mon_${createHash("sha256").update(`wallet-watch:${owner}:${wallet}`).digest("hex").slice(0, 24)}`;
}

type Tally = { notes: number; delivered: number; capped: number; quiet: number; queued: Set<string> };

async function queue(store: GuardStore, owner: string, identity: string, inboxId: string, channel: "telegram" | "push", nowMs: number): Promise<string | null> {
  const at = new Date(nowMs).toISOString();
  const id = outboxKey(owner, identity, channel);
  const row: OutboxRecord = { id, owner, triggerId: identity, inboxId, channel, state: "pending", attempts: 0, nextAttemptAt: new Date(nowMs + DELIVERY_HOLD_MS).toISOString(), lastError: null, createdAt: at, updatedAt: at };
  return (await outboxOf(store).insertIfAbsent(id, row)) ? id : null;
}

/** One note and its deliveries: the note once; sent only when it is new, outside quiet hours and within the hour's share. */
async function ring(store: GuardStore, owner: string, follow: WalletFollow, identity: string, words: Readonly<{ en: NoteWords; uk: NoteWords }>, locale: "en" | "uk", nowMs: number, tally: Tally): Promise<void> {
  const inboxId = walletNoteId(owner, identity);
  const own = words[locale];
  const note: InboxRecord = {
    id: inboxId,
    owner,
    monitorId: monitorIdOf(owner, follow.address),
    /* Hashed: a burst's identity names every trade in it, and the outbox's key carries the trigger. */
    triggerId: `wallet-watch:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`,
    title: own.title,
    reason: own.reason,
    context: follow.name ?? shortAddress(follow.address),
    href: `/app/alerts/open?n=${inboxId}`,
    cta: NOTE_CTA[locale],
    paper: false,
    unread: true,
    createdAt: new Date(nowMs).toISOString(),
    locale,
    subject: { kind: "wallet-watch", id: follow.address },
    text: words,
  };
  if (!(await inboxOf(store).insertIfAbsent(inboxKeyOf(owner, inboxId), note))) return;
  tally.notes += 1;
  const prefs = await readPreferences(store, owner);
  if (!prefs.telegram && !prefs.push) return;
  /* In the quiet hours the inbox alone: a trade at 03:10 is not news to be sent at 08:00. */
  if (inQuietHours(nowMs, prefs.quietHours)) {
    tally.quiet += 1;
    return;
  }
  if (!(await claimSend(store, owner, nowMs))) {
    tally.capped += 1;
    return;
  }
  const wrote = [prefs.telegram ? await queue(store, owner, note.triggerId, inboxId, "telegram", nowMs) : null, prefs.push ? await queue(store, owner, note.triggerId, inboxId, "push", nowMs) : null].filter((id): id is string => id !== null);
  if (wrote.length > 0) tally.delivered += 1;
  for (const id of wrote) tally.queued.add(id);
}

/** A trade's key: one transaction can be a sale of one token and a purchase of another. */
const keyOf = (trade: WalletTrade) => `${trade.signature}:${trade.mint}:${trade.side}`;

/** Several sales of one token at once as one: the amounts and what they brought summed, the newest's time. */
function summed(trades: readonly WalletTrade[]): WalletTrade {
  const newest = trades.reduce((top, trade) => (trade.slot > top.slot ? trade : top));
  const quotes = new Set(trades.map((trade) => trade.quote));
  const priced = quotes.size === 1 && trades.every((trade) => trade.quoteAmount !== null);
  return {
    ...newest,
    tokensRaw: trades.reduce((total, trade) => total + BigInt(trade.tokensRaw), 0n).toString(),
    quote: priced ? newest.quote : null,
    quoteAmount: priced ? trades.reduce((total, trade) => total + (trade.quoteAmount ?? 0), 0) : null,
  };
}

/**
 * What one follower is told of one wallet's trades: those after they followed it, of the last two hours, not told yet
 * (the told ones are kept by key — a trade a node gave late is still told). The creator's sales of a token — one note
 * per token, summed; up to three other trades — a note each; more — one note of the burst.
 */
async function tell(store: GuardStore, record: FollowsRecord, follow: WalletFollow, trades: readonly WalletTrade[], labels: ReadonlyMap<string, readonly WalletLabel[]>, symbolOf: (mint: string) => string, nowMs: number, tally: Tally): Promise<void> {
  const told = await readTold(store, record.owner, follow.address).catch(() => null);
  const since = Math.floor(Date.parse(follow.since) / 1000);
  const fresh = trades.filter((trade) => trade.at !== null && trade.at >= since && trade.at >= nowMs / 1000 - NEWS_WINDOW_S && !(told?.keys.includes(keyOf(trade)) ?? false));
  if (fresh.length === 0) return;
  const wanted = follow.alerts === "sells" ? fresh.filter((trade) => trade.side === "sell") : fresh;
  const who = follow.name ?? shortAddress(follow.address);
  const words = (trade: WalletTrade) => ({ en: tradeNote(trade, who, symbolOf(trade.mint), labels.get(trade.mint) ?? [], "en"), uk: tradeNote(trade, who, symbolOf(trade.mint), labels.get(trade.mint) ?? [], "uk") });
  const creatorSales = wanted.filter((trade) => trade.side === "sell" && (labels.get(trade.mint) ?? []).includes("creator"));
  const rest = wanted.filter((trade) => !creatorSales.includes(trade));
  for (const mint of new Set(creatorSales.map((trade) => trade.mint))) {
    const sales = creatorSales.filter((trade) => trade.mint === mint);
    const one = sales.length === 1 ? sales[0]! : summed(sales);
    await ring(store, record.owner, follow, `${follow.address}:creator:${sales.map(keyOf).sort().join(",")}`, words(one), record.locale, nowMs, tally);
  }
  if (rest.length > 0 && rest.length <= NOTES_PER_BURST) {
    for (const trade of rest) await ring(store, record.owner, follow, `${follow.address}:${keyOf(trade)}`, words(trade), record.locale, nowMs, tally);
  } else if (rest.length > 0) {
    const burst = { en: burstNote(rest, who, symbolOf, "en"), uk: burstNote(rest, who, symbolOf, "uk") };
    await ring(store, record.owner, follow, `${follow.address}:burst:${rest.map(keyOf).sort().join(",")}`, burst, record.locale, nowMs, tally);
  }
  /* Told, after the notes: a pass cut short says them again with the same ids — the inbox keeps one of each. */
  const keep = new Set(trades.filter((trade) => trade.at !== null && trade.at >= nowMs / 1000 - NEWS_WINDOW_S).map(keyOf));
  const keys = [...new Set([...(told?.keys ?? []).filter((key) => keep.has(key)), ...fresh.map(keyOf)])].slice(-TOLD_KEPT);
  await writeTold(store, record.owner, follow.address, keys, told?.version ?? null).catch(() => false);
}

/**
 * The paper copies of one wallet after its newest read (SOL-R3): each copier's unhandled trades filled at the price
 * of this moment — the delay is the real one — by compare-and-set, so a person's start or stop is never lost.
 */
async function fillPapers(deps: PassDeps, owners: readonly PaperRecord[], wallet: string, trades: readonly WalletTrade[], nowMs: number): Promise<number> {
  const copies = owners.flatMap((record) => record.copies.filter((copy) => copy.leader === wallet).map((copy) => ({ owner: record.owner, copy })));
  /* Only the trades some copy has not handled yet: a quiet wallet costs no price read and no write. */
  const unseen = trades.filter((trade) => trade.at !== null && trade.paidBy === null && trade.quote !== null && copies.some(({ copy }) => trade.at! >= Math.floor(Date.parse(copy.since) / 1000) && !copy.seen.includes(`${trade.signature}:${trade.mint}:${trade.side}`)));
  if (unseen.length === 0) return 0;
  const mints = [...new Set(unseen.map((trade) => trade.mint))];
  const read = await deps.facts([...mints, WRAPPED_SOL]).catch(() => null);
  const facts = new Map<string, FillFacts>(mints.map((mint) => [mint, { priceUsd: read?.get(mint)?.priceUsd ?? null, liquidityUsd: read?.get(mint)?.liquidityUsd ?? null, symbol: read?.get(mint)?.symbol ?? null }]));
  const solUsd = read?.get(WRAPPED_SOL)?.priceUsd ?? null;
  let filled = 0;
  for (const { owner } of copies) {
    let added = 0;
    const outcome = await changePaper(
      deps.store,
      owner,
      (list) =>
        list.map((copy) => {
          if (copy.leader !== wallet) return copy;
          const next = fillCopy(copy, trades, facts, solUsd, Math.floor(nowMs / 1000));
          added = next === copy ? 0 : next.fills.filter((fill) => !copy.fills.includes(fill) && fill.missed === null).length;
          return next;
        }),
      new Date(nowMs).toISOString(),
    ).catch(() => null);
    if (outcome?.ok) filled += added;
  }
  return filled;
}

export async function runWalletWatchPass(deps: PassDeps): Promise<PassReport> {
  const started = deps.clock();
  const records = await listFollows(deps.store);
  const followers = new Map<string, { record: FollowsRecord; follow: WalletFollow }[]>();
  for (const record of records) for (const follow of record.wallets) if (follow.alerts !== "off") followers.set(follow.address, [...(followers.get(follow.address) ?? []), { record, follow }]);
  /* A wallet copied on paper is read as a followed one, alerts or not. */
  const papers = await listPapers(deps.store).catch(() => [] as PaperRecord[]);
  for (const record of papers) for (const copy of record.copies) if (!followers.has(copy.leader)) followers.set(copy.leader, []);
  let paperFills = 0;
  const tally: Tally = { notes: 0, delivered: 0, capped: 0, quiet: 0, queued: new Set() };
  let read = 0;
  /* The longest unread first: a pass that runs out of time leaves the freshest, and the next one starts where it stopped. */
  const readAt = new Map(await Promise.all([...followers.keys()].map(async (wallet) => [wallet, (await readActivity(deps.store, wallet).catch(() => null))?.readAt ?? ""] as const)));
  const order = [...followers.entries()].sort(([a], [b]) => (readAt.get(a) ?? "").localeCompare(readAt.get(b) ?? ""));
  for (const [wallet, list] of order) {
    if (deps.clock() - started > PASS_BUDGET_MS) break;
    const nowMs = deps.clock();
    const activity = await refreshActivity(deps.store, deps.chain, wallet, { nowMs, freshMs: 45_000, maxNew: 25, concurrency: 2 }).catch(() => null);
    if (!activity) continue;
    read += 1;
    paperFills += await fillPapers(deps, papers, wallet, activity.trades, nowMs).catch(() => 0);
    if (list.length === 0) continue;
    const recent = activity.trades.filter((trade) => trade.at !== null && trade.at >= nowMs / 1000 - NEWS_WINDOW_S);
    if (recent.length === 0) continue;
    const mints = [...new Set(recent.map((trade) => trade.mint))];
    const facts = await deps.facts(mints).catch(() => null);
    /* The labels on what the wallet did here: «creator» — whose sale is the trigger a holder needs first. */
    const births = await birthsOf(deps.store, deps.chain, facts, activity.trades.filter((trade) => mints.includes(trade.mint)), nowMs);
    const labels = labelsOf(wallet, activity.trades, births);
    const symbolOf = (mint: string) => facts?.get(mint)?.symbol ?? shortAddress(mint);
    for (const { record, follow } of list) await tell(deps.store, record, follow, recent, labels, symbolOf, nowMs, tally).catch(() => undefined);
  }
  /* This pass's rows are held from the monitoring cron; it sends them itself, as at their time. */
  if (tally.queued.size > 0 && deps.deliver) await deps.deliver(tally.queued, deps.clock() + DELIVERY_HOLD_MS).catch(() => undefined);
  /* Swept twice an hour rather than every pass: the old hours' counts, and the records of wallets nobody follows. */
  const sweep = new Date(deps.clock()).getUTCMinutes() % 30 < 2;
  const pruned = sweep ? (await pruneSent(deps.store, deps.clock()).catch(() => 0)) + (await pruneStale(deps.store, new Set([...records.flatMap((record) => record.wallets.map((row) => row.address)), ...papers.flatMap((record) => record.copies.map((copy) => copy.leader))]), deps.clock()).catch(() => 0)) : 0;
  return { wallets: followers.size, read, notes: tally.notes, delivered: tally.delivered, capped: tally.capped, quiet: tally.quiet, paperFills, pruned, ms: deps.clock() - started };
}
