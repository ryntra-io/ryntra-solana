/**
 * «Запустити токен» — the server's half of a launch.
 *
 * 1. **Build** (`prepareLaunch`). The metadata the creator stored is checked
 *    again (the name and ticker borrow no brand or person), the creator's
 *    limit and the pool payer's balance are checked, and the venue builds the
 *    creation: the token on the preset's config, the creator's first purchase
 *    under the cap, and — first — the creator paying Ryntra's pool payer back
 *    every lamport of rent and fee the network simulated it spending. The
 *    sealed bytes are simulated again; a payer that would lose anything is a
 *    refused build. When the creator chose to lock the purchase, the lock is a
 *    second transaction built with it. The exact messages are remembered by
 *    their hashes for a few minutes.
 * 2. **The creator signs** first, in their wallet — the server never holds a
 *    key of theirs. The bytes the wallet sees carry no other signature: the
 *    fresh keys the build made (the new mint, the lock's escrow base) are taken
 *    off them and kept with the build, sealed with the server's key — a wallet
 *    such as Phantom refuses bytes another key has already signed.
 * 3. **Submit** (`submitLaunch`). The creation must be the remembered message
 *    byte for byte; the lock and the sharing too, or — the creator pays for
 *    those — the same instructions with what a wallet may add on signing
 *    (Lighthouse assertions, a compute budget under the ceiling). The creator's
 *    signature must be there and valid; the fresh keys then sign over the exact
 *    message the wallet signed, every signature is checked, and only then does
 *    the pool payer sign. The creation is sent once and confirmed, then the
 *    lock; the launch is recorded with the creator's referral code for the link
 *    they share.
 *
 * Nothing here decides for the creator or signs for them; the payer's
 * signature is what makes the token Ryntra's launch, and it covers only bytes
 * this server built and checked.
 */

import { createHash, randomBytes } from "node:crypto";

import { PublicKey, Transaction, VersionedTransaction, type Connection, type Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getBase58Decoder } from "@solana/kit";

