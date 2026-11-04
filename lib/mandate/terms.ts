/**
 * CITY-174 — the mandate's terms and the policy they become (decision 95, the template of CITY-136's report §8).
 *
 * A person says, once: this budget, this much a trade, this much a day, until then. The terms become one
 * ProgramInteraction policy on her smart account, held by the program itself:
 * - only Jupiter's `route_v2` and `shared_accounts_route_v2` (on devnet, where Jupiter is not deployed, one Meteora DLMM
 *   pool's `swap2` stands in — the same rules, CITY-136 §7);
 * - the vault signs, and it spends only from the budget's token account;
 * - the output lands only on a token account the person owns;
 * - the input is at most the trade cap, slippage at most 1 %, the budget's mint at most the day's cap, until the end;
 * - Ryntra's fee (CITY-183, `./fee.ts`) lands only in Ryntra's fee account, at most the table's highest rate: in Jupiter's
 *   fee slot, or — on devnet — a transfer from the budget to that account and nowhere else.
 *
 * A regular buy of a fixed size (decision 95 (b)) pins more: the input is exactly the size, the output mint is pinned,
 * and the quote may not fall under the person's floor — the highest price she pays, held on chain.
 *
 * CITY-184 — coins of Token-2022 (every coin of Ryntra's launchpad): the person's and the vault's accounts are token
 * accounts of either token program, read by their owner field; a regular buy pins her account of its coin by address,
 * under the coin's own program. Which Token-2022 coins the agent trades at all is the signer's list (`./token-2022.ts`).
 * A person may also hand the agent a coin to sell (`budgetCoin`): a regular sale through Jupiter, exactly its size each
 * time for at least her floor in SOL or USDC, to her wallet. The floor — the lowest price she takes, held on chain — is
 * what bounds a sale; Ryntra's fee is then taken in what she receives, into the same fee accounts as every buy.
 *
 * CITY-187 — a sale from the tower's window runs on devnet too: through the gate's DLMM pool, for a coin of Token. There,
 * as in every devnet trade, Ryntra's fee is the transfer just before the pool's swap, from the budget — the coin sold — into
 * Ryntra's account of that coin, the table's share of the same size; through Jupiter it stays in what she receives.
 *
 * New agents start small (decision 95 (a)): the starter caps below bound what a stolen agent key could ever take in a
 * day. Raising them is the person's own, separate choice.
 */

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { AGENT_FEE_CEILING_BPS, FEE_TRANSFER_TAG, agentFeeAccount, agentFeeRaw } from "./fee.ts";
import { USDC_MINTS, isTokenProgram } from "./token-2022.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, type AccountConstraint, type DataConstraint, type InstructionConstraint, type ProgramInteractionPolicy } from "./ssa.ts";

export const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
export const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

export const ROUTE_V2 = Uint8Array.of(187, 100, 250, 204, 49, 196, 175, 20);
export const SHARED_ACCOUNTS_ROUTE_V2 = Uint8Array.of(209, 152, 83, 147, 124, 254, 216, 233);
export const DLMM_SWAP2 = Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136);

/**
 * Where each instruction keeps what the policy pins (read off Jupiter's IDL and live `/swap/v2/build` routes, CITY-136
 * §4; DLMM — its IDL, EXE-0 §3.1). `receiver` is the account the output finally lands on. `platformFee` and
 * `positiveSlippage` are the route's u16 rates; `feeAccount` — where the platform fee goes, the first account after the
 * instruction's own (Jupiter's on-chain IDL and live `/build` routes with `platformFeeBps`, CITY-183).
 */
export const LAYOUT = Object.freeze({
  routeV2: { authority: 0, source: 1, own: 2, receiver: 7, inAmount: 8, quotedOut: 16, slippage: 24, platformFee: 26, positiveSlippage: 28, feeAccount: 10 },
  sharedRouteV2: { authority: 1, source: 2, receiver: 5, inAmount: 9, quotedOut: 17, slippage: 25, platformFee: 27, positiveSlippage: 29, feeAccount: 12 },
  dlmmSwap2: { pool: 0, source: 4, receiver: 5, user: 10, inAmount: 8, minOut: 16 },
});

