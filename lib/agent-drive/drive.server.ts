import "server-only";

import { onlyRows } from "@/lib/assistant/watch/runtime.server";
import type { GuardStore } from "@/lib/guard/store";
import { AGENT_SYMBOL_ENV, agentResult } from "@/lib/mandate/agent-service.server";
import { readBook, type BookEntry } from "@/lib/mandate/book.server";
import { readSales } from "@/lib/mandate/sale.server";
import { mandateGate, type MandateGate } from "@/lib/mandate/service.server";
import { deliverOutbox } from "@/lib/monitoring/service.server";
import { fetchTokenCatalog } from "@/lib/solana/catalog";
import { cardsOf, cardView } from "./card";
import type { Lang } from "./figures";
import { runDrivePass, type WatchPass } from "./watch";
import { runWeekPass, WEEK_MS, weekEntries, weekSummary, type WeekPass, type WeekSummary } from "./week";

/**
 * The production side of the agent's drive: the watch over the agent's book and the week, on the network the mandate's
 * gate opens, through the engine's own delivery — Telegram, the phone's push, the browser's push, quiet hours, retries.
 * Shut unless `RYNTRA_AGENT_DRIVE=on` and the mandate's gate stands open. The coins' tickers come from Jupiter's
 * catalogue (on devnet, the pool's coin as the deployment names it); a figure of the week is the agent's own view
 * (`agentResult`), the very read its card and the daily report show.
 */

type Env = Readonly<Record<string, string | undefined>>;
type Guard = Readonly<{ store: GuardStore; writes: { allowed: boolean } }>;

export const AGENT_DRIVE_ENV = "RYNTRA_AGENT_DRIVE";
/** The server's switch: `on` lets the drive tell the agent's moves and its week. */
export const driveSends = (value: string | undefined): boolean => value?.trim() === "on";

export type DriveAnswer = Readonly<{ ran: false; why: "closed" | "no-agent" | "read-only" }> | Readonly<{ ran: true; moves: WatchPass; week: WeekPass }>;

const TICKER = /^[A-Za-z0-9]{1,10}$/u;

type OpenGate = Extract<MandateGate, { open: true }>;

/** One mandate's span as the daily report reads it: its trades, spend and result after every fee; null — not read. */
async function spanOf(entry: BookEntry, gate: OpenGate, store: GuardStore, named: string | null, since: number, until: number) {
  const view = await agentResult({ policy: entry.record.policy, owner: entry.record.owner, since }, gate, { store, symbol: named, now: () => until });
  return view?.away ?? null;
}

export async function runAgentDrive(env: Env, guard: Guard): Promise<DriveAnswer> {
  if (!driveSends(env[AGENT_DRIVE_ENV])) return { ran: false, why: "closed" };
  const gate = mandateGate(env);
  if (!gate.open) return { ran: false, why: "no-agent" };
  if (!guard.writes.allowed) return { ran: false, why: "read-only" };
  const named = env[AGENT_SYMBOL_ENV]?.trim() || null;
  const deliver = (rows: ReadonlySet<string>, atMs: number) => deliverOutbox(onlyRows(guard.store, rows), atMs);
  const entries = await readBook(guard.store, gate.network);
  const moves = await runDrivePass({
    store: guard.store,
    cluster: gate.network,
    clock: Date.now,
    book: async () => entries,
    sales: () => readSales(guard.store, undefined, gate.network),
    symbols: async (mints) => {
      const catalog = await fetchTokenCatalog(mints, 5_000).catch(() => null);
      return Object.fromEntries(
        mints.map((mint) => {
          const read = catalog?.ok ? (catalog.byMint[mint]?.symbol ?? null) : null;
          /* On devnet the pool's coin has no catalogue entry: the deployment names it. */
          const symbol = read && TICKER.test(read) ? read : gate.network === "devnet" && named && TICKER.test(named) ? named : null;
          return [mint, symbol];
        }),
      );
    },
    deliver,
  });
  const week = await runWeekPass({ store: guard.store, clock: Date.now, entries, read: (entry, since, until) => spanOf(entry, gate, guard.store, named, since, until), deliver });
  return { ran: true, moves, week };
}

export type WeekAnswer = Readonly<{ week: WeekSummary; cards: readonly ReturnType<typeof cardView>[] }> | null;

/** Her agents' last seven days and her closed trades' cards, for her bots; null — no agent of hers traded, or not read. */
export async function readWeek(owner: string, env: Env, store: GuardStore, lang: Lang, nowMs = Date.now()): Promise<WeekAnswer> {
  const gate = mandateGate(env);
  if (!gate.open) return null;
  const named = env[AGENT_SYMBOL_ENV]?.trim() || null;
  const span = { since: nowMs - WEEK_MS, until: nowMs };
  const entries = weekEntries(await readBook(store, gate.network), owner, span.since);
  const cards = await cardsOf(store, owner, span.since);
  if (entries.length === 0 && cards.length === 0) return null;
  const days = await Promise.all(entries.map((entry) => spanOf(entry, gate, store, named, span.since, span.until).catch(() => null)));
  if (days.some((day) => day === null)) return null;
  return { week: weekSummary(days.filter((day) => day !== null), cards, span), cards: cards.slice(0, 5).map((card) => cardView(card, lang)) };
}
