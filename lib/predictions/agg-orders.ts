/**
 * The aggregator's own list of this app's orders (`GET /apps/{appId}/orders`,
 * the server key), read page by page from where the last pass stopped and
 * taken into the fee ledger. The list is the truth for money; the webhooks are
 * the early word, and the ledger lines show where the two disagree.
 *
 * The cursor returns only orders that are new or changed since it was issued,
 * so a pass reads little; orders changed in the last two minutes may show on
 * the next pass. Reading spends nothing.
 *
 * Server only.
 */

import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";
import type { PredictionsEnv } from "./env.ts";
import { advanceLedgerCursor, applyAggOrder, quarantineAggOrder, readLedgerCursor, type AggOrder } from "./fee-ledger.ts";

const nullableText = z.string().max(200).nullable().optional();
const raw = z.string().max(40).nullable().optional();
const bips = z.number().int().nullable().optional();

const OrderSchema = z
  .object({
    id: z.string().min(1).max(200),
    quoteId: nullableText,
    dagRunId: nullableText,
    externalId: nullableText,
    userId: nullableText,
    venue: nullableText,
    status: z.string().min(1).max(40),
    side: nullableText,
    amountRaw: raw,
    orderType: nullableText,
    filledAmountRaw: raw,
    updatedAt: nullableText,
    fees: z
      .object({
        quoted: z.object({ appFeeRaw: raw, appFeeBips: bips, referralFeeRaw: raw }).partial().nullable().optional(),
        actual: z
          .object({
            appFee: z.object({ bips, dueRaw: raw, collectedRaw: raw, status: nullableText }).nullable().optional(),
            referral: z.object({ referrer: nullableText, payer: nullableText, feeBips: bips, dueRaw: raw, paidRaw: raw, status: nullableText }).nullable().optional(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();

const PageSchema = z.object({ data: z.array(z.unknown()), nextCursor: z.string().max(200).nullable(), hasMore: z.boolean() });

export type AggOrdersPage = Readonly<{ orders: readonly AggOrder[]; unreadable: readonly unknown[]; nextCursor: string | null; hasMore: boolean }>;
export type FetchOrdersPage = (cursor: string | null) => Promise<AggOrdersPage>;

/** Parse one page; an order the ledger cannot read is kept aside as it came, not guessed at. */
export function parseOrdersPage(json: unknown): AggOrdersPage | null {
  const page = PageSchema.safeParse(json);
  if (!page.success) return null;
  const orders: AggOrder[] = [];
  const unreadable: unknown[] = [];
  for (const item of page.data.data) {
    const order = OrderSchema.safeParse(item);
    if (order.success) orders.push(order.data as AggOrder);
    else unreadable.push(item);
  }
  return { orders, unreadable, nextCursor: page.data.nextCursor, hasMore: page.data.hasMore };
}

/** Null when the deployment cannot read the list: no app, or no server key. */
export function aggOrdersFetcher(env: PredictionsEnv, fetchImpl: typeof fetch = fetch): FetchOrdersPage | null {
  if (!env.appId || !env.apiKey) return null;
  const { appId, apiKey, baseUrl } = env;
  return async (cursor) => {
    const url = new URL(`${baseUrl}/apps/${encodeURIComponent(appId)}/orders`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetchImpl(url, { headers: { accept: "application/json", "x-app-api-key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`orders list answered ${response.status}`);
    const page = parseOrdersPage(await response.json());
    if (!page) throw new Error("orders list answered an unknown shape");
    return page;
  };
}

export type LedgerSync = Readonly<{
  pages: number;
  orders: number;
  hasMore: boolean;
  /** Why the pass stopped before the end, when it did. */
  stopped: "cursor_moved_elsewhere" | "cursor_did_not_move" | null;
  /** Orders the ledger could not read on this pass, kept in quarantine. */
  unreadable: number;
}>;

/**
 * One bounded pass: read pages from the stored cursor, take every order into
 * the ledger, and move the cursor after each page that was fully taken in.
 *
 * An order the ledger cannot read is kept in quarantine as it came, counted in
 * the totals, and the pass moves on — one odd order neither stops the ledger
 * nor disappears. A pass that finds the cursor moved by another pass stops
 * instead of setting it back.
 */
export async function syncFeeLedger(store: GuardStore, fetchPage: FetchOrdersPage, options: { maxPages?: number; now?: () => string } = {}): Promise<LedgerSync> {
  const maxPages = options.maxPages ?? 5;
  const now = options.now ?? (() => new Date().toISOString());
  let position = await readLedgerCursor(store);
  let pages = 0, orders = 0, unreadable = 0, hasMore = true;
  while (hasMore && pages < maxPages) {
    const page = await fetchPage(position.cursor);
    for (const order of page.orders) await applyAggOrder(store, order);
    for (const item of page.unreadable) await quarantineAggOrder(store, item, now());
    pages += 1;
    orders += page.orders.length;
    unreadable += page.unreadable.length;
    hasMore = page.hasMore;
    if (!page.nextCursor || page.nextCursor === position.cursor) {
      /* A page that says «more» without moving the cursor would loop forever. */
      return { pages, orders, hasMore, stopped: hasMore ? "cursor_did_not_move" : null, unreadable };
    }
    if (!(await advanceLedgerCursor(store, position, page.nextCursor, now()))) return { pages, orders, hasMore, stopped: "cursor_moved_elsewhere", unreadable };
    position = { cursor: page.nextCursor, version: (position.version ?? 0) + 1 };
  }
  return { pages, orders, hasMore, stopped: null, unreadable };
}
