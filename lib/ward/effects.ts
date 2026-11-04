/**
 * What a transaction does, read as the difference between every writable account before it (the chain now) and
 * after it (the simulation of the exact bytes): whose balances move, by how much, in which asset; which accounts
 * change hands; which token accounts gain a delegate or a new closer.
 *
 * Balances are counted by holder, not by account. A holder's SOL is their wallet's lamports plus the wrapped SOL in
 * their token accounts — so the temporary wrapper a swap opens and closes nets to nothing, and rent a person locks in
 * their own new token account is still theirs. Rent the signer pays into accounts that did not exist before is named
 * on its own: it is a cost of the transaction, not a payment to anyone.
 */

import { isOffCurveAddress, type Address } from "@solana/kit";

import { isWalletState, readTokenAccount, type AccountState, type TokenAccount } from "./accounts.ts";
import { SYSTEM_PROGRAM, WRAPPED_SOL_MINT } from "./known.ts";
import type { WardHolder } from "./codes.ts";

/** One holder's change in one asset. `mint` is null for SOL. */
export type BalanceChange = Readonly<{ holder: string; kind: WardHolder; mint: string | null; raw: bigint }>;

export type OwnerChange = Readonly<{ account: string; from: string; to: string; token: boolean; holder: string }>;
export type DelegateChange = Readonly<{ account: string; holder: string; mint: string; delegate: string; amount: bigint; balance: bigint }>;
export type CloserChange = Readonly<{ account: string; holder: string; closer: string }>;
export type OpenedAccount = Readonly<{ account: string; program: string; lamports: bigint }>;
/** A token account that will receive tokens of this mint, and whether it is opened by this transaction. */
export type Arrival = Readonly<{ holder: string; mint: string; account: string; opened: boolean; frozen: boolean }>;

export type Effects = Readonly<{
  changes: readonly BalanceChange[];
  ownerChanges: readonly OwnerChange[];
  delegates: readonly DelegateChange[];
  closers: readonly CloserChange[];
  opened: readonly OpenedAccount[];
  /** Lamports locked as rent in accounts this transaction opens. */
  rentLamports: bigint;
  arrivals: readonly Arrival[];
  /** Every token account read, before or after, by address — the recipient and intent checks resolve owners here. */
  tokenAccounts: ReadonlyMap<string, TokenAccount>;
  /** Addresses read as plain wallets. */
  wallets: ReadonlySet<string>;
}>;

export function holderKind(address: string, signer: string, wallets?: ReadonlySet<string>): WardHolder {
  if (address === signer) return "you";
  if (wallets?.has(address)) return "wallet";
  try {
    return isOffCurveAddress(address as Address) ? "program" : "wallet";
  } catch {
    return "program";
  }
}

/**
 * The difference between `before` and `after` over the writable addresses given. An address missing from `after`
 * was not reported by the simulation and is left out; an address present with `null` does not exist on that side.
 */
