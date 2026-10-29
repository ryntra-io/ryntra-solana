/**
 * The platform's honest metric (DSC-2): of the wallets that traded through Ryntra in a month, the share in the plus
 * after fees — by the one standard (`honest.ts`), month by month. A wallet whose result is not known is counted among
 * the month's wallets and never among those in the plus: the share can only be understated by what is not known.
 *
 * Shown in the admin first.
 *
 * Pure: the wallets' inputs and the clock are the caller's.
 */

import { honestPnlWindow, type HonestPnlInput, type PnlVerdict } from "./honest.ts";

/** A calendar month, UTC: `2026-10`. */
export type MonthKey = `${number}-${string}`;

export type PlatformMonth = Readonly<{
  month: string;
  from: number;
  to: number;
  /** Wallets with a trade in the month. */
  wallets: number;
  plus: number;
  minus: number;
  flat: number;
  /** Wallets whose month is not known well enough to say (completeness below the standard's bar). */
  unknown: number;
  /** In the plus, of every wallet that traded — unknown ones included in the base. Null with no wallet. */
  sharePlusPct: number | null;
  /** Of the wallets whose result is known, the share in the plus — said beside, never instead. */
  sharePlusOfKnownPct: number | null;
  /** The month's turnover-weighted completeness across its wallets. */
  completenessPct: number | null;
}>;

/** Unix seconds of a month's start and the next month's, UTC. */
export function monthRange(month: string): Readonly<{ from: number; to: number }> {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return { from: Date.UTC(year, index - 1, 1) / 1000, to: Date.UTC(year, index, 1) / 1000 };
}

/** The last `count` months ending with the one `nowS` falls in, oldest first. */
export function lastMonths(nowS: number, count: number): string[] {
  const now = new Date(nowS * 1000);
  const out: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    out.push(`${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Each month's share of wallets in the plus after fees. `wallets` — each wallet's whole input by the standard. */
export function platformMonths(wallets: ReadonlyMap<string, HonestPnlInput>, months: readonly string[]): PlatformMonth[] {
  return months.map((month) => {
    const { from, to } = monthRange(month);
    const counts: Record<PnlVerdict, number> = { PLUS: 0, MINUS: 0, FLAT: 0, UNKNOWN: 0, EMPTY: 0 };
    let weighted = 0;
    let weight = 0;
    for (const input of wallets.values()) {
      const window = honestPnlWindow(input, from, to);
      counts[window.verdict] += 1;
      if (window.verdict !== "EMPTY" && window.completenessPct !== null) {
        /* A wallet weighs by its capital at work; one with none known weighs as one unit, so it is not invisible. */
        const w = Math.max(1, window.capital);
        weighted += window.completenessPct * w;
        weight += w;
      }
    }
    const active = counts.PLUS + counts.MINUS + counts.FLAT + counts.UNKNOWN;
    const known = counts.PLUS + counts.MINUS + counts.FLAT;
    return {
      month,
      from,
      to,
      wallets: active,
      plus: counts.PLUS,
      minus: counts.MINUS,
      flat: counts.FLAT,
      unknown: counts.UNKNOWN,
      sharePlusPct: active > 0 ? round1((counts.PLUS / active) * 100) : null,
      sharePlusOfKnownPct: known > 0 ? round1((counts.PLUS / known) * 100) : null,
      completenessPct: weight > 0 ? round1(weighted / weight) : null,
    };
  });
}
