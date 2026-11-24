/**
 * The mandate's terms and the policy they become.
 *
 * A person says, once: this budget, this much a trade, this much a day, until then. The terms become one
 * ProgramInteraction policy on her smart account, held by the program itself:
 * - only Jupiter's `route_v2` and `shared_accounts_route_v2` (on devnet, where Jupiter is not deployed, one Meteora DLMM
 *   pool's `swap2` stands in — the same rules);
 * - the vault signs, and it spends only from the budget's token account;
 * - the output lands only on a token account the person owns;
 * - the input is at most the trade cap, slippage at most 1 %, the budget's mint at most the day's cap, until the end;
 * - Ryntra's fee (`./fee.ts`) lands only in Ryntra's fee account, at most the table's highest rate: in Jupiter's
 *   fee slot, or — on devnet — a transfer from the budget to that account and nowhere else.
 *
 * A regular buy of a fixed size (decision 95 (b)) pins more: the input is exactly the size, the output mint is pinned,
 * and the quote may not fall under the person's floor — the highest price she pays, held on chain.
 *
 * Coins of Token-2022 (every coin of Ryntra's launchpad): the person's and the vault's accounts are token
 * accounts of either token program, read by their owner field; a regular buy pins her account of its coin by address,
 * under the coin's own program. Which Token-2022 coins the agent trades at all is the signer's list (`./token-2022.ts`).
 * A person may also hand the agent a coin to sell (`budgetCoin`): a regular sale through Jupiter, exactly its size each
 * time for at least her floor in SOL or USDC, to her wallet. The floor — the lowest price she takes, held on chain — is
 * what bounds a sale; Ryntra's fee is then taken in what she receives, into the same fee accounts as every buy.
 *
 * A sale from the tower's window runs on devnet too: through the gate's DLMM pool, for a coin of Token. There,
 * as in every devnet trade, Ryntra's fee is the transfer just before the pool's swap, from the budget — the coin sold — into
 * Ryntra's account of that coin, the table's share of the same size; through Jupiter it stays in what she receives.
 *
 * The caps are the person's own: any day's cap, trade cap and term she signs
 * (`./budget.ts`); no starter cap of Ryntra's stands under them. What a stolen agent key could take in a day is the day's
 * cap she wrote, and only through Jupiter into her own wallet.
 *
 * The agent leaves a trade on its own: a mandate signed with a `heldCoin`
 * keeps the coin it buys in her own vault, and a second policy on the same vault (`salePolicyOf`) lets the agent sell it
 * back — through Jupiter (on devnet, the gate's pool) into her own account of the budget's token, and nowhere else. The
 * program refuses to lower any vault account of a coin its policy names no limit for (`account_tracking.rs` of the smart
 * account program): the sale's policy names the coin with a day's limit — what her day's cap buys at the price she signs
 * at, twice (`heldDailyMax`), so a stolen key sells no more of it in a day than her own day's cap brought in, and only into
 * her wallet — and names no limit of the budget's token, so no sale spends the budget; the buy's policy names no limit of
 * the coin, so no buy takes the coin. Jupiter's quote and its share of positive slippage are the route's own: a sale pins
 * the share at zero, so no quote the key writes sends what the route makes over it anywhere but to her. Her withdraw takes
 * the coin back like the budget (`./human.ts`).
 *
 * «Повторюй за гаманцем» with money: the agent repeats a leader's trades in
 * the coins she signs for (`copyCoins`) — the leader's own, read before her signature, at most `COPY_COINS_MAX`. The
 * program can let the agent sell only a coin a policy names a limit for, and only her signature writes a policy
 * (`settings_change.rs` of the smart account program allows a policy's signer to add or remove signers, change the
 * threshold or the time lock — never to create a policy), so the coins are named when she signs, not when the leader
 * buys: a coin outside them the copy passes, with its reason. Her buy's policy lands any buy in a token account of her
 * vault (the signer: only in the vault's own account of a coin of hers); its one limit is still the budget's day. Each
 * `COPY_COINS_PER_SALE` of her coins get a sale's policy of their own, the next seeds of her account, in the same approval
 * (`copySalePolicyOf`): a day's limit for each coin — its share of two day's caps at the price she signs at,
 * ÷ N (`copyDailyMax`), so the worst day with a stolen key is three day's caps however many coins she names
 * (`COPY_WORST_DAYS`) — and none of the budget's token, so no sale spends the budget and no buy takes a coin; the money
 * only to her own account of the budget's token, Ryntra's fee in it, no share of positive slippage, slippage at most 1 %.
 */

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { AGENT_FEE_CEILING_BPS, FEE_TRANSFER_TAG, agentFeeAccount, agentFeeRaw } from "./fee.ts";
import { DAYS_MAX } from "./budget.ts";
import { USDC_MINTS, isTokenProgram } from "./token-2022.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, type AccountConstraint, type DataConstraint, type InstructionConstraint, type ProgramInteractionPolicy } from "./ssa.ts";

