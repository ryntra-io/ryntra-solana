import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { buildWeekAct, payoutsNetwork, payoutsTreasury, weeklyPass } from "./payouts.server.ts";

// CITY-128b: the partners are paid on their own server-side network; the treasury page's public switch stays off.

test("the payout's network: its own server switch first, the treasury page's only where none is named", () => {
  assert.equal(payoutsNetwork({ RYNTRA_PARTNER_PAYOUTS_NETWORK: "mainnet" }), "mainnet");
  assert.equal(payoutsNetwork({ RYNTRA_PARTNER_PAYOUTS_NETWORK: "devnet", NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "mainnet" }), "devnet");
  assert.equal(payoutsNetwork({ NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK: "devnet" }), "devnet");
  assert.equal(payoutsNetwork({ RYNTRA_PARTNER_PAYOUTS_NETWORK: "testnet" }), null);
  assert.equal(payoutsNetwork({}), null);
  assert.equal(payoutsTreasury({}), null, "no network named: not served");
});

test("off without the switch or a network: the weekly pass reads nothing", async () => {
  const store = createMemoryGuardStore();
  const pass = await weeklyPass({ RYNTRA_PARTNER_PAYOUTS: "on" }, { treasury: null });
  assert.deepEqual(pass, { on: false, prepared: [], existing: [], settled: [] });
  const off = await weeklyPass({}, { treasury: { network: "devnet", connection: null, store, now: () => new Date() } });
  assert.equal(off.on, false);
});

test("a vote or an execution only on the payout's multisig, only at a week's own proposal", async () => {
  const store = createMemoryGuardStore();
  const treasury = { network: "devnet", connection: null, store, now: () => new Date() };
  const env = { RYNTRA_PARTNER_PAYOUTS: "on", RYNTRA_PARTNER_PAYOUTS_MULTISIG: "DgzXyDEWpAhkhoHCP3eq8wrr74XLZX8Jj1kVk3hQCEMj" };
  const wallet = "CVxRDzhCWETx7NsysmYtMWFmAkcHbf1vddQ6qv797kkD";
  assert.equal((await buildWeekAct(treasury, { week: "2026-11-02", wallet, act: "execute" }, {})).code, "PAYOUTS_OFF");
  assert.equal((await buildWeekAct(treasury, { week: "2026-11-02", wallet, act: "approve" }, env)).code, "WEEK_NOT_PROPOSED");
});

test("the payout page signs through the payout's own route, never the treasury page's", () => {
  const panel = readFileSync(new URL("../../app/admin/growth/payouts/weekly-panel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /\/api\/solana\/treasury/);
  const route = readFileSync(new URL("../../app/api/admin/partner-payouts/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /treasuryDeps\(/);
  assert.match(route, /payoutsTreasury\(\)/);
  for (const path of ["../../app/api/partners/earnings/route.ts", "./payouts.server.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), "utf8"), /treasuryDeps\(\)/, path);
  }
});
