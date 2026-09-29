import { NATIVE_SOL_DECIMALS } from "./send-kinds.ts";

/**
 * What a wallet actually holds, grouped the way a person reads it and kept the
 * way a transaction has to be built.
 *
 * The picker shows one line per asset. The chain does not: the same mint can
 * sit in the canonical associated account, in an auxiliary account someone
 * else opened, and in a frozen account that cannot move at all. Collapsing
 * those into a single balance is right for reading and wrong for planning, so
 * an asset row carries two numbers — held and spendable — and never loses the
 * accounts underneath. A row that showed only the aggregate would let `Max`
 * offer a number no transaction can spend.
 */

export const SEND_ACCOUNT_STATES = ["INITIALIZED", "FROZEN", "UNKNOWN"] as const;
export type SendAccountState = (typeof SEND_ACCOUNT_STATES)[number];

export type SendSourceAccount = Readonly<{
  address: string;
  mint: string;
  tokenProgram: string;
  amountRaw: string;
  decimals: number;
  state: SendAccountState;
  /** True for the account `findAssociatedTokenPda` derives for this owner. */
  canonical?: boolean;
}>;

export type SendInventoryAsset = Readonly<{
  kind: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  tokenProgram: string | null;
  /** Every unit the owner holds for this asset, including what cannot move. */
  amountRaw: string;
  /** Only what a transfer may actually draw on. */
  spendableRaw: string;
  decimals: number;
  canonicalAta: string | null;
  sourceAccounts: readonly SendSourceAccount[];
}>;

export type ChooseSpendSourcesResult =
  | Readonly<{ ok: true; sources: readonly SendSourceAccount[] }>
  | Readonly<{ ok: false; code: "INSUFFICIENT_SPENDABLE_BALANCE"; reason: string }>;

const CANONICAL_AMOUNT = /^(0|[1-9][0-9]*)$/;

/**
 * The identity of one asset row.
 *
 * A colon rather than a space, and built by concatenation rather than
 * interpolation: base58 contains neither, so the join is unambiguous, and the
 * one thing this repository has learned to distrust is a literal separator
 * that has to survive being written through a shell.
 */
export function sendInventoryKey(mint: string, tokenProgram: string): string {
  return mint.concat(":", tokenProgram);
}

/** Only an initialized account can be spent from. Unknown is not a maybe. */
function spendable(account: SendSourceAccount): boolean {
  return account.state === "INITIALIZED";
}

function sum(accounts: readonly SendSourceAccount[]): string {
  return accounts.reduce((total, account) => total + BigInt(account.amountRaw), 0n).toString();
}

/**
 * Group by `(mint, tokenProgram)` — never by mint alone.
 *
 * The same mint address under two token programs is two different assets with
 * different transfer semantics, and merging them would produce a plan that
 * calls the wrong program. Arrival order is preserved because ranking by raw
 * amount is not comparable across decimals; presentation order stays the
 * caller's decision.
 */
export function groupSendInventory(
  accounts: readonly SendSourceAccount[],
): readonly SendInventoryAsset[] {
  const order: string[] = [];
  const byKey = new Map<string, SendSourceAccount[]>();

  for (const account of accounts) {
    if (BigInt(account.amountRaw) === 0n) continue;
    const key = sendInventoryKey(account.mint, account.tokenProgram);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(account);
      continue;
    }
    order.push(key);
    byKey.set(key, [account]);
  }

  return order.map((key) => {
    const group = byKey.get(key)!;
    const [first] = group;
    const canonical = group.find((account) => account.canonical === true);
    return Object.freeze({
      kind: "TOKEN" as const,
      mint: first.mint,
      tokenProgram: first.tokenProgram,
      amountRaw: sum(group),
      spendableRaw: sum(group.filter(spendable)),
      decimals: first.decimals,
      canonicalAta: canonical?.address ?? null,
      sourceAccounts: Object.freeze([...group]),
    });
  });
}

