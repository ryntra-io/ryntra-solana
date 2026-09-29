import type { Session } from "@/lib/session";

/**
 * Does the identity session in this browser belong to the account the product
 * session names?
 *
 * The two cookies are independent. `rt` says which product account the browser
 * is acting as; the Supabase cookies say which identity the verifier last
 * signed in. A shared browser, a second tab, a recovery link opened while
 * somebody else was signed in — any of these can leave the two pointing at
 * different people, and every identity-sensitive read or write has to notice
 * before it acts. Listing one person's sign-in methods under another person's
 * account, or unlinking a method from the wrong user, is the failure this
 * guards.
 *
 * Three answers, and only one of them permits an identity operation:
 *
 *   `match`     the account is bound to exactly this auth user;
 *   `unbound`   the account has no identity yet — nothing to read, and only
 *               an explicit attach may change that;
 *   `mismatch`  the account belongs to somebody else, or this identity does.
 */
export type IdentityMatch = "match" | "unbound" | "mismatch" | "unavailable";

/**
 * `authUserId` is the verified user of the current identity session, from
 * `getUser()` — never a value decoded from a cookie in the browser.
 *
 * A recorded session carries the account's `auth_user_id` and answers on its
 * own. A legacy stateless session does not, so the account behind the identity
 * is read from the store and compared: the same account is a match, a
 * different one a mismatch, and none at all leaves the account unbound as far
 * as this identity is concerned.
 */
export type AccountLookup = (authUserId: string) => Promise<string | null | undefined>;

/* The store lookup is a parameter with a lazy default so this module stays
   free of the RPC layer at import time — the rule it encodes is worth testing
   on its own, against every combination of the two cookies. */
const defaultLookup: AccountLookup = async (authUserId) => (await import("@/lib/account/rpc")).accountByAuthUser(authUserId);

export async function matchIdentity(session: Session | null, authUserId: string | null, lookup: AccountLookup = defaultLookup): Promise<IdentityMatch> {
  if (!session?.accountId || !authUserId) return "mismatch";

  /* A recorded session carries the binding and answers without a round trip. */
  const bound = session.account?.authUserId ?? null;
  if (bound) return bound === authUserId ? "match" : "mismatch";

  const owner = await lookup(authUserId);
  if (owner === undefined) return "unavailable";
  if (owner === null) return "unbound";
  return owner === session.accountId ? "match" : "mismatch";
}

/**
 * The account a new identity may be attached to from this browser, or `null`.
 *
 * Attaching is how one person keeps one account across two doors: a Telegram
 * bot customer who now signs in with email should land on the row that already
 * holds their plans. It is never implicit. The caller must have an explicit
 * instruction from the person, and the session itself must qualify: an account
 * reached through the bot (or a pre-migration stateless cookie) that carries no
 * identity yet. A session already bound to an auth user has nothing to attach;
 * an account that belongs to somebody else must not be touched at all.
 */
/**
 * A stable name for the session an instruction was given in.
 *
 * An attach instruction has to survive a trip through a mailbox, so it is
 * bound to the session that gave it. A recorded session is named by its row; a
 * pre-migration stateless one by the Telegram id it carries, which is the only
 * identifier it has.
 */
export function sessionKeyOf(session: Session | null): string | null {
  if (!session?.accountId) return null;
  if (session.sessionId) return session.sessionId;
  return session.telegramId !== null ? `tg:${session.telegramId}` : null;
}

export function attachableAccountId(session: Session | null): string | null {
  if (!session?.accountId) return null;
  if (session.account?.authUserId) return null;
  const method = session.method;
  if (method === "solana_siws") {
    return session.sessionId && session.identityWallet && session.account?.wallets.some(
      (wallet) => wallet.chain === "solana" && wallet.address === session.identityWallet,
    ) ? session.accountId : null;
  }
  if (method !== null && method !== "telegram_link") return null;
  return session.accountId;
}
