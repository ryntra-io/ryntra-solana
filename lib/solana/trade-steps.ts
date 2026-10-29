/**
 * SOL-P1: the steps of a trade in the browser — the quote, preparing the bytes, the wallet's signature, the send with
 * its confirmation — each timed as `performance.measure("ryntra:trade:<flow>:<step>")`. The speed measurement
 * (`scripts/perf/solana-speed.mjs`) and DevTools read them; nothing leaves the device, and only names are written.
 */
export type TradeStep = "quote" | "prepare" | "sign" | "send";

export function measureTradeStep(flow: string, step: TradeStep, startedAt: number): void {
  try {
    performance.measure(`ryntra:trade:${flow}:${step}`, { start: startedAt, end: performance.now() });
  } catch {
    /* A browser without measures still trades. */
  }
}
