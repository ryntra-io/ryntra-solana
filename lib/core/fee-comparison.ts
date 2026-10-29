/**
 * What a $100 trade costs through Ryntra against the direct route, and against Pump.fun, GMGN, Axiom and Jupiter —
 * every figure with its source and the day it was read (SOL-X1).
 *
 * Ryntra's own figures are read from the code that charges them (`FEE_POLICY_V2`, the Rewards rules in force), so a
 * rate cannot drift from this page. Another venue's figure is a quotation: its source, whether that source is the
 * venue's own documentation or someone quoting it, and the day this session read it. The session that read them
 * (21.10.2026) could not open the venues' own pages from its network — every figure below came through a search of
 * the web, and the kind says so. Published inside the product only.
 *
 * «Interface fee» is what an interface adds on top of the pool's own fee. Pump.fun's row is the venue itself: its fee
 * is the pool's, paid through any interface that trades there (Ryntra's Spot included, on top of Ryntra's).
 *
 * Pure and client-safe.
 */

import { FEE_POLICY_V2, FEE_POLICY_VERSION, ORDER_REFERRAL_PROVIDER_PERCENT, type FeeFlow } from "./fee-policy.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS } from "./venues/meteora-dbc/presets.ts";
import { REWARD_RULES_CURRENT } from "../rewards/rules.ts";

/* ------------------------------------------------------------------ a launch's pool fee */

/**
 * The volatility fee Meteora's programs add on top of a base fee, as a share of it: the DBC SDK's
 * `getDynamicFeeParams` sets it to 20 % of the base fee (`@meteora-ag/dynamic-bonding-curve-sdk`), so a 1 % curve
 * fee reads «1 % + up to 0.2 %» (audit/2026-10/solana-launch/README.md §4.1).
 */
export const DYNAMIC_FEE_SHARE_OF_BASE = 0.2;

/**
 * The fee a Ryntra launch's own pool charges every trader, from the presets a person may pick (`PEOPLE_PRESET_IDS`),
 * basis points — the same through any interface, with Ryntra's part inside it, never on top:
 * - `curve` — the curve's base fee once the sniper window has passed, and with the volatility fee at its most;
 * - `sniperStartBps` — the highest fee of the first minutes on the curve, falling to the curve's base;
 * - `pool` — the DAMM v2 pool after the move to the DEX, falling with market cap from its start to its end by preset (a
 *   volatility fee rides on it too);
 * - `range` — the lowest and the highest base fee a trade after the sniper window pays, curve or pool.
 */
export type LaunchPoolFee = Readonly<{
  curve: Readonly<{ baseBps: number; withDynamicBps: number }>;
  sniperStartBps: number;
  /** The longest the sniper window lasts on these presets, seconds. */
  sniperSeconds: number;
  pool: Readonly<{ startBps: number; endLowBps: number; endHighBps: number }>;
  range: Readonly<{ low: number; high: number }>;
}>;

export function launchPoolFee(): LaunchPoolFee {
  const presets = PEOPLE_PRESET_IDS.map((id) => LAUNCH_PRESETS[id]);
  const curveBase = Math.max(...presets.map((preset) => preset.sniperFee.endBps));
  const curveLow = Math.min(...presets.map((preset) => preset.sniperFee.endBps));
  const poolStart = Math.max(...presets.map((preset) => preset.graduatedPool.startFeeBps));
  const poolEnd = Math.min(...presets.map((preset) => preset.graduatedPool.endFeeBps));
  return {
    curve: { baseBps: curveBase, withDynamicBps: Math.round(curveBase * (1 + DYNAMIC_FEE_SHARE_OF_BASE)) },
    sniperStartBps: Math.max(...presets.map((preset) => preset.sniperFee.startBps)),
    sniperSeconds: Math.max(...presets.map((preset) => preset.sniperFee.seconds)),
    pool: { startBps: poolStart, endLowBps: poolEnd, endHighBps: Math.max(...presets.map((preset) => preset.graduatedPool.endFeeBps)) },
    range: { low: Math.min(curveLow, poolEnd), high: Math.max(curveBase, poolStart) },
  };
}

/* ------------------------------------------------------------------ $100 */

export const TRADE_USD = 100;

/** A fee of `bps` on a $100 buy, a $100 sale, and the round trip — buying $100 and selling all of it — in dollars. */
export type OnHundred = Readonly<{ buy: number; sell: number; round: number }>;

export function onHundred(bps: number): OnHundred {
  const rate = bps / 10_000;
  return { buy: TRADE_USD * rate, sell: TRADE_USD * rate, round: TRADE_USD * (1 - (1 - rate) ** 2) };
}

