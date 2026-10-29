/**
 * Launch Boost — «Бонус від творця»: a creator's campaign for the buyers of
 * their token, paid from the creator's own money.
 *
 * A creator sets the rules once — the bonus as a share of a purchase, in the
 * pair currency (USDC) or in the token itself; the least purchase that counts;
 * the most one wallet may receive; the campaign's whole budget; its window; how
 * long a buyer keeps the tokens without selling — and the token page shows them
 * before anyone buys. The budget goes into Met Lock's vesting escrow from the
 * creator to the creator, unlocking only once the campaign and its hold are
 * over, so nobody — the creator neither — can take it out earlier. After that
 * the creator signs the payout this module counts from the chain's own trades;
 * a creator who does not sign keeps the money, and Ryntra pays nothing in their
 * place. Ryntra takes 0 of a campaign.
 *
 * Who is paid, from the trades the programs recorded:
 * - one payout per wallet — the wallet whose tokens moved (`LaunchTrade.trader`);
 * - purchases inside the window, each at least the minimum, add up; the bonus is
 *   the rule's share of them (of the pair currency paid, or of the tokens
 *   received), rounded down, and at most the cap;
 * - a wallet that sold any of the token from its first counted purchase until
 *   the hold after its last counted purchase is not paid;
 * - the creator, the wallets sharing the creator's fees, Ryntra's own wallets
 *   and wallets the caller names as linked are never paid — nor is a purchase
 *   such a wallet paid for (the swap's payer), delivered to another wallet;
 * - the budget goes to wallets in the order of their first counted purchase
 *   until it is spent, the last one partly;
 * - «через Ryntra» (`routes: "ryntra"`, the default): only purchases that
 *   Ryntra's own trade route built and sent count — the caller hands their
 *   signatures over (`viaRyntra`, Launch's trade records). A trade on the curve
 *   carries Ryntra's partner fee whoever routed it, so the fee is no signal;
 * - nothing is paid on a history read in part: a partial read is «not read».
 *
 * Pure and client-safe: no clock unless given, no network, bigint arithmetic
 * rounded down. The escrow and the payout are built by `../../launch/boost.server.ts`.
 */

import type { LaunchTrade } from "../venues/meteora-dbc/market.ts";

export const BOOST_CURRENCIES = ["PAIR", "TOKEN"] as const;
/** What the bonus is paid in: the launch's pair currency (USDC), or the launched token. */
export type BoostCurrency = (typeof BOOST_CURRENCIES)[number];

export const BOOST_ROUTES = ["ryntra", "any"] as const;
/** Which purchases count: those Ryntra's trade route sent, or purchases from anywhere. */
export type BoostRoutes = (typeof BOOST_ROUTES)[number];

/** A campaign's rules, as the creator sets them and the token page shows them. Raw amounts as decimal strings. */
export type BoostRules = Readonly<{
  currency: BoostCurrency;
  /** The share of a counted purchase paid as the bonus, basis points. */
  bonusBps: number;
  /** The least purchase that counts, in the pair currency, raw. */
  minBuyRaw: string;
  /** The most one wallet receives, in the campaign's currency, raw. */
  capPerWalletRaw: string;
  /** Everything the campaign may pay, in its currency, raw — the amount locked. */
  budgetRaw: string;
  /** The window purchases count in, unix seconds: from `startsAt`, before `endsAt`. */
  startsAt: number;
  endsAt: number;
  /** How long a buyer keeps the tokens without selling, hours; 0 — no hold. */
  holdHours: number;
  routes: BoostRoutes;
}>;

/**
 * The bounds a campaign stays inside — what the operator approves once, and the server checks every campaign against.
 * Raw amounts as decimal strings.
 */
export type BoostBounds = Readonly<{
  currencies: readonly BoostCurrency[];
  routes: readonly BoostRoutes[];
  minBonusBps: number;
  maxBonusBps: number;
  /** The shortest window, minutes, and the longest, days. */
  minMinutes: number;
  maxDays: number;
  /** How far ahead a campaign may start, days. */
  maxStartDays: number;
  minHoldHours: number;
  maxHoldHours: number;
  /** The least a campaign's minimum purchase may be, pair raw: a purchase of dust earns nothing. */
  minBuyFloorRaw: string;
  /** The cap per wallet as a share of the budget, at most, basis points: one wallet does not take the campaign. */
  maxCapShareBps: number;
  /** The largest budget in each currency, raw; null — no bound but the creator's own balance. */
  maxBudgetRaw: Readonly<{ PAIR: string | null; TOKEN: string | null }>;
}>;

