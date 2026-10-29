/**
 * The assistant's credits — the prices and the allowances.
 *
 * Credits are the service's own units, not a token and not money: they do not
 * move between people, are never paid out and never mix with the Growth line's
 * points. 1 000 credits = 1 USDC (AI-12 sells them). Every figure here is a
 * setting: the defaults are the plan's table, each one overridable by its env
 * variable, so a price changes without a release of code.
 */

/** What a person can spend credits on. A deterministic answer is none of these and costs nothing. */
export const CREDIT_ACTIONS = ["question", "alertExplain", "tokenReport", "priceMove", "voice", "deep", "plan"] as const;
export type CreditAction = (typeof CREDIT_ACTIONS)[number];

/** PLAN §9: the price of each action in credits (1 credit = $0.001). */
export const DEFAULT_CREDIT_PRICES: Readonly<Record<CreditAction, number>> = {
  question: 2,
  alertExplain: 2,
  tokenReport: 5,
  priceMove: 5,
  /** Per each started 30 s of voice heard on the server, up to 2 min (AI-08). */
  voice: 6,
  deep: 60,
  plan: 130,
};

export type CreditsConfig = Readonly<{
  prices: Readonly<Record<CreditAction, number>>;
  /** Free credits per UTC day, not carried over; spent before anything of the balance. */
  freeDaily: number;
  /** The welcome credits, once per wallet and per account, after the abuse check. */
  welcome: number;
  /** Credits of the balance (welcome and bought) one holder may spend per UTC day — no quiet overspend. */
  dailySpendCap: number;
  /** How long a reservation lives when its call never settled (a crashed instance): then it is given back. */
  holdMs: number;
  /** The welcome check: the wallet's first transaction at least this many days ago… */
  welcomeMinAgeDays: number;
  /** …and at least this many successful transactions. */
  welcomeMinTxs: number;
}>;

export const CREDITS_ENV = {
  /** JSON of `{ action: credits }`, e.g. `{"question":3}`; an unknown key or a bad value is ignored. */
  prices: "RYNTRA_ASSISTANT_CREDIT_PRICES",
  freeDaily: "RYNTRA_ASSISTANT_FREE_DAILY_CREDITS",
  welcome: "RYNTRA_ASSISTANT_WELCOME_CREDITS",
  dailySpendCap: "RYNTRA_ASSISTANT_DAILY_SPEND_CAP",
} as const;

const whole = (raw: string | undefined, fallback: number, min = 0): number => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= min ? value : fallback;
};

function pricesFrom(raw: string | undefined): Record<CreditAction, number> {
  const prices: Record<CreditAction, number> = { ...DEFAULT_CREDIT_PRICES };
  if (!raw?.trim()) return prices;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return prices;
    for (const action of CREDIT_ACTIONS) {
      const value = (parsed as Record<string, unknown>)[action];
      /* A price is at least one credit: a paid action at zero would be a free one nobody chose. */
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100_000) prices[action] = value;
    }
  } catch {
    /* A malformed override keeps the plan's prices. */
  }
  return prices;
}

export function resolveCreditsConfig(env: Readonly<Record<string, string | undefined>> = process.env): CreditsConfig {
  return {
    prices: pricesFrom(env[CREDITS_ENV.prices]),
    freeDaily: whole(env[CREDITS_ENV.freeDaily], 20),
    welcome: whole(env[CREDITS_ENV.welcome], 100),
    dailySpendCap: whole(env[CREDITS_ENV.dailySpendCap], 5_000, 1),
    holdMs: 120_000,
    welcomeMinAgeDays: 30,
    welcomeMinTxs: 10,
  };
}

export function priceOf(config: CreditsConfig, action: CreditAction): number {
  return config.prices[action];
}
