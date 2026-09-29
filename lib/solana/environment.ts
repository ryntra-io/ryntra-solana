/**
 * The mainnet environment lock (canon §9.4).
 *
 * One sentence, restated immediately before a signature could be asked for:
 *
 *   `SOLANA MAINNET · real funds · exact wallet · exact amount · exact provider`
 *
 * and one rule behind it — **if the wallet, the network or the context changed
 * since the person authorized, the action goes back to Review.** Not a warning
 * banner over a live button; back to Review, because an authorization is given
 * to an exact set of facts and those are no longer the facts.
 *
 * ## Why this is a module rather than a paragraph in a page
 *
 * Because it has to be identical in every place a signature can be requested,
 * and because it has to be executable. A restatement composed inline by each
 * surface is a restatement that will eventually disagree with itself — the
 * Solana workspace has already shipped one network label in the chrome and a
 * different one two routes away. The plate here is generated from the same
 * record the comparison reads, so a surface cannot print one environment and
 * check another.
 *
 * ## What it deliberately does not do
 *
 * It does not sign, build, submit or judge policy. It answers one question
 * about two snapshots. `evaluateOwnerPolicy` decides whether an action is
 * allowed; this decides whether the answer it gave is still about the world
 * the person looked at.
 *
 * No value-moving action exists on Solana yet — `RYN-SOL-M0C` rewrites Send
 * for mainnet and `RYN-SOL-M1` is the first owner-signed transfer. This is the
 * gate those will pass through, written and proven before there is anything to
 * gate, which is the only order in which a gate is ever actually tested.
 */

import type { SolanaNetwork } from "./rpc.ts";

/** The fields the lock binds. Order is the order the plate prints them. */
export const ENVIRONMENT_LOCK_FIELDS = ["network", "wallet", "amount", "mint", "provider"] as const;
export type EnvironmentLockField = (typeof ENVIRONMENT_LOCK_FIELDS)[number] | `bound:${string}`;

export type SolanaEnvironmentContext = Readonly<{
  network: SolanaNetwork;
  /** The exact account that would sign. `null` when nothing is connected. */
  wallet: string | null;
  /** The exact provider that would execute — an RPC host, a venue. */
  provider: string;
  /** The exact amount, raw units plus what the person was shown. */
  amount: Readonly<{ raw: string; display: string }> | null;
  /** The exact mint. `null` for native SOL or for a context with no asset. */
  mint: string | null;
  /**
   * Anything else this action bound at authorization — recipient, route,
   * expiry, fee ceiling. Canon §24.3 makes every one of them material, and a
   * fixed field list would silently stop covering the next one.
   */
  bound?: Readonly<Record<string, string>>;
}>;

export const ENVIRONMENT_LOCK_VERDICTS = ["LOCKED", "RETURN_TO_REVIEW"] as const;
export type EnvironmentLockVerdict = (typeof ENVIRONMENT_LOCK_VERDICTS)[number];

export type EnvironmentLockCheck = Readonly<{
  verdict: EnvironmentLockVerdict;
  changed: readonly EnvironmentLockField[];
  detail: string;
}>;

/** `mainnet` is the only network where the words "real funds" are true. */
export function isRealFunds(network: SolanaNetwork): boolean {
  return network === "mainnet";
}

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

/**
 * The plate.
 *
 * Every segment is a fact from the record; a fact the record does not have
 * prints as `unknown` rather than being dropped, because a five-part
 * restatement that quietly becomes a three-part one reads as a shorter promise
 * instead of a missing one.
 */
export function restateEnvironment(context: SolanaEnvironmentContext): string {
  const segments = [
    `SOLANA ${context.network.toUpperCase()}`,
    isRealFunds(context.network) ? "real funds" : "no real funds",
    context.wallet ? shortAddress(context.wallet) : "no wallet",
    context.amount ? context.amount.display : "no amount",
    context.provider,
  ];
  return segments.join(" · ");
}

function bag(context: SolanaEnvironmentContext): Map<EnvironmentLockField, string> {
  const values = new Map<EnvironmentLockField, string>();
  values.set("network", context.network);
  values.set("wallet", context.wallet ?? "");
  values.set("amount", context.amount ? context.amount.raw : "");
  values.set("mint", context.mint ?? "");
  values.set("provider", context.provider);
  for (const [key, value] of Object.entries(context.bound ?? {})) {
    values.set(`bound:${key}`, value);
  }
  return values;
}

const FIELD_NAMES: Record<string, string> = {
  network: "the network",
  wallet: "the signing wallet",
  amount: "the amount",
  mint: "the mint",
  provider: "the provider",
};

function nameOf(field: EnvironmentLockField): string {
  return FIELD_NAMES[field] ?? field.replace(/^bound:/, "");
}

/**
 * Is the authorization still about this world?
 *
 * A field present in one snapshot and absent from the other counts as changed.
 * That is the case a looser comparison gets wrong: an action authorized with a
 * fee ceiling and re-presented without one has not kept its ceiling, it has
 * lost it.
 */
export function checkEnvironmentLock(args: {
  authorized: SolanaEnvironmentContext;
  current: SolanaEnvironmentContext | null;
}): EnvironmentLockCheck {
  if (!args.current) {
    return {
      verdict: "RETURN_TO_REVIEW",
      changed: ["wallet"],
      detail: "There is no connected wallet now. The action returns to Review.",
    };
  }

  const before = bag(args.authorized);
  const after = bag(args.current);
  const fields = new Set<EnvironmentLockField>([...before.keys(), ...after.keys()]);
  const changed: EnvironmentLockField[] = [];
  for (const field of fields) {
    if ((before.get(field) ?? "") !== (after.get(field) ?? "")) changed.push(field);
  }
  /* Stable order, so two runs of the same change read the same and a test can
     assert the list rather than a set. */
  changed.sort((left, right) => {
    const order = (value: EnvironmentLockField) => {
      const index = (ENVIRONMENT_LOCK_FIELDS as readonly string[]).indexOf(value);
      return index === -1 ? ENVIRONMENT_LOCK_FIELDS.length : index;
    };
    return order(left) - order(right) || left.localeCompare(right);
  });

  if (changed.length === 0) {
    return {
      verdict: "LOCKED",
      changed: [],
      detail: `Unchanged since you authorized: ${restateEnvironment(args.current)}.`,
    };
  }

  return {
    verdict: "RETURN_TO_REVIEW",
    changed,
    detail: `${changed.map(nameOf).join(", ")} changed since you authorized. The action returns to Review.`,
  };
}
