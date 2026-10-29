/**
 * The Kamino Lend adapter: the same three calls, switched off until the founder says otherwise.
 *
 * It is the same interface as Jupiter's, deliberately: whatever the founder decides, the surface will not need
 * a second page, a second Review or a second set of words. What differs is its own state —
 *
 * - off (the default): `DISABLED`, with the reason said in words rather than drawn as an empty market;
 * - on with no reserves endpoint configured: `PROVIDER_DOWN` naming the missing variable, because this
 *   repository has never called a Kamino host and will not guess one;
 * - on and configured: the reserves are read and the markets are drawn, and a deposit through it is still
 *   refused.
 *
 * Positions are not read on a provider nobody can deposit through: there is nothing of this product's doing
 * to have a position in yet, and a list of somebody's other Kamino positions is not what this row is for.
 *
 * Like Jupiter's adapter it reads no environment of its own — `service.server.ts` resolves the switch and the
 * endpoint and hands them over, so a test can stand in either state without touching a process.
 */

import type { EarnAdapter, EarnBuilt, EarnFailure, EarnMarketsRead, EarnPositionsRead } from "./contract.ts";
import { KAMINO_ACTIONS_REASON, KAMINO_API_ENV, kaminoMarketsFrom } from "./kamino.ts";
import { KAMINO_ENV } from "./providers.ts";

const CALL_MS = 6_000;
const MAX_BYTES = 2 * 1024 * 1024;

export type KaminoDeps = Readonly<{
  /** Whether this deployment has Kamino turned on. */
  on: boolean;
  /** Where its reserves are read from, or null when the deployment named none. */
  baseUrl: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}>;

export function kaminoLendAdapter(deps: KaminoDeps): EarnAdapter {
  const base = deps.baseUrl?.replace(/\/+$/, "") || null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const blocked = deps.on
    ? base === null
      ? { code: "PROVIDER_DOWN" as const, reason: `Kamino Lend is on, and the reserves endpoint is not set (${KAMINO_API_ENV}).` }
      : null
    : { code: "DISABLED" as const, reason: `Kamino Lend is built and switched off here. It comes on with ${KAMINO_ENV}=on.` };

  const closed = (status: number): EarnFailure => ({ ok: false, ...blocked!, status });

  return {
    provider: "kamino",
    blocked,

    async markets(): Promise<EarnMarketsRead> {
      if (blocked) return closed(503);
      try {
        const response = await fetchImpl(`${base}/reserves`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(CALL_MS),
          cache: "no-store",
        });
        if (!response.ok) {
          return { ok: false, code: "PROVIDER_DOWN", reason: `Kamino Lend answered HTTP ${response.status}.`, status: 502 };
        }
        const text = await response.text();
        if (text.length > MAX_BYTES) {
          return { ok: false, code: "UNREADABLE", reason: "Kamino Lend's answer was larger than this page will read.", status: 502 };
        }
        const markets = kaminoMarketsFrom(JSON.parse(text) as unknown, new Date(now()).toISOString());
        if (markets.length === 0) {
          return { ok: false, code: "UNREADABLE", reason: "Kamino Lend answered without a reserve this product could read.", status: 502 };
        }
        return { ok: true, markets };
      } catch {
        return { ok: false, code: "PROVIDER_DOWN", reason: "Kamino Lend could not be reached.", status: 503 };
      }
    },

    async positions(): Promise<EarnPositionsRead> {
      if (blocked) return closed(503);
      return { ok: true, positions: [] };
    },

    async build(): Promise<EarnBuilt | EarnFailure> {
      if (blocked) return closed(503);
      return { ok: false, code: "DISABLED", reason: KAMINO_ACTIONS_REASON, status: 503 };
    },
  };
}
