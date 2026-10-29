/**
 * Where Ryntra Launch runs, and with what.
 *
 * On every deployment Launch runs on mainnet, on the configs of its presets —
 * Класичний and Захищений (2026-10-05), Micro and the demo market Ryntra uses
 * for its own technical validation. «Спільнота» has a config per community
 * token, each signed by the operator (`scripts/launch/mainnet-config.mjs
 * --presets community`) and offered only once the deployment names it in
 * `RYNTRA_LAUNCH_COMMUNITY_CONFIGS` and the attribution registry lists it;
 * «Розширений» makes a config per launch within the bounds the operator approves
 * once (`RYNTRA_LAUNCH_ADVANCED_BOUNDS`) — without either, neither is offered
 * on mainnet (SOL-L5). A local
 * server can run the devnet stand instead — `RYNTRA_LAUNCH_STAND=devnet`,
 * never on production — whose presets are the devnet rehearsal's configs: the
 * same fields, with a test USDC and a test community token.
 *
 * Reading a launch — its page, its market, a creator's cabinet — needs no key
 * and no switch: people hold these tokens. Building or sending anything —
 * a launch, a trade, a claim — obeys the Launch lane's operator stop
 * (`RYNTRA_SOLANA_LAUNCH_STATE`, fail-closed), and a launch needs Ryntra's pool
 * payer too: its key comes through `RYNTRA_LAUNCH_POOL_PAYER_SECRET` (a JSON
 * array of 64 numbers, or the base58 string a wallet exports). On mainnet the
 * key must be the pool payer the attribution registry publishes, or nothing
 * launches: a pool Ryntra opens is always one a counter can attribute. The key
 * is never in the repository and never printed.
 *
 * The origin a launch's metadata, picture and share link live on is
 * configuration — `https://ryntra.io` on mainnet, the stand's own
 * `RYNTRA_LAUNCH_PUBLIC_ORIGIN` — never a request's Host or X-Forwarded-Host:
 * a mint names its metadata URI for ever, and a header must not be able to
 * point it at someone else's server.
 */

import { getBase58Encoder } from "@solana/kit";
import { Connection, Keypair } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY, SOLANA_FEE_WALLET, type RegistryEntry } from "../attribution/registry.ts";
import { DEVNET_ADVANCED_BOUNDS, parseAdvancedBounds, type AdvancedBounds } from "../core/launch/advanced.ts";
import { curveRulesProgramOf, type CurveRulesProgram } from "../core/launch/curve-rules.ts";
import { quoteAssetsOffered } from "../core/launch/quote-asset.ts";
import { TRANSFER_FEE_MAX_BPS, transferFeeOffered } from "../core/launch/transfer-fee.ts";
import { dbcSdkOf } from "../core/venues/meteora-dbc/sdk.server.ts";
import { FEE_POLICY_V2 } from "../core/fee-policy.ts";
import type { PresetConfigs } from "../core/venues/meteora-dbc/launch.server.ts";
import type { LaunchPresetId } from "../core/venues/meteora-dbc/presets.ts";
import { resolveSolanaLaneState } from "../solana/lane-state.ts";
import { resolveEndpoint, resolveEndpoints } from "../solana/rpc.ts";

export type LaunchCluster = "devnet" | "mainnet";

/**
 * A pair currency a preset trades against on this network. `dollar` — a
 * dollar stablecoin, so a figure in it is a figure in dollars; a community's
 * token is not, and its figures are said in the token.
 */
export type LaunchPair = Readonly<{ mint: string; symbol: string; decimals: number; usdPrice: number; dollar: boolean }>;

/** One community's token as «Спільнота» pairs against it: its own config, made at the token's dollar price then. */
export type CommunityPair = LaunchPair & Readonly<{ config: string }>;

