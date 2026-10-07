/**
 * The names a reminder travels under: its trigger identity, the `mon_` id its
 * note carries, and the link one tap lands on. Pure and client-safe, so the
 * tick, the delivery and the deep link read one definition.
 */

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Whether a rule's asset is a token of the venue's list (1.31.0) rather than a company. */
function listedToken(asset: Readonly<{ kind?: string | null }>): boolean {
  return asset.kind === "crypto" || asset.kind === "meme";
}

/**
 * What a note carries to find its asset again: a company's symbol, or
 * (1.31.0) a token's mint — a token's symbol names nothing for certain.
 */
export function assetRefOf(asset: Readonly<{ symbol: string; mint: string; kind?: string | null }>): string {
  return listedToken(asset) ? asset.mint : asset.symbol;
}

/**
 * The trigger identity of one occurrence: a reminder is written once per rule
 * and due instant, whatever the ticks. It carries the company's symbol — a
 * token's mint (1.31.0) — after `@`, so a note still leads to its asset after
 * the rule is removed.
 */
export function reminderIdentity(ruleId: string, dueAt: string, symbol: string): string {
  return `autoinvest:${ruleId}:${new Date(Date.parse(dueAt)).toISOString()}@${encodeURIComponent(symbol)}`;
}

const DEFERRED_MARK = "~deferred";

/**
 * The identity of the note that an occurrence's purchase is deferred by the
 * price condition (1.18.0): once per occurrence, apart from its reminder —
 * the same rule, instant and symbol, marked, so every reader of a reminder's
 * identity finds the occurrence and the company in it too.
 */
export function deferralIdentity(ruleId: string, dueAt: string, symbol: string): string {
  return `autoinvest:${ruleId}:${new Date(Date.parse(dueAt)).toISOString()}${DEFERRED_MARK}@${encodeURIComponent(symbol)}`;
}

/** Whether an identity is a deferral's note rather than a reminder. */
export function isDeferralIdentity(identity: string): boolean {
  return identity.startsWith("autoinvest:") && identity.split("@")[0].endsWith(DEFERRED_MARK);
}

/** The due instant a reminder's (or a deferral's) identity names, or null for an identity that is not this rule's. */
export function dueOfIdentity(identity: string, ruleId: string): string | null {
  const prefix = `autoinvest:${ruleId}:`;
  if (!identity.startsWith(prefix)) return null;
  const marked = identity.slice(prefix.length).split("@")[0];
  const due = marked.endsWith(DEFERRED_MARK) ? marked.slice(0, -DEFERRED_MARK.length) : marked;
  return Number.isFinite(Date.parse(due)) ? due : null;
}

/** The company symbol — or a token's mint (1.31.0) — a reminder's identity carries, or null. */
export function symbolOfIdentity(identity: string): string | null {
  if (!identity.startsWith("autoinvest:")) return null;
  const at = identity.lastIndexOf("@");
  if (at < 0) return null;
  try {
    const symbol = decodeURIComponent(identity.slice(at + 1));
    return /^[A-Za-z0-9._-]{1,32}$/.test(symbol) || MINT_SHAPE.test(symbol) ? symbol : null;
  } catch {
    return null;
  }
}

/** Where a reminder lands once its rule is gone: the company itself, a plain purchase — never a loop back to Monitoring. */
export function companyHref(symbol: string): string {
  return `/app/stocks/${encodeURIComponent(symbol)}`;
}

/** The same for what a note carries: a token's mint opens its market (1.31.0), a company's symbol its page. */
export function assetHrefOfRef(ref: string): string {
  return MINT_SHAPE.test(ref) ? `/app/spot?mint=${encodeURIComponent(ref)}` : companyHref(ref);
}

/** A rule's asset on its own, no reminder: the company's page, or the token's market in Spot (1.31.0). */
export function ruleAssetHref(rule: Readonly<{ asset: Readonly<{ symbol: string; mint: string; kind?: string | null }> }>): string {
  return listedToken(rule.asset) ? `/app/spot?mint=${encodeURIComponent(rule.asset.mint)}` : companyHref(rule.asset.symbol);
}

/** The monitor id a rule's notes carry — the contract's `mon_` shape, derived from the rule id; a rule is not a monitor and no monitor has it. */
export function ruleMonitorId(ruleId: string): string {
  return `mon_${ruleId.slice("rule_".length, "rule_".length + 24)}`;
}

/**
 * Where one tap on a reminder lands: the company, with the rule and the
 * occurrence — the page reads the rule afresh and opens the Review on its
 * sum; a token of the venue's list (1.31.0) — its market in Spot, the order
 * set to the rule's purchase the same way.
 */
export function rulePurchaseHref(rule: Readonly<{ id: string; asset: Readonly<{ symbol: string; mint: string; kind?: string | null }> }>, dueAt: string): string {
  if (listedToken(rule.asset)) return `/app/spot?mint=${encodeURIComponent(rule.asset.mint)}&rule=${rule.id}&due=${encodeURIComponent(dueAt)}`;
  return `/app/stocks/${encodeURIComponent(rule.asset.symbol)}?rule=${rule.id}&due=${encodeURIComponent(dueAt)}`;
}

/**
 * The trigger identity of the note that a wallet's month's budget is spent
 * (1.13.0): once per wallet, month and ceiling — a larger ceiling spent again
 * in the same month is a new event, the same one never a second note.
 */
export function budgetSpentIdentity(owner: string, monthKey: string, capUsd: number): string {
  return `autoinvest-budget:${owner}:${monthKey}:${Math.round(capUsd * 100)}`;
}

/** The subject id of that note: «budget:2026-09». */
export function budgetSubjectId(monthKey: string): string {
  return `budget:${monthKey}`;
}

/** The monitor id the budget's notes carry — the contract's `mon_` shape, derived from the wallet; the budget is not a monitor and no monitor has it. */
export function budgetMonitorId(owner: string): string {
  let hash = 0x811c9dc5;
  let second = 0x01000193;
  for (const char of owner) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    second = Math.imul(second ^ char.charCodeAt(0), 0x5bd1e995) >>> 0;
  }
  const third = Math.imul(hash ^ second, 0x27d4eb2d) >>> 0;
  return `mon_${[hash, second, third].map((part) => part.toString(16).padStart(8, "0")).join("")}`;
}

/** Where one tap on that note lands: Home, the budget's sheet open. */
export const BUDGET_HREF = "/app/home?budget=edit";