/** The slippage ceiling of every agent trade, in basis points. */
export const SLIPPAGE_MAX_BPS = 100;

export type BudgetToken = Readonly<{ symbol: "SOL" | "USDC"; mint: PublicKey; decimals: number }>;

export const BUDGET_TOKENS: readonly BudgetToken[] = Object.freeze([
  { symbol: "SOL", mint: NATIVE_MINT, decimals: 9 },
  ...USDC_MINTS.map((mint) => ({ symbol: "USDC" as const, mint, decimals: 6 })),
]);

export const budgetToken = (mint: PublicKey): BudgetToken | null => BUDGET_TOKENS.find((token) => token.mint.equals(mint)) ?? null;

export type Caps = Readonly<{ perTrade: bigint; perDay: bigint; days: number }>;

/** What a new agent may hold: small enough that a stolen key takes at most a day's starter cap. */
export const STARTER_CAPS: Readonly<Record<BudgetToken["symbol"], Caps>> = Object.freeze({
  SOL: { perTrade: 100_000_000n, perDay: 500_000_000n, days: 30 },
  USDC: { perTrade: 10_000_000n, perDay: 50_000_000n, days: 30 },
});

/** The ceiling of a raised mandate — the person's own choice, made separately from the first signature. */
export const RAISED_CAPS: Readonly<Record<BudgetToken["symbol"], Caps>> = Object.freeze({
  SOL: { perTrade: 1_000_000_000n, perDay: 5_000_000_000n, days: 90 },
  USDC: { perTrade: 100_000_000n, perDay: 500_000_000n, days: 90 },
});

export type Venue = Readonly<{ kind: "jupiter" }> | Readonly<{ kind: "dlmm"; pool: PublicKey }>;

/**
 * A regular buy of a fixed size: exactly `amountIn` of the budget for at least `minOut` of `outputMint`, each time.
 * `outputProgram` — the coin's token program (CITY-184); absent — Token's.
 */
export type FixedBuy = Readonly<{ amountIn: bigint; outputMint: PublicKey; minOut: bigint; outputProgram?: PublicKey | undefined }>;

/**
 * A budget that is a coin to sell rather than SOL or USDC (CITY-184): its token program and decimals, read from its mint;
 * `transferFee` — the coin withholds a fee on transfers (`./token-2022.ts`).
 */
export type BudgetCoin = Readonly<{ program: PublicKey; decimals: number; transferFee?: boolean | undefined }>;

export type MandateTerms = Readonly<{
  /** The person: her wallet signs the settings, and every output lands on her token accounts. */
  human: PublicKey;
  /** The agent: the policy's one signer. */
  agent: PublicKey;
  budgetMint: PublicKey;
  perTrade: bigint;
  perDay: bigint;
  slippageBps: number;
  /** Unix seconds. */
  expiresAt: bigint;
  venue: Venue;
  fixedBuy?: FixedBuy | undefined;
  /** The person raised the caps herself; absent — the starter caps hold. */
  raised?: boolean | undefined;
  /** The budget is a coin she sells (CITY-184); absent — SOL or USDC she spends. */
  budgetCoin?: BudgetCoin | undefined;
}>;

/** The token program of the budget's account. */
export const budgetProgramOf = (terms: Pick<MandateTerms, "budgetCoin">): PublicKey => terms.budgetCoin?.program ?? TOKEN_PROGRAM_ID;

/**
 * The mint Ryntra's fee is taken in: the budget's, when it is SOL or USDC; on a sale of a coin through Jupiter, what she
 * receives — SOL or USDC again, so the fee lands in the same accounts as every buy's. On devnet's pool the fee is a transfer
 * from the budget (CITY-187), so it is the coin's.
 */