export type LaunchNetwork = Readonly<{
  cluster: LaunchCluster;
  /** The Wallet Standard chain a wallet signs for. */
  chain: "solana:devnet" | "solana:mainnet";
  configs: PresetConfigs;
  /** The pair of each preset with a config here: USDC, or for «Спільнота» the first community's token. */
  pairs: Readonly<Partial<Record<LaunchPresetId, LaunchPair>>>;
  /** «Спільнота»: every community token offered here, each with its config (SOL-L5); empty — not offered. */
  communities: readonly CommunityPair[];
  /**
   * «Розширений»: the bounds the operator approved, and the partner's vault every such config names as its fee claimer and
   * leftover receiver — the multisig's, as on Класичний and Захищений. Null — «Розширений» is not offered here.
   */
  advanced: Readonly<{ bounds: AdvancedBounds; feeClaimer: string }> | null;
  /**
   * «Правила на кривій» (SOL-L8): the audited rule program this deployment runs. Null everywhere by default — the
   * preset is offered only with `RYNTRA_LAUNCH_CURVE_RULES=open`, the program's address, its published audit (SEC-3)
   * and DBC SDK 2.0.0, all four of the operator's giving.
   */
  curveRules?: CurveRulesProgram | null;
  explorer: (kind: "tx" | "account", id: string) => string;
  /** Where the metadata, the pictures and the share links live — from configuration only. */
  origin: string;
  /**
   * The address Ryntra's referral token accounts belong to, for trades on a launch's
   * curve and pool — Launch's own fee identity, the partner's vault, so a
   * referral is counted with the rest of Launch's fees and nowhere else. A
   * trade carries the referral only where that account exists on chain.
   */
  referralOwner: string | null;
  /** Whether Jupiter routes this network, so a graduated token can also be traded there. Devnet has no Jupiter. */
  jupiter: boolean;
  /**
   * Ryntra's fee wallet on this network: a graduated launch is a new token, and a direct trade in its pool may carry the
   * policy's Ryntra fee into this wallet, as a trade of it through Jupiter does (`poolFeeCharged`). A trade's page reads
   * the fee it finds moved here as part of what the trade cost. Null: no fee wallet.
   */
  feeWallet: string | null;
  /**
   * Whether a launch's trade is recorded here the way every Ryntra trade is — its row in History with a receipt,
   * `/stats`, and Ryntra's part of its fee handed to the rewards core as the cashback's base (`record.server.ts`).
   */
  tradesRecorded: boolean;
  /**
   * Whether a direct trade in a graduated pool carries Ryntra's own fee for a new token. Not yet: the rewards rules do
   * not count a launch's fee for the cashback, and a fee is never taken that the person's rewards do not see. In the pool
   * Ryntra's part is Meteora's referral until then.
   */
  poolFeeCharged: boolean;
  /**
   * Whether Meteora's Zap program on this network is the one its SDK speaks to: a holder's one-coin entry into a
   * graduated pool goes through it. Devnet's Zap is older than its SDK (its ledger instructions are unknown to it,
   * 07.10), so the stand builds the same entry from the pool's own swap and add-liquidity.
   */
  zap: boolean;
}>;

/* The devnet rehearsals of 05.10 (run 3, creator's share 40 %) and 10.10 (Micro, the demo market): their configs and test pair currencies. */
const DEVNET_COMMUNITY: CommunityPair = { config: "Ahh39x8jBcZxATVajcjfWUTsZBYmvwT6DwVTJLKEvr6v", mint: "8QwXVdfGjmnjZjF3TkzT4FZzA8J1gg9s8SfF9TUxFgEX", symbol: "COMM", decimals: 6, usdPrice: 0.01, dollar: false };
/* The rehearsal's partner vault on devnet — the same role the multisig's vault has on mainnet. */
const DEVNET_PARTNER_VAULT = "xkfpaFQnfBGposA1WnsU3miQ8L5sFAXv5Mck9Cjxjju";

