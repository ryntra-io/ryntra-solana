import type { SpotSide } from "./use-spot-ticket.ts";

/**
 * What a press of the phone's pinned «Купити | Продати» does to the ticket (B16), by the side buttons' own rules:
 * nothing while an order is on its way or on its Review, never a sale under a plan or a rule's reminder; else the
 * market order on that side — a new side starts from an empty amount, the same side keeps the one typed.
 */
export function takeSideRequest(requested: SpotSide, ticket: Readonly<{ side: SpotSide; busy: boolean; review: boolean; bound: boolean }>): "ignore" | "keep" | "switch" {
  if (ticket.busy || ticket.review) return "ignore";
  if (ticket.bound && requested === "SELL") return "ignore";
  return ticket.side === requested ? "keep" : "switch";
}
