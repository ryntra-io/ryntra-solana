/**
 * The limits lane's notes in the person's monitoring inbox (C3): «Ордер
 * виконано» when an order Ryntra recorded fills, and «Квитанція готова» when
 * the reconciler settles a placement or a cancellation the request itself left
 * without an answer. Each goes out the way every other note does — the inbox,
 * then one Telegram message and one push where the wallet's preferences carry
 * them (`lib/monitoring/issuer-events.ts` writes its reminders the same way).
 *
 * A note is written only after a transition the record store applied, and it
 * is claimed once per event and order (`limit:<event>:<order key>`), so a
 * second sync or a retried reconcile never sends a second one. Nothing here
 * moves a record or money: the sync and the reconciler call in after they
 * advanced a row, and a note that fails to write is swallowed — the record
 * stays the truth, the note is only news of it.
 *
 * The words stand on a lock screen: the side, the token and the venue — never
 * an amount and never a price. The one action is «Мої ордери»; the note's own
 * link is the inbox opener, which lands on the token's Spot page where the
 * orders are (`limitOrderSpotHref`).
 */

import { createHash } from "node:crypto";

import { USDC_MINT, USDT_MINT, WRAPPED_SOL_MINT } from "../../core/fee-policy.ts";
import type { GuardStore } from "../../guard/store.ts";
import { enqueue, inboxKeyOf } from "../../monitoring/apply.ts";
import { claimTrigger, inboxOf, listDevices, newInboxId, readPreferences, type InboxRecord } from "../../monitoring/store.ts";
import type { LimitSide, LimitVenue } from "./model.ts";
import { limitOrderKey, listLimitOrders, type LimitOrderRecord, type LimitOrderState } from "./store.server.ts";

/** What a note says happened to an order: it filled, or the reconciler settled what a request left open. */
export type LimitNoteEvent = "filled" | "placed" | "not-placed" | "cancelled" | "taken-back" | "not-cancelled";

/** A token's symbol by its mint, or null when none is known. Injected, so tests run without the catalogue. */
export type SymbolLookup = (mint: string) => Promise<string | null>;

export type LimitNotesDeps = Readonly<{
  symbolOf?: SymbolLookup;
  /** The clock the note is stamped with; production reads the wall clock. */
  nowMs?: () => number;
}>;

/** The three mints every pair is priced in, named without a read. */
const KNOWN_SYMBOLS: Readonly<Record<string, string>> = {
  [WRAPPED_SOL_MINT]: "SOL",
  [USDC_MINT]: "USDC",
  [USDT_MINT]: "USDT",
};

/** The catalogue is asked briefly: a note waits for a name no longer than this, then says the short mint. */
const CATALOG_TIMEOUT_MS = 2_500;

const VENUE_NAMES: Readonly<Record<LimitVenue, string>> = { trigger: "Jupiter", dlmm: "Meteora DLMM" };