const DEVNET: Omit<LaunchNetwork, "origin"> = {
  cluster: "devnet",
  chain: "solana:devnet",
  configs: {
    classic: "9fRjQM1eDW6hNJRzeLoTZ1sub7tbuMcEbHEwd29UuDik",
    protected: "FWDh4JYHGBwZzDgjJP6VVt8cPkL2Xr7mKqyXEazvnYva",
    community: [DEVNET_COMMUNITY.config],
    /* The rehearsal of 2026-10-10: Micro and the demo market, the stand executor their fee claimer. */
    micro: "BAhCUHp2SzGXVZ4kRTKxe3mrxFTK9dKGF7iBJPDoYZ6G",
    demo: "3qwvEk69TGJupqGRXURfkQBJtGXh66pxcdAD4PpVEEAA",
  },
  pairs: {
    classic: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true },
    protected: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true },
    community: DEVNET_COMMUNITY,
    micro: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true },
    demo: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true },
  },
  communities: [DEVNET_COMMUNITY],
  advanced: { bounds: DEVNET_ADVANCED_BOUNDS, feeClaimer: DEVNET_PARTNER_VAULT },
  explorer: (kind, id) => `https://solscan.io/${kind}/${id}?cluster=devnet`,
  referralOwner: DEVNET_PARTNER_VAULT,
  jupiter: false,
  /* The rehearsal's owner on devnet stands in for Ryntra's fee wallet; on mainnet it is the attribution registry's. */
  feeWallet: "9WBQamBC9Amdzzrq8QANXweZCKpfhLMLvPQJzMBgFbbu",
  /* The stand records its trades like mainnet — its rows and receipts, no rewards; the pool's Ryntra fee is built and
     proven on chain and charged nowhere yet. */
  tradesRecorded: true,
  poolFeeCharged: false,
  zap: false,
};

const USDC: LaunchPair = { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true };

const registryAddress = (id: string): string | null => ATTRIBUTION_REGISTRY.find((row) => row.id === id && row.end === null)?.address ?? null;

/*
 * Mainnet: the two configs created on 2026-10-05 (the creator's share 40 %), the attribution registry's rows —
 * the partner's vault owns Ryntra's referral accounts, Ryntra's fee wallet. A launch's trade is recorded like every trade
 * (History with a receipt, /stats, the rewards core's call); on the curve Ryntra earns as the config's partner inside the
 * curve's own fee, with Meteora's referral, and no Ryntra fee is taken in a graduated pool until the rewards rules count it.
 */
const MAINNET: LaunchNetwork = {
  cluster: "mainnet",
  chain: "solana:mainnet",
  configs: {
    classic: registryAddress("solana-launch-config-classic") ?? "",
    protected: registryAddress("solana-launch-config-protected") ?? "",
    /* Created 2026-10-10 on the operator's signature; the executor claims their partner fees. */
    micro: registryAddress("solana-launch-config-micro") ?? "",
    demo: registryAddress("solana-launch-config-demo") ?? "",
  },
  pairs: { classic: USDC, protected: USDC, micro: USDC, demo: USDC },
  /* Offered only once the operator's configs are named and listed, and his bounds given (`withFormats`). */
  communities: [],
  advanced: null,
  explorer: (kind, id) => `https://solscan.io/${kind}/${id}`,
  origin: "https://ryntra.io",
  referralOwner: registryAddress("solana-launch-fee-claimer"),
  jupiter: true,
  feeWallet: SOLANA_FEE_WALLET,
  tradesRecorded: true,
  poolFeeCharged: false,
  zap: true,
};

/**
 * The network Launch runs on here: the devnet stand where a local server asks
 * for it — never production, where a flag left set opens nothing and mainnet
 * runs as everywhere else — and mainnet otherwise. Null only for a stand
 * without its public origin.
 */
export function launchNetwork(env: NodeJS.ProcessEnv = process.env): LaunchNetwork | null {
  if (env.RYNTRA_LAUNCH_STAND !== "devnet" || env.VERCEL_ENV === "production") return withFormats(MAINNET, env);
  const origin = publicOrigin(env.RYNTRA_LAUNCH_PUBLIC_ORIGIN);
  if (!origin) return null;
  return withFormats(devnetStand(env, origin), env);
}

