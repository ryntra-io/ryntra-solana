/**
 * The launch receipt — what the chain says a Ryntra launch is, at the moment
 * it is read: the token's authorities and extensions, the curve, and after
 * graduation the DAMM v2 pool and who holds its locked liquidity.
 *
 * Every «Чесний лаунч» mark is a fact with the account or transaction where
 * anyone can see it — never a word like «безпечно»:
 * «Право випуску відкликано» names the mint, «LP замкнено назавжди» names the
 * position. A mark is drawn only when its fact holds; a fact that does not
 * hold is a problem of the receipt, not a missing mark.
 *
 * Pure: the observation is read by the venue (`./launch.server.ts`) and handed
 * in; nothing here reaches the network.
 */

import { z } from "zod";

import type { CreatorLockObservation } from "./creator-lock.server.ts";
import type { CreationObservation, LaunchObservation } from "./launch.server.ts";
import { LAUNCH_PRESET_IDS, creatorFirstBuyCapRaw, launchPreset, type LaunchPreset } from "./presets.ts";
import { CURVE_HOOK_PHASES, CURVE_RULES_PRESET_ID, CURVE_RULES_SCOPE, CURVE_RULES_UPGRADE, CURVE_RULE_IDS, curveHookTimeline, mintCurveRulesProblems, type CurveRuleSet } from "../../launch/curve-rules.ts";
import { TRANSFER_FEE_PHASES, mintTransferFeeProblems, transferFeeTimeline } from "../../launch/transfer-fee.ts";

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MET_LOCK_PROGRAM = "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn";

export const LAUNCH_RECEIPT_FACTS_SOURCE = "ryntra.solana.launch-receipt.facts@1";

const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const Raw = z.string().regex(/^[0-9]+$/);

/** The extensions a preset's mint may carry: its metadata, in the mint itself. */
export const ALLOWED_MINT_EXTENSIONS = ["MetadataPointer", "TokenMetadata"] as const;
/** «Комісія за переказ» (SOL-L10): the one more extension a «Розширений» mint may carry — when its config says so. */
export const TRANSFER_FEE_MINT_EXTENSION = "TransferFeeConfig";
/** «Правила на кривій» (SOL-L8): the extension a `rules` mint carries until the DEX — the rules' own hook, nothing else. */
export const CURVE_RULES_MINT_EXTENSION = "TransferHook";

export const LAUNCH_MARK_CODES = [
  /** No one can mint more: the mint authority is gone. */
  "MINT_REVOKED",
  /** No one can freeze a holder's tokens. */
  "NO_FREEZE",
  /** The name, ticker and picture cannot be changed. */
  "METADATA_FIXED",
  /** No rule runs on a transfer. */
  "NO_TRANSFER_HOOK",
  /**
   * «Комісія за переказ» (SOL-L10), in place of «No rule on transfers»: a transfer pays the launch's rate until the DEX;
   * the move to the DEX sets 0 % two epochs on and leaves no one able to set a rate (RevokeZeroFee).
   */
  "TRANSFER_FEE_UNTIL_DEX",
  /**
   * «Правила на кривій» (SOL-L8), in place of «No rule on transfers» too: Ryntra's verified rules run on a purchase on
   * the curve through the audited program, and the move to the DEX takes the hook off the mint for ever.
   */
  "CURVE_RULES_UNTIL_DEX",
  /** Buyers' money is held by the curve's program, not by the creator. */
  "CURVE_HOLDS_FUNDS",
  /** After graduation: an exit position — the partner's or the creator's share the move to the DEX opened — is locked for ever. */
  "LP_LOCKED_FOREVER",
  /** The creator put the tokens of their first purchase under a lock no one can cancel. */
  "CREATOR_BUY_LOCKED",
] as const;
export type LaunchMarkCode = (typeof LAUNCH_MARK_CODES)[number];

const MarkSchema = z.object({ code: z.enum(LAUNCH_MARK_CODES), account: Address }).strict();