export const feeMintOf = (terms: Pick<MandateTerms, "budgetMint" | "budgetCoin" | "fixedBuy" | "venue">): PublicKey =>
  terms.budgetCoin && terms.fixedBuy && terms.venue.kind === "jupiter" ? terms.fixedBuy.outputMint : terms.budgetMint;

/** Why a sale of a coin is not one the engine writes; null when it is. */
function saleRefusal(terms: MandateTerms, coin: BudgetCoin, nowSeconds: bigint): string | null {
  if (budgetToken(terms.budgetMint)) return "SOL or USDC is a budget to spend, not a coin to sell";
  if (!isTokenProgram(coin.program)) return "the coin is a token of the token programs";
  if (!Number.isInteger(coin.decimals) || coin.decimals < 0 || coin.decimals > 18) return "the coin's decimals are not a coin's";
  if (terms.venue.kind !== "jupiter" && !coin.program.equals(TOKEN_PROGRAM_ID)) return "a coin is sold through Jupiter, or on devnet's pool when it is a coin of Token";
  const fixed = terms.fixedBuy;
  if (!fixed) return "a sale names its size and the lowest price she takes";
  if (!budgetToken(fixed.outputMint) || (fixed.outputProgram && !fixed.outputProgram.equals(TOKEN_PROGRAM_ID))) return "a sale is paid in SOL or USDC";
  if (terms.human.equals(terms.agent)) return "the agent's key is not the person's wallet";
  if (terms.perTrade <= 0n || terms.perDay <= 0n) return "the caps are above zero";
  if (terms.perTrade > terms.perDay) return "a trade is at most the day's cap";
  if (fixed.amountIn <= 0n || fixed.amountIn > terms.perTrade) return "a sale is within the trade cap";
  if (fixed.minOut <= 0n) return "a sale names its floor";
  if (!Number.isInteger(terms.slippageBps) || terms.slippageBps < 1 || terms.slippageBps > SLIPPAGE_MAX_BPS) return "slippage is at most 1 %";
  if (terms.expiresAt <= nowSeconds) return "the mandate ends in the future";
  const days = (terms.raised ? RAISED_CAPS : STARTER_CAPS).SOL.days;
  if (terms.expiresAt - nowSeconds > BigInt(days) * 86_400n) return `the mandate lasts at most ${days} days`;
  return null;
}

/** Why the terms are not a mandate the engine writes; null when they are. */
export function termsRefusal(terms: MandateTerms, nowSeconds: bigint): string | null {
  if (terms.budgetCoin) return saleRefusal(terms, terms.budgetCoin, nowSeconds);
  const token = budgetToken(terms.budgetMint);
  if (!token) return "the budget is SOL or USDC";
  if (terms.human.equals(terms.agent)) return "the agent's key is not the person's wallet";
  const caps = (terms.raised ? RAISED_CAPS : STARTER_CAPS)[token.symbol];
  if (terms.perTrade <= 0n || terms.perDay <= 0n) return "the caps are above zero";
  if (terms.perTrade > terms.perDay) return "a trade is at most the day's cap";
  if (terms.perTrade > caps.perTrade) return terms.raised ? "the trade cap is above the raised ceiling" : "a new agent starts with a smaller trade cap";
  if (terms.perDay > caps.perDay) return terms.raised ? "the day's cap is above the raised ceiling" : "a new agent starts with a smaller day's cap";
  if (!Number.isInteger(terms.slippageBps) || terms.slippageBps < 1 || terms.slippageBps > SLIPPAGE_MAX_BPS) return "slippage is at most 1 %";
  if (terms.expiresAt <= nowSeconds) return "the mandate ends in the future";
  if (terms.expiresAt - nowSeconds > BigInt(caps.days) * 86_400n) return `the mandate lasts at most ${caps.days} days`;
  const fixed = terms.fixedBuy;
  if (fixed) {
    if (fixed.amountIn <= 0n || fixed.amountIn > terms.perTrade) return "a regular buy is within the trade cap";
    if (fixed.minOut <= 0n) return "a regular buy names its floor";
    if (fixed.outputMint.equals(terms.budgetMint)) return "a regular buy buys another token";
    if (fixed.outputProgram && !isTokenProgram(fixed.outputProgram)) return "a regular buy buys a coin of the token programs";
  }
  return null;
}

