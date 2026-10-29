/**
 * Ryntra on Solana's spending limits on the Subscriptions program (SOL-7, decision 58; Solana Foundation, audited by
 * Cantina, `@solana/subscriptions`): the rules a draft must keep before a byte is built, and what a limit read from the
 * chain means today. No I/O and no `@solana/web3.js` here: the page, the routes, the tests and the devnet pass read the
 * same rules.
 *
 * - The person gives a limit from their own wallet: a fixed amount with an end date, an amount every period with an end
 *   date, or a merchant's plan. Their wallet signs and pays the rent; Ryntra takes no fee and holds no role.
 * - Every fixed or recurring limit Ryntra builds ends: the program's own advice is a finite expiry, and a held signature
 *   can then never open an allowance without end. A merchant's plan ends when the plan does: a plan without a last date
 *   (`endTs` 0) charges each period until the person cancels — its Review says so as a risk.
 * - What a limit allows today is read from the chain and the program's own arithmetic, never assumed: a limit whose
 *   token approval, authority or plan could not be read is «unknown», never «active» (the program's README: an
 *   on-chain «active» is not proof of collectability).
 *
 * Amounts are raw base units as bigints; a person's «1.5» is read once by `parseAmount` (the treasury's), never through
 * a float.
 */

export { formatRaw, parseAmount } from "../treasury/model.ts";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A Solana address: base58 that decodes to exactly 32 bytes — a 44-character string of «1»s is not one. */
export function isAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let number = 0n;
  for (const char of value) number = number * 58n + BigInt(ALPHABET.indexOf(char));
  let bytes = 0;
  for (let rest = number; rest > 0n; rest >>= 8n) bytes += 1;
  const leading = value.length - value.replace(/^1+/, "").length;
  return leading + bytes === 32;
}

export const ALLOWANCE_NETWORKS = ["devnet", "mainnet"] as const;
export type AllowanceNetwork = (typeof ALLOWANCE_NETWORKS)[number];
export type AllowanceChain = "solana:devnet" | "solana:mainnet";

/** The Wallet Standard chain each network signs on. */
export const ALLOWANCE_CHAIN: Readonly<Record<AllowanceNetwork, AllowanceChain>> = {
  devnet: "solana:devnet",
  mainnet: "solana:mainnet",
};

/**
 * Where the limits are served: the deployment names the network (`NEXT_PUBLIC_RYNTRA_ALLOWANCES_NETWORK`), else they
 * are not served at all. Devnet first; mainnet is the operator's canary (the registry's SOL-7 row) — one variable, set by
 * the operator, and the same one draws the menu's row.
 */
export function allowanceNetworkFrom(value: string | undefined | null): AllowanceNetwork | null {
  const named = value?.trim().toLowerCase();
  if (named === "devnet") return "devnet";
  if (named === "mainnet" || named === "mainnet-beta") return "mainnet";
  return null;
}

/** The Subscriptions program, the same address on both networks (Solana Foundation; audits: Cantina, 2026). */
export const SUBSCRIPTIONS_PROGRAM = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** The token a limit is given in here: USDC, Circle's on each network (the devnet one is Circle's faucet mint). */
export const USDC = Object.freeze({
  symbol: "USDC",
  decimals: 6,
  mint: Object.freeze({ devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }) as Readonly<Record<AllowanceNetwork, string>>,
});

export function usdcMint(network: AllowanceNetwork): string {
  return USDC.mint[network];
}

/* ─── Kinds, periods and terms ──────────────────────────────────────────────── */

export const ALLOWANCE_KINDS = ["fixed", "recurring", "subscription"] as const;
export type AllowanceKind = (typeof ALLOWANCE_KINDS)[number];

const DAY = 24 * 60 * 60;

/** A recurring limit's period. «Month» is thirty days, said so on the page: the program counts seconds, not months. */
export const PERIODS = Object.freeze({ day: DAY, week: 7 * DAY, month: 30 * DAY });
export type PeriodId = keyof typeof PERIODS;
export const PERIOD_IDS = Object.keys(PERIODS) as PeriodId[];

/** How long a limit lives, chosen from a short list: a fixed one from a day to three months, a recurring one longer. */
export const TERMS_S = Object.freeze({
  fixed: [DAY, 7 * DAY, 30 * DAY, 90 * DAY] as const,
  recurring: [30 * DAY, 90 * DAY, 180 * DAY, 365 * DAY] as const,
});
export const MAX_TERM_S = 366 * DAY;

