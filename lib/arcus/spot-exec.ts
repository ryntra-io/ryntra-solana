"use client";

// Client-side Arcus SPOT execution. Non-custodial: the wallet approves Permit2 once and
// signs each swap intent (EIP-712), then broadcasts only after a separate explicit confirmation.
// Ryntra never holds keys and never sends a blind unsigned router transaction.

import {
  PERMIT2_ADDRESS,
  SPOT_CHAIN_ID_HEX,
  SPOT_CHAIN_NAME,
  SPOT_RPC_URL,
  SPOT_SETTLEMENT_ROUTER_ADDRESS,
  type SpotQuote,
} from "./spot.ts";
import {
  RIALTO_ROUTER_RUNTIME_CODE_HASH, SIG_PLACEHOLDER, validateSpotExecutionIntent,
  readRialtoDirectRoutePin,
  type SpotExecutionFee,
} from "./spot-exec-policy.ts";
import { keccak256Hex } from "../crypto/keccak.ts";

export type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
export function getEth(): Eth | null {
  return (window as unknown as { ethereum?: Eth }).ethereum ?? null;
}

const MAX_UINT256 = "0x" + "f".repeat(64);
const pad = (hexOrAddr: string) => hexOrAddr.toLowerCase().replace(/^0x/, "").padStart(64, "0");

async function rpc<T = string>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SPOT_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result as T;
}

const ethCall = (to: string, data: string) => rpc<string>("eth_call", [{ to, data }, "latest"]);
async function readRuntimeCodeHash(target: string): Promise<string> {
  const code = await rpc<string>("eth_getCode", [target, "latest"]);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error("route runtime code is unavailable");
  return keccak256Hex(code);
}

type RuntimeCodeHashReader = (target: string) => Promise<string>;


export async function readBalance(token: string, owner: string): Promise<bigint> {
  const r = await ethCall(token, "0x70a08231" + pad(owner));
  return BigInt(r || "0x0");
}

/** ERC-20 decimals() — used to display wrapped-token balances without assuming they mirror the
    native token's decimals. Throws on empty/absurd values so callers can fall back explicitly. */
export async function readTokenDecimals(token: string): Promise<number> {
  const r = await ethCall(token, "0x313ce567");
  if (!r || r === "0x") throw new Error("empty decimals()");
  const n = Number(BigInt(r));
  if (!Number.isInteger(n) || n < 0 || n > 36) throw new Error("implausible decimals()");
  return n;
}

async function erc20Allowance(token: string, owner: string, spender: string): Promise<bigint> {
  const r = await ethCall(token, "0xdd62ed3e" + pad(owner) + pad(spender));
  return BigInt(r || "0x0");
}

/** True/false when the Permit2 allowance read succeeds; null when allowance is unknown.
    Read-only and quote-independent: callers must treat null as blocked/retry, never sufficient. */
export async function needsPermit2Approval(sellToken: string, owner: string, needed: bigint): Promise<boolean | null> {
  if (needed <= 0n) return false;
  try { return (await erc20Allowance(sellToken, owner, PERMIT2_ADDRESS)) < needed; }
  catch { return null; } // unknown must not be interpreted as sufficient on a money path
}

export type ExecStep = "switch" | "approve" | "requote" | "sign" | "submit" | "confirm";

async function ensureChain(eth: Eth, onStep: (s: ExecStep) => void): Promise<boolean> {
  const chainId = (await eth.request({ method: "eth_chainId" })) as string;
  if (chainId?.toLowerCase() === SPOT_CHAIN_ID_HEX) return true;
  onStep("switch");
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SPOT_CHAIN_ID_HEX }] });
  } catch (e) {
    if ((e as { code?: number }).code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: SPOT_CHAIN_ID_HEX, chainName: SPOT_CHAIN_NAME, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: [SPOT_RPC_URL] }],
      });
    } else throw e;
  }
  return false;
}

async function assertActiveAccount(eth: Eth, expected: string): Promise<void> {
  const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
  if (!accounts?.[0] || accounts[0].toLowerCase() !== expected.toLowerCase()) {
    throw new Error("the active wallet account changed — reconnect and review the trade");
  }
}

export class SpotApprovalRequiredError extends Error {
  constructor() {
    super("Permit2 approval is required before signing this swap");
    this.name = "SpotApprovalRequiredError";
  }
}

export class SpotIntentExpiredError extends Error {
  constructor() {
    super("the signed quote expired — sign a fresh quote to continue");
    this.name = "SpotIntentExpiredError";
  }
}

export class SpotIntentConsumedError extends Error {
  constructor() {
    super("this signed intent was already used - sign a fresh quote to continue");
    this.name = "SpotIntentConsumedError";
  }
}

export class SpotSubmissionRejectedError extends Error {
  constructor() {
    super("transaction cancelled in the wallet - sign a fresh quote to continue");
    this.name = "SpotSubmissionRejectedError";
  }
}

