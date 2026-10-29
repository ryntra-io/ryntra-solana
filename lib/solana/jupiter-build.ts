/**
 * Jupiter Swap API V2 `/build` — the router lane of fee policy v2.
 *
 * `/build` answers with a Metis quote and the raw instructions of the swap;
 * this deployment assembles the transaction itself. Jupiter takes no fee on
 * this lane, and Ryntra's fee is the swap instruction's own platform fee —
 * `platformFeeBps` paid into `feeAccount`, the fee wallet's canonical token
 * account for the fee mint — so the fee lands whole, in the same transaction,
 * with no transfer of Ryntra's added.
 *
 * Two answers, one shape. A quote (`fetchJupiterBuildQuote`) asks with a
 * stand-in taker and carries no bytes: the card prices before anyone
 * connects. An order (`buildJupiterOrder`) asks for the person's own wallet,
 * sizes the compute budget by one simulation of the assembled bytes, caps the
 * priority fee and returns a `JupiterExecutableOrder` with
 * `path: "BUILD_SUBMIT"` — the same order every guard step already checks,
 * whose bytes go out once through this deployment's own RPC and never to
 * `/execute`, which accepts only transactions `/order` built.
 *
 * Nothing here signs, sends or retries. A refusal is the venue's answer,
 * carried as it came; a shape this file cannot vouch for is refused, never
 * repaired.
 */

import { randomUUID } from "node:crypto";

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";

import { serviceFeeAbsent, serviceFeeQuoted, type RyntraServiceFee } from "../swap/service-fee.ts";
import { JUPITER_ORDER_RETRY_WAIT_MAX_MS, jupiterRetryWaitMs, noteJupiterResponse } from "./jupiter-budget.ts";
import {
  JUPITER_ORDER_REVIEW_WINDOW_MS,
  JUPITER_ORDER_SLIPPAGE_MAX_BPS,
  JUPITER_SWAP_V2_BASE_URL,
  JupiterResponseReadError,
  MAX_ROUTE_HOPS,
  NO_ROUTE_CODES,
  asAmount,
  asInteger,
  asObject,
  asText,
  readBoundedJson,
  type JupiterExecutableOrder,
  type JupiterExecutableOrderFailure,
  type JupiterOrderQuote,
  type JupiterRouteHop,
  type JupiterSwapEndpointSelection,
} from "./quotes.ts";
import { withRpcDiscipline, type SolanaRpcHandle } from "./rpc.ts";

export const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** The stand-in taker a read-only quote is built for: the system program, which holds nothing and signs nothing. */
export const BUILD_QUOTE_STAND_IN_TAKER = "11111111111111111111111111111111";

/** Solana's ceiling on compute units per transaction. */
export const COMPUTE_UNIT_LIMIT_MAX = 1_400_000;

/**
 * The most priority fee a Ryntra-built swap pays, in lamports — 0.0003 SOL.
 *
 * Jupiter's own estimate follows recent fees and spikes when a block carries a
 * transaction bidding an extreme price; its documentation says to validate it
 * before signing. A price over this ceiling is clamped, never passed through.
 */
export const PRIORITY_FEE_CEILING_LAMPORTS = 300_000n;

/** Lamports per signature, Solana's base fee. */
const SIGNATURE_FEE_LAMPORTS = 5_000;

/** Rent of a plain 165-byte token account — the estimate a Review starts from; the effect firewall proves the exact figure. */
const TOKEN_ACCOUNT_RENT_ESTIMATE = 2_039_280;

/** Solana's packet ceiling for a serialized transaction. */
const MAX_TRANSACTION_BYTES = 1_232;

/** Ryntra's fee on one `/build` swap: the rate, the side and the account it is paid into. */
export type JupiterBuildFee = Readonly<{
  bps: number;
  side: "INPUT" | "OUTPUT";
  mint: string;
  /** The fee wallet. */
  owner: string;
  /** The fee wallet's canonical token account for `mint` — the `feeAccount` Jupiter pays. */
  account: string;
  decimals: number | null;
  symbol: string | null;
}>;