export const LaunchReceiptFactsSchema = z
  .object({
    source: z.literal(LAUNCH_RECEIPT_FACTS_SOURCE),
    network: z.literal("solana"),
    cluster: z.enum(["mainnet", "devnet"]),
    preset: z.enum(LAUNCH_PRESET_IDS),
    config: Address,
    token: Address,
    pool: Address,
    creator: Address,
    created: z.object({ signature: Signature, slot: z.number().int().nonnegative(), at: z.string().datetime({ offset: true }).nullable() }).strict(),
    creatorFirstBuy: z.object({ quoteInRaw: Raw, tokensOutRaw: Raw, capRaw: Raw }).strict().nullable(),
    /** The creator's lock of that purchase, when the chain shows one that holds it; absent or null, none. */
    creatorLock: z.object({ escrow: Address, lockedRaw: Raw, cliffAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }) }).strict().nullable().optional(),
    /**
     * «Спільнота» sharing the creator's fees: the vault holding the curve's creator role and the shares written in it
     * for ever (basis points of the creator's fees); absent or null when the creator's wallet holds the role.
     */
    feeSharing: z
      .object({ vault: Address, shares: z.array(z.object({ address: Address, bps: z.number().int().min(1).max(10_000) }).strict()).min(2).max(5) })
      .strict()
      .nullable()
      .optional(),
    token2022: z
      .object({
        supplyRaw: Raw,
        decimals: z.number().int(),
        mintAuthority: z.null(),
        freezeAuthority: z.null(),
        /** «Правила на кривій» (SOL-L8): the audited rule program while the token is on its curve; null on every other launch and after the DEX. */
        transferHookProgram: Address.nullable(),
        metadataUpdateAuthority: z.null(),
        metadataPointerAuthority: z.null(),
        extensions: z.array(z.enum([...ALLOWED_MINT_EXTENSIONS, TRANSFER_FEE_MINT_EXTENSION, CURVE_RULES_MINT_EXTENSION])),
      })
      .strict(),
    /**
     * «Комісія за переказ» (SOL-L10): the rate on the curve, the creator who withdraws what is withheld, and where the
     * RevokeZeroFee timeline stood at the read; absent or null — the token takes no fee on transfers.
     */
    transferFee: z
      .object({
        bps: z.number().int().min(1).max(10_000),
        mode: z.literal("REVOKE_ZERO_FEE"),
        withdrawAuthority: Address,
        phase: z.enum(TRANSFER_FEE_PHASES).exclude(["OUTSIDE_RULE"]),
        bpsNow: z.number().int().min(0).max(10_000),
        zeroFromEpoch: Raw.nullable(),
        epoch: Raw,
      })
      .strict()
      .nullable()
      .optional(),
    /**
     * «Правила на кривій» (SOL-L8); absent or null — the token runs no rule on a transfer.
     *
     * `program` and `phase` are read from the chain: the mint's own transfer hook and where the UNTIL_DEX timeline
     * stood at the read. `rules`, `upgrade`, `upgradeAuthority` and `audit` are the launch's own record — the set its
     * config was made with and the deployment's named governance of that program; `program` is the account where
     * anyone checks the governance for themselves.
     */
    curveRules: z
      .object({
        program: Address,
        scope: z.literal(CURVE_RULES_SCOPE),
        phase: z.enum(CURVE_HOOK_PHASES).exclude(["OUTSIDE_RULE"]),
        rules: z.array(z.enum(CURVE_RULE_IDS)).min(1),
        upgrade: z.enum(CURVE_RULES_UPGRADE),
        upgradeAuthority: Address.nullable(),
        audit: z.string().min(1).max(300),
      })
      .strict()
      .nullable()
      .optional(),
    curve: z
      .object({ quoteReserveRaw: Raw, migrationQuoteThresholdRaw: Raw, progressBps: z.number().int().min(0).max(10_000), migrated: z.boolean() })
      .strict(),
    graduated: z
      .object({
        pool: Address,
        compounding: z.literal(true),
        compoundingFeeBps: z.number().int().min(1).max(10_000),
        feeFallsWithMarketCap: z.literal(true),
        positions: z.array(z.object({ position: Address, owner: Address, permanentLockedLiquidity: Raw }).strict()).min(1),
      })
      .strict()
      .nullable(),
    marks: z.array(MarkSchema).min(1),
    observedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type LaunchReceiptFacts = z.infer<typeof LaunchReceiptFactsSchema>;

/** cp-amm's numbers for the graduated pool: compounding collect mode, the market-cap schedulers. */
const DAMM_V2_COMPOUNDING = 2;
const DAMM_V2_MARKET_CAP_MODES = [3, 4];