/** Rent of the program's accounts: (128 + bytes) × 6 960 lamports, returned when the account closes. */
export function rentExemptLamports(bytes: number): bigint {
  return BigInt(128 + bytes) * 6_960n;
}
export const ACCOUNT_BYTES = Object.freeze({ authority: 106, fixed: 187, recurring: 211, subscription: 155, tokenAccount: 165 });

/* ─── Drafts ────────────────────────────────────────────────────────────────── */

export type AllowanceIssueCode =
  | "AMOUNT"
  | "DELEGATEE_ADDRESS"
  | "DELEGATEE_IS_SELF"
  | "TERM_RANGE"
  | "PERIOD"
  | "PERIOD_LONGER_THAN_TERM"
  | "PLAN_ADDRESS"
  | "RECIPIENT_ADDRESS";

export type AllowanceIssue = Readonly<{ code: AllowanceIssueCode; at?: string }>;


export type LimitDraft = Readonly<{
  kind: "fixed" | "recurring";
  wallet: string;
  delegatee: string;
  amountRaw: bigint | null;
  termSeconds: number;
  period?: PeriodId | null;
}>;

/** Every rule a fixed or recurring limit breaks, before a byte is built; the server asks the same again. */
export function limitIssues(draft: LimitDraft): AllowanceIssue[] {
  const issues: AllowanceIssue[] = [];
  if (!isAddress(draft.delegatee)) issues.push({ code: "DELEGATEE_ADDRESS", at: draft.delegatee });
  else if (draft.delegatee === draft.wallet) issues.push({ code: "DELEGATEE_IS_SELF" });
  if (draft.amountRaw === null || draft.amountRaw <= 0n || draft.amountRaw > U64_MAX) issues.push({ code: "AMOUNT" });
  if (!Number.isInteger(draft.termSeconds) || draft.termSeconds < 60 * 60 || draft.termSeconds > MAX_TERM_S) issues.push({ code: "TERM_RANGE" });
  if (draft.kind === "recurring") {
    const period = draft.period ? PERIODS[draft.period] : undefined;
    if (!period) issues.push({ code: "PERIOD" });
    else if (period > draft.termSeconds) issues.push({ code: "PERIOD_LONGER_THAN_TERM" });
  }
  return issues;
}

export const U64_MAX = 18_446_744_073_709_551_615n;

/* ─── What a limit read from the chain allows today ─────────────────────────── */

/**
 * - `active` — the delegatee may take up to `availableRaw` now;
 * - `scheduled` — a recurring limit whose first period has not begun;
 * - `spent` — a fixed limit used to the end;
 * - `expired` — past its end date; nothing more can be taken;
 * - `cancelled` — a subscription cancelled by the person: the merchant may still take what is left of the paid period
 *   until `endsAt`, then nothing;
 * - `ended` — a subscription past its last date, or whose plan was closed or changed: nothing more can be taken;
 * - `stopped` — the person stopped every limit on this token (or replaced its authority): nothing can be taken;
 * - `blocked` — the token account no longer lets the program spend (another approval replaced it, the account is
 *   frozen or closed): nothing can be taken until the person approves again;
 * - `unknown` — the authority, the token account or the plan could not be read: never shown as active.
 */
/** Why a `blocked` limit cannot be used: each said in its own words on the page. */
export const BLOCKED_BY = ["frozen", "noAccount", "approvalOther", "approvalRevoked", "approvalUsed"] as const;
export type BlockedBy = (typeof BLOCKED_BY)[number];

export const ALLOWANCE_STATUSES = ["active", "scheduled", "spent", "expired", "cancelled", "ended", "stopped", "blocked", "unknown"] as const;
export type AllowanceStatus = (typeof ALLOWANCE_STATUSES)[number];

/** Statuses after which nothing can ever be taken again: the account only waits to be closed for its rent. */
export const TERMINAL: ReadonlySet<AllowanceStatus> = new Set(["spent", "expired", "ended"]);

export type AuthorityRead = Readonly<{ state: "present"; address: string; initId: bigint; payer: string }> | Readonly<{ state: "absent" }> | Readonly<{ state: "unread" }>;

export type TokenAccountRead =
  | Readonly<{ state: "present"; address: string; balanceRaw: bigint; delegate: string | null; delegatedRaw: bigint; frozen: boolean }>
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "unread" }>;