/** The devnet stand's bounds: wide, so a rehearsal can run a campaign of minutes with a hold of seconds. */
export const DEVNET_BOOST_BOUNDS: BoostBounds = Object.freeze({
  currencies: ["PAIR", "TOKEN"] as const,
  routes: ["ryntra", "any"] as const,
  minBonusBps: 10,
  maxBonusBps: 5_000,
  minMinutes: 1,
  maxDays: 30,
  maxStartDays: 7,
  minHoldHours: 0,
  maxHoldHours: 168,
  minBuyFloorRaw: "1",
  maxCapShareBps: 10_000,
  maxBudgetRaw: { PAIR: null, TOKEN: null },
});

/** A start a little in the past still holds: the form's clock and the server's differ, and the build takes seconds. */
export const BOOST_START_SLACK_SECONDS = 300;

const HOUR = 3_600;
const DAY = 86_400;
/* Raw units, one spelling per amount: no leading zeros, "0" only as zero. */
const RAW = /^(0|[1-9][0-9]{0,29})$/;

export type BoostProblemCode =
  | "CURRENCY_NOT_ALLOWED"
  | "ROUTES_NOT_ALLOWED"
  | "BONUS_OUT_OF_BOUNDS"
  | "NOT_AN_AMOUNT"
  | "BUDGET_EMPTY"
  | "BUDGET_ABOVE_BOUND"
  | "MIN_BUY_BELOW_FLOOR"
  | "CAP_EMPTY"
  | "CAP_ABOVE_SHARE"
  | "CAP_ABOVE_BUDGET"
  | "STARTS_IN_PAST"
  | "STARTS_TOO_LATE"
  | "WINDOW_TOO_SHORT"
  | "WINDOW_TOO_LONG"
  | "HOLD_OUT_OF_BOUNDS";

export type BoostProblem = Readonly<{ code: BoostProblemCode; message: string }>;

const amount = (raw: string): bigint | null => (typeof raw === "string" && RAW.test(raw) ? BigInt(raw) : null);

/** The hold in whole seconds. */
export function holdSeconds(rules: Pick<BoostRules, "holdHours">): number {
  return Math.round(rules.holdHours * HOUR);
}

/** When the budget unlocks, and the payout may be counted: the window's end and the hold after it. */
export function boostUnlocksAt(rules: Pick<BoostRules, "endsAt" | "holdHours">): number {
  return rules.endsAt + holdSeconds(rules);
}

/** Whether bounds read as bounds: every minimum at most its maximum, every number a number. */
export function boostBoundsHold(bounds: BoostBounds): boolean {
  const whole = (value: number) => Number.isInteger(value) && value >= 0;
  const finite = (value: number) => Number.isFinite(value) && value >= 0;
  if (!bounds.currencies.length || !bounds.routes.length) return false;
  if (!bounds.currencies.every((c) => (BOOST_CURRENCIES as readonly string[]).includes(c)) || !bounds.routes.every((r) => (BOOST_ROUTES as readonly string[]).includes(r))) return false;
  if (!whole(bounds.minBonusBps) || !whole(bounds.maxBonusBps) || bounds.minBonusBps < 1 || bounds.minBonusBps > bounds.maxBonusBps || bounds.maxBonusBps > 10_000) return false;
  if (!finite(bounds.minMinutes) || !finite(bounds.maxDays) || bounds.minMinutes <= 0 || bounds.minMinutes * 60 > bounds.maxDays * DAY) return false;
  if (!finite(bounds.maxStartDays) || !finite(bounds.minHoldHours) || !finite(bounds.maxHoldHours) || bounds.minHoldHours > bounds.maxHoldHours) return false;
  if (amount(bounds.minBuyFloorRaw) === null || (amount(bounds.minBuyFloorRaw) ?? 0n) < 1n) return false;
  if (!whole(bounds.maxCapShareBps) || bounds.maxCapShareBps < 1 || bounds.maxCapShareBps > 10_000) return false;
  for (const bound of [bounds.maxBudgetRaw.PAIR, bounds.maxBudgetRaw.TOKEN]) if (bound !== null && amount(bound) === null) return false;
  return true;
}

/**
 * What breaks the rules or the bounds, each once, in plain words; empty when the campaign holds. `now`: unix seconds.
 */
