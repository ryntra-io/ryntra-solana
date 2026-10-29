/**
 * «Розширений лаунч» on the server (SOL-L5): the config of one launch, made from the creator's choice.
 *
 * A DBC config cannot be changed once made, and every token on it carries its numbers for ever; «Розширений» makes one
 * for each launch. It is the creator's own transaction, signed before the launch's: the creator pays its rent, a fresh
 * key of Ryntra's — sealed until the creator has signed, like a launch's mint — is its address, and its fee claimer and
 * leftover receiver are Ryntra's partner vault, as on Класичний and Захищений. Its numbers are the choice's, checked
 * against the operator's bounds here before anything is built; the rules of «Чесний лаунч» are checked again by the venue
 * on the very curve the SDK makes.
 *
 * Once the network has it, the config is kept as the creator's, unused: the launch's build names it, and one config
 * carries one launch. A config the creator made but never launched on is theirs and does nothing.
 *
 * Server-only.
 */

import { createHash, randomBytes } from "node:crypto";

import { getBase58Decoder } from "@solana/kit";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

import { advancedChoiceOf, advancedPreset, advancedProblems, advancedTermsOf, type AdvancedChoice, type AdvancedTerms } from "../core/launch/advanced.ts";
import { quoteAssetRefusalWords, quoteLaunchFigures, type QuoteLaunchFigures } from "../core/launch/quote-asset.ts";
import { LaunchRefusal, createMeteoraDbcLaunchVenue } from "../core/venues/meteora-dbc/launch.server.ts";
import { openCosigners, reviewedDigest, sealCosigners, ticketKeyConfigured, withoutSignaturesOf } from "../liquidity/studio/ticket.ts";
import { readBuildWindows, web3ChainReader } from "../solana/blockhash-life.ts";
import { launchPair } from "./config.server.ts";
import { CREATION_BUDGET, sendOnce, signedAsBuilt, type LaunchDeps, type LaunchFailure } from "./flow.server.ts";
import { quoteAssetFor } from "./quote-asset.server.ts";
import { quotePaused } from "./quote-watch.server.ts";

/** How long a config's build may wait for the creator's signature. */
const CONFIG_BUILD_TTL_MS = 2 * 60 * 1000;
const ROUTE_MS = 45_000;

export type AdvancedConfigBuild = Readonly<{
  id: string;
  cluster: string;
  creator: string;
  config: string;
  terms: AdvancedTerms;
  messageSha256: string;
  /** The instructions' digest: a wallet may add its own fee and guard instructions to a transaction its owner pays. */
  digest: string;
  /** The config's fresh key, sealed until the creator has signed. */
  cosign: string;
  validUntil: string;
  createdAt: string;
  expiresAt: string;
}>;

/** A config made for a creator's launch: CREATED once the network has it, USED once a launch on it was sent. */
export type AdvancedConfigRecord = Readonly<{
  cluster: string;
  config: string;
  creator: string;
  terms: AdvancedTerms;
  signature: string;
  state: "PENDING" | "CREATED" | "USED";
  /** The launch sent on it. */
  token: string | null;
  createdAt: string;
}>;

const BUILDS = "launchAdvancedBuilds";
const CONFIGS = "launchAdvancedConfigs";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (code: LaunchFailure["code"], message: string): LaunchFailure => ({ ok: false, code, message });
const configKey = (cluster: string, config: string) => `${cluster}:${config}`;

export type PreparedAdvancedConfig = Readonly<{
  ok: true;
  buildId: string;
  config: string;
  wireBase64: string;
  terms: AdvancedTerms;
  /** The creator's SOL the config takes: its rent and the fee of its signatures, as the network simulates them; null when not simulated. */
  creatorCostLamports: string | null;
  /**
   * A config on a checked pair currency (SOL-L11): the pair as any page says it — the mint, the symbol, the decimals —
   * the DBC version its fee made this config, and the figures of its curve in the pair's own units and in dollars.
   * Absent on the network's own pair.
   */
  quote?: Readonly<{ mint: string; symbol: string; decimals: number; configVersion: string; figures: QuoteLaunchFigures }>;
  expiresAt: string;
  signableMs: number;
}>;