/** The supply the launch's config was made for, raw; null where it was not read. */
function configSupplyOf(observation: Pick<LaunchObservation, "configSupplyRaw">): bigint | null {
  const raw = observation.configSupplyRaw;
  return raw && /^\d+$/.test(raw) && BigInt(raw) > 0n ? BigInt(raw) : null;
}

/**
 * The creator's first-purchase cap, raw. A preset's own, from its template, as it always was; «Розширений»'s from its
 * config's supply and the cap its launch's own terms set (`advanced.firstBuyCapBps` of the record), never above the
 * template's.
 */
function firstBuyCapOf(preset: LaunchPreset, observation: Pick<LaunchObservation, "configSupplyRaw">, advancedCapBps?: number | null): bigint {
  if (preset.id !== "advanced") return creatorFirstBuyCapRaw(preset);
  const own = typeof advancedCapBps === "number" && Number.isInteger(advancedCapBps) && advancedCapBps > 0 && advancedCapBps <= preset.creatorFirstBuyCapBps;
  return creatorFirstBuyCapRaw({ ...preset, creatorFirstBuyCapBps: own ? advancedCapBps : preset.creatorFirstBuyCapBps }, configSupplyOf(observation) ?? undefined);
}

/** Why an observation cannot be a Ryntra launch receipt, each in a plain line. */
export function launchObservationProblems(observation: LaunchObservation): readonly string[] {
  const problems: string[] = [];
  const preset = observation.preset ? launchPreset(observation.preset) : null;
  if (!preset) problems.push("the curve sits on a config that is not one of Ryntra's presets");
  for (const line of observation.configProblems) problems.push(`its config: ${line}`);
  const mint = observation.mint;
  if (mint.program !== TOKEN_2022_PROGRAM) problems.push("the token is not a Token-2022 mint");
  if (mint.mintAuthority !== null) problems.push("the mint authority is not revoked");
  if (mint.freezeAuthority !== null) problems.push("a freeze authority exists");
  /*
   * «Правила на кривій» (SOL-L8): a hook only where the `rules` config fixes Ryntra's audited program, and then only
   * the one the config names, held by the curve's own authority and gone from the mint after the DEX. Everywhere else
   * a hook on the mint is what it always was — a refusal.
   */
  const rulesConfigured = observation.preset === CURVE_RULES_PRESET_ID && (observation.configRuleProgram ?? null) !== null;
  const rules = curveRulesArgs(observation);
  if (rulesConfigured && !rules) problems.push("the config fixes rules on the curve the mint's transfer hook was not read for");
  else if (rules) for (const line of mintCurveRulesProblems(rules.mint, rules.args)) problems.push(line);
  else if (mint.transferHookProgram !== null) problems.push("the mint has a transfer hook");
  if (observation.preset === CURVE_RULES_PRESET_ID && !rulesConfigured) problems.push("«Правила на кривій» on a config that fixes no rule program");
  if (observation.preset !== CURVE_RULES_PRESET_ID && (observation.configRuleProgram ?? null) !== null) problems.push("a config outside «Правила на кривій» fixes a transfer-hook program");
  /* A metadata read that failed is not read — `buildLaunchReceiptFacts` says so —, never a rule the chain shows broken. */
  if (mint.metadataRead === "MISSING") problems.push("the mint carries no metadata");
  if (mint.metadataRead === "INVALID") problems.push("the mint's metadata is not the token metadata layout");
  if (mint.metadataUpdateAuthority !== null) problems.push("the metadata can be updated");
  if (mint.metadataPointerAuthority !== null) problems.push("the metadata pointer can be moved");
  if (mint.metadataPointerAddress !== observation.token) problems.push("the metadata pointer points away from the mint");
  /* A transfer fee only where a «Розширений» config set it under Ryntra's rule and the mint carries it as read. */
  const feeConfigured = observation.preset === "advanced" && (observation.configTransferFee?.flag ?? 0) !== 0;
  for (const extension of mint.extensions) {
    if (extension === TRANSFER_FEE_MINT_EXTENSION && feeConfigured && observation.transferFee) continue;
    if (extension === CURVE_RULES_MINT_EXTENSION && rulesConfigured) continue;
    if (!(ALLOWED_MINT_EXTENSIONS as readonly string[]).includes(extension)) problems.push(`the mint carries the extension ${extension}`);
  }
  if (feeConfigured && !mint.extensions.includes(TRANSFER_FEE_MINT_EXTENSION)) problems.push("the config sets a transfer fee the mint does not carry");
  /* The extension stays on the mint after the DEX with no program in it; before the DEX its absence means the rules never ran. */
  if (rulesConfigured && !observation.curve.migrated && !mint.extensions.includes(CURVE_RULES_MINT_EXTENSION)) problems.push("the config fixes rules on the curve the mint does not carry");
  if (observation.preset !== "advanced" && (observation.configTransferFee?.flag ?? 0) !== 0) problems.push("a preset's config sets a transfer fee");
  if (preset) {
    /* «Розширений»: the supply is the creator's choice — its config's, read from the chain; a preset's is its own. */
    const configSupply = preset.id === "advanced" ? configSupplyOf(observation) : null;
    if (preset.id === "advanced" && configSupply === null) problems.push("the config's supply was not read");
    const supplyRaw = configSupply ?? BigInt(preset.token.supply) * 10n ** BigInt(preset.token.decimals);
    if (mint.decimals !== preset.token.decimals) problems.push(`the mint has ${mint.decimals} decimals, the preset ${preset.token.decimals}`);
    /*
     * With the mint authority gone nobody can add a token, but anyone may burn their own — $STAIR's supply fell by
     * 341 242 tokens on 11.10 that way. So the rule is «never more than the preset's», not «exactly».
     */
    if (BigInt(mint.supplyRaw) > supplyRaw) problems.push(`the supply is ${mint.supplyRaw}, above the preset's ${supplyRaw}`);
  }
  const graduated = observation.graduated;
  if (observation.curve.migrated && graduated === null) problems.push("the curve graduated but its pool was not found");
  if (graduated) {
    if (graduated.collectFeeMode !== DAMM_V2_COMPOUNDING || graduated.compoundingFeeBps <= 0) problems.push("the graduated pool does not compound");
    if (!DAMM_V2_MARKET_CAP_MODES.includes(graduated.baseFeeMode)) problems.push("the graduated pool's fee does not fall with market cap");
    /*
     * The positions here are the exit — the ones the move to the DEX opened —, never a holder's entry into the pool,
     * the creator's own through «Заробляй у пулі» included. What the exit locked stays locked whatever its owner adds
     * to the same position later: the mark names the locked part, and an exit position that locked nothing breaks it.
     */
    if (graduated.positions.length === 0 && !graduated.exitUnread) problems.push("the move to the DEX opened no position");
    for (const position of graduated.positions) {
      if (position.permanentLockedLiquidity === "0") problems.push(`exit position ${position.position} holds no locked liquidity`);
      if (!position.owner) problems.push(`exit position ${position.position} has no owner on chain`);
    }
  }
  return problems;
}