export function boostRuleProblems(rules: BoostRules, bounds: BoostBounds, now: number): readonly BoostProblem[] {
  const problems = new Map<BoostProblemCode, string>();
  const add = (code: BoostProblemCode, message: string) => {
    if (!problems.has(code)) problems.set(code, message);
  };
  if (!bounds.currencies.includes(rules.currency)) add("CURRENCY_NOT_ALLOWED", "The bonus cannot be paid in this currency.");
  if (!bounds.routes.includes(rules.routes)) add("ROUTES_NOT_ALLOWED", "Purchases from this route cannot count.");
  if (!Number.isInteger(rules.bonusBps) || rules.bonusBps < bounds.minBonusBps || rules.bonusBps > bounds.maxBonusBps) {
    add("BONUS_OUT_OF_BOUNDS", `The bonus is from ${bounds.minBonusBps / 100} % to ${bounds.maxBonusBps / 100} % of a purchase.`);
  }
  const budget = amount(rules.budgetRaw);
  const minBuy = amount(rules.minBuyRaw);
  const cap = amount(rules.capPerWalletRaw);
  if (budget === null || minBuy === null || cap === null) add("NOT_AN_AMOUNT", "An amount is not a whole number of raw units.");
  if (budget !== null) {
    if (budget <= 0n) add("BUDGET_EMPTY", "The campaign needs a budget.");
    const bound = bounds.maxBudgetRaw[rules.currency];
    if (bound !== null && budget > BigInt(bound)) add("BUDGET_ABOVE_BOUND", "The budget is above the most a campaign may hold.");
  }
  if (minBuy !== null && minBuy < BigInt(bounds.minBuyFloorRaw)) add("MIN_BUY_BELOW_FLOOR", "The least purchase that counts is below the floor.");
  if (cap !== null) {
    if (cap <= 0n) add("CAP_EMPTY", "The most one wallet receives must be above zero.");
    if (budget !== null && budget > 0n) {
      if (cap > budget) add("CAP_ABOVE_BUDGET", "One wallet cannot receive more than the whole budget.");
      else if (cap * 10_000n > budget * BigInt(bounds.maxCapShareBps)) add("CAP_ABOVE_SHARE", `One wallet receives at most ${bounds.maxCapShareBps / 100} % of the budget.`);
    }
  }
  const timesWhole = Number.isInteger(rules.startsAt) && Number.isInteger(rules.endsAt);
  if (!timesWhole || rules.startsAt < now - BOOST_START_SLACK_SECONDS) add("STARTS_IN_PAST", "The campaign cannot start in the past: purchases count only once its rules are shown.");
  if (timesWhole && rules.startsAt > now + bounds.maxStartDays * DAY) add("STARTS_TOO_LATE", `The campaign starts within ${bounds.maxStartDays} days.`);
  if (timesWhole && rules.endsAt - rules.startsAt < bounds.minMinutes * 60) add("WINDOW_TOO_SHORT", `The campaign lasts at least ${bounds.minMinutes} minutes.`);
  if (timesWhole && rules.endsAt - rules.startsAt > bounds.maxDays * DAY) add("WINDOW_TOO_LONG", `The campaign lasts at most ${bounds.maxDays} days.`);
  if (!Number.isFinite(rules.holdHours) || rules.holdHours < bounds.minHoldHours || rules.holdHours > bounds.maxHoldHours) {
    add("HOLD_OUT_OF_BOUNDS", `The hold is from ${bounds.minHoldHours} to ${bounds.maxHoldHours} hours.`);
  }
  return [...problems].map(([code, message]) => ({ code, message }));
}

/* ------------------------------------------------------------ the lines before a purchase */

export type BoostUnits = Readonly<{ symbol: string; decimals: number; pairSymbol: string; pairDecimals: number; /** The pair currency is a dollar: its figures are dollars. */ dollar: boolean }>;
export type BoostLocale = "uk" | "en";

/** A raw amount in whole units for reading: grouped, at most four decimals, rounded down. */
export function formatRaw(raw: string | bigint, decimals: number, locale: BoostLocale): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const shown = Math.min(decimals, 4);
  const fraction = ((value % scale) / 10n ** BigInt(decimals - shown)).toString().padStart(shown, "0").replace(/0+$/, "");
  const group = locale === "uk" ? " " : ",";
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction ? `${grouped}${locale === "uk" ? "," : "."}${fraction}` : grouped;
}

function percent(bps: number, locale: BoostLocale): string {
  const text = String(bps / 100);
  return locale === "uk" ? `${text.replace(".", ",")} %` : `${text}%`;
}

