/**
 * Jupiter Trigger V1 for the limits lane: build an order or a cancellation,
 * prove it by reading the transaction and simulating it, relay the signed
 * bytes, and list a wallet's orders.
 *
 * Why V1 and not V2: V2 keeps the deposit in a custodial vault and pays no
 * integrator fee (Jupiter's own docs, 2026-10); V1 keeps it in a program
 * account of this order alone and takes `feeBps` into a referral token
 * account.
 */

import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";

import { classifyPair, DOLLAR_MINTS, type FeeFlow } from "../../core/fee-policy.ts";
import { feePolicyInForce, flowOfSwap } from "../../core/solana-swap/fee-route.server.ts";
import { resolveJupiterCatalogEndpoint } from "../quotes.ts";
import { limitsConnection, triggerReferralFeeAccount, type ReferralFeeAccount } from "./chain.server.ts";
import {
  base58,
  TRIGGER_V1_BASE_URL,
  TRIGGER_V1_JUPITER_FEE_BPS,
  triggerFeePlan,
  triggerFeeRaw,
  type LimitAmounts,
  type TriggerFeePlan,
} from "./model.ts";
import { decodeTriggerOrderAccount, inspectTriggerTransaction, priorityLamports } from "./trigger-tx.ts";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

export type TriggerFailure = Readonly<{ ok: false; code: string; reason: string; status?: number }>;

