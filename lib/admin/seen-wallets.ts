import type { RewardAccount } from "../rewards/referral.ts";
import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { maskWallet, type BusinessPresence } from "./business.ts";
import type { InternalWalletRecord } from "./internal-wallets.ts";

/**
 * Every wallet the product has ever seen, in one list the owner can mark.
 *
 * `RYN-ADMIN-OWNER-WALLETS-001`. The owner looked at the dashboard, saw
 * masked addresses and did not recognise their own; the list that excludes
 * them was a disclosure at the bottom of the feed. So: one card, every
 * wallet from the presence index, the action ledger and the reward
 * accounts, with what it did and a switch that says *mine*. Pure and
 * client-safe; a projection over records that already exist.
 *
 * A wallet is *seen* when any of those three has a row for it. The figures
 * beside it are counts, not money — enough to tell a test wallet from a
 * customer, and nothing a customer would mind an operator reading, since
 * every one of them is public under the same address on chain.
 */

export type SeenWalletRow = Readonly<{
  wallet: string;
  masked: string;
  /** Solana or EVM, by shape. EVM rows come only from the internal list. */
  kind: "solana" | "evm";
  internal: boolean;
  /** The owner's own label, when the wallet is on the list. */
  label: string | null;
  /** Marked by the deployment's configuration rather than on the page — cannot be unmarked here. */
  fromEnv: boolean;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
  /** Finished operations, once per action id. */
  operations: number;
  /** In-flight or needs-you rows. */
  open: number;
  lanes: Readonly<Record<string, number>>;
  sessions: number;
  verified: boolean;
  /** Who invited it, masked, when the reward account says so. */
  invitedBy: string | null;
}>;

export type SeenWalletsModel = Readonly<{
  generatedAt: string;
  rows: readonly SeenWalletRow[];
  internalCount: number;
}>;

export type SeenWalletsInputs = Readonly<{
  now: string;
  presence: readonly BusinessPresence[];
  actions: readonly SolanaWalletAction[];
  accounts: readonly Pick<RewardAccount, "wallet" | "referrer" | "createdAt">[];
  internal: readonly InternalWalletRecord[];
  fromEnv: readonly string[];
}>;

function kindOf(wallet: string): "solana" | "evm" {
  return wallet.startsWith("0x") ? "evm" : "solana";
}

function earlier(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left < right ? left : right;
}

function later(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

export function projectSeenWallets(input: SeenWalletsInputs): SeenWalletsModel {
  type Draft = {
    firstSeenAt: string | null;
    lastActiveAt: string | null;
    operations: number;
    open: number;
    lanes: Record<string, number>;
    sessions: number;
    verified: boolean;
    invitedBy: string | null;
  };
  const drafts = new Map<string, Draft>();
  const draft = (wallet: string): Draft => {
    let found = drafts.get(wallet);
    if (!found) {
      found = { firstSeenAt: null, lastActiveAt: null, operations: 0, open: 0, lanes: {}, sessions: 0, verified: false, invitedBy: null };
      drafts.set(wallet, found);
    }
    return found;
  };

  for (const row of input.presence) {
    const d = draft(row.wallet);
    d.firstSeenAt = earlier(d.firstSeenAt, row.firstSeenAt);
    d.lastActiveAt = later(d.lastActiveAt, row.lastSeenAt);
    d.sessions = row.sessions;
    d.verified = row.verifications > 0;
  }
  const seenActions = new Set<string>();
  for (const action of input.actions) {
    const key = `${action.wallet}:${action.actionId}`;
    if (seenActions.has(key)) continue;
    seenActions.add(key);
    const d = draft(action.wallet);
    d.firstSeenAt = earlier(d.firstSeenAt, action.startedAt);
    d.lastActiveAt = later(d.lastActiveAt, action.updatedAt);
    if (action.outcome === "DONE") {
      d.operations += 1;
      d.lanes[action.lane] = (d.lanes[action.lane] ?? 0) + 1;
    } else if (action.outcome === "IN_FLIGHT" || action.outcome === "NEEDS_YOU") {
      d.open += 1;
    }
  }
  for (const account of input.accounts) {
    const d = draft(account.wallet);
    d.firstSeenAt = earlier(d.firstSeenAt, account.createdAt);
    if (account.referrer) d.invitedBy = maskWallet(account.referrer);
  }
  const labels = new Map(input.internal.map((row) => [row.wallet, row.label] as const));
  for (const row of input.internal) draft(row.wallet);
  for (const wallet of input.fromEnv) draft(wallet);
  const env = new Set(input.fromEnv);

  const rows: SeenWalletRow[] = [...drafts].map(([wallet, d]) => ({
    wallet,
    masked: maskWallet(wallet),
    kind: kindOf(wallet),
    internal: labels.has(wallet) || env.has(wallet),
    label: labels.get(wallet) ?? null,
    fromEnv: env.has(wallet),
    firstSeenAt: d.firstSeenAt,
    lastActiveAt: d.lastActiveAt,
    operations: d.operations,
    open: d.open,
    lanes: d.lanes,
    sessions: d.sessions,
    verified: d.verified,
    invitedBy: d.invitedBy,
  }));
  /* Most recently active first; a wallet with no activity at all (an EVM
     note, a configured address) sits at the end. */
  rows.sort((left, right) => (right.lastActiveAt ?? "").localeCompare(left.lastActiveAt ?? "") || left.wallet.localeCompare(right.wallet));
  return { generatedAt: input.now, rows, internalCount: rows.filter((row) => row.internal).length };
}