function devnetStand(env: NodeJS.ProcessEnv, origin: string): LaunchNetwork {
  let stand: Omit<LaunchNetwork, "origin"> = DEVNET;
  /*
   * Класичний on a test USDC of the stand's own (SOL-L5, `scripts/launch-qa/stand-setup.mjs`): the rehearsal of 05.10's
   * test USDC has no key left to mint it. Захищений's config is on that old USDC, so it is not offered then, and
   * «Розширений» and early access trade the stand's own USDC. Both or neither.
   */
  const classicConfig = env.RYNTRA_LAUNCH_DEVNET_CLASSIC_CONFIG?.trim();
  const classicPair = env.RYNTRA_LAUNCH_DEVNET_CLASSIC_PAIR?.trim();
  if (classicConfig && classicPair) {
    const { protected: _protectedConfig, ...configs } = stand.configs;
    const { protected: _protectedPair, ...pairs } = stand.pairs;
    stand = { ...stand, configs: { ...configs, classic: classicConfig }, pairs: { ...pairs, classic: { ...DEVNET.pairs.classic!, mint: classicPair } } };
  }
  /*
   * A devnet rehearsal of its own (SOL-L6): a Micro config whose fee claimer is the stand's executor and its test USDC,
   * named by the stand — the keys of the rehearsal of 10.10 are gone with its session. Both or neither.
   */
  const microConfig = env.RYNTRA_LAUNCH_DEVNET_MICRO_CONFIG?.trim();
  const microPair = env.RYNTRA_LAUNCH_DEVNET_MICRO_PAIR?.trim();
  if (microConfig && microPair) {
    stand = { ...stand, configs: { ...stand.configs, micro: microConfig }, pairs: { ...stand.pairs, micro: { ...DEVNET.pairs.micro!, mint: microPair } } };
  }
  return { ...stand, origin };
}

/** The registry's rows of «Спільнота»'s mainnet configs: one per community token, its `mint` the community's. */
export const COMMUNITY_REGISTRY_PREFIX = "solana-launch-config-community-";

/**
 * The community tokens a deployment names (`RYNTRA_LAUNCH_COMMUNITY_CONFIGS`, a JSON array of `{ config, mint, symbol,
 * decimals, usdPrice }`): on mainnet only those whose config the attribution registry lists as one of «Спільнота»'s,
 * for that very community token — a pool on a config the counter cannot attribute is never offered; on the stand any.
 * Anything malformed is left out, never guessed.
 */
export function communityPairs(env: NodeJS.ProcessEnv, cluster: LaunchCluster, registry: readonly RegistryEntry[] = ATTRIBUTION_REGISTRY): CommunityPair[] {
  const text = env.RYNTRA_LAUNCH_COMMUNITY_CONFIGS?.trim();
  if (!text) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const out: CommunityPair[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    const { config, mint, symbol, decimals, usdPrice } = row;
    if (typeof config !== "string" || !base58.test(config) || typeof mint !== "string" || !base58.test(mint)) continue;
    if (typeof symbol !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(symbol)) continue;
    if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
    if (typeof usdPrice !== "number" || !(usdPrice > 0) || !Number.isFinite(usdPrice)) continue;
    if (cluster === "mainnet" && !registry.some((entry) => entry.id.startsWith(COMMUNITY_REGISTRY_PREFIX) && entry.end === null && entry.address === config && entry.mint === mint)) continue;
    if (out.some((known) => known.config === config || known.mint === mint)) continue;
    out.push({ config, mint, symbol, decimals, usdPrice, dollar: false });
  }
  return out;
}

/**
 * The network with the formats this deployment offers: the community tokens it names, and «Розширений» — on mainnet
 * only with the operator's bounds (`RYNTRA_LAUNCH_ADVANCED_BOUNDS`) and the partner's vault the registry publishes; on the
 * stand with its own.
 */
function withFormats(network: LaunchNetwork, env: NodeJS.ProcessEnv): LaunchNetwork {
  const named = communityPairs(env, network.cluster);
  const communities = [...network.communities, ...named.filter((pair) => !network.communities.some((known) => known.mint === pair.mint || known.config === pair.config))];
  const vault = network.cluster === "mainnet" ? registryAddress("solana-launch-fee-claimer") : network.advanced?.feeClaimer ?? null;
  const owned = network.cluster === "mainnet" ? parseAdvancedBounds(env.RYNTRA_LAUNCH_ADVANCED_BOUNDS) : network.advanced?.bounds ?? null;
  /* «Комісія за переказ» (SOL-L10) rides on «Розширений»: offered only with its flag open on SDK 2.0.0, at Ryntra's ceiling. */
  const bounds = owned && transferFeeOffered(env, dbcSdkOf(env)) ? { ...owned, transferFeeMaxBps: TRANSFER_FEE_MAX_BPS } : owned;
  const advanced = bounds && vault ? { bounds, feeClaimer: vault } : null;
  /*
   * «Правила на кривій» (SOL-L8): the rule program, with Ryntra's multisig as the one authority that may upgrade it
   * where it is not frozen. Null until the operator opens the flag after the independent audit.
   */
  const multisig = registryAddress("solana-launch-fee-claimer");
  const curveRules = curveRulesProgramOf(env, dbcSdkOf(env), { multisigs: multisig ? [multisig] : [], upgradeAuthority: env.RYNTRA_LAUNCH_CURVE_RULES_MULTISIG ?? null });
  if (communities.length === network.communities.length && advanced === network.advanced && (curveRules?.program ?? null) === (network.curveRules?.program ?? null)) return network;
  const [first] = communities;
  return {
    ...network,
    communities,
    configs: { ...network.configs, ...(first ? { community: communities.map((pair) => pair.config) } : {}) },
    pairs: { ...network.pairs, ...(first ? { community: network.pairs.community ?? first } : {}) },
    advanced,
    curveRules,
  };
}

