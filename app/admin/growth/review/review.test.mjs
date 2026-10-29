import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../../../../lib/guard/store.ts";
import { poolSubject, walletSubject } from "../../../../lib/growth/review.ts";
import { readReviewQueue } from "../../../../lib/growth/review-queue.ts";
import { actOnCase, raiseSignals } from "../../../../lib/growth/review-store.ts";

const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const POOL_2 = "AFoxY8SRfJ2SmCYNRWgXsMN27PpJyy2iUk2zGYsrXc7K";
const PARTNER = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";

test("the queue: open cases first, the overdue at the top; decided and frozen after; counts", async () => {
  const store = createMemoryGuardStore();
  await raiseSignals(store, { subject: poolSubject("solana", POOL), codes: ["S1_SHARED_FUNDING"], now: "2026-10-01T00:00:00.000Z" });
  await raiseSignals(store, { subject: poolSubject("solana", POOL_2), codes: ["S5_YOUNG_WALLETS", "S6_ROUND_TRIP"], now: "2026-10-03T00:00:00.000Z" });
  await actOnCase(store, { subject: walletSubject(PARTNER), action: { kind: "FREEZE", note: "Three wallets on one phone." }, by: "admin:1", now: "2026-10-03T01:00:00.000Z" });
  const queue = await readReviewQueue(store, { now: "2026-10-05T00:00:00.000Z" });
  assert.deepEqual(queue.cases.map((item) => [item.subject, item.state, item.overdue, item.trust]), [
    [poolSubject("solana", POOL), "OPEN", true, 60],
    [poolSubject("solana", POOL_2), "OPEN", false, 70],
    [walletSubject(PARTNER), "NONE", false, 100],
  ]);
  assert.deepEqual(queue.counts, { open: 2, overdue: 1, frozen: 1, awaitingActivation: 0 });
  assert.equal(queue.cases[2].dueAt, "2026-10-06T01:00:00.000Z", "a freeze is answered within 72 hours too");
  assert.deepEqual(queue.cases[0].events.map((event) => [event.kind, event.by]), [["OPENED", "system"]]);
  /* A wallet's case is never adjusted to an amount; a cleared case has nothing to appeal. */
  assert.deepEqual(await actOnCase(store, { subject: walletSubject(PARTNER), action: { kind: "DECIDE", decision: "ADJUST", ceilingUsdMicros: "1", note: "x", seen: 0 }, by: "admin:1", now: "2026-10-05T00:00:00.000Z" }), { ok: false, code: "INVALID" });
  await actOnCase(store, { subject: poolSubject("solana", POOL_2), action: { kind: "DECIDE", decision: "CLEAR", note: "Real traders.", seen: 0 }, by: "admin:1", now: "2026-10-05T00:00:00.000Z" });
  assert.deepEqual(await actOnCase(store, { subject: poolSubject("solana", POOL_2), action: { kind: "APPEAL", note: "?" }, by: "person", now: "2026-10-05T01:00:00.000Z" }), { ok: false, code: "NOT_OPEN" });
});

test("the reviewer's route: a fresh second factor, the origin, a reason for every step; the queue read is the admin's alone", () => {
  const route = read("app/api/admin/growth/review/route.ts");
  assert.match(route, /requireFreshMfa\(\)/);
  assert.match(route, /mutationOriginAllowed\(/);
  assert.match(route, /reason_required/);
  assert.match(route, /export async function GET\(\) \{\n  const admin = await getAdminSession\(\);\n  if \(!admin\) return json\(\{ error: "unauthorized" \}, 401\);/);
  assert.match(route, /by = `admin:\$\{gate\.admin\.telegramId\}`/);
  assert.match(route, /bad_seen/, "a decision names the last event the reviewer saw");
});

test("the person's appeal: proof of the wallet, only on one's own pool, never a reason in the answer", () => {
  const route = read("app/api/growth/partner/appeal/route.ts");
  assert.match(route, /getWalletProofFrom\(req\.headers\)/);
  assert.match(route, /binding\.partner !== proof\.address/);
  assert.doesNotMatch(route, /signals|reason:/);
  assert.match(route, /return json\(\{ ok: true \}\);/, "one answer whatever stands behind the pool");
});

test("a frozen wallet opens no payout, and its page says it is reviewed — never why; devices only for a proven wallet", () => {
  const claim = read("app/api/rewards/claim/route.ts");
  const held = claim.indexOf("walletHold(store, wallet, now)");
  assert.ok(held > 0 && held < claim.indexOf("openClaim(store"), "the freeze is checked before a payout opens");
  assert.match(claim, /state: "STOPPED", reason: "Payouts from this wallet were stopped after a review\."/, "a stopped wallet is told so, as on its page");
  const rewards = read("app/api/rewards/route.ts");
  assert.match(rewards, /claimable: view\.balance\.claimable && payoutsEnabled && !held/);
  assert.match(rewards, /Виплата на перевірці\. Відповімо протягом 72 годин\./);
  assert.ok(rewards.indexOf("noteDevice(") > rewards.indexOf("proof.address !== address"), "a sighting only after the proof");
  assert.match(read("app/api/rewards/balance/route.ts"), /claimable: balance\.claimable && config\.configured && config\.canSign && hold === "NONE"/, "the header never says ready for a held wallet");
  const partner = read("app/api/growth/partner/route.ts");
  assert.match(partner, /if \(proven\) await noteDevice\(store, creator, req\.headers\);/);
});

test("the admin's menu has the review, and the page is the admin's alone", () => {
  assert.match(read("app/admin/shell/nav.ts"), /\{ id: "growth", label: "Перевірка Росту", href: "\/admin\/growth\/review", group: "insights" \}/);
  const page = read("app/admin/growth/review/page.tsx");
  assert.match(page, /if \(!admin\) return <AdminUnauthorized/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});
