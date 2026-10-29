import type { GuardStore } from "../guard/store.ts";
import { readDirectReferrals } from "../rewards/ledger.ts";
import { listRankEvents } from "../rewards/rank-store.ts";
import type { NetworkRules } from "../rewards/network-rules.ts";
import type { RegistryRowLike } from "./pool-share.ts";
import { readLinkOpens } from "./link-opens.ts";
import { readPartnerEntries, readPartnerNetwork } from "./network-store.ts";
import { partnerPage, poolLabelKey, type MarketLabel, type PartnerPageView, type PartnerPayoutInputs } from "./partner-page.ts";
import { PARTNER_PAYOUT_MINIMUM_USD_MICROS, payoutSlotKey, payoutUnresolved, planPartnerPayout, readPayoutGate, readPayoutPause, readPayoutSlot, readReceipts } from "./partner-payout.ts";
import type { OwnLaunch } from "./partner-tracks.ts";
import { readActivation, walletHold } from "./review-store.ts";

/**
 * One wallet's «Creator partners» page, read: the partner's network as the
 * shadow ledger sums it, the activations of their pools, the people who
 * confirmed them as their inviter, the opens of their link, the tokens behind their pools and
 * their own launches as a creator.
 *
 * The launches live in the launch lane's store; this module reads them only
 * through `launchesOf`, which the caller supplies from the lane's own index
 * (the route reads it), so nothing here depends on how the lane keeps them —
 * a deployment without launches passes nothing and the page simply has no
 * names and no creator badges.
 */

/** A launch as this page needs it — the launch lane's record, read only. */
export type LaunchLike = Readonly<{ token: string; pool: string; name: string; symbol: string; creator: string; launchedAt: string; state: string; preset?: string }>;

/** The demo market is the team's technical check: it earns nobody anything and makes no creator's badge. */
const isDemo = (record: LaunchLike) => record.preset === "demo";

export type PartnerPageDeps = Readonly<{
  /** The Solana launches a creator made on this deployment (confirmed and pending), or none. */
  launchesOf: (creator: string) => Promise<readonly LaunchLike[]>;
}>;

export async function readPartnerPage(
  store: GuardStore,
  deps: PartnerPageDeps,
  args: Readonly<{
    wallet: string;
    referral: Readonly<{ code: string; link: string }> | null;
    now: string;
    history?: readonly NetworkRules[];
    registry?: readonly RegistryRowLike[];
    /** The free reward reserve, read by the caller from the chain; null — not readable; absent — not bounded. */
    freeReserveUsdMicros?: bigint | null;
  }>,
): Promise<PartnerPageView> {
  const [network, friends, opens, events, ownRecords] = await Promise.all([
    readPartnerNetwork(store, args.wallet, { now: args.now, history: args.history, registry: args.registry }),
    readDirectReferrals(store, args.wallet),
    args.referral ? readLinkOpens(store, args.referral.code) : Promise.resolve({ opens: 0, since: null }),
    listRankEvents(store, args.wallet),
    deps.launchesOf(args.wallet),
  ]);

  /* The activation of each pool this page names — the partner's and the wallet's own — and of no other. */
  const named: { network: "solana" | "arc"; pool: string }[] = [
    ...network.pools.map((pool) => ({ network: pool.network, pool: pool.pool })),
    ...ownRecords.map((record) => ({ network: "solana" as const, pool: record.pool })),
  ];
  const activatedAt = new Map<string, string>();
  const records = await Promise.all(named.map(({ network: chain, pool }) => readActivation(store, chain, pool).catch(() => null)));
  for (const record of records) if (record?.activatedAt) activatedAt.set(poolLabelKey(record.network, record.pool), record.activatedAt);

  /* The tokens behind the partner's Solana pools, one read per creator. */
  const labels = new Map<string, MarketLabel>();
  const creators = [...new Set(network.pools.filter((pool) => pool.network === "solana").map((pool) => pool.creator))];
  const byCreator = await Promise.all(creators.map((creator) => deps.launchesOf(creator).catch(() => [] as readonly LaunchLike[])));
  const wanted = new Set(network.pools.map((pool) => poolLabelKey(pool.network, pool.pool)));
  for (const record of byCreator.flat()) {
    const key = poolLabelKey("solana", record.pool);
    if (wanted.has(key)) labels.set(key, { token: record.token, name: record.name, symbol: record.symbol });
  }

  /* This wallet's own launches: confirmed only; graduated by the lane's own once-per-mint event. */
  const graduated = new Map<string, string>();
  for (const event of events) if (event.kind === "LAUNCH_GRADUATED" && event.wallet === args.wallet) graduated.set(event.ref, event.at);
  const ownLaunches: OwnLaunch[] = ownRecords
    .filter((record) => record.state === "LAUNCHED" && record.creator === args.wallet && !isDemo(record))
    .map((record) => ({
      launchedAt: record.launchedAt,
      activatedAt: activatedAt.get(poolLabelKey("solana", record.pool)) ?? null,
      graduatedAt: graduated.get(record.token) ?? null,
    }));

  /* Payouts: paid is the receipts; available is what a claim would take now, after a payout still deciding. */
  const [gate, pause, hold, slot, receipts, entries] = await Promise.all([
    readPayoutGate(store, "solana"),
    readPayoutPause(store, "solana"),
    walletHold(store, args.wallet, args.now),
    readPayoutSlot(store, payoutSlotKey("solana", args.wallet)),
    readReceipts(store, "solana", args.wallet),
    readPartnerEntries(store, args.wallet),
  ]);
  const own = receipts.filter((receipt) => receipt.kind === "PARTNER");
  const paidLines = [...own.flatMap((receipt) => receipt.lines), ...(slot && payoutUnresolved(slot) ? slot.lines : [])];
  const plan = planPartnerPayout({
    network: "solana",
    entries,
    pools: network.pools.map((pool) => ({ network: pool.network, pool: pool.pool, payable: pool.payable })),
    paid: paidLines,
    now: args.now,
    history: args.history,
  });
  const paidByPool = new Map<string, bigint>();
  for (const line of paidLines) {
    const key = poolLabelKey(line.network, line.pool);
    paidByPool.set(key, (paidByPool.get(key) ?? 0n) + BigInt(line.usdMicros));
  }
  const payout: PartnerPayoutInputs = {
    open: gate !== null,
    claimableUsdMicros: plan.claimableUsdMicros,
    ...(args.freeReserveUsdMicros !== undefined ? { freeReserveUsdMicros: args.freeReserveUsdMicros } : {}),
    hold,
    paused: pause.paused,
    minimumUsdMicros: PARTNER_PAYOUT_MINIMUM_USD_MICROS,
    debtUsdMicros: plan.debtUsdMicros,
    paidUsdMicros: own.reduce((sum, receipt) => sum + BigInt(receipt.usdMicros), 0n),
    paidByPool,
    slot: slot && slot.kind === "PARTNER" ? { state: slot.state, usdMicros: slot.usdMicros, signature: slot.signature } : null,
    receipts: own,
  };

  return partnerPage({ network, referral: args.referral, now: args.now, activations: activatedAt, friends, opens, labels, ownLaunches, history: args.history, payout });
}