/**
 * The partner's vault on this network — the fee claimer every «Класичний», «Захищений», «Спільнота» and «Розширений»
 * config names (SOL-L1d): on mainnet the attribution registry's; on the devnet stand the rehearsal's, or the stand's own
 * (`RYNTRA_LAUNCH_DEVNET_PARTNER_VAULT`) when a rehearsal of its own made another multisig. Null — none known here.
 */
export function launchPartnerVault(network: Pick<LaunchNetwork, "cluster">, env: NodeJS.ProcessEnv = process.env): string | null {
  if (network.cluster === "mainnet") return registryAddress("solana-launch-fee-claimer");
  return env.RYNTRA_LAUNCH_DEVNET_PARTNER_VAULT?.trim() || DEVNET_PARTNER_VAULT;
}

/**
 * SOL-L1d's claims on this network — the partner vault's claims proposed through Squads on the treasury page, and the
 * creator's «Забрати» with the curve's surplus and the locked LP's fee from the exit position: the devnet stand always;
 * mainnet only with `RYNTRA_LAUNCH_CLAIMS_V2=open`, the operator's switch. Closed, the treasury offers no launch claims and
 * «Забрати» builds what it built before — the curve's, the graduation's and the LP's fees, the LP's position from the
 * node's index, no surplus.
 */
export function launchClaimsV2Open(network: Pick<LaunchNetwork, "cluster">, env: NodeJS.ProcessEnv = process.env): boolean {
  if (network.cluster === "devnet") return true;
  return env.RYNTRA_LAUNCH_CLAIMS_V2?.trim() === "open";
}

/** Whether anything may be built or sent through Launch now: its lane's operator stop says `OPEN`. */
export function launchOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveSolanaLaneState("LAUNCH", env) === "OPEN";
}

/**
 * Whether this deployment may make a launch on its network. A mint names its metadata at `https://ryntra.io` for ever,
 * so on mainnet only the production deployment — whose store is the one that address serves — writes a launch; a preview
 * or a local server reads launches and never makes one whose metadata would be found nowhere. The devnet stand makes
 * launches on its own origin.
 */
export function launchWritesHere(network: LaunchNetwork, env: NodeJS.ProcessEnv = process.env): boolean {
  return network.cluster !== "mainnet" || env.VERCEL_ENV === "production";
}

/**
 * The pair a preset trades against here; a preset without a config here has none, and is refused before this is asked.
 * «Спільнота» has one per community token: `pairMint` names it (a launch's record carries it). «Розширений» trades
 * against USDC, as Захищений — or, where its config was made on one, against a checked pair currency (SOL-L11), which
 * its record names too.
 */