async function triggerCall<T>(path: string, init?: Readonly<{ method: "GET" | "POST"; body?: unknown }>): Promise<Readonly<{ ok: true; value: T }> | TriggerFailure> {
  const { apiKey } = resolveJupiterCatalogEndpoint();
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  if (init?.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${TRIGGER_V1_BASE_URL}/${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (failure) {
    return { ok: false, code: "TRIGGER_UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) return { ok: false, code: "TRIGGER_RESPONSE_TOO_LARGE", reason: "Jupiter answered with more than expected.", status: response.status };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: "TRIGGER_RESPONSE_UNREADABLE", reason: `Jupiter answered ${response.status} without JSON.`, status: response.status };
  }
  if (!response.ok) {
    const body = json as { error?: unknown; cause?: unknown };
    const words = [body.error, body.cause].filter((part) => typeof part === "string").join(": ");
    return { ok: false, code: response.status === 429 ? "TRIGGER_BUSY" : "TRIGGER_REFUSED", reason: words || `Jupiter answered ${response.status}.`, status: response.status };
  }
  return { ok: true, value: json as T };
}

/* ------------------------------------------------------------------ fees */

export type TriggerFeeContext = Readonly<{ flow: FeeFlow; plan: TriggerFeePlan; feeAccount: ReferralFeeAccount }>;

/** The pair's flow by the fee policy, the account it would be paid into, and the plan — at the owner's discount as a partner's friend, when they have one. */
export async function triggerFeeContext(amounts: LimitAmounts, deps: Readonly<{ connection?: Connection; feeDiscountBps?: number }> = {}): Promise<TriggerFeeContext> {
  const flow: FeeFlow = feePolicyInForce() === "as-now"
    ? "AS_NOW"
    : await flowOfSwap(amounts.inputMint, amounts.outputMint).catch(() => classifyPair({ inputMint: amounts.inputMint, outputMint: amounts.outputMint, input: null, output: null, nowMs: Date.now() }));
  const feeAccount = await triggerReferralFeeAccount(amounts.outputMint, { connection: deps.connection });
  const stablePair = DOLLAR_MINTS.has(amounts.inputMint) && DOLLAR_MINTS.has(amounts.outputMint);
  const plan = triggerFeePlan({ flow, stablePair, referralTokenAccount: feeAccount.ok ? feeAccount.account : null, discountBps: deps.feeDiscountBps ?? 0 });
  return { flow, plan, feeAccount };
}

/* ---------------------------------------------------------------- create */

export type TriggerOrderBuilt = Readonly<{
  ok: true;
  requestId: string;
  transactionBase64: string;
  order: string;
  /** What the simulated order account holds — the chain's own word on the fee. */
  onChain: Readonly<{ feeBps: number; feeAccount: string; makingRaw: string; takingRaw: string; expiredAt: number | null }>;
  /** Ryntra's and Jupiter's fee, raw units of the output, if the whole order fills. */
  ryntraFeeRaw: string;
  jupiterFeeRaw: string;
  networkFeeLamports: number;
  /** Rent the order's accounts hold while it is open, returned when it closes; null when the balance could not be read. */
  depositLamports: number | null;
}>;

/**
 * Ask Jupiter for the order, read every instruction against the plan, and
 * simulate it with the order account returned: the fee Review shows is the fee
 * the program wrote, not the one that was asked for.
 */
export async function buildTriggerOrder(
  args: Readonly<{ owner: string; amounts: LimitAmounts; plan: TriggerFeePlan; expiredAt?: number | null }>,
  deps: Readonly<{ connection?: Connection }> = {},
): Promise<TriggerOrderBuilt | TriggerFailure> {
  const { owner, amounts, plan } = args;
  const params: Record<string, string> = { makingAmount: amounts.makingRaw, takingAmount: amounts.takingRaw };
  if (plan.feeBpsParam !== null) params.feeBps = String(plan.feeBpsParam);
  if (args.expiredAt) params.expiredAt = String(args.expiredAt);
  const body: Record<string, unknown> = {
    inputMint: amounts.inputMint,
    outputMint: amounts.outputMint,
    maker: owner,
    payer: owner,
    params,
    computeUnitPrice: "auto",
    wrapAndUnwrapSol: true,
  };
  if (plan.feeAccount) body.feeAccount = plan.feeAccount;
  const created = await triggerCall<{ requestId?: string; transaction?: string; order?: string }>("createOrder", { method: "POST", body });
  if (!created.ok) return created;
  const { requestId, transaction, order } = created.value;
  if (!requestId || !transaction || !order) return { ok: false, code: "TRIGGER_RESPONSE_INCOMPLETE", reason: "Jupiter's order came back without its transaction." };

  const verdict = inspectTriggerTransaction(transaction, {
    kind: "create",
    owner,
    inputMint: amounts.inputMint,
    outputMint: amounts.outputMint,
    makingRaw: amounts.makingRaw,
    takingRaw: amounts.takingRaw,
    feeAccount: plan.feeAccount,
    feeBps: plan.feeBpsParam,
  });
  if (!verdict.ok) return { ok: false, code: "TRIGGER_TRANSACTION_REFUSED", reason: verdict.reason };
  if (verdict.order !== order) return { ok: false, code: "TRIGGER_TRANSACTION_REFUSED", reason: "The order account differs from the one Jupiter named." };

  const connection = deps.connection ?? limitsConnection();
  const before = await connection.getBalance(new PublicKey(owner), "confirmed").catch(() => null);
  const simulated = await connection.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(transaction, "base64")), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [order, owner] },
  }).catch((failure: unknown) => ({ failure }));
  if ("failure" in simulated) return { ok: false, code: "SIMULATION_UNAVAILABLE", reason: simulated.failure instanceof Error ? simulated.failure.message : String(simulated.failure) };
  if (simulated.value.err) {
    const logs = (simulated.value.logs ?? []).filter((line) => /Error|insufficient/i.test(line)).slice(0, 2).join(" ");
    return { ok: false, code: "SIMULATION_FAILED", reason: logs || JSON.stringify(simulated.value.err) };
  }
  const account = simulated.value.accounts?.[0];
  const data = account && Array.isArray(account.data) ? Buffer.from(account.data[0], "base64") : null;
  const decoded = data ? decodeTriggerOrderAccount(data) : null;
  if (!decoded || decoded.maker !== owner || decoded.makingRaw !== amounts.makingRaw || decoded.takingRaw !== amounts.takingRaw) {
    return { ok: false, code: "SIMULATION_UNREADABLE", reason: "The simulated order could not be read back." };
  }
  const networkFeeLamports = 5_000 + Number(priorityLamports(VersionedTransaction.deserialize(Buffer.from(transaction, "base64"))));
  const after = simulated.value.accounts?.[1]?.lamports;
  /* What the wallet's SOL drops by beyond the network fee and any SOL the order itself spends: the rent of the order's accounts, returned when the order closes. */
  const wrapped = amounts.inputMint === "So11111111111111111111111111111111111111112" ? Number(amounts.makingRaw) : 0;
  const depositLamports = before !== null && typeof after === "number" ? Math.max(0, before - after - networkFeeLamports - wrapped) : null;
  const ryntraBps = plan.feeAccount !== null && decoded.feeAccount === plan.feeAccount ? decoded.feeBps : 0;
  if (plan.feeAccount !== null && ryntraBps !== plan.ryntraBps) return { ok: false, code: "FEE_MISMATCH", reason: "The program wrote another fee than reviewed." };
  const jupiterBps = ryntraBps > 0 ? 0 : decoded.feeBps;
  if (ryntraBps === 0 && jupiterBps > TRIGGER_V1_JUPITER_FEE_BPS.normal) return { ok: false, code: "FEE_MISMATCH", reason: "Jupiter's fee is above its documented rate." };
  return {
    ok: true,
    requestId,
    transactionBase64: transaction,
    order,
    onChain: { feeBps: decoded.feeBps, feeAccount: decoded.feeAccount, makingRaw: decoded.makingRaw, takingRaw: decoded.takingRaw, expiredAt: decoded.expiredAt },
    ryntraFeeRaw: triggerFeeRaw(amounts.takingRaw, ryntraBps),
    jupiterFeeRaw: triggerFeeRaw(amounts.takingRaw, jupiterBps),
    networkFeeLamports,
    depositLamports,
  };
}

/* ---------------------------------------------------------------- cancel */

