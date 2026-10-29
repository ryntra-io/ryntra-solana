/**
 * What a buy costs, line by line, as the Review states it — and whether the
 * route is cheaper than buying the same contracts on the single best venue.
 *
 * Every line is a figure the route states (`feeBreakdown`, the fills, each
 * venue's own quote), except Ryntra's own fee: that is Ryntra's rate on the
 * contracts bought, and when the provider charged it the provider's own figure
 * wins. A line the route does not state is `null` — the surface says so — and
 * is never counted as zero.
 *
 * The saving line is the one claim here that compares, so it is built to be
 * true or absent: the route's whole cost *with* Ryntra's fee, against the
 * least the same number of contracts can cost on one venue alone — that
 * venue's own price levels walked cheapest first, before any of its fees.
 * Given the same budget, a dearer venue stops short of the route's contracts;
 * when it stopped because the budget ran out, the contracts it did not reach
 * cost at least its last price (a book only gets dearer), and when it stopped
 * because its book ran out, it cannot fill the order and is not compared.
 * Below a cent, or with nothing to compare, there is no line.
 *
 * Pure: shared by the server's Review and the pages.
 */

/** Ryntra's fee on a buy, in basis points of the contracts bought; a sell carries none. */
export const RYNTRA_BUY_FEE_BIPS = 30;

/** The route's own cost breakdown, USD; present when the provider planned a feasible route. */
export type PredictionRouteCosts = Readonly<{
  /** The contracts themselves, before any fee. */
  contractsUsd: number;
  venueFeesUsd: number;
  builderFeeUsd: number;
  bridgeUsd: number;
  gasUsd: number;
  /** The partner fee the provider charges with the order; null when none is configured. */
  appFeeUsd: number | null;
  appFeeBips: number | null;
  referralUsd: number | null;
  /** One-time setup (approvals, token accounts) still unpaid; null when the quote did not estimate it. */
  setupUsd: number | null;
  totalUsd: number;
}>;

/** One venue's own quote for the same order: what buying there alone would fill and cost. */
export type PredictionSoloQuote = Readonly<{
  venue: string;
  status: string;
  shares: number;
  avgPrice: number | null;
  /** The venue's own total — contracts and its fees, without any partner fee; null when it states none. */
  directCostUsd: number | null;
  /** Why the provider cannot execute there, in its words; null when it can. */
  unavailableReason: string | null;
  /** The price levels the venue's own quote fills, each with the contracts taken there; absent on a quote stored before they were kept. */
  levels?: readonly Readonly<{ price: number; qty: number }>[];
}>;

export type ReviewCostLineId = "contracts" | "venue" | "ryntra" | "gas" | "bridge" | "setup" | "referral";
export type ReviewCostLine = Readonly<{ id: ReviewCostLineId; usd: number | null }>;

export type ReviewCosts = Readonly<{
  lines: readonly ReviewCostLine[];
  ryntra: Readonly<{
    bips: number;
    usd: number;
    /** True when the provider charges it with this order; false when the Review states it and nothing takes it (paper without a partner fee). */
    charged: boolean;
  }>;
  /** What the order takes from the balance: the route's total with every fee it charges. */
  totalUsd: number;
  /** The route against the least the same contracts cost on one venue alone, after Ryntra's fee; null unless the route is cheaper by a cent or more. `venueCostUsd` is that least cost, before the venue's fees. */
  saving: Readonly<{ usd: number; venue: string; venueCostUsd: number }> | null;
}>;

/** The route as this module reads it — a subset of `PredictionRoute`, so a stored Review without the newer fields still reads. */
export type CostedRoute = Readonly<{
  side: "buy" | "sell";
  /** The amount the person asked to spend on a buy — the budget every venue's own quote was given too. */
  requested: number;
  shares: number;
  costUsd: number;
  totalCostIncFeesUsd: number | null;
  fees: Readonly<{ venue: number; builder: number; settlement: number; app: number | null }>;
  costs?: PredictionRouteCosts | null;
  solos?: readonly PredictionSoloQuote[];
}>;

const cents = (usd: number) => Math.round(usd * 100) / 100;
const atoms = (usd: number) => Math.round(usd * 1e6) / 1e6;

/** Ryntra's fee on a contracts amount at a rate, to the micro-dollar. */
export function ryntraFeeUsd(contractsUsd: number, bips: number = RYNTRA_BUY_FEE_BIPS): number {
  return contractsUsd > 0 ? atoms((contractsUsd * bips) / 10_000) : 0;
}

/**
 * The ticket's promise before any quote: what the amount buys if the outcome
 * wins, at a price, after Ryntra's fee. An estimate — venue fees and depth
 * move it, and the Review states the figure the route fills at.
 */
