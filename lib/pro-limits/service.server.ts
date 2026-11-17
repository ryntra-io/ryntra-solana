/**
 * «Buy cheaper», «sell higher» wired for the routes: the deployment's environment and its gate, the
 * network's endpoint with the venue on it, the wallets the registry names, and the agent's key for the collecting
 * pass. The logic is `./service.ts`; this is the only place a route reaches it from.
 *
 * - The referral an order names, and so the venue's own, is on mainnet the registry's launch fee wallet — the owner
 *   of Ryntra's referral accounts on Launch too; on devnet the address a variable names, or nobody.
 * - The collector is the agent's one address: on mainnet the registry's open `AGENT_SIGNER` row, whose key lives in
 *   Google Cloud KMS and is asked only by the pass, only for bytes its judge let through; on devnet the address a
 *   variable names.
 *
 * No key is read here: the pass takes the mandate's own signer (`lib/mandate/agent-service.server.ts`), which on
 * mainnet is KMS or nothing.
 */

import "server-only";

import { Connection, PublicKey } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createDlmmProVenue, type DlmmProVenue } from "../core/venues/meteora-dlmm-pro/venue.server.ts";
import { onNetwork } from "../bots/ladder/connection.server.ts";
import { agentKeyFor } from "../mandate/agent-service.server.ts";
import { resolveEndpoints } from "../solana/rpc.ts";

import { PRO_LIMITS_DEVNET_AGENT_ENV, PRO_LIMITS_DEVNET_REFERRAL_ENV, addressOf, proLimitsGate, type ProLimitsNetwork } from "./gate.ts";
import { proCollectPass, proMarket, proOrders, proQuote, proReview, proSubmit, type CollectorSigner, type ProDeps, type ProIntent, type ProReviewInput } from "./service.ts";

const registryAddress = (id: string): string | null => ATTRIBUTION_REGISTRY.find((row) => row.id === id && row.end === null)?.address ?? null;
/** The agent's one address on mainnet: the registry's open `AGENT_SIGNER` row. */
function registryAgent(): string | null {
  const open = ATTRIBUTION_REGISTRY.filter((row) => row.role === "AGENT_SIGNER" && row.network === "solana" && row.end === null);
  return open.length === 1 ? (open[0]!.address ?? null) : null;
}

const collector = (network: ProLimitsNetwork): string | null => (network === "mainnet" ? registryAgent() : addressOf(process.env[PRO_LIMITS_DEVNET_AGENT_ENV]));
const referral = (network: ProLimitsNetwork): string | null => (network === "mainnet" ? registryAddress("solana-launch-fee-claimer") : addressOf(process.env[PRO_LIMITS_DEVNET_REFERRAL_ENV]));

const venues = new Map<string, Readonly<{ venue: DlmmProVenue; connection: Connection }>>();
/**
 * The venue on the network's endpoint — once the chain itself says the endpoint serves that network. An endpoint can
 * be overridden by a variable (`RYNTRA_SOLANA_RPC_DEVNET`), and the program and wrapped SOL have the same addresses on
 * both chains: without this, a devnet switch pointed at a mainnet node would serve real pools with devnet's lack of a
 * cap. Null — no endpoint, or one of another network.
 */
async function on(network: ProLimitsNetwork): Promise<Readonly<{ venue: DlmmProVenue; connection: Connection }> | null> {
  const url = resolveEndpoints(network)[0]?.url;
  if (!url) return null;
  const key = `${network}:${url}:${referral(network) ?? ""}`;
  let known = venues.get(key);
  if (!known) {
    const connection = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
    known = { connection, venue: createDlmmProVenue({ connection, referralOwner: referral(network) }) };
    venues.set(key, known);
  }
  return (await onNetwork(known.connection, network)) ? known : null;
}

function deps(): ProDeps {
  return { env: process.env, gate: () => proLimitsGate(process.env), on, collector, referral };
}

/** Whether the lane answers here at all: a route that is closed says so before it reads a request. */
export function proLimitsOpen(): boolean {
  return proLimitsGate(process.env).open;
}

export const readProMarket = (mint: string) => proMarket(mint, deps());
export const readProQuote = (input: Readonly<{ mint: string; intent: ProIntent }>) => proQuote(input, deps());
export const reviewProLimit = (input: ProReviewInput) => proReview(input, deps());
export const submitProLimit = (input: Readonly<{ ticket: unknown; signed: readonly unknown[] }>) => proSubmit(input, deps());
export const readProOrders = (input: Readonly<{ owner: string; mint?: string | null }>) => proOrders(input, deps());

/** The agent's collecting pass on the gate's network, with the agent's key where the deployment has it. */
export async function proCollectMinute() {
  const gate = proLimitsGate(process.env);
  if (!gate.open) return proCollectPass(deps(), null);
  const address = collector(gate.network);
  let signer: CollectorSigner | null = null;
  if (address) {
    const agent = new PublicKey(address);
    const key = agentKeyFor(process.env, gate.network === "mainnet" ? { open: true, network: "mainnet", pool: null, agent } : { open: true, network: "devnet", pool: agent, agent });
    signer = key ? { address, sign: (message) => key.sign(message) } : null;
  }
  return proCollectPass(deps(), signer);
}

export type { ProMarket, ProOrder, ProQuoteView, ProRelay, ProReview } from "./service.ts";
