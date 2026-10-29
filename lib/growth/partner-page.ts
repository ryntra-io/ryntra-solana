import { maskWallet } from "../rewards/referral.ts";
import { NETWORK_RULES_HISTORY, networkRulesAt, type NetworkRules, type NetworkStep, type NetworkTier } from "../rewards/network-rules.ts";
import type { PartnerNetworkView, PartnerPoolView } from "./network-store.ts";
import type { PartnerNetwork } from "./partner.ts";
import {
  ambassadorTrack,
  creatorTrack,
  foundingBadge,
  partnerLevel,
  partnerTrack,
  type ActivatedCreator,
  type OwnLaunch,
  type PartnerLevelState,
  type TrackBadgeState,
} from "./partner-tracks.ts";

/**
 * «Creator partners» on Rewards — one wallet's page, assembled from what the
 * ledgers already hold. Nothing here computes money: the figures are the
 * partner's entries as `readPartnerNetwork` sums them; this module only
 * arranges them, counts the funnel and names the badges.
 *
 * ## What a partner sees, and what they never do
 *
 * Their level, code and link, how many creators they brought are activated,
 * what waits · what is available · what was paid, and the share a pool earns
 * now with the day its step ends. The funnel — opened, signed, launched,
 * earned — and one row per launch they are named on. Never a reason a pool is
 * held, never the team's wallets, never another person's full address.
 *
 * ## Paid
 *
 * Paid is the sum of the partner's receipts (`lib/growth/partner-payout.ts`),
 * never a figure of its own; available is what a payout would take now — net
 * of what was paid, of a payout still deciding and of any debt a reversal
 * after a payout left. Until the canary opens payouts, paid is zero and the
 * page says payouts are not open.
 */

export type MarketLabel = Readonly<{ token: string; name: string; symbol: string }>;

export type PartnerMarketRow = Readonly<{
  network: PartnerNetwork;
  pool: string;
  /** The token page, when the launch is known to this deployment; null otherwise. */
  token: string | null;
  name: string | null;
  symbol: string | null;
  creator: string;
  launchedAt: string;
  status: PartnerPoolView["status"];
  activated: boolean;
  data: PartnerPoolView["data"];
  shareBps: number;
  shareUntil: string | null;
  earnedUsdMicros: string;
  pendingUsdMicros: string;
  availableUsdMicros: string;
  heldUsdMicros: string;
  /** A pool the review holds or closed: its partner may write to the reviewer. */
  mayAppeal: boolean;
  /** The partner's question on it is still to be answered. */
  asked: boolean;
}>;

/**
 * The way from the link to revenue: the link opened; people signed in with a wallet
 * and chose this partner (everyone who confirmed them as their inviter, and every creator who launched with them);
 * creators launched with this partner as «Invited by»; and of those, creators whose market came alive (activated)
 * and brought a fee this partner's share was counted from. Steps two to four are each within the one before; opens
 * are counted only from `openedSince`, so the first may be the smaller.
 */
export type PartnerFunnel = Readonly<{
  /** Opens of the link, counted from `openedSince` (the first day one was counted). */
  opened: number;
  openedSince: string | null;
  /** People who signed in with a wallet and chose this partner. */
  signed: number;
  /** Creators who launched with this partner as «Invited by» (the demo market aside). */
  launched: number;
  /** Of them, creators activated whose fee this partner's share was counted from. */
  earned: number;
}>;

export type PartnerSchedule = Readonly<{
  version: string;
  tier: NetworkTier;
  steps: readonly NetworkStep[];
  foundingSeats: number;
  capBps: number;
  holdDays: number;
}>;

export type PartnerPageView = Readonly<{
  referral: Readonly<{ code: string; link: string }> | null;
  tier: NetworkTier;
  foundingSeat: number | null;
  level: PartnerLevelState;
  money: Readonly<{
    /** False — a pool's inputs are missing, so the sums may be short. */
    complete: boolean;
    earnedUsdMicros: string;
    pendingUsdMicros: string;
    availableUsdMicros: string;
    heldUsdMicros: string;
    paidUsdMicros: string;
    /** When the next share becomes available — only of pools that may pay (activated, not under review). */
    nextAvailableAt: string | null;
    /** Partner payouts are open: never before the first test payout. */
    payoutsOpen: boolean;
  }>;
  payout: PartnerPayoutView;
  /** The best share a pool earns now and when its step ends (null with several pools: each has its own date). */
  share: Readonly<{ bps: number; until: string | null; pools: number; nextEnd: string | null }> | null;
  schedule: PartnerSchedule;
  funnel: PartnerFunnel;
  markets: readonly PartnerMarketRow[];
  badges: Readonly<{
    partner: readonly TrackBadgeState[];
    founding: TrackBadgeState;
    creator: readonly TrackBadgeState[];
    ambassador: readonly TrackBadgeState[];
  }>;
}>;

