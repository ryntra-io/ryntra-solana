/**
 * Ризик портфеля — one word for the whole wallet on Home (canon v5 §11 with
 * the caps of §5.3; `RYN-PROTECT-SIGNAL-001`, subtask 2).
 *
 * | State | When |
 * |---|---|
 * | «Нормальний» | no position in «Дія»; no asset above 25 % of the wallet; the private companies together at most 10 %; no listed company without a loss limit over the weekend — and every figure read |
 * | «Увага: <причина>» | a rule is broken — the most urgent reason first |
 * | «Не вдалося перевірити» | a price or a read is missing, and nothing known breaks a rule |
 *
 * «Нормальний» is never said without full data (B.11). A broken rule that is
 * certain on what was read — a position at its limit, a company with no loss
 * limit over the weekend — is said even when something else could not be
 * read; a share is not, because a total with a part missing makes every
 * other part look larger than it is.
 *
 * The caps (§5.3): one asset at most 25 % of the wallet — a company counted
 * once across its tokens — from a wallet of $500 up, and the private
 * companies (pre-IPO) together at most 10 % whatever the wallet's size (§7,
 * §11: a sale of one may not go through); dollars (USDC, USDT) are in the
 * total and outside the caps. The weekend is New York's calendar — from Friday, the
 * day of the last session before it, through Sunday — and a day off the
 * exchange says so itself: closed, and opening more than a day away. A
 * night's close is neither. A private company has no exchange and no weekend.
 * Deterministic and pure: the words are a reader's, the state is decided here
 * and only here.
 */

import type { WatchReason, WatchState } from "./watch-state.ts";

export const RISK_STATES = ["normal", "attention", "unknown"] as const;
export type RiskState = (typeof RISK_STATES)[number];

/** The rules «Увага» names, in the order a person should act on them. */
export const RISK_REASONS = ["action", "weekend-no-limit", "concentration", "private-share"] as const;
export type RiskReason = (typeof RISK_REASONS)[number];

/** What could not be read: the wallet's token accounts, the companies' market, the positions' exits (plans and «Ryntra попередить»), the SOL balance, a price. */
export const RISK_GAPS = ["holdings", "market", "exits", "balance", "prices"] as const;
export type RiskGap = (typeof RISK_GAPS)[number];

export const RISK_ASSET_KINDS = ["company", "private", "crypto", "dollar"] as const;
export type RiskAssetKind = (typeof RISK_ASSET_KINDS)[number];

/** One asset's share of the wallet above this is «Увага» (§5.3, §11). */
export const ASSET_CAP_PCT = 25;
/** The private companies' share together above this is «Увага» (§5.3, §7, §11). */
export const PRIVATE_CAP_PCT = 10;
/** The caps hold from a wallet worth this much (§5.3). */
export const CAPS_FROM_USD = 500;

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
/**
 * Dollars — in the wallet's total, outside every cap (§5.3): USDC and USDT as
 * the canon names them, and the two dollar tokens the product already treats
 * as money beside them (`lib/liquidity/model.ts`, `lib/spot/coin-shelf.ts`).
 */
export const DOLLAR_SYMBOLS: ReadonlyMap<string, string> = new Map([
  [USDC_MINT, "USDC"],
  [USDT_MINT, "USDT"],
  ["2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", "PYUSD"],
  ["USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", "USDS"],
]);
export const DOLLAR_MINTS: ReadonlySet<string> = new Set(DOLLAR_SYMBOLS.keys());

/** A priced holding of the wallet. `key` is what counts as one asset: a company's ticker across its tokens, else the mint. */
export type RiskAsset = Readonly<{ key: string; mint: string; symbol: string; name: string; kind: RiskAssetKind; valueUsd: number }>;

/** A company position as Нагляд judged it, with what the weekend rule needs. */
export type RiskPosition = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  kind: "company" | "private";
  state: WatchState;
  reason: WatchReason;
  /** A loss limit is set — by the plan it was bought under or by «Ryntra попередить»; null when the exits could not be read, so none is claimed absent. */
  hasLimit: boolean | null;
  /** The weekend or a day off stands ahead (`weekendAhead`); never for a private company. */
  weekendAhead: boolean;
}>;

export type RiskFinding = Readonly<{
  reason: RiskReason;
  /** What the finding names: a company, a private company, a coin; null for the private companies together. */
  kind: RiskAssetKind | null;
  mint: string | null;
  symbol: string | null;
  name: string | null;
  /** The share of the wallet, per cent to one decimal, for a cap; null otherwise. */
  sharePct: number | null;
  /** The cap it is above, per cent; null otherwise. */
  capPct: number | null;
  /** For «Дія»: whether the loss limit or the target was reached. */
  watchReason: "limit" | "target" | null;
}>;