import type { StepTiming } from "../core/pipeline.ts";
import { MET_LOCK_PROGRAM, buildCreatorLockTransaction } from "../core/venues/meteora-dbc/creator-lock.server.ts";
import { LaunchRefusal, createMeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import { launchPreset, type LaunchPresetId } from "../core/venues/meteora-dbc/presets.ts";
import { creatorLockSchedule, type CreatorLockId } from "../core/launch/creator-lock.ts";
import { advancedPresetOf, type AdvancedTerms } from "../core/launch/advanced.ts";
import type { CurveRuleSet } from "../core/launch/curve-rules.ts";
import { feeShareProblems, type FeeShare } from "../core/launch/fee-shares.ts";
import { crewOpenOn, isCrewPreset } from "../core/launch/crew.ts";
import { quoteAssetRefusalWords } from "../core/launch/quote-asset.ts";
import { crewSharesFor, holdCrew, releaseCrew } from "./crew.server.ts";
import type { GuardStore } from "../guard/store.ts";
import { launchKey } from "./record-key.ts";
import type { Env } from "../liquidity/studio/gate.ts";
import { openCosigners, reviewedDigest, sealCosigners, ticketKeyConfigured, walletAdditionsAllowed, withoutSignaturesOf, type Cosigner } from "../liquidity/studio/ticket.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { ensureRewardAccount } from "../rewards/ledger.ts";
import { NEXT_TRANSACTION_MARGIN_MS, readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { composeAtomicCreation, readSignedV1, V1Creation, type AtomicCreation } from "./atomic-lock.server.ts";
import { signTransaction, type LaunchSigner } from "./signer/signer.server.ts";
import { LAUNCHES_PER_CREATOR_PER_DAY, LAUNCHES_PER_HOUR, POOL_PAYER_FLOOR_LAMPORTS, launchPair, launchWritesHere, type LaunchNetwork } from "./config.server.ts";
import { advancedConfigFor, markAdvancedConfigUsed, returnAdvancedConfig, takeAdvancedConfig } from "./advanced.server.ts";
import { checkLaunchForm } from "./form.ts";
import { quoteAssetFor, type QuotePriceReader } from "./quote-asset.server.ts";
import { quotePaused } from "./quote-watch.server.ts";
import { metadataOfUri } from "./metadata.server.ts";
import { beginLaunchTrade, failLaunchTrade } from "./record.server.ts";
import { launchShortPath } from "./share-link.ts";
import type { PartnerCandidate, PartnerView } from "../growth/partner.ts";
import { type PartnerChoice, type PartnerDeps, recordPoolPartner, resolvePartner } from "../growth/partner-store.ts";

/**
 * The longest a built launch waits for the creator's signature. The real wait is shorter: the bytes live as long as
 * their blockhash, ~150 blocks ≈ 30 s on 200 ms slots, and each transaction sent after the creation keeps a margin
 * (`lib/solana/blockhash-life.ts`). Signed later, the page builds the launch again instead of sending dead bytes.
 */
export const BUILD_TTL_MS = 2 * 60 * 1000;

export type LaunchDeps = Readonly<{
  network: LaunchNetwork;
  connection: Connection;
  store: GuardStore;
  /** Ryntra's pool payer: a signer that signs a launch's creation and nothing else; its key in the environment or in KMS (CITY-162). */
  poolPayer: LaunchSigner;
  /**
   * Whether a wallet is one of Ryntra's own — the demo market, Ryntra's technical validation, takes a launch from no one
   * else. Absent or failing: no wallet is, and the demo market is refused.
   */
  ownWallet?: (wallet: string) => Promise<boolean>;
  /** The public origin the metadata and share links live on. */
  origin: string;
  now: () => Date;
  /** A second operator asked before a signature is called absent: one public node behind another is not the chain. */
  second?: Connection | null;
  /** The server's environment: its key (`BETA_TOKEN_SECRET`) seals the build's fresh keys until the creator has signed. Without it, nothing is built. */
  env?: Env;
  /** The creator's partner (the Growth line): profiles and the team's wallets. Absent — no partner is offered or bound. */
  partners?: PartnerDeps;
  /** Where a checked pair currency's price is read (SOL-L11); absent — Jupiter, as every Ryntra surface prices a token. */
  quotePrice?: QuotePriceReader;
}>;

export type LaunchFailureCode =
  | "METADATA_NOT_FOUND"
  | "NAME_BORROWED"
  | "NAME_REFUSED"
  | "CREATOR_LIMIT"
  | "NETWORK_BUSY"
  | "PAYER_LOW"
  | "PRESET_UNAVAILABLE"
  | "FIRST_BUY_ABOVE_CAP"
  | "LOCK_NEEDS_PURCHASE"
  | "LOCK_REQUIRED"
  | "LOCK_NEEDS_V1"
  | "SHARES_INVALID"
  | "ADVANCED_INVALID"
  | "ADVANCED_CONFIG_UNUSABLE"
  | "NOT_BUILT"
  | "BUILD_EXPIRED"
  | "BUILD_USED"
  | "WRONG_CREATOR"
  | "SIGNED_OTHER_BYTES"
  | "SIGNATURE_MISSING"
  | "SUBMIT_FAILED"
  | "BUILD_FAILED"
  /* SOL-L12: the pair currency's mint changed what its issuer can do; new launches on it wait. */
  | "QUOTE_PAUSED";

export type LaunchFailure = Readonly<{ ok: false; code: LaunchFailureCode; message: string }>;
const fail = (code: LaunchFailureCode, message: string): LaunchFailure => ({ ok: false, code, message });

export type LaunchBuildRecord = Readonly<{
  id: string;
  cluster: LaunchNetwork["cluster"];
  creator: string;
  preset: LaunchPresetId;
  token: string;
  pool: string;
  config: string;
  pairMint: string;
  metadataUri: string;
  name: string;
  symbol: string;
  firstBuyInRaw: string;
  firstBuyOutRaw: string;
  payerCoveredLamports: string;
  messageSha256: string;
  /** The lock: its message, and the digest of its instructions (`reviewedDigest`) that a wallet's own additions leave as it is. */
  lock: Readonly<{ schedule: CreatorLockId; escrow: string; amountRaw: string; cliffAt: number; endsAt: number; messageSha256: string; digest?: string; /** MC-1: the lock is inside the creation itself — one v1 transaction, both or neither. */ inCreation?: true }> | null;
  /** «Спільнота» sharing the creator's fees: the vault, the shares and the second transaction's message and digest. */
  split: Readonly<{ vault: string; shares: readonly FeeShare[]; messageSha256: string; digest?: string }> | null;
  /** MC-2: the crew whose yes the split's rows are — bound to the token once the launch is sent. */
  crew?: string;
  /** «Розширений» (SOL-L5): the launch's own numbers, as its config was made from them. */
  advanced?: AdvancedTerms | null;
  /**
   * The fresh keys that sign after the creator — the mint on the creation and the sharing, the escrow base on the lock —
   * sealed (`sealCosigners`), each by its transaction: 0 the creation, 1 the lock, 2 the sharing. Absent on a build
   * from before the wallet signed first: its bytes carry those signatures already.
   */
  cosign?: string | null;
  /** MC-1: "v1" — the creation is a v1 transaction (SIMD-0385) the creator's lock rides in; absent — legacy bytes, as before. */
  format?: "v1";
  /** The partner the creator saw before signing — bound to the pool once the launch lands. Absent when the request named no partner choice (a client without the review): nothing is bound. */
  partner?: Pick<PartnerCandidate, "wallet" | "code" | "source"> | null;
  /** Whether that partner is the creator's own decision (the Growth line's `decided`): only such a binding decides their next launch. */
  partnerDecided?: boolean;
  createdAt: string;
  expiresAt: string;
  validUntil: string;
}>;

export type LaunchRecord = Readonly<{
  cluster: LaunchNetwork["cluster"];
  /** Written PENDING before the send; LAUNCHED once the chain confirms. A refused send removes the record. */
  state: "PENDING" | "LAUNCHED";
  token: string;
  pool: string;
  config: string;
  pairMint: string;
  preset: LaunchPresetId;
  creator: string;
  name: string;
  symbol: string;
  metadataUri: string;
  signature: string;
  /** The creation's last block height: past it, a signature the chain never saw can no longer land. */
  validUntil: string;
  firstBuyInRaw: string;
  firstBuyOutRaw: string;
  /**
   * The creator's lock: LOCKED once its escrow is on chain; PENDING while its send has no answer — the token's read
   * settles it from the escrow's own address; FAILED when the network refused it or it was never sent.
   */
  lock: Readonly<{ schedule: CreatorLockId; escrow: string; signature: string | null; state: "LOCKED" | "PENDING" | "FAILED"; reason: string | null }> | null;
  /**
   * «Спільнота» sharing the creator's fees: SHARED once the vault holds the curve's creator role on chain; PENDING while
   * its send has no answer — the token's read settles it from the curve's own creator; FAILED when the network refused
   * it or it was never sent, and then the creator's wallet keeps the role and every fee. Absent on a launch before it.
   */
  feeSharing?: Readonly<{ vault: string; shares: readonly FeeShare[]; signature: string | null; state: "SHARED" | "PENDING" | "FAILED"; reason: string | null }> | null;
  /** «Розширений» (SOL-L5): the launch's own numbers — the creator's choice and the bounds' part in force then. */
  advanced?: AdvancedTerms | null;
  /**
   * «Правила на кривій» (SOL-L8): the set its config was made with and the governance of the rule program in force
   * then. Absent on every launch until the preset opens; its receipt says the rules from here and the chain's hook
   * from the mint.
   */
  curveRules?: CurveRuleSet | null;
  /** The build this launch was sent from — its send is counted under it. */
  buildId: string;
  referralCode: string | null;
  launchedAt: string;
  /**
   * The partner the creator saw before signing, kept only while the launch is PENDING: a launch the chain confirms
   * after the route gave up is bound to it when its read settles it (`readLaunchRecord`), never one that did not land.
   */
  partner?: Pick<PartnerCandidate, "wallet" | "code" | "source"> | null;
  partnerDecided?: boolean;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const creatorKey = (cluster: string, creator: string, token = "") => `solana:${cluster}:${creator}:${token}`;
const buildKey = (cluster: string, id: string) => `${cluster}:${id}`;

export type PrepareInput = Readonly<{
  creator: string;
  preset: LaunchPresetId;
  metadataUri: string;
  /** The first purchase in the pair currency's raw units; "0" for none. */
  firstBuyRaw: string;
  lock: CreatorLockId | null;
  /** «Спільнота» only: the creator's fees shared, the creator among two to five wallets; absent or empty, not shared. */
  feeShares?: readonly FeeShare[];
  /** «Спільнота» only: the community token the launch pairs against; may be absent only where the network offers one. */
  pairMint?: string;
  /** «Розширений» only: the config the creator made for this launch (`prepareAdvancedConfig`). */
  advancedConfig?: string;
  /** "offered" — the partner the review showed; "none" — removed; a code — another partner in its place. Absent — a client with no review: no partner is bound. */
  partner?: "offered" | "none" | Readonly<{ code: string }>;
  /** MC-1: "v1" when the creator's wallet signs v1 transactions — the only way a locked first purchase is built. */
  format?: "v1";
  /** MC-2: the crew that shares the creator's fees (`crew.server.ts`) — the vault's rows come from its record, never the request. */
  crew?: string;
}>;

/** What the build's request carries beside its body: the code the browser holds from `/r/<code>`, and whether the creator's wallet is proven there. */
export type PartnerContext = Readonly<{ carriedCode: string | null; proven: boolean }>;

export type PreparedLaunch = Readonly<{
  ok: true;
  buildId: string;
  wireBase64: string;
  lockWireBase64: string | null;
  /** The sharing of the creator's fees; the creator signs it in the same window, the new mint after. */
  splitWireBase64: string | null;
  feeVault: string | null;
  token: string;
  firstBuyOutRaw: string;
  payerCoveredLamports: string;
  /** The creator's SOL both transactions take, as simulated and counted before the signature. */
  creatorCostLamports: string;
  expiresAt: string;
  /** How long from arriving the creator may still sign (AG-1). */
  signableMs: number;
  /** The partner the build binds the pool to, masked as the review shows it; undefined — no partner choice was asked. */
  partner?: PartnerView;
}>;

/** The creator's sends in the last day — every one, the ones the chain refused too. */
async function sendsToday(deps: LaunchDeps, creator: string): Promise<number> {
  const since = deps.now().getTime() - 24 * 60 * 60 * 1000;
  const rows = await deps.store.collection<LaunchAttempt>("launchAttempts").valuesWithPrefix(creatorKey(deps.network.cluster, creator));
  return rows.filter((row) => Date.parse(row.at) >= since).length;
}

/**
 * Builds the creator never signed are kept an hour past their expiry, sends
 * two days (the day's limit counts back one) — then removed: anyone can ask
 * for a build, nobody can fill the store with them, and the counts read a day.
 */
async function sweepBuilds(deps: LaunchDeps): Promise<void> {
  const builds = deps.store.collection<LaunchBuildRecord>("launchBuilds");
  const stale = deps.now().getTime() - 60 * 60 * 1000;
  for (const build of await builds.valuesWithPrefix(`${deps.network.cluster}:`)) {
    if (Date.parse(build.expiresAt) < stale) await builds.delete(buildKey(build.cluster, build.id));
  }
  const attempts = deps.store.collection<LaunchAttempt>("launchAttempts");
  const old = deps.now().getTime() - 48 * 60 * 60 * 1000;
  for (const attempt of await attempts.valuesWithPrefix(`solana:${deps.network.cluster}:`)) {
    if (Date.parse(attempt.at) < old) await attempts.delete(creatorKey(deps.network.cluster, attempt.creator, attempt.buildId));
  }
}

export async function prepareLaunch(deps: LaunchDeps, input: PrepareInput, context: PartnerContext = { carriedCode: null, proven: false }): Promise<PreparedLaunch | LaunchFailure> {
  const preset = launchPreset(input.preset);
  /* «Розширений» has no config of the network's: its own is made for the launch, while the operator's bounds are offered. */
  const offered = preset?.id === "advanced" ? deps.network.advanced !== null : Boolean(preset && deps.network.configs[preset.id]);
  if (!preset || !offered) return fail("PRESET_UNAVAILABLE", "This preset has no config on this network.");
  if ((input.advancedConfig !== undefined) !== (preset.id === "advanced")) return fail("PRESET_UNAVAILABLE", "Only «Розширений» names a config of its own, and it always does.");
  if (input.pairMint !== undefined && preset.id !== "community") return fail("PRESET_UNAVAILABLE", "Only «Спільнота» names its pair.");
  /* «Спільнота»: the community the creator picked; with one community offered, that one. */
  let pairMint: string;
  try {
    if (preset.id === "community" && input.pairMint === undefined && deps.network.communities.length > 1) return fail("PRESET_UNAVAILABLE", "Name the community token to pair with.");
    pairMint = launchPair(deps.network, preset.id, input.pairMint).mint;
  } catch {
    return fail("PRESET_UNAVAILABLE", "That community token is not offered on this network.");
  }
  /* SOL-L12: a pair whose issuer changed its mint since Ryntra first read it — the fee on transfers, an authority, an
     extension — takes no new launch until it reads as before or the operator accepts the change. */
  if (await quotePaused(deps.store, deps.network.cluster, pairMint)) {
    return fail("QUOTE_PAUSED", "The pair currency's issuer changed its token's rules; launches on it wait for Ryntra's check. Nothing was built.");
  }
  /* The demo market is Ryntra's own technical validation: only Ryntra's wallets launch on it through Ryntra. */
  if (preset.audience === "internal" && !(await (deps.ownWallet?.(input.creator) ?? Promise.resolve(false)).catch(() => false))) {
    return fail("PRESET_UNAVAILABLE", "This preset is not open to this wallet.");
  }
  const stored = await metadataOfUri(deps.store, input.metadataUri, deps.origin);
  if (!stored) return fail("METADATA_NOT_FOUND", "The token's details were not found; fill the form again.");
  /* Details Ryntra took down are never launched again under another mint. */
  if (stored.takenDown) return fail("NAME_REFUSED", "Ryntra does not launch a token with these details.");
  const check = checkLaunchForm({ name: stored.metadata.name, symbol: stored.metadata.symbol, description: stored.metadata.description, website: "", x: "", telegram: "" });
  if (check.problems.name === "OFFENSIVE" || check.problems.symbol === "OFFENSIVE") return fail("NAME_REFUSED", "Ryntra does not launch a token under this name or ticker.");
  if (check.hits.length) return fail("NAME_BORROWED", `The name or ticker reads as ${check.hits.map((hit) => hit.label).join(", ")}.`);
  if (input.lock && BigInt(input.firstBuyRaw) <= 0n) return fail("LOCK_NEEDS_PURCHASE", "Only a first purchase can be locked.");
  /* Micro and the demo market: a creator's first purchase goes under the creator's lock, nothing unlocking for six months. */
  if (preset.creatorLockMinDays !== null && BigInt(input.firstBuyRaw) > 0n) {
    const chosen = input.lock ? creatorLockSchedule(input.lock) : null;
    if (!chosen || chosen.cliffDays < preset.creatorLockMinDays) {
      return fail("LOCK_REQUIRED", `On «${preset.name.en}» a first purchase is locked with nothing unlocking for ${preset.creatorLockMinDays} days.`);
    }
    /* MC-1: the purchase and its lock land together or not at all — one v1 transaction; a legacy one cannot hold both
       (1 375 bytes of 1 232). A wallet that does not sign v1 launches here without a first purchase. */
    if (input.format !== "v1") return fail("LOCK_NEEDS_V1", `On «${preset.name.en}» a first purchase and its lock are one v1 transaction; this wallet does not sign v1. Launch without a first purchase, or use a wallet that signs v1.`);
  }
  let shares = input.feeShares ?? [];
  if (shares.length > 0) {
    if (input.crew !== undefined) return fail("SHARES_INVALID", "A crew's launch takes its rows from the crew, not the request.");
    /* CITY-212: the city's launch shares the creator's fees between wallets the creator types, on Classic and Protected
       too. */
    if (preset.id !== "community" && !(isCrewPreset(preset.id) && crewOpenOn(deps.network.cluster))) return fail("SHARES_INVALID", "Only «Спільнота» and a crew share the creator's fees.");
  }
  /* MC-2: a crew's rows — the creator and every member who said yes — from the crew's own record. */
  if (input.crew !== undefined) {
    const aboard = await crewSharesFor({ store: deps.store, cluster: deps.network.cluster, now: deps.now }, { id: input.crew, creator: input.creator, preset: preset.id, symbol: stored.metadata.symbol, name: stored.metadata.name });
    if (!aboard.ok) return fail("SHARES_INVALID", aboard.message);
    shares = aboard.shares;
  }
  if (shares.length > 0) {
    const problems = feeShareProblems(input.creator, shares);
    if (problems.length) return fail("SHARES_INVALID", `The split does not hold: ${problems.join(", ")}.`);
  }
  await sweepBuilds(deps).catch(() => undefined);
  if ((await sendsToday(deps, input.creator)) >= LAUNCHES_PER_CREATOR_PER_DAY) {
    return fail("CREATOR_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} tokens a day.`);
  }
  const payerBalance = BigInt(await deps.connection.getBalance(deps.poolPayer.publicKey, "confirmed"));
  if (payerBalance < POOL_PAYER_FLOOR_LAMPORTS) return fail("PAYER_LOW", "Launching is paused; nothing was built.");

  /* The fresh keys wait sealed for the creator's signature: without the server's key to seal them, nothing is built. */
  const env = deps.env ?? {};
  if (!ticketKeyConfigured(env)) return fail("BUILD_FAILED", "Launching is paused; nothing was built.");
  /* The partner is read after every cheap refusal: its reads wait on the Growth line's store, a refused build never does. */
  /* The creator's partner, as the review showed it — mainnet only: a devnet pool earns nobody anything. A request that
     named no choice (a client without the review) binds nobody: a partner is never bound unseen. */
  let partner: Readonly<{ candidate: PartnerCandidate | null; view: PartnerView; decided: boolean }> | undefined;
  if (input.partner !== undefined) partner = { candidate: null, view: null, decided: false };
  if (input.partner !== undefined && deps.partners && deps.network.cluster === "mainnet") {
    /* The offered partner comes from the creator's own history — their earlier launch, their inviter — read only for
       their proven wallet; the wizard asks for the proof first. Without it, the link's code alone: shown before signing. */
    const choice: PartnerChoice = input.partner === "none" ? { kind: "none" } : input.partner === "offered" ? { kind: "offered" } : { kind: "code", code: input.partner.code };
    const resolved = await resolvePartnerBounded(deps, { creator: input.creator, choice, context });
    if (!resolved.ok) {
      const why = {
        SELF_REFERRAL: "A launch cannot name its own creator as the partner.",
        UNKNOWN_CODE: "That partner code was not found.",
        INVALID: "The creator's address could not be read.",
        UNAVAILABLE: "That partner code cannot be checked right now. Try again, or launch without it.",
      } as const;
      return fail("BUILD_FAILED", why[resolved.code]);
    }
    partner = { candidate: resolved.candidate, view: resolved.view, decided: resolved.decided };
  }

  /* «Розширений»: the creator's own config, made here for this launch and not yet used. */
  let advanced: AdvancedTerms | null = null;
  let configs = deps.network.configs;
  if (preset.id === "advanced") {
    const made = await advancedConfigFor(deps, input.creator, input.advancedConfig ?? "");
    if ("ok" in made) return made;
    advanced = made.terms;
    configs = { ...configs, advanced: made.config };
    /*
     * A config made on a checked pair currency (SOL-L11) carries that mint for ever, so the launch opens its curve in
     * it — and its facts are read again here, before the pool: the badge, the fee, the authorities and the unit must
     * still be the ones checked, or the creator keeps their config and launches nothing on a pair that moved.
     */
    if (advanced.quoteMint !== undefined) {
      const asset = await quoteAssetFor({ cluster: deps.network.cluster, connection: deps.connection, env: deps.env ?? process.env, now: deps.now, price: deps.quotePrice }, advanced.quoteMint);
      if (!asset) return fail("PRESET_UNAVAILABLE", "This pair currency is not one Ryntra checked on this network.");
      if (asset.state !== "OPEN") {
        const why = quoteAssetRefusalWords(asset.problems) || "the pair currency could not be checked now";
        return fail("QUOTE_PAUSED", `A launch in this pair is closed: ${why}. Nothing was built.`);
      }
      pairMint = asset.record.mint;
    }
  }
  const venue = createMeteoraDbcLaunchVenue({ connection: deps.connection, configs, poolPayer: deps.poolPayer.publicKey.toBase58(), advancedFeeClaimer: deps.network.advanced?.feeClaimer ?? null, curveRules: deps.network.curveRules ?? null });
  let built;
  try {
    built = await venue.create(
      {
        network: "solana",
        name: stored.metadata.name,
        symbol: stored.metadata.symbol,
        metadataUri: input.metadataUri,
        preset: preset.id,
        creator: input.creator,
        creatorFirstBuyRaw: input.firstBuyRaw,
        pairMint,
      },
      { creatorCoversPayer: true, feeShares: shares, ...(input.crew !== undefined || (shares.length > 0 && isCrewPreset(preset.id)) ? { crew: true } : {}), ...(advanced ? { custom: advancedPresetOf(advanced) } : {}) },
    );
  } catch (error) {
    if (error instanceof LaunchRefusal && error.code === "CREATOR_BUY_ABOVE_CAP") return fail("FIRST_BUY_ABOVE_CAP", "The first purchase is above the preset's cap.");
    return fail("BUILD_FAILED", error instanceof Error ? error.message : "The launch could not be built.");
  }
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  const now = deps.now();
  let lock: LaunchBuildRecord["lock"] = null;
  let lockWireBase64: string | null = null;
  let lockCost = 0n;
  let lockKey: Keypair | null = null;
  let v1: AtomicCreation | null = null;
  if (input.lock) {
    /*
     * «Комісія за переказ» (SOL-L10): the lock's own transfer would pay the fee too, so the escrow would hold less than
     * the purchase; Met Lock with a Token-2022 transfer fee is proven on devnet first. Until then no lock on such a token.
     */
    if (advanced?.transferFeeBps) return fail("BUILD_FAILED", "A creator's lock on a token with a transfer fee is not offered yet.");
    const schedule = creatorLockSchedule(input.lock);
    if (!schedule) return fail("BUILD_FAILED", "Unknown lock.");
    const lockBuild = await buildCreatorLockTransaction({
      connection: deps.connection,
      mint: built.token,
      creator: input.creator,
      amountRaw: BigInt(built.creatorFirstBuyOutRaw),
      schedule,
      startSeconds: Math.floor(now.getTime() / 1000),
      recentBlockhash: tx.recentBlockhash ?? "",
      lastValidBlockHeight: Number(built.validUntil ?? 0),
    });
    lockKey = lockBuild.baseKey;
    const lockTx = Transaction.from(Buffer.from(lockBuild.wireBase64, "base64"));
    if (preset.creatorLockMinDays !== null) {
      /* MC-1: Micro and the demo market — the lock's instructions after the creation's, in one v1 transaction. */
      const atomic = await atomicCreation(deps, { creation: tx, lock: lockTx, creator: input.creator, validUntil: Number(built.validUntil ?? 0) });
      if (!atomic.ok) return atomic;
      v1 = atomic;
    } else {
      lockWireBase64 = withoutSignaturesOf(lockBuild.wireBase64, [lockKey.publicKey.toBase58()]);
      lockCost = BigInt(lockBuild.costLamports);
    }
    lock = {
      schedule: schedule.id,
      escrow: lockBuild.escrow,
      amountRaw: lockBuild.amountRaw,
      cliffAt: lockBuild.cliffAt,
      endsAt: lockBuild.endsAt,
      ...(v1 ? { messageSha256: v1.messageSha256, inCreation: true as const } : { messageSha256: sha256(lockTx.serializeMessage()), digest: reviewedDigest(lockTx) }),
    };
  }
  /* The wallet signs first: the fresh keys' signatures come off the bytes it sees — the message they cover stays the
     same — and the keys wait, sealed, for the creator's signature. */
  const mintAddress = built.mintKey.publicKey.toBase58();
  const cosigners: Cosigner[] = [{ index: CREATION, key: built.mintKey }];
  /* In one v1 transaction the escrow's base signs the creation; else its own lock. */
  if (lockKey) cosigners.push({ index: v1 ? CREATION : LOCK, key: lockKey });
  if (built.split) cosigners.push({ index: SPLIT, key: built.mintKey });
  const cosign = sealCosigners(cosigners, env);
  if (!cosign) return fail("BUILD_FAILED", "Launching is paused; nothing was built.");
  const splitTx = built.split ? Transaction.from(Buffer.from(built.split.wireBase64, "base64")) : null;
  /* The record lives as long as the bytes do (a signature the chain could still take is never refused here); the page
     is told how long it may still ask the wallet, a margin short for each transaction sent after the creation. */
  const separateLock = lock !== null && !v1;
  const windows = await readBuildWindows(web3ChainReader(deps.connection, READ_MS), built.validUntil ?? "0", {
    transactions: 1 + (separateLock ? 1 : 0) + (built.split ? 1 : 0),
    capMs: BUILD_TTL_MS,
  });
  const record: LaunchBuildRecord = {
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    creator: input.creator,
    preset: preset.id,
    token: built.token,
    pool: built.pool,
    config: built.config,
    pairMint: built.pairMint,
    metadataUri: input.metadataUri,
    name: stored.metadata.name,
    symbol: stored.metadata.symbol,
    firstBuyInRaw: input.firstBuyRaw,
    firstBuyOutRaw: built.creatorFirstBuyOutRaw,
    payerCoveredLamports: v1?.coveredLamports ?? built.payerCoveredLamports,
    messageSha256: v1?.messageSha256 ?? sha256(tx.serializeMessage()),
    lock,
    ...(v1 ? { format: "v1" as const } : {}),
    split: built.split && splitTx ? { vault: built.split.vault, shares, messageSha256: sha256(splitTx.serializeMessage()), digest: reviewedDigest(splitTx) } : null,
    ...(input.crew !== undefined && built.split ? { crew: input.crew } : {}),
    ...(advanced ? { advanced } : {}),
    cosign,
    ...(partner
      ? { partner: partner.candidate ? { wallet: partner.candidate.wallet, code: partner.candidate.code, source: partner.candidate.source } : null, partnerDecided: partner.decided }
      : {}),
    createdAt: now.toISOString(),
    /* Counted from the measurement, not the build's start, with a margin kept for each transaction sent after the
       creation so the last of them can still land. */
    expiresAt: new Date(deps.now().getTime() + Math.max(0, windows.lifeMs - NEXT_TRANSACTION_MARGIN_MS * ((separateLock ? 1 : 0) + (built.split ? 1 : 0)))).toISOString(),
    validUntil: built.validUntil ?? "0",
  };
  await deps.store.collection<LaunchBuildRecord>("launchBuilds").insertIfAbsent(buildKey(record.cluster, record.id), record);
  return {
    ok: true,
    buildId: record.id,
    wireBase64: v1?.wireBase64 ?? withoutSignaturesOf(built.wireBase64, [mintAddress]),
    lockWireBase64,
    splitWireBase64: built.split ? withoutSignaturesOf(built.split.wireBase64, [mintAddress]) : null,
    feeVault: built.split?.vault ?? null,
    token: built.token,
    firstBuyOutRaw: built.creatorFirstBuyOutRaw,
    payerCoveredLamports: v1?.coveredLamports ?? built.payerCoveredLamports,
    creatorCostLamports: (v1 ? BigInt(v1.creatorSpendLamports) : BigInt(built.creatorSpendLamports ?? built.payerCoveredLamports) + lockCost + BigInt(built.split?.costLamports ?? "0")).toString(),
    expiresAt: record.expiresAt,
    signableMs: windows.signableMs,
    ...(partner ? { partner: partner.view } : {}),
  };
}

/** The longest a build waits for the partner it offers: the creator's own reads first, then only the link's code. */
const PARTNER_RESOLVE_MS = 3_000;

/**
 * The partner for a build, bounded by one deadline: a slow account store never holds a launch. The proven creator's full
 * answer and the answer an unproven request gets (the link's code alone) run side by side; the full one is taken if it
 * comes within `PARTNER_RESOLVE_MS`, the plain one otherwise — whichever has come by then. If that differs from what the
 * review showed, the wizard says so before anything is signed.
 */
async function resolvePartnerBounded(
  deps: LaunchDeps,
  args: Readonly<{ creator: string; choice: PartnerChoice; context: PartnerContext }>,
): Promise<Awaited<ReturnType<typeof resolvePartner>>> {
  const ask = (proven: boolean) =>
    resolvePartner(deps.store, deps.partners!, { network: "solana", creator: args.creator, carriedCode: args.context.carriedCode, proven, choice: args.choice }).catch(() => null);
  const settled = <T,>(promise: Promise<T>) => {
    const box: { value?: T } = {};
    void promise.then((value) => { box.value = value; });
    return box;
  };
  const started = Date.now();
  const full = ask(args.context.proven);
  const plainAnswer = args.context.proven ? ask(false) : null;
  const plain = plainAnswer ? settled(plainAnswer) : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([full, new Promise<"late">((resolve) => { timer = setTimeout(() => resolve("late"), PARTNER_RESOLVE_MS); })]);
  clearTimeout(timer);
  if (first && first !== "late") return first;
  /* The full answer failed fast: the link-only one still has the rest of the deadline. */
  if (first === null && plainAnswer) {
    const rest = Math.max(0, PARTNER_RESOLVE_MS - (Date.now() - started));
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    const second = await Promise.race([plainAnswer, new Promise<null>((resolve) => { restTimer = setTimeout(() => resolve(null), rest); })]);
    clearTimeout(restTimer);
    if (second) return second;
  }
  const fallback = plain?.value ?? null;
  if (fallback) return fallback;
  return args.choice.kind === "code" ? { ok: false, code: "UNAVAILABLE" } : { ok: true, candidate: null, decided: false, view: null };
}

/** The longest a launch waits for its partner's binding: the binding is the Growth line's bookkeeping, never the launch's. */
const PARTNER_BIND_MS = 3_000;

/**
 * The pool bound to the partner the creator saw before signing — once; the Growth line refuses any later change. Called
 * after every transaction of the launch is sent, and bounded: it never fails or delays a launch — a binding that could
 * not be written in time leaves the pool without a partner, nothing else.
 */
async function bindPartner(deps: LaunchDeps, build: LaunchBuildRecord, signature: string): Promise<void> {
  if (!deps.partners) return;
  const now = deps.now().toISOString();
  await bindLaunchPartner(deps.store, deps.partners, { ...build, signature, launchedAt: now }, now);
}

/** A launch's pool bound to the partner its creator saw — once, bounded; the launch never waits on it or fails by it. */
export async function bindLaunchPartner(
  store: LaunchDeps["store"],
  partners: PartnerDeps,
  launch: Readonly<{ cluster: string; config: string; pool: string; creator: string; signature: string; launchedAt: string; partner?: LaunchBuildRecord["partner"]; partnerDecided?: boolean }>,
  now: string,
): Promise<void> {
  if (launch.partner === undefined || launch.cluster !== "mainnet") return;
  const bound = recordPoolPartner(store, partners, {
    launch: { network: "solana", factory: launch.config, pool: launch.pool, creator: launch.creator, creationTx: launch.signature, launchedAt: launch.launchedAt },
    partner: launch.partner,
    decided: launch.partnerDecided === true,
    now,
  }).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([bound, new Promise<void>((resolve) => { timer = setTimeout(resolve, PARTNER_BIND_MS); })]);
  clearTimeout(timer);
}

/** The pool payer's signature on the creation, legacy or v1, made by its signer and written into its slot. */
async function payerSigns(payer: LaunchSigner, creation: Transaction | V1Creation): Promise<void> {
  if (creation instanceof V1Creation) {
    creation.addSignature(payer.address, await payer.signMessage(creation.messageBytes()));
    return;
  }
  await signTransaction(payer, creation);
}

/** MC-1: the creation and the lock as one v1 transaction (`atomic-lock.server.ts`); a refusal builds nothing. */
async function atomicCreation(deps: LaunchDeps, input: Readonly<{ creation: Transaction; lock: Transaction; creator: string; validUntil: number }>): Promise<AtomicCreation | LaunchFailure> {
  const composed = await composeAtomicCreation(deps.connection, { ...input, payer: deps.poolPayer.publicKey }).catch((error: unknown) => ({ ok: false as const, reason: error instanceof Error ? error.message : "The launch could not be built." }));
  return composed.ok ? composed : fail("BUILD_FAILED", composed.reason);
}

/** The v1 creation the creator signed, held to the build as `signedAsBuilt` holds a legacy one. */
function signedV1AsBuilt(wireBase64: string, messageSha256: string, creator: string, keys: readonly Keypair[], except: PublicKey): V1Creation | LaunchFailure {
  const read = readSignedV1(wireBase64, messageSha256, creator, keys, except);
  return read.ok ? read.creation : fail(read.code, read.reason);
}

/** The transactions of a build, by their place among the sealed fresh keys. */
const CREATION = 0;
const LOCK = 1;
const SPLIT = 2;

/**
 * The creator's signed bytes against the remembered build, and the fresh keys' signatures after the creator's.
 *
 * The message must be the remembered one byte for byte — or, where `digest` is given (a transaction the creator pays
 * for), the same instructions, paid for by the creator, with only what a wallet may add on signing and no signer the
 * build did not name. The creator's signature must be there and valid; then `keys` sign over the exact message the
 * creator signed, and every signature but `except`'s (the pool payer's, which signs last) must be there and valid.
 */
export function signedAsBuilt(
  wireBase64: string,
  built: Readonly<{ messageSha256: string; digest?: string }>,
  creator: string,
  keys: readonly Keypair[],
  except: PublicKey | null,
): Transaction | LaunchFailure {
  let tx: Transaction;
  let exact: VersionedTransaction;
  try {
    tx = Transaction.from(Buffer.from(wireBase64, "base64"));
    exact = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  } catch {
    return fail("SIGNED_OTHER_BYTES", "The wallet returned bytes that are not a transaction.");
  }
  if (exact.version !== "legacy") return fail("SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  const same = sha256(tx.serializeMessage()) === built.messageSha256;
  const added = !same && built.digest !== undefined && tx.feePayer?.toBase58() === creator && reviewedDigest(tx) === built.digest && walletAdditionsAllowed(tx);
  if (!same && !added) return fail("SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  const message = exact.message.serialize();
  const signers = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures);
  const real = (at: number) => {
    const signature = exact.signatures[at];
    return Boolean(signature) && signature!.some((byte) => byte !== 0) && ed25519Valid(message, signature!, signers[at]!);
  };
  /* The creator first: their signature over these bytes, before any key of the server's signs them. */
  const creatorAt = signers.findIndex((signer) => signer.toBase58() === creator);
  if (creatorAt < 0 || !real(creatorAt)) return fail("SIGNATURE_MISSING", "The transaction is not signed by the creator.");
  /* The fresh keys after, over the exact message the creator signed. */
  try {
    if (keys.length) exact.sign([...keys]);
  } catch {
    return fail("SIGNED_OTHER_BYTES", "The wallet signed a different transaction than the one built.");
  }
  const unsigned = signers.filter((signer, at) => !(except && signer.equals(except)) && !real(at));
  if (unsigned.length) return fail("SIGNATURE_MISSING", "A signature does not match the transaction.");
  return Transaction.from(exact.serialize());
}

export type SubmittedLaunch = Readonly<{ ok: true; token: string; signature: string; state: "LAUNCHED" | "PENDING"; lock: LaunchRecord["lock"]; feeSharing: NonNullable<LaunchRecord["feeSharing"]> | null; tokenPath: string }>;

/**
 * What one send came to: confirmed; refused by the network's own preflight
 * before it reached the chain (it cost nobody anything); failed on chain (the
 * pool payer paid its fee); or not known yet — the bytes may still land until
 * their blockhash expires.
 */
export type Sent = Readonly<{ outcome: "CONFIRMED" | "REJECTED" | "FAILED" | "UNKNOWN"; signature: string; reason: string | null; /** A refusal's whole text with the program's logs, for telling one refusal from another. */ detail?: string }>;

/**
 * Blocks past a blockhash's last valid height before a signature nobody has is called expired. A node answers its
 * height and its signatures from different moments — and behind a public endpoint, from different machines — so the
 * edge itself is never the word: on 2026-10-06 two creations landed at the edge and were answered «expired».
 */
export const EXPIRY_MARGIN_BLOCKS = 30;

/** How long one read of the chain may take inside a send's budget; past it the read counts as not answered. */
const READ_MS = 3_000;

/** A read inside its time: its answer, or undefined when it failed or did not come in time. */
async function within<T>(read: () => Promise<T>, ms = READ_MS): Promise<T | undefined> {
  /* No time left is no answer: the read is not even asked. */
  if (!(ms > 0)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), ms)))]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A read that may take only until `deadline` (ms): its answer, or `fallback` when it fails or the time runs out — the
 * route answers inside its 60 s, and what was not read is said as not read.
 */
export async function byDeadline<T, F>(read: () => Promise<T>, deadline: number, now: () => Date, fallback: F): Promise<T | F> {
  const answer = await within(read, deadline - now().getTime());
  return answer === undefined ? fallback : answer;
}

/**
 * A signature's status as one node answers it: the status, null when the node answered that it has none, undefined when
 * it did not answer — or answered from a slot before `minSlot`, where a missing signature says nothing.
 */
async function statusOn(connection: Connection, signature: string, minSlot: number | null, ms: number) {
  const read = await within(() => connection.getSignatureStatuses([signature], { searchTransactionHistory: true }), ms);
  if (!read) return undefined;
  const status = read.value[0] ?? null;
  if (status) return status;
  return minSlot !== null && !(Number(read.context?.slot) >= minSlot) ? undefined : null;
}

export type SignatureRead = Readonly<{ outcome: Sent["outcome"] | "EXPIRED"; /** The slot past the blockhash the «absent» answers were read at. */ slot: number | null }>;

/**
 * The chain's word on a signature: confirmed, refused, expired (its blockhash passed and it never landed), or not known
 * yet. Expired only when the chain is past the blockhash's height by a margin and every node asked answered — from that
 * slot or later — that it has no such signature: a read that failed, or came from a node behind, is not «absent».
 */
export async function readSignature(
  connection: Connection,
  signature: string,
  validUntil: number,
  second: Connection | null,
  /** The time one read may take now — what is left of a send's budget, at most `READ_MS`. */
  cap: () => number = () => READ_MS,
): Promise<SignatureRead> {
  /* Height and slot in one answer of one node, read first: the absences below must come from that slot or later. */
  const tip = await within(() => connection.getEpochInfo("confirmed"), cap());
  const past = tip && tip.blockHeight !== undefined && tip.blockHeight > validUntil + EXPIRY_MARGIN_BLOCKS ? tip.absoluteSlot : null;
  const reads = [await statusOn(connection, signature, past, cap())];
  if (!reads[0] && second) reads.push(await statusOn(second, signature, past, cap()));
  const status = reads.find((read) => read);
  if (status) {
    if (status.err !== null) return { outcome: "FAILED", slot: null };
    if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return { outcome: "CONFIRMED", slot: null };
    return { outcome: "UNKNOWN", slot: null };
  }
  if (past === null || reads.some((read) => read === undefined)) return { outcome: "UNKNOWN", slot: null };
  return { outcome: "EXPIRED", slot: past };
}

/** A sent signature's word from the chain: landed, failed, expired unseen, or not known yet. */
export async function signatureOutcome(connection: Connection, signature: string, validUntil: number, second: Connection | null = null): Promise<Sent["outcome"] | "EXPIRED"> {
  return (await readSignature(connection, signature, validUntil, second)).outcome;
}

/** The programs a creation's mint belongs to: an account at its address owned by anything else is not the mint. */
export const MINT_OWNERS: readonly string[] = [TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()];

/**
 * Whether the account a transaction opens is on any node asked, owned by the program that opens it: true when one has
 * it, false when every one answered — from `minSlot` or later — that it has none, null otherwise. A creation's mint is a
 * fresh key only that creation opens, so its mint on chain is the creation landed — whatever any signature read said.
 * Lamports anyone sends to the address make an account the system owns, and that is not the mint.
 */
export async function accountOnChain(
  connections: readonly (Connection | null | undefined)[],
  address: string,
  owners: readonly string[],
  minSlot: number | null = null,
  cap: () => number = () => READ_MS,
): Promise<boolean | null> {
  let unread = false;
  for (const connection of connections) {
    if (!connection) continue;
    const read = await within(() => connection.getAccountInfoAndContext(new PublicKey(address), { commitment: "confirmed", ...(minSlot !== null ? { minContextSlot: minSlot } : {}) }), cap());
    if (!read) {
      unread = true;
      continue;
    }
    if (read.value && owners.includes(read.value.owner.toBase58())) return true;
  }
  return unread ? null : false;
}

const SETTLE_POLL_MS = 2_000;

/** A preflight refusal: the RPC simulated the bytes and they failed — the chain never saw them. Any other send error leaves the outcome open. */
function preflightRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const logs = (error as { logs?: unknown }).logs;
  /* «Already processed» is a preflight answer too, and it means the opposite: the bytes are on chain. */
  if (/already (been )?processed/i.test(error.message)) return false;
  return /simulation failed|Transaction simulation/i.test(error.message) || (Array.isArray(logs) && logs.length > 0);
}

/**
 * One send, inside a time budget: confirm for up to `confirmMs`, then read the
 * signature's status until `settleMs` more has passed. The whole stays within
 * what the route may take; past it the outcome is UNKNOWN and the token's read
 * settles it from the chain. `landed` reads what the transaction makes on chain
 * (a creation's mint): found, the send is confirmed whatever a signature read
 * said; not readable, an «expired» is not said.
 */
/** What a send needs of a transaction: its bytes, its id (the first signature) and its blockhash — a legacy `Transaction`, or v1 bytes read back. */
export type Sendable = Readonly<{ serialize: () => Uint8Array; signatures: readonly Readonly<{ signature: Uint8Array | null }>[]; recentBlockhash?: string }>;

export async function sendOnce(
  connection: Connection,
  tx: Sendable,
  validUntil: number,
  now: () => Date,
  budget: Readonly<{ confirmMs: number; settleMs: number; /** An absolute time (ms) the whole send ends by, whatever its budget. */ deadline?: number }>,
  check: Readonly<{
    second?: Connection | null;
    landed?: (minSlot: number | null, cap: () => number) => Promise<boolean | null>;
    /** SOL-P1: how long the send and the confirmation took, pushed here when given — the route's `Server-Timing`. */
    timings?: StepTiming[];
  }> = {},
): Promise<Sent> {
  const sendStarted = performance.now();
  let sentAt: number | null = null;
  try {
    return await sendAndConfirm();
  } finally {
    const end = performance.now();
    check.timings?.push({ name: "send", ms: (sentAt ?? end) - sendStarted });
    if (sentAt !== null) check.timings?.push({ name: "confirm", ms: end - sentAt });
  }

  async function sendAndConfirm(): Promise<Sent> {
    /* One clock for the whole send: the send and its confirmation share `confirmMs`, the reads after it `settleMs`, and
       every read is cut to what is left — past `end` the answer is UNKNOWN, and the token's read settles it. */
    const start = now().getTime();
    const end = Math.min(start + budget.confirmMs + budget.settleMs, budget.deadline ?? Number.POSITIVE_INFINITY);
    const confirmEnd = Math.min(start + budget.confirmMs, end);
    const cap = () => Math.min(READ_MS, end - now().getTime());
    const signature = getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array()));
    let sendError: unknown = null;
    try {
      /* A send that does not answer within the confirmation's time is a lost answer, not a refusal. */
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 2 }),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("The node did not answer the send in time.")), Math.max(0, confirmEnd - now().getTime())))),
      ]).finally(() => timer && clearTimeout(timer));
    } catch (error) {
      if (preflightRefused(error)) {
        const logs = (error as { logs?: unknown }).logs;
        const detail = `${error instanceof Error ? error.message : ""}\n${Array.isArray(logs) ? logs.join("\n") : ""}`;
        return { outcome: "REJECTED", signature, reason: error instanceof Error ? error.message.slice(0, 300) : "The network refused it.", detail };
      }
      /* A lost answer is not a refusal: the bytes may have reached the network. */
      sendError = error;
    }
    sentAt = performance.now();
    if (!sendError && confirmEnd > now().getTime()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const confirmed = await Promise.race([
          connection.confirmTransaction({ signature, blockhash: tx.recentBlockhash ?? "", lastValidBlockHeight: validUntil }, "confirmed"),
          new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), Math.max(0, confirmEnd - now().getTime())))),
        ]).finally(() => timer && clearTimeout(timer));
        if (confirmed) return confirmed.value.err ? { outcome: "FAILED", signature, reason: JSON.stringify(confirmed.value.err).slice(0, 300) } : { outcome: "CONFIRMED", signature, reason: null };
      } catch (error) {
        sendError = error;
      }
    }
    /* Not confirmed in time is not «failed»: the bytes may still land until their blockhash expires. The chain's own word
       decides. The last reads keep their slice of the budget: the mint found at the end is a launch, not a «pending». */
    const until = Math.max(Math.min(confirmEnd, end), end - 5 * READ_MS);
    for (;;) {
      const { outcome, slot } = await readSignature(connection, signature, validUntil, check.second ?? null, cap);
      if (outcome === "CONFIRMED") return { outcome, signature, reason: null };
      if (outcome === "FAILED") return { outcome: "FAILED", signature, reason: sendError instanceof Error ? sendError.message.slice(0, 300) : "The network refused it on chain." };
      const over = now().getTime() >= until;
      if (outcome === "EXPIRED" || over) {
        /* Absent only from the slot the «expired» was read at or later; otherwise an absence says nothing. */
        const landed = check.landed ? await check.landed(outcome === "EXPIRED" ? slot : null, cap).catch(() => null) : false;
        if (landed === true) return { outcome: "CONFIRMED", signature, reason: null };
        if (outcome === "EXPIRED" && landed === false) return { outcome: "REJECTED", signature, reason: "The network never saw the transaction before its blockhash expired." };
        if (over) return { outcome: "UNKNOWN", signature, reason: null };
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(SETTLE_POLL_MS, until - now().getTime()))));
    }
  }
}