export type JupiterBuildRequest = Readonly<{
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  /** The wallet that signs; null asks for a read-only quote under the stand-in taker. */
  taker: string | null;
  /** A fixed bound in place of Jupiter's real-time estimate — under a plan, the plan's own rule. */
  slippageBps?: number;
  /** Null asks for no fee: a dollar-to-dollar swap, or a flow whose fee cannot be carried here. */
  fee: JupiterBuildFee | null;
  /**
   * Routing held to these venues, by Jupiter's own case-sensitive labels — the
   * Exchange's second quote asks `["Manifest"]` for the order book alone (B9).
   * Absent asks every venue, as the swap lane always has.
   */
  dexes?: readonly string[];
}>;

type ApiInstruction = Readonly<{ programId: string; accounts: readonly Readonly<{ pubkey: string; isSigner: boolean; isWritable: boolean }>[]; data: string }>;

/** `/build`'s answer, read and bounded: the quote and the instructions, before anything is assembled. */
export type JupiterBuildAnswer = Readonly<{
  request: JupiterBuildRequest;
  quote: JupiterOrderQuote;
  computeBudget: readonly ApiInstruction[];
  setup: readonly ApiInstruction[];
  swap: ApiInstruction;
  cleanup: ApiInstruction | null;
  other: readonly ApiInstruction[];
  lookupTables: Readonly<Record<string, readonly string[]>>;
  blockhash: string;
  lastValidBlockHeight: string;
}>;

export type JupiterBuildResult = Readonly<{ ok: true; answer: JupiterBuildAnswer }> | JupiterExecutableOrderFailure;

const failure = (
  code: JupiterExecutableOrderFailure["code"],
  reason: string,
  extra: Partial<Pick<JupiterExecutableOrderFailure, "status" | "errorCode" | "access" | "router" | "retryWaitMs">> = {},
): JupiterExecutableOrderFailure => ({ ok: false, code, reason, errorCode: null, status: null, access: null, router: null, ...extra });

function readInstruction(value: unknown, field: string): ApiInstruction {
  const raw = asObject(value, field);
  const accounts = raw.accounts;
  if (!Array.isArray(accounts) || accounts.length > 128) throw new Error(`${field}.accounts is not a bounded list.`);
  return {
    programId: asText(raw.programId, `${field}.programId`, 44),
    accounts: accounts.map((entry, index) => {
      const account = asObject(entry, `${field}.accounts[${index}]`);
      if (typeof account.isSigner !== "boolean" || typeof account.isWritable !== "boolean") throw new Error(`${field}.accounts[${index}] flags are not boolean.`);
      return { pubkey: asText(account.pubkey, `${field}.accounts[${index}].pubkey`, 44), isSigner: account.isSigner, isWritable: account.isWritable };
    }),
    data: asText(raw.data, `${field}.data`, 4_096),
  };
}

function readInstructions(value: unknown, field: string): readonly ApiInstruction[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error(`${field} is not a bounded list.`);
  return value.map((entry, index) => readInstruction(entry, `${field}[${index}]`));
}

/** The fee as a person reviews it: exact on the input side, the rate alone on the output side until the chain says. */
export function buildServiceFee(request: JupiterBuildRequest): RyntraServiceFee {
  const fee = request.fee;
  if (!fee || fee.bps <= 0) return serviceFeeAbsent("Dollar to dollar: Ryntra charges no fee on this swap.");
  return serviceFeeQuoted("JUPITER_PLATFORM_FEE", {
    basisPoints: fee.bps,
    requestedBasisPoints: fee.bps,
    asset: fee.mint,
    symbol: fee.symbol,
    decimals: fee.decimals,
    /* On the input side the program takes floor(amount × bps / 10 000) of the amount typed — exact before the signature. */
    amountRaw: fee.side === "INPUT" ? ((BigInt(request.amountRaw) * BigInt(fee.bps)) / 10_000n).toString() : null,
    providerRetainedPercent: 0,
  });
}

function routeOf(routePlan: unknown): readonly JupiterRouteHop[] {
  if (!Array.isArray(routePlan) || routePlan.length === 0 || routePlan.length > MAX_ROUTE_HOPS) {
    throw new Error(`routePlan must be a non-empty array with at most ${MAX_ROUTE_HOPS} hops.`);
  }
  return routePlan.map((candidate, index) => {
    const hop = asObject(candidate, `routePlan[${index}]`);
    const swap = asObject(hop.swapInfo, `routePlan[${index}].swapInfo`);
    return {
      ammKey: asText(swap.ammKey, `routePlan[${index}].ammKey`, 44),
      label: asText(swap.label, `routePlan[${index}].label`, 96),
      inputMint: asText(swap.inputMint, `routePlan[${index}].inputMint`, 44),
      outputMint: asText(swap.outputMint, `routePlan[${index}].outputMint`, 44),
      inAmountRaw: asAmount(swap.inAmount, `routePlan[${index}].inAmount`),
      outAmountRaw: asAmount(swap.outAmount, `routePlan[${index}].outAmount`),
      basisPoints: asInteger(hop.bps, `routePlan[${index}].bps`, 10_000),
    };
  });
}