export async function prepareAdvancedConfig(deps: LaunchDeps, input: Readonly<{ creator: string; choice: unknown }>): Promise<PreparedAdvancedConfig | LaunchFailure> {
  const advanced = deps.network.advanced;
  if (!advanced) return fail("PRESET_UNAVAILABLE", "«Розширений» is not offered on this network.");
  const choice = advancedChoiceOf(input.choice);
  if (!choice) return fail("ADVANCED_INVALID", "The choice is incomplete.");
  const problems = advancedProblems(choice, advanced.bounds);
  if (problems.length) return fail("ADVANCED_INVALID", `Outside the bounds: ${problems.join(", ")}.`);
  const env = deps.env ?? {};
  if (!ticketKeyConfigured(env)) return fail("BUILD_FAILED", "Launching is paused; nothing was built.");
  /*
   * The pair the curve runs in: the network's own, or — SOL-L11 — a mint of the checked register, read on chain now
   * (its badge, its program, its extensions, its fee, its authorities, its unit) with the price of this moment. A single
   * difference from what was checked closes the launch here, before any byte is built: the creator pays no rent for a
   * config no launch could follow, and a figure of a fee that moved is not a figure to sign on.
   */
  const asset = choice.quoteMint === undefined ? null : await quoteAssetFor({ cluster: deps.network.cluster, connection: deps.connection, env, now: deps.now, price: deps.quotePrice }, choice.quoteMint);
  if (choice.quoteMint !== undefined && !asset) return fail("ADVANCED_INVALID", "This pair currency is not one Ryntra checked on this network.");
  if (asset && (asset.state !== "OPEN" || asset.priceUsd === null)) {
    const why = quoteAssetRefusalWords(asset.problems) || "the pair currency could not be checked now";
    return fail("QUOTE_PAUSED", `A launch in this pair is closed: ${why}. Nothing was built.`);
  }
  const pair = asset ? { mint: asset.record.mint, decimals: asset.record.decimals, usdPrice: asset.priceUsd! } : launchPair(deps.network, "advanced");
  /* SOL-L12: a config on a pair whose issuer changed its mint would serve no launch: the creator pays no rent for it. */
  if (await quotePaused(deps.store, deps.network.cluster, pair.mint)) return fail("QUOTE_PAUSED", "The pair currency's issuer changed its token's rules; launches on it wait for Ryntra's check. Nothing was built.");
  const venue = createMeteoraDbcLaunchVenue({ connection: deps.connection, configs: deps.network.configs, advancedFeeClaimer: advanced.feeClaimer });
  const key = Keypair.generate();
  const terms = advancedTermsOf(choice, advanced.bounds);
  let built;
  try {
    built = await venue.buildConfig({
      preset: "advanced",
      custom: advancedPreset(choice, advanced.bounds),
      quote: pair,
      feeClaimer: advanced.feeClaimer,
      leftoverReceiver: advanced.feeClaimer,
      payer: input.creator,
      configKey: key,
    });
  } catch (error) {
    if (error instanceof LaunchRefusal) return fail("ADVANCED_INVALID", error.message);
    return fail("BUILD_FAILED", error instanceof Error ? error.message : "The config could not be built.");
  }
  const tx = Transaction.from(Buffer.from(built.wireBase64, "base64"));
  const creatorCostLamports = await creatorSpend(deps, tx, input.creator);
  const cosign = sealCosigners([{ index: 0, key }], env);
  if (!cosign) return fail("BUILD_FAILED", "Launching is paused; nothing was built.");
  const windows = await readBuildWindows(web3ChainReader(deps.connection), built.validUntil ?? "0", { capMs: CONFIG_BUILD_TTL_MS });
  const now = deps.now();
  const record: AdvancedConfigBuild = {
    id: randomBytes(16).toString("hex"),
    cluster: deps.network.cluster,
    creator: input.creator,
    config: built.config,
    terms,
    messageSha256: sha256(tx.serializeMessage()),
    digest: reviewedDigest(tx),
    cosign,
    validUntil: built.validUntil ?? "0",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + windows.lifeMs).toISOString(),
  };
  await deps.store.collection<AdvancedConfigBuild>(BUILDS).insertIfAbsent(`${record.cluster}:${record.id}`, record);
  return {
    ok: true,
    buildId: record.id,
    config: built.config,
    wireBase64: withoutSignaturesOf(built.wireBase64, [built.config]),
    terms,
    creatorCostLamports,
    ...(asset
      ? {
          quote: {
            mint: asset.record.mint,
            symbol: asset.record.symbol,
            decimals: asset.record.decimals,
            /* An open pair was read, so its version is known: the figures never carry a version nobody read. */
            configVersion: asset.configVersion!,
            /* The threshold of the very config just built, and what of it reaches the DEX after the move's fee and the fee the pair's mint withholds. */
            figures: quoteLaunchFigures({
              thresholdRaw: BigInt(built.migrationQuoteThresholdRaw),
              graduationFeePct: terms.graduationFee.pct,
              fee: asset.feeNow ? { bps: asset.feeNow.bps, maxRaw: asset.feeNow.maxRaw } : null,
              decimals: asset.record.decimals,
              multiplier: asset.record.multiplier,
              usdPrice: asset.priceUsd,
              priceAt: asset.priceAt,
            }),
          },
        }
      : {}),
    expiresAt: record.expiresAt,
    signableMs: windows.signableMs,
  };
}