/* The route may run 60 s: the creation gets the most of it, the lock and the sharing what remains of `ROUTE_MS`; past it, PENDING. */
export const CREATION_BUDGET = { confirmMs: 20_000, settleMs: 10_000 } as const;
const LOCK_BUDGET = { confirmMs: 12_000, settleMs: 6_000 } as const;
const ROUTE_MS = 50_000;
/** Less time than this left, a second transaction is not sent: it would be cut off mid-way. */
const SECOND_SEND_MIN_MS = 6_000;

/** A second transaction's budget out of what the route has left; null when too little is left to send it. */
export function budgetLeft(deadline: number, now: number): Readonly<{ confirmMs: number; settleMs: number }> | null {
  const left = deadline - now;
  if (left < SECOND_SEND_MIN_MS) return null;
  return { confirmMs: Math.min(LOCK_BUDGET.confirmMs, Math.floor(left * 0.6)), settleMs: Math.min(LOCK_BUDGET.settleMs, Math.floor(left * 0.2)) };
}

export type LaunchAttempt = Readonly<{ buildId: string; creator: string; at: string }>;

/** Claims one send for a build and counts it against the creator's day and the network's hour; a claim over a limit is released and refused. */
async function claimAttempt(deps: LaunchDeps, build: LaunchBuildRecord): Promise<LaunchFailure | null> {
  const attempts = deps.store.collection<LaunchAttempt>("launchAttempts");
  const key = creatorKey(build.cluster, build.creator, build.id);
  const now = deps.now();
  /* One send per build: whoever claims the key sends; a second press of the button finds it used. */
  if (!(await attempts.insertIfAbsent(key, { buildId: build.id, creator: build.creator, at: now.toISOString() }))) return fail("BUILD_USED", "This launch was already sent.");
  const day = now.getTime() - 24 * 60 * 60 * 1000;
  const hour = now.getTime() - 60 * 60 * 1000;
  const mine = (await attempts.valuesWithPrefix(creatorKey(build.cluster, build.creator))).filter((row) => Date.parse(row.at) >= day).length;
  const all = (await attempts.valuesWithPrefix(`solana:${build.cluster}:`)).filter((row) => Date.parse(row.at) >= hour).length;
  if (mine > LAUNCHES_PER_CREATOR_PER_DAY || all > LAUNCHES_PER_HOUR) {
    await attempts.delete(key);
    /* The network's hour is a busy hour, not a pause: Launch itself goes on, and the creator can try again later. */
    return mine > LAUNCHES_PER_CREATOR_PER_DAY
      ? fail("CREATOR_LIMIT", `One wallet launches at most ${LAUNCHES_PER_CREATOR_PER_DAY} tokens a day.`)
      : fail("NETWORK_BUSY", `Too many launches right now: at most ${LAUNCHES_PER_HOUR} an hour go out through Ryntra. Nothing was sent.`);
  }
  return null;
}

