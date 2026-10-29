import type { GuardStore } from "../guard/store.ts";
import { WALLET_LINK_COLLECTION, walletLinkHistoryKey, walletLinkHistoryPrefix, walletLinkKey, type WalletLinkRecord, WalletLinkRecordSchema } from "./wallet-link.ts";

export type WalletLinkOutcome =
  | Readonly<{
      ok: true;
      created: boolean;
      link: WalletLinkRecord;
      /** What the link replaced on each side, if anything — the history keeps it. */
      replaced: Readonly<{ evm: string | null; solana: string | null }>;
    }>
  | Readonly<{
      ok: false;
      /** `STALE` — a newer link on either side was signed after this message: an older signature never wins. */
      code: "INVALID" | "STALE" | "CONTENDED";
    }>;

async function readRow(store: GuardStore, key: string): Promise<WalletLinkRecord | null> {
  const raw = await store.collection<unknown>(WALLET_LINK_COLLECTION).get(key);
  const parsed = WalletLinkRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Write a verified link — both sides at once or neither, and a history row.
 * Call only with the addresses `verifyWalletLink` returned, for the Solana
 * wallet proven in the request.
 *
 * A side that pointed elsewhere is overwritten; the half it leaves behind on
 * the old partner (that wallet's row still naming this one) no longer agrees
 * and so links nothing (`linkedWallets`).
 */
export async function linkWallets(
  store: GuardStore,
  args: Readonly<{ solana: string; evm: string; signedAt: string; now: string }>,
): Promise<WalletLinkOutcome> {
  const evm = args.evm.toLowerCase();
  const solanaKey = walletLinkKey("solana", args.solana);
  const evmKey = walletLinkKey("evm", evm);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [bySolana, byEvm] = await Promise.all([readRow(store, solanaKey), readRow(store, evmKey)]);
    if (bySolana && byEvm && bySolana.evm === evm && byEvm.solana === args.solana) {
      return { ok: true, created: false, link: bySolana, replaced: { evm: null, solana: null } };
    }
    /* Newest by the moment both wallets signed, not by arrival: a message replayed within its expiry cannot undo a
       link signed after it. */
    if ([bySolana, byEvm].some((row) => row && Date.parse(row.signedAt) > Date.parse(args.signedAt))) return { ok: false, code: "STALE" };
    const base = { schema: 1 as const, solana: args.solana, evm, linkedAt: args.now, signedAt: args.signedAt };
    const solanaRow = WalletLinkRecordSchema.safeParse({ ...base, version: (bySolana?.version ?? 0) + 1 });
    const evmRow = WalletLinkRecordSchema.safeParse({ ...base, version: (byEvm?.version ?? 0) + 1 });
    if (!solanaRow.success || !evmRow.success) return { ok: false, code: "INVALID" };
    const written = await store.compareAndSetMany([
      { collection: WALLET_LINK_COLLECTION, key: solanaKey, expectedVersion: bySolana?.version ?? null, next: solanaRow.data },
      { collection: WALLET_LINK_COLLECTION, key: evmKey, expectedVersion: byEvm?.version ?? null, next: evmRow.data },
      { collection: WALLET_LINK_COLLECTION, key: walletLinkHistoryKey(base), expectedVersion: null, next: { ...base, version: 1 } },
      { collection: WALLET_LINK_COLLECTION, key: walletLinkHistoryKey(base, "evm"), expectedVersion: null, next: { ...base, version: 1 } },
    ]);
    if (written) {
      return {
        ok: true,
        created: true,
        link: solanaRow.data,
        replaced: { evm: bySolana && bySolana.evm !== evm ? bySolana.evm : null, solana: byEvm && byEvm.solana !== args.solana ? byEvm.solana : null },
      };
    }
  }
  return { ok: false, code: "CONTENDED" };
}

export type LinkedRead = Readonly<{ linked: readonly string[]; unavailable: boolean }>;

/** Every wallet this one was ever linked to, from the history — for the self-referral check, never for payouts. */
export async function everLinked(store: GuardStore, family: "solana" | "evm", address: string): Promise<LinkedRead> {
  try {
    const rows = await store.collection<unknown>(WALLET_LINK_COLLECTION).valuesWithPrefix(walletLinkHistoryPrefix(family, address));
    const linked = new Set<string>();
    for (const raw of rows) {
      const parsed = WalletLinkRecordSchema.safeParse(raw);
      if (parsed.success) linked.add(family === "solana" ? parsed.data.evm : parsed.data.solana);
    }
    return { linked: [...linked], unavailable: false };
  } catch {
    return { linked: [], unavailable: true };
  }
}

/**
 * The wallet linked to this one, if both halves of the link agree. A half
 * without its other half — never written, or replaced since — links nothing.
 */
export async function linkedWallets(store: GuardStore, family: "solana" | "evm", address: string): Promise<LinkedRead> {
  try {
    const own = await readRow(store, walletLinkKey(family, address));
    if (!own) return { linked: [], unavailable: false };
    const other = family === "solana" ? await readRow(store, walletLinkKey("evm", own.evm)) : await readRow(store, walletLinkKey("solana", own.solana));
    if (!other || other.solana !== own.solana || other.evm !== own.evm) return { linked: [], unavailable: false };
    return { linked: [family === "solana" ? own.evm : own.solana], unavailable: false };
  } catch {
    return { linked: [], unavailable: true };
  }
}
