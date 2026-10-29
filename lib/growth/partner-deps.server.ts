import { resolveInternalWallets } from "../admin/internal-wallets.ts";
import type { GuardStore } from "../guard/store.ts";
import { walletKey } from "./partner.ts";
import type { PartnerDeps } from "./partner-store.ts";

/**
 * The production lookups of the partner check, for every caller of
 * `resolvePartner` and `recordPoolPartner` — the review's read and the launch
 * flow alike, so the two can never disagree about who is the team:
 * - a wallet's profile is the account it was proven to (`account_by_wallet`);
 * - the team is `ownWallets` when the caller has Ryntra's whole list of its
 *   own (the launch runtime's: the internal list «Rewards» reads, the
 *   attribution registry, the executor and the pool payer), and the internal
 *   list alone otherwise. A list that could not be read whole is `null`,
 *   never an empty team.
 */
export function partnerDeps(
  store: GuardStore,
  options: Readonly<{
    env?: Readonly<Record<string, string | undefined>>;
    ownWallets?: () => Promise<Readonly<{ wallets: ReadonlySet<string>; complete: boolean }>>;
  }> = {},
): PartnerDeps {
  return {
    /* Imported when asked, not at load: the launch runtime that builds these
       deps is loaded by tests that never ask, and the account module does not
       resolve under the Node test runner. A lookup that cannot run is
       "unavailable", which the reward rules check again before paying. */
    profileOf: async (family, address) => (await import("../account/rpc")).accountByWallet(family, address),
    async team() {
      if (options.ownWallets) {
        const own = await options.ownWallets();
        return own.complete ? new Set([...own.wallets].map(walletKey)) : null;
      }
      const internal = await resolveInternalWallets(store, options.env ?? process.env);
      if (internal.store !== "measured") return null;
      return new Set([...internal.wallets].map(walletKey));
    },
  };
}