/** How a receipt refused by the chain's facts begins: «правила відмовили», not «не прочитано». */
export const RECEIPT_REFUSED = "Not a Ryntra launch";

/** Said beside a receipt read whole but for the exit positions: the pool's marks are then not drawn — the mint's are. */
export const RECEIPT_EXIT_UNREAD = "The exit positions in the DEX pool could not be read now.";

/** Said beside a receipt read whole but for the creator's lock: its mark is then not drawn, and the page says it was not read. */
export const RECEIPT_LOCK_UNREAD = "The creator's lock could not be read now.";

/** Whether a launch's receipt problems say the rules refused it — a fact of the chain — rather than that the chain was not read. */
export function receiptRefusedByRules(problems: readonly string[]): boolean {
  return problems.some((problem) => problem.startsWith(RECEIPT_REFUSED));
}

/**
 * Why a lock is not the creator's lock of their first purchase, each in a
 * plain line; an empty list means it is: Met Lock's escrow of this token, made
 * by and for the creator, holding at least the purchase, that nobody can
 * cancel or redirect and that was not cancelled.
 */
export function creatorLockProblems(observation: Pick<LaunchObservation, "token">, creation: Pick<CreationObservation, "creatorTokensOutRaw" | "creator">, lock: CreatorLockObservation, nowSeconds: number): readonly string[] {
  const problems: string[] = [];
  const bought = BigInt(creation.creatorTokensOutRaw);
  if (lock.program !== MET_LOCK_PROGRAM) problems.push("the escrow is not Met Lock's");
  if (lock.mint !== observation.token) problems.push("the escrow locks another token");
  /* The creator is the wallet the creation names: with shared fees the curve's creator role is the vault's, the tokens the wallet's. */
  if (lock.creator !== creation.creator || lock.recipient !== creation.creator) problems.push("the escrow is not the creator's own");
  if (lock.cancelMode !== 0 || lock.updateRecipientMode !== 0) problems.push("the escrow can be cancelled or redirected");
  if (lock.cancelledAt !== 0) problems.push("the escrow was cancelled");
  if (bought <= 0n) problems.push("the creator made no first purchase");
  if (BigInt(lock.totalRaw) < bought) problems.push("the escrow locks less than the first purchase");
  if (BigInt(lock.heldRaw) < BigInt(lock.totalRaw) - BigInt(lock.claimedRaw)) problems.push("the escrow does not hold what it owes");
  /* A lock that has run its course locks nothing: the mark is a fact of now, not of the launch day. */
  if (nowSeconds >= lock.endsAt || BigInt(lock.claimedRaw) >= BigInt(lock.totalRaw)) problems.push("the lock has ended");
  return problems;
}