export class SpotSubmissionUnknownError extends Error {
  readonly hash?: string;
  constructor(hash?: string) {
    super("transaction status is unknown - do not retry this signed intent");
    this.name = "SpotSubmissionUnknownError";
    this.hash = hash;
  }
}
export class SpotApprovalUnknownError extends Error {
  readonly hash?: string;
  constructor(hash?: string) {
    super("approval status is unknown - check wallet activity before retrying");
    this.name = "SpotApprovalUnknownError";
    this.hash = hash;
  }
}

export class SpotApprovalRevertedError extends Error {
  readonly hash: string;
  constructor(hash: string) {
    super("approval reverted on-chain");
    this.name = "SpotApprovalRevertedError";
    this.hash = hash;
  }
}

export class SpotSubmissionRevertedError extends Error {
  readonly hash: string;
  constructor(hash: string) {
    super("swap reverted on-chain - no swap was completed");
    this.name = "SpotSubmissionRevertedError";
    this.hash = hash;
  }
}

export type TransactionOutcome = "pending" | "success" | "reverted" | "unknown";


function userRejected(error: unknown): boolean {
  return (error as { code?: number })?.code === 4001;
}

// A signed payload becomes one-shot immediately before eth_sendTransaction. This prevents a
// rejection, provider disconnect, malformed response, or double-click from replaying the same RFQ.
const consumedPreparedSwaps = new WeakSet<object>();
const submittingPreparedSwaps = new WeakSet<object>();

export type PreparedSpotSwap = Readonly<{
  from: string;
  to: string;
  data: string;
  quoteId: string;
  venue: "rialto";
  feeBps: number;
  feeSignedBps: number;
  feeAmountDecimal: string;
  feeSymbol: string;
  feeSide: SpotExecutionFee["side"];
  feeRecipient: string;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  expiresAtMs: number;
}>;

async function assertApproval(from: string, sellToken: string, needed: bigint): Promise<void> {
  const allow = await erc20Allowance(sellToken, from, PERMIT2_ADDRESS);
  if (allow < needed) throw new SpotApprovalRequiredError();
}

/** Standalone one-time Permit2 approval (its own wallet interaction). Split out so the UI can run
    it on its OWN click: a wallet won't auto-surface a later signature that follows a slow approval
    confirmation (browser user-activation lapses), so approve and swap must be separate gestures. */
export async function approvePermit2(
  eth: Eth,
  from: string,
  sellToken: string,
  onStep: (s: ExecStep) => void,
  onBroadcast?: (hash: string) => void,
  onSendAttempt?: () => void,
): Promise<void> {
  const chainReady = await ensureChain(eth, onStep);
  if (!chainReady) throw new Error("Robinhood Chain is ready — press Approve again");
  await assertActiveAccount(eth, from);
  onStep("approve");
  onSendAttempt?.();
  let response: unknown;
  try {
    response = await eth.request({
      method: "eth_sendTransaction",
      params: [{ from, to: sellToken, data: "0x095ea7b3" + pad(PERMIT2_ADDRESS) + pad(MAX_UINT256) }],
    });
  } catch (error) {
    if (userRejected(error)) throw error;
    throw new SpotApprovalUnknownError();
  }
  const hash = String(response);
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new SpotApprovalUnknownError();
  onBroadcast?.(hash);
  await waitReceipt(hash, "approval");
}

/**
 * Phase 1 of a swap: fail-closed checks, a fresh executable RFQ, and one EIP-712 wallet prompt.
 * The signed transaction is returned to the UI but is NOT submitted here. Browser wallets may
 * queue a second prompt instead of surfacing it when sign + send happen inside one click.
 */
