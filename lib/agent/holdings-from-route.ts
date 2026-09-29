/**
 * The holdings route's answer, as the agent's holdings tool reads it
 * (`RYN-API-CONTRACT-002`; the defect it closes is recorded on the card).
 *
 * The agent reads holdings through the route itself, in-process, so the
 * Portfolio page and Ryn never disagree about a balance. Until 2026-09-22 the
 * answer was *cast* to the agent's own row type rather than read: the route
 * serves native SOL as `kind: "NATIVE_SOL"` with `mint: null` — native SOL
 * has no mint — while the agent's type promised a mint on every row. The
 * holdings card then carried `mint: null`, the session's own schema refused
 * it on write, and a portfolio question from any real wallet (and the
 * portfolio Brief and every asset Critic) failed with a server error. The
 * fixtures never showed it, because they were written in the agent's shape
 * and not in the route's.
 *
 * Now the answer is parsed against the contract's `HoldingsResponseSchema`,
 * and native SOL is carried under wrapped SOL's mint — the mint the route
 * prices it by and the mint a SOL plan names, so *which positions have a
 * plan* matches SOL correctly. An answer that does not parse is an
 * unavailable read with its reason, never a guessed row.
 *
 * Pure: an answer in, the agent's read out.
 */

import { HoldingsResponseSchema, type HoldingsRow } from "../api/v1/contract.ts";
import { WRAPPED_SOL_MINT } from "../solana/send-kinds.ts";
import type { HoldingsRead } from "./tools/readers.ts";

type AgentHoldingsRow = Extract<HoldingsRead, { ok: true }>["holdings"][number];

function agentRow(row: HoldingsRow): AgentHoldingsRow {
  return {
    kind: row.kind === "NATIVE_SOL" ? "NATIVE" : "TOKEN",
    /* Native SOL has no mint; wrapped SOL's is the one it is priced and planned by. */
    mint: row.mint ?? WRAPPED_SOL_MINT,
    amountRaw: row.amountRaw,
    decimals: row.decimals,
    symbol: row.symbol,
    name: row.name,
    catalog: row.catalog === null ? null : { symbol: row.catalog.symbol, name: row.catalog.name, usdPrice: row.catalog.usdPrice, isVerified: row.catalog.isVerified === true, category: row.catalog.category ?? null },
  };
}

/** The route's HTTP status and body → the agent's holdings read. */
export function holdingsReadFromAnswer(status: number, body: unknown): HoldingsRead {
  if (status < 200 || status >= 300) {
    const message = typeof body === "object" && body !== null && "error" in body ? (body as { error?: { message?: unknown } }).error?.message : null;
    return { ok: false, reason: typeof message === "string" && message.length > 0 ? message : `the holdings route answered ${status}` };
  }
  const parsed = HoldingsResponseSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `the holdings answer did not match its contract${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}` };
  }
  const data = parsed.data.data;
  return { ok: true, owner: data.owner, holdings: data.holdings.map(agentRow), tokenRead: data.tokenRead, observedAt: data.observedAt, sourceHost: data.source.host };
}
