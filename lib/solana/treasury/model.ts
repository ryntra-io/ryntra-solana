/**
 * Ryntra on Solana's treasury on Squads v4 (SOL-4, decision 47, SOL-0 §3.2): the rules a draft must keep before a
 * single byte is built — the roles, the threshold and the delay, the payouts of one proposal, the spending limits as a
 * mandate and the agent's own small multisig. No I/O and no `@solana/web3.js` here: the page, the routes and the tests
 * read the same rules.
 *
 * - The multisig is the person's: their wallet creates it and pays for it, Ryntra takes no config authority (the
 *   multisig is autonomous — every change of it is a proposal its members vote on) and no fee.
 * - A spending limit is a mandate, always with its list of recipients: Squads reads an empty list as «anywhere», so
 *   an empty list is refused here, never sent.
 * - An agent gets a multisig of its own with a short delay and a small amount: a limit is revoked by a vote that waits
 *   the delay, and the delay is one for the whole multisig, so the main money never shares it with an agent.
 *
 * Amounts are raw base units as bigints; a person's «1.5» is read once by {@link parseAmount}, never through a float.
 */

export const TREASURY_NETWORKS = ["devnet", "mainnet"] as const;
export type TreasuryNetwork = (typeof TREASURY_NETWORKS)[number];

/** The Wallet Standard chain each network signs on. */
export const TREASURY_CHAIN: Readonly<Record<TreasuryNetwork, "solana:devnet" | "solana:mainnet">> = {
  devnet: "solana:devnet",
  mainnet: "solana:mainnet",
};

/** Squads v4, the same program on both networks (audited: Trail of Bits, Neodyme, OtterSec, Certora). */
export const SQUADS_PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
/** Squads' own name for SOL in a spending limit: the default public key. */
export const NATIVE_MINT_KEY = "11111111111111111111111111111111";

export const TREASURY_ASSET_IDS = ["SOL", "USDC"] as const;
export type TreasuryAssetId = (typeof TREASURY_ASSET_IDS)[number];

export type TreasuryAsset = Readonly<{ id: TreasuryAssetId; symbol: string; decimals: number; mint: Readonly<Record<TreasuryNetwork, string>> | null }>;

