/**
 * Who an account-bound RPC acts for.
 *
 * Every RPC that keeps personal data (plans, paper trades, journal notes,
 * language) resolves its actor in the database through
 * `private.account_actor(p_telegram_id, p_account_id, scope)`: the account id
 * wins when it is known, and the Telegram id is the legacy path with its old
 * channel-join requirement. A caller therefore passes both and never decides
 * for itself which door a person used.
 *
 * `accountId` is `null` for a legacy session read before the accounts
 * migration projected the account uuid into the state; such a session keeps
 * working exactly as before through the Telegram path.
 */
export type AccountSubject = Readonly<{
  accountId: string | null;
  telegramId: number | null;
}>;

/** The RPC arguments the account-aware functions expect. */
export function subjectArgs(subject: AccountSubject): { p_telegram_id: number | null; p_account_id: string | null } {
  return { p_telegram_id: subject.telegramId, p_account_id: subject.accountId };
}

/** A stable per-person key for rate limiting and idempotency scopes. */
export function subjectKey(subject: AccountSubject): string {
  if (subject.accountId) return `account:${subject.accountId}`;
  if (subject.telegramId !== null) return `telegram:${subject.telegramId}`;
  return "anonymous";
}

/** True when the subject can reach any account-keyed RPC at all. */
export function subjectPresent(subject: AccountSubject): boolean {
  return subject.accountId !== null || subject.telegramId !== null;
}
