/**
 * Relay deposit addresses — money brought to Solana without a second wallet (SOL-W1).
 *
 * On the pages
 * of Ryntra on Solana a person signs with their Solana wallet only, and money
 * from another network or an exchange is *sent to an address* rather than
 * pulled through a connected EVM wallet. Relay — already the rail of «Між
 * мережами» — offers exactly that: `POST /quote/v2` with `useDepositAddress:
 * true` answers an address on the origin network instead of calldata; whatever
 * USDC lands there is swept by Relay and a solver pays USDC to the person's
 * Solana wallet (docs.relay.link/features/deposit-addresses, read 20.10).
 *
 * ## The choices, and the facts behind them
 *
 * - **Open, not strict.** An open address takes any amount and can be used
 *   again for the same route; a strict one is a single exact payment. A person
 *   sending from an exchange cannot promise an exact figure, so open it is.
 * - **No `refundTo`.** Relay accepts only an origin-chain address there
 *   (`INVALID_ADDRESS … for chain 8453` for a Solana one, read 20.10), and the
 *   person has none — that is the point. Relay's own sentinel (the zero
 *   address, «refund the depositor») is documented as unsafe for exchange
 *   senders, and an exchange is exactly who sends here. So no automatic refund
 *   is promised: Relay's docs say an open address without `refundTo` has none,
 *   and a deposit Relay cannot fill is recovered by hand through Relay's support. The order a live quote builds does
 *   name its refund on Solana, to the same recipient
 *   (`protocol.v2.orderData.inputs[].refunds`, read 20.10); the parser keeps
 *   that as a check and refuses an answer whose refunds point anywhere else.
 * - **USDC to USDC only.** One asset per network
 *   is also one line of instruction a person can follow without a list.
 * - **No Ryntra fee.**
 *
 * Pure and client-safe: no environment, no key, no network — the server route
 * (`app/api/swap/deposit-address`) owns those, and tests run on recorded shapes.
 */

import { ARBITRUM_USDC_CONTRACT, BASE_USDC_CONTRACT, BNB_USDC_CONTRACT, BNB_USDC_DECIMALS, ETHEREUM_USDC_CONTRACT, OPTIMISM_USDC_CONTRACT, POLYGON_USDC_CONTRACT, SOLANA_USDC_MINT } from "../swap/catalog.ts";
import { RELAY_CHAIN_IDS, RELAY_SOLANA_CHAIN_ID } from "./chains.ts";

/** The networks money can come from, in the order a person meets them. */
export const DEPOSIT_NETWORKS = ["base", "ethereum", "arbitrum", "optimism", "polygon", "bnb"] as const;
export type DepositNetwork = (typeof DEPOSIT_NETWORKS)[number];

export const DEPOSIT_NETWORK_LABEL: Readonly<Record<DepositNetwork, string>> = {
  base: "Base",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  bnb: "BNB Chain",
};

const USDC_ON: Readonly<Record<DepositNetwork, Readonly<{ contract: string; decimals: number }>>> = {
  base: { contract: BASE_USDC_CONTRACT, decimals: 6 },
  ethereum: { contract: ETHEREUM_USDC_CONTRACT, decimals: 6 },
  arbitrum: { contract: ARBITRUM_USDC_CONTRACT, decimals: 6 },
  optimism: { contract: OPTIMISM_USDC_CONTRACT, decimals: 6 },
  polygon: { contract: POLYGON_USDC_CONTRACT, decimals: 6 },
  bnb: { contract: BNB_USDC_CONTRACT, decimals: BNB_USDC_DECIMALS },
};

/**
 * The amount the quote is asked for. An open address is not bound to it — any
 * deposit gets its own fill — so it only sizes the fee the page shows
 * («≈ $0.03 on $10»), and ten dollars is a sum a first deposit is near.
 */
export const DEPOSIT_REFERENCE_USD = 10;
/**
 * The least the page asks for. Relay sweeps anything above $0.05 (docs, 20.10)
 * and fills $1 on every network here (live quotes 20.10: $0.95–0.98 arrives);
 * $1 is also the least a purchase on Ryntra is.
 */
export const DEPOSIT_MIN_USD = 1;

export const RELAY_QUOTE_V2_PATH = "/quote/v2";
/** Relay's `user` on a deposit address is the depositor, unknown here; the zero address is what its own examples accept. */
const ANY_SENDER = "0x0000000000000000000000000000000000000000";

export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function isDepositNetwork(value: unknown): value is DepositNetwork {
  return typeof value === "string" && (DEPOSIT_NETWORKS as readonly string[]).includes(value);
}

/** The body of `POST /quote/v2` for one network → the person's Solana wallet. */
export function depositAddressRequest(network: DepositNetwork, recipient: string): Record<string, unknown> {
  const usdc = USDC_ON[network];
  return {
    user: ANY_SENDER,
    recipient,
    originChainId: RELAY_CHAIN_IDS[network],
    originCurrency: usdc.contract,
    destinationChainId: RELAY_SOLANA_CHAIN_ID,
    destinationCurrency: SOLANA_USDC_MINT,
    amount: (10n ** BigInt(usdc.decimals) * BigInt(DEPOSIT_REFERENCE_USD)).toString(),
    tradeType: "EXACT_INPUT",
    useDepositAddress: true,
  };
}

