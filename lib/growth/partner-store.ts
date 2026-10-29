import type { GuardStore } from "../guard/store.ts";
import { readRewardAccount, walletForCode } from "../rewards/ledger.ts";
import { normalizeReferralCode } from "../rewards/referral.ts";
import {
  creatorPartnerKey,
  creatorPartnerPrefix,
  familyOf,
  type LaunchFacts,
  normalizeLaunch,
  normalizeWallet,
  offeredCandidates,
  type PartnerCandidate,
  type PartnerNetwork,
  partnerView,
  type PartnerView,
  personalReasons,
  type PartyIdentity,
  POOL_PARTNER_COLLECTION,
  PARTNER_RULES_VERSION,
  type PoolPartner,
  poolPartnerKey,
  PoolPartnerSchema,
  sameBinding,
  type SelfReferralVerdict,
  selfReferralVerdict,
  type WalletFamily,
  withinRecordWindow,
} from "./partner.ts";
import { everLinked, linkedWallets } from "./wallet-link-store.ts";

/**
 * The store side of "pool → partner": what the creator's review offers, and
 * the one write after the launch is signed.
 *
 * Two lookups come from outside the Growth line and are passed in, so the
 * rules can be tested without a database and the callers (the launch flows
 * of each network) can hand over what they already hold:
 * - `profileOf` — the account (profile) a wallet is proven to, `null` for
 *   none, `undefined` when the lookup did not answer (`accountByWallet`);
 * - `team` — the team's own wallets, the internal list of «Rewards»
 *   (`resolveInternalWallets`), `null` when it could not be read.
 */
export type PartnerDeps = Readonly<{
  profileOf: (family: WalletFamily, address: string) => Promise<string | null | undefined>;
  team: () => Promise<ReadonlySet<string> | null>;
}>;