/**
 * What a native SOL transfer must leave behind for its own fee.
 *
 * A signature costs 5000 lamports today. This holds back a hundred times that
 * — 0.0005 SOL, well under a cent — because the reserve has to survive a busy
 * minute where a priority fee is added, and because a MAX button that leaves
 * a person unable to pay for the very transaction it just filled in is worse
 * than one that is slightly conservative.
 *
 * It is deliberately not the fee itself: the fee is not known until the
 * transaction is built, and this number is needed before anyone has typed
 * anything.
 */
export const NATIVE_SOL_FEE_RESERVE_LAMPORTS = 500_000n;

/**
 * Native SOL is lamports on the owner's own account, not a token account.
 *
 * `spendableRaw` used to be the whole balance, which made MAX on SOL a button
 * that always failed: it filled in every lamport the wallet had, and the
 * builder then refused because nothing was left to pay the fee with. The
 * refusal was correct and the offer was not.
 */
export function nativeSendInventoryAsset(lamports: string): SendInventoryAsset {
  const balance = BigInt(lamports);
  const spendable = balance > NATIVE_SOL_FEE_RESERVE_LAMPORTS
    ? balance - NATIVE_SOL_FEE_RESERVE_LAMPORTS
    : 0n;
  return Object.freeze({
    kind: "NATIVE_SOL" as const,
    mint: null,
    tokenProgram: null,
    /* What the wallet holds stays the whole balance — a person's own figure
       should match their wallet's. Only what this product will offer to send
       is reduced. */
    amountRaw: lamports,
    spendableRaw: spendable.toString(),
    decimals: NATIVE_SOL_DECIMALS,
    canonicalAta: null,
    sourceAccounts: Object.freeze([] as readonly SendSourceAccount[]),
  });
}

/**
 * Pick the exact accounts one transfer will draw on.
 *
 * The canonical associated account wins whenever it alone is sufficient, even
 * when a larger auxiliary account exists: one instruction from the address a
 * recipient's own wallet would derive is the plainest transaction that can
 * satisfy the request. Otherwise accounts are taken by descending balance and
 * then by address, so identical wallet state always yields identical
 * instruction order and therefore an identical plan fingerprint.
 *
 * Refusal is total. A request larger than the spendable balance returns a
 * reason rather than a partial send, because a transfer that quietly moves
 * less than it was asked to is the worst possible outcome here.
 */
export function chooseSpendSources(
  asset: SendInventoryAsset,
  amountRaw: string,
): ChooseSpendSourcesResult {
  if (!CANONICAL_AMOUNT.test(amountRaw) || BigInt(amountRaw) === 0n) {
    return {
      ok: false,
      code: "INSUFFICIENT_SPENDABLE_BALANCE",
      reason: "The amount must be a whole number of base units above zero.",
    };
  }

  const wanted = BigInt(amountRaw);
  const usable = asset.sourceAccounts.filter(spendable);
  const available = usable.reduce((total, account) => total + BigInt(account.amountRaw), 0n);
  if (available < wanted) {
    return {
      ok: false,
      code: "INSUFFICIENT_SPENDABLE_BALANCE",
      reason: "The spendable balance across this asset's accounts is "
        .concat(available.toString(), " base units."),
    };
  }

  const canonical = usable.find((account) => account.address === asset.canonicalAta);
  if (canonical && BigInt(canonical.amountRaw) >= wanted) {
    return { ok: true, sources: Object.freeze([canonical]) };
  }

  const ordered = [...usable].sort((left, right) => {
    const difference = BigInt(right.amountRaw) - BigInt(left.amountRaw);
    if (difference !== 0n) return difference > 0n ? 1 : -1;
    return left.address < right.address ? -1 : left.address > right.address ? 1 : 0;
  });

  const chosen: SendSourceAccount[] = [];
  let drawn = 0n;
  for (const account of ordered) {
    if (drawn >= wanted) break;
    chosen.push(account);
    drawn += BigInt(account.amountRaw);
  }
  return { ok: true, sources: Object.freeze(chosen) };
}