export type PortfolioRisk = Readonly<{
  state: RiskState;
  /** Every rule broken, the most urgent first; empty unless «Увага». */
  findings: readonly RiskFinding[];
  /** What could not be read; empty when every figure was. */
  gaps: readonly RiskGap[];
  /** The wallet's worth the shares are of — null where a part could not be read. */
  totalUsd: number | null;
  /** The one-asset cap was judged: every figure read and the wallet worth at least `CAPS_FROM_USD`. The private companies' cap is judged whenever every figure was read. */
  capsApplied: boolean;
}>;

export type PortfolioRiskInput = Readonly<{
  positions: readonly RiskPosition[];
  /** Every priced holding — companies, coins, dollars; an unpriced one is a gap or no market at all, never a guess. */
  assets: readonly RiskAsset[];
  gaps: readonly RiskGap[];
}>;

/** Friday through Sunday in New York — from the day of the last session before the weekend to its end. */
export function weekendInNewYork(nowMs: number): boolean {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(nowMs);
  return day === "Fri" || day === "Sat" || day === "Sun";
}

/** A closed exchange opens again further off than a night's close: a day off. */
export const DAY_OFF_MS = 24 * 3_600_000;

/**
 * The weekend or a day off stands ahead of a listed company: New York's
 * Friday to Sunday, or its exchange closed and — by the source's own next
 * open — opening more than a day away. A nightly close is not a weekend.
 */
export function weekendAhead(input: Readonly<{ nowMs: number; exchangeClosed: boolean; closedUntil: string | null | undefined }>): boolean {
  if (weekendInNewYork(input.nowMs)) return true;
  if (!input.exchangeClosed || !input.closedUntil) return false;
  const opens = Date.parse(input.closedUntil);
  return Number.isFinite(opens) && opens - input.nowMs > DAY_OFF_MS;
}

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

const finding = (reason: RiskReason, over: Partial<RiskFinding>): RiskFinding => ({
  reason,
  kind: null,
  mint: null,
  symbol: null,
  name: null,
  sharePct: null,
  capPct: null,
  watchReason: null,
  ...over,
});

export function judgePortfolioRisk(input: PortfolioRiskInput): PortfolioRisk {
  const gaps = RISK_GAPS.filter((gap) => input.gaps.includes(gap));
  const findings: RiskFinding[] = [];

  /* Certain on what was read, whatever else was not. */
  for (const position of input.positions) {
    if (position.state !== "action") continue;
    findings.push(finding("action", { kind: position.kind, mint: position.mint, symbol: position.symbol, name: position.name, watchReason: position.reason === "target" ? "target" : "limit" }));
  }
  for (const position of input.positions) {
    if (position.kind !== "company" || position.hasLimit !== false || !position.weekendAhead) continue;
    findings.push(finding("weekend-no-limit", { kind: position.kind, mint: position.mint, symbol: position.symbol, name: position.name }));
  }

  const total = input.assets.reduce((sum, asset) => sum + (Number.isFinite(asset.valueUsd) && asset.valueUsd > 0 ? asset.valueUsd : 0), 0);
  const complete = gaps.length === 0;
  const capsApplied = complete && total >= CAPS_FROM_USD;
  if (capsApplied) {
    /* One asset: a company across its tokens, named by its largest token — from a $500 wallet up. */
    const groups = new Map<string, { value: number; top: RiskAsset }>();
    for (const asset of input.assets) {
      if (asset.kind === "dollar" || !(asset.valueUsd > 0)) continue;
      const group = groups.get(asset.key);
      if (!group) groups.set(asset.key, { value: asset.valueUsd, top: asset });
      else groups.set(asset.key, { value: group.value + asset.valueUsd, top: asset.valueUsd > group.top.valueUsd ? asset : group.top });
    }
    const over = [...groups.values()]
      .map((group) => ({ ...group, share: oneDecimal((group.value / total) * 100) }))
      .filter((group) => group.share > ASSET_CAP_PCT)
      .sort((a, b) => b.share - a.share);
    for (const group of over) {
      findings.push(finding("concentration", { kind: group.top.kind, mint: group.top.mint, symbol: group.top.symbol, name: group.top.name, sharePct: group.share, capPct: ASSET_CAP_PCT }));
    }
  }
  /* The private companies together — whatever the wallet's size, once every figure is read. */
  if (complete && total > 0) {
    const privateValue = input.assets.reduce((sum, asset) => sum + (asset.kind === "private" && asset.valueUsd > 0 ? asset.valueUsd : 0), 0);
    const privateShare = oneDecimal((privateValue / total) * 100);
    if (privateShare > PRIVATE_CAP_PCT) findings.push(finding("private-share", { kind: "private", sharePct: privateShare, capPct: PRIVATE_CAP_PCT }));
  }

  const state: RiskState = findings.length > 0 ? "attention" : complete ? "normal" : "unknown";
  return { state, findings, gaps, totalUsd: complete ? Math.round(total * 100) / 100 : null, capsApplied };
}
