/*
 * What a verified Telegram identity has to carry before it may become an
 * account.
 *
 * The first real Telegram OpenID sign-in (2026-09-06) created a sixth, empty
 * account instead of landing on the person's existing bot account: Supabase's
 * custom OIDC provider had kept the standard claims and dropped Telegram's
 * `id`, and the resolver treated «no id» as «new customer». These cases pin
 * the claim shape that was actually observed and the rule that now refuses
 * to guess.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { summarizeIdentity, telegramIdMissing, telegramIdOf } from "./identity-summary.ts";

const USER_ID = "5b0c7e2a-8f41-4d6e-9a3b-1c2d3e4f5a6b";

/* The exact key set production stored for the Telegram identity — `sub` is a
   19-digit pairwise subject, and there is no `id`. Values are stand-ins. */
const PRODUCTION_SHAPE = {
  aud: "8110775576",
  email_verified: false,
  exp: 1_757_200_000,
  given_name: "Alex",
  iat: 1_757_196_400,
  iss: "https://oauth.telegram.org",
  name: "Alex",
  phone_verified: false,
  picture: "https://cdn4.telesco.pe/file/x.jpg",
  preferred_username: "alex",
  sub: "1234123412341234123",
};

function telegramUser(identityData, extra = {}) {
  return {
    id: USER_ID,
    email: undefined,
    email_confirmed_at: undefined,
    user_metadata: { ...identityData },
    identities: [{ identity_id: "i1", id: identityData.sub, user_id: USER_ID, provider: "custom:telegram", identity_data: identityData }],
    ...extra,
  };
}

test("the production claim shape carries no Telegram id, and says so", () => {
  const identity = summarizeIdentity(telegramUser(PRODUCTION_SHAPE), "telegram");
  assert.equal(identity.provider, "telegram");
  assert.equal(identity.telegramId, null);
  assert.equal(identity.displayName, "Alex");
  assert.equal(telegramIdMissing(identity), true, "no id means no silent account creation");
});

test("the pairwise subject is never read as the Telegram user id", () => {
  /* `sub` is numeric, which is exactly why it must not be mistaken for `id`. */
  assert.equal(telegramIdOf({ sub: "1234123412341234123" }), null);
  assert.equal(telegramIdOf({ sub: "987654321" }), null);
});

test("the documented `id` claim of the profile scope is the Telegram id", () => {
  assert.equal(telegramIdOf({ ...PRODUCTION_SHAPE, id: 987654321 }), 987654321);
  assert.equal(telegramIdOf({ ...PRODUCTION_SHAPE, id: "987654321" }), 987654321);
  const identity = summarizeIdentity(telegramUser({ ...PRODUCTION_SHAPE, id: 987654321 }), "telegram");
  assert.equal(identity.telegramId, 987654321);
  assert.equal(telegramIdMissing(identity), false);
});

test("an id that cannot be a Telegram user id is not one", () => {
  assert.equal(telegramIdOf({ id: 0 }), null);
  assert.equal(telegramIdOf({ id: -5 }), null);
  assert.equal(telegramIdOf({ id: "12ab" }), null);
  assert.equal(telegramIdOf({ id: "1".repeat(16) }), null);
  assert.equal(telegramIdOf(undefined), null);
});

test("the rule fires without a method hint when the identities say Telegram", () => {
  const identity = summarizeIdentity(telegramUser(PRODUCTION_SHAPE));
  assert.equal(identity.provider, "telegram");
  assert.equal(telegramIdMissing(identity), true);
});

test("email and Google identities are outside the rule", () => {
  const email = summarizeIdentity(
    {
      id: USER_ID,
      email: "walker@example.test",
      email_confirmed_at: "2026-09-06T12:00:00Z",
      user_metadata: {},
      identities: [{ identity_id: "i2", id: USER_ID, user_id: USER_ID, provider: "email", identity_data: { sub: USER_ID, email: "walker@example.test" } }],
    },
    "email",
  );
  assert.equal(email.provider, "email");
  assert.equal(email.telegramId, null);
  assert.equal(telegramIdMissing(email), false);

  const google = summarizeIdentity({
    id: USER_ID,
    email: "walker@example.test",
    email_confirmed_at: "2026-09-06T12:00:00Z",
    user_metadata: { full_name: "Walker" },
    identities: [{ identity_id: "i3", id: "g-1", user_id: USER_ID, provider: "google", identity_data: { sub: "g-1", email: "walker@example.test" } }],
  });
  assert.equal(google.provider, "google");
  assert.equal(telegramIdMissing(google), false);
});

test("a person with email and a Telegram identity that lacks the id is still under the rule", () => {
  /* Two providers on one Supabase user: the Telegram side still cannot be
     mapped, so the creation branch must not run on the strength of the email. */
  const both = summarizeIdentity({
    id: USER_ID,
    email: "walker@example.test",
    email_confirmed_at: "2026-09-06T12:00:00Z",
    user_metadata: {},
    identities: [
      { identity_id: "i2", id: USER_ID, user_id: USER_ID, provider: "email", identity_data: { sub: USER_ID, email: "walker@example.test" } },
      { identity_id: "i1", id: PRODUCTION_SHAPE.sub, user_id: USER_ID, provider: "custom:telegram", identity_data: PRODUCTION_SHAPE },
    ],
  });
  assert.equal(telegramIdMissing(both), true);
});
