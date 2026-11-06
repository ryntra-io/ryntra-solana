/**
 * CITY-174 — the agent's route through Jupiter: Swap API V2 `/build` (Metis), for the vault as taker.
 *
 * `/build` answers with raw instructions and the agent assembles the transaction itself (`./agent.ts`), so the swap can
 * run inside the person's policy; `/execute` accepts only what `/order` built and is never asked (skill
 * `jupiter-truth`). The request is shaped for the mandate: the vault is the taker, the agent pays fees and rent, the
 * output goes straight to the person's token account, SOL stays wrapped (the budget is wSOL), slippage is the policy's,
 * Ryntra's fee is the platform fee into Ryntra's fee account at the table's rate for the pair (CITY-183, `./fee.ts`) —
 * a person's swap's lane exactly — and the route is held to 40–50 accounts — the wrapper adds 3–4 accounts and 140–200
 * bytes (CITY-136 §4).
 *
 * The answer is read and bounded: one Jupiter `route_v2` or `shared_accounts_route_v2` whose authority is the vault and
 * whose output lands on the person's account, the requested amount and fee, setup that only opens token accounts the
 * agent pays for, no cleanup, no tip, nothing else. Nothing here signs or sends. Jupiter is not deployed on devnet: this lane is mainnet's (CITY-186) — the
 * agent's buys (`jupiterVenue`) and, with CITY-195, the person's sales of what it bought (`jupiterSaleVenue`).
 */

import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { PublicKey, type AddressLookupTableAccount, type Connection, type TransactionInstruction } from "@solana/web3.js";

import type { SideFacts } from "../core/fee-policy.ts";
import { JUPITER_SWAP_V2_BASE_URL, asAmount, asInteger, asObject, asText, readBoundedJson, type JupiterSwapEndpointSelection } from "../solana/quotes.ts";
import { apiInstruction, type ApiInstruction } from "./agent.ts";
import { agentFeeAccount, feeAccountRefusal, pairFeeBps, type FeeSides } from "./fee.ts";
import { jupiterFeeOf } from "./result.ts";
import { JUPITER_PROGRAM_ID, ROUTE_V2, SHARED_ACCOUNTS_ROUTE_V2, SLIPPAGE_MAX_BPS, LAYOUT, feeMintOf } from "./terms.ts";
import type { Mandate } from "./human.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "./ssa.ts";
import { TOKEN_2022_PROGRAM_ID, readCoin } from "./token-2022.ts";
import { receivedIn, type Venue } from "./tick.server.ts";

const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export const AGENT_MAX_ACCOUNTS = Object.freeze({ min: 40, max: 50, default: 48 });

/**
 * The venues the vault cannot trade through (CITY-201), by Jupiter's labels, asked as `excludeDexes`. Manifest's swap
 * writes to its taker (rent for the trader's seat), and Jupiter lists the taker read-only, trusting it to be the
 * transaction's writable fee payer; the vault signs through the policy's CPI with exactly the privileges listed, so
 * a route through Manifest ends in `PrivilegeEscalation` and the agent's buy or the person's sale never lands. Found on
 * the mainnet fork on 5.11: BTC (`C5xph2…pump`) for 0.02 SOL went 100 % through Manifest; without it, the same pass
 * bought, sold and stopped (`docs/research/city-201-qa/REPORT.md`).
 */
export const AGENT_EXCLUDED_DEXES = Object.freeze(["Manifest"]);

export type AgentRouteRequest = Readonly<{
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint;
  vault: PublicKey;
  agent: PublicKey;
  /** The person's token account of the output mint. */
  receiver: PublicKey;
  slippageBps: number;
  /** Ryntra's platform fee: the table's rate and Ryntra's fee account of the mint it is taken in (`feeMintOf`). */
  fee: Readonly<{ bps: number; account: PublicKey }>;
  maxAccounts?: number;
}>;

export type AgentRoute = Readonly<{
  swap: TransactionInstruction;
  setup: readonly TransactionInstruction[];
  lookupTableAddresses: readonly PublicKey[];
  inAmount: bigint;
  outAmount: bigint;
  minOut: bigint;
  labels: readonly string[];
}>;

export type AgentRouteResult = Readonly<{ ok: true; route: AgentRoute }> | Readonly<{ ok: false; reason: string; status: number | null }>;