/** A mint as a person can still tell it apart: its first four characters. */
export function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…`;
}

/** A catalogue's symbol made safe for one line: printable, trimmed, at most a dozen characters. */
function cleanSymbol(symbol: string | null | undefined): string | null {
  if (typeof symbol !== "string") return null;
  const clean = symbol.replace(/[^\p{L}\p{N}$._-]/gu, "").trim().slice(0, 12);
  return clean.length > 0 ? clean : null;
}

/** The production lookup: the known three, else Jupiter's token catalogue, read once and briefly. */
export const catalogSymbolOf: SymbolLookup = async (mint) => {
  const { fetchTokenCatalog } = await import("../catalog.ts");
  const read = await fetchTokenCatalog([mint], CATALOG_TIMEOUT_MS);
  return read.ok ? (read.byMint[mint]?.symbol ?? null) : null;
};

/** The base token's name in a note: SOL, USDC, USDT by mint, else the catalogue's, else the short mint. */
export async function baseSymbolOf(mint: string, symbolOf: SymbolLookup = catalogSymbolOf): Promise<string> {
  const known = KNOWN_SYMBOLS[mint];
  if (known) return known;
  const found = await symbolOf(mint).catch(() => null);
  return cleanSymbol(found) ?? shortMint(mint);
}

/** The claim a note is written under: one per event and order record. */
export function limitNoteIdentity(event: LimitNoteEvent, record: Pick<LimitOrderRecord, "wallet" | "venue" | "order">): string {
  return `limit:${event}:${limitOrderKey(record)}`;
}

/** The monitor id a limit's notes carry — the contract's `mon_` shape, derived from the wallet and the order account; an order is not a monitor and no monitor has it. */
export function limitMonitorId(owner: string, order: string): string {
  return `mon_${createHash("sha256").update(`limit-order:${owner}:${order}`).digest("hex").slice(0, 24)}`;
}

/** Which receipt a reconciler's settlement is, or null for a move that is no receipt (a cancellation that never landed). */
export function receiptEventOf(before: LimitOrderState, after: LimitOrderState): LimitNoteEvent | null {
  if (before === "PLACING") return after === "OPEN" ? "placed" : after === "FAILED" ? "not-placed" : null;
  /* A cancellation that never landed: the order stands as it was — said, so a lost answer is not read as «cancelled». */
  if (before === "CANCELLING") return after === "CANCELLED" ? "cancelled" : after === "FILLED" ? "taken-back" : after === "OPEN" || after === "PARTIAL" ? "not-cancelled" : null;
  return null;
}

type Words = Readonly<{ title: string; reason: string }>;
export type LimitNoteWords = Readonly<{ en: Words; uk: Words; cta: Readonly<{ en: string; uk: string }> }>;

/**
 * A note's words in both languages. `takeBack` adds, on a DLMM order that
 * converted, where to take it back — never on one already taken back.
 */
export function limitNoteWords(event: LimitNoteEvent, order: Readonly<{ side: LimitSide; venue: LimitVenue }>, symbol: string, takeBack = false): LimitNoteWords {
  const venue = VENUE_NAMES[order.venue];
  const en = `${order.side === "buy" ? "Buy" : "Sell"} ${symbol} · ${venue}`;
  const uk = `${order.side === "buy" ? "Купівля" : "Продаж"} ${symbol} · ${venue}`;
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  const cta = { en: "My orders", uk: "Мої ордери" };
  switch (event) {
    case "filled":
      return takeBack
        ? { en: { title: "Limit order filled", reason: `${en} — take it back in My orders` }, uk: { title: "Ордер виконано", reason: `${uk} — забери в «Мої ордери»` }, cta }
        : { en: { title: "Limit order filled", reason: en }, uk: { title: "Ордер виконано", reason: uk }, cta };
    case "placed":
      return { en: { title: "Receipt ready", reason: `Order placed: ${lower(en)}` }, uk: { title: "Квитанція готова", reason: `Ордер розміщено: ${lower(uk)}` }, cta };
    case "not-placed":
      return { en: { title: "Receipt ready", reason: `Order not placed: ${lower(en)}` }, uk: { title: "Квитанція готова", reason: `Ордер не розміщено: ${lower(uk)}` }, cta };
    case "cancelled":
      return { en: { title: "Receipt ready", reason: `Order cancelled: ${lower(en)}` }, uk: { title: "Квитанція готова", reason: `Ордер скасовано: ${lower(uk)}` }, cta };
    case "taken-back":
      return { en: { title: "Receipt ready", reason: `Taken back to the wallet: ${lower(en)}` }, uk: { title: "Квитанція готова", reason: `Забрано в гаманець: ${lower(uk)}` }, cta };
    case "not-cancelled":
      return { en: { title: "Receipt ready", reason: `Not cancelled, the order still waits: ${lower(en)}` }, uk: { title: "Квитанція готова", reason: `Не скасовано, ордер чекає: ${lower(uk)}` }, cta };
  }
}

/** The language the wallet's newest live device reads in; English where none is registered. */
export async function noteLocaleOf(store: GuardStore, owner: string): Promise<"en" | "uk"> {
  const devices = await listDevices(store, owner).catch(() => []);
  const newest = [...devices].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return newest?.locale === "uk" ? "uk" : "en";
}

/** Write one note: the claim, the inbox row, then its deliveries. Idempotent by the event and the order. */
export async function writeLimitNote(store: GuardStore, record: LimitOrderRecord, event: LimitNoteEvent, deps: LimitNotesDeps & Readonly<{ takeBack?: boolean }> = {}): Promise<boolean> {
  const nowMs = deps.nowMs?.() ?? Date.now();
  const at = new Date(nowMs).toISOString();
  const owner = record.wallet;
  const identity = limitNoteIdentity(event, record);
  if (!(await claimTrigger(store, identity, at))) return false;
  const symbol = await baseSymbolOf(record.baseMint, deps.symbolOf);
  const locale = await noteLocaleOf(store, owner);
  const words = limitNoteWords(event, record, symbol, deps.takeBack === true);
  const inboxId = newInboxId();
  const note: InboxRecord = {
    id: inboxId,
    owner,
    monitorId: limitMonitorId(owner, record.order),
    triggerId: identity,
    title: words[locale].title,
    reason: words[locale].reason,
    context: `${symbol} · ${VENUE_NAMES[record.venue]}`,
    href: `/app/alerts/open?n=${inboxId}`,
    cta: words.cta[locale],
    paper: false,
    unread: true,
    createdAt: at,
    locale,
    subject: { kind: "limit-order", id: record.order },
    text: { en: words.en, uk: words.uk },
  };
  await inboxOf(store).insertIfAbsent(inboxKeyOf(owner, inboxId), note);
  const prefs = await readPreferences(store, owner);
  if (prefs.telegram) await enqueue(store, owner, identity, inboxId, "telegram", at);
  if (prefs.push) await enqueue(store, owner, identity, inboxId, "push", at);
  return true;
}

/**
 * After a transition the store applied: «Ордер виконано» when the order
 * entered FILLED, and — where the reconciler settled a submission
 * (`receipts`) — «Квитанція готова». Never throws: a note that fails to write
 * leaves the sync and the record as they are. Answers how many it wrote.
 */
export async function noteLimitTransition(
  store: GuardStore,
  before: LimitOrderState,
  after: LimitOrderRecord,
  deps: LimitNotesDeps & Readonly<{ receipts?: boolean }> = {},
): Promise<number> {
  let wrote = 0;
  try {
    if (after.state === "FILLED" && before !== "FILLED") {
      /* A DLMM order converted waits to be taken back; one taken back by the same move needs no such word. */
      const takeBack = after.venue === "dlmm" && before !== "CANCELLING";
      if (await writeLimitNote(store, after, "filled", { ...deps, takeBack })) wrote += 1;
    }
    const receipt = deps.receipts ? receiptEventOf(before, after.state) : null;
    if (receipt && (await writeLimitNote(store, after, receipt, deps))) wrote += 1;
  } catch {
    /* The note is news of the record, never a condition of it. */
  }
  return wrote;
}

/**
 * Where a limit note lands on the web: the base token's Spot page, whose
 * «Мої ордери» lists the order — read from the wallet's own record of it; the
 * Spot page itself when the record is not found.
 */
export async function limitOrderSpotHref(store: GuardStore, owner: string, order: string): Promise<string> {
  const { records } = await listLimitOrders(store, owner).catch(() => ({ records: [] as LimitOrderRecord[] }));
  const record = records.find((row) => row.order === order);
  return record ? `/app/spot?mint=${encodeURIComponent(record.baseMint)}` : "/app/spot";
}