export type ReceiptLineView = Readonly<{
  network: PartnerNetwork;
  pool: string;
  /** The token's symbol where the launch is known here. */
  symbol: string | null;
  rulesVersion: string;
  /** The claim Ryntra took the money out of the pool in, and the claim's place in it. */
  claimTx: string;
  claimIndex: string;
  usdMicros: string;
}>;

export type ReceiptView = Readonly<{ claimId: string; usdMicros: string; paidAt: string; signature: string; lines: readonly ReceiptLineView[] }>;

export type PartnerPayoutView = Readonly<{
  open: boolean;
  /** What a claim would pay now on Solana, before the reserve; the minimum to claim. */
  claimableUsdMicros: string;
  /** What «Get» pays now: the claimable within the reward reserve that is free — never a figure the reserve does not hold. */
  offerUsdMicros: string;
  /** The claimable the free reserve does not cover yet. */
  awaitingReserveUsdMicros: string;
  minimumUsdMicros: string;
  /** The review holds or stopped the partner's wallet: no payout is offered. */
  hold: "NONE" | "REVIEW" | "STOPPED";
  /** The owner paused partner payouts. */
  paused: boolean;
  /** What a reversal after a payout left owed back, netted on later payouts. */
  debtUsdMicros: string;
  /** Available on the other network, where payouts are not open yet. */
  elsewhereUsdMicros: string;
  /** The partner's payout still deciding or last decided. */
  slot: Readonly<{ state: "CLAIMING" | "SUBMITTED_UNKNOWN" | "PAID" | "FAILED"; usdMicros: string; signature: string | null }> | null;
  /** Newest first. */
  receipts: readonly ReceiptView[];
}>;

/** The payout side of the page, computed by the store from the receipts and the plan. */
export type PartnerPayoutInputs = Readonly<{
  open: boolean;
  claimableUsdMicros: bigint;
  /** The free reward reserve; null — it could not be read (nothing is offered); absent — not bounded (tests). */
  freeReserveUsdMicros?: bigint | null;
  hold?: "NONE" | "REVIEW" | "STOPPED";
  paused?: boolean;
  minimumUsdMicros: bigint;
  debtUsdMicros: bigint;
  paidUsdMicros: bigint;
  /** Paid of each pool, by `network:pool` — the receipts' lines and those of a payout still deciding. */
  paidByPool: ReadonlyMap<string, bigint>;
  slot: PartnerPayoutView["slot"];
  receipts: readonly Readonly<{ claimId: string; usdMicros: string; paidAt: string; signature: string; lines: readonly Readonly<{ network: PartnerNetwork; pool: string; rulesVersion: string; claim: Readonly<{ tx: string; index: string }>; usdMicros: string }>[] }>[];
}>;

const NO_PAYOUT: PartnerPayoutInputs = { open: false, claimableUsdMicros: 0n, minimumUsdMicros: 1_000_000n, debtUsdMicros: 0n, paidUsdMicros: 0n, paidByPool: new Map(), slot: null, receipts: [] };

export type PartnerPageInputs = Readonly<{
  network: PartnerNetworkView;
  referral: Readonly<{ code: string; link: string }> | null;
  now: string;
  /** When each of the partner's pools was activated, by `network:pool`; absent — not yet. */
  activations: ReadonlyMap<string, string>;
  opens: Readonly<{ opens: number; since: string | null }>;
  /** The token behind a pool, by `network:pool`, where the launch is known here. */
  labels: ReadonlyMap<string, MarketLabel>;
  /** Wallets that confirmed this partner as their inviter. */
  friends: ReadonlySet<string>;
  /** This wallet's own launches as a creator. */
  ownLaunches: readonly OwnLaunch[];
  history?: readonly NetworkRules[];
  /** Absent — no payout read: closed, nothing paid. */
  payout?: PartnerPayoutInputs;
}>;

export const poolLabelKey = (network: PartnerNetwork, pool: string): string => `${network}:${network === "arc" ? pool.toLowerCase() : pool}`;

