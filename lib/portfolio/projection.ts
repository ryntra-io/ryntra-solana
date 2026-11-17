/**
 * Jupiter Portfolio (beta): what the wallet holds on platforms the engine does not read itself.
 *
 * `GET https://api.jup.ag/portfolio/v1/positions/{owner}` with the product's Jupiter key (`x-api-key`; 100 credits a
 * call, `docs/reviews/inputs/canon-v5-2026-09-23/audit/R2-solana-protocols-money.md`). Jupiter's own words for it are a
 * beta, and the repository's rule for it (the Jupiter capability notes, §4) is that it is a **projection, never the
 * truth of a figure**. So:
 *
 * - every row it gives is `origin: "projection"`, its exit `PROJECTION` — nothing leaves on its word;
 * - a row of a platform the engine reads itself (the wallet's coins, native stake, Meteora, Jupiter Lend) is dropped by
 *   the portfolio once that reader answered, and a row naming an account the engine already shows is dropped too
 *   (`service.ts`);
 * - the reader takes the element shapes the API is known to answer (`elements[]`: `type` — `multiple`, `liquidity`,
 *   `borrowlend`, `leverage`, `trade`; `platformId`, `label`, `value`, `data`) and the alternates beside them. The shape
 *   was not read live from this repository (the beta's documentation and the host were out of reach of the session
 *   that wrote it): an element it cannot read is dropped, and a figure it cannot read is null.
 *
 * Pure: the answer in, rows out.
 */

import { exitBlocked, refs, type PortfolioKind, type PortfolioPosition, type PortfolioSource, type PortfolioToken } from "./model.ts";

export const JUPITER_PORTFOLIO_BASE_URL = "https://api.jup.ag/portfolio/v1";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const address = (value: unknown): string | null => {
  const clean = text(value);
  return clean && BASE58.test(clean) ? clean : null;
};
const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * The platforms whose positions the engine reads from their own programs: their projected rows give way to that read
 * once it answered. Matched on the platform's id, lower-cased.
 */
export const OWN_PLATFORMS: Readonly<Record<string, readonly PortfolioSource[]>> = Object.freeze({
  "wallet-tokens": ["wallet"],
  wallet: ["wallet"],
  "native-stake": ["native-stake"],
  "solana-stake": ["native-stake"],
  meteora: ["meteora-dlmm", "meteora-damm-v2"],
  "meteora-dlmm": ["meteora-dlmm"],
  "meteora-damm": ["meteora-damm-v2"],
  "meteora-damm-v2": ["meteora-damm-v2"],
  "jupiter-lend": ["jupiter-lend"],
});

/** A projected asset: its coin and its worth; the amount is the API's decimal one, so no raw amount is stated. */
function assetsOf(value: unknown, role: PortfolioToken["role"]): PortfolioToken[] {
  const out: PortfolioToken[] = [];
  for (const asset of list(value)) {
    if (!isObject(asset)) continue;
    const data = isObject(asset.data) ? asset.data : asset;
    const mint = address(data.address ?? data.mint);
    if (!mint) continue;
    const usd = num(asset.value ?? data.value);
    out.push({ mint, symbol: text(asset.name ?? data.symbol), decimals: null, amountRaw: null, usd: usd === null ? null : Math.abs(usd), role });
  }
  return out;
}

function kindOf(type: string | null, label: string | null): PortfolioKind {
  const l = (label ?? "").toLowerCase();
  if (type === "liquidity" || l.includes("liquidity")) return "pool";
  if (type === "borrowlend" || l.includes("lend") || l.includes("deposit")) return "deposit";
  if (l.includes("stak")) return "stake";
  return "other";
}

/** The account the element is about, where it names one: a position, an obligation, a vault. */
function refOf(element: Json, data: Json): string | null {
  return address(element.ref ?? data.ref) ?? address(list(element.sourceRefs ?? data.sourceRefs).map((r) => (isObject(r) ? r.address : null)).find((a) => address(a)));
}

/**
 * The rows of one answer. A `borrowlend` element with a borrow is two rows — what it supplied and what it borrowed —
 * as the engine's own lending rows are.
 */
export function projectionPositions(payload: unknown, readAt: string): PortfolioPosition[] {
  const elements = isObject(payload) ? list(payload.elements ?? payload.positions) : list(payload);
  const out: PortfolioPosition[] = [];
  elements.forEach((value, index) => {
    if (!isObject(value)) return;
    const platform = text(value.platformId ?? value.platform)?.slice(0, 64) ?? null;
    if (!platform) return;
    const type = text(value.type);
    const label = text(value.label);
    const data = isObject(value.data) ? value.data : {};
    const ref = refOf(value, data);
    const base = {
      protocol: "other" as const,
      platform,
      state: "read" as const,
      origin: "projection" as const,
      inRange: null,
      exit: exitBlocked("none", "PROJECTION"),
      refs: refs({ position: ref }),
      readAt,
    };
    const id = `projection:${platform}:${ref ?? index}`;
    if (type === "borrowlend") {
      const supplied = assetsOf(data.suppliedAssets, "supplied");
      const borrowed = assetsOf(data.borrowedAssets, "borrowed");
      const rewards = assetsOf(data.rewardAssets, "reward");
      const suppliedUsd = num(data.suppliedValue);
      const borrowedUsd = num(data.borrowedValue);
      const rewardUsd = num(data.rewardValue);
      if (supplied.length > 0 || (suppliedUsd ?? 0) > 0) {
        out.push({ id: `${id}:deposit`, ...base, kind: "deposit", label: name(value, supplied), value: { usd: suppliedUsd, sol: null }, earned: rewardUsd && rewardUsd > 0 ? { usd: rewardUsd, sol: null } : null, tokens: [...supplied, ...rewards] });
      }
      if (borrowed.length > 0 || (borrowedUsd ?? 0) > 0) {
        out.push({ id: `${id}:borrow`, ...base, kind: "borrow", label: name(value, borrowed), value: { usd: borrowedUsd === null ? null : -Math.abs(borrowedUsd), sol: null }, earned: null, tokens: borrowed });
      }
      return;
    }
    if (type === "liquidity") {
      for (const [n, liquidity] of list(data.liquidities).entries()) {
        if (!isObject(liquidity)) continue;
        const held = assetsOf(liquidity.assets, "held");
        const rewards = assetsOf(liquidity.rewardAssets, "reward");
        const lref = address(liquidity.ref) ?? ref;
        const rewardUsd = num(liquidity.rewardAssetsValue);
        out.push({
          id: `projection:${platform}:${lref ?? `${index}.${n}`}`,
          ...base,
          kind: "pool",
          label: name(liquidity, held),
          value: { usd: num(liquidity.value), sol: null },
          earned: rewardUsd && rewardUsd > 0 ? { usd: rewardUsd, sol: null } : null,
          tokens: [...held, ...rewards],
          refs: refs({ position: lref }),
        });
      }
      return;
    }
    const assets = assetsOf(data.assets, "held");
    out.push({ id, ...base, kind: kindOf(type, label), label: name(value, assets), value: { usd: num(value.value), sol: null }, earned: null, tokens: assets });
  });
  return out;
}

function name(source: Json, tokens: readonly PortfolioToken[]): string | null {
  return text(source.name) ?? (tokens.map((t) => t.symbol).filter(Boolean).join("–") || null);
}
