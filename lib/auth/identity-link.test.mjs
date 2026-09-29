/*
 * The rule that keeps two people in one browser apart.
 *
 * `rt` says which account the product is acting as; the Supabase cookies say
 * which identity the verifier last signed in. They are independent, and every
 * identity-sensitive read or write has to notice when they disagree before it
 * acts. These are the cases that used to pass silently.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { attachableAccountId, matchIdentity } from "./identity-link.ts";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** A recorded session: it carries the account's binding itself. */
function recorded(accountId, authUserId, method = "email_password") {
  return { accountId, sessionId: "s1", method, account: { authUserId, telegramLinked: false, operator: false, wallets: [] } };
}

/** A legacy stateless session: no recorded row, so the store has to be asked. */
function legacy(accountId) {
  return { accountId, sessionId: null, method: null, account: null };
}

const never = async () => {
  throw new Error("the store must not be asked when the session already carries the binding");
};

test("a recorded session answers from its own binding, without a store round trip", async () => {
  assert.equal(await matchIdentity(recorded(ACCOUNT_A, USER_A), USER_A, never), "match");
  assert.equal(await matchIdentity(recorded(ACCOUNT_A, USER_A), USER_B, never), "mismatch");
});

test("a verified wallet account can explicitly attach its first optional contact identity", () => {
  const session = { ...recorded(ACCOUNT_A, null, "solana_siws"), identityWallet: "wallet-a",
    account: { authUserId: null, wallets: [{ chain: "solana", address: "wallet-a" }] } };
  assert.equal(attachableAccountId(session), ACCOUNT_A);
  assert.equal(attachableAccountId({ ...session, identityWallet: "wallet-b" }), null);
  assert.equal(attachableAccountId({ ...session, account: { ...session.account, authUserId: USER_A } }), null);
});

test("product session A with identity session B is a mismatch, never a match", async () => {
  /* The failure this exists for: A's settings page listing B's addresses, and
     an unlink from A's screen removing B's sign-in method. */
  const lookup = async (id) => (id === USER_B ? ACCOUNT_B : ACCOUNT_A);
  assert.equal(await matchIdentity(legacy(ACCOUNT_A), USER_B, lookup), "mismatch");
  assert.equal(await matchIdentity(recorded(ACCOUNT_A, USER_A), USER_B, never), "mismatch");
});

test("an identity bound to nothing leaves the account unbound, which is not a match", async () => {
  /* «Unbound» is the legacy account meeting its first identity. It permits an
     explicit attach and nothing else — in particular it must not be read as
     permission to list or unlink. */
  assert.equal(await matchIdentity(legacy(ACCOUNT_A), USER_A, async () => null), "unbound");
});

test("a store that does not answer is never reported as agreement", async () => {
  assert.equal(await matchIdentity(legacy(ACCOUNT_A), USER_A, async () => undefined), "unavailable");
});

test("no session, or no identity, is a mismatch", async () => {
  assert.equal(await matchIdentity(null, USER_A, never), "mismatch");
  assert.equal(await matchIdentity(legacy(ACCOUNT_A), null, never), "mismatch");
  assert.equal(await matchIdentity({ accountId: null, sessionId: null, method: null, account: null }, USER_A, never), "mismatch");
});

test("only a bot-reached account with no identity of its own can be attached to", () => {
  assert.equal(attachableAccountId(legacy(ACCOUNT_A)), ACCOUNT_A);
  assert.equal(attachableAccountId(recorded(ACCOUNT_A, null, "telegram_link")), ACCOUNT_A);

  /* Already has an identity: there is nothing to attach, and binding a second
     one to the same account is the collision the database refuses anyway. */
  assert.equal(attachableAccountId(recorded(ACCOUNT_A, USER_A)), null);
  /* Reached through an account door: this session is already somebody's
     identity, so «attach to what this browser holds» would mean joining two
     separate people. */
  assert.equal(attachableAccountId(recorded(ACCOUNT_A, null, "google_oidc")), null);
  assert.equal(attachableAccountId(null), null);
});
