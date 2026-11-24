/**
 * Every autopay event, for the drive's notifications.
 * Each payment that lands, fails or is missed, and each autopay that starts, ends or is stopped, becomes one row of the
 * book's event log (`private.autopay_events`), in the order the database wrote them. The drive reads the log after the
 * last id it has seen (`readAutopayEvents`, `./store.server.ts`) and says it in its own words, with «Stop» beside it.
 *
 * Public data only: addresses, amounts, signatures. Pure.
 */

import type { AutopayNetwork } from "./policy.ts";
import type { AutopayCoin } from "./schedule.ts";

export const AUTOPAY_EVENT_KINDS = ["started", "paid", "failed", "missed", "ended", "stopped"] as const;
export type AutopayEventKind = (typeof AUTOPAY_EVENT_KINDS)[number];

export type AutopayEvent = Readonly<{
  /** The log's own order: the next read asks for ids after the last one seen. */
  id: number;
  network: AutopayNetwork;
  kind: AutopayEventKind;
  autopayId: string;
  owner: string;
  recipient: string;
  /** The contact's name or the `.skr` name the person chose; null — a bare address. */
  label: string | null;
  coin: AutopayCoin;
  /** One payment, the coin's base units. */
  amount: string;
  /** The window a payment event is about; null for the autopay's own events. */
  window: number | null;
  /** The payment's transaction, when there is one. */
  signature: string | null;
  at: string;
}>;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** An event of the store's answer, or null when it is not one. */
export function eventOf(raw: unknown): AutopayEvent | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "number" && Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : null;
  const network = raw.network === "devnet" || raw.network === "mainnet" ? raw.network : null;
  const kind = (AUTOPAY_EVENT_KINDS as readonly string[]).includes(raw.kind as string) ? (raw.kind as AutopayEventKind) : null;
  const coin = raw.coin === "SOL" || raw.coin === "USDC" ? raw.coin : null;
  const owner = typeof raw.owner === "string" && ADDRESS.test(raw.owner) ? raw.owner : null;
  const recipient = typeof raw.recipient === "string" && ADDRESS.test(raw.recipient) ? raw.recipient : null;
  if (!id || !network || !kind || !coin || !owner || !recipient || typeof raw.autopayId !== "string" || typeof raw.amount !== "string") return null;
  return {
    id,
    network,
    kind,
    autopayId: raw.autopayId,
    owner,
    recipient,
    label: typeof raw.label === "string" ? raw.label : null,
    coin,
    amount: raw.amount,
    window: typeof raw.window === "number" && Number.isSafeInteger(raw.window) ? raw.window : null,
    signature: typeof raw.signature === "string" ? raw.signature : null,
    at: typeof raw.at === "string" ? raw.at : "",
  };
}