export async function submitLaunch(
  deps: LaunchDeps,
  input: Readonly<{ buildId: string; creator: string; signedWireBase64: string; signedLockWireBase64: string | null; signedSplitWireBase64?: string | null }>,
): Promise<SubmittedLaunch | LaunchFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const builds = deps.store.collection<LaunchBuildRecord>("launchBuilds");
  const build = await builds.get(buildKey(deps.network.cluster, input.buildId));
  if (!build || build.cluster !== deps.network.cluster) return fail("NOT_BUILT", "This launch was not built here.");
  if (build.creator !== input.creator) return fail("WRONG_CREATOR", "This launch was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("BUILD_EXPIRED", "The launch waited too long for the signature; build it again.");
  /* The fresh keys sealed with the build; a build from before the wallet signed first has none — its bytes carry them. */
  const sealed = build.cosign ? openCosigners(build.cosign, deps.env ?? {}) : [];
  if (!sealed) return fail("BUILD_EXPIRED", "The launch can no longer be signed; build it again.");
  const keysOf = (index: number) => sealed.filter((cosigner) => cosigner.index === index).map((cosigner) => cosigner.key);
  /* The creation exactly as built: the pool payer pays its fee, so nothing may be added to it. */
  const creation = build.format === "v1"
    ? signedV1AsBuilt(input.signedWireBase64, build.messageSha256, build.creator, keysOf(CREATION), deps.poolPayer.publicKey)
    : signedAsBuilt(input.signedWireBase64, { messageSha256: build.messageSha256 }, build.creator, keysOf(CREATION), deps.poolPayer.publicKey);
  if ("ok" in creation) return creation;
  let lockTx: Transaction | null = null;
  if (build.lock && !build.lock.inCreation) {
    if (!input.signedLockWireBase64) return fail("SIGNATURE_MISSING", "The lock was not signed.");
    const signed = signedAsBuilt(input.signedLockWireBase64, build.lock, build.creator, keysOf(LOCK), null);
    if ("ok" in signed) return signed;
    lockTx = signed;
  }
  let splitTx: Transaction | null = null;
  if (build.split) {
    if (!input.signedSplitWireBase64) return fail("SIGNATURE_MISSING", "The sharing of the creator's fees was not signed.");
    const signed = signedAsBuilt(input.signedSplitWireBase64, build.split, build.creator, keysOf(SPLIT), null);
    if ("ok" in signed) return signed;
    splitTx = signed;
  }
  /* MC-2: the crew is held for this token before anything is counted or sent — only while its answers are still the
     build's rows; a yes taken back since, or another launch holding it, and nothing goes. */
  let heldCrew = false;
  if (build.crew && build.split) {
    const held = await holdCrew(deps.store, build.cluster, { id: build.crew, token: build.token, shares: build.split.shares, at: deps.now().toISOString() });
    if (!held.ok) return fail("SHARES_INVALID", held.message);
    heldCrew = held.fresh;
  }
  const refused = await claimAttempt(deps, build);
  if (refused) {
    if (heldCrew && build.crew) await releaseCrew(deps.store, build.cluster, build.crew, build.token);
    return refused;
  }
  /* «Розширений»: the config is taken before anything is written or sent — a second launch on it is refused here. */
  if (build.preset === "advanced" && !(await takeAdvancedConfig(deps, build.config, build.id))) {
    if (heldCrew && build.crew) await releaseCrew(deps.store, build.cluster, build.crew, build.token);
    return fail("BUILD_USED", "A launch was already sent on this config; make another.");
  }

  /* The pool payer signs last, through its signer (CITY-162): these bytes as built, or nothing — a refusal, or a key that
     did not answer, sends nothing, and what was held for this send is let go as after a refusal before the chain. */
  const unsigned = await payerSigns(deps.poolPayer, creation).then(
    () => false,
    () => true,
  );
  if (unsigned) {
    if (build.preset === "advanced") await returnAdvancedConfig(deps, build.config).catch(() => undefined);
    if (heldCrew && build.crew) await releaseCrew(deps.store, build.cluster, build.crew, build.token);
    await deps.store.collection<LaunchAttempt>("launchAttempts").delete(creatorKey(build.cluster, build.creator, build.id));
    return fail("SUBMIT_FAILED", "Ryntra's pool payer did not sign the launch; nothing was sent.");
  }
  const signature = getBase58Decoder().decode(new Uint8Array(creation.signatures[0]?.signature ?? new Uint8Array()));
  /* In one v1 transaction the lock is the creation's: it lands with it, under its signature. */
  const lockInCreation = (state: "LOCKED" | "PENDING"): LaunchRecord["lock"] => (build.lock?.inCreation ? { schedule: build.lock.schedule, escrow: build.lock.escrow, signature, state, reason: null } : null);
  const referral = await ensureRewardAccount(deps.store, build.creator, deps.now().toISOString()).catch(() => null);
  const pending: LaunchRecord = {
    cluster: build.cluster,
    state: "PENDING",
    token: build.token,
    pool: build.pool,
    config: build.config,
    pairMint: build.pairMint,
    preset: build.preset,
    creator: build.creator,
    name: build.name,
    symbol: build.symbol,
    metadataUri: build.metadataUri,
    signature,
    validUntil: build.validUntil,
    firstBuyInRaw: build.firstBuyInRaw,
    firstBuyOutRaw: build.firstBuyOutRaw,
    lock: null,
    feeSharing: null,
    ...(build.advanced ? { advanced: build.advanced } : {}),
    referralCode: referral?.code ?? null,
    launchedAt: deps.now().toISOString(),
    buildId: build.id,
  };
  /* Written before the send: a launch the network has not answered for yet is still found, and its page reads the chain to finish it. */
  await writeLaunch(deps.store, pending);
  /* The creator's first purchase is a trade on the curve like any other: its History row before the send, settled from
     the creation's own transaction by History or the reconciliation. */
  const firstBuy = BigInt(build.firstBuyInRaw) > 0n && deps.network.tradesRecorded && launchWritesHere(deps.network);
  if (firstBuy) {
    const pair = launchPair(deps.network, build.preset, build.pairMint);
    await beginLaunchTrade(deps, {
      cluster: build.cluster,
      signature,
      wallet: build.creator,
      side: "buy",
      venue: "curve",
      token: { mint: build.token, symbol: build.symbol.slice(0, 24), decimals: launchPreset(build.preset)?.token.decimals ?? 6 },
      pair: { mint: build.pairMint, symbol: pair.symbol, decimals: pair.decimals, dollar: pair.dollar },
      curve: build.pool,
      config: build.config,
      pool: null,
      buildId: build.id,
      reviewDigest: `0x${build.messageSha256}`,
      validUntil: build.validUntil,
      /* Quoted by what it buys: the curve was fresh, the amount exact — no fee split was shown. */
      quote: { amountInRaw: build.firstBuyInRaw, amountOutRaw: build.firstBuyOutRaw, minimumOutRaw: build.firstBuyOutRaw, slippageBps: 0, feeRaw: null, ryntraRaw: null },
    }).catch(() => undefined);
  }
  /* The mint is a fresh key only this creation opens: its account on chain is the launch landed, whatever a node says of the signature. */
  const sent = await sendOnce(deps.connection, creation, Number(build.validUntil), deps.now, { ...CREATION_BUDGET, deadline }, {
    second: deps.second,
    landed: (minSlot, cap) => accountOnChain([deps.connection, deps.second], build.token, MINT_OWNERS, minSlot, cap),
  });
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    await removeLaunch(deps.store, pending);
    if (build.preset === "advanced") await returnAdvancedConfig(deps, build.config).catch(() => undefined);
    /* MC-2: a launch that never was holds no crew. */
    if (heldCrew && build.crew) await releaseCrew(deps.store, build.cluster, build.crew, build.token);
    if (firstBuy) await failLaunchTrade(deps, build.cluster, signature, sent.reason ?? "The network refused the launch.").catch(() => undefined);
    /* Refused before the chain saw it: it cost nobody anything, so it counts against no limit. A failure on chain cost the payer its fee and stays counted. */
    if (sent.outcome === "REJECTED") await deps.store.collection<LaunchAttempt>("launchAttempts").delete(creatorKey(build.cluster, build.creator, build.id));
    return fail("SUBMIT_FAILED", sent.reason ?? "The network refused the launch.");
  }
  /* «Розширений»: one config, one launch — a refused creation leaves it the creator's to launch on again. */
  if (build.preset === "advanced") await markAdvancedConfigUsed(deps, build.config, build.token).catch(() => undefined);
  if (sent.outcome === "UNKNOWN") {
    /* The lock waits for the creation: its tokens exist only once the creation lands. The page says what the chain says. */
    const lock: LaunchRecord["lock"] = build.lock?.inCreation ? lockInCreation("PENDING") : build.lock ? { schedule: build.lock.schedule, escrow: build.lock.escrow, signature: null, state: "FAILED", reason: "not sent: the launch was not confirmed in time" } : null;
    const feeSharing: LaunchRecord["feeSharing"] = build.split ? { vault: build.split.vault, shares: build.split.shares, signature: null, state: "FAILED", reason: "not sent: the launch was not confirmed in time" } : null;
    /* Not confirmed in time: no binding now — a launch that never lands must not become the creator's "latest choice".
       The partner the creator saw rides on the pending record, and the read that finds it landed binds it. */
    await writeLaunch(deps.store, { ...pending, lock, feeSharing, ...(build.partner !== undefined ? { partner: build.partner, partnerDecided: build.partnerDecided === true } : {}) });
    return { ok: true, token: build.token, signature, state: "PENDING", lock, feeSharing, tokenPath: `/app/launch/${build.token}` };
  }

  /* Landed: written LAUNCHED before the lock and the sharing go, each PENDING under its own signature — a route cut off
     mid-way leaves a launch its page finds and settles from the chain, never one that seems not to exist. */
  const sigOf = (tx: Transaction) => getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array()));
  let lock: LaunchRecord["lock"] = build.lock?.inCreation ? lockInCreation("LOCKED") : build.lock && lockTx ? { schedule: build.lock.schedule, escrow: build.lock.escrow, signature: sigOf(lockTx), state: "PENDING", reason: null } : null;
  let feeSharing: LaunchRecord["feeSharing"] =
    build.split && splitTx ? { vault: build.split.vault, shares: build.split.shares, signature: sigOf(splitTx), state: "PENDING", reason: null } : null;
  await writeLaunch(deps.store, { ...pending, state: "LAUNCHED", lock, feeSharing });
  if (build.lock && lockTx && lock) {
    const escrow = build.lock.escrow;
    const budget = budgetLeft(deadline, deps.now().getTime());
    if (!budget) lock = { ...lock, signature: null, state: "FAILED", reason: "not sent: the launch took the route's time" };
    else {
      const locked = await sendOnce(deps.connection, lockTx, Number(build.validUntil), deps.now, { ...budget, deadline }, {
        second: deps.second,
        landed: (minSlot, cap) => accountOnChain([deps.connection, deps.second], escrow, [MET_LOCK_PROGRAM], minSlot, cap),
      });
      const state = locked.outcome === "CONFIRMED" ? "LOCKED" : locked.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
      lock = { ...lock, signature: locked.signature, state, reason: state === "FAILED" ? (locked.reason ?? "the network refused the lock") : null };
    }
  }
  if (build.split && splitTx && feeSharing) {
    const budget = budgetLeft(deadline, deps.now().getTime());
    if (!budget) feeSharing = { ...feeSharing, signature: null, state: "FAILED", reason: "not sent: the launch took the route's time" };
    else {
      const shared = await sendOnce(deps.connection, splitTx, Number(build.validUntil), deps.now, { ...budget, deadline }, { second: deps.second });
      const state = shared.outcome === "CONFIRMED" ? "SHARED" : shared.outcome === "UNKNOWN" ? "PENDING" : "FAILED";
      feeSharing = { ...feeSharing, signature: shared.signature, state, reason: state === "FAILED" ? (shared.reason ?? "the network refused the sharing") : null };
    }
  }
  const launched: LaunchRecord = { ...pending, state: "LAUNCHED", lock, feeSharing };
  await writeLaunch(deps.store, launched);
  /* A sharing that never went shares nothing: the other wallets' rows written while it was pending go. */
  if (feeSharing?.state === "FAILED") await unindexFeeShares(deps.store, launched);
  /* The launch's own sends and records first; then, bounded, the partner. */
  await bindPartner(deps, build, signature);
  return { ok: true, token: build.token, signature, state: "LAUNCHED", lock, feeSharing, tokenPath: `/app/launch/${build.token}` };
}