/** A pool that counts toward the creator's activation: activated, and neither barred nor held by the review. */
function countsActivated(pool: PartnerPoolView): boolean {
  return pool.activated && (pool.status === "EARNING" || pool.status === "WAITING");
}

/** Creators counted once each, at the first activation among their launches. */
export function activatedCreators(pools: readonly PartnerPoolView[], activations: ReadonlyMap<string, string>): ActivatedCreator[] {
  const first = new Map<string, string>();
  for (const pool of pools) {
    if (!countsActivated(pool)) continue;
    const at = activations.get(poolLabelKey(pool.network, pool.pool));
    if (!at) continue;
    const key = `${pool.network === "arc" ? "evm" : "solana"}:${pool.network === "arc" ? pool.creator.toLowerCase() : pool.creator}`;
    const known = first.get(key);
    if (!known || at.localeCompare(known) < 0) first.set(key, at);
  }
  return [...first.entries()].map(([creator, at]) => ({ creator, at }));
}

const creatorKey = (pool: Pick<PartnerPoolView, "network" | "creator">) =>
  pool.network === "arc" ? `evm:${pool.creator.toLowerCase()}` : `solana:${pool.creator}`;

export function partnerFunnel(pools: readonly PartnerPoolView[], friends: ReadonlySet<string>, opens: PartnerPageInputs["opens"], partner?: string): PartnerFunnel {
  /* The partner's own launches are never a step of their own funnel. */
  const counted = pools.filter((pool) => pool.status !== "NOT_COUNTED" && pool.creator !== partner);
  const launched = new Set(counted.map(creatorKey));
  const signed = new Set([...launched, ...[...friends].map((wallet) => `solana:${wallet}`)]);
  const earned = new Set(counted.filter((pool) => countsActivated(pool) && BigInt(pool.earnedUsdMicros) > 0n).map(creatorKey));
  return { opened: opens.opens, openedSince: opens.since, signed: signed.size, launched: launched.size, earned: earned.size };
}

/** The best share an earning pool has now; its date only when it is the one pool that earns. */
export function bestShare(pools: readonly PartnerPoolView[]): PartnerPageView["share"] {
  const earning = pools.filter((pool) => pool.status === "EARNING" && pool.shareBps > 0);
  if (!earning.length) return null;
  const bps = Math.max(...earning.map((pool) => pool.shareBps));
  const nextEnd = earning.map((pool) => pool.shareUntil).filter((at): at is string => at !== null).sort((a, b) => a.localeCompare(b))[0] ?? null;
  return { bps, until: earning.length === 1 ? earning[0]!.shareUntil : null, pools: earning.length, nextEnd };
}

/** A pool's available less what was paid of it, never below zero (a debt is the page's, not a row's). */
const unpaid = (available: string, paid: bigint) => {
  const left = BigInt(available) - paid;
  return (left > 0n ? left : 0n).toString();
};

/** Pools whose figures the partner sees and whose shares may become payable: neither under review, closed nor a demo. */
const shown = (pool: PartnerPoolView) => pool.status === "EARNING" || pool.status === "WAITING";
const sumOf = (pools: readonly PartnerPoolView[], pick: (pool: PartnerPoolView) => string) => pools.reduce((total, pool) => total + BigInt(pick(pool)), 0n).toString();