/** The share of Ryntra's fee that comes back as cashback on a lane: of what Ryntra received — all of it on `/build`, 80 % on `/order`. */
export function cashbackShareOfFee(lane: "BUILD" | "ORDER"): number {
  const ofReceived = REWARD_RULES_CURRENT.cashbackBps / 10_000;
  return lane === "BUILD" ? ofReceived : ofReceived * ((100 - ORDER_REFERRAL_PROVIDER_PERCENT) / 100);
}

/** One row of Ryntra's own table: a flow, its rate, and what it costs on $100 before and after the cashback. */
export type RyntraFlowRow = Readonly<{
  flow: FeeFlow | "LAUNCH_PAGE";
  bps: number;
  lane: "BUILD" | "ORDER" | "LAUNCH";
  /** Less than the direct route by this much — the fee itself; the pool's fee and the price move are the same both ways. */
  fee: OnHundred;
  cashback: OnHundred;
  net: OnHundred;
  /**
   * A launch's own pool fee, which every trader pays through any interface — Ryntra's part inside it, never on top —
   * as a base-fee range in basis points and in dollars on $100 at its low and its high; null on a swap, whose pool fees
   * are inside the route's price.
   */
  pool: Readonly<{ bps: Readonly<{ low: number; high: number }>; low: OnHundred; high: OnHundred }> | null;
}>;

const scale = (value: OnHundred, by: number): OnHundred => ({ buy: value.buy * by, sell: value.sell * by, round: value.round * by });
const less = (left: OnHundred, right: OnHundred): OnHundred => ({ buy: left.buy - right.buy, sell: left.sell - right.sell, round: left.round - right.round });

/** The flows the table shows, in the order a person meets them. PRESTOCK and AS_NOW share ONDO's rate and lane. */
export const SHOWN_FLOWS: readonly FeeFlow[] = ["MEME", "TRENDING", "MAJOR", "STABLE", "XSTOCK", "ONDO"];

export function ryntraFlowRows(): readonly RyntraFlowRow[] {
  const rows: RyntraFlowRow[] = SHOWN_FLOWS.map((flow) => {
    const rule = FEE_POLICY_V2[flow];
    const fee = onHundred(rule.bps);
    const cashback = scale(fee, rule.bps > 0 ? cashbackShareOfFee(rule.lane) : 0);
    return { flow, bps: rule.bps, lane: rule.lane, fee, cashback, net: less(fee, cashback), pool: null };
  });
  /* A Ryntra launch from its own token page: nothing on top of the pool; the curve's or the pool's fee — Ryntra's part
     inside it — is paid the same through any interface, and the row shows it. */
  const zero = onHundred(0);
  const pool = launchPoolFee().range;
  rows.push({ flow: "LAUNCH_PAGE", bps: 0, lane: "LAUNCH", fee: zero, cashback: zero, net: zero, pool: { bps: pool, low: onHundred(pool.low), high: onHundred(pool.high) } });
  return rows;
}

/* ------------------------------------------------------------------ the network */

/** Solana's base fee per signature, lamports — the protocol's constant. */
export const BASE_FEE_LAMPORTS = 5_000;
/** The most priority a `/build` swap asks for (`PRIORITY_FEE_CEILING_LAMPORTS`, lib/solana/jupiter-build.ts — held equal by the test). */
export const BUILD_PRIORITY_CEILING_LAMPORTS = 300_000;

/* ------------------------------------------------------------------ other venues */

export type FeeSourceKind = "CODE" | "OFFICIAL" | "SECONDARY";

export type FeeSource = Readonly<{
  /** A person's name for the source — never a file path; Ryntra's own the page names in the reader's language (`own`). */
  label: string;
  /** Ryntra's own source; null for another venue's. */
  own: "FEE_POLICY" | "REWARDS_RULES" | "LAUNCH_CONFIG" | null;
  /** The version the figure is read at, where the source has one. */
  version: string | null;
  url: string | null;
  kind: FeeSourceKind;
  /** The day the figure was read, ISO date. */
  readAt: string;
  /** How it was read: from Ryntra's own code, from the venue's own documentation, or through a web search (the venue's own page could not be opened). */
  via: "CODE" | "DOCS" | "SEARCH";
}>;