/** Why a creation transaction is not a Ryntra launch's: Ryntra's pool payer paid and signed it, and the creator's purchase in it is under the cap. */
export function launchCreationProblems(
  observation: LaunchObservation,
  creation: CreationObservation,
  ryntraPoolPayer: string,
  /** «Розширений»: the first-purchase cap its launch's own terms set, from the launch's record. */
  advancedCapBps?: number | null,
): readonly string[] {
  const problems: string[] = [];
  if (creation.failed) problems.push("the creation transaction failed");
  /* The transaction must be this token's own creation: the curve's initialization in it names this mint, curve and config, and the new mint signed it. */
  const init = creation.initialized;
  if (!init) problems.push("the transaction initializes no curve");
  else if (init.baseMint !== observation.token || init.pool !== observation.pool || init.config !== observation.config || !creation.signers.includes(observation.token)) {
    problems.push("the transaction created another token");
  }
  if (creation.feePayer !== ryntraPoolPayer || !creation.signers.includes(ryntraPoolPayer) || (init !== null && init.payer !== ryntraPoolPayer)) {
    problems.push("not launched through Ryntra: Ryntra's pool payer did not pay for the creation");
  }
  if (creation.creator !== observation.creator && !sharedByCreator(observation, creation.creator)) problems.push("the creation names another creator");
  const preset = observation.preset ? launchPreset(observation.preset) : null;
  if (preset && BigInt(creation.creatorTokensOutRaw) > firstBuyCapOf(preset, observation, advancedCapBps)) problems.push("the creator's first purchase is above the preset's cap");
  /* «Комісія за переказ»: what is withheld is the creator's who launched, and the mint follows the config's RevokeZeroFee. */
  const fee = transferFeeArgs(observation, creation.creator);
  if (fee) for (const line of mintTransferFeeProblems(fee.mint, fee.args)) problems.push(line);
  return problems;
}

/**
 * A rules launch's mint hook and what it is judged by; null — the config fixes no rule program or the mint's hook was
 * not read.
 */
function curveRulesArgs(observation: LaunchObservation) {
  const program = observation.configRuleProgram ?? null;
  const read = observation.transferHook ?? null;
  if (!program || !read) return null;
  return { mint: read.mint, args: { program, migrated: observation.curve.migrated, poolAuthority: read.poolAuthority } };
}

/** A transfer-fee launch's mint and what it is judged by; null — no transfer fee on both sides. */
function transferFeeArgs(observation: LaunchObservation, creator: string) {
  const configured = observation.configTransferFee;
  const read = observation.transferFee;
  if (!configured || configured.flag === 0 || !read) return null;
  return { mint: read.mint, args: { curveBps: configured.bps, creator, epoch: BigInt(read.epoch), migrated: observation.curve.migrated, poolAuthority: read.poolAuthority } };
}

/**
 * The curve's creator role held by the vault found from this token's own mint, made by the creator and sharing with
 * them: «Спільнота» sharing the creator's fees — not another creator.
 */
function sharedByCreator(observation: Pick<LaunchObservation, "token" | "creator" | "feeSharing" | "preset">, creator: string): boolean {
  const sharing = observation.feeSharing ?? null;
  return (
    observation.preset === "community" &&
    sharing !== null &&
    sharing.vault === observation.creator &&
    sharing.base === observation.token &&
    sharing.owner === creator &&
    sharing.users.some((user) => user.address === creator)
  );
}

