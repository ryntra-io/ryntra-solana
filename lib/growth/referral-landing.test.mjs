import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { changeReferrer, ensureRewardAccount, readRewardAccount } from "../rewards/ledger.ts";
import { carriedCodeHolds, REFERRAL_FIRST_TOUCH_MS } from "../rewards/referral.ts";
import { readReferralState } from "../rewards/referral-state.server.ts";
import { normalizeReferralSub } from "../rewards/referral-sub.ts";
import { refParamRedirect } from "./ref-param.ts";
import { INVITE_LANDING_PARAM, readInviteLanding, referralLanding, referralTarget } from "./referral-landing.ts";

/*
 * Ryntra Partners R3 — attribution and the landing: binding at wallet connect, the first valid link wins, a bound
 * wallet stays bound, sub-IDs kept, and `/r/<code>` lands in the city — never on a page of the old interface.
 */

const A = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const B = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const C = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const CODE = "BCDFGHJKLMNP";
const NOW = "2026-10-29T12:00:00.000Z";

test("the landing is the city with the invitation: `/?invite=<code>&s=<sub-ID>`, never `?ref=` (which would loop)", () => {
  assert.equal(referralLanding(CODE, "x-thread", "https://ryntra.io/r/BCDFGHJKLMNP?s=x-thread").href, `https://ryntra.io/?${INVITE_LANDING_PARAM}=${CODE}&s=x-thread`);
  assert.equal(referralLanding(CODE, null, "https://ryntra.io/r/x").href, `https://ryntra.io/?invite=${CODE}`);
  assert.equal(referralLanding(CODE, "<script>", "https://ryntra.io/r/x").search, `?invite=${CODE}`, "a sub-ID that is not one is dropped");
  assert.equal(referralLanding("nope", "x", "https://ryntra.io/r/x").href, "https://ryntra.io/", "no code, no invitation");
  /* The landing is not an address the middleware sends back to `/r/`. */
  assert.equal(refParamRedirect(referralLanding(CODE, "x", "https://ryntra.io/")), null);
  assert.deepEqual(readInviteLanding(new URLSearchParams(`invite=${CODE.toLowerCase()}&s=tg`)), { code: CODE, sub: "tg" });
  assert.equal(readInviteLanding(new URLSearchParams("s=tg")), null);
});

test("`/r/<code>` leads to the city or the product page it names — never the old «Винагороди» — and the first valid link holds for the cookie's life", () => {
  const route = readFileSync(new URL("../../app/r/[code]/route.ts", import.meta.url), "utf8");
  assert.match(route, /referralTarget\(/);
  assert.doesNotMatch(route, /\/app\/rewards/);
  const base = "https://ryntra.io/r/" + CODE;
  assert.equal(referralTarget(null, CODE, "x", base).href, `https://ryntra.io/?invite=${CODE}&s=x`);
  assert.equal(referralTarget("/app/rewards", CODE, null, base).href, `https://ryntra.io/?invite=${CODE}`);
  assert.equal(referralTarget("//evil.example/app", CODE, null, base).href, `https://ryntra.io/?invite=${CODE}`);
  assert.equal(referralTarget("/app/launch/F4pmJAEZDtJ4JPE7QwK7zrD6R1Ypgi7nTCGxTM7AsLGQ", CODE, null, base).href, "https://ryntra.io/app/launch/F4pmJAEZDtJ4JPE7QwK7zrD6R1Ypgi7nTCGxTM7AsLGQ");
  /* The look at whether a carried code is anybody's sits behind the read limiter. */
  assert.match(route, /consumeSolanaReadRequest\(req\.headers\)\.allowed/);
  assert.equal(REFERRAL_FIRST_TOUCH_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(carriedCodeHolds(String(Date.parse(NOW) - 2 * 24 * 60 * 60 * 1000), Date.parse(NOW)), true, "a day-old code is not replaced any more");
});

test("`?ref=CODE&s=SUB` on a page carries the sub-ID to `/r/<code>`; a malformed one is left where it was", () => {
  assert.equal(refParamRedirect(new URL(`https://ryntra.io/?ref=${CODE}&s=x-thread`)).href, `https://ryntra.io/r/${CODE}?s=x-thread`);
  const bad = refParamRedirect(new URL(`https://ryntra.io/?ref=${CODE}&s=a%20b`));
  assert.equal(bad.searchParams.get("s"), null);
  assert.equal(normalizeReferralSub(" partner_01 "), "partner_01");
  assert.equal(normalizeReferralSub("x".repeat(33)), null);
});

test("binding at wallet connect keeps the sub-ID; a bound wallet stays bound to its first inviter; a change drops the sub-ID", async () => {
  const store = createMemoryGuardStore();
  const a = await ensureRewardAccount(store, A, NOW);
  const c = await ensureRewardAccount(store, C, NOW);
  /* No wallet proven: nothing written. */
  const guest = await readReferralState(store, { wallet: null, carried: a.code, now: NOW, carriedSub: "x-thread" });
  assert.equal(guest.body.confirmed, null);
  assert.equal(await readRewardAccount(store, B), null);
  /* The wallet connects: bound, with the link's sub-ID. */
  const bound = await readReferralState(store, { wallet: B, carried: a.code, now: NOW, carriedSub: "x-thread" });
  assert.equal(bound.body.bound, true);
  const account = await readRewardAccount(store, B);
  assert.deepEqual([account.referrer, account.referralSubId], [A, "x-thread"]);
  /* A later link from somebody else binds nothing: the first inviter stays. */
  const later = await readReferralState(store, { wallet: B, carried: c.code, now: "2026-10-29T13:00:00.000Z", carriedSub: "tg" });
  assert.equal(later.body.bound, undefined);
  assert.equal((await readRewardAccount(store, B)).referrer, A);
  /* The one deliberate change is the person's own — and the sub-ID belonged to the first link. */
  assert.equal((await changeReferrer(store, { wallet: B, code: c.code, now: "2026-10-29T14:00:00.000Z" })).ok, true);
  const changed = await readRewardAccount(store, B);
  assert.deepEqual([changed.referrer, changed.referralSubId], [C, undefined]);
});
