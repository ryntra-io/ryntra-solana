import { InternalWalletSchema, isInternalWalletAddress } from "../admin/internal-wallets.ts";
import type { GuardStore } from "../guard/store.ts";

/**
 * The owner's own wallets and the test wallets earn no money.
 *
 * The list is the one the admin already keeps — the deployment's `RYNTRA_INTERNAL_WALLETS` plus the owner's
 * `adminInternalWallets` — and the one Points and the leagues already leave out. A list that cannot be read is
 * not an empty list: money waits for the next try (`null`), it is never paid on a guess.
 *
 * What it does to money, from the moment it is released (nothing written earlier is recomputed):
 * - an operation of an internal wallet writes no reward row for anybody — no cashback, no friend's share, no rank
 *   point from it: an operation of the owner's is not a customer's trade;
 * - an internal wallet as somebody's inviter gets no share — that share stays with Ryntra, the other level is paid
 *   as usual;
 * - an internal wallet opens no payout, including of rows written before this rule.
 */
let warned = false;

export async function internalWalletsForMoney(store: GuardStore, env: Readonly<Record<string, string | undefined>>): Promise<ReadonlySet<string> | null> {
  try {
    const named = internalWalletsNamedBy(env);
    if (!named) {
      /* Said once per instance: every accrual waits and every payout answers 503 until the variable is fixed. */
      if (!warned) console.error("rewards: RYNTRA_INTERNAL_WALLETS has an entry that is not an address — money waits until it is fixed.");
      warned = true;
      return null;
    }
    const wallets = new Set(named);
    /* The admin's list, read as the admin keeps it (`adminInternalWallets`); a row that cannot be read is a wallet
       nobody can tell about — the whole list then counts as unread, never as one wallet fewer. */
    for (const row of await store.collection<unknown>("adminInternalWallets").valuesWithPrefix("")) {
      const parsed = InternalWalletSchema.safeParse(row);
      if (!parsed.success) return null;
      wallets.add(parsed.data.wallet);
    }
    return wallets;
  } catch {
    return null;
  }
}

/**
 * The deployment's `RYNTRA_INTERNAL_WALLETS`, read strictly for money: one pair of quotes around the whole value is
 * taken off (a value pasted with them), then every entry must be an address (Solana, or EVM — the owner's note of the
 * other side of a bridge). An entry that is not — a stray quote, an invisible character, an address glued to text — is
 * a wallet nobody can tell about: the list counts as unread (`null`), never as one wallet fewer. Unset is empty.
 */
export function internalWalletsNamedBy(env: Readonly<Record<string, string | undefined>>): readonly string[] | null {
  const raw = (env.RYNTRA_INTERNAL_WALLETS ?? "").trim().replace(/^(["'])(.*)\1$/s, "$2");
  const entries = raw.split(/[\s,;]+/).filter((entry) => entry.length > 0);
  return entries.every(isInternalWalletAddress) ? [...new Set(entries)] : null;
}

/** The levels of an operation without the internal wallets in them: their share stays with Ryntra. */
export function levelsWithoutInternal(
  levels: Readonly<{ l1: string | null; l2: string | null }>,
  internal: ReadonlySet<string>,
): Readonly<{ l1: string | null; l2: string | null }> {
  return {
    l1: levels.l1 && !internal.has(levels.l1) ? levels.l1 : null,
    l2: levels.l2 && !internal.has(levels.l2) ? levels.l2 : null,
  };
}

/** What a person is told on «Винагороди» and at a payout when the wallet is one of Ryntra's own. */
export function internalPayoutText(locale: "en" | "uk"): string {
  return locale === "uk"
    ? "Це службовий гаманець Ryntra: грошових винагород він не отримує."
    : "This is a Ryntra team wallet: it earns no money rewards.";
}