export type PlanRead =
  | Readonly<{ state: "present"; address: string; owner: string; planId: bigint; mint: string; active: boolean; endTs: bigint; amountRaw: bigint; periodHours: bigint; createdAt: bigint; destinations: readonly string[]; pullers: readonly string[] }>
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "unread" }>;

export type HeaderRead = Readonly<{ delegator: string; delegatee: string; payer: string; initId: bigint }>;

export type DelegationRead =
  | Readonly<{ kind: "fixed"; address: string; header: HeaderRead; mint: string; remainingRaw: bigint; expiryTs: bigint }>
  | Readonly<{ kind: "recurring"; address: string; header: HeaderRead; mint: string; periodStartTs: bigint; periodSeconds: bigint; expiryTs: bigint; perPeriodRaw: bigint; pulledInPeriodRaw: bigint }>
  | Readonly<{ kind: "subscription"; address: string; header: HeaderRead; amountRaw: bigint; periodHours: bigint; createdAt: bigint; pulledInPeriodRaw: bigint; periodStartTs: bigint; expiresAtTs: bigint }>;

export type PeriodNow = Readonly<{ startTs: bigint; endTs: bigint; pulledRaw: bigint; started: boolean }>;

/**
 * The period a pull made now would count against, by the program's own arithmetic (`validate_recurring_transfer`):
 * whole periods roll the start forward and reset what was pulled, never to a start at or after a finite `expiryTs`.
 */
export function periodNow(startTs: bigint, periodSeconds: bigint, pulledRaw: bigint, expiryTs: bigint, now: bigint): PeriodNow {
  if (periodSeconds <= 0n) return { startTs, endTs: startTs, pulledRaw, started: now >= startTs };
  if (now < startTs) return { startTs, endTs: startTs + periodSeconds, pulledRaw, started: false };
  let start = startTs;
  let pulled = pulledRaw;
  const since = now - startTs;
  if (since >= periodSeconds) {
    const candidate = startTs + (since / periodSeconds) * periodSeconds;
    if (expiryTs === 0n || candidate < expiryTs) {
      start = candidate;
      pulled = 0n;
    } else {
      const lastBillable = expiryTs - 1n;
      if (lastBillable >= startTs) {
        const lastStart = startTs + ((lastBillable - startTs) / periodSeconds) * periodSeconds;
        if (lastStart > startTs) {
          start = lastStart;
          pulled = 0n;
        }
      }
    }
  }
  let end = start + periodSeconds;
  if (expiryTs !== 0n && end > expiryTs) end = expiryTs;
  return { startTs: start, endTs: end, pulledRaw: pulled, started: true };
}

const min = (...values: bigint[]) => values.reduce((a, b) => (b < a ? b : a));

export type AllowanceNow = Readonly<{
  status: AllowanceStatus;
  /** What the delegatee may take this moment: the limit's room, the balance and the approval, the smallest. Null — not active. */
  availableRaw: bigint | null;
  /** Room left by the limit's own terms (in the current period for a recurring one), whatever the balance. */
  roomRaw: bigint;
  /** Pulled in the current period (recurring, subscription). */
  spentInPeriodRaw: bigint | null;
  periodEndsAt: bigint | null;
  /** The last moment anything can be taken: the end date, a cancelled subscription's end, a plan's end. 0 — none. */
  endsAt: bigint;
  /** Blocked: why — a frozen or missing account, an approval taken, revoked or used up. Null — not blocked. */
  blockedBy: BlockedBy | null;
}>;

/** Why the token account no longer lets the program spend, or null when it does. */
export function blockedBy(tokenAccount: Extract<TokenAccountRead, { state: "present" }> | Readonly<{ state: "absent" }>, authorityAddress: string): BlockedBy | null {
  if (tokenAccount.state === "absent") return "noAccount";
  if (tokenAccount.frozen) return "frozen";
  if (tokenAccount.delegate === null) return "approvalRevoked";
  if (tokenAccount.delegate !== authorityAddress) return "approvalOther";
  if (tokenAccount.delegatedRaw === 0n) return "approvalUsed";
  return null;
}

export type AllowanceContext = Readonly<{
  /** The delegator's authority for the limit's mint. */
  authority: AuthorityRead;
  /** The delegator's token account for the limit's mint. */
  tokenAccount: TokenAccountRead;
  /** A subscription's plan; ignored for the other kinds. */
  plan?: PlanRead;
  now: bigint;
}>;

