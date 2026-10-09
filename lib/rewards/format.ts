import { formatUsdMicros } from "./model.ts";

/**
 * A dollar figure as a customer page prints it, with the sub-cent case told
 * apart from nothing.
 *
 * `formatUsdMicros` truncates to cents, so the first real cashback of this
 * product — ≈ $0.0063 on a $5 bridge — read `$0.00`: a measured something
 * shown as a measured nothing.
 * The ledger keeps every micro-dollar; only the sentence changes, to the
 * shape Holdings already uses: `<0.01`. Client-safe on purpose — the Rewards
 * card and the Holdings row import it, and neither should pull the store.
 */
export function usdText(micros: bigint): string {
  if (micros > 0n && micros < 10_000n) return "<0.01";
  return formatUsdMicros(micros);
}

/** `<0.01` → `<$0.01`, everything else → `$…`. The sign sits inside the bound. */
export function dollars(text: string): string {
  return text.startsWith("<") ? `<$${text.slice(1)}` : `$${text}`;
}
