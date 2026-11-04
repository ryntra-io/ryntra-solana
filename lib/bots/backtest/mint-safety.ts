/**
 * Which tokens a bot may stand on. A bot holds the person's tokens in an
 * order or a position for days; a Token-2022 mint whose authority can take
 * them, stop them or tax them makes that unsafe, so such mints are left out:
 *
 * - `permanent_delegate` — an authority can move or burn any holder's tokens;
 * - `transfer_hook` — a program the mint names runs on every transfer and can refuse it;
 * - `freeze_authority` — an authority can freeze the order's or the position's account;
 * - `transfer_fee` — every transfer pays the mint's fee, and its authority can raise it.
 *
 * A classic SPL token keeps its freeze authority out of this list: the dollar
 * stables have one, and a pool of USDC is the bots' home. A mint whose facts
 * were not read is left out too — the filter never passes what it did not see.
 *
 * The facts are the market-data gateway's (`lib/solana/risk-facts.ts`). Pure.
 */

import type { TokenRiskFacts } from "../../solana/risk-facts.ts";

export type MintAccountFacts = NonNullable<TokenRiskFacts["mint_account"]>;

export const MINT_EXCLUSIONS = ["permanent_delegate", "transfer_hook", "freeze_authority", "transfer_fee", "not_read"] as const;
export type MintExclusion = (typeof MINT_EXCLUSIONS)[number];

export type MintSafety = Readonly<{ ok: boolean; reasons: readonly MintExclusion[] }>;

export function mintSafety(facts: Pick<MintAccountFacts, "program" | "freeze_authority" | "permanent_delegate" | "transfer_hook" | "transfer_fee"> | null): MintSafety {
  if (!facts) return { ok: false, reasons: ["not_read"] };
  if (facts.program !== "spl-token-2022") return { ok: true, reasons: [] };
  const reasons: MintExclusion[] = [];
  if (facts.permanent_delegate !== null) reasons.push("permanent_delegate");
  if (facts.transfer_hook !== null) reasons.push("transfer_hook");
  if (facts.freeze_authority !== null) reasons.push("freeze_authority");
  if (facts.transfer_fee !== null) reasons.push("transfer_fee");
  return { ok: reasons.length === 0, reasons };
}

/** Both of a pair's mints; a pair is as safe as its less safe side. */
export function pairSafety(base: Parameters<typeof mintSafety>[0], quote: Parameters<typeof mintSafety>[0]): MintSafety {
  const a = mintSafety(base);
  const b = mintSafety(quote);
  return { ok: a.ok && b.ok, reasons: [...new Set([...a.reasons, ...b.reasons])] };
}