export const TREASURY_ASSETS: Readonly<Record<TreasuryAssetId, TreasuryAsset>> = {
  SOL: { id: "SOL", symbol: "SOL", decimals: 9, mint: null },
  USDC: {
    id: "USDC",
    symbol: "USDC",
    decimals: 6,
    /* Circle's USDC on each network; the devnet one is Circle's faucet mint. */
    mint: { devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  },
};

/** The mint a limit or a payout names on a network; null for SOL. */
export function assetMint(asset: TreasuryAssetId, network: TreasuryNetwork): string | null {
  return TREASURY_ASSETS[asset].mint?.[network] ?? null;
}

/** Which asset a limit's mint is on this network; null — a mint this page does not name. */
export function assetOfMint(mint: string, network: TreasuryNetwork): TreasuryAssetId | null {
  if (mint === NATIVE_MINT_KEY) return "SOL";
  return TREASURY_ASSET_IDS.find((id) => assetMint(id, network) === mint) ?? null;
}

/**
 * Where the treasury is served: the deployment names the network (`NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK`), else it is
 * not served at all. Devnet first; mainnet is the operator's canary (the registry's SOL-4 row) — one variable, set by the
 * Owner, and the same one draws the menu's row.
 */
export function treasuryNetworkFrom(value: string | undefined | null): TreasuryNetwork | null {
  const named = value?.trim().toLowerCase();
  if (named === "devnet") return "devnet";
  if (named === "mainnet" || named === "mainnet-beta") return "mainnet";
  return null;
}

/* ─── Roles ───────────────────────────────────────────────────────────────── */

export const ROLES = ["initiate", "vote", "execute"] as const;
export type Role = (typeof ROLES)[number];

/** Squads' permission bits: Initiate 1, Vote 2, Execute 4. */
export const ROLE_BITS: Readonly<Record<Role, number>> = { initiate: 1, vote: 2, execute: 4 };

export type MemberDraft = Readonly<{ address: string; initiate: boolean; vote: boolean; execute: boolean }>;

export function roleMask(member: Pick<MemberDraft, Role>): number {
  return ROLES.reduce((mask, role) => (member[role] ? mask | ROLE_BITS[role] : mask), 0);
}

export function rolesOfMask(mask: number): Readonly<Record<Role, boolean>> {
  return { initiate: (mask & 1) !== 0, vote: (mask & 2) !== 0, execute: (mask & 4) !== 0 };
}

/* ─── Bounds ──────────────────────────────────────────────────────────────── */

/** Squads' own ceiling on the delay: three months. */
export const MAX_TIME_LOCK_S = 3 * 30 * 24 * 60 * 60;
/** The delays offered by name; any whole number of seconds up to the ceiling is kept as typed. */
export const TIME_LOCK_CHOICES_S = [0, 60 * 60, 24 * 60 * 60, 3 * 24 * 60 * 60, 7 * 24 * 60 * 60] as const;
export const MAX_MEMBERS = 10;
export const MAX_DESTINATIONS = 10;
export const MAX_SPENDERS = 5;
/** One proposal's payouts. Each is a line of one batch; a batch's lines execute one transaction at a time. */
export const MAX_PAYOUTS = 40;

/**
 * An agent's multisig: a short delay, so a limit is revoked within the hour, and a small amount per period. Not a
 * figure from the chain — Ryntra's own bound on what an agent may be handed here (decision 47: «платіжний агент —
 * лише з мандатом і малим бюджетом»).
 */
export const AGENT_TIME_LOCK_S = Object.freeze({ min: 60, max: 60 * 60, default: 10 * 60 });
export const AGENT_LIMIT_CAP_RAW: Readonly<Record<TreasuryAssetId, bigint>> = { SOL: 1_000_000_000n, USDC: 100_000_000n };

export const PERIODS = ["once", "day", "week", "month"] as const;
export type LimitPeriod = (typeof PERIODS)[number];
/** Squads' `Period`: OneTime 0, Day 1, Week 2, Month 3. */
export const PERIOD_CODE: Readonly<Record<LimitPeriod, number>> = { once: 0, day: 1, week: 2, month: 3 };
export function periodOfCode(code: number): LimitPeriod | null {
  return PERIODS.find((period) => PERIOD_CODE[period] === code) ?? null;
}

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isAddress(value: string): boolean {
  return BASE58_ADDRESS.test(value);
}

/* ─── Amounts ─────────────────────────────────────────────────────────────── */

/** «1.5», «1,5» or «1 000» in an asset's units → raw base units; null when it is not a positive amount the asset can hold. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  /* A space is a thousands separator only between groups of exactly three digits («1 000», «12 500,5»); anything else
     with a space is two numbers, never one glued together (a pasted sheet's second column is not more money). */
  if (/[\s\u00a0_]/.test(trimmed) && !/^\d{1,3}(?:[ \u00a0_]\d{3})+(?:[.,]\d*)?$/.test(trimmed)) return null;
  const compact = trimmed.replace(/[\s\u00a0_]/g, "");
  /* One decimal mark at most; a comma before exactly three digits after a whole number («1,000») reads as an English
     thousands mark as easily as a decimal one, so it is refused rather than guessed at. */
  if ((compact.match(/[.,]/g)?.length ?? 0) > 1) return null;
  if (/^[1-9]\d*,\d{3}$/.test(compact)) return null;
  const plain = compact.replace(",", ".");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(plain);
  if (!match) return null;
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction || "0").padEnd(decimals, "0"));
  if (raw <= 0n || raw > 18_446_744_073_709_551_615n) return null;
  return raw;
}