/**
 * Ask `/build` once. The answer is read, bounded and checked against the
 * request — the mints, the amount, ExactIn, the fee account inside the swap
 * instruction — and nothing is assembled yet.
 */
export async function fetchJupiterBuild(
  request: JupiterBuildRequest,
  selection: JupiterSwapEndpointSelection,
  dependencies: Readonly<{ fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number; reviewWindowMs?: number }> = {},
): Promise<JupiterBuildResult> {
  if (!selection.ok) return failure("MALFORMED", selection.reason);
  const pinnedBuildUrl = `${JUPITER_SWAP_V2_BASE_URL}/build` as const;
  if (selection.baseUrl !== JUPITER_SWAP_V2_BASE_URL || selection.buildUrl !== pinnedBuildUrl || selection.access !== "production" || selection.tier !== "pro") {
    return failure("MALFORMED", "The /build lane runs on the keyed production endpoint only.", { access: selection.access });
  }
  const slippageBps = request.slippageBps;
  if (slippageBps !== undefined && (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > JUPITER_ORDER_SLIPPAGE_MAX_BPS)) {
    return failure("MALFORMED", `The slippage bound must be a whole number of basis points between 1 and ${JUPITER_ORDER_SLIPPAGE_MAX_BPS}.`, { access: selection.access });
  }
  const fee = request.fee && request.fee.bps > 0 ? request.fee : null;
  if (fee && (!Number.isInteger(fee.bps) || fee.bps >= 10_000)) return failure("MALFORMED", "The fee rate is not a whole number of basis points.", { access: selection.access });

  const taker = request.taker ?? BUILD_QUOTE_STAND_IN_TAKER;
  const url = new URL(pinnedBuildUrl);
  url.searchParams.set("inputMint", request.inputMint);
  url.searchParams.set("outputMint", request.outputMint);
  url.searchParams.set("amount", request.amountRaw);
  url.searchParams.set("taker", taker);
  /* Jupiter's real-time estimate unless a person's rule names a bound. */
  url.searchParams.set("slippageBps", slippageBps !== undefined ? String(slippageBps) : "rtse");
  const routeAffectingOptions = [slippageBps !== undefined ? `slippageBps=${slippageBps}` : "slippageBps=rtse"];
  if (request.dexes && request.dexes.length > 0) {
    url.searchParams.set("dexes", request.dexes.join(","));
    routeAffectingOptions.push(`dexes=${request.dexes.join(",")}`);
  }
  if (fee) {
    url.searchParams.set("platformFeeBps", String(fee.bps));
    url.searchParams.set("feeAccount", fee.account);
    routeAffectingOptions.push(`platformFeeBps=${fee.bps}`, "feeAccount=set");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers: selection.authorizationHeaders(), signal: AbortSignal.timeout(dependencies.timeoutMs ?? 8_000) });
  } catch {
    return failure("UNREACHABLE", "Jupiter did not answer within the request deadline.", { access: selection.access });
  }
  noteJupiterResponse(response.headers, "shared");
  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch (cause) {
    return failure("MALFORMED", cause instanceof JupiterResponseReadError ? cause.message : "Jupiter returned unreadable or malformed JSON.", { status: response.status, access: selection.access });
  }
  const rawBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const stated = typeof rawBody.error === "string" && rawBody.error.length > 0 && rawBody.error.length <= 300 ? rawBody.error : null;
  if (!response.ok) {
    if (response.status === 429) {
      return failure("RATE_LIMITED", `${selection.label} was rate-limited. Refreshing later asks for a new order; no fallback ran.`, {
        status: 429,
        access: selection.access,
        retryWaitMs: jupiterRetryWaitMs(response.headers, Date.now(), JUPITER_ORDER_RETRY_WAIT_MAX_MS),
      });
    }
    const errorCode = typeof rawBody.errorCode === "string" && /^[A-Z0-9_:-]{1,96}$/.test(rawBody.errorCode) ? rawBody.errorCode : null;
    if ((errorCode && NO_ROUTE_CODES.has(errorCode)) || (stated !== null && /no routes? found/i.test(stated))) {
      return failure("NO_ROUTE", "Jupiter's router found no route for this pair at this amount.", { status: response.status, access: selection.access, errorCode });
    }
    return failure(response.status >= 500 ? "HTTP_ERROR" : "REFUSED", stated ? `Jupiter refused the build with HTTP ${response.status}: ${stated}` : `Jupiter refused the build with HTTP ${response.status}.`, {
      status: response.status,
      access: selection.access,
      errorCode,
    });
  }

  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  try {
    const raw = asObject(body, "build");
    const inputMint = asText(raw.inputMint, "inputMint", 44);
    const outputMint = asText(raw.outputMint, "outputMint", 44);
    const inAmountRaw = asAmount(raw.inAmount, "inAmount");
    if (inputMint !== request.inputMint || outputMint !== request.outputMint) throw new Error("the build's mints are not the requested mints.");
    if (inAmountRaw !== request.amountRaw) throw new Error("the build's input amount is not the requested amount.");
    const swapMode = asText(raw.swapMode, "swapMode", 32);
    if (swapMode !== "ExactIn") throw new Error("/build is ExactIn only and answered another mode.");
    const swap = readInstruction(raw.swapInstruction, "swapInstruction");
    if (swap.programId !== JUPITER_V6_PROGRAM) throw new Error("the swap instruction is not Jupiter's program.");
    if (fee && !swap.accounts.some((account) => account.pubkey === fee.account && account.isWritable && !account.isSigner)) {
      throw new Error("the swap instruction does not pay the fee account it was asked to.");
    }
    const blockhashMeta = asObject(raw.blockhashWithMetadata, "blockhashWithMetadata");
    const blockhashBytes = blockhashMeta.blockhash;
    if (!Array.isArray(blockhashBytes) || blockhashBytes.length !== 32 || !blockhashBytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new Error("blockhashWithMetadata.blockhash is not 32 bytes.");
    }
    const lookupRaw = raw.addressesByLookupTableAddress;
    const lookupTables: Record<string, readonly string[]> = {};
    if (lookupRaw !== null && lookupRaw !== undefined) {
      const tables = asObject(lookupRaw, "addressesByLookupTableAddress");
      if (Object.keys(tables).length > 16) throw new Error("too many lookup tables.");
      for (const [key, addresses] of Object.entries(tables)) {
        if (!Array.isArray(addresses) || addresses.length > 256) throw new Error("a lookup table is not a bounded list.");
        lookupTables[asText(key, "lookup table", 44)] = addresses.map((entry, index) => asText(entry, `lookup[${index}]`, 44));
      }
    }
    if (raw.tipInstruction !== null && raw.tipInstruction !== undefined) throw new Error("a tip was not asked for and must not be paid.");
    const route = routeOf(raw.routePlan);
    const reviewWindowMs = dependencies.reviewWindowMs ?? JUPITER_ORDER_REVIEW_WINDOW_MS;
    const ryntraFee = buildServiceFee(request);
    const quote: JupiterOrderQuote = {
      schema: "ryntra.solana.jupiter-order-quote",
      schemaVersion: "1.0.0",
      provider: "jupiter",
      path: "BUILD_SUBMIT",
      access: "production",
      tier: "pro",
      execution: "NOT_EXECUTED",
      swapType: "build",
      swapMode,
      router: "metis",
      mode: "build",
      inputMint,
      outputMint,
      inAmountRaw,
      outAmountRaw: asAmount(raw.outAmount, "outAmount"),
      minReceivedRaw: asAmount(raw.otherAmountThreshold, "otherAmountThreshold"),
      slippageBps: asInteger(raw.slippageBps, "slippageBps", 10_000),
      priceImpactPct: asText(raw.priceImpactPct, "priceImpactPct", 128),
      /* `/build` states no dollar figures; none are invented here. */
      inUsdValue: null,
      outUsdValue: null,
      swapUsdValue: null,
      /* Jupiter charges nothing on this lane: the total is Ryntra's fee alone, in its mint. */
      totalFeeBasisPoints: ryntraFee.basisPoints,
      totalFeeMint: fee?.mint ?? inputMint,
      platformFee: { basisPoints: 0, mint: fee?.mint ?? inputMint, amountRaw: "0" },
      providerFee: { basisPoints: null, mint: null, amountRaw: null },
      ryntraFee,
      providerReferralAccount: null,
      ...(fee ? { ryntraFeeAccount: { owner: fee.owner, account: fee.account } } : {}),
      signatureFeeLamports: String(SIGNATURE_FEE_LAMPORTS),
      signatureFeePayer: request.taker,
      /* Sized when the bytes are assembled for the person's wallet. */
      priorityFeeLamports: "0",
      priorityFeePayer: request.taker,
      rentFeeLamports: "0",
      rentFeePayer: null,
      gasless: false,
      guaranteedPrice: false,
      jitOptimized: false,
      route,
      routeAffectingOptions,
      requestId: `build:${randomUUID()}`,
      taker: null,
      transactionBase64: null,
      providerExpiresAt: null,
      reviewExpiresAt: new Date(Date.parse(observedAt) + reviewWindowMs).toISOString(),
      latencyMs: Date.now() - started,
      observedAt,
      source: {
        ref: `jupiter:mainnet:swap-v2:build:${inputMint}->${outputMint}`,
        label: `Jupiter Swap API V2, keyed production — the /build router lane (${url.host})`,
      },
    };
    return {
      ok: true,
      answer: {
        request,
        quote,
        computeBudget: readInstructions(raw.computeBudgetInstructions, "computeBudgetInstructions"),
        setup: readInstructions(raw.setupInstructions, "setupInstructions"),
        swap,
        cleanup: raw.cleanupInstruction === null || raw.cleanupInstruction === undefined ? null : readInstruction(raw.cleanupInstruction, "cleanupInstruction"),
        other: readInstructions(raw.otherInstructions, "otherInstructions"),
        lookupTables,
        blockhash: getBase58Decoder().decode(Uint8Array.from(blockhashBytes as number[])),
        lastValidBlockHeight: String(asInteger(blockhashMeta.lastValidBlockHeight, "lastValidBlockHeight")),
      },
    };
  } catch (cause) {
    return failure("MALFORMED", `Jupiter's /build answered 200 with a shape this version cannot vouch for: ${cause instanceof Error ? cause.message : "unknown shape"}`, {
      status: response.status,
      access: selection.access,
    });
  }
}