export function launchPair(network: LaunchNetwork, preset: LaunchPresetId, pairMint?: string, env: NodeJS.ProcessEnv = process.env): LaunchPair {
  if (preset === "community" && pairMint) {
    const community = network.communities.find((pair) => pair.mint === pairMint);
    if (!community) throw new Error(`Launch has no community pair ${pairMint} on ${network.cluster}.`);
    return community;
  }
  /*
   * A launch made while the bounds were offered stays readable after: its pair is the network's own whatever the bounds
   * are now — unless its config was made on a checked pair currency (SOL-L11), and then that mint's own record says the
   * symbol and the decimals its figures are read in. Such a pair is not a dollar, so no surface turns it into one: its
   * price is read at the moment it is needed, never carried here as a constant.
   */
  if (preset === "advanced") {
    const own = network.pairs.protected ?? launchPair(network, "classic", undefined, env);
    if (!pairMint || pairMint === own.mint) return own;
    const asset = quoteAssetsOffered(env).find((record) => record.mint === pairMint);
    if (!asset) throw new Error(`Launch has no checked pair ${pairMint} on ${network.cluster}.`);
    return { mint: asset.mint, symbol: asset.symbol, decimals: asset.decimals, usdPrice: 0, dollar: false };
  }
  const pair = network.pairs[preset];
  if (!pair) throw new Error(`Launch has no ${preset} preset on ${network.cluster}.`);
  return pair;
}

/** An origin as configured — `scheme://host[:port]`, nothing more — or null. */
function publicOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.pathname !== "/" || url.search || url.hash || url.username) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Ryntra's pool payer here; null when there is none, and then nothing launches. On mainnet only the key of the pool payer
 * the attribution registry publishes is one: a key for another address is refused, never used.
 */
export function launchPoolPayer(env: NodeJS.ProcessEnv = process.env, network: LaunchNetwork | null = launchNetwork(env)): Keypair | null {
  if (!network) return null;
  const payer = keypairOf(env.RYNTRA_LAUNCH_POOL_PAYER_SECRET);
  if (!payer || network.cluster !== "mainnet") return payer;
  return payer.publicKey.toBase58() === registryAddress("solana-launch-pool-payer") ? payer : null;
}

/**
 * The pool payer's address a launch's receipt asks for: the registry's on mainnet, read without the key — a page shows a
 * launch whether or not this deployment can launch — and the stand's own key's on devnet.
 */
export function launchPoolPayerAddress(network: LaunchNetwork, env: NodeJS.ProcessEnv = process.env): string | null {
  if (network.cluster === "mainnet") return registryAddress("solana-launch-pool-payer");
  return launchPoolPayer(env, network)?.publicKey.toBase58() ?? null;
}

/**
 * Ryntra's executor here — the wallet that sends a curve's graduation and holds Ryntra's own liquidity on graduated
 * launches; null when there is none, and then nothing of it runs. Its key comes through
 * `RYNTRA_LAUNCH_EXECUTOR_SECRET`, in the pool payer's formats. On mainnet only the key of the executor the attribution
 * registry publishes is one: every action it takes is then one a counter can attribute.
 */
export function launchExecutor(env: NodeJS.ProcessEnv = process.env, network: LaunchNetwork | null = launchNetwork(env)): Keypair | null {
  if (!network) return null;
  const executor = keypairOf(env.RYNTRA_LAUNCH_EXECUTOR_SECRET);
  if (!executor || network.cluster !== "mainnet") return executor;
  return executor.publicKey.toBase58() === registryAddress("solana-launch-executor") ? executor : null;
}

/** The executor's address a token's log names — the registry's on mainnet, read without the key; the stand's own key's on devnet. */
export function launchExecutorAddress(network: LaunchNetwork, env: NodeJS.ProcessEnv = process.env): string | null {
  if (network.cluster === "mainnet") return registryAddress("solana-launch-executor");
  return launchExecutor(env, network)?.publicKey.toBase58() ?? null;
}

/** Whether the executor may place and move Ryntra's liquidity now: its own operator stop says `OPEN`, and Launch's does. */
export function launchFloorOpen(env: NodeJS.ProcessEnv = process.env): boolean {
  return launchOpen(env) && resolveSolanaLaneState("LAUNCH_FLOOR", env) === "OPEN";
}

/** A secret key as configured: a JSON array of 64 bytes, or the base58 string a wallet exports. Null for anything else. */
function keypairOf(raw: string | undefined): Keypair | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const bytes = text.startsWith("[") ? (JSON.parse(text) as unknown) : Array.from(getBase58Encoder().encode(text));
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) return null;
    return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    return null;
  }
}

let cached: { url: string; connection: Connection } | null = null;