export function partnerPage(inputs: PartnerPageInputs): PartnerPageView {
  const { network } = inputs;
  const payout = inputs.payout ?? NO_PAYOUT;
  /* What «Get» may take now: bounded by the free reserve exactly as cashback is, so the page never offers money the pot does not hold. */
  const free = payout.freeReserveUsdMicros;
  /* Bounded by the reserve, in whole cents — the offer and what waits add up to the claimable as the page shows them. */
  const offer = free === undefined ? payout.claimableUsdMicros : free === null ? 0n : payout.claimableUsdMicros < free ? payout.claimableUsdMicros : free - (free % 10_000n);
  const rules = networkRulesAt(inputs.now, inputs.history ?? NETWORK_RULES_HISTORY);
  const tier: NetworkTier = network.founding ? "FOUNDING" : "STANDARD";
  const creators = activatedCreators(network.pools, inputs.activations);
  const open = network.pools.filter(shown);
  const nextAvailable = open
    .filter((pool) => pool.activated && BigInt(pool.heldUsdMicros) === 0n)
    .map((pool) => pool.nextAvailableAt)
    .filter((at): at is string => at !== null)
    .sort((a, b) => a.localeCompare(b))[0] ?? null;
  /* Available where payouts are not open yet: shown, never claimable. */
  const elsewhere = BigInt(sumOf(open.filter((pool) => pool.network !== "solana"), (pool) => pool.availableUsdMicros));
  const markets: PartnerMarketRow[] = network.pools.map((pool) => {
    const label = inputs.labels.get(poolLabelKey(pool.network, pool.pool)) ?? null;
    /* A pool under review, closed or a demo says its state and nothing else — no figure that could tell one from another. */
    const quiet = !shown(pool);
    return {
      network: pool.network,
      pool: pool.pool,
      token: label?.token ?? null,
      name: label?.name ?? null,
      symbol: label?.symbol ?? null,
      creator: maskWallet(pool.creator),
      launchedAt: pool.launchedAt,
      status: pool.status,
      activated: quiet ? false : pool.activated,
      data: quiet ? "OK" : pool.data,
      shareBps: quiet ? 0 : pool.shareBps,
      shareUntil: quiet ? null : pool.shareUntil,
      earnedUsdMicros: quiet ? "0" : pool.earnedUsdMicros,
      pendingUsdMicros: quiet ? "0" : pool.pendingUsdMicros,
      availableUsdMicros: quiet ? "0" : unpaid(pool.availableUsdMicros, payout.paidByPool.get(poolLabelKey(pool.network, pool.pool)) ?? 0n),
      heldUsdMicros: quiet ? "0" : pool.heldUsdMicros,
      mayAppeal: pool.status === "REVIEW" || pool.status === "BLOCKED",
      asked: (pool.status === "REVIEW" || pool.status === "BLOCKED") && pool.asked,
    };
  });
  return {
    referral: inputs.referral,
    tier,
    foundingSeat: network.founding?.seat ?? null,
    level: partnerLevel(creators.length),
    money: {
      /* Whole when every pool in these sums is: a demo or a pool under review is not in them. */
      complete: open.every((pool) => pool.data === "OK"),
      earnedUsdMicros: sumOf(open, (pool) => pool.earnedUsdMicros),
      pendingUsdMicros: sumOf(open, (pool) => pool.pendingUsdMicros),
      /* Solana's claimable, net of what was paid and of debts, and the other network's, where nothing is paid yet. */
      /* Before the canary nothing is paid and the shadow ledger shows everything; once payouts are open, what «Get» pays. */
      availableUsdMicros: ((payout.open ? offer : payout.claimableUsdMicros) + elsewhere).toString(),
      heldUsdMicros: sumOf(open, (pool) => pool.heldUsdMicros),
      paidUsdMicros: payout.paidUsdMicros.toString(),
      nextAvailableAt: nextAvailable,
      payoutsOpen: payout.open,
    },
    payout: {
      open: payout.open,
      claimableUsdMicros: payout.claimableUsdMicros.toString(),
      offerUsdMicros: offer.toString(),
      awaitingReserveUsdMicros: (payout.claimableUsdMicros - offer).toString(),
      minimumUsdMicros: payout.minimumUsdMicros.toString(),
      hold: payout.hold ?? "NONE",
      paused: payout.paused ?? false,
      debtUsdMicros: payout.debtUsdMicros.toString(),
      elsewhereUsdMicros: elsewhere.toString(),
      slot: payout.slot,
      receipts: [...payout.receipts]
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        .map((receipt) => ({
          claimId: receipt.claimId,
          usdMicros: receipt.usdMicros,
          paidAt: receipt.paidAt,
          signature: receipt.signature,
          lines: receipt.lines.map((line) => ({
            network: line.network,
            pool: line.pool,
            symbol: inputs.labels.get(poolLabelKey(line.network, line.pool))?.symbol ?? null,
            rulesVersion: line.rulesVersion,
            claimTx: line.claim.tx,
            claimIndex: line.claim.index,
            usdMicros: line.usdMicros,
          })),
        })),
    },
    share: bestShare(network.pools),
    schedule: { version: rules.version, tier, steps: rules.schedules[tier], foundingSeats: rules.foundingSeats, capBps: rules.poolCapBps, holdDays: rules.holdDays },
    funnel: partnerFunnel(network.pools, inputs.friends, inputs.opens, network.partner),
    markets,
    badges: {
      partner: partnerTrack(creators),
      founding: foundingBadge(network.founding),
      creator: creatorTrack(inputs.ownLaunches),
      ambassador: ambassadorTrack(),
    },
  };
}