export type BuildLaunchReceiptInput = Readonly<{
  cluster: "mainnet" | "devnet";
  observation: LaunchObservation;
  /** The creation transaction, read from the chain by the venue. */
  creation: CreationObservation;
  /** Ryntra's pool payer on this network — the signature that makes a launch Ryntra's. */
  ryntraPoolPayer: string;
  /** The creator's lock the launch recorded, read from the chain; a lock that does not hold draws no mark. */
  creatorLock?: CreatorLockObservation | null;
  /** Where Ryntra serves launch metadata (`<origin>/api/launch/metadata/`): a mint whose URI points elsewhere could show anything, so its metadata is not «fixed». */
  metadataUriPrefix?: string;
  /** «Розширений»: the first-purchase cap its launch's own terms set (`advanced.firstBuyCapBps` of the record). */
  advancedFirstBuyCapBps?: number | null;
  /**
   * «Правила на кривій» (SOL-L8): the set its launch's record keeps — the rules its config was made with and the
   * governance of the audited program. Absent on every other launch; a set that is not this launch's program draws no
   * rules on the receipt.
   */
  curveRuleSet?: CurveRuleSet | null;
  observedAt: string;
}>;

/** The receipt's facts, or a refusal naming every rule the chain shows broken. */
export function buildLaunchReceiptFacts(input: BuildLaunchReceiptInput): LaunchReceiptFacts {
  const { observation, creation } = input;
  const problems = [...launchObservationProblems(observation), ...launchCreationProblems(observation, creation, input.ryntraPoolPayer, input.advancedFirstBuyCapBps)];
  if (input.metadataUriPrefix !== undefined && observation.mint.metadataRead === "OK") {
    const uri = observation.mint.uri ?? "";
    if (!uri.startsWith(input.metadataUriPrefix) || !/^[0-9a-f]{64}$/.test(uri.slice(input.metadataUriPrefix.length))) problems.push("the metadata lives outside Ryntra's content-addressed store");
  }
  if (problems.length) throw new Error(`${RECEIPT_REFUSED}: ${problems.join("; ")}.`);
  /* Every rule holds by what was read, and the metadata was not read: the receipt is not read now — never refused for it. */
  if (observation.mint.metadataRead === "FAILED") throw new Error("The chain could not be read: the token's metadata.");
  const preset = launchPreset(observation.preset ?? "");
  if (!preset) throw new Error("Not a Ryntra launch: no preset.");
  const bought = BigInt(creation.creatorTokensOutRaw) > 0n;
  const fee = transferFeeArgs(observation, creation.creator);
  const timeline = fee ? transferFeeTimeline(fee.mint, fee.args) : null;
  const ruleArgs = curveRulesArgs(observation);
  const ruleTimeline = ruleArgs ? curveHookTimeline(ruleArgs.mint, ruleArgs.args) : null;
  /* The rules a launch carries are its record's set, and only for the very program its own config fixes. */
  const ruleSet = input.curveRuleSet && ruleArgs && input.curveRuleSet.program.program === ruleArgs.args.program ? input.curveRuleSet : null;
  const marks: { code: LaunchMarkCode; account: string }[] = [
    { code: "MINT_REVOKED", account: observation.token },
    { code: "NO_FREEZE", account: observation.token },
    { code: "METADATA_FIXED", account: observation.token },
    /*
     * «Без правил на переказах» only where it is true: a transfer-fee token says its rate instead (SOL-L10), a token
     * with rules on its curve says its rules (SOL-L8), and a token with both says both — never «no rule on transfers».
     */
    ...(ruleTimeline && ruleTimeline.phase !== "OUTSIDE_RULE" ? [{ code: "CURVE_RULES_UNTIL_DEX" as const, account: observation.token }] : []),
    ...(fee ? [{ code: "TRANSFER_FEE_UNTIL_DEX" as const, account: observation.token }] : []),
    ...(!fee && !(ruleTimeline && ruleTimeline.phase !== "OUTSIDE_RULE") ? [{ code: "NO_TRANSFER_HOOK" as const, account: observation.token }] : []),
  ];
  /* While the token is on its curve the buyers' money is in the curve's vault, which the mark names; after graduation it is in the pool, whose locked liquidity the next marks name. */
  if (!observation.curve.migrated) marks.push({ code: "CURVE_HOLDS_FUNDS", account: observation.curve.quoteVault ?? observation.pool });
  /* An exit not read now draws no pool mark and no pool: the receipt stands on what was read, the view says the rest. */
  const graduated = observation.graduated && !observation.graduated.exitUnread ? observation.graduated : null;
  if (graduated) for (const position of graduated.positions) marks.push({ code: "LP_LOCKED_FOREVER", account: position.position });
  const lock = input.creatorLock && creatorLockProblems(observation, creation, input.creatorLock, Math.floor(Date.parse(input.observedAt) / 1000)).length === 0 ? input.creatorLock : null;
  if (lock) marks.push({ code: "CREATOR_BUY_LOCKED", account: lock.escrow });
  return LaunchReceiptFactsSchema.parse({
    source: LAUNCH_RECEIPT_FACTS_SOURCE,
    network: "solana",
    cluster: input.cluster,
    preset: preset.id,
    config: observation.config,
    token: observation.token,
    pool: observation.pool,
    creator: creation.creator,
    created: {
      signature: creation.signature,
      slot: creation.slot,
      at: creation.blockTime === null ? null : new Date(creation.blockTime * 1000).toISOString(),
    },
    creatorFirstBuy: bought ? { quoteInRaw: creation.creatorQuoteInRaw, tokensOutRaw: creation.creatorTokensOutRaw, capRaw: firstBuyCapOf(preset, observation, input.advancedFirstBuyCapBps).toString() } : null,
    creatorLock: lock ? { escrow: lock.escrow, lockedRaw: lock.totalRaw, cliffAt: new Date(lock.cliffAt * 1000).toISOString(), endsAt: new Date(lock.endsAt * 1000).toISOString() } : null,
    feeSharing: observation.feeSharing && sharedByCreator(observation, creation.creator)
      ? { vault: observation.feeSharing.vault, shares: observation.feeSharing.users.map((user) => ({ address: user.address, bps: Math.round((user.share * 10_000) / observation.feeSharing!.totalShare) })) }
      : null,
    token2022: {
      supplyRaw: observation.mint.supplyRaw,
      decimals: observation.mint.decimals,
      mintAuthority: null,
      freezeAuthority: null,
      transferHookProgram: ruleTimeline && ruleTimeline.phase !== "OUTSIDE_RULE" ? ruleTimeline.programNow : null,
      metadataUpdateAuthority: null,
      metadataPointerAuthority: null,
      extensions: observation.mint.extensions,
    },
    ...(ruleTimeline && ruleTimeline.phase !== "OUTSIDE_RULE" && ruleSet
      ? {
          curveRules: {
            program: ruleArgs!.args.program,
            scope: CURVE_RULES_SCOPE,
            phase: ruleTimeline.phase,
            rules: ruleSet.rules.map((rule) => rule.id),
            upgrade: ruleSet.program.upgrade,
            upgradeAuthority: ruleSet.program.upgradeAuthority,
            audit: ruleSet.program.audit,
          },
        }
      : {}),
    ...(fee && timeline && timeline.phase !== "OUTSIDE_RULE"
      ? {
          transferFee: {
            bps: fee.args.curveBps,
            mode: "REVOKE_ZERO_FEE" as const,
            withdrawAuthority: fee.mint.withdrawAuthority!,
            phase: timeline.phase,
            bpsNow: timeline.bpsNow,
            zeroFromEpoch: timeline.zeroFromEpoch,
            epoch: fee.args.epoch.toString(),
          },
        }
      : {}),
    curve: {
      quoteReserveRaw: observation.curve.quoteReserveRaw,
      migrationQuoteThresholdRaw: observation.curve.migrationQuoteThresholdRaw,
      progressBps: observation.curve.progressBps,
      migrated: observation.curve.migrated,
    },
    graduated: graduated
      ? {
          pool: graduated.pool,
          compounding: true,
          compoundingFeeBps: graduated.compoundingFeeBps,
          feeFallsWithMarketCap: true,
          positions: graduated.positions.map((position) => ({ position: position.position, owner: position.owner, permanentLockedLiquidity: position.permanentLockedLiquidity })),
        }
      : null,
    marks,
    observedAt: input.observedAt,
  });
}