/** What the creator's balance loses when the network simulates the config's bytes; null when it would not say. */
async function creatorSpend(deps: LaunchDeps, tx: Transaction, creator: string): Promise<string | null> {
  try {
    const before = BigInt(await deps.connection.getBalance(new PublicKey(creator), "confirmed"));
    const simulated = await deps.connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [creator] },
    });
    const after = simulated.value.accounts?.[0]?.lamports;
    if (simulated.value.err || after === undefined || after === null) return null;
    return (before - BigInt(after)).toString();
  } catch {
    return null;
  }
}

export type SubmittedAdvancedConfig = Readonly<{ ok: true; config: string; signature: string; state: "CREATED" | "PENDING"; terms: AdvancedTerms }>;

export async function submitAdvancedConfig(
  deps: LaunchDeps,
  input: Readonly<{ buildId: string; creator: string; signedWireBase64: string }>,
): Promise<SubmittedAdvancedConfig | LaunchFailure> {
  const deadline = deps.now().getTime() + ROUTE_MS;
  const build = await deps.store.collection<AdvancedConfigBuild>(BUILDS).get(`${deps.network.cluster}:${input.buildId}`);
  if (!build || build.cluster !== deps.network.cluster) return fail("NOT_BUILT", "This config was not built here.");
  if (build.creator !== input.creator) return fail("WRONG_CREATOR", "This config was built for another wallet.");
  if (Date.parse(build.expiresAt) < deps.now().getTime()) return fail("BUILD_EXPIRED", "The config waited too long for the signature; build it again.");
  const sealed = openCosigners(build.cosign, deps.env ?? {});
  if (!sealed) return fail("BUILD_EXPIRED", "The config can no longer be signed; build it again.");
  /* Exactly as built, the creator's signature first; the config's own key signs after, over the same message. */
  const tx = signedAsBuilt(input.signedWireBase64, { messageSha256: build.messageSha256, digest: build.digest }, build.creator, sealed.map((cosigner) => cosigner.key), null);
  if ("ok" in tx) return tx;
  const configs = deps.store.collection<AdvancedConfigRecord>(CONFIGS);
  const key = configKey(build.cluster, build.config);
  const signature = getBase58Decoder().decode(new Uint8Array(tx.signatures[0]?.signature ?? new Uint8Array()));
  const pending: AdvancedConfigRecord = { cluster: build.cluster, config: build.config, creator: build.creator, terms: build.terms, signature, state: "PENDING", token: null, createdAt: deps.now().toISOString() };
  if (!(await configs.insertIfAbsent(key, pending))) return fail("BUILD_USED", "This config was already sent.");
  const sent = await sendOnce(deps.connection, tx, Number(build.validUntil), deps.now, { ...CREATION_BUDGET, deadline }, { second: deps.second });
  if (sent.outcome === "REJECTED" || sent.outcome === "FAILED") {
    await configs.delete(key);
    return fail("SUBMIT_FAILED", sent.reason ?? "The network refused the config.");
  }
  const state = sent.outcome === "CONFIRMED" ? "CREATED" : "PENDING";
  if (state === "CREATED") await configs.set(key, { ...pending, signature: sent.signature, state });
  return { ok: true, config: build.config, signature: sent.signature, state, terms: build.terms };
}