export async function prepareSpotSwap(
  eth: Eth,
  from: string,
  sellToken: string,
  buyToken: string,
  sellAmount: bigint,
  onStep: (s: ExecStep) => void,
  freshQuote: () => Promise<SpotQuote | null>,
  readRuntimeHash: RuntimeCodeHashReader = readRuntimeCodeHash,
): Promise<PreparedSpotSwap> {
  const routePin = readRialtoDirectRoutePin(sellToken, buyToken);
  if (!routePin) throw new Error("Rialto direct route is outside the audited allowlist");
  const chainReady = await ensureChain(eth, onStep);
  if (!chainReady) {
    throw new Error("Robinhood Chain is ready — press Swap again to sign");
  }
  await assertActiveAccount(eth, from);
  if (sellAmount <= 0n) throw new Error("invalid sell amount");

  // Read-only and fail-closed: this phase must never trigger an approval transaction and then
  // silently chain another wallet prompt. The ticket exposes approval as its own user action.
  await assertApproval(from, sellToken, sellAmount);

  onStep("requote");
  const quote = await freshQuote();
  if (!quote) throw new Error("could not refresh the quote — check your connection and press Swap again");
  if (!quote.toSign || !quote.tx?.data) {
    throw new Error("Arcus did not return an executable quote — wait a moment and press Swap again");
  }

  const fee = validateSpotExecutionIntent({ quote, taker: from, sellToken, buyToken, sellAmount });
  const to = quote.tx.to;
  const calldata = quote.tx.data;
  const typedDataJson = JSON.stringify(quote.toSign);
  const [routerRuntimeHash, targetRuntimeHash] = await Promise.all([
    readRuntimeHash(SPOT_SETTLEMENT_ROUTER_ADDRESS),
    readRuntimeHash(routePin.target),
  ]);
  if (routerRuntimeHash.toLowerCase() !== RIALTO_ROUTER_RUNTIME_CODE_HASH) {
    throw new Error("Rialto router runtime changed - execution is blocked pending review");
  }
  if (targetRuntimeHash.toLowerCase() !== routePin.runtimeCodeHash) {
    throw new Error("Rialto action target runtime changed - execution is blocked pending review");
  }
  const deadline = (quote.toSign as { message: { deadline: string | number | bigint } }).message.deadline;
  const expiresAtMs = Number(BigInt(deadline)) * 1000;
  if (!Number.isSafeInteger(expiresAtMs)) throw new Error("quote deadline is malformed");

  onStep("sign");
  const signature = String(await eth.request({
    method: "eth_signTypedData_v4",
    params: [from, typedDataJson],
  }));
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("wallet returned a malformed signature");

  const slot = calldata.toLowerCase().indexOf(SIG_PLACEHOLDER);
  const data = calldata.slice(0, slot) + signature.slice(2) + calldata.slice(slot + SIG_PLACEHOLDER.length);
  return Object.freeze({
    from,
    to,
    data,
    quoteId: quote.quoteId,
    sellAmount: quote.sellAmount,
    venue: "rialto",
    feeSignedBps: fee.signedBps,
    feeAmountDecimal: fee.amountDecimal,
    feeSymbol: fee.symbol,
    feeBps: fee.totalBps,
    feeSide: fee.side,
    feeRecipient: fee.recipient,
    buyAmount: quote.buyAmount,
    minBuyAmount: quote.minBuyAmount,
    expiresAtMs,
  });
}

const SUBMIT_EXPIRY_BUFFER_MS = 10_000;

/**
 * Phase 2 of a swap. Call this directly from a fresh button click so the wallet surfaces the
 * on-chain confirmation instead of leaving it behind the extension badge.
 */
export async function submitPreparedSpotSwap(
  eth: Eth,
  prepared: PreparedSpotSwap,
  onStep: (s: ExecStep) => void,
  onBroadcast?: (hash: string) => void,
  onSendAttempt?: () => void,
): Promise<{ ok: true; hash: string }> {
  if (consumedPreparedSwaps.has(prepared) || submittingPreparedSwaps.has(prepared)) {
    throw new SpotIntentConsumedError();
  }
  if (Date.now() + SUBMIT_EXPIRY_BUFFER_MS >= prepared.expiresAtMs) {
    throw new SpotIntentExpiredError();
  }

  submittingPreparedSwaps.add(prepared);
  try {
    const chainReady = await ensureChain(eth, onStep);
    if (!chainReady) throw new Error("Robinhood Chain is ready — press Confirm transaction again");
    await assertActiveAccount(eth, prepared.from);

    onSendAttempt?.();
    consumedPreparedSwaps.add(prepared);

    onStep("submit");
    let response: unknown;
    try {
      response = await eth.request({
        method: "eth_sendTransaction",
        params: [{ from: prepared.from, to: prepared.to, data: prepared.data }],
      });
    } catch (error) {
      if (userRejected(error)) throw new SpotSubmissionRejectedError();
      throw new SpotSubmissionUnknownError();
    }
    const hash = String(response);
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new SpotSubmissionUnknownError();

    onBroadcast?.(hash);
    onStep("confirm");
    await waitReceipt(hash, "swap");
    return { ok: true, hash };
  } finally {
    submittingPreparedSwaps.delete(prepared);
  }
}

export async function readTransactionOutcome(hash: string): Promise<TransactionOutcome> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return "unknown";
  try {
    const receipt = await rpc<{ status?: string } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt == null) return "pending";
    if (receipt.status === "0x1") return "success";
    if (receipt.status === "0x0") return "reverted";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function waitReceipt(hash: string, what: "approval" | "swap", timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (true) {
    const r = await rpc<{ status?: string } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) {
      if (r.status === "0x0") {
        throw what === "swap" ? new SpotSubmissionRevertedError(hash) : new SpotApprovalRevertedError(hash);
      }
      if (r.status === "0x1") return;
      if (what === "swap") throw new SpotSubmissionUnknownError(hash);
      throw new SpotApprovalUnknownError(hash);
    }
    if (Date.now() - start > timeoutMs) {
      if (what === "swap") throw new SpotSubmissionUnknownError(hash);
      throw new SpotApprovalUnknownError(hash);
    }
    await new Promise((res) => setTimeout(res, 2500));
  }
}