/* ------------------------------------------------------------------ constraint builders */

const keys = (index: number, ...pinned: PublicKey[]): AccountConstraint => ({ index, rule: { kind: "keys", keys: pinned }, owner: null });
const slice = (offset: number, bytes: Uint8Array): DataConstraint => ({ offset, value: { kind: "bytes", value: bytes }, operator: "equals" });
const u64 = (offset: number, value: bigint, operator: DataConstraint["operator"]): DataConstraint => ({ offset, value: { kind: "u64", value }, operator });
const u16 = (offset: number, value: number, operator: DataConstraint["operator"]): DataConstraint => ({ offset, value: { kind: "u16", value }, operator });
const u8 = (offset: number, value: number, operator: DataConstraint["operator"]): DataConstraint => ({ offset, value: { kind: "u8", value }, operator });

/**
 * A token account whose owner field is the given one. The program is left open (CITY-184): Token and Token-2022 write the
 * owner at the same place, and only a token program moves a coin into an account — an account of any other program with
 * the right bytes cannot receive one, and the trade fails.
 */
function tokenAccountOf(index: number, owner: PublicKey): AccountConstraint {
  return { index, rule: { kind: "data", constraints: [slice(32, owner.toBytes())] }, owner: null };
}

/**
 * Where the output may land. A regular buy names its mint, so the account is the person's own of that mint under its
 * program, pinned by address — the same rule as her account's data, in a third of the bytes the fee rule needs
 * (CITY-183); any other buy, a token account she owns.
 */
function receiverRule(index: number, terms: MandateTerms): AccountConstraint {
  const fixed = terms.fixedBuy;
  return fixed ? keys(index, getAssociatedTokenAddressSync(fixed.outputMint, terms.human, true, fixed.outputProgram ?? TOKEN_PROGRAM_ID)) : tokenAccountOf(index, terms.human);
}

/** Ryntra's fee inside Jupiter's route: its fee slot holds Ryntra's account, its rate at most the table's highest. */
function jupiterFeeRules(terms: MandateTerms, at: Readonly<{ feeAccount: number; platformFee: number }>): Readonly<{ account: AccountConstraint; data: DataConstraint }> {
  return { account: keys(at.feeAccount, agentFeeAccount(feeMintOf(terms))), data: u16(at.platformFee, AGENT_FEE_CEILING_BPS, "lessThanOrEqualTo") };
}

/**
 * Ryntra's fee on devnet, as its own instruction: a `TransferChecked` from the budget's account to Ryntra's, at most the
 * table's highest share of the trade cap.
 */
function feeTransferConstraint(terms: MandateTerms, budgetAccount: PublicKey): InstructionConstraint {
  return {
    programId: TOKEN_PROGRAM_ID,
    accounts: [keys(0, budgetAccount), keys(2, agentFeeAccount(terms.budgetMint))],
    data: [u8(0, FEE_TRANSFER_TAG, "equals"), u64(1, agentFeeRaw(terms.perTrade, AGENT_FEE_CEILING_BPS), "lessThanOrEqualTo")],
  };
}

/** The accounts the policy pins, read from the terms. */
export type MandateAccounts = Readonly<{ vault: PublicKey; budgetAccount: PublicKey }>;

/**
 * The amount rules: at most the trade cap — or, for a regular buy, exactly its size and a quote at its floor. Where
 * Ryntra's fee is a transfer of its own (devnet), the swap gets the size less the fee: at most the size, the floor unchanged
 * — so the highest price she pays still holds.
 */
