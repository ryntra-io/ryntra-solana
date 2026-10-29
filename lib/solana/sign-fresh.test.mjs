import { test } from "node:test";
import assert from "node:assert/strict";

import { signFreshBytes } from "./sign-fresh.ts";

/** A stand clock: the wallet "takes" as long as the script says. */
function stand(walletSeconds) {
  let clock = 0;
  const built = [];
  const signedBuilds = [];
  let rebuilt = 0;
  const run = () =>
    signFreshBytes({
      now: () => clock,
      build: async () => {
        built.push(clock);
        return { ok: true, data: { id: built.length, signableMs: 25_000 } };
      },
      signableMsOf: (b) => b.signableMs,
      sign: async (b) => {
        clock += (walletSeconds[b.id - 1] ?? 1) * 1_000;
        signedBuilds.push(b.id);
        return { ok: true, value: `sig-${b.id}` };
      },
      onRebuild: () => {
        rebuilt += 1;
      },
    });
  return { run, built, signedBuilds, rebuilt: () => rebuilt };
}

test("a wallet answered inside the window: one build, those bytes go", async () => {
  const s = stand([8]);
  const out = await s.run();
  assert.equal(out.ok, true);
  assert.equal(out.built.id, 1);
  assert.equal(out.builds, 1);
});

for (const seconds of [25, 30, 35, 40, 45]) {
  test(`a wallet answered after ${seconds} s: the bytes are built again, not sent dead`, async () => {
    const s = stand([seconds, 5]);
    const out = await s.run();
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.equal(out.built.id, 2, "the fresh build is what is sent");
    assert.equal(out.signed, "sig-2");
    assert.equal(s.rebuilt(), 1);
  });
}

test("two slow answers in a row stop — no loop of prompts, nothing sent", async () => {
  const s = stand([40, 40, 40]);
  const out = await s.run();
  assert.deepEqual(out, { ok: false, stage: "aged" });
  assert.deepEqual(s.signedBuilds, [1, 2]);
});

test("a refused build or wallet is answered as itself", async () => {
  const refused = await signFreshBytes({
    build: async () => ({ ok: false, code: "LAUNCH_PAUSED" }),
    signableMsOf: () => 25_000,
    sign: async () => assert.fail("no wallet without bytes"),
  });
  assert.deepEqual(refused, { ok: false, stage: "build", failure: { ok: false, code: "LAUNCH_PAUSED" } });
  const declined = await signFreshBytes({
    build: async () => ({ ok: true, data: {} }),
    signableMsOf: () => undefined,
    sign: async () => ({ ok: false, reason: "User rejected" }),
  });
  assert.deepEqual(declined, { ok: false, stage: "sign", reason: "User rejected" });
});

test("bytes that arrive with too little window never open the wallet", async () => {
  let opened = 0;
  const out = await signFreshBytes({
    build: async () => ({ ok: true, data: { signableMs: 4_000 } }),
    signableMsOf: (b) => b.signableMs,
    sign: async () => ((opened += 1), { ok: true, value: "x" }),
  });
  assert.deepEqual(out, { ok: false, stage: "aged" });
  assert.equal(opened, 0);
});

test("the window counts from the build's arrival: a slow build is not charged twice", async () => {
  let clock = 0;
  let opened = 0;
  const out = await signFreshBytes({
    now: () => clock,
    /* The server took 8 s and measured 15 s left at its end. */
    build: async () => ((clock += 8_000), { ok: true, data: { signableMs: 15_000 } }),
    signableMsOf: (b) => b.signableMs,
    sign: async () => ((opened += 1), (clock += 3_000), { ok: true, value: "sig" }),
  });
  assert.equal(out.ok, true);
  assert.equal(opened, 1);
});

test("the rebuild says why: a late answer, or bytes too short to ask a wallet", async () => {
  const reasons = [];
  let clock = 0;
  let builds = 0;
  await signFreshBytes({
    now: () => clock,
    build: async () => ((builds += 1), { ok: true, data: { signableMs: builds === 1 ? 4_000 : 25_000 } }),
    signableMsOf: (b) => b.signableMs,
    sign: async () => ({ ok: true, value: "sig" }),
    onRebuild: (why) => reasons.push(why),
  });
  assert.deepEqual(reasons, ["short"]);
});
