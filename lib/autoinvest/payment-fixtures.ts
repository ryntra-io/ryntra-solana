/**
 * Chain transactions as `getTransaction` states them, trimmed — the fixtures
 * the «З кожної оплати» tests and the contract's examples read
 * (`RYN-PAY-TRIGGERS-001`). Every one is built the way the chain builds it:
 * the token balances before and after with their owners, the lamports of
 * every key, the signers, the memo instructions. Nothing here reaches a
 * network.
 */

import { PAYMENTS_USDC_MINT, type ChainTokenBalance, type ChainTransaction } from "./payments.ts";

const FEE_LAMPORTS = 5_000;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** One token account in a fixture: its address, owner, mint and balance before and after, raw. */
export type FixtureTokenAccount = Readonly<{ address: string; owner: string; mint?: string; before: bigint; after: bigint }>;

/** A transaction from its keys and token accounts: the signer pays the fee; `lamports` moves SOL to or from a key besides it. */
export function chainTransaction(input: Readonly<{
  signature: string;
  slot: number;
  blockTime: number | null;
  signers: readonly string[];
  keys?: readonly string[];
  tokens: readonly FixtureTokenAccount[];
  lamports?: Readonly<Record<string, number>>;
  memos?: readonly string[];
  failed?: boolean;
}>): ChainTransaction {
  const keys = [...new Set([...input.signers, ...(input.keys ?? []), ...input.tokens.map((token) => token.address), PAYMENTS_USDC_MINT, TOKEN_PROGRAM, ...(input.memos?.length ? [MEMO_PROGRAM] : [])])];
  const index = (address: string) => keys.indexOf(address);
  const balance = (token: FixtureTokenAccount, amount: bigint): ChainTokenBalance => ({
    accountIndex: index(token.address),
    mint: token.mint ?? PAYMENTS_USDC_MINT,
    owner: token.owner,
    uiTokenAmount: { amount: amount.toString(), decimals: token.mint && token.mint !== PAYMENTS_USDC_MINT ? 8 : 6 },
  });
  const preBalances = keys.map(() => 1_000_000_000);
  const postBalances = keys.map((key, at) => preBalances[at] - (key === input.signers[0] ? FEE_LAMPORTS : 0) + (input.lamports?.[key] ?? 0));
  return {
    signature: input.signature,
    slot: input.slot,
    blockTime: input.blockTime,
    failed: input.failed ?? false,
    accountKeys: keys.map((pubkey) => ({ pubkey, signer: input.signers.includes(pubkey) })),
    preBalances,
    postBalances,
    /* An account opened in the transaction has no balance before it; one closed in it has none after. */
    preTokenBalances: input.tokens.filter((token) => token.before >= 0n).map((token) => balance(token, token.before)),
    postTokenBalances: input.tokens.filter((token) => token.after >= 0n).map((token) => balance(token, token.after)),
    memos: input.memos ?? [],
  };
}

/** Dollars as raw USDC. */
export function usdc(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

/**
 * A plain USDC transfer: `from` signs and pays `to` `amountUsd`; `fromAccount`
 * and `toAccount` are their USDC accounts with the balances before.
 */
export function usdcTransfer(input: Readonly<{
  signature: string;
  slot: number;
  blockTime: number;
  from: string;
  fromAccount: string;
  fromBefore: number;
  to: string;
  toAccount: string;
  toBefore: number;
  amountUsd: number;
  memo?: string;
  feePayer?: string;
}>): ChainTransaction {
  const amount = usdc(input.amountUsd);
  return chainTransaction({
    signature: input.signature,
    slot: input.slot,
    blockTime: input.blockTime,
    signers: input.feePayer ? [input.feePayer, input.from] : [input.from],
    tokens: [
      { address: input.fromAccount, owner: input.from, before: usdc(input.fromBefore), after: usdc(input.fromBefore) - amount },
      { address: input.toAccount, owner: input.to, before: usdc(input.toBefore), after: usdc(input.toBefore) + amount },
    ],
    memos: input.memo ? [input.memo] : [],
  });
}

function base58Of(seed: string, length: number): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let state = 2166136261;
  let out = "";
  for (let at = 0; out.length < length; at += 1) {
    state = Math.imul(state ^ seed.charCodeAt(at % seed.length) ^ at, 16777619) >>> 0;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

/** A signature-shaped string from a seed, stable across runs — base58, 88 characters. */
export function fixtureSignature(seed: string): string {
  return base58Of(`signature:${seed}`, 88);
}

/** An address-shaped string from a seed, stable across runs — base58, 44 characters. */
export function fixtureAddress(seed: string): string {
  return base58Of(`address:${seed}`, 44);
}
