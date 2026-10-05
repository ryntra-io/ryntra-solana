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

import type { CreationObservation, LaunchObservation } from "./launch.server.ts";
import { LAUNCH_PRESET_IDS, creatorFirstBuyCapRaw, launchPreset } from "./presets.ts";

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const LAUNCH_RECEIPT_FACTS_SOURCE = "ryntra.solana.launch-receipt.facts@1";

const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const Raw = z.string().regex(/^[0-9]+$/);

/** The extensions a preset's mint may carry: its metadata, in the mint itself. */
export const ALLOWED_MINT_EXTENSIONS = ["MetadataPointer", "TokenMetadata"] as const;

export const LAUNCH_MARK_CODES = [
  /** No one can mint more: the mint authority is gone. */
  "MINT_REVOKED",
  /** No one can freeze a holder's tokens. */
  "NO_FREEZE",
  /** The name, ticker and picture cannot be changed. */
  "METADATA_FIXED",
  /** No rule runs on a transfer. */
  "NO_TRANSFER_HOOK",
  /** Buyers' money is held by the curve's program, not by the creator. */
  "CURVE_HOLDS_FUNDS",
  /** After graduation: every share of the pool's liquidity is locked for ever. */
  "LP_LOCKED_FOREVER",
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
    token2022: z
      .object({
        supplyRaw: Raw,
        decimals: z.number().int(),
        mintAuthority: z.null(),
        freezeAuthority: z.null(),
        transferHookProgram: z.null(),
        metadataUpdateAuthority: z.null(),
        metadataPointerAuthority: z.null(),
        extensions: z.array(z.enum(ALLOWED_MINT_EXTENSIONS)),
      })
      .strict(),
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
  if (mint.transferHookProgram !== null) problems.push("the mint has a transfer hook");
  if (mint.metadataRead !== "OK") problems.push(mint.metadataRead === "FAILED" ? "the metadata could not be read" : "the mint carries no metadata");
  if (mint.metadataUpdateAuthority !== null) problems.push("the metadata can be updated");
  if (mint.metadataPointerAuthority !== null) problems.push("the metadata pointer can be moved");
  if (mint.metadataPointerAddress !== observation.token) problems.push("the metadata pointer points away from the mint");
  for (const extension of mint.extensions) {
    if (!(ALLOWED_MINT_EXTENSIONS as readonly string[]).includes(extension)) problems.push(`the mint carries the extension ${extension}`);
  }
  if (preset) {
    const supplyRaw = BigInt(preset.token.supply) * 10n ** BigInt(preset.token.decimals);
    if (mint.decimals !== preset.token.decimals) problems.push(`the mint has ${mint.decimals} decimals, the preset ${preset.token.decimals}`);
    if (BigInt(mint.supplyRaw) !== supplyRaw) problems.push(`the supply is ${mint.supplyRaw}, the preset's ${supplyRaw}`);
  }
  const graduated = observation.graduated;
  if (observation.curve.migrated && graduated === null) problems.push("the curve graduated but its pool was not found");
  if (graduated) {
    if (graduated.collectFeeMode !== DAMM_V2_COMPOUNDING || graduated.compoundingFeeBps <= 0) problems.push("the graduated pool does not compound");
    if (!DAMM_V2_MARKET_CAP_MODES.includes(graduated.baseFeeMode)) problems.push("the graduated pool's fee does not fall with market cap");
    if (graduated.positions.length === 0) problems.push("the graduated pool has no positions");
    for (const position of graduated.positions) {
      if (position.unlockedLiquidity !== "0" || position.vestedLiquidity !== "0") problems.push(`position ${position.position} holds liquidity that is not locked for ever`);
      if (position.permanentLockedLiquidity === "0") problems.push(`position ${position.position} holds no locked liquidity`);
      if (!position.owner) problems.push(`position ${position.position} has no owner on chain`);
    }
  }
  return problems;
}

/** Why a creation transaction is not a Ryntra launch's: Ryntra's pool payer paid and signed it, and the creator's purchase in it is under the cap. */
export function launchCreationProblems(observation: LaunchObservation, creation: CreationObservation, ryntraPoolPayer: string): readonly string[] {
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
  if (creation.creator !== observation.creator) problems.push("the creation names another creator");
  const preset = observation.preset ? launchPreset(observation.preset) : null;
  if (preset && BigInt(creation.creatorTokensOutRaw) > creatorFirstBuyCapRaw(preset)) problems.push("the creator's first purchase is above the preset's cap");
  return problems;
}

export type BuildLaunchReceiptInput = Readonly<{
  cluster: "mainnet" | "devnet";
  observation: LaunchObservation;
  /** The creation transaction, read from the chain by the venue. */
  creation: CreationObservation;
  /** Ryntra's pool payer on this network — the signature that makes a launch Ryntra's. */
  ryntraPoolPayer: string;
  observedAt: string;
}>;

/** The receipt's facts, or a refusal naming every rule the chain shows broken. */
export function buildLaunchReceiptFacts(input: BuildLaunchReceiptInput): LaunchReceiptFacts {
  const { observation, creation } = input;
  const problems = [...launchObservationProblems(observation), ...launchCreationProblems(observation, creation, input.ryntraPoolPayer)];
  if (problems.length) throw new Error(`Not a Ryntra launch: ${problems.join("; ")}.`);
  const preset = launchPreset(observation.preset ?? "");
  if (!preset) throw new Error("Not a Ryntra launch: no preset.");
  const bought = BigInt(creation.creatorTokensOutRaw) > 0n;
  const marks: { code: LaunchMarkCode; account: string }[] = [
    { code: "MINT_REVOKED", account: observation.token },
    { code: "NO_FREEZE", account: observation.token },
    { code: "METADATA_FIXED", account: observation.token },
    { code: "NO_TRANSFER_HOOK", account: observation.token },
    { code: "CURVE_HOLDS_FUNDS", account: observation.pool },
  ];
  const graduated = observation.graduated;
  if (graduated) for (const position of graduated.positions) marks.push({ code: "LP_LOCKED_FOREVER", account: position.position });
  return LaunchReceiptFactsSchema.parse({
    source: LAUNCH_RECEIPT_FACTS_SOURCE,
    network: "solana",
    cluster: input.cluster,
    preset: preset.id,
    config: observation.config,
    token: observation.token,
    pool: observation.pool,
    creator: observation.creator,
    created: {
      signature: creation.signature,
      slot: creation.slot,
      at: creation.blockTime === null ? null : new Date(creation.blockTime * 1000).toISOString(),
    },
    creatorFirstBuy: bought ? { quoteInRaw: creation.creatorQuoteInRaw, tokensOutRaw: creation.creatorTokensOutRaw, capRaw: creatorFirstBuyCapRaw(preset).toString() } : null,
    token2022: {
      supplyRaw: observation.mint.supplyRaw,
      decimals: observation.mint.decimals,
      mintAuthority: null,
      freezeAuthority: null,
      transferHookProgram: null,
      metadataUpdateAuthority: null,
      metadataPointerAuthority: null,
      extensions: observation.mint.extensions,
    },
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