/* ------------------------------------------------------------ assembly */

function toInstruction(entry: ApiInstruction): Instruction {
  return {
    programAddress: address(entry.programId),
    accounts: entry.accounts.map((account) => ({
      address: address(account.pubkey),
      role: account.isSigner
        ? account.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : account.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: Uint8Array.from(Buffer.from(entry.data, "base64")),
  };
}

function computeUnitLimit(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: address(COMPUTE_BUDGET_PROGRAM), accounts: [], data };
}

function computeUnitPrice(microLamports: bigint): Instruction {
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, microLamports, true);
  return { programAddress: address(COMPUTE_BUDGET_PROGRAM), accounts: [], data };
}

/** The compute-unit price Jupiter named, in micro-lamports; zero when it named none. */
export function statedComputeUnitPrice(computeBudget: readonly ApiInstruction[]): bigint {
  for (const entry of computeBudget) {
    if (entry.programId !== COMPUTE_BUDGET_PROGRAM) throw new Error("A compute-budget instruction names another program.");
    const data = Buffer.from(entry.data, "base64");
    if (data[0] === 3 && data.length === 9) return data.readBigUInt64LE(1);
  }
  return 0n;
}

/** The price clamped so the priority fee at this limit stays under the ceiling. */
export function cappedComputeUnitPrice(stated: bigint, limit: number): bigint {
  const ceiling = (PRIORITY_FEE_CEILING_LAMPORTS * 1_000_000n) / BigInt(limit);
  return stated > ceiling ? ceiling : stated;
}

/** Lamports a price and a limit cost, rounded up as the runtime rounds. */
export function priorityFeeLamports(microLamports: bigint, limit: number): bigint {
  return (microLamports * BigInt(limit) + 999_999n) / 1_000_000n;
}

function assemble(answer: JupiterBuildAnswer, taker: string, limit: number, microLamports: bigint): string {
  const instructions: Instruction[] = [
    computeUnitLimit(limit),
    ...(microLamports > 0n ? [computeUnitPrice(microLamports)] : []),
    ...answer.setup.map(toInstruction),
    toInstruction(answer.swap),
    ...(answer.cleanup ? [toInstruction(answer.cleanup)] : []),
    ...answer.other.map(toInstruction),
  ];
  const tables = Object.fromEntries(Object.entries(answer.lookupTables).map(([key, addresses]) => [address(key), addresses.map((entry) => address(entry))])) as Record<Address, Address[]>;
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
    (draft) => setTransactionMessageFeePayer(address(taker), draft),
    (draft) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: answer.blockhash as Blockhash, lastValidBlockHeight: BigInt(answer.lastValidBlockHeight) }, draft),
    (draft) => compressTransactionMessageUsingAddressLookupTables(draft, tables),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