/** Raw base units → «1.5»: every digit the asset holds, trailing zeros dropped. */
export function formatRaw(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString();
  const fraction = decimals > 0 ? (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/* ─── Drafts and their issues ─────────────────────────────────────────────── */

export type TreasuryIssueCode =
  | "MEMBERS_EMPTY"
  | "MEMBERS_TOO_MANY"
  | "MEMBER_ADDRESS"
  | "MEMBER_TWICE"
  | "MEMBER_NO_ROLE"
  | "CREATOR_NOT_MEMBER"
  | "NO_INITIATOR"
  | "NO_VOTER"
  | "NO_EXECUTOR"
  | "THRESHOLD_RANGE"
  | "TIME_LOCK_RANGE"
  | "AGENT_TIME_LOCK_RANGE"
  | "AGENT_ADDRESS"
  | "AGENT_IS_CREATOR"
  | "LIMIT_AMOUNT"
  | "LIMIT_AGENT_CAP"
  | "LIMIT_SPENDERS_EMPTY"
  | "LIMIT_SPENDERS_TOO_MANY"
  | "LIMIT_SPENDER_ADDRESS"
  | "LIMIT_SPENDER_TWICE"
  | "LIMIT_DESTINATION_TWICE"
  | "LIMIT_DESTINATIONS_EMPTY"
  | "LIMIT_DESTINATIONS_TOO_MANY"
  | "LIMIT_DESTINATION_ADDRESS"
  | "PAYOUTS_EMPTY"
  | "PAYOUTS_TOO_MANY"
  | "PAYOUT_LINE"
  | "PAYOUT_ADDRESS"
  | "PAYOUT_AMOUNT"
  | "PAYOUT_TWICE"
  | "PAYOUT_TO_VAULT"
  | "PAYOUT_BELOW_RENT"
  | "PAYOUT_NOT_WALLET"
  | "LIMIT_DESTINATION_NOT_WALLET";

export type TreasuryIssue = Readonly<{ code: TreasuryIssueCode; at?: string; line?: number }>;

export type TreasuryDraft = Readonly<{ creator: string; members: readonly MemberDraft[]; threshold: number; timeLockSeconds: number }>;

function memberIssues(members: readonly MemberDraft[]): TreasuryIssue[] {
  const issues: TreasuryIssue[] = [];
  if (members.length === 0) issues.push({ code: "MEMBERS_EMPTY" });
  if (members.length > MAX_MEMBERS) issues.push({ code: "MEMBERS_TOO_MANY" });
  const seen = new Set<string>();
  for (const member of members) {
    if (!isAddress(member.address)) issues.push({ code: "MEMBER_ADDRESS", at: member.address });
    else if (seen.has(member.address)) issues.push({ code: "MEMBER_TWICE", at: member.address });
    seen.add(member.address);
    if (roleMask(member) === 0) issues.push({ code: "MEMBER_NO_ROLE", at: member.address });
  }
  return issues;
}

/** Whom the rules of a multisig need: someone to propose, enough to vote, someone to execute. */
function roleIssues(members: readonly Pick<MemberDraft, Role>[], threshold: number): TreasuryIssue[] {
  const issues: TreasuryIssue[] = [];
  const voters = members.filter((member) => member.vote).length;
  if (!members.some((member) => member.initiate)) issues.push({ code: "NO_INITIATOR" });
  if (voters === 0) issues.push({ code: "NO_VOTER" });
  if (!members.some((member) => member.execute)) issues.push({ code: "NO_EXECUTOR" });
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > Math.max(voters, 1)) issues.push({ code: "THRESHOLD_RANGE" });
  return issues;
}

export function timeLockIssues(seconds: number): TreasuryIssue[] {
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= MAX_TIME_LOCK_S ? [] : [{ code: "TIME_LOCK_RANGE" }];
}

/** A person's treasury: the creating wallet is a member, the roles are filled and the threshold is reachable. */
export function treasuryIssues(draft: TreasuryDraft): TreasuryIssue[] {
  const issues = [...memberIssues(draft.members), ...roleIssues(draft.members, draft.threshold), ...timeLockIssues(draft.timeLockSeconds)];
  if (!draft.members.some((member) => member.address === draft.creator)) issues.push({ code: "CREATOR_NOT_MEMBER" });
  return issues;
}

export type LimitDraft = Readonly<{
  asset: TreasuryAssetId;
  amountRaw: bigint;
  period: LimitPeriod;
  /** Who may spend from it, apart from the members: an agent's key, a person's second wallet. */
  spenders: readonly string[];
  /** Where it may pay: never empty — Squads reads an empty list as «anywhere». */
  destinations: readonly string[];
}>;

export function limitIssues(draft: LimitDraft, options: Readonly<{ agent?: boolean }> = {}): TreasuryIssue[] {
  const issues: TreasuryIssue[] = [];
  if (draft.amountRaw <= 0n) issues.push({ code: "LIMIT_AMOUNT" });
  if (options.agent && draft.amountRaw > AGENT_LIMIT_CAP_RAW[draft.asset]) issues.push({ code: "LIMIT_AGENT_CAP" });
  if (draft.spenders.length === 0) issues.push({ code: "LIMIT_SPENDERS_EMPTY" });
  if (draft.spenders.length > MAX_SPENDERS) issues.push({ code: "LIMIT_SPENDERS_TOO_MANY" });
  for (const spender of draft.spenders) if (!isAddress(spender)) issues.push({ code: "LIMIT_SPENDER_ADDRESS", at: spender });
  if (draft.destinations.length === 0) issues.push({ code: "LIMIT_DESTINATIONS_EMPTY" });
  if (draft.destinations.length > MAX_DESTINATIONS) issues.push({ code: "LIMIT_DESTINATIONS_TOO_MANY" });
  for (const destination of draft.destinations) if (!isAddress(destination)) issues.push({ code: "LIMIT_DESTINATION_ADDRESS", at: destination });
  /* Squads refuses a limit whose lists repeat an address — at the execution, after every vote: refused here instead. */
  if (new Set(draft.spenders).size !== draft.spenders.length) issues.push({ code: "LIMIT_SPENDER_TWICE" });
  if (new Set(draft.destinations).size !== draft.destinations.length) issues.push({ code: "LIMIT_DESTINATION_TWICE" });
  return issues;
}

export type AgentDraft = Readonly<{ creator: string; agent: string; timeLockSeconds: number; limit: Omit<LimitDraft, "spenders"> }>;

/**
 * An agent's multisig: the person alone holds every role (threshold 1); the agent is not a member — it may only spend
 * from the one limit, within the amount, to the listed recipients. The delay is short, so a revocation lands soon.
 */
export function agentIssues(draft: AgentDraft): TreasuryIssue[] {
  const issues: TreasuryIssue[] = [];
  if (!isAddress(draft.creator)) issues.push({ code: "MEMBER_ADDRESS", at: draft.creator });
  if (!isAddress(draft.agent)) issues.push({ code: "AGENT_ADDRESS", at: draft.agent });
  else if (draft.agent === draft.creator) issues.push({ code: "AGENT_IS_CREATOR" });
  const delay = draft.timeLockSeconds;
  if (!Number.isInteger(delay) || delay < AGENT_TIME_LOCK_S.min || delay > AGENT_TIME_LOCK_S.max) issues.push({ code: "AGENT_TIME_LOCK_RANGE" });
  issues.push(...limitIssues({ ...draft.limit, spenders: [draft.agent] }, { agent: true }).filter((issue) => issue.code !== "LIMIT_SPENDER_ADDRESS"));
  return issues;
}

/* ─── Payouts ─────────────────────────────────────────────────────────────── */

export type Payout = Readonly<{ to: string; amountRaw: bigint }>;

/**
 * The payouts of one proposal, typed or pasted one per line: «address, amount» — a comma, a semicolon, a tab or
 * spaces between them; blank lines are skipped. A recipient named twice is refused: two lines to one address are
 * more often a slip than a wish, and one line with the sum says the same.
 */
export function parsePayouts(text: string, decimals: number, vault?: string, multisig?: string): Readonly<{ payouts: readonly Payout[]; issues: readonly TreasuryIssue[] }> {
  const payouts: Payout[] = [];
  const issues: TreasuryIssue[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    /* The address has no comma or space of its own, so the first separator ends it; the rest is the amount, whose own
       comma is its decimal point («1,5») — never a second column. */
    const split = /^([^\s,;]+)([\s,;]+)(.+)$/.exec(line);
    const to = split?.[1];
    const amountText = split?.[3]?.trim();
    /* After a comma between the columns, a comma in the amount may be a third column («address,100,7»): refused —
       a decimal comma reads after a space, a tab or a semicolon («address; 1,5»), a decimal point after anything. */
    const commaColumns = split?.[2]?.includes(",") ?? false;
    if (!to || !amountText) {
      issues.push({ code: "PAYOUT_LINE", line: index + 1 });
      return;
    }
    if (!isAddress(to)) {
      issues.push({ code: "PAYOUT_ADDRESS", line: index + 1, at: to });
      return;
    }
    /* In a line, a space already separates the columns: an amount with a space in it is two numbers, refused. */
    const amountRaw = /\s/.test(amountText) || (commaColumns && amountText.includes(",")) ? null : parseAmount(amountText, decimals);
    if (amountRaw === null) {
      issues.push({ code: "PAYOUT_AMOUNT", line: index + 1 });
      return;
    }
    if (vault && to === vault) {
      issues.push({ code: "PAYOUT_TO_VAULT", line: index + 1 });
      return;
    }
    if (multisig && to === multisig) {
      issues.push({ code: "PAYOUT_NOT_WALLET", line: index + 1, at: to });
      return;
    }
    if (seen.has(to)) {
      issues.push({ code: "PAYOUT_TWICE", line: index + 1, at: to });
      return;
    }
    seen.add(to);
    payouts.push({ to, amountRaw });
  });
  if (payouts.length === 0 && issues.length === 0) issues.push({ code: "PAYOUTS_EMPTY" });
  if (payouts.length > MAX_PAYOUTS) issues.push({ code: "PAYOUTS_TOO_MANY" });
  return { payouts, issues };
}

