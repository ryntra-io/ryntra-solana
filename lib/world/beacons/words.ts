import type { BeaconCondition, BeaconRule, MovePeriod, TowerRead } from "./rules.ts";

/**
 * How a beacon reads to a person — on its tower in the city and in the
 * Telegram message. Short: a ticker, the condition, the number now. No ids,
 * no sources, no engine words.
 */

const PERIOD: Readonly<Record<MovePeriod, string>> = { "5m": "5m", "1h": "1h", "24h": "24h" };

/** Dollars as people read them: small prices keep their digits, large sums fold to K, M, B. */
export function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(value / 1e6)}M`;
  if (abs >= 1e4) return `$${trim(value / 1e3)}K`;
  if (abs >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (abs === 0) return "$0";
  return `$${Number(value.toPrecision(3)).toLocaleString("en-US", { maximumSignificantDigits: 3, maximumFractionDigits: 12 })}`;
}

const trim = (n: number) => Number(n.toPrecision(3)).toString();

export function pct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
}

export function conditionWords(c: BeaconCondition): string {
  const op = c.op === "above" ? "above" : "below";
  switch (c.kind) {
    case "price":
      return `Price ${op} ${usd(c.value)}`;
    case "liquidity":
      return `Liquidity ${op} ${usd(c.value)}`;
    case "move":
      return `${PERIOD[c.period]} move ${op} ${pct(c.value)}`;
  }
}

/** A rule in one line: «and» inside a group, «or» between groups. */
export function ruleWords(rule: Pick<BeaconRule, "groups">): string {
  return rule.groups.map((group) => group.map(conditionWords).join(" and ")).join(" or ");
}

/** The number a condition reads, as it stands now. */
export function nowWords(c: BeaconCondition, tower: TowerRead): string {
  switch (c.kind) {
    case "price":
      return usd(tower.price);
    case "liquidity":
      return usd(tower.liquidity);
    case "move":
      return pct(c.period === "5m" ? tower.change5m : c.period === "1h" ? tower.change1h : tower.change24h);
  }
}

const ticker = (symbol: string) => (symbol ? `$${symbol.replace(/^\$/, "").toUpperCase()}` : "Your tower");

/** The Telegram message of one firing: plain text, three short lines and the tower's link. */
export function telegramWords(rule: BeaconRule, tower: TowerRead, link: string): string {
  const first = rule.groups.flat()[0];
  const now = first ? `Now ${nowWords(first, tower)}` : "";
  return [`Ryntra · Beacon lit`, `${ticker(rule.symbol)} · ${ruleWords(rule)}`, now, link].filter(Boolean).join("\n");
}