const isRoute = (data: Uint8Array) => [ROUTE_V2, SHARED_ACCOUNTS_ROUTE_V2].some((disc) => disc.every((byte, index) => data[index] === byte));

/** Read and bound `/build`'s answer against the request; throws with the reason the answer cannot be used. */
export function readAgentRoute(body: unknown, request: AgentRouteRequest): AgentRoute {
  const raw = asObject(body, "build");
  if (asText(raw.inputMint, "inputMint", 44) !== request.inputMint.toBase58() || asText(raw.outputMint, "outputMint", 44) !== request.outputMint.toBase58()) throw new Error("the route's mints are not the requested ones");
  if (BigInt(asAmount(raw.inAmount, "inAmount")) !== request.amount) throw new Error("the route's amount is not the requested one");
  if (asText(raw.swapMode, "swapMode", 16) !== "ExactIn") throw new Error("the route is not ExactIn");
  if (asInteger(raw.slippageBps, "slippageBps", 10_000) > request.slippageBps) throw new Error("the route allows more slippage than the mandate");
  for (const field of ["cleanupInstruction", "tipInstruction"]) if (raw[field] !== null && raw[field] !== undefined) throw new Error(`the route carries a ${field} it was not asked for`);
  if (Array.isArray(raw.otherInstructions) && raw.otherInstructions.length > 0) throw new Error("the route carries other instructions");

  const swap = apiInstruction(raw.swapInstruction as ApiInstruction);
  if (!swap.programId.equals(JUPITER_PROGRAM_ID) || !isRoute(swap.data)) throw new Error("the swap is not a Jupiter route_v2 or shared_accounts_route_v2");
  const shared = SHARED_ACCOUNTS_ROUTE_V2.every((byte, index) => swap.data[index] === byte);
  const authority = swap.keys[shared ? LAYOUT.sharedRouteV2.authority : LAYOUT.routeV2.authority]?.pubkey;
  if (!authority?.equals(request.vault)) throw new Error("the swap's authority is not the vault");
  const receiver = swap.keys[shared ? LAYOUT.sharedRouteV2.receiver : LAYOUT.routeV2.receiver]?.pubkey;
  if (!receiver?.equals(request.receiver)) throw new Error("the swap's output does not land on the person's account");
  const fee = jupiterFeeOf({ programId: swap.programId, accounts: swap.keys.map((key) => key.pubkey), data: swap.data });
  if (!fee || fee.bps !== request.fee.bps || !fee.account?.equals(request.fee.account)) throw new Error("the swap does not pay Ryntra's fee as asked");
  if (fee.positiveSlippageBps !== 0) throw new Error("the swap takes positive slippage");

  const setupRaw = Array.isArray(raw.setupInstructions) ? (raw.setupInstructions as ApiInstruction[]) : [];
  if (setupRaw.length > 6) throw new Error("too many setup instructions");
  const setup = setupRaw.map((entry) => {
    if (entry.programId !== ASSOCIATED_TOKEN_PROGRAM) throw new Error("setup other than opening token accounts");
    const instruction = apiInstruction(entry);
    if (!instruction.keys[0]?.pubkey.equals(request.agent)) throw new Error("setup the agent does not pay for");
    return instruction;
  });
  const tables = raw.addressesByLookupTableAddress;
  const lookupTableAddresses = tables && typeof tables === "object" ? Object.keys(tables as object).map((key) => new PublicKey(key)) : [];
  if (lookupTableAddresses.length > 8) throw new Error("too many lookup tables");
  const plan = Array.isArray(raw.routePlan) ? (raw.routePlan as { swapInfo?: { label?: unknown } }[]) : [];
  return {
    swap,
    setup,
    lookupTableAddresses,
    inAmount: request.amount,
    outAmount: BigInt(asAmount(raw.outAmount, "outAmount")),
    minOut: BigInt(asAmount(raw.otherAmountThreshold, "otherAmountThreshold")),
    labels: plan.map((step) => (typeof step.swapInfo?.label === "string" ? step.swapInfo.label.slice(0, 64) : "?")),
  };
}

