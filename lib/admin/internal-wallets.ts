import { z } from "zod";

import type { GuardStore } from "../guard/store.ts";

/**
 * The owner's own wallets — the ones a business figure must not count.
 *
 * Eight test swaps in an afternoon would otherwise read as eight customers. A
 * wallet on this list is *internal*: it stays in every ledger exactly as it
 * is, still shows in the *all activity* scope, and is left out of the external
 * figures the owner reads first.
 *
 * Two sources, both server-side and never shipped to a browser bundle: the
 * deployment's `RYNTRA_INTERNAL_WALLETS` (comma or whitespace separated base58
 * addresses) and the list the owner manages from the admin, kept in the Guard
 * store. The environment seeds; the store is what the admin edits. Neither is
 * a secret — an address is public — and neither is a credential.
 */

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/* An EVM address is accepted too, so the owner can record the other side of
   their own bridges beside the Solana wallets. Every business figure is keyed
   by the Solana wallet, so an EVM entry excludes nothing on its own — it is
   the owner's note of what is theirs, kept in the one list. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const COLLECTION = "adminInternalWallets" as const;

export const InternalWalletSchema = z
  .object({
    wallet: z.string().refine((value) => BASE58_ADDRESS.test(value) || EVM_ADDRESS.test(value), "a Solana or EVM address"),
    /** The owner's own word for it: "founder phone", "QA stand". Never shown to a customer. */
    label: z.string().min(1).max(60),
    addedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type InternalWalletRecord = z.output<typeof InternalWalletSchema>;

export function isBase58Wallet(value: unknown): value is string {
  return typeof value === "string" && BASE58_ADDRESS.test(value);
}

/** A Solana or an EVM address — what the internal list accepts. */
export function isInternalWalletAddress(value: unknown): value is string {
  return typeof value === "string" && (BASE58_ADDRESS.test(value) || EVM_ADDRESS.test(value));
}

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && EVM_ADDRESS.test(value);
}

/** Addresses named by the deployment. Malformed entries are dropped, never guessed at. */
export function internalWalletsFromEnv(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const raw = env.RYNTRA_INTERNAL_WALLETS ?? "";
  return [...new Set(raw.split(/[\s,;]+/).map((entry) => entry.trim()).filter((entry) => BASE58_ADDRESS.test(entry)))];
}

export type InternalWalletsRead =
  | Readonly<{ status: "measured"; rows: readonly InternalWalletRecord[] }>
  | Readonly<{ status: "unavailable" }>;

export async function listInternalWallets(store: GuardStore): Promise<InternalWalletsRead> {
  try {
    const raw = await store.collection<unknown>(COLLECTION).valuesWithPrefix("");
    const rows: InternalWalletRecord[] = [];
    for (const row of raw) {
      const parsed = InternalWalletSchema.safeParse(row);
      if (parsed.success) rows.push(parsed.data);
    }
    rows.sort((left, right) => left.addedAt.localeCompare(right.addedAt));
    return { status: "measured", rows };
  } catch {
    return { status: "unavailable" };
  }
}

/** Mark a wallet internal. Idempotent: a second add keeps the first label. */
export async function addInternalWallet(
  store: GuardStore,
  args: Readonly<{ wallet: string; label: string; now: string }>,
): Promise<Readonly<{ ok: true; created: boolean }> | Readonly<{ ok: false; reason: "INVALID" | "UNAVAILABLE" }>> {
  const parsed = InternalWalletSchema.safeParse({ wallet: args.wallet, label: args.label.trim(), addedAt: args.now });
  if (!parsed.success) return { ok: false, reason: "INVALID" };
  try {
    const created = await store.collection<InternalWalletRecord>(COLLECTION).insertIfAbsent(parsed.data.wallet, parsed.data);
    return { ok: true, created };
  } catch {
    return { ok: false, reason: "UNAVAILABLE" };
  }
}

export async function removeInternalWallet(store: GuardStore, wallet: string): Promise<boolean> {
  if (!isInternalWalletAddress(wallet)) return false;
  try {
    await store.collection<InternalWalletRecord>(COLLECTION).delete(wallet);
    return true;
  } catch {
    return false;
  }
}

/** The union the analytics read: the deployment's list plus the owner's. */
export async function resolveInternalWallets(
  store: GuardStore,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Readonly<{ wallets: ReadonlySet<string>; store: InternalWalletsRead["status"] }>> {
  const listed = await listInternalWallets(store);
  const wallets = new Set(internalWalletsFromEnv(env));
  if (listed.status === "measured") for (const row of listed.rows) wallets.add(row.wallet);
  return { wallets, store: listed.status };
}