/** The token accounts the setup instructions open, by the associated-token program's own account list. */
function openedAccounts(answer: JupiterBuildAnswer): readonly string[] {
  return answer.setup.filter((entry) => entry.programId === ASSOCIATED_TOKEN_PROGRAM && entry.accounts.length >= 2).map((entry) => entry.accounts[1].pubkey);
}

/**
 * The person's order from a `/build` answer: the bytes assembled for their
 * wallet, the compute budget sized by one simulation of those bytes (×1.2,
 * capped at Solana's ceiling), the priority fee clamped, the rent of every
 * account the setup opens that does not exist yet estimated as a plain token
 * account — the effect firewall then proves the exact figure, as it does for
 * `/order`.
 */
export async function assembleJupiterBuildOrder(
  answer: JupiterBuildAnswer,
  handle: SolanaRpcHandle,
): Promise<Readonly<{ ok: true; order: JupiterExecutableOrder }> | JupiterExecutableOrderFailure> {
  const taker = answer.request.taker;
  if (!taker) return failure("MALFORMED", "A read-only quote has no wallet to assemble a transaction for.");
  if (answer.setup.concat(answer.other, answer.cleanup ? [answer.cleanup] : [], [answer.swap]).some((entry) => entry.accounts.some((account) => account.isSigner && account.pubkey !== taker))) {
    return failure("MALFORMED", "The build names a signer other than the person's wallet.");
  }
  try {
    const stated = statedComputeUnitPrice(answer.computeBudget);
    const probe = assemble(answer, taker, COMPUTE_UNIT_LIMIT_MAX, 0n);
    const simulated = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.simulateTransaction(probe as never, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send({ abortSignal }),
    );
    if (simulated.value.err !== null && simulated.value.err !== undefined) {
      const err = JSON.stringify(simulated.value.err, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry)).slice(0, 300);
      return failure("BUILD_FAILED", `The assembled swap does not simulate for this wallet: ${err}.`, { router: "metis" });
    }
    const used = Number(simulated.value.unitsConsumed ?? 0);
    if (!Number.isSafeInteger(used) || used <= 0) return failure("BUILD_FAILED", "The simulation did not say how much compute the swap uses.", { router: "metis" });
    const limit = Math.min(COMPUTE_UNIT_LIMIT_MAX, Math.ceil(used * 1.2));
    const price = cappedComputeUnitPrice(stated, limit);
    const wire = assemble(answer, taker, limit, price);
    if (Buffer.from(wire, "base64").length > MAX_TRANSACTION_BYTES) return failure("BUILD_FAILED", "The assembled swap is larger than a Solana transaction may be.", { router: "metis" });

    const opened = openedAccounts(answer);
    let rent = 0;
    if (opened.length > 0) {
      const accounts = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getMultipleAccounts(opened as never, { encoding: "base64", commitment: "confirmed" }).send({ abortSignal }),
      );
      const closed = new Set(answer.cleanup ? answer.cleanup.accounts.map((account) => account.pubkey) : []);
      opened.forEach((account, index) => {
        if (accounts.value[index] === null && !closed.has(account)) rent += TOKEN_ACCOUNT_RENT_ESTIMATE;
      });
    }
    return {
      ok: true,
      order: {
        ...answer.quote,
        schema: "ryntra.solana.jupiter-executable-order",
        execution: "EXECUTABLE_NOT_SUBMITTED",
        taker,
        transactionBase64: wire,
        lastValidBlockHeight: answer.lastValidBlockHeight,
        priorityFeeLamports: priorityFeeLamports(price, limit).toString(),
        rentFeeLamports: String(rent),
        rentFeePayer: rent > 0 ? taker : null,
      },
    };
  } catch (cause) {
    return failure("BUILD_FAILED", `The swap could not be assembled: ${cause instanceof Error ? cause.message : String(cause)}`, { router: "metis" });
  }
}
