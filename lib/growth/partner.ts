import { z } from "zod";

import { maskCode, maskWallet, REFERRAL_CODE_PATTERN, REFERRAL_COOKIE } from "../rewards/referral.ts";

/**
 * Who brought a creator — the binding "pool → partner" of the Ryntra Network.
 *
 * A partner is a person who brought a token creator to Ryntra. When that
 * creator's launch pool earns Ryntra its share, the partner gets a part of
 * that share (the rates and the cap live in the reward rules, not here). This
 * module is the attribution only: which partner a pool belongs to, written
 * once when the launch is signed and never changed afterwards.
 *
 * ## The code is the one personal code
 *
 * There is no separate partner code. A partner is the owner of the same
 * personal code `/r/<code>` a trader shares with friends — the wallet behind
 * `referralCodes`. A creator who arrived through somebody's link carries that
 * code (the `rref` cookie) or, once their wallet was proven, already has that
 * person as their inviter in `rewardAccounts`.
 *
 * ## When it is decided
 *
 * The creator sees «Invited by: <partner>» before signing the launch, and may
 * change it to another code or remove it there. The moment the launch is
 * signed the binding is written with the partner the creator saw — and from
 * then on nothing moves it: a second record for the same pool with another
 * partner is refused (`FINAL`), never applied. The next launch of the same
 * creator is offered the same partner again, and the creator again sees it.
 *
 * ## One level, and never yourself
 *
 * A partner earns only for creators they brought themselves. The same wallet,
 * wallets proven to one profile, wallets the partner linked with signatures
 * from both, and the team's own wallets earn nothing as a partner. Such a
 * binding is still written — the fact is kept for review, never a silent
 * ban — and it carries the reasons, so nothing is ever paid on it.
 */

export const POOL_PARTNER_COLLECTION = "growthPoolPartners" as const;

/** Policy 1.0 "Network" — the version every binding carries; a later version changes only what comes after it. */
export const PARTNER_RULES_VERSION = "network-1.0.0" as const;

export const PARTNER_NETWORKS = ["solana", "arc"] as const;
export type PartnerNetwork = (typeof PARTNER_NETWORKS)[number];

/** The wallet family a launch network's creators sign with. */
export type WalletFamily = "solana" | "evm";
export function familyOf(network: PartnerNetwork): WalletFamily {
  return network === "solana" ? "solana" : "evm";
}

/** How long after the launch transaction a binding may still be written: a retry, never a late claim on somebody's pool. */
export const PARTNER_RECORD_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