/** A launch whose creator fees a wallet shares in, indexed by that wallet — the creator's own row is in `launchesByCreator`. */
export type FeeShareIndex = Readonly<{ cluster: string; wallet: string; token: string }>;
export const FEE_SHARE_INDEX = "launchFeeShares";
export const feeShareKey = (cluster: string, wallet: string, token = "") => `solana:${cluster}:${wallet}:${token}`;

async function indexFeeShares(store: GuardStore, record: LaunchRecord): Promise<void> {
  const sharing = record.feeSharing;
  if (!sharing || sharing.state === "FAILED") return;
  const index = store.collection<FeeShareIndex>(FEE_SHARE_INDEX);
  for (const share of sharing.shares) {
    if (share.address === record.creator) continue;
    await index.set(feeShareKey(record.cluster, share.address, record.token), { cluster: record.cluster, wallet: share.address, token: record.token });
  }
}

async function unindexFeeShares(store: GuardStore, record: LaunchRecord): Promise<void> {
  const index = store.collection<FeeShareIndex>(FEE_SHARE_INDEX);
  for (const share of record.feeSharing?.shares ?? []) await index.delete(feeShareKey(record.cluster, share.address, record.token));
}

export async function writeLaunch(store: GuardStore, record: LaunchRecord): Promise<void> {
  await store.collection<LaunchRecord>("launches").set(launchKey(record.cluster, record.token), record);
  await store.collection<LaunchRecord>("launchesByCreator").set(creatorKey(record.cluster, record.creator, record.token), record);
  await indexFeeShares(store, record);
}