function parseRow(raw: unknown): PoolPartner | null {
  const parsed = PoolPartnerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function readPoolPartner(store: GuardStore, network: PartnerNetwork, pool: string): Promise<PoolPartner | null> {
  return parseRow(await store.collection<unknown>(POOL_PARTNER_COLLECTION).get(poolPartnerKey(network, pool)));
}

/** Every binding of a creator's launches on one network. */
export async function readCreatorPartners(store: GuardStore, network: PartnerNetwork, creator: string): Promise<PoolPartner[]> {
  const rows = await store.collection<unknown>(POOL_PARTNER_COLLECTION).valuesWithPrefix(creatorPartnerPrefix(network, creator));
  return rows.map(parseRow).filter((row): row is PoolPartner => row !== null && row.creator === creator && row.network === network);
}

/** A wallet, the wallet linked to it, and the profiles any of them is proven to. */
export async function identityOf(store: GuardStore, deps: PartnerDeps, family: WalletFamily, wallet: string): Promise<PartyIdentity> {
  /* The current link first (it is where a party's code lives), then every wallet it was ever linked to: two wallets
     that once signed they are one person stay one person for the self-referral check. */
  const [link, ever] = await Promise.all([linkedWallets(store, family, wallet), everLinked(store, family, wallet)]);
  const linked = [...new Set([...link.linked, ...ever.linked])];
  const other: WalletFamily = family === "solana" ? "evm" : "solana";
  const lookups = await Promise.all([
    deps.profileOf(family, wallet).catch(() => undefined),
    ...linked.map((address) => deps.profileOf(other, address).catch(() => undefined)),
  ]);
  const profiles = [...new Set(lookups.filter((profile): profile is string => typeof profile === "string" && profile.length > 0))];
  return { wallet, linked, current: link.linked[0] ?? null, profiles, unavailable: link.unavailable || ever.unavailable || lookups.some((profile) => profile === undefined) };
}

/** The Solana wallet of a party — its own, or the one linked to it — which is where its inviter and code live. */
function solanaOf(family: WalletFamily, identity: PartyIdentity): string | null {
  return family === "solana" ? identity.wallet : (identity.current ?? null);
}

async function codeOwner(store: GuardStore, code: string | null): Promise<Readonly<{ wallet: string; code: string }> | null> {
  const normalized = code ? normalizeReferralCode(code) : null;
  if (!normalized) return null;
  const wallet = await walletForCode(store, normalized);
  return wallet ? { wallet, code: normalized } : null;
}

async function verdictFor(store: GuardStore, deps: PartnerDeps, creator: PartyIdentity, partnerWallet: string): Promise<SelfReferralVerdict> {
  const [partner, team] = await Promise.all([identityOf(store, deps, "solana", partnerWallet), deps.team().catch(() => null)]);
  return selfReferralVerdict(creator, partner, team);
}

export type PartnerChoice =
  /** Whatever the review offers: earlier launch, inviter, carried code. */
  | Readonly<{ kind: "offered" }>
  /** The creator removed the partner. */
  | Readonly<{ kind: "none" }>
  /** The creator put another personal code in its place. */
  | Readonly<{ kind: "code"; code: string }>;

export type PartnerResolution =
  | Readonly<{
      ok: true;
      /** What a binding written now would carry — and exactly what the review shows. */
      candidate: PartnerCandidate | null;
      /** Whether a binding of this answer is the creator's own decision (`PoolPartner.decided`). */
      decided: boolean;
      /** What the creator's review shows: the same candidate, masked. */
      view: PartnerView;
    }>
  | Readonly<{ ok: false; code: "INVALID" | "UNKNOWN_CODE" | "SELF_REFERRAL" | "UNAVAILABLE" }>;

/**
 * The partner for a creator's next launch on a network.
 *
 * `proven` says the request comes from the creator's own proven wallet, and
 * it decides two things:
 * - what is read: their earlier launches and their inviter only for them —
 *   who invited a wallet is that wallet's business; anybody else learns only
 *   what their own browser carries from `/r/<code>`;
 * - whether the self-referral check may answer: for the proven creator a
 *   partner who is themselves, a wallet of theirs or their profile is passed
 *   over and such a code is refused. For anybody else the answer must not
 *   depend on it at all — not even on whether the code is the given wallet's
 *   own, or the route would confirm who owns a code — so the candidate is
 *   shown as it is, and the binding carries the reasons, so nothing is ever
 *   paid on it. The team is never an answer to anybody (`personalReasons`):
 *   it too stays on the binding. The launch wizard asks for the proof before
 *   it builds with the offered partner, so a creator who can sign gets the
 *   full answer; one who cannot still launches, with the link's code shown.
 *
 * What is shown is what a build keeps and the signature binds: the launch
 * flow calls this when it builds the transaction and keeps the candidate
 * with that build. A store that does not answer while looking for an offer
 * offers nothing rather than failing the launch; a typed code that cannot be
 * checked says so.
 */
export async function resolvePartner(
  store: GuardStore,
  deps: PartnerDeps,
  args: Readonly<{ network: PartnerNetwork; creator: string; carriedCode: string | null; proven: boolean; choice: PartnerChoice }>,
): Promise<PartnerResolution> {
  const family = familyOf(args.network);
  const creator = normalizeWallet(family, args.creator);
  if (!creator) return { ok: false, code: "INVALID" };
  if (args.choice.kind === "none") return { ok: true, candidate: null, decided: true, view: null };

  if (args.choice.kind === "code") {
    try {
      const owner = await codeOwner(store, args.choice.code);
      if (!owner) return { ok: false, code: "UNKNOWN_CODE" };
      if (args.proven) {
        if (owner.wallet === creator) return { ok: false, code: "SELF_REFERRAL" };
        const identity = await identityOf(store, deps, family, creator);
        if (personalReasons(await verdictFor(store, deps, identity, owner.wallet)).length) return { ok: false, code: "SELF_REFERRAL" };
      }
      const candidate: PartnerCandidate = { ...owner, source: "chosen" };
      return { ok: true, candidate, decided: true, view: partnerView(candidate) };
    } catch {
      return { ok: false, code: "UNAVAILABLE" };
    }
  }

  const carried = await codeOwner(store, args.carriedCode).catch(() => null);
  if (args.proven) {
    /* The creator's own history; a read that fails is answered as for anybody else — the link's code alone. */
    try {
      const identity = await identityOf(store, deps, family, creator);
      const solana = solanaOf(family, identity);
      const linkedNetwork: PartnerNetwork = args.network === "solana" ? "arc" : "solana";
      const reads = await Promise.all([
        readCreatorPartners(store, args.network, creator),
        /* The other network's launches only under the wallet linked now: a wallet relinked elsewhere steers nobody's offer. */
        ...(identity.current ? [readCreatorPartners(store, linkedNetwork, identity.current)] : []),
      ]);
      let inviter: Readonly<{ wallet: string; code: string }> | null = null;
      const account = solana ? await readRewardAccount(store, solana) : null;
      if (account?.referrer) {
        const referrerAccount = await readRewardAccount(store, account.referrer);
        if (referrerAccount) inviter = { wallet: referrerAccount.wallet, code: referrerAccount.code };
      }
      for (const candidate of offeredCandidates({ previous: reads.flat(), inviter, carried })) {
        if (personalReasons(await verdictFor(store, deps, identity, candidate.wallet)).length) continue;
        return { ok: true, candidate, decided: true, view: partnerView(candidate) };
      }
      return { ok: true, candidate: null, decided: false, view: null };
    } catch {
      /* fall through */
    }
  }
  const candidate = offeredCandidates({ previous: [], inviter: null, carried })[0] ?? null;
  return { ok: true, candidate, decided: false, view: partnerView(candidate) };
}

export type PartnerRecordOutcome =
  | Readonly<{ ok: true; created: boolean; binding: PoolPartner }>
  | Readonly<{
      ok: false;
      /** `FINAL` — the pool is bound to another partner; after the launch nothing moves it. `LATE` — past the record window. */
      code: "INVALID" | "FINAL" | "LATE" | "CONTENDED";
    }>;

/**
 * Write the binding of a signed launch — once.
 *
 * `launch` is what the launch flow built and the creator signed, after the
 * creation transaction is confirmed; `partner` is what `resolvePartner`
 * answered for that build (null when there was none or the creator removed
 * it). A repeat with the same partner is the same binding; a different
 * partner for a pool already bound is refused — there is no retroactive
 * change, not even by the creator.
 *
 * A partner who is the creator themselves, a wallet of theirs or the team is
 * still written, with the reasons, so the review queue sees it; the reward
 * rules pay nothing on a binding with reasons, and check again on one whose
 * lookups did not answer.
 */
export async function recordPoolPartner(
  store: GuardStore,
  deps: PartnerDeps,
  args: Readonly<{
    launch: LaunchFacts;
    partner: Pick<PartnerCandidate, "wallet" | "code" | "source"> | null;
    /** `resolvePartner`'s `decided` for the same build; absent — not the creator's decision. */
    decided?: boolean;
    now: string;
  }>,
): Promise<PartnerRecordOutcome> {
  const launch = normalizeLaunch(args.launch);
  if (!launch) return { ok: false, code: "INVALID" };
  const partnerWallet = args.partner ? normalizeWallet("solana", args.partner.wallet) : null;
  const partnerCode = args.partner ? normalizeReferralCode(args.partner.code) : null;
  if (args.partner && (!partnerWallet || !partnerCode)) return { ok: false, code: "INVALID" };

  const key = poolPartnerKey(launch.network, launch.pool);
  const indexKey = creatorPartnerKey(launch.network, launch.creator, launch.pool);
  const collection = store.collection<unknown>(POOL_PARTNER_COLLECTION);

  let checks: PoolPartner["checks"] = null;
  if (partnerWallet) {
    const creator = await identityOf(store, deps, familyOf(launch.network), launch.creator);
    const verdict = await verdictFor(store, deps, creator, partnerWallet);
    checks = { status: verdict.status, reasons: [...verdict.reasons], at: args.now };
  }
  const parsed = PoolPartnerSchema.safeParse({
    schema: 1,
    ...launch,
    partner: partnerWallet,
    partnerCode,
    source: partnerWallet ? args.partner!.source : "none",
    decided: args.decided === true,
    rulesVersion: PARTNER_RULES_VERSION,
    checks,
    recordedAt: args.now,
    version: 1,
  });
  if (!parsed.success) return { ok: false, code: "INVALID" };
  const row = parsed.data;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingRaw = await collection.get(key);
    if (existingRaw !== undefined) {
      const existing = parseRow(existingRaw);
      if (!existing || !sameBinding(existing, row)) return { ok: false, code: "FINAL" };
      /* The binding stands; a crash between the two rows cannot happen (one
         atomic write), but an index lost to anything else is put back. */
      if ((await collection.get(indexKey)) === undefined) {
        await store.compareAndSetMany([{ collection: POOL_PARTNER_COLLECTION, key: indexKey, expectedVersion: null, next: existing }]).catch(() => false);
      }
      return { ok: true, created: false, binding: existing };
    }
    if (!withinRecordWindow(row.launchedAt, args.now)) return { ok: false, code: "LATE" };
    const written = await store.compareAndSetMany([
      { collection: POOL_PARTNER_COLLECTION, key, expectedVersion: null, next: row },
      { collection: POOL_PARTNER_COLLECTION, key: indexKey, expectedVersion: null, next: row },
    ]);
    if (written) return { ok: true, created: true, binding: row };
  }
  return { ok: false, code: "CONTENDED" };
}

/**
 * The self-referral check of a written binding, run again now — for the
 * reward rules before anything is accrued: a profile or link proven after the
 * launch can only add reasons, never remove the ones the binding carries.
 */
export async function recheckPoolPartner(store: GuardStore, deps: PartnerDeps, binding: PoolPartner): Promise<SelfReferralVerdict | null> {
  if (!binding.partner) return null;
  const creator = await identityOf(store, deps, familyOf(binding.network), binding.creator);
  const now = await verdictFor(store, deps, creator, binding.partner);
  const reasons = [...new Set([...(binding.checks?.reasons ?? []), ...now.reasons])];
  return { status: reasons.length ? "measured" : now.status, reasons };
}
