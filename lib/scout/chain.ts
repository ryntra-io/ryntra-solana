/**
 * The chain's facts of a coin that passed the free screen: its rights, who really holds it, how it was born and what its
 * creator did — each read from the chain, never a verdict.
 *
 * - **Rights** — the mint account itself (our market-data gateway, `lib/solana/risk-facts.ts`); where the gateway did
 *   not answer, the list's audit; where neither stated it, not read.
 * - **Real holders** — the gateway's shares over plain accounts: the curve, pools, other programs' accounts and the burn
 *   address left out, so the curve holding most of a young coin is not taken for a whale. Where the gateway did not
 *   answer in time, the coin page's own holders read stands in (`lib/spot/token-page.server.ts` `readTokenHolders`): the
 *   twenty largest accounts, merged by owner, with every owner off the curve — a pool, the curve, a lock, a program —
 *   left out the same way; it is never complete, and says so.
 * - **Birth** — the coin's earliest trades from the chain's events (`lib/spot/token-events.server.ts`), counted by the
 *   launch flow's own rule for same-block bundles (`lib/launch/flow/flow.ts` `sameSlotBundles`), for any coin, not only
 *   a launch on Ryntra. The events carry the block's time, not its number, so one second stands for one block: the
 *   coin's first second is its launch block. Read only where the read reached the coin's first trade.
 * - **The creator** — the wallet the list or the gateway names: what it holds now and whether it sold.
 *
 * Whatever was not read stays not read: a refusal names it, a fact is never defaulted to zero.
 *
 * Pure. Relative imports only. Server-side by the launch flow's imports.
 */

import type { LaunchTrade } from "../core/venues/meteora-dbc/market.ts";
import { sameSlotBundles } from "../launch/flow/flow.ts";
import type { Clusters } from "../launch/flow/clusters.ts";
import type { TokenRiskReading } from "../solana/risk-facts.ts";
import type { TokenHolder, TokenTrade } from "../spot/token-page.ts";
import type { ScoutCandidate } from "./feed.ts";
import { SCOUT_CHAIN } from "./rules.ts";

export type Right = "off" | "on" | "unread";

export type ChainFacts = Readonly<{
  rights: Readonly<{ mint: Right; freeze: Right }>;
  /** The real holders' shares, per cent; null — not read. `complete`: over every account of the coin, not only the largest. */
  holders: Readonly<{ top1Pct: number; top10Pct: number; complete: boolean }> | null;
  /** The creator's share now, per cent; null — not read. */
  creatorPct: number | null;
  /** The coin's birth; null — the read did not reach its first trade. */
  birth: Readonly<{
    /** Wallets besides the creator that bought in the coin's first second. */
    launchBuyers: number;
    /** Same-second groups tied by one payer or one transaction, the first second included. */
    bundles: number;
    /** Wallets in those groups. */
    bundledWallets: number;
  }> | null;
  /** The creator sold some of the coin in the trades read; null — no creator named, or no trades read. */
  creatorSold: boolean | null;
}>;

/** The facts first, in the order a person reads them; a fact not read comes last — it is no reason by itself. */
export const CHAIN_CODES = ["mint_on", "freeze_on", "top1", "top10", "launch_buyers", "bundles", "creator_share", "creator_gone", "rights_unread", "holders_unread"] as const;
export type ChainCode = (typeof CHAIN_CODES)[number];

export type ChainInput = Readonly<{
  candidate: ScoutCandidate;
  /** The gateway's reading; null — not asked. */
  risk: TokenRiskReading | null;
  /** The coin's trades from the chain's events, newest first; `whole` — the read reached the coin's first trade. Null — not read. */
  trades: Readonly<{ trades: readonly TokenTrade[]; whole: boolean }> | null;
  /** The coin page's largest holders, read only where the gateway gave no holders; null or absent — not read. */
  holders?: readonly TokenHolder[] | null;
}>;

const pct = (share: string): number => {
  const value = Number(share);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value * 100)) : Number.NaN;
};

/** The burn address: what lies there is held by no one. */
const BURN_ADDRESS = "1nc1nerator11111111111111111111111111111111";

/**
 * The real holders from the coin page's list of its largest holders: every owner a program holds for (a pool, the curve,
 * a lock, a vault) and the burn address left out, as the gateway leaves them out. Null where no share was read.
 */
export function holdersFromList(list: readonly TokenHolder[] | null | undefined): ChainFacts["holders"] {
  if (!list || list.length === 0) return null;
  const shares: number[] = [];
  for (const holder of list) {
    if (holder.owner === BURN_ADDRESS || holder.labels.includes("pool") || holder.labels.includes("program")) continue;
    if (holder.sharePct === null || !Number.isFinite(holder.sharePct)) return null;
    shares.push(Math.max(0, Math.min(100, holder.sharePct)));
  }
  if (shares.length === 0) return null;
  shares.sort((a, b) => b - a);
  const top10 = Math.min(100, shares.slice(0, 10).reduce((sum, share) => sum + share, 0));
  return { top1Pct: shares[0] as number, top10Pct: top10, complete: false };
}