/** The query `/build` is asked, exactly. */
export function agentRouteQuery(request: AgentRouteRequest): URLSearchParams {
  const maxAccounts = request.maxAccounts ?? AGENT_MAX_ACCOUNTS.default;
  if (!Number.isInteger(maxAccounts) || maxAccounts < AGENT_MAX_ACCOUNTS.min || maxAccounts > AGENT_MAX_ACCOUNTS.max) throw new Error("the route is held to 40–50 accounts");
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 1 || request.slippageBps > SLIPPAGE_MAX_BPS) throw new Error("slippage is at most 1 %");
  if (request.amount <= 0n) throw new Error("the amount is above zero");
  if (!Number.isInteger(request.fee.bps) || request.fee.bps <= 0 || request.fee.bps >= 10_000) throw new Error("the fee is a whole number of basis points above zero");
  return new URLSearchParams({
    inputMint: request.inputMint.toBase58(),
    outputMint: request.outputMint.toBase58(),
    amount: request.amount.toString(),
    taker: request.vault.toBase58(),
    payer: request.agent.toBase58(),
    destinationTokenAccount: request.receiver.toBase58(),
    slippageBps: String(request.slippageBps),
    wrapAndUnwrapSol: "false",
    maxAccounts: String(maxAccounts),
    platformFeeBps: String(request.fee.bps),
    feeAccount: request.fee.account.toBase58(),
    excludeDexes: AGENT_EXCLUDED_DEXES.join(","),
  });
}

/** Ask `/build` once for the agent's route. */
export async function fetchAgentRoute(
  request: AgentRouteRequest,
  selection: JupiterSwapEndpointSelection,
  dependencies: Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number }> = {},
): Promise<AgentRouteResult> {
  if (!selection.ok) return { ok: false, reason: selection.reason, status: null };
  let query: URLSearchParams;
  try {
    query = agentRouteQuery(request);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "malformed request", status: null };
  }
  let response: Response;
  try {
    response = await (dependencies.fetchImpl ?? fetch)(`${JUPITER_SWAP_V2_BASE_URL}/build?${query}`, {
      method: "GET",
      headers: selection.authorizationHeaders(),
      signal: AbortSignal.timeout(dependencies.timeoutMs ?? 8_000),
    });
  } catch {
    return { ok: false, reason: "Jupiter did not answer in time", status: null };
  }
  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch {
    return { ok: false, reason: "Jupiter's answer is unreadable", status: response.status };
  }
  if (!response.ok) {
    const stated = typeof (body as { error?: unknown })?.error === "string" ? String((body as { error: string }).error).slice(0, 200) : `HTTP ${response.status}`;
    return { ok: false, reason: response.status === 429 ? "Jupiter is rate-limiting; the agent waits" : `Jupiter refused the route: ${stated}`, status: response.status };
  }
  try {
    return { ok: true, route: readAgentRoute(body, request) };
  } catch (error) {
    return { ok: false, reason: `Jupiter's route cannot run under the mandate: ${error instanceof Error ? error.message : "unknown shape"}`, status: response.status };
  }
}

type JupiterDependencies = Readonly<{ fetchImpl?: typeof fetch; timeoutMs?: number; sides?: (mint: string) => Promise<SideFacts | null> }>;

/** One side's facts as a person's swap reads them (`../core/solana-swap/fee-route.server.ts`), loaded on first use. */
const swapSide = async (mint: string): Promise<SideFacts | null> => (await import("../core/solana-swap/fee-route.server.ts")).readSideFacts(mint);

/** Exactly `amount` of `coin` quoted back into the budget's token at the price now: `/order` without a taker builds nothing. */
export async function jupiterWorth(input: Readonly<{ coin: PublicKey; budgetMint: PublicKey; amount: bigint }>, selection: JupiterSwapEndpointSelection, dependencies: JupiterDependencies = {}): Promise<bigint> {
  if (!selection.ok) throw new Error(selection.reason);
  const query = new URLSearchParams({ inputMint: input.coin.toBase58(), outputMint: input.budgetMint.toBase58(), amount: input.amount.toString() });
  const response = await (dependencies.fetchImpl ?? fetch)(`${JUPITER_SWAP_V2_BASE_URL}/order?${query}`, {
    method: "GET",
    headers: selection.authorizationHeaders(),
    signal: AbortSignal.timeout(dependencies.timeoutMs ?? 8_000),
  });
  if (!response.ok) throw new Error(`Jupiter did not quote: HTTP ${response.status}`);
  const body = asObject(await readBoundedJson(response), "order");
  if (BigInt(asAmount(body.inAmount, "inAmount")) !== input.amount) throw new Error("the quote is not for the coins asked");
  return BigInt(asAmount(body.outAmount, "outAmount"));
}