function moment(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function hours(value: number, locale: BoostLocale): string {
  const text = String(Math.round(value * 100) / 100);
  return locale === "uk" ? `${text.replace(".", ",")} год` : `${text} h`;
}

/**
 * The lines the token page shows before a purchase: the rules in one line, the window, what counts and what does not,
 * and what holds the budget — in plain words, without a promise the chain does not keep.
 */
export function boostRuleLines(rules: BoostRules, units: BoostUnits, locale: BoostLocale): readonly string[] {
  const inPair = (raw: string) => (units.dollar && locale === "en" ? `$${formatRaw(raw, units.pairDecimals, locale)}` : `${formatRaw(raw, units.pairDecimals, locale)} ${units.pairSymbol}`);
  const inCurrency = (raw: string) => (rules.currency === "PAIR" ? inPair(raw) : `${formatRaw(raw, units.decimals, locale)} ${units.symbol}`);
  const currencyName = rules.currency === "PAIR" ? units.pairSymbol : units.symbol;
  const hold = holdSeconds(rules) > 0;
  const unlocks = moment(boostUnlocksAt(rules));
  if (locale === "uk") {
    return [
      [
        `Бонус від творця: ${percent(rules.bonusBps, locale)} у ${currencyName}`,
        `у кампанії ${inCurrency(rules.budgetRaw)}`,
        `від ${inPair(rules.minBuyRaw)}`,
        `до ${inCurrency(rules.capPerWalletRaw)} на гаманець`,
        "одна виплата на гаманець",
        hold ? `утримання ${hours(rules.holdHours, locale)}` : "без утримання",
        "виплачує творець; Ryntra бере 0",
      ].join(" · "),
      `Покупки рахуються з ${moment(rules.startsAt)} до ${moment(rules.endsAt)}${rules.routes === "ryntra" ? ", лише через Ryntra" : ", з будь-якого маршруту"}.`,
      `${hold ? `Гаманець, що продав токен раніше ніж через ${hours(rules.holdHours, locale)} після своєї покупки, виплати не отримує. ` : ""}Не рахуються творець, гаманці зі спільними комісіями творця, гаманці Ryntra і покупки, які оплатив творець. Коли бюджет закінчується, його отримують раніші покупці.`,
      `Бюджет заблоковано в Met Lock до ${unlocks}: до того його не може забрати ніхто, і творець теж. Після цього виплату підписує творець; якщо не підпише — гроші лишаються творцеві, а Ryntra нічого не виплачує замість нього.`,
    ];
  }
  return [
    [
      `Creator's bonus: ${percent(rules.bonusBps, locale)} in ${currencyName}`,
      `${inCurrency(rules.budgetRaw)} in the campaign`,
      `from ${inPair(rules.minBuyRaw)}`,
      `up to ${inCurrency(rules.capPerWalletRaw)} per wallet`,
      "one payout per wallet",
      hold ? `${hours(rules.holdHours, locale)} hold` : "no hold",
      "paid by the creator; Ryntra takes 0",
    ].join(" · "),
    `Purchases count from ${moment(rules.startsAt)} to ${moment(rules.endsAt)}${rules.routes === "ryntra" ? ", through Ryntra only" : ", from any route"}.`,
    `${hold ? `A wallet that sells the token within ${hours(rules.holdHours, locale)} of its purchase is not paid. ` : ""}The creator, wallets sharing the creator's fees, Ryntra's wallets and purchases the creator paid for do not count. When the budget runs out, earlier buyers receive it.`,
    `The budget is locked in Met Lock until ${unlocks}: nobody can take it out before then, the creator included. After that the creator signs the payout; if they do not, the money stays with the creator and Ryntra pays nothing in their place.`,
  ];
}

/* ------------------------------------------------------------ the payout */

/** What a payout reads of a trade. */
export type BoostTrade = Pick<LaunchTrade, "signature" | "slot" | "at" | "side" | "trader" | "payer" | "pairRaw" | "tokensRaw">;

export type BoostPayoutRow = Readonly<{
  wallet: string;
  /** The wallet's first counted purchase: its time and signature. */
  firstBuyAt: number;
  signature: string;
  /** Every counted purchase of the wallet, in the pair currency paid and the tokens received. */
  qualifyingPairRaw: string;
  qualifyingTokensRaw: string;
  /** What the wallet is paid, in the campaign's currency: its share, capped, and what the budget had left. */
  bonusRaw: string;
}>;

export type BoostPayoutState = "NOT_READ" | "WAITING" | "READY";

export type BoostPayouts = Readonly<{
  /** NOT_READ — the history was read in part, nothing is counted; WAITING — the campaign or its hold is not over; READY — the payout may be signed. */
  state: BoostPayoutState;
  rows: readonly BoostPayoutRow[];
  totalRaw: string;
  /** What the budget keeps after the rows: it stays with the creator. */
  leftoverRaw: string;
  /** Wallets that bought within the rules but sold before their hold was over. */
  soldEarly: number;
}>;

type Order = Pick<BoostTrade, "slot" | "at" | "signature">;
const before = (a: Order, b: Order) => (a.slot !== b.slot ? a.slot - b.slot : a.at !== b.at ? a.at - b.at : a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0);

/**
 * Who the campaign pays, and how much, from the token's trades. `excluded`: the creator, the fee-sharing wallets,
 * Ryntra's own wallets and the linked ones. `historyComplete`: every trade from the window's start to its hold's end was
 * read. `viaRyntra`: the signatures of the purchases Ryntra's trade route sent — needed when only those count; absent
 * then, nothing is counted. `now`: unix seconds.
 */
export function boostPayouts(
  rules: BoostRules,
  trades: readonly BoostTrade[],
  options: Readonly<{ excluded: ReadonlySet<string>; historyComplete: boolean; now: number; viaRyntra?: ReadonlySet<string> | null }>,
): BoostPayouts {
  const budget = BigInt(rules.budgetRaw);
  const unread: BoostPayouts = { state: "NOT_READ", rows: [], totalRaw: "0", leftoverRaw: budget.toString(), soldEarly: 0 };
  if (!options.historyComplete) return unread;
  if (rules.routes === "ryntra" && !options.viaRyntra) return unread;
  const hold = holdSeconds(rules);
  const minBuy = BigInt(rules.minBuyRaw);
  const cap = BigInt(rules.capPerWalletRaw);
  const ordered = [...trades].sort(before);
  const counted = (trade: BoostTrade) =>
    trade.side === "buy" &&
    trade.at >= rules.startsAt &&
    trade.at < rules.endsAt &&
    !options.excluded.has(trade.trader) &&
    !options.excluded.has(trade.payer) &&
    BigInt(trade.pairRaw) >= minBuy &&
    (rules.routes === "any" || options.viaRyntra!.has(trade.signature));
  type Wallet = { first: BoostTrade; last: BoostTrade; pair: bigint; tokens: bigint };
  const wallets = new Map<string, Wallet>();
  for (const trade of ordered) {
    if (!counted(trade)) continue;
    const known = wallets.get(trade.trader);
    if (!known) wallets.set(trade.trader, { first: trade, last: trade, pair: BigInt(trade.pairRaw), tokens: BigInt(trade.tokensRaw) });
    else {
      known.last = trade;
      known.pair += BigInt(trade.pairRaw);
      known.tokens += BigInt(trade.tokensRaw);
    }
  }
  /* A sale from the first counted purchase until the hold after the last one: the wallet is not paid. */
  let soldEarly = 0;
  const kept: Wallet[] = [];
  for (const [wallet, entry] of wallets) {
    const sold =
      hold > 0 &&
      ordered.some((trade) => trade.side === "sell" && trade.trader === wallet && before(trade, entry.first) >= 0 && trade.at <= entry.last.at + hold);
    if (sold) soldEarly += 1;
    else kept.push(entry);
  }
  kept.sort((a, b) => before(a.first, b.first));
  let left = budget;
  const rows: BoostPayoutRow[] = [];
  for (const entry of kept) {
    if (left <= 0n) break;
    const base = rules.currency === "PAIR" ? entry.pair : entry.tokens;
    const share = (base * BigInt(rules.bonusBps)) / 10_000n;
    const capped = share < cap ? share : cap;
    const paid = capped < left ? capped : left;
    if (paid <= 0n) continue;
    left -= paid;
    rows.push({
      wallet: entry.first.trader,
      firstBuyAt: entry.first.at,
      signature: entry.first.signature,
      qualifyingPairRaw: entry.pair.toString(),
      qualifyingTokensRaw: entry.tokens.toString(),
      bonusRaw: paid.toString(),
    });
  }
  return {
    state: options.now >= boostUnlocksAt(rules) ? "READY" : "WAITING",
    rows,
    totalRaw: (budget - left).toString(),
    leftoverRaw: left.toString(),
    soldEarly,
  };
}
