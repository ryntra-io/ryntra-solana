/**
 * What the browser and the server share about Phoenix collateral (B6): the amounts, their bounds and the margin's shape.
 * No Node module here — the page imports it. The actions are `collateral.ts` and `collateral-actions.ts`.
 */

/** USDC has six decimals: amounts travel as micro-dollars, in a string of digits. */
export const USDC_DECIMALS = 6;
/** The least one action moves: one dollar (the operator's minimum for every money action). */
export const MIN_COLLATERAL_MICRO = 1_000_000n;
/** The most one action moves: a ceiling against a slip of the finger, far above a canary and any first use. */
export const MAX_COLLATERAL_MICRO = 1_000_000_000_000n;

/** Dollars typed by a person («12.5», «12,50») as micro-dollars; null for anything that is not a plain amount. */
export function microFromDollars(text: string): bigint | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(\d{1,10})(?:\.(\d{0,6}))?$/.exec(clean);
  if (!match) return null;
  return BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

/** Micro-dollars as a plain decimal («12.5»), for an input. Down to the cent: a field never shows dust. */
export function dollarsFromMicro(micro: bigint): string {
  const cents = micro / 10_000n;
  const whole = cents / 100n;
  const rest = cents % 100n;
  return rest === 0n ? whole.toString() : `${whole}.${rest.toString().padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * One position of the margin view (SDK `TraderView.positions`, the account's first subaccount): the price at which
 * Phoenix liquidates it — a mark price — and its leverage, the position's value over the margin it holds. Null where
 * Phoenix sent no figure: the page says so rather than counting one of its own.
 */
export type PhoenixPositionRisk = Readonly<{ symbol: string; subaccount: number; liquidationPriceUsd: number | null; leverage: number | null }>;

/**
 * The trader account's margin as `GET /v1/view/trader/{traderAccount}` serves it (SDK `TraderView`): every amount a
 * `{ value, decimals }` of USDC. What the page shows beside the two actions — the collateral, what positions hold, what
 * is free to withdraw, and how near the account is to liquidation.
 */
export type PhoenixMargin = Readonly<{
  collateralUsd: number | null;
  /** Collateral plus unrealised result, Phoenix's own figure. */
  portfolioUsd: number | null;
  /** What open positions and orders hold: below it no new risk is taken. */
  initialMarginUsd: number | null;
  /** Below it the account is liquidated. */
  maintenanceMarginUsd: number | null;
  /** What may leave the account now and keep it healthy. */
  withdrawableMicro: bigint | null;
  /** `safe` … `highRisk` (SDK `RiskTier`); null when Phoenix did not say. */
  riskTier: string | null;
  canDeposit: boolean;
  canWithdraw: boolean;
  /** Each open position's liquidation price and leverage; empty without positions. Absent on an answer of an older release. */
  positions?: readonly PhoenixPositionRisk[];
}>;

/** The margin as it travels to the browser: bigint as a string of digits. */
export type PhoenixMarginWire = Omit<PhoenixMargin, "withdrawableMicro"> & Readonly<{ withdrawableMicro: string | null }>;

export const marginWire = (margin: PhoenixMargin): PhoenixMarginWire => ({ ...margin, withdrawableMicro: margin.withdrawableMicro === null ? null : margin.withdrawableMicro.toString() });

/**
 * How far the account is from liquidation, by Phoenix's own figures: the share of the account's value that may still
 * be lost before it falls to the maintenance margin, in per cent (0 … 100). Null when nothing can be liquidated — no
 * maintenance margin, no position — or Phoenix did not send both figures.
 */
export function liquidationRoomPercent(margin: Pick<PhoenixMargin, "portfolioUsd" | "maintenanceMarginUsd">): number | null {
  const { portfolioUsd: value, maintenanceMarginUsd: maintenance } = margin;
  if (value === null || maintenance === null || !(maintenance > 0)) return null;
  if (!(value > 0)) return 0;
  return Math.min(100, Math.max(0, ((value - maintenance) / value) * 100));
}

/**
 * The subaccounts whose margin view the page holds: the first one's when it was read, and each isolated one's (its
 * positions carry the subaccount it was read at). A position elsewhere was not read — Phoenix has its figures.
 */
export function readSubaccounts(account: Readonly<{ margin?: PhoenixMarginWire | null; subaccountMargins?: readonly PhoenixMarginWire[] }>): ReadonlySet<number> {
  const read = new Set<number>();
  if (account.margin) read.add(0);
  for (const margin of account.subaccountMargins ?? []) for (const position of margin.positions ?? []) read.add(position.subaccount);
  return read;
}

/** Phoenix's risk tiers from the lowest up (SDK `RiskTier`). */
export const RISK_ORDER = ["safe", "atRisk", "cancellable", "liquidatable", "backstopLiquidatable", "highRisk"] as const;

/**
 * The account's risk across its subaccounts — the cross-margin one and each isolated one: the highest tier any of them
 * has, and the least room any of them keeps. Null tier when Phoenix named none.
 */
export function accountRisk(margins: readonly Pick<PhoenixMargin, "riskTier" | "portfolioUsd" | "maintenanceMarginUsd">[]): Readonly<{ tier: string | null; room: number | null }> {
  let tier: string | null = null;
  let room: number | null = null;
  for (const margin of margins) {
    const rank = RISK_ORDER.indexOf(margin.riskTier as (typeof RISK_ORDER)[number]);
    if (rank >= 0 && (tier === null || rank > RISK_ORDER.indexOf(tier as (typeof RISK_ORDER)[number]))) tier = margin.riskTier;
    const own = liquidationRoomPercent(margin);
    if (own !== null && (room === null || own < room)) room = own;
  }
  return { tier, room };
}

/**
 * How far the mark price may move against a position before Phoenix liquidates it, in per cent of the mark: down for a
 * long, up for a short. 0 once the mark has crossed it; null without both prices.
 */
export function liquidationDistancePercent(side: "long" | "short", markUsd: number | null, liquidationUsd: number | null): number | null {
  if (markUsd === null || liquidationUsd === null || !(markUsd > 0) || !(liquidationUsd > 0)) return null;
  const room = side === "long" ? markUsd - liquidationUsd : liquidationUsd - markUsd;
  return Math.max(0, (room / markUsd) * 100);
}

/* ------------------------------------------------------------------ relay */

export type RelayState = "LANDED" | "FAILED" | "UNKNOWN" | "NOT_SENT";
/**
 * `usdcMoved`: the wallet's USDC as the landed transaction changed it, micro-dollars with a sign (a deposit's is
 * negative), read from the chain's own record of balances — what a receipt states, not what the Review expected.
 * Absent until the transaction landed, null when the chain did not show it.
 */
export type CollateralRelay = Readonly<{ results: readonly Readonly<{ signature: string; state: RelayState; reason: string | null; usdcMoved?: string | null }>[]; settled: boolean }>;

/**
 * The relay's own refusals, every one given before anything was sent. Any other answer after the wallet signed — no
 * answer, a gateway's page, a body that is not the relay's, a code this page does not know — may come after a send:
 * the outcome is the chain's to say.
 */
export const REFUSED_BEFORE_SENDING: ReadonlySet<string> = new Set(["BAD_REQUEST", "TICKET_INVALID", "TICKET_EXPIRED", "ACTIONS_CLOSED", "CANARY_LIMIT", "SIGNED_MISMATCH", "NOT_SIGNED", "RELAY_REFUSED", "UNAVAILABLE", "WALLET_MISMATCH", "RATE_LIMITED", "FORBIDDEN_ORIGIN", "UNAUTHORIZED", "SESSION_EXPIRED", "SESSION_REVOKED", "BODY_REQUIRED", "BODY_TOO_LARGE", "INVALID_BODY_STREAM", "INVALID_CONTENT_LENGTH", "INVALID_JSON", "JSON_REQUIRED"]);

/** The relay's answer once the wallet has signed: a refusal before sending stands; anything else waits on the chain. */
export function relayAfterSigning(relayed: Readonly<{ ok: true; value: CollateralRelay }> | Readonly<{ ok: false; code: string }>, signatures: readonly string[]): Readonly<{ ok: true; value: CollateralRelay }> | Readonly<{ ok: false; code: string }> {
  if (relayed.ok || REFUSED_BEFORE_SENDING.has(relayed.code)) return relayed;
  return { ok: true, value: { results: signatures.map((signature) => ({ signature, state: "UNKNOWN" as const, reason: null })), settled: false } };
}