/**
 * Jupiter's route for the vault under a mandate, ready to wrap: asked, read, its lookup tables read from the chain, and the
 * person's receiving account opened at the agent's cost when neither she nor the route has it — Jupiter opens the vault's
 * account of the output, never `destinationTokenAccount` (seen on the fork). Shared by the agent's buys and her sales.
 */
async function routeUnderMandate(
  connection: Connection,
  selection: JupiterSwapEndpointSelection,
  dependencies: JupiterDependencies,
  input: Readonly<{ mandate: Mandate; outputMint: PublicKey; outputProgram: PublicKey; amount: bigint; receiver: PublicKey; fee: Readonly<{ bps: number; account: PublicKey }> }>,
): Promise<Readonly<{ route: AgentRoute; setup: readonly TransactionInstruction[]; lookupTables: readonly AddressLookupTableAccount[] }>> {
  const { mandate } = input;
  const answer = await fetchAgentRoute(
    { inputMint: mandate.terms.budgetMint, outputMint: input.outputMint, amount: input.amount, vault: mandate.vault, agent: mandate.terms.agent, receiver: input.receiver, slippageBps: mandate.terms.slippageBps, fee: input.fee },
    selection,
    dependencies,
  );
  if (!answer.ok) throw new Error(answer.reason);
  const tables = await Promise.all(answer.route.lookupTableAddresses.map((address) => connection.getAddressLookupTable(address)));
  const lookupTables = tables.map((table) => table.value).filter((table): table is AddressLookupTableAccount => table !== null);
  if (lookupTables.length !== tables.length) throw new Error("a lookup table of the route is not on chain");
  const hers = answer.route.setup.some((instruction) => instruction.keys[1]?.pubkey.equals(input.receiver)) || (await connection.getAccountInfo(input.receiver, "confirmed")) !== null;
  const setup = hers ? answer.route.setup : [createAssociatedTokenAccountIdempotentInstruction(mandate.terms.agent, input.receiver, mandate.terms.human, input.outputMint, input.outputProgram), ...answer.route.setup];
  return { route: answer.route, setup, lookupTables };
}

/** The mainnet venue, as the fork runs it: Jupiter's route for the vault, the lookup tables it names read from the chain. */
export function jupiterVenue(connection: Connection, selection: JupiterSwapEndpointSelection, dependencies: JupiterDependencies = {}): Venue {
  return {
    async buy(mandate, amount, receiver, coin) {
      /* CITY-184: a coin of Token-2022 on either side only with every feature of its mint on the agent's list — said before a route is asked. */
      const [coinMint, budgetMint] = await connection.getMultipleAccountsInfo([coin, mandate.terms.budgetMint], "confirmed");
      /* A transfer fee's rate is the epoch's: read once, for the judgement here and the signer's count. */
      const epoch = [coinMint, budgetMint].some((info) => info?.owner.equals(TOKEN_2022_PROGRAM_ID)) ? BigInt((await connection.getEpochInfo("confirmed")).epoch) : undefined;
      const bought = readCoin(coin, coinMint, epoch);
      if (!bought.ok) throw new Error(bought.reason);
      const sold = readCoin(mandate.terms.budgetMint, budgetMint, epoch);
      if (!sold.ok) throw new Error(sold.reason);
      const read = dependencies.sides ?? swapSide;
      const [input, output] = await Promise.all([read(mandate.terms.budgetMint.toBase58()), read(coin.toBase58())]);
      const feeSides: FeeSides = { input, output, nowMs: Date.now() };
      const feeBps = pairFeeBps(mandate.terms.budgetMint.toBase58(), coin.toBase58(), feeSides);
      if (feeBps === null) throw new Error("the agent does not trade this pair: Ryntra's table names no router fee for it");
      /* A sale takes the fee in what she receives, as a person's own swap does when the input is no fee mint (`buildFeeSide`). */
      const feeMint = feeMintOf(mandate.terms);
      const fee = { bps: feeBps, account: agentFeeAccount(feeMint) };
      const feeAccount = feeAccountRefusal(await connection.getAccountInfo(fee.account, "confirmed"), feeMint);
      if (feeAccount) throw new Error(feeAccount);
      const { route, setup, lookupTables } = await routeUnderMandate(connection, selection, dependencies, { mandate, outputMint: coin, outputProgram: bought.coin.program, amount, receiver, fee });
      return { instruction: route.swap, setup, promisedOut: route.outAmount, feeSides, lookupTables, coin: bought.coin, ...(epoch === undefined ? {} : { epoch }) };
    },
    received: (signature, receiver) => receivedIn(connection, signature, receiver),
    worth: (mandate, amount, coin) => jupiterWorth({ coin, budgetMint: mandate.terms.budgetMint, amount }, selection, dependencies),
  };
}

