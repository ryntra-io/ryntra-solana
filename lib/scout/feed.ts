/**
 * The Scout's feed: every new coin the market's «New» feed reads, as the Scout judges it. The rows are the same
 * Jupiter Tokens V2 lists the market's «New» column reads (`SCOUT_LISTS`, the very paths and the same shared cache of
 * `readJupiterList`), so the Scout adds no read of its own while the market is open. A row carries what the list states:
 * the four windows with buys, sells, traders and organic buyers, the audit (the mint and freeze rights, the top holders,
 * the creator's share, the list's own «suspicious» flag), the organic score and the creator's history.
 *
 * Pure. Relative imports only: `node --test` imports this module directly.
 */

import { normalizeSpotMarket } from "../spot/markets.ts";
import { borrowedNameOf, graduatedOf, launchpadName, passesForOf } from "../spot/pulse.ts";
import { tokenFactsOf } from "../spot/token-page.ts";

/** Jupiter's lists the Scout reads: the market's «New» feed's own, in its order. */
export const SCOUT_LISTS = ["/recent", "/toptrending/1h?limit=100", "/toptraded/1h?limit=100"] as const;

export type ScoutWindow = Readonly<{
  changePct: number | null;
  volumeUsd: number | null;
  buyVolumeUsd: number | null;
  sellVolumeUsd: number | null;
  buys: number | null;
  sells: number | null;
  traders: number | null;
  /** Buyers the list counts as organic — real wallets rather than bots. */
  organicBuyers: number | null;
}>;

export type ScoutAudit = Readonly<{
  /** The mint right is off (no one can make more of the coin); null — not stated. */
  mintOff: boolean | null;
  /** The freeze right is off (no one can freeze a holder's coins); null — not stated. */
  freezeOff: boolean | null;
  /** The list's own top holders' share, per cent; it may count the curve and the pool — the chain step counts real holders. */
  topHoldersPct: number | null;
  devPct: number | null;
  /** The list flagged the coin as suspicious. */
  suspicious: boolean;
}>;

export type ScoutCandidate = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  icon: string | null;
  launchpad: string | null;
  graduated: boolean;
  price: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  firstPoolAt: string | null;
  windows: Readonly<{ m5: ScoutWindow; h1: ScoutWindow; h6: ScoutWindow; h24: ScoutWindow }>;
  organicScore: number | null;
  verified: boolean;
  /** A tokenized stock: it has its own place, the Scout does not trade it. */
  stock: boolean;
  audit: ScoutAudit;
  creator: Readonly<{ wallet: string | null; launches: number | null; graduated: number | null }>;
  /** The stock ticker or the known name this coin borrows and is not; null — it borrows none. */
  borrows: string | null;
}>;

const EMPTY: ScoutWindow = { changePct: null, volumeUsd: null, buyVolumeUsd: null, sellVolumeUsd: null, buys: null, sells: null, traders: null, organicBuyers: null };

const finite = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function organicBuyersOf(raw: unknown, key: string): number | null {
  if (!raw || typeof raw !== "object") return null;
  const stats = (raw as Record<string, unknown>)[key];
  return stats && typeof stats === "object" ? finite((stats as Record<string, unknown>).numOrganicBuyers) : null;
}

/** One Jupiter Tokens V2 row → one candidate, or null when the row names no coin. */
export function candidateOf(raw: unknown): ScoutCandidate | null {
  const market = normalizeSpotMarket(raw);
  const facts = tokenFactsOf(raw);
  if (!market || !facts) return null;
  const windowOf = (key: "m5" | "h1" | "h6" | "h24", rawKey: string): ScoutWindow => {
    const window = facts.windows[key];
    if (!window) return EMPTY;
    return {
      changePct: window.priceChangePct,
      volumeUsd: window.volumeUsd,
      buyVolumeUsd: window.buyVolumeUsd,
      sellVolumeUsd: window.sellVolumeUsd,
      buys: window.buys,
      sells: window.sells,
      traders: window.traders,
      organicBuyers: organicBuyersOf(raw, rawKey),
    };
  };
  const stockTicker = passesForOf({ symbol: market.symbol, name: market.name, mint: market.mint, verified: market.verified })?.ticker ?? null;
  const borrowed = borrowedNameOf({ name: market.name, symbol: market.symbol, verified: market.verified, ryntra: null });
  return {
    mint: market.mint,
    symbol: market.symbol,
    name: market.name,
    icon: market.icon,
    launchpad: launchpadName(facts.launchpad),
    graduated: graduatedOf(raw),
    price: market.price,
    marketCapUsd: market.marketCapUsd,
    liquidityUsd: market.liquidityUsd,
    holders: market.holders,
    firstPoolAt: market.firstPoolAt,
    windows: { m5: windowOf("m5", "stats5m"), h1: windowOf("h1", "stats1h"), h6: windowOf("h6", "stats6h"), h24: windowOf("h24", "stats24h") },
    organicScore: market.organicScore,
    verified: market.verified,
    stock: market.category === "stock",
    audit: {
      mintOff: market.audit.mintAuthorityDisabled,
      freezeOff: market.audit.freezeAuthorityDisabled,
      topHoldersPct: market.audit.topHoldersPct,
      devPct: market.audit.devBalancePct,
      suspicious: market.audit.suspicious,
    },
    creator: { wallet: facts.dev, launches: facts.devMints, graduated: facts.devMigrations },
    borrows: stockTicker ?? borrowed,
  };
}

/** Every list's rows → the candidates, each coin once, in the lists' own order (the first list leads). */
export function candidatesOf(lists: readonly (readonly unknown[])[]): ScoutCandidate[] {
  const seen = new Set<string>();
  const out: ScoutCandidate[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const candidate = candidateOf(raw);
      if (!candidate || seen.has(candidate.mint)) continue;
      seen.add(candidate.mint);
      out.push(candidate);
    }
  }
  return out;
}

/** Minutes on the market from the first pool; null where the first pool is not stated. */
export function ageMinOf(candidate: Pick<ScoutCandidate, "firstPoolAt">, now: number): number | null {
  const born = Date.parse(candidate.firstPoolAt ?? "");
  if (!Number.isFinite(born)) return null;
  return Math.max(0, (now - born) / 60_000);
}