async function removeLaunch(store: GuardStore, record: LaunchRecord): Promise<void> {
  await store.collection<LaunchRecord>("launches").delete(launchKey(record.cluster, record.token));
  await store.collection<LaunchRecord>("launchesByCreator").delete(creatorKey(record.cluster, record.creator, record.token));
}

/** What reading a launch's record needs: the store and the chain, a second operator, and — where it is served — adopting a launch the store lost. */
export type LaunchReadDeps = Pick<LaunchDeps, "store" | "connection"> &
  Readonly<{
    second?: Connection | null;
    adopt?: ((token: string) => Promise<LaunchRecord | null>) | null;
    /** A pending launch found landed is bound to the partner its creator saw (the Growth line's binding). */
    bindPartner?: ((record: LaunchRecord) => Promise<void>) | null;
  }>;

/**
 * A launch as its record and the chain say now: a pending one is settled by
 * the chain's word on its signature — confirmed becomes launched, refused or
 * expired is removed (nothing landed) — and anything still unknown stays
 * pending. A pending one whose mint is on chain landed, whatever the
 * signature read said. With no record, a launch the chain shows Ryntra's
 * pool payer created is adopted where `adopt` is given. Null when there is no
 * launch of the token here.
 */
export async function readLaunchRecord(deps: LaunchReadDeps, cluster: string, token: string): Promise<LaunchRecord | null> {
  const record = (await deps.store.collection<LaunchRecord>("launches").get(launchKey(cluster, token))) ?? null;
  /* A launch the store lost is adopted from the chain where that is served; a read that fails there is «not found». */
  if (!record) return deps.adopt ? deps.adopt(token).catch(() => null) : null;
  if (record.state !== "PENDING") return record;
  const read = await readSignature(deps.connection, record.signature, Number(record.validUntil), deps.second ?? null);
  let outcome = read.outcome;
  if (outcome === "EXPIRED" || outcome === "UNKNOWN") {
    const landed = await accountOnChain([deps.connection, deps.second], record.token, MINT_OWNERS, outcome === "EXPIRED" ? read.slot : null);
    if (landed === true) outcome = "CONFIRMED";
    else if (landed === null && outcome === "EXPIRED") outcome = "UNKNOWN";
  }
  if (outcome === "CONFIRMED") {
    const { partner, partnerDecided, ...rest } = record;
    const launched: LaunchRecord = { ...rest, state: "LAUNCHED" };
    await writeLaunch(deps.store, launched);
    if (partner !== undefined && deps.bindPartner) await deps.bindPartner({ ...launched, partner, partnerDecided: partnerDecided === true }).catch(() => undefined);
    return launched;
  }
  if (outcome === "FAILED" || outcome === "EXPIRED") {
    /* Only the pending record this read judged: one the send or another read has settled meanwhile stays. */
    const current = await deps.store.collection<LaunchRecord>("launches").get(launchKey(cluster, token));
    if (current?.state !== "PENDING" || current.signature !== record.signature) return current ?? null;
    await removeLaunch(deps.store, record);
    /* Never seen by the chain, it cost nobody anything: its send counts against no limit. */
    if (outcome === "EXPIRED" && record.buildId) await deps.store.collection<LaunchAttempt>("launchAttempts").delete(creatorKey(cluster, record.creator, record.buildId));
    return null;
  }
  return record;
}