/** A sale's route through Jupiter, built for the agent to sign: what `agentTrade` takes, and Jupiter's own quote. */
export type JupiterSale = Readonly<{
  instruction: TransactionInstruction;
  setup: readonly TransactionInstruction[];
  lookupTables: readonly AddressLookupTableAccount[];
  /** Jupiter's quote after Ryntra's fee, lamports — the route's `quotedOut`. */
  quoteOut: bigint;
  feeSides: FeeSides;
  /** The chain's epoch, read when the coin is one of Token-2022 (its transfer fee's rate is the epoch's). */
  epoch?: bigint;
}>;

/**
 * CITY-195 — the person's sale through Jupiter on mainnet: the coin from her vault, SOL to her own account of wSOL, Ryntra's
 * fee in that SOL inside the route (CITY-184) — the same lane, the same rules and the same fee account as every buy.
 */
export type JupiterSaleVenue = Readonly<{
  kind: "jupiter";
  /** The catalogue's facts of the pair, coin into SOL, as a person's own swap reads them. */
  sides(coin: PublicKey): Promise<FeeSides>;
  /** SOL for exactly `amount` of the coin at the price now, before Ryntra's fee, lamports; throws when not read. */
  quote(coin: PublicKey, amount: bigint): Promise<bigint>;
  /** Jupiter's route of the sale's mandate: exactly its size, SOL to `receiver`, Ryntra's fee at `feeBps` — built, not sent. */
  sell(mandate: Mandate, receiver: PublicKey, feeBps: number, feeSides: FeeSides): Promise<JupiterSale>;
  /** What landed on `receiver` in that transaction; null when not read. */
  received(signature: string, receiver: PublicKey): Promise<bigint | null>;
}>;

export function jupiterSaleVenue(connection: Connection, selection: JupiterSwapEndpointSelection, dependencies: JupiterDependencies = {}): JupiterSaleVenue {
  return {
    kind: "jupiter",
    async sides(coin) {
      const read = dependencies.sides ?? swapSide;
      const [input, output] = await Promise.all([read(coin.toBase58()), read(NATIVE_MINT.toBase58())]);
      return { input, output, nowMs: Date.now() };
    },
    quote: (coin, amount) => jupiterWorth({ coin, budgetMint: NATIVE_MINT, amount }, selection, dependencies),
    async sell(mandate, receiver, feeBps, feeSides) {
      const fixed = mandate.terms.fixedBuy;
      if (!mandate.terms.budgetCoin || !fixed || !fixed.outputMint.equals(NATIVE_MINT) || mandate.terms.venue.kind !== "jupiter") throw new Error("not a sale through Jupiter");
      const coinMint = await connection.getAccountInfo(mandate.terms.budgetMint, "confirmed");
      const epoch = coinMint?.owner.equals(TOKEN_2022_PROGRAM_ID) ? BigInt((await connection.getEpochInfo("confirmed")).epoch) : undefined;
      const coin = readCoin(mandate.terms.budgetMint, coinMint, epoch);
      if (!coin.ok) throw new Error(coin.reason);
      const fee = { bps: feeBps, account: agentFeeAccount(NATIVE_MINT) };
      const feeAccount = feeAccountRefusal(await connection.getAccountInfo(fee.account, "confirmed"), NATIVE_MINT);
      if (feeAccount) throw new Error(feeAccount);
      const { route, setup, lookupTables } = await routeUnderMandate(connection, selection, dependencies, { mandate, outputMint: NATIVE_MINT, outputProgram: TOKEN_PROGRAM_ID, amount: fixed.amountIn, receiver, fee });
      return { instruction: route.swap, setup, lookupTables, quoteOut: route.outAmount, feeSides, ...(epoch === undefined ? {} : { epoch }) };
    },
    received: (signature, receiver) => receivedIn(connection, signature, receiver),
  };
}