export function readEffects(args: {
  signer: string;
  writable: readonly string[];
  before: ReadonlyMap<string, AccountState | null>;
  after: ReadonlyMap<string, AccountState | null>;
}): Effects {
  const { signer } = args;
  const sums = new Map<string, bigint>();
  const add = (holder: string, mint: string | null, raw: bigint) => {
    if (raw === 0n) return;
    const key = `${holder}|${mint ?? ""}`;
    sums.set(key, (sums.get(key) ?? 0n) + raw);
  };
  const ownerChanges: OwnerChange[] = [];
  const delegates: DelegateChange[] = [];
  const closers: CloserChange[] = [];
  const opened: OpenedAccount[] = [];
  const arrivals: Arrival[] = [];
  const tokenAccounts = new Map<string, TokenAccount>();
  /* Accounts read as plain wallets on either side: their holders are people, whatever their key looks like. */
  const wallets = new Set<string>();
  let rentLamports = 0n;

  for (const address of args.writable) {
    if (!args.after.has(address) || !args.before.has(address)) continue;
    const pre = args.before.get(address) ?? null;
    const post = args.after.get(address) ?? null;
    const tokenPre = readTokenAccount(pre);
    const tokenPost = readTokenAccount(post);
    if (tokenPre) tokenAccounts.set(address, tokenPre);
    if (tokenPost) tokenAccounts.set(address, tokenPost);

    if (tokenPre || tokenPost) {
      const holder = (tokenPost ?? tokenPre)!.owner;
      const mint = (tokenPost ?? tokenPre)!.mint;
      const amountDelta = (tokenPost?.amount ?? 0n) - (tokenPre?.amount ?? 0n);
      if (tokenPre && tokenPost && tokenPre.owner !== tokenPost.owner) {
        ownerChanges.push({ account: address, from: tokenPre.owner, to: tokenPost.owner, token: true, holder: tokenPre.owner });
        /* The balance leaves the old holder and arrives with the new one. */
        add(tokenPre.owner, mint === WRAPPED_SOL_MINT ? null : mint, -tokenPre.amount);
        add(tokenPost.owner, mint === WRAPPED_SOL_MINT ? null : mint, tokenPost.amount);
      } else {
        add(holder, mint === WRAPPED_SOL_MINT ? null : mint, amountDelta);
      }
      if (tokenPost?.delegate && (tokenPost.delegate !== tokenPre?.delegate || tokenPost.delegatedAmount > (tokenPre?.delegatedAmount ?? 0n))) {
        delegates.push({ account: address, holder: tokenPost.owner, mint, delegate: tokenPost.delegate, amount: tokenPost.delegatedAmount, balance: tokenPost.amount });
      }
      if (tokenPost?.closeAuthority && tokenPost.closeAuthority !== tokenPre?.closeAuthority && tokenPost.closeAuthority !== tokenPost.owner) {
        closers.push({ account: address, holder: tokenPost.owner, closer: tokenPost.closeAuthority });
      }
      if (!pre && post) {
        opened.push({ account: address, program: post.owner, lamports: post.lamports });
        rentLamports += post.lamports - (mint === WRAPPED_SOL_MINT ? (tokenPost?.amount ?? 0n) : 0n);
      }
      if (tokenPost && amountDelta > 0n) arrivals.push({ holder: tokenPost.owner, mint, account: address, opened: !pre, frozen: tokenPost.frozen });
      continue;
    }

    const lamportDelta = (post?.lamports ?? 0n) - (pre?.lamports ?? 0n);
    const preOwner = pre?.owner ?? SYSTEM_PROGRAM;
    const postOwner = post?.owner ?? SYSTEM_PROGRAM;
    if (pre && post && preOwner !== postOwner && pre.data.length === 0) {
      /* A funded wallet that leaves the System program is a wallet someone else's program now controls. */
      ownerChanges.push({ account: address, from: preOwner, to: postOwner, token: false, holder: address });
    }
    if (isWalletState(post) || (isWalletState(pre) && pre !== null)) {
      if (post !== null || pre !== null) wallets.add(address);
      add(address, null, lamportDelta);
    } else if (!pre && post) {
      opened.push({ account: address, program: post.owner, lamports: post.lamports });
      rentLamports += post.lamports;
    } else {
      add(address, null, lamportDelta);
    }
  }

  const changes: BalanceChange[] = [];
  for (const [key, raw] of sums) {
    if (raw === 0n) continue;
    const [holder, mint] = key.split("|");
    changes.push({ holder, kind: holderKind(holder, signer, wallets), mint: mint === "" ? null : mint, raw });
  }
  changes.sort((a, b) => (a.kind === "you" ? -1 : 0) - (b.kind === "you" ? -1 : 0) || a.holder.localeCompare(b.holder) || (a.mint ?? "").localeCompare(b.mint ?? ""));
  return { changes, ownerChanges, delegates, closers, opened, rentLamports, arrivals, tokenAccounts, wallets };
}

/** The base fee and the priority fee the message's own Compute Budget instructions set, in lamports. */
export function feeOf(signatures: number, computeUnitLimit: number | null, microLamportsPerUnit: bigint | null): bigint {
  const base = 5_000n * BigInt(signatures);
  if (!microLamportsPerUnit) return base;
  const units = BigInt(computeUnitLimit ?? 200_000);
  return base + (microLamportsPerUnit * units + 999_999n) / 1_000_000n;
}