export type DepositAddress = Readonly<{
  network: DepositNetwork;
  /** Where the person sends USDC on `network`. */
  address: string;
  /** The Solana wallet that receives the USDC. */
  recipient: string;
  /** What the reference deposit loses on the way — USDC in minus USDC out — in dollars; null when Relay did not say. */
  feeUsd: number | null;
  /** Seconds Relay expects a fill to take; null when it did not say. */
  seconds: number | null;
}>;

export type DepositAddressRefusal = "NO_ADDRESS" | "WRONG_RECIPIENT" | "WRONG_ROUTE" | "WRONG_REFUND";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function same(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/**
 * Relay's answer, believed only after it is checked against what was asked.
 *
 * An address is something a person will send real money to, so every part
 * that decides where that money goes is read back: the address itself, the
 * recipient, both currencies on both chains, and where a refund would go. Any
 * mismatch is a refusal and the page shows no address at all.
 */
export function parseDepositAddress(network: DepositNetwork, recipient: string, payload: unknown):
  | Readonly<{ ok: true; value: DepositAddress }>
  | Readonly<{ ok: false; reason: DepositAddressRefusal }> {
  const body = record(payload);
  const steps = Array.isArray(body?.steps) ? body.steps : [];
  const address = steps.map((step) => record(step)?.depositAddress).find((value): value is string => typeof value === "string");
  if (!address || !EVM_ADDRESS.test(address)) return { ok: false, reason: "NO_ADDRESS" };

  const details = record(body?.details);
  if (details?.recipient !== recipient) return { ok: false, reason: "WRONG_RECIPIENT" };
  const currencyIn = record(record(details?.currencyIn)?.currency);
  const currencyOut = record(record(details?.currencyOut)?.currency);
  const usdc = USDC_ON[network];
  if (
    currencyIn?.chainId !== RELAY_CHAIN_IDS[network] || !same(currencyIn?.address, usdc.contract) ||
    currencyOut?.chainId !== RELAY_SOLANA_CHAIN_ID || currencyOut?.address !== SOLANA_USDC_MINT
  ) return { ok: false, reason: "WRONG_ROUTE" };

  /* Where a failed fill pays back. Absent is accepted (Relay's own default);
     present, every refund must be the same Solana wallet. */
  const inputs = record(record(record(body?.protocol)?.v2)?.orderData)?.inputs;
  const refunds = Array.isArray(inputs) ? inputs.flatMap((input) => (Array.isArray(record(input)?.refunds) ? (record(input)?.refunds as unknown[]) : [])) : [];
  if (refunds.some((refund) => record(refund)?.chainId !== "solana" || record(refund)?.recipient !== recipient)) return { ok: false, reason: "WRONG_REFUND" };

  /* What the deposit loses on the way: USDC in minus USDC out, both from the
     quote. Not the sum of `fees` — `relayer` already contains `relayerGas`
     and `relayerService`, and `gas` is the sender's own network fee, not
     taken from the deposit. */
  const inRaw = record(details?.currencyIn)?.amount;
  const outRaw = record(details?.currencyOut)?.amount;
  const feeUsd = typeof inRaw === "string" && typeof outRaw === "string" && /^[0-9]+$/.test(inRaw) && /^[0-9]+$/.test(outRaw)
    ? Math.max(0, Number(inRaw) / 10 ** usdc.decimals - Number(outRaw) / 1e6)
    : null;
  const seconds = typeof details?.timeEstimate === "number" && Number.isFinite(details.timeEstimate) ? details.timeEstimate : null;
  return { ok: true, value: { network, address, recipient, feeUsd: feeUsd === null ? null : Math.round(feeUsd * 100) / 100, seconds } };
}

/** What happened to money sent to a deposit address, in the words the page uses. */
export type DepositProgress = "NONE" | "ON_THE_WAY" | "ARRIVED" | "REFUNDED" | "FAILED";

/**
 * The newest request Relay filled from an address (`GET /requests/v3?depositAddress=`).
 *
 * Relay's own states — `waiting`, `pending`, `submitted`, `success`, `refund`,
 * `failure` — collapse into the four a person needs; anything unknown is
 * «on the way», never «arrived».
 */
export function depositProgressOf(payload: unknown): Readonly<{ progress: DepositProgress; amount: string | null; at: string | null }> {
  /* Asked with `startTimestamp`, so only deposits made since the person last opened the address are here. */
  const requests = record(payload)?.requests;
  const newest = Array.isArray(requests) && requests.length > 0 ? record(requests[0]) : null;
  if (!newest) return { progress: "NONE", amount: null, at: null };
  const status = typeof newest.status === "string" ? newest.status.toLowerCase() : "";
  const progress: DepositProgress = status === "success" ? "ARRIVED" : status === "refund" || status === "refunded" ? "REFUNDED" : status === "failure" || status === "failed" ? "FAILED" : "ON_THE_WAY";
  const actual = record(record(record(newest.data)?.route)?.actual);
  const side = record(actual?.destination ?? actual?.origin);
  const formatted = record(side?.outputCurrency)?.amountFormatted;
  const amount = typeof formatted === "string" && /^[0-9]+(\.[0-9]+)?$/.test(formatted) ? formatted : null;
  const at = typeof newest.createdAt === "string" ? newest.createdAt : null;
  return { progress, amount, at };
}