export function payoutsTotal(payouts: readonly Payout[]): bigint {
  return payouts.reduce((sum, payout) => sum + payout.amountRaw, 0n);
}

/* ─── Proposals ───────────────────────────────────────────────────────────── */

export const PROPOSAL_STATES = ["draft", "active", "approved", "rejected", "executing", "executed", "cancelled", "stale", "none"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/**
 * When an approved proposal may run: its approval plus the multisig's delay. Null — not approved, or no time read.
 */
export function executableAt(state: ProposalState, approvedAtSeconds: number | null, timeLockSeconds: number): number | null {
  if (state !== "approved" || approvedAtSeconds === null) return null;
  return approvedAtSeconds + timeLockSeconds;
}

/** What the connected wallet may do with one proposal, by its roles and the proposal's state. */
export function proposalActions(
  args: Readonly<{
    state: ProposalState;
    roles: Readonly<Record<Role, boolean>> | null;
    voted: "approved" | "rejected" | "cancelled" | null;
    executableAtSeconds: number | null;
    nowSeconds: number;
    /**
     * Whether this page can show everything the proposal does (its own payouts and changes). One it cannot — made in
     * another app — gets no «for» and no «execute» here: approving or running what is not shown is a blind signature.
     * «Against» and a cancel stay: they move nothing.
     */
    readable?: boolean;
  }>,
): readonly ("approve" | "reject" | "cancel" | "execute")[] {
  const { state, roles } = args;
  if (!roles) return [];
  const readable = args.readable ?? true;
  const out: ("approve" | "reject" | "cancel" | "execute")[] = [];
  if (state === "active" && roles.vote && args.voted === null) out.push(...(readable ? (["approve", "reject"] as const) : (["reject"] as const)));
  if (state === "approved" && roles.vote && args.voted !== "cancelled") out.push("cancel");
  if (readable && (state === "approved" || state === "executing") && roles.execute && args.executableAtSeconds !== null && args.executableAtSeconds <= args.nowSeconds) out.push("execute");
  return out;
}

/* ─── Refusals of the network ─────────────────────────────────────────────── */

export const CHAIN_REFUSAL_CODES = [
  "TREASURY_WALLET_NO_SOL",
  "TREASURY_WALLET_SHORT",
  "TREASURY_VAULT_SHORT",
  "TREASURY_FUNDS_SHORT",
  "TREASURY_BELOW_RENT",
  "TREASURY_DELAY",
  "TREASURY_PROPOSAL_STALE",
  "TREASURY_PROPOSAL_STATE",
  "TREASURY_ALREADY_VOTED",
  "TREASURY_NOT_ALLOWED",
  "TREASURY_LIMIT_EXCEEDED",
  "TREASURY_DESTINATION",
  "TREASURY_BUILD_EXPIRED",
  "TREASURY_SUBMIT_FAILED",
] as const;
export type ChainRefusalCode = (typeof CHAIN_REFUSAL_CODES)[number];

/** Squads' own error names (its program's `Error Code:` in the logs) the page has words for. */
const SQUADS_ERRORS: Readonly<Record<string, ChainRefusalCode>> = {
  TimeLockNotReleased: "TREASURY_DELAY",
  StaleProposal: "TREASURY_PROPOSAL_STALE",
  InvalidProposalStatus: "TREASURY_PROPOSAL_STATE",
  AlreadyApproved: "TREASURY_ALREADY_VOTED",
  AlreadyRejected: "TREASURY_ALREADY_VOTED",
  AlreadyCancelled: "TREASURY_ALREADY_VOTED",
  NotAMember: "TREASURY_NOT_ALLOWED",
  Unauthorized: "TREASURY_NOT_ALLOWED",
  SpendingLimitExceeded: "TREASURY_LIMIT_EXCEEDED",
  InvalidDestination: "TREASURY_DESTINATION",
};

/**
 * What the network's refusal of a treasury transaction means: a code the page says in its own words (the raw text stays
 * behind a disclosure). `squadsError` — Squads' own name for it, given only when Squads itself refused; `payer` — whose
 * money the refused instruction spends (the vault for an execution's lines and a spend, the wallet for the rest, a
 * change's execution included); null when the instruction is not known, and then the kind of build decides.
 */
export function chainRefusalOf(args: Readonly<{ kind: string; text: string; squadsError: string | null; payer: "wallet" | "vault" | null; vaultKeyIndex?: number | null }>): ChainRefusalCode {
  const { kind, text } = args;
  if (args.squadsError && SQUADS_ERRORS[args.squadsError]) return SQUADS_ERRORS[args.squadsError];
  if (/no record of a prior credit/i.test(text)) return "TREASURY_WALLET_NO_SOL";
  if (/blockhash not found|block height exceeded|has expired/i.test(text)) return "TREASURY_BUILD_EXPIRED";
  /* The fee is the fee payer's — the wallet's — whatever was sent. */
  if (/insufficient funds for fee/i.test(text)) return "TREASURY_WALLET_SHORT";
  /* Rent left short — in the preflight's words or the chain's JSON: on the first account it is the wallet's; on the
     vault, the vault's (its balance moved since the build); on another, a new address paid below the network's
     minimum, which no top-up cures. */
  const rentShort = /account \((\d+)\) with insufficient funds for rent/i.exec(text)?.[1] ?? /"InsufficientFundsForRent":\s*\{\s*"account_index":\s*(\d+)/.exec(text)?.[1];
  if (rentShort !== undefined) {
    if (rentShort === "0") return "TREASURY_WALLET_SHORT";
    return args.vaultKeyIndex !== null && args.vaultKeyIndex !== undefined && Number(rentShort) === args.vaultKeyIndex ? "TREASURY_VAULT_SHORT" : "TREASURY_BELOW_RENT";
  }
  if (/insufficient (lamports|funds)/i.test(text)) {
    /* An execution or a spend moves both the vault's money and the wallet's: without the instruction, either may be short. */
    const payer = args.payer ?? (kind === "execute" || kind === "spend" ? null : "wallet");
    return payer === "vault" ? "TREASURY_VAULT_SHORT" : payer === "wallet" ? "TREASURY_WALLET_SHORT" : "TREASURY_FUNDS_SHORT";
  }
  return "TREASURY_SUBMIT_FAILED";
}

/** «1 h», «3 d», «10 min» — a delay as a person reads it, in the page's words. */
export function delayParts(seconds: number): Readonly<{ value: number; unit: "s" | "min" | "h" | "d" }> {
  if (seconds > 0 && seconds % 86_400 === 0) return { value: seconds / 86_400, unit: "d" };
  if (seconds > 0 && seconds % 3_600 === 0) return { value: seconds / 3_600, unit: "h" };
  if (seconds > 0 && seconds % 60 === 0) return { value: seconds / 60, unit: "min" };
  return { value: seconds, unit: "s" };
}