/** No funding graph is read for a coin that is not ours: each wallet stands for itself, ties are the payer and the transaction. */
const ALONE: Clusters = { clusterOf: (wallet) => wallet, traced: () => true, standing: () => "independent" };

/** The coin's trades, oldest first, as the launch flow's rules read a trade — one second for one block. */
export function launchTradesOf(trades: readonly TokenTrade[]): LaunchTrade[] {
  const out: LaunchTrade[] = [];
  for (const trade of trades) {
    const at = Math.floor(Date.parse(trade.at) / 1000);
    if (!Number.isFinite(at)) continue;
    out.push({
      signature: trade.signature,
      slot: at,
      at,
      side: trade.side,
      venue: "curve",
      trader: trade.wallet,
      payer: trade.wallet,
      account: null,
      tokensRaw: "0",
      pairRaw: "0",
      feeRaw: "0",
      /* The bundle rule reads the block, the wallet and the payer only; the amounts stay unread here. */
      priceAfter: trade.priceUsd ?? 0,
    });
  }
  return out.sort((a, b) => a.at - b.at || a.signature.localeCompare(b.signature));
}

/** The coin's birth from its earliest trades; null — the read did not reach its first trade. */
export function birthOf(trades: Readonly<{ trades: readonly TokenTrade[]; whole: boolean }> | null, creator: string | null): ChainFacts["birth"] {
  if (!trades || !trades.whole || trades.trades.length === 0) return null;
  const launch = launchTradesOf(trades.trades);
  const first = launch[0];
  if (!first) return null;
  const groups = sameSlotBundles({ trades: launch, creator: creator ?? "", own: new Set(), created: { slot: first.slot, at: first.at }, clusters: ALONE });
  const launchGroup = groups.find((group) => group.slot === first.slot);
  const bundled = new Set<string>();
  let bundles = 0;
  for (const group of groups) {
    /* The first second is a group by itself; any other second only when its wallets are tied. */
    if (group.slot !== first.slot && group.why.length === 0) continue;
    bundles += 1;
    for (const wallet of group.wallets) bundled.add(wallet);
  }
  return { launchBuyers: launchGroup?.wallets.length ?? 0, bundles, bundledWallets: bundled.size };
}

export function chainFactsOf(input: ChainInput): ChainFacts {
  const { candidate } = input;
  const read = input.risk?.state === "READ" ? input.risk.facts : null;
  const fromList = (off: boolean | null): Right => (off === true ? "off" : off === false ? "on" : "unread");
  const mintAccount = read?.mint_account ?? null;
  const rights = mintAccount
    ? { mint: (mintAccount.mint_authority === null ? "off" : "on") as Right, freeze: (mintAccount.freeze_authority === null ? "off" : "on") as Right }
    : { mint: fromList(candidate.audit.mintOff), freeze: fromList(candidate.audit.freezeOff) };
  const plain = read?.holders?.concentration_plain_accounts ?? null;
  const top1 = plain ? pct(plain.top1) : Number.NaN;
  const top10 = plain ? pct(plain.top10) : Number.NaN;
  const holders = plain && Number.isFinite(top1) && Number.isFinite(top10) ? { top1Pct: top1, top10Pct: top10, complete: plain.complete } : holdersFromList(input.holders);
  const creatorShare = read?.creator_holds ? pct(read.creator_holds.share) : Number.NaN;
  const creatorPct = Number.isFinite(creatorShare) ? creatorShare : candidate.audit.devPct;
  const creator = candidate.creator.wallet ?? read?.origin.creator?.address ?? null;
  const creatorSold = creator && input.trades ? input.trades.trades.some((trade) => trade.side === "sell" && trade.wallet === creator) : null;
  return { rights, holders, creatorPct, birth: birthOf(input.trades, creator), creatorSold };
}

/** Every chain bar the coin fails; empty — it passes. A fact not read refuses only where the Scout cannot do without it. */
export function chainRefusals(facts: ChainFacts, rules: typeof SCOUT_CHAIN = SCOUT_CHAIN): ChainCode[] {
  const out: ChainCode[] = [];
  if (facts.rights.mint === "on") out.push("mint_on");
  if (facts.rights.freeze === "on") out.push("freeze_on");
  if (facts.holders) {
    if (facts.holders.top1Pct > rules.maxTop1Pct) out.push("top1");
    if (facts.holders.top10Pct > rules.maxTop10Pct) out.push("top10");
  }
  /* The birth is judged where it was read; where it was not, the thesis and the person are told so. */
  if (facts.birth) {
    if (facts.birth.launchBuyers > rules.maxLaunchBuyers) out.push("launch_buyers");
    if (facts.birth.bundledWallets > rules.maxBundledWallets) out.push("bundles");
  }
  if (facts.creatorPct !== null && facts.creatorPct > rules.maxCreatorPct) out.push("creator_share");
  if (facts.creatorSold === true && facts.creatorPct !== null && facts.creatorPct < rules.creatorGonePct) out.push("creator_gone");
  /* What was not read last: a coin left out for a fact is said by that fact, not by the read that failed. */
  if (facts.rights.mint === "unread" || facts.rights.freeze === "unread") out.push("rights_unread");
  if (!facts.holders) out.push("holders_unread");
  return out;
}