export const JUPITER_PROGRAM_ID = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
export const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

export const ROUTE_V2 = Uint8Array.of(187, 100, 250, 204, 49, 196, 175, 20);
export const SHARED_ACCOUNTS_ROUTE_V2 = Uint8Array.of(209, 152, 83, 147, 124, 254, 216, 233);
export const DLMM_SWAP2 = Uint8Array.of(65, 75, 63, 76, 235, 91, 91, 136);

/**
 * Where each instruction keeps what the policy pins (read off Jupiter's IDL and live `/swap/v2/build` routes;
 * DLMM — its IDL, EXE-0 §3.1). `receiver` is the account the output finally lands on; `inputMint` and `outputMint` —
 * the route's two mints (the recorded routes of `./fixtures`). `platformFee` and
 * `positiveSlippage` are the route's u16 rates; `feeAccount` — where the platform fee goes, the first account after the
 * instruction's own (Jupiter's on-chain IDL and live `/build` routes with `platformFeeBps`).
 */
export const LAYOUT = Object.freeze({
  routeV2: { authority: 0, source: 1, own: 2, inputMint: 3, outputMint: 4, receiver: 7, inAmount: 8, quotedOut: 16, slippage: 24, platformFee: 26, positiveSlippage: 28, feeAccount: 10 },
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

export type Venue = Readonly<{ kind: "jupiter" }> | Readonly<{ kind: "dlmm"; pool: PublicKey }>;

/**
 * A regular buy of a fixed size: exactly `amountIn` of the budget for at least `minOut` of `outputMint`, each time.
 * `outputProgram` — the coin's token program; absent — Token's.
 */
export type FixedBuy = Readonly<{ amountIn: bigint; outputMint: PublicKey; minOut: bigint; outputProgram?: PublicKey | undefined }>;

/**
 * A budget that is a coin to sell rather than SOL or USDC: its token program and decimals, read from its mint;
 * `transferFee` — the coin withholds a fee on transfers (`./token-2022.ts`).
 */
export type BudgetCoin = Readonly<{ program: PublicKey; decimals: number; transferFee?: boolean | undefined }>;

/**
 * The coin the agent buys and keeps in her vault, so that it can sell it on its own: its mint and its token
 * program, and `dailyMax` — the most of it, base units, the sale's policy lets leave the vault in a day (`heldDailyMax`).
 * One coin a mandate: the policy has room for one more coin's rules, and the program for ten limits in all.
 */
export type HeldCoin = Readonly<{ mint: PublicKey; program: PublicKey; dailyMax: bigint }>;

/** The vault's own account of the held coin: where the agent's buys land and its sales take from. */
export const heldAccountOf = (vault: PublicKey, held: Pick<HeldCoin, "mint" | "program">): PublicKey => getAssociatedTokenAddressSync(held.mint, vault, true, held.program);

/** Her own account of the budget's token: the one account a sale's money may land in. */
export const proceedsAccountOf = (terms: Pick<MandateTerms, "human" | "budgetMint">): PublicKey => getAssociatedTokenAddressSync(terms.budgetMint, terms.human, true, TOKEN_PROGRAM_ID);

const U64_MAX = (1n << 64n) - 1n;

/**
 * One coin of her copy: as a coin the agent keeps (`HeldCoin`: its mint, program and day's share), and on
 * devnet the gate's kind of pool it trades through (`pool`; Jupiter needs none).
 */
export type CopyCoin = HeldCoin & Readonly<{ pool?: PublicKey | undefined }>;

/** The most coins a copy names: ten — two sales' policies, each its own transaction in the same approval. */
export const COPY_COINS_MAX = 10;

/**
 * The coins one sale's policy of a copy names: what fits the transaction that writes it, on Jupiter and on devnet's pools,
 * with every number at its widest (`copy-376.test.mjs`) — the program itself allows ten limits a policy.
 */
export const COPY_COINS_PER_SALE = 5;

/** Her copy's coins, as its sales' policies hold them: in the order she signed, `COPY_COINS_PER_SALE` a policy. */
export function copyChunks(coins: readonly CopyCoin[]): readonly (readonly CopyCoin[])[] {
  const out: CopyCoin[][] = [];
  for (let at = 0; at < coins.length; at += COPY_COINS_PER_SALE) out.push(coins.slice(at, at + COPY_COINS_PER_SALE));
  return out;
}

/** Which of her copy's sales' policies names this coin — its index — or null when none does. */
export function copyChunkOf(coins: readonly CopyCoin[], mint: PublicKey): number | null {
  const at = coins.findIndex((coin) => coin.mint.equals(mint));
  return at < 0 ? null : Math.floor(at / COPY_COINS_PER_SALE);
}

/**
 * How many days' buys the sale's daily limit holds: two. The rules' deepest stop is −50 % (`./exit.ts` `EXIT_BOUNDS`), and
 * at half the price she signed at her day's cap buys twice the coins — the stop still sells a whole day's buying in a day.
 */
export const HELD_DAY_ROOM = 2n;

/**
 * The promise for the agent's own sales: in a day the sale's policy lets out of the vault no
 * more of the coin than her day's cap buys at the price she signs at, `HELD_DAY_ROOM` times — `dayCoins`, the venue's own
 * quote of her day's cap in the coin, read before her signature. What the agent bought over several days is sold over
 * several: the rest of a stop goes the next day.
 */
export function heldDailyMax(dayCoins: bigint): bigint {
  if (dayCoins <= 0n) throw new Error("The day's cap buys none of the coin.");
  const max = dayCoins * HELD_DAY_ROOM;
  return max < U64_MAX ? max : U64_MAX;
}

/**
 * Her copy's worst day with a stolen agent key, however many coins she signs for, in her day's caps at the
 * price she signs at: one for the buys (the buy's policy holds the budget to her day's cap) and `HELD_DAY_ROOM` for the
 * sales together (`copyDailyMax`: each of her N coins lets out its share, `HELD_DAY_ROOM` day's caps ÷ N). Three — as
 * the one coin; whatever the key does, the money stays in her vault and her wallet, and only a bad price is lost.
 */
export const COPY_WORST_DAYS = 1n + HELD_DAY_ROOM;

/** Her copy's worst day with a stolen key, in the budget's base units: `COPY_WORST_DAYS` × her day's cap. */
export const copyWorstDay = (perDay: bigint): bigint => perDay * COPY_WORST_DAYS;

/**
 * One coin's day in a copy of `coins` coins: `dayCoins` — the venue's own quote of her whole day's cap in the
 * coin, read before her signature — `HELD_DAY_ROOM` times, ÷ `coins`. Every coin's sale together lets out of her vault in
 * a day no more than `HELD_DAY_ROOM` day's caps at the price she signs at, so the worst day stays `COPY_WORST_DAYS` day's
 * caps for one coin or ten — where the first rule, a whole `heldDailyMax` for each coin, let it grow to 1 + 2·N.
 */
export function copyDailyMax(dayCoins: bigint, coins: number): bigint {
  if (!Number.isInteger(coins) || coins < 1 || coins > COPY_COINS_MAX) throw new Error(`A copy names one to ${COPY_COINS_MAX} coins.`);
  const max = heldDailyMax(dayCoins) / BigInt(coins);
  if (max <= 0n) throw new Error("The coin's share of the day buys none of it.");
  return max;
}

/**
 * One buy of a copy: her trade, at most a coin's share of her day (`perDay` ÷ `coins`). What one buy brings in
 * is then about half of the coin's day (`copyDailyMax`) at the price she signs at, so the engine keeps what the vault holds
 * of a coin — with what it sold of it in the last day — within one day's sale of it, and every exit fits the chain's limit.
 */
export function copyBuySize(perTrade: bigint, perDay: bigint, coins: number): bigint {
  const share = perDay / BigInt(Math.max(1, coins));
  return perTrade < share ? perTrade : share;
}

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
  /** The budget is a coin she sells; absent — SOL or USDC she spends. */
  budgetCoin?: BudgetCoin | undefined;
  /** The coin the agent keeps in her vault and may sell on its own; absent — it buys into her wallet and sells nothing. */
  heldCoin?: HeldCoin | undefined;
  /** The coins her copy repeats a leader's trades in, kept in her vault and sold on its own; absent — no copy. */
  copyCoins?: readonly CopyCoin[] | undefined;
}>;

/** The token program of the budget's account. */
export const budgetProgramOf = (terms: Pick<MandateTerms, "budgetCoin">): PublicKey => terms.budgetCoin?.program ?? TOKEN_PROGRAM_ID;

/**
 * The mint Ryntra's fee is taken in: the budget's, when it is SOL or USDC; on a sale of a coin through Jupiter, what she
 * receives — SOL or USDC again, so the fee lands in the same accounts as every buy's. On devnet's pool the fee is a transfer
 * from the budget, so it is the coin's.
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
  return termRefusal(terms, nowSeconds);
}

/** The term's own bound: it ends in the future, within `DAYS_MAX` days — a bound on the date, not on money. */
function termRefusal(terms: Pick<MandateTerms, "expiresAt">, nowSeconds: bigint): string | null {
  if (terms.expiresAt <= nowSeconds) return "the mandate ends in the future";
  if (terms.expiresAt - nowSeconds > BigInt(DAYS_MAX) * 86_400n) return `the mandate lasts at most ${DAYS_MAX} days`;
  return null;
}

/** Why the terms are not a mandate the engine writes; null when they are. */
export function termsRefusal(terms: MandateTerms, nowSeconds: bigint): string | null {
  if (terms.copyCoins) return copyRefusal(terms, terms.copyCoins, nowSeconds);
  if (terms.budgetCoin) return terms.heldCoin ? "a coin she sells is no coin the agent keeps" : saleRefusal(terms, terms.budgetCoin, nowSeconds);
  const token = budgetToken(terms.budgetMint);
  if (!token) return "the budget is SOL or USDC";
  if (terms.human.equals(terms.agent)) return "the agent's key is not the person's wallet";
  if (terms.perTrade <= 0n || terms.perDay <= 0n) return "the caps are above zero";
  if (terms.perTrade > terms.perDay) return "a trade is at most the day's cap";
  if (!Number.isInteger(terms.slippageBps) || terms.slippageBps < 1 || terms.slippageBps > SLIPPAGE_MAX_BPS) return "slippage is at most 1 %";
  const term = termRefusal(terms, nowSeconds);
  if (term) return term;
  const fixed = terms.fixedBuy;
  if (fixed) {
    if (fixed.amountIn <= 0n || fixed.amountIn > terms.perTrade) return "a regular buy is within the trade cap";
    if (fixed.minOut <= 0n) return "a regular buy names its floor";
    if (fixed.outputMint.equals(terms.budgetMint)) return "a regular buy buys another token";
    if (fixed.outputProgram && !isTokenProgram(fixed.outputProgram)) return "a regular buy buys a coin of the token programs";
  }
  return terms.heldCoin ? heldRefusal(terms, terms.heldCoin) : null;
}

/** Why the coin is not one the agent keeps in her vault and sells; null when it is. */
function heldRefusal(terms: MandateTerms, held: HeldCoin): string | null {
  if (held.mint.equals(terms.budgetMint) || budgetToken(held.mint)) return "the agent keeps a coin, not SOL or USDC";
  if (!isTokenProgram(held.program)) return "the coin it keeps is a token of the token programs";
  if (held.dailyMax <= 0n || held.dailyMax > U64_MAX) return "the agent sells a day's share of the coin";
  if (terms.venue.kind !== "jupiter" && !held.program.equals(TOKEN_PROGRAM_ID)) return "on devnet's pool the agent keeps only a coin of Token";
  const fixed = terms.fixedBuy;
  if (fixed && (!fixed.outputMint.equals(held.mint) || !(fixed.outputProgram ?? TOKEN_PROGRAM_ID).equals(held.program))) return "a regular buy buys the coin the agent keeps";
  return null;
}

/** Why the terms are not a copy the engine writes; null when they are. */
function copyRefusal(terms: MandateTerms, coins: readonly CopyCoin[], nowSeconds: bigint): string | null {
  if (terms.budgetCoin || terms.heldCoin || terms.fixedBuy) return "a copy buys the leader's coins and nothing else";
  if (!budgetToken(terms.budgetMint)) return "the budget is SOL or USDC";
  if (terms.human.equals(terms.agent)) return "the agent's key is not the person's wallet";
  if (terms.perTrade <= 0n || terms.perDay <= 0n) return "the caps are above zero";
  if (terms.perTrade > terms.perDay) return "a trade is at most the day's cap";
  if (!Number.isInteger(terms.slippageBps) || terms.slippageBps < 1 || terms.slippageBps > SLIPPAGE_MAX_BPS) return "slippage is at most 1 %";
  const term = termRefusal(terms, nowSeconds);
  if (term) return term;
  if (coins.length < 1 || coins.length > COPY_COINS_MAX) return `a copy names one to ${COPY_COINS_MAX} coins`;
  if (new Set(coins.map((coin) => coin.mint.toBase58())).size !== coins.length) return "a copy names each coin once";
  for (const coin of coins) {
    const refusal = heldRefusal({ ...terms, fixedBuy: undefined }, coin);
    if (refusal) return refusal;
    if (terms.venue.kind === "jupiter" ? coin.pool !== undefined : !coin.pool) return "a copy's coin names its pool on devnet, and none through Jupiter";
  }
  if (terms.venue.kind === "dlmm") {
    const pools = coins.map((coin) => coin.pool!.toBase58());
    if (new Set(pools).size !== pools.length || !pools.includes(terms.venue.pool.toBase58())) return "on devnet each coin of a copy has its own pool, the gate's among them";
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
 * A token account whose owner field is the given one. The program is left open: Token and Token-2022 write the
 * owner at the same place, and only a token program moves a coin into an account — an account of any other program with
 * the right bytes cannot receive one, and the trade fails.
 */
function tokenAccountOf(index: number, owner: PublicKey): AccountConstraint {
  return { index, rule: { kind: "data", constraints: [slice(32, owner.toBytes())] }, owner: null };
}

/**
 * Where the output may land. A regular buy names its mint, so the account is the person's own of that mint under its
 * program, pinned by address — the same rule as her account's data, in a third of the bytes the fee rule needs; any other buy, a token account she owns.
 */
function receiverRule(index: number, terms: MandateTerms, vault: PublicKey): AccountConstraint {
  /* A coin the agent keeps lands in the vault's own account of it, pinned by address. */
  if (terms.heldCoin) return keys(index, heldAccountOf(vault, terms.heldCoin));
  /* A copy's buy lands in a token account of her vault — the signer holds it to the vault's own of a coin of hers. */
  if (terms.copyCoins) return tokenAccountOf(index, vault);
  const fixed = terms.fixedBuy;
  return fixed ? keys(index, getAssociatedTokenAddressSync(fixed.outputMint, terms.human, true, fixed.outputProgram ?? TOKEN_PROGRAM_ID)) : tokenAccountOf(index, terms.human);
}

/** On devnet a copy's buy goes through any pool of her coins — the gate's among them; null — not a copy. */
function copyPools(terms: MandateTerms): AccountConstraint | null {
  return terms.copyCoins ? keys(LAYOUT.dlmmSwap2.pool, ...terms.copyCoins.map((coin) => coin.pool!)) : null;
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
  /* With a coin the agent keeps, Jupiter's own leg of the output is the vault's account of that coin, pinned. */
  const ownRule = (index: number) => (terms.heldCoin ? keys(index, heldAccountOf(vault, terms.heldCoin)) : tokenAccountOf(index, vault));
  if (terms.venue.kind === "jupiter") {
    const floor = terms.fixedBuy ? jupiterQuoteFloor(terms.fixedBuy.minOut, terms.slippageBps) : null;
    const route = LAYOUT.routeV2;
    const shared = LAYOUT.sharedRouteV2;
    const routeFee = jupiterFeeRules(terms, route);
    const sharedFee = jupiterFeeRules(terms, shared);
    constraints = [
      {
        programId: JUPITER_PROGRAM_ID,
        accounts: [keys(route.authority, vault), keys(route.source, budgetAccount), ownRule(route.own), receiverRule(route.receiver, terms, vault), routeFee.account],
        data: [slice(0, ROUTE_V2), ...amountRules(terms, route, floor), routeFee.data],
      },
      {
        programId: JUPITER_PROGRAM_ID,
        accounts: [keys(shared.authority, vault), keys(shared.source, budgetAccount), receiverRule(shared.receiver, terms, vault), sharedFee.account],
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
        accounts: [copyPools(terms) ?? keys(swap.pool, terms.venue.pool), keys(swap.source, budgetAccount), receiverRule(swap.receiver, terms, vault), keys(swap.user, vault)],
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

/**
 * The sale's own policy, beside the buy's on the same vault, signed in the same approval: the agent may sell
 * the coin it keeps, and nothing else. Its one limit is the coin's, a day's share (`heldDailyMax`); the budget's token has
 * none here, so the program lets no sale lower the budget, nor the vault's SOL, by a lamport — and the buy's policy, with
 * no limit of the coin, lets no buy lower the coin. Each policy can move only what it is for.
 */
export function salePolicyOf(terms: MandateTerms, accounts: MandateAccounts): ProgramInteractionPolicy {
  const held = terms.heldCoin;
  if (!held) throw new Error("A mandate without a coin the agent keeps has no sale policy.");
  return {
    accountIndex: 0,
    constraints: terms.venue.kind === "jupiter" ? jupiterSaleConstraints(terms, held, accounts) : dlmmSaleConstraints(terms, terms.venue.pool, held, accounts),
    spendingLimits: [{ mint: held.mint, start: 0n, expiration: terms.expiresAt, period: "daily", maxPerPeriod: held.dailyMax }],
  };
}

/**
 * The agent's sale of the coin it keeps, through Jupiter: the vault signs and sells from its account of that
 * coin and nothing else; Jupiter's own leg is the vault's account of the budget's token; the output mint is the budget's;
 * the money lands in her own account of the budget's token, pinned by address; Ryntra's fee is taken in that money, into
 * Ryntra's account, at most the table's highest rate, with the slippage the mandate allows and no share of positive
 * slippage — the route's quote is the key's to write, so whatever the route makes over it stays in what she receives. The
 * amount is hers within the day's limit: what the policy lets out in a day may go in one sale — that is what the stop does.
 */
function jupiterSaleConstraints(terms: MandateTerms, held: HeldCoin, accounts: MandateAccounts): InstructionConstraint[] {
  const { vault, budgetAccount } = accounts;
  const coin = heldAccountOf(vault, held);
  const proceeds = proceedsAccountOf(terms);
  const route = LAYOUT.routeV2;
  const shared = LAYOUT.sharedRouteV2;
  const routeFee = jupiterFeeRules(terms, route);
  const sharedFee = jupiterFeeRules(terms, shared);
  return [
    {
      programId: JUPITER_PROGRAM_ID,
      accounts: [keys(route.authority, vault), keys(route.source, coin), keys(route.own, budgetAccount), keys(route.outputMint, terms.budgetMint), keys(route.receiver, proceeds), routeFee.account],
      data: [slice(0, ROUTE_V2), u16(route.slippage, terms.slippageBps, "lessThanOrEqualTo"), routeFee.data, u16(route.positiveSlippage, 0, "equals")],
    },
    {
      programId: JUPITER_PROGRAM_ID,
      accounts: [keys(shared.authority, vault), keys(shared.source, coin), keys(shared.receiver, proceeds), sharedFee.account],
      data: [slice(0, SHARED_ACCOUNTS_ROUTE_V2), u16(shared.slippage, terms.slippageBps, "lessThanOrEqualTo"), sharedFee.data, u16(shared.positiveSlippage, 0, "equals")],
    },
  ];
}

/**
 * On devnet: the gate's pool sells the coin from the vault's account of it into her own account of the budget's
 * token; Ryntra's fee, as in every devnet trade, is the transfer just before the swap — of the coin, from the same account,
 * into Ryntra's account of that coin and no other (`./fee.ts`). The share is the signer's to check; devnet only.
 */
function dlmmSaleConstraints(terms: MandateTerms, pool: PublicKey, held: HeldCoin, accounts: MandateAccounts): InstructionConstraint[] {
  const swap = LAYOUT.dlmmSwap2;
  const coin = heldAccountOf(accounts.vault, held);
  return [
    {
      programId: DLMM_PROGRAM_ID,
      accounts: [keys(swap.pool, pool), keys(swap.source, coin), keys(swap.receiver, proceedsAccountOf(terms)), keys(swap.user, accounts.vault)],
      data: [slice(0, DLMM_SWAP2)],
    },
    { programId: TOKEN_PROGRAM_ID, accounts: [keys(0, coin), keys(2, agentFeeAccount(held.mint))], data: [u8(0, FEE_TRANSFER_TAG, "equals")] },
  ];
}

/**
 * One of her copy's sales' policies, beside the buy's on the same vault, signed in the same approval: the agent
 * may sell the coins of this group (`copyChunks`, `chunk` its index) and nothing else. A limit for each of them, its share
 * of the copy's day (`copyDailyMax`), and none of the budget's token: the program lets no sale lower the budget, nor the vault's SOL,
 * nor any coin of another group, by a base unit — each group's coins leave the vault only through its own policy.
 *
 * Through Jupiter the rules are the sale's but one: the vault signs; Jupiter's own leg is the vault's account of
 * the budget's token; the output mint is the budget's; the money lands in her own account of the budget's token, pinned by
 * address; Ryntra's fee is in that money, at most the table's highest rate; slippage at most the mandate's, no share of
 * positive slippage. The account sold from is not pinned: the limits hold it, and in a sixth of the bytes. The program
 * tracks every writable token account of the vault the execution names and lets one fall only by a limit of its own mint,
 * within what is left of its day — closing none, changing no owner or delegate (`account_tracking.rs`) — so a sale takes
 * only these coins, each within its day, from wherever the key names; the signer still holds the source to the vault's own
 * account of one of them. On devnet the gate's kind of pool, one of these coins' own, sells it into her account, after
 * Ryntra's fee — a transfer into Ryntra's account of one of these coins.
 */
export function copySalePolicyOf(terms: MandateTerms, accounts: MandateAccounts, chunk: number): ProgramInteractionPolicy {
  const coins = terms.copyCoins ? copyChunks(terms.copyCoins)[chunk] : undefined;
  if (!coins?.length) throw new Error("A copy has no such sale's policy.");
  const { vault, budgetAccount } = accounts;
  const proceeds = proceedsAccountOf(terms);
  let constraints: InstructionConstraint[];
  if (terms.venue.kind === "jupiter") {
    const route = LAYOUT.routeV2;
    const shared = LAYOUT.sharedRouteV2;
    const routeFee = jupiterFeeRules(terms, route);
    const sharedFee = jupiterFeeRules(terms, shared);
    constraints = [
      {
        programId: JUPITER_PROGRAM_ID,
        accounts: [keys(route.authority, vault), keys(route.own, budgetAccount), keys(route.outputMint, terms.budgetMint), keys(route.receiver, proceeds), routeFee.account],
        data: [slice(0, ROUTE_V2), u16(route.slippage, terms.slippageBps, "lessThanOrEqualTo"), routeFee.data, u16(route.positiveSlippage, 0, "equals")],
      },
      {
        programId: JUPITER_PROGRAM_ID,
        accounts: [keys(shared.authority, vault), keys(shared.receiver, proceeds), sharedFee.account],
        data: [slice(0, SHARED_ACCOUNTS_ROUTE_V2), u16(shared.slippage, terms.slippageBps, "lessThanOrEqualTo"), sharedFee.data, u16(shared.positiveSlippage, 0, "equals")],
      },
    ];
  } else {
    const swap = LAYOUT.dlmmSwap2;
    constraints = [
      {
        programId: DLMM_PROGRAM_ID,
        accounts: [keys(swap.pool, ...coins.map((coin) => coin.pool!)), keys(swap.receiver, proceeds), keys(swap.user, vault)],
        data: [slice(0, DLMM_SWAP2)],
      },
      { programId: TOKEN_PROGRAM_ID, accounts: [keys(2, ...coins.map((coin) => agentFeeAccount(coin.mint)))], data: [u8(0, FEE_TRANSFER_TAG, "equals")] },
    ];
  }
  return {
    accountIndex: 0,
    constraints,
    spendingLimits: coins.map((coin) => ({ mint: coin.mint, start: 0n, expiration: terms.expiresAt, period: "daily" as const, maxPerPeriod: coin.dailyMax })),
  };
}

/**
 * Which of the policy's constraints an instruction of this program and discriminator claims; null — none. The buy's
 * policy and the sale's number theirs alike: the route first, the shared route second; on devnet the pool's
 * swap first, Ryntra's fee second.
 */
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
