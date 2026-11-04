import type { GuardStore } from "../guard/store.ts";
import {
  bindReferrer,
  ensureEarningSince,
  readReferralBindWindow,
  readReferralChangeWindow,
  readRewardAccount,
  walletForCode,
} from "./ledger.ts";
import { maskCode, maskWallet } from "./referral.ts";

/**
 * What `GET /api/rewards/referral` answers about the invitation a browser
 * carries — and the one write it makes: binding that invitation on its own for
 * the browser's proven wallet while the window is open.
 *
 * Kept out of the route so it can be tested without Next. The route reads the
 * cookie and the proof; this decides.
 *
 * ## The rules it applies
 *
 * - No proven wallet: the carried invitation is reported, nothing is written.
 * - The wallet's own link: never offered back to it, and the cookie goes — an
 *   inviter checking their own link must not be told they invited themselves.
 * - No inviter yet, window open: bind now (`bound: true` on this read only). A
 *   refusal that can never succeed (a cycle) clears the cookie; a failure that
 *   might (contention, a store hiccup) leaves the invitation as it was.
 * - No inviter, window shut: the invitation is reported with the honest "too
 *   late" (the page draws it in the invite panel, not at the top); the cookie
 *   stays — clearing it on this read would hide the answer from the read that
 *   follows a moment later.
 * - An inviter already: another inviter's link is offered as the one change
 *   while that is still possible; otherwise the cookie is noise and goes.
 */
export type ReferralRead = Readonly<{ body: Record<string, unknown>; clearCookie: boolean }>;

export async function readReferralState(
  store: GuardStore,
  args: Readonly<{ wallet: string | null; carried: string | null; now: string; /** The carried link's sub-ID, kept on the binding. */ carriedSub?: string | null }>,
): Promise<ReferralRead> {
  const carriedWallet = args.carried ? await walletForCode(store, args.carried) : null;
  let pending = args.carried && carriedWallet
    ? { code: args.carried, inviterMasked: maskWallet(carriedWallet), codeMasked: maskCode(args.carried) }
    : null;
  if (!args.wallet) return { body: { ok: true, pending, confirmed: null }, clearCookie: false };

  let clearCookie = false;
  if (carriedWallet === args.wallet) {
    pending = null;
    clearCookie = true;
  }

  let account = await readRewardAccount(store, args.wallet);
  /* A record earning since before `earningSince` existed is dated once and
     written back, rather than re-dated from its rows on every read. */
  if (account?.earning && !account.earningSince) account = await ensureEarningSince(store, args.wallet, args.now);
  let bound = false;
  if (!account?.referrer && pending) {
    const window = await readReferralBindWindow(store, account, args.now);
    if (window?.open) {
      try {
        const decision = await bindReferrer(store, { wallet: args.wallet, code: pending.code, now: args.now, subId: args.carriedSub ?? null });
        if (decision.ok) {
          bound = true;
          account = await readRewardAccount(store, args.wallet);
        } else if (decision.code === "CYCLE" || decision.code === "SELF_REFERRAL" || decision.code === "UNKNOWN_CODE") {
          pending = null;
          clearCookie = true;
        }
      } catch {
        /* Contention past the retry budget: the invitation stays carried and
           the next read tries again. Never a failed page. */
      }
    }
  }

  if (account?.referrer) {
    const change = await readReferralChangeWindow(store, account, args.now);
    const offer = pending && !bound && carriedWallet !== account.referrer && change.open ? pending : null;
    return {
      body: {
        ok: true,
        pending: offer,
        confirmed: { inviterMasked: maskWallet(account.referrer), codeMasked: bound ? (pending?.codeMasked ?? null) : null },
        change,
        ...(bound ? { bound: true } : {}),
      },
      clearCookie: Boolean(args.carried) && !offer,
    };
  }

  const binding = await readReferralBindWindow(store, account, args.now);
  return { body: { ok: true, pending, confirmed: null, ...(binding ? { binding } : {}) }, clearCookie };
}