export function payoutEstimate(spendUsd: number | null, price: number | null, bips: number = RYNTRA_BUY_FEE_BIPS): number | null {
  if (spendUsd == null || price == null || !(spendUsd > 0) || !(price > 0) || price >= 1) return null;
  const contracts = spendUsd / (1 + bips / 10_000);
  return cents(contracts / price);
}

export function reviewCosts(route: CostedRoute): ReviewCosts | null {
  if (route.side !== "buy") return null;
  const breakdown = route.costs ?? null;
  const contracts = breakdown?.contractsUsd ?? route.costUsd;
  const venue = breakdown ? breakdown.venueFeesUsd + breakdown.builderFeeUsd : route.fees.venue + route.fees.builder;
  const providerFee = breakdown?.appFeeUsd ?? route.fees.app ?? null;
  const charged = providerFee != null && providerFee > 0;
  const ryntra = charged
    ? { bips: breakdown?.appFeeBips ?? RYNTRA_BUY_FEE_BIPS, usd: atoms(providerFee), charged: true }
    : { bips: RYNTRA_BUY_FEE_BIPS, usd: ryntraFeeUsd(contracts), charged: false };
  const lines: ReviewCostLine[] = [
    { id: "contracts", usd: atoms(contracts) },
    { id: "venue", usd: atoms(venue) },
    { id: "ryntra", usd: ryntra.usd },
    { id: "gas", usd: breakdown ? atoms(breakdown.gasUsd) : null },
    { id: "bridge", usd: breakdown ? atoms(breakdown.bridgeUsd) : null },
  ];
  if (breakdown?.referralUsd != null && breakdown.referralUsd > 0) lines.push({ id: "referral", usd: atoms(breakdown.referralUsd) });
  if (breakdown?.setupUsd != null && breakdown.setupUsd > 0) lines.push({ id: "setup", usd: atoms(breakdown.setupUsd) });
  const stated = lines.filter((l) => l.usd != null && (l.id !== "ryntra" || charged)).reduce((sum, l) => sum + (l.usd ?? 0), 0);
  /* The breakdown's own total leaves the partner fee and a user-paid referral out; the route's total holds them. */
  const fromBreakdown = breakdown ? breakdown.totalUsd + (charged ? ryntra.usd : 0) + (breakdown.referralUsd ?? 0) : null;
  const totalUsd = atoms(route.totalCostIncFeesUsd ?? fromBreakdown ?? stated);
  return { lines, ryntra, totalUsd, saving: savingOf(route, totalUsd + (charged ? 0 : ryntra.usd)) };
}

/**
 * The least `shares` contracts cost on one venue's own levels, cheapest first.
 * `beyond`: the levels end where the budget did, so contracts past them cost
 * at least the last price; otherwise levels that do not hold that many give null.
 */
export function leastCostOf(levels: readonly Readonly<{ price: number; qty: number }>[], shares: number, beyond = false): number | null {
  let left = shares;
  let cost = 0;
  let last = 0;
  for (const level of [...levels].filter((l) => l.qty > 0 && l.price > 0).sort((a, b) => a.price - b.price)) {
    const take = Math.min(left, level.qty);
    cost += take * level.price;
    left -= take;
    last = level.price;
    if (left <= 1e-9) return cost;
  }
  return beyond && last > 0 ? cost + left * last : null;
}

/** A venue's own quote spent the whole budget: it stopped for money, not for want of contracts. */
function spentBudget(solo: PredictionSoloQuote, budget: number): boolean {
  return solo.directCostUsd != null && budget > 0 && solo.directCostUsd >= budget * 0.99;
}

function savingOf(route: CostedRoute, allInUsd: number): ReviewCosts["saving"] {
  if (!(route.shares > 0)) return null;
  let best: { venue: string; cost: number } | null = null;
  for (const solo of route.solos ?? []) {
    if (solo.status !== "ok" || !solo.levels || solo.levels.length === 0) continue;
    const cost = leastCostOf(solo.levels, route.shares, solo.shares + 1e-6 < route.shares && spentBudget(solo, route.requested));
    if (cost == null) continue;
    if (!best || cost < best.cost) best = { venue: solo.venue, cost };
  }
  if (!best) return null;
  const venueCostUsd = best.cost;
  /* Rounded down to the cent, past the float noise of a sum of fees: the line never claims a cent the figures do not hold. */
  const saving = Math.floor((venueCostUsd - allInUsd) * 100 + 1e-6) / 100;
  return saving >= 0.01 ? { usd: saving, venue: best.venue, venueCostUsd: cents(venueCostUsd) } : null;
}
