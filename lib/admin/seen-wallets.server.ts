import type { GuardStore } from "../guard/store.ts";
import { RewardAccountSchema } from "../rewards/referral.ts";
import { SolanaWalletActionSchema, type SolanaWalletAction } from "../solana/action-ledger.ts";
import { internalWalletsFromEnv, listInternalWallets } from "./internal-wallets.ts";
import { projectSeenWallets, type SeenWalletsModel } from "./seen-wallets.ts";
import { listWalletPresence } from "./wallet-presence.ts";

/** The store reads behind the owner's wallet list; nothing here throws into a route. */
export async function readSeenWallets(
  store: GuardStore,
  args: Readonly<{ now: string; env: NodeJS.ProcessEnv }>,
): Promise<Readonly<{ model: SeenWalletsModel; unavailable: readonly string[] }>> {
  const unavailable: string[] = [];
  const scan = async <T,>(name: Parameters<GuardStore["collection"]>[0], prefix: string, parse: (row: unknown) => T | null): Promise<T[]> => {
    try {
      const raw = await store.collection<unknown>(name).valuesWithPrefix(prefix);
      return raw.flatMap((row) => { const parsed = parse(row); return parsed === null ? [] : [parsed]; });
    } catch {
      unavailable.push(name);
      return [];
    }
  };
  const [presence, actions, accounts, internal] = await Promise.all([
    listWalletPresence(store),
    scan<SolanaWalletAction>("solanaWalletActions", "solana:mainnet:", (row) => { const p = SolanaWalletActionSchema.safeParse(row); return p.success ? p.data : null; }),
    scan("rewardAccounts", "", (row) => { const p = RewardAccountSchema.safeParse(row); return p.success ? { wallet: p.data.wallet, referrer: p.data.referrer, createdAt: p.data.createdAt } : null; }),
    listInternalWallets(store),
  ]);
  if (presence.status !== "measured") unavailable.push("walletPresence");
  if (internal.status !== "measured") unavailable.push("adminInternalWallets");
  const model = projectSeenWallets({
    now: args.now,
    presence: presence.status === "measured" ? presence.rows : [],
    actions,
    accounts,
    internal: internal.status === "measured" ? internal.rows : [],
    fromEnv: internalWalletsFromEnv(args.env),
  });
  return { model, unavailable };
}