/**
 * The config a launch's build names: the creator's own, made here, not yet used — and on the chain. A config the send
 * left PENDING is settled now from its account.
 */
export async function advancedConfigFor(deps: Pick<LaunchDeps, "store" | "network" | "connection">, creator: string | null, config: string): Promise<AdvancedConfigRecord | LaunchFailure> {
  const configs = deps.store.collection<AdvancedConfigRecord>(CONFIGS);
  const key = configKey(deps.network.cluster, config);
  const record = await configs.get(key);
  /* A quote may ask for any creator's config — it reads, builds nothing; a launch only for its own creator's. */
  if (!record || (creator !== null && record.creator !== creator)) return fail("ADVANCED_CONFIG_UNUSABLE", "This config was not made here for this wallet.");
  if (record.state === "USED") return fail("ADVANCED_CONFIG_UNUSABLE", "A launch was already sent on this config; make another.");
  if (!deps.network.advanced) return fail("PRESET_UNAVAILABLE", "«Розширений» is not offered on this network now.");
  if (record.state === "CREATED") return record;
  const account = await deps.connection.getAccountInfo(new PublicKey(config), "confirmed").catch(() => undefined);
  if (account === undefined) return fail("NETWORK_BUSY", "The config could not be read; try again.");
  if (!account) return fail("ADVANCED_CONFIG_UNUSABLE", "The config is not on the network yet.");
  const created: AdvancedConfigRecord = { ...record, state: "CREATED" };
  await configs.set(key, created);
  return created;
}

/**
 * One config, one launch, taken before the send: the first launch on a config takes it in one write that a second
 * cannot repeat; a launch the network refused gives it back.
 */
export async function takeAdvancedConfig(deps: Pick<LaunchDeps, "store" | "network">, config: string, buildId: string): Promise<boolean> {
  return deps.store.collection<Readonly<{ buildId: string }>>(CONFIGS).insertIfAbsent(`taken:${configKey(deps.network.cluster, config)}`, { buildId });
}

export async function returnAdvancedConfig(deps: Pick<LaunchDeps, "store" | "network">, config: string): Promise<void> {
  await deps.store.collection<Readonly<{ buildId: string }>>(CONFIGS).delete(`taken:${configKey(deps.network.cluster, config)}`);
}

/** One config, one launch: marked once the launch on it was sent. */
export async function markAdvancedConfigUsed(deps: Pick<LaunchDeps, "store" | "network">, config: string, token: string): Promise<void> {
  const configs = deps.store.collection<AdvancedConfigRecord>(CONFIGS);
  const key = configKey(deps.network.cluster, config);
  const record = await configs.get(key);
  if (record && record.state !== "USED") await configs.set(key, { ...record, state: "USED", token });
}

/** The choice of a config record, as the form reads it back. */
export function choiceOf(terms: AdvancedTerms): AdvancedChoice {
  const { graduationFee: _fee, firstBuyCapBps: _cap, ...choice } = terms;
  return choice;
}