export type VenueRow = Readonly<{
  id: "ryntra-spot" | "ryntra-launch" | "jupiter" | "pump-fun" | "gmgn" | "axiom";
  name: string;
  /** What the interface adds on top of the pool, basis points, at the figure the row quotes; a range as low–high. */
  interfaceBps: Readonly<{ low: number; high: number }>;
  /** After the venue's own rebate (Ryntra's cashback, Axiom's SOL cashback tiers); null where it names none. */
  netBps: Readonly<{ low: number; high: number }> | null;
  /** The venue's own pool fee where the row is a venue rather than an interface. */
  poolBps: Readonly<{ low: number; high: number }> | null;
  noteKey: "ryntraSpot" | "ryntraLaunch" | "jupiter" | "pumpFun" | "gmgn" | "axiom";
  sources: readonly FeeSource[];
}>;

const READ_AT = "2026-10-21";
const CODE: FeeSource = { label: `Ryntra fee policy v${FEE_POLICY_VERSION}`, own: "FEE_POLICY", version: FEE_POLICY_VERSION, url: null, kind: "CODE", readAt: READ_AT, via: "CODE" };
const RULES: FeeSource = { label: `Rewards rules ${REWARD_RULES_CURRENT.version}`, own: "REWARDS_RULES", version: REWARD_RULES_CURRENT.version, url: null, kind: "CODE", readAt: READ_AT, via: "CODE" };
const LAUNCH_CONFIG: FeeSource = { label: "Ryntra launch config", own: "LAUNCH_CONFIG", version: null, url: null, kind: "CODE", readAt: READ_AT, via: "CODE" };
const venueSource = (label: string, url: string, kind: "OFFICIAL" | "SECONDARY", via: "DOCS" | "SEARCH"): FeeSource => ({ label, own: null, version: null, url, kind, readAt: READ_AT, via });

const memeNet = FEE_POLICY_V2.MEME.bps * (1 - cashbackShareOfFee("BUILD"));

export const VENUES: readonly VenueRow[] = [
  {
    id: "ryntra-spot",
    name: "Ryntra · Spot",
    interfaceBps: { low: FEE_POLICY_V2.MAJOR.bps, high: FEE_POLICY_V2.MEME.bps },
    netBps: { low: FEE_POLICY_V2.MAJOR.bps * (1 - cashbackShareOfFee("BUILD")), high: memeNet },
    poolBps: null,
    noteKey: "ryntraSpot",
    sources: [CODE, RULES],
  },
  {
    id: "ryntra-launch",
    name: "Ryntra · Launch token page",
    interfaceBps: { low: 0, high: 0 },
    netBps: null,
    /* The launch's own pool fee, paid by every trader there; Ryntra's part is inside it. */
    poolBps: launchPoolFee().range,
    noteKey: "ryntraLaunch",
    sources: [LAUNCH_CONFIG],
  },
  {
    id: "jupiter",
    name: "Jupiter API (/order)",
    interfaceBps: { low: 0, high: 50 },
    netBps: null,
    poolBps: null,
    noteKey: "jupiter",
    sources: [venueSource("developers.jup.ag — Swap API, /order fees", "https://developers.jup.ag/docs/swap/order-and-execute#fees", "OFFICIAL", "DOCS")],
  },
  {
    id: "pump-fun",
    name: "Pump.fun",
    interfaceBps: { low: 0, high: 0 },
    netBps: null,
    poolBps: { low: 30, high: 125 },
    noteKey: "pumpFun",
    sources: [
      venueSource("CoinPaprika — Launchpad fees", "https://coinpaprika.com/education/launchpad-fees/", "SECONDARY", "SEARCH"),
      venueSource("BloFin Academy — Pump.fun fees", "https://blofin.com/en/academy/education/pumpfun/pump-fun-fees-explained", "SECONDARY", "SEARCH"),
    ],
  },
  {
    id: "gmgn",
    name: "GMGN",
    interfaceBps: { low: 100, high: 100 },
    netBps: null,
    poolBps: null,
    noteKey: "gmgn",
    sources: [venueSource("DefiLlama — GMGN methodology", "https://defillama.com/protocol/gmgn", "SECONDARY", "SEARCH")],
  },
  {
    id: "axiom",
    name: "Axiom",
    interfaceBps: { low: 100, high: 100 },
    netBps: { low: 75, high: 95 },
    poolBps: null,
    noteKey: "axiom",
    sources: [
      venueSource("The Block — Axiom revenue", "https://www.theblock.co/post/355676/axiom-exchange-hits-100-million-in-revenue-just-four-months-after-launch", "SECONDARY", "SEARCH"),
      venueSource("Axiompedia — fees and cashback tiers", "https://axiompedia.com/guides/fees", "SECONDARY", "SEARCH"),
    ],
  },
];