/** An address of the family, in the one spelling bindings keep (EVM lower-case), or null. */
export function normalizeWallet(family: WalletFamily, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (family === "solana") return SOLANA_ADDRESS.test(trimmed) ? trimmed : null;
  return EVM_ADDRESS.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Either family — for lists that hold both (the team's wallets, links). */
export function walletKey(value: string): string {
  return EVM_ADDRESS.test(value) ? value.toLowerCase() : value;
}

function normalizeTx(network: PartnerNetwork, value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (network === "solana") return SOLANA_SIGNATURE.test(value) ? value : null;
  return EVM_HASH.test(value) ? value.toLowerCase() : null;
}

/**
 * The launch as the caller verified it. The caller is the launch flow's own
 * server code, after the creation transaction is confirmed: it built the
 * transaction, the creator signed exactly that, and the pool, the config or
 * factory and the creator are what it built — not what a browser said.
 */
export type LaunchFacts = Readonly<{
  network: PartnerNetwork;
  /** The DBC config on Solana; the launch factory on the EVM network. */
  factory: string;
  pool: string;
  creator: string;
  creationTx: string;
  launchedAt: string;
}>;

export function normalizeLaunch(raw: LaunchFacts): LaunchFacts | null {
  if (!(PARTNER_NETWORKS as readonly string[]).includes(raw.network)) return null;
  const family = familyOf(raw.network);
  const factory = normalizeWallet(family, raw.factory);
  const pool = raw.network === "solana" ? normalizeWallet("solana", raw.pool) : (normalizeWallet("evm", raw.pool) ?? (EVM_HASH.test(String(raw.pool)) ? String(raw.pool).toLowerCase() : null));
  const creator = normalizeWallet(family, raw.creator);
  const creationTx = normalizeTx(raw.network, raw.creationTx);
  const at = Date.parse(raw.launchedAt);
  if (!factory || !pool || !creator || !creationTx || !Number.isFinite(at)) return null;
  return { network: raw.network, factory, pool, creator, creationTx, launchedAt: new Date(at).toISOString() };
}

export const SELF_REFERRAL_REASONS = ["SAME_WALLET", "LINKED_WALLET", "SAME_PROFILE", "TEAM"] as const;
export type SelfReferralReason = (typeof SELF_REFERRAL_REASONS)[number];

export const PARTNER_SOURCES = [
  /** The partner of this creator's latest earlier launch. */
  "previous",
  /** The person who invited this creator to Ryntra (`rewardAccounts.referrer`). */
  "inviter",
  /** The code this browser carries from `/r/<code>`, not yet bound. */
  "carried",
  /** A code the creator typed in place of the offered one. */
  "chosen",
  /** No partner: none was offered, or the creator removed it. */
  "none",
] as const;
export type PartnerSource = (typeof PARTNER_SOURCES)[number];

const AT = z.string().datetime({ offset: true });

export const PartnerChecksSchema = z
  .object({
    /** `unavailable`: a lookup did not answer, so no reason could be ruled out — the reward rules check again before anything is paid. */
    status: z.enum(["measured", "unavailable"]),
    reasons: z.array(z.enum(SELF_REFERRAL_REASONS)),
    at: AT,
  })
  .strict();
export type PartnerChecks = z.output<typeof PartnerChecksSchema>;

export const PoolPartnerSchema = z
  .object({
    schema: z.literal(1),
    network: z.enum(PARTNER_NETWORKS),
    factory: z.string().min(32).max(66),
    pool: z.string().min(32).max(66),
    creator: z.string().min(32).max(64),
    creationTx: z.string().min(64).max(90),
    launchedAt: AT,
    /** The partner's Solana wallet — the owner of the code. Null when the launch has none. */
    partner: z.string().regex(SOLANA_ADDRESS).nullable(),
    partnerCode: z.string().regex(REFERRAL_CODE_PATTERN).nullable(),
    source: z.enum(PARTNER_SOURCES),
    /**
     * The creator's own decision: a code they put in, a partner they removed, or the partner their proven wallet was
     * offered. Only such a binding decides what their next launch is offered; one made from a link alone, or with
     * nothing to offer, does not — it must never erase or replace the partner they chose before.
     */
    decided: z.boolean(),
    rulesVersion: z.literal(PARTNER_RULES_VERSION),
    /** Null without a partner; with one, why it can never be paid, if it cannot. */
    checks: PartnerChecksSchema.nullable(),
    recordedAt: AT,
    /** Store bookkeeping for the atomic create; a binding is never rewritten. */
    version: z.literal(1),
  })
  .strict()
  .refine((row) => (row.partner === null) === (row.partnerCode === null), "partner and its code come together")
  .refine((row) => (row.partner === null) === (row.source === "none"), "only a binding without a partner has the source none")
  .refine((row) => (row.partner === null) === (row.checks === null), "checks belong to a partner");

export type PoolPartner = z.output<typeof PoolPartnerSchema>;

export function poolPartnerKey(network: PartnerNetwork, pool: string): string {
  return `pool:${network}:${pool}`;
}

/** The creator's own index: `creator:<network>:<creator>:` lists their pools. */
export function creatorPartnerPrefix(network: PartnerNetwork, creator: string): string {
  return `creator:${network}:${creator}:`;
}

export function creatorPartnerKey(network: PartnerNetwork, creator: string, pool: string): string {
  return `${creatorPartnerPrefix(network, creator)}${pool}`;
}

/** What makes two records of one pool the same binding. `recordedAt`, `source` and the checks are bookkeeping of the moment. */
export function sameBinding(left: PoolPartner, right: PoolPartner): boolean {
  return (
    left.network === right.network &&
    left.pool === right.pool &&
    left.factory === right.factory &&
    left.creator === right.creator &&
    left.creationTx === right.creationTx &&
    left.partner === right.partner &&
    left.partnerCode === right.partnerCode &&
    left.rulesVersion === right.rulesVersion
  );
}

/** May a binding be written at `now` for a launch at `launchedAt`? */
export function withinRecordWindow(launchedAt: string, now: string): boolean {
  const launched = Date.parse(launchedAt);
  const at = Date.parse(now);
  if (!Number.isFinite(launched) || !Number.isFinite(at)) return false;
  return launched <= at + CLOCK_SKEW_MS && at - launched <= PARTNER_RECORD_WINDOW_MS;
}

/**
 * One side of the self-referral check: a wallet, the wallets it is linked to
 * by signatures from both, and the profiles (accounts) any of them is proven to.
 */
export type PartyIdentity = Readonly<{
  wallet: string;
  /** Every wallet this one was ever linked to — for the self-referral check. */
  linked: readonly string[];
  /** The wallet it is linked to now, if any — where its inviter and code live. */
  current?: string | null;
  profiles: readonly string[];
  /** A profile or link lookup did not answer. */
  unavailable: boolean;
}>;

export type SelfReferralVerdict = Readonly<{ status: "measured" | "unavailable"; reasons: readonly SelfReferralReason[] }>;

/**
 * Is this partner, for this creator, themselves — or the team?
 *
 * Every reason found is kept, not just the first: the review queue reads why.
 * A lookup that did not answer and found nothing is `unavailable`, never a
 * clean bill; a reason found is a reason regardless of what else was missing.
 * `team` null means the team's list could not be read.
 */
export function selfReferralVerdict(
  creator: PartyIdentity,
  partner: PartyIdentity,
  team: ReadonlySet<string> | null,
): SelfReferralVerdict {
  const reasons: SelfReferralReason[] = [];
  const creatorWallets = new Set([creator.wallet, ...creator.linked].map(walletKey));
  const partnerWallets = new Set([partner.wallet, ...partner.linked].map(walletKey));
  if (walletKey(creator.wallet) === walletKey(partner.wallet)) reasons.push("SAME_WALLET");
  else if ([...creatorWallets].some((wallet) => partnerWallets.has(wallet))) reasons.push("LINKED_WALLET");
  const profiles = new Set(creator.profiles);
  if (partner.profiles.some((profile) => profiles.has(profile))) reasons.push("SAME_PROFILE");
  if (team && [...creatorWallets, ...partnerWallets].some((wallet) => team.has(wallet))) reasons.push("TEAM");
  const unavailable = creator.unavailable || partner.unavailable || team === null;
  return { status: unavailable && reasons.length === 0 ? "unavailable" : "measured", reasons };
}

export type PartnerCandidate = Readonly<{ wallet: string; code: string; source: Exclude<PartnerSource, "none"> }>;

/**
 * The partners the creator's review may offer, best first: the store supplies
 * each, the self-referral check picks the first that may be shown.
 *
 * A creator with an earlier launch has already chosen: their latest decided
 * binding decides — its partner again, or nobody if they removed it then
 * (they can still add a code). Only a first launch is offered whoever invited them, then
 * the code their browser carries. A binding that can never be paid is no
 * choice to repeat.
 */
export function offeredCandidates(
  args: Readonly<{
    previous: readonly PoolPartner[];
    inviter: Readonly<{ wallet: string; code: string }> | null;
    carried: Readonly<{ wallet: string; code: string }> | null;
  }>,
): PartnerCandidate[] {
  /* Only the creator's own decisions count. A binding the creator could not have been offered (a reason of their own)
     is no choice to repeat; one whose only reason is the team still is — leaving it out would tell the creator that
     partner is the team's. */
  const newest = (rows: readonly PoolPartner[]) =>
    [...rows].sort((left, right) => right.launchedAt.localeCompare(left.launchedAt) || right.recordedAt.localeCompare(left.recordedAt))[0];
  const repeatable = args.previous.filter((row) => !row.checks || row.checks.reasons.every((reason) => reason === "TEAM"));
  const latest = newest(repeatable.filter((row) => row.decided));
  if (latest) return latest.partner && latest.partnerCode ? [{ wallet: latest.partner, code: latest.partnerCode, source: "previous" }] : [];
  const out: PartnerCandidate[] = [];
  /* No decision yet: the partner an earlier launch was bound to from a link still comes first — the same partner again. */
  const undecided = newest(repeatable.filter((row) => row.partner && row.partnerCode));
  if (undecided?.partner && undecided.partnerCode) out.push({ wallet: undecided.partner, code: undecided.partnerCode, source: "previous" });
  if (args.inviter && !out.some((row) => row.wallet === args.inviter!.wallet)) out.push({ ...args.inviter, source: "inviter" });
  if (args.carried && !out.some((row) => row.wallet === args.carried!.wallet)) out.push({ ...args.carried, source: "carried" });
  return out;
}

/** The first of `offeredCandidates` — for a caller with no check to run. */
export function chooseOffered(args: Parameters<typeof offeredCandidates>[0]): PartnerCandidate | null {
  return offeredCandidates(args)[0] ?? null;
}

/**
 * The reasons a proven creator may be told about. The team's wallets are not
 * among them: whether a code belongs to Ryntra's own wallet is not an answer
 * for anybody; such a partner is shown, bound with the reason, and never paid.
 */
export function personalReasons(verdict: SelfReferralVerdict): readonly SelfReferralReason[] {
  return verdict.reasons.filter((reason) => reason !== "TEAM");
}

/** What the creator's own browser may see of a partner: masked, as everywhere else an inviter is shown. */
export type PartnerView = Readonly<{ partnerMasked: string; codeMasked: string; source: PartnerSource }> | null;

export function partnerView(candidate: Readonly<{ wallet: string; code: string; source: PartnerSource }> | null): PartnerView {
  if (!candidate) return null;
  return { partnerMasked: maskWallet(candidate.wallet), codeMasked: maskCode(candidate.code), source: candidate.source };
}

/**
 * The code a browser carries from `/r/<code>`, read from a raw `Cookie`
 * header — for a server route that has the request's headers and no cookie
 * helper. A native client carries none, and that is simply no code.
 */
export function carriedCodeFrom(cookieHeader: string | null | undefined): string | null {
  const match = new RegExp(`(?:^|;\\s*)${REFERRAL_COOKIE}=([^;]+)`).exec(cookieHeader ?? "");
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}