function amountRules(terms: MandateTerms, at: Readonly<{ inAmount: number; quotedOut: number; slippage?: number }>, floor: bigint | null, feeInside = true): DataConstraint[] {
  const fixed = terms.fixedBuy;
  return [
    fixed ? u64(at.inAmount, fixed.amountIn, feeInside ? "equals" : "lessThanOrEqualTo") : u64(at.inAmount, terms.perTrade, "lessThanOrEqualTo"),
    ...(at.slippage !== undefined ? [u16(at.slippage, terms.slippageBps, "lessThanOrEqualTo")] : []),
    ...(floor !== null ? [u64(at.quotedOut, floor, "greaterThanOrEqualTo")] : []),
  ];
}

/**
 * The quote a regular buy through Jupiter must at least carry so that, after the slippage the policy allows, the
 * output is still at the person's floor: quoted × (1 − s) ≥ minOut.
 */
export function jupiterQuoteFloor(minOut: bigint, slippageBps: number): bigint {
  const keep = 10_000n - BigInt(slippageBps);
  return (minOut * 10_000n + keep - 1n) / keep;
}

/** The policy the terms become: its instruction constraints, in the order the agent names them, and its day's cap. */
export function mandatePolicy(terms: MandateTerms, accounts: MandateAccounts): ProgramInteractionPolicy {
  const { vault, budgetAccount } = accounts;
  let constraints: InstructionConstraint[];
  if (terms.venue.kind === "jupiter") {
    const floor = terms.fixedBuy ? jupiterQuoteFloor(terms.fixedBuy.minOut, terms.slippageBps) : null;
    const route = LAYOUT.routeV2;
    const shared = LAYOUT.sharedRouteV2;
    const routeFee = jupiterFeeRules(terms, route);
    const sharedFee = jupiterFeeRules(terms, shared);
    constraints = [
      {
        programId: JUPITER_PROGRAM_ID,
        accounts: [keys(route.authority, vault), keys(route.source, budgetAccount), tokenAccountOf(route.own, vault), receiverRule(route.receiver, terms), routeFee.account],
        data: [slice(0, ROUTE_V2), ...amountRules(terms, route, floor), routeFee.data],
      },
      {
        programId: JUPITER_PROGRAM_ID,
        accounts: [keys(shared.authority, vault), keys(shared.source, budgetAccount), receiverRule(shared.receiver, terms), sharedFee.account],
        data: [slice(0, SHARED_ACCOUNTS_ROUTE_V2), ...amountRules(terms, shared, floor), sharedFee.data],
      },
    ];
  } else {
    const swap = LAYOUT.dlmmSwap2;
    /* DLMM names the minimum itself: the floor is the person's, unchanged. */
    const floor = terms.fixedBuy?.minOut ?? null;
    constraints = [
      {
        programId: DLMM_PROGRAM_ID,
        accounts: [keys(swap.pool, terms.venue.pool), keys(swap.source, budgetAccount), receiverRule(swap.receiver, terms), keys(swap.user, vault)],
        data: [slice(0, DLMM_SWAP2), ...amountRules(terms, { inAmount: swap.inAmount, quotedOut: swap.minOut }, floor, false)],
      },
      feeTransferConstraint(terms, budgetAccount),
    ];
  }
  return {
    accountIndex: 0,
    constraints,
    spendingLimits: [{ mint: terms.budgetMint, start: 0n, expiration: terms.expiresAt, period: "daily", maxPerPeriod: terms.perDay }],
  };
}

/** Which of the policy's constraints an instruction of this program and discriminator claims; null — none. */
export function constraintIndexFor(venue: Venue, programId: PublicKey, data: Uint8Array): number | null {
  const head = (disc: Uint8Array) => disc.every((byte, index) => data[index] === byte);
  if (venue.kind === "jupiter") {
    if (!programId.equals(JUPITER_PROGRAM_ID)) return null;
    if (head(ROUTE_V2)) return 0;
    if (head(SHARED_ACCOUNTS_ROUTE_V2)) return 1;
    return null;
  }
  if (programId.equals(DLMM_PROGRAM_ID) && head(DLMM_SWAP2)) return 0;
  return programId.equals(TOKEN_PROGRAM_ID) && data[0] === FEE_TRANSFER_TAG ? 1 : null;
}
