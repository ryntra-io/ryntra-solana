import type { WorkspaceLocale } from "@/app/shell/locale";
import type { LaunchMarketHealthResponse, LaunchMarketRuleView } from "@/lib/api/v1/contract";

import { formatDate, formatMoneyShort } from "./launch-format";
import type { LaunchWordKey, launchWords } from "./launch-words";

type Word = ReturnType<typeof launchWords>;
type CycleState = LaunchMarketHealthResponse["state"]["code"];
type Pair = LaunchMarketHealthResponse["pair"];

/**
 * How a state reads at a glance: on the curve, live on the DEX, Ryntra's ladder working, or worth a look. The colour is
 * never the only sign — the state's word stands beside it.
 */
export function stateTone(code: CycleState): "curve" | "live" | "ladder" | "caution" {
  switch (code) {
    case "CREATED":
    case "PRICE_DISCOVERY":
    case "GRADUATION_READY":
    case "MIGRATING":
      return "curve";
    case "CORE_MARKET_LIVE":
    case "ENDOWMENT_FUNDED":
    case "MATURE":
      return "live";
    case "LADDER_ACTIVE":
    case "MAINTAINING":
      return "ladder";
    case "PAUSED_RISK":
    case "MIGRATION_FAILED":
    case "ENDOWMENT_EXHAUSTED":
      return "caution";
  }
}

/** A raw amount of the pair currency as money: «$148», «12,3 тис. COMM». */
export function pairMoney(raw: string, pair: Pair, locale: WorkspaceLocale): string {
  return formatMoneyShort(Number(raw) / 10 ** pair.decimals, locale, pair.dollar, pair.symbol);
}

/** Whole days, said as days: «менше доби», «3 дн.», “1 day”, “3 days”. */
export function daysText(days: number, word: Word): string {
  if (days === 0) return word("underADay");
  return word(days === 1 ? "daysOne" : "daysMany", { n: days });
}

/** How long ago, in whole units: «2 год тому», «3 дн. тому»; a date beyond a month. */
export function sinceText(at: string, word: Word, locale: WorkspaceLocale, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / 1000));
  if (seconds >= 30 * 86_400) return formatDate(at, locale);
  if (seconds < 60) return word("justNow");
  const time = seconds < 3600 ? word("min", { n: Math.floor(seconds / 60) }) : seconds < 86_400 ? word("hour", { n: Math.floor(seconds / 3600) }) : word("day", { n: Math.floor(seconds / 86_400) });
  return word("ago", { time });
}

/** A date in a dense row: «30 груд.» this year, «6 квіт. 2027» another — the year only where it differs. */
export function shortDate(at: string | number, locale: WorkspaceLocale, now: number = Date.now()): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  /* A date never breaks across lines in a narrow cell: its own spaces do not wrap. */
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })
    .format(date)
    .replace(/ /g, "\u00a0");
}

/** When a state began: «з 7 жовт.» from a day back, «3 год тому» within the day. */
export function sinceShort(at: string, word: Word, locale: WorkspaceLocale, now: number = Date.now()): string {
  if (now - Date.parse(at) < 86_400_000) return sinceText(at, word, locale, now);
  const date = new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "short" }).format(new Date(at));
  return word("stateSince", { when: date });
}

const KEEPER_WORD: Readonly<Record<LaunchMarketRuleView["by"], LaunchWordKey>> = {
  "token-2022": "keeper_token2022",
  "meteora-dbc": "keeper_meteoraDbc",
  "meteora-damm-v2": "keeper_meteoraDammV2",
  "met-lock": "keeper_metLock",
  "dynamic-fee-sharing": "keeper_feeSharing",
  ryntra: "keeper_ryntra",
};

export function keeperWord(by: LaunchMarketRuleView["by"], word: Word): string {
  return word(KEEPER_WORD[by]);
}

/**
 * The rules «Чесний лаунч» shows on this very page, from the marks its receipt holds now — the token's own, the curve
 * holding the money, the pool's locks, the creator's lock: «Здоров'я ринку» points there rather than saying them twice,
 * and says any the receipt does not show.
 */
export function rulesShownInMarks(marks: readonly string[]): ReadonlySet<string> {
  return new Set(marks.map((code) => (code === "CREATOR_BUY_LOCKED" ? "CREATOR_LOCK" : code)));
}

/** A rule's sentence, its figures put in: the threshold as money, a share, a date. */
export function ruleText(rule: LaunchMarketRuleView, pair: Pair, word: Word, locale: WorkspaceLocale, now: number = Date.now()): string {
  const value = (name: string) => rule.values[name];
  switch (rule.code) {
    case "GRADUATION_AT_THRESHOLD":
      return word("rule_GRADUATION_AT_THRESHOLD", { amount: pairMoney(String(value("thresholdRaw") ?? "0"), pair, locale) });
    case "CREATOR_LOCK": {
      /* Whole until the cliff, then freed step by step until the end of the vesting. */
      const cliff = value("cliffAt");
      const ends = value("endsAt");
      if (typeof cliff === "number" && cliff * 1000 > now) return word("rule_CREATOR_LOCK", { date: formatDate(cliff * 1000, locale) });
      if (typeof ends === "number") return word("rule_CREATOR_LOCK_vesting", { date: formatDate(ends * 1000, locale) });
      return word("rule_CREATOR_LOCK_unread");
    }
    case "CREATOR_FIRST_BUY_CAP":
      return word("rule_CREATOR_FIRST_BUY_CAP", { pct: pct(Number(value("capBps") ?? 0), locale) });
    case "CONCENTRATION_MARK":
      return word("rule_CONCENTRATION_MARK", { pct: pct(Number(value("markBps") ?? 0), locale) });
    case "LP_LOCKED_FOREVER":
      /* Whose share it is: the creator's, or Ryntra's as the config's partner. */
      return value("owner") === "creator" ? word("mark_LP_LOCKED_FOREVER_creator") : value("owner") === "partner" ? word("mark_LP_LOCKED_FOREVER_partner") : word("rule_LP_LOCKED_FOREVER");
    /* The token's own rules read as «Чесний лаунч» says them. */
    case "MINT_REVOKED":
    case "NO_FREEZE":
    case "METADATA_FIXED":
    case "NO_TRANSFER_HOOK":
      return word(`mark_${rule.code}`);
    default:
      return word(`rule_${rule.code}` as LaunchWordKey);
  }
}

/** A share in whole per cent where it is whole: «60 %», «2 %», «12,5 %». */
export function pct(bps: number, locale: WorkspaceLocale): string {
  const value = bps / 100;
  const text = new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", { maximumFractionDigits: Number.isInteger(value) ? 0 : 1 }).format(value);
  return locale === "uk" ? `${text} %` : `${text}%`;
}