export async function buildTriggerCancel(
  args: Readonly<{ owner: string; order: string }>,
): Promise<Readonly<{ ok: true; requestId: string; transactionBase64: string }> | TriggerFailure> {
  const built = await triggerCall<{ requestId?: string; transaction?: string }>("cancelOrder", {
    method: "POST",
    body: { maker: args.owner, order: args.order, computeUnitPrice: "auto" },
  });
  if (!built.ok) return built;
  const { requestId, transaction } = built.value;
  if (!requestId || !transaction) return { ok: false, code: "TRIGGER_RESPONSE_INCOMPLETE", reason: "Jupiter's cancellation came back without its transaction." };
  const verdict = inspectTriggerTransaction(transaction, { kind: "cancel", owner: args.owner, order: args.order });
  if (!verdict.ok) return { ok: false, code: "TRIGGER_TRANSACTION_REFUSED", reason: verdict.reason };
  return { ok: true, requestId, transactionBase64: transaction };
}

/* --------------------------------------------------------------- execute */

/** Relay the signed bytes through Jupiter's `/execute`, which lands and confirms them. */
export async function executeTrigger(
  args: Readonly<{ requestId: string; signedTransactionBase64: string }>,
): Promise<Readonly<{ ok: true; signature: string; status: "Success" | "Failed"; reason: string | null }> | TriggerFailure> {
  const executed = await triggerCall<{ signature?: string; status?: string; error?: string; code?: number }>("execute", {
    method: "POST",
    body: { requestId: args.requestId, signedTransaction: args.signedTransactionBase64 },
  });
  if (!executed.ok) return executed;
  const { signature, status, error } = executed.value;
  if (!signature) return { ok: false, code: "TRIGGER_RESPONSE_INCOMPLETE", reason: error ?? "Jupiter did not return a signature." };
  return { ok: true, signature, status: status === "Success" ? "Success" : "Failed", reason: status === "Success" ? null : (error ?? null) };
}

/** The signature a signed transaction carries, base58 — known before the relay answers. */
export function signatureOf(signedTransactionBase64: string): string | null {
  try {
    const transaction = VersionedTransaction.deserialize(Buffer.from(signedTransactionBase64, "base64"));
    const first = transaction.signatures[0];
    if (!first || first.every((byte) => byte === 0)) return null;
    return base58(first);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- orders */

export type TriggerTrade = Readonly<{
  action: string;
  inputRaw: string;
  outputRaw: string;
  feeRaw: string;
  feeMint: string;
  signature: string;
  confirmedAt: string;
}>;

export type TriggerOrderRow = Readonly<{
  order: string;
  inputMint: string;
  outputMint: string;
  makingRaw: string;
  takingRaw: string;
  remainingMakingRaw: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiredAt: string | null;
  openTx: string | null;
  closeTx: string | null;
  trades: readonly TriggerTrade[];
}>;

type RawTriggerOrder = {
  orderKey?: string;
  inputMint?: string;
  outputMint?: string;
  rawMakingAmount?: string;
  rawTakingAmount?: string;
  rawRemainingMakingAmount?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  expiredAt?: string | null;
  openTx?: string | null;
  closeTx?: string | null;
  trades?: Array<{ action?: string; rawInputAmount?: string; rawOutputAmount?: string; rawFeeAmount?: string; feeMint?: string; txId?: string; confirmedAt?: string }>;
};

export function normalizeTriggerOrder(raw: RawTriggerOrder): TriggerOrderRow | null {
  if (!raw.orderKey || !raw.inputMint || !raw.outputMint || !raw.rawMakingAmount || !raw.rawTakingAmount) return null;
  return {
    order: raw.orderKey,
    inputMint: raw.inputMint,
    outputMint: raw.outputMint,
    makingRaw: raw.rawMakingAmount,
    takingRaw: raw.rawTakingAmount,
    remainingMakingRaw: raw.rawRemainingMakingAmount ?? raw.rawMakingAmount,
    status: raw.status ?? "Unknown",
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? raw.createdAt ?? "",
    expiredAt: raw.expiredAt ?? null,
    openTx: raw.openTx?.trim() || null,
    closeTx: raw.closeTx?.trim() || null,
    trades: (raw.trades ?? [])
      .filter((trade) => trade.txId && trade.rawOutputAmount)
      .map((trade) => ({
        action: trade.action ?? "Fill",
        inputRaw: trade.rawInputAmount ?? "0",
        outputRaw: trade.rawOutputAmount ?? "0",
        feeRaw: trade.rawFeeAmount ?? "0",
        feeMint: trade.feeMint ?? "",
        signature: (trade.txId ?? "").trim(),
        confirmedAt: trade.confirmedAt ?? "",
      })),
  };
}

/** A wallet's open orders, or its history: the first page, newest first. */
export async function listTriggerOrders(
  owner: string,
  status: "active" | "history",
): Promise<Readonly<{ ok: true; orders: readonly TriggerOrderRow[] }> | TriggerFailure> {
  const query = new URLSearchParams({ user: owner, orderStatus: status, page: "1" });
  if (status === "history") query.set("includeFailedTx", "false");
  const listed = await triggerCall<{ orders?: RawTriggerOrder[] }>(`getTriggerOrders?${query.toString()}`);
  if (!listed.ok) return listed;
  const orders = (listed.value.orders ?? []).map(normalizeTriggerOrder).filter((row): row is TriggerOrderRow => row !== null);
  return { ok: true, orders };
}
