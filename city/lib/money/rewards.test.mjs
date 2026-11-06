import { test } from "node:test";
import assert from "node:assert/strict";

import { creditsOf, pointsOf, setRewardsEnv, useRewards } from "./rewards.ts";

test("points and credits are read from the engines' own answers; absent is null, never zero", () => {
  assert.deepEqual(pointsOf({ points: { points: "12 400", level: 3, rank: 41, ranked: 900 } }), { points: "12 400", level: 3, rank: 41, ranked: 900 });
  assert.equal(pointsOf({ points: null }), null);
  assert.deepEqual(creditsOf({ balance: 120, free: { left: 4 } }), { balance: 120, freeLeft: 4 });
  assert.equal(creditsOf(null), null);
});

test("without a proof the block asks for one tap and never opens the wallet by itself", async () => {
  let proved = 0;
  setRewardsEnv({ fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }), prove: async () => (proved++, { ok: true }), now: () => 1 });
  await useRewards.getState().read("Owner1111111111111111111111111111111111111");
  assert.equal(useRewards.getState().status, "proof");
  assert.equal(proved, 0);
});

test("with a proof it reads rewards and credits together", async () => {
  useRewards.getState().reset();
  setRewardsEnv({
    fetch: async (url) => ({ ok: true, status: 200, json: async () => (url.includes("credits") ? { balance: 50, free: { left: 2 } } : { ok: true, points: { points: "900", level: 1, rank: null, ranked: 10 }, referral: {}, referrals: {}, rank: null }) }),
    now: () => 2,
  });
  await useRewards.getState().read("Owner1111111111111111111111111111111111111");
  const st = useRewards.getState();
  assert.equal(st.status, "ready");
  assert.equal(st.view.points.points, "900");
  assert.equal(st.view.credits.balance, 50);
});