/** What one limit allows now. «Unknown» wins over «active»: a read that failed is never a green light. */
export function allowanceNow(delegation: DelegationRead, context: AllowanceContext): AllowanceNow {
  const { now, authority, tokenAccount } = context;
  let room = 0n;
  let spentInPeriod: bigint | null = null;
  let periodEndsAt: bigint | null = null;
  let endsAt = 0n;
  let notYet = false;
  let lifecycle: AllowanceStatus | null = null;

  if (delegation.kind === "fixed") {
    room = delegation.remainingRaw;
    endsAt = delegation.expiryTs;
    if (delegation.expiryTs !== 0n && now > delegation.expiryTs) lifecycle = "expired";
    else if (delegation.remainingRaw === 0n) lifecycle = "spent";
  } else if (delegation.kind === "recurring") {
    endsAt = delegation.expiryTs;
    const period = periodNow(delegation.periodStartTs, delegation.periodSeconds, delegation.pulledInPeriodRaw, delegation.expiryTs, now);
    room = delegation.perPeriodRaw > period.pulledRaw ? delegation.perPeriodRaw - period.pulledRaw : 0n;
    spentInPeriod = period.pulledRaw;
    periodEndsAt = period.endTs;
    notYet = !period.started;
    if (delegation.expiryTs !== 0n && now > delegation.expiryTs) lifecycle = "expired";
  } else {
    const plan = context.plan ?? { state: "unread" as const };
    const periodSeconds = delegation.periodHours * 3_600n;
    const planEnd = plan.state === "present" ? plan.endTs : 0n;
    const period = periodNow(delegation.periodStartTs, periodSeconds, delegation.pulledInPeriodRaw, planEnd, now);
    room = delegation.amountRaw > period.pulledRaw ? delegation.amountRaw - period.pulledRaw : 0n;
    spentInPeriod = period.pulledRaw;
    periodEndsAt = period.endTs;
    endsAt = delegation.expiresAtTs !== 0n ? delegation.expiresAtTs : planEnd;
    if (plan.state === "absent") lifecycle = "ended";
    else if (plan.state === "present") {
      const termsMatch = plan.amountRaw === delegation.amountRaw && plan.periodHours === delegation.periodHours && plan.createdAt === delegation.createdAt;
      if (!termsMatch || (plan.endTs !== 0n && now > plan.endTs)) lifecycle = "ended";
    }
    if (!lifecycle && delegation.expiresAtTs !== 0n && now >= delegation.expiresAtTs) lifecycle = "ended";
    /* An unread plan wins over «cancelled»: what the merchant may still take is not known then. */
    if (!lifecycle && plan.state === "unread") lifecycle = "unknown";
    if (!lifecycle && delegation.expiresAtTs !== 0n) lifecycle = "cancelled";
  }

  const out = (status: AllowanceStatus, available: bigint | null = null, blocked: BlockedBy | null = null): AllowanceNow => ({ status, availableRaw: available, roomRaw: room, spentInPeriodRaw: spentInPeriod, periodEndsAt, endsAt, blockedBy: blocked });

  if (lifecycle && TERMINAL.has(lifecycle)) return out(lifecycle);
  if (lifecycle === "unknown") return out("unknown");
  if (authority.state === "unread" || tokenAccount.state === "unread") return out("unknown");
  if (authority.state === "absent" || authority.initId !== delegation.header.initId) return out("stopped");
  const blocked = blockedBy(tokenAccount, authority.address);
  if (blocked || tokenAccount.state !== "present") return out("blocked", null, blocked ?? "noAccount");
  if (notYet) return out("scheduled");
  const available = min(room, tokenAccount.balanceRaw, tokenAccount.delegatedRaw);
  /* A cancelled subscription still lets the merchant take the rest of the paid period: said with its amount, not hidden. */
  return out(lifecycle === "cancelled" ? "cancelled" : "active", available);
}

/** What the person may do with a limit they gave, by its kind and status. */
export function delegatorActions(delegation: DelegationRead, now: AllowanceNow, nowTs: bigint): readonly ("revoke" | "cancel" | "close")[] {
  if (delegation.kind !== "subscription") return [TERMINAL.has(now.status) || now.status === "stopped" ? "close" : "revoke"];
  if (delegation.expiresAtTs === 0n) return ["cancel"];
  return nowTs >= delegation.expiresAtTs ? ["close"] : [];
}

/** Lamports a closing account returns to its payer, by the program's account sizes. */
export function rentOf(kind: AllowanceKind): bigint {
  return rentExemptLamports(ACCOUNT_BYTES[kind]);
}