/**
 * The lock as the chain settles it: an escrow at its address is LOCKED, whatever the send said; a PENDING one whose
 * signature failed or expired is FAILED. The record is rewritten when the state changes.
 */
export async function settleLaunchLock(deps: LaunchReadDeps, record: LaunchRecord, escrowFound: boolean): Promise<LaunchRecord> {
  const lock = record.lock;
  if (!lock || lock.state === "LOCKED") return record;
  let next: NonNullable<LaunchRecord["lock"]> | null = null;
  if (escrowFound) next = { ...lock, state: "LOCKED", reason: null };
  else if (lock.state === "PENDING" && lock.signature) {
    const outcome = await signatureOutcome(deps.connection, lock.signature, Number(record.validUntil), deps.second ?? null);
    if (outcome === "FAILED" || outcome === "EXPIRED") next = { ...lock, state: "FAILED", reason: "the network did not take the lock" };
  }
  if (!next) return record;
  const settled: LaunchRecord = { ...record, lock: next };
  await writeLaunch(deps.store, settled);
  return settled;
}

/**
 * The sharing as the chain settles it: the vault holding the curve's creator role is SHARED, whatever the send said; a
 * PENDING one whose signature failed or expired is FAILED. The record is rewritten when the state changes.
 */
export async function settleFeeSharing(deps: LaunchReadDeps, record: LaunchRecord, roleOwner: string | null): Promise<LaunchRecord> {
  const sharing = record.feeSharing;
  if (!sharing || sharing.state === "SHARED") return record;
  let next: NonNullable<LaunchRecord["feeSharing"]> | null = null;
  if (roleOwner === sharing.vault) next = { ...sharing, state: "SHARED", reason: null };
  else if (sharing.state === "PENDING" && sharing.signature) {
    const outcome = await signatureOutcome(deps.connection, sharing.signature, Number(record.validUntil), deps.second ?? null);
    if (outcome === "FAILED" || outcome === "EXPIRED") next = { ...sharing, state: "FAILED", reason: "the network did not take the sharing" };
  }
  if (!next) return record;
  const settled: LaunchRecord = { ...record, feeSharing: next };
  await writeLaunch(deps.store, settled);
  /* A sharing that never landed shares nothing: the other wallets' rows go, and the creator keeps every fee. */
  if (next.state === "FAILED") await unindexFeeShares(deps.store, settled);
  return settled;
}

/**
 * Whether the referral route `/r/<code>` lands on the page a link names with `to=`. Until it does it lands on Rewards,
 * so the link a creator shares is the token's page itself and the creator's code waits for it; the launch test reads
 * the route and fails the day it follows `to`, so this is flipped then and not later.
 */
export const REFERRAL_ROUTE_FOLLOWS_TO = true;

/**
 * The link a creator shares (SOL-L1e): the token's short address — `/t/<8>/<code>` with their referral code once the
 * referral route lands on the page it names, `/t/<8>` otherwise. It answers a link preview with the token's card and
 * sends a person on to the token (`lib/launch/share-link.ts`).
 */
export function launchShareLink(origin: string, record: Pick<LaunchRecord, "token" | "referralCode">, followsTo: boolean = REFERRAL_ROUTE_FOLLOWS_TO): string {
  return `${origin}${launchShortPath(record.token, followsTo ? record.referralCode : null)}`;
}