export function launchConnection(network: LaunchNetwork): Connection {
  const url = resolveEndpoint(network.cluster);
  if (!cached || cached.url !== url) cached = { url, connection: new Connection(url, "confirmed") };
  return cached.connection;
}

/**
 * The endpoint whose signature lists reach back to a token's creation. The public operators keep a day or two of an
 * account's signatures (measured 06.10: the same wallet — 9 on one, 8 on the other, 52 back to 1 October on Solana's own
 * endpoint), so on mainnet the lists come from Solana's own public endpoint unless a provider's is configured. A list
 * is trusted as whole only when it reaches the account's first transaction, whatever endpoint gave it.
 */
export function launchHistoryEndpoint(network: LaunchNetwork): string {
  const endpoints = resolveEndpoints(network.cluster);
  const primary = endpoints[0]!;
  if (primary.fromEnv || network.cluster !== "mainnet") return primary.url;
  return "https://api.mainnet-beta.solana.com";
}

/* One per process: the history endpoint as a connection — signature lists back to a token's creation. */
const HISTORIES = new Map<string, Connection>();
export function launchHistoryConnection(network: LaunchNetwork): Connection {
  const url = launchHistoryEndpoint(network);
  const known = HISTORIES.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  HISTORIES.set(url, known);
  return known;
}

/** Asked for a transaction the main endpoint no longer keeps: the second operator still serves older ones. */
export function launchArchiveEndpoint(network: LaunchNetwork): string {
  return launchIndexedEndpoint(network);
}

/* One per process; a refusal is answered at once rather than waited out — the receipt then says it was not read. */
const ARCHIVES = new Map<string, Connection>();
export function launchArchiveConnection(network: LaunchNetwork): Connection | null {
  const url = launchArchiveEndpoint(network);
  if (url === resolveEndpoint(network.cluster)) return null;
  const known = ARCHIVES.get(url) ?? new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  ARCHIVES.set(url, known);
  return known;
}

/**
 * The endpoint for the reads a node answers from its indexes — every holder of a mint, its largest accounts, a creator's
 * curves. A configured primary (a provider's endpoint) answers them; the public primary on mainnet refuses them ("indexed
 * requests require a personal token"), so then the network's second operator, which answers a small token's holders in
 * about a second.
 */
export function launchIndexedEndpoint(network: LaunchNetwork): string {
  const endpoints = resolveEndpoints(network.cluster);
  const primary = endpoints[0]!;
  if (primary.fromEnv) return primary.url;
  return (endpoints.find((endpoint) => endpoint.role === "fallback") ?? primary).url;
}

/** The fewest lamports the pool payer keeps; below it the stand stops building launches rather than fail them. */
export const POOL_PAYER_FLOOR_LAMPORTS = 20_000_000n;

/**
 * How many launches one creator's wallet may send in a day, and how many the
 * whole network in an hour — every send counted, the ones the chain refused
 * too: a creation that fails on chain still costs the pool payer its fee, so
 * failures are bounded by the same counts.
 */
export const LAUNCHES_PER_CREATOR_PER_DAY = 3;
export const LAUNCHES_PER_HOUR = 60;

/**
 * The Ryntra fee a direct trade in a graduated launch's pool carries: after the curve the token is a new token like
 * any other, so the policy's rate for that class (MEME), into the network's fee wallet. Its class by Jupiter's
 * verification and age is read with the mainnet catalogue; a new launch is not verified yet. None without a fee wallet,
 * none where the trade is not recorded for the person's History and receipt, and none until the fee is charged here —
 * when the rewards rules count it for the cashback.
 */
export function launchPoolFee(network: LaunchNetwork): Readonly<{ wallet: string; bps: number }> | null {
  return network.feeWallet && network.tradesRecorded && network.poolFeeCharged ? { wallet: network.feeWallet, bps: FEE_POLICY_V2.MEME.bps } : null;
}

/**
 * The configs a launch's own reads go through: the network's, and — «Розширений» — the launch's own config, made for it
 * alone, so its curve is found by its address and read as «Розширений» (SOL-L5).
 */
export function configsOfRecord(network: LaunchNetwork, record: Readonly<{ preset: LaunchPresetId; config: string }>): PresetConfigs {
  return record.preset === "advanced" ? { ...network.configs, advanced: record.config } : network.configs;
}
