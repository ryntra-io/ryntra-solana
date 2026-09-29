// Run from repo root:
// node --test --test-isolation=none lib/agent-control/payments/current.test.mjs
//
// The projection a page reads. These tests pin the facts the surface is
// allowed to state, so a screen can never say more than the engine does.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMMERCE_BLOCKERS,
  SAMPLE_COMMERCE_POLICY,
  buildCommerceSurface,
  networkLabel,
  pairingMatrix,
  routeSlice,
} from "./current.ts";

const BSC = "eip155:56";
const USDT = `${BSC}/erc20:0x55d398326f99059fF775485246999027B3197955`;
const USDC = `${BSC}/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`;

test("the surface reports what resolves out of what was asked, not a percentage", () => {
  const surface = buildCommerceSurface();
  /* Nine of two hundred and eight. A percentage would round that to 4% and hide
     the denominator that makes the number mean anything — the same reason the
     coverage dashboard reports `counted of total`. */
  assert.equal(surface.totals.allowed, 9);
  assert.equal(surface.totals.total, 208);
  assert.ok(surface.totals.allowed < surface.totals.total);
  for (const projection of surface.implementations) {
    assert.equal(
      projection.allowedCount,
      projection.slices.reduce((sum, slice) => sum + slice.allowedCount, 0),
      `${projection.declaration.id} miscounts its own allowed routes`,
    );
  }
});

test("only the implementation whose source publishes contracts resolves anything", () => {
  const surface = buildCommerceSurface();
  const byId = new Map(surface.implementations.map((entry) => [entry.declaration.id, entry]));
  assert.ok(byId.get("BINANCE_B402").allowedCount > 0);
  assert.ok(byId.get("VISTARA_B402").allowedCount > 0);
  assert.equal(byId.get("COINBASE_X402").allowedCount, 0);
  assert.equal(byId.get("SELF_HOSTED_X402").allowedCount, 0);
  /* A self-hosted facilitator has no declared deployment, so it has no slices
     at all. The surface has to say that rather than render nothing. */
  assert.equal(byId.get("SELF_HOSTED_X402").slices.length, 0);
});

test("the network that is live is the one with no declarable asset", () => {
  const surface = buildCommerceSurface();
  const binance = surface.implementations.find((entry) => entry.declaration.id === "BINANCE_B402");
  const testnet = binance.slices.find((slice) => slice.network === "eip155:97");
  assert.ok(testnet, "the testnet slice must be shown, not omitted");
  assert.equal(testnet.assetRef, null);
  assert.equal(testnet.allowedCount, 0);
  /* The cells that get as far as the asset all refuse there. The rest never
     reach it, because a facilitator this implementation does not run through is
     refused first — and reporting the nearer failure is the point of the order. */
  const reachedTheAsset = testnet.cells.filter((cell) => cell.facilitator === "BINANCE");
  assert.equal(reachedTheAsset.length, 4);
  assert.ok(
    reachedTheAsset.every((cell) => cell.reasonCode === "ASSET_NOT_DECLARED_BY_IMPLEMENTATION"),
    "every cell that reaches the asset must refuse there, for the stated reason",
  );
  assert.ok(
    testnet.cells
      .filter((cell) => cell.facilitator !== "BINANCE")
      .every((cell) => cell.reasonCode === "FACILITATOR_NOT_DECLARED_BY_IMPLEMENTATION"),
  );
});

test("a provider offer the owner declined is visibly the owner's decision", () => {
  const surface = buildCommerceSurface();
  assert.equal(surface.declinedByPolicy.symbol, "USDC");
  const binance = surface.implementations.find((entry) => entry.declaration.id === "BINANCE_B402");
  const declined = binance.slices.find((slice) => slice.assetRef === USDC);
  assert.equal(declined.allowedCount, 0);
  /* The distinction the page has to keep: a refusal because the provider cannot
     versus a refusal because this owner will not. */
  const byPolicy = declined.cells.filter((cell) => cell.refusedBy === "POLICY");
  assert.ok(byPolicy.length > 0, "declining an offered asset must read as a policy refusal");
  assert.ok(byPolicy.every((cell) => cell.reasonCode === "ASSET_NOT_ALLOWED_ON_NETWORK"));
});

test("every refusal names who refused", () => {
  const surface = buildCommerceSurface();
  for (const projection of surface.implementations) {
    for (const slice of projection.slices) {
      for (const cell of slice.cells) {
        if (cell.allowed) {
          assert.equal(cell.reasonCode, null);
          assert.equal(cell.refusedBy, null);
          continue;
        }
        assert.ok(cell.reasonCode, "a refused cell must carry a code");
        assert.ok(
          cell.refusedBy === "PROVIDER" || cell.refusedBy === "POLICY",
          `${cell.reasonCode} is attributed to nobody`,
        );
        assert.ok(cell.detail.length > 0, `${cell.reasonCode} carries no explanation`);
      }
    }
  }
});

test("exactly four of the forty-two status pairs name a problem", () => {
  const cells = pairingMatrix();
  assert.equal(cells.length, 42);
  const flagged = cells.filter((cell) => cell.code !== null);
  assert.equal(flagged.length, 4);
  assert.ok(flagged.every((cell) => cell.consistency === "INCONSISTENT"));
  /* And a great many are simply undetermined, which is the honest answer for a
     pair where one half is unknown. */
  assert.ok(cells.filter((cell) => cell.consistency === "UNDETERMINED").length > 20);
});

test("the two same-named systems are shown side by side and disagree", () => {
  const { collision } = buildCommerceSurface();
  assert.equal(collision.binance.asset.assetRef, collision.vistara.asset.assetRef);
  assert.equal(collision.binance.network, collision.vistara.network);
  assert.equal(collision.binance.amount, collision.vistara.amount);
  assert.notEqual(collision.binance.operator, collision.vistara.operator);
  assert.notEqual(collision.binance.trustClass, collision.vistara.trustClass);
  assert.notEqual(collision.binance.integrity.hash, collision.vistara.integrity.hash);
});

test("the surface carries both custody records and never merges them", () => {
  const { custody } = buildCommerceSurface();
  assert.equal(custody.length, 2);
  const facilitator = custody.find((entry) => entry.id === "BINANCE_B402_FACILITATOR");
  const account = custody.find((entry) => entry.id === "BINANCE_MCP_AGENTIC_ACCOUNT");
  assert.equal(facilitator.custodyModel, "SELF_CUSTODY");
  assert.equal(account.custodyModel, "PROVIDER_CUSTODY");
});

test("both mirrored standards are shown as Draft with their pin", () => {
  const { standards } = buildCommerceSurface();
  assert.equal(standards.length, 2);
  for (const pin of standards) {
    assert.equal(pin.status, "DRAFT");
    assert.match(pin.revision, /^sha256:[0-9a-f]{64}$/);
  }
});

test("the sample job is terminal and still promotes nothing", () => {
  const surface = buildCommerceSurface();
  assert.equal(surface.job.state, "TERMINAL");
  assert.equal(surface.job.terminalKind, "COMPLETED");
  assert.equal(surface.job.reconciliationSupport, "NONE");
  assert.equal(surface.collision.binance.outcome.reconciliationStatus, "PENDING");
});

test("the sample reputation signal is a state and not a number", () => {
  const { reputation } = buildCommerceSurface();
  assert.equal(reputation.state, "DECLARED");
  assert.ok(reputation.sourceLabel.length > 0);
  for (const key of Object.keys(reputation)) {
    assert.ok(!/score|rating|rank/i.test(key), `the projection exposes ${key}`);
  }
});

test("the blockers name the exact missing thing rather than a date", () => {
  assert.ok(COMMERCE_BLOCKERS.length >= 3);
  for (const blocker of COMMERCE_BLOCKERS) {
    assert.ok(blocker.title.length > 0 && blocker.detail.length > 0);
    assert.ok(
      !/coming soon|shortly|soon|q[1-4]|next (week|month|quarter)/i.test(`${blocker.title} ${blocker.detail}`),
      `"${blocker.title}" promises a time instead of naming a blocker`,
    );
  }
});

test("a chain reference always resolves to something a reader can see", () => {
  assert.equal(networkLabel("eip155:56"), "BNB Smart Chain");
  /* An unknown chain shows its own id rather than a blank or a guess. */
  assert.equal(networkLabel("eip155:999999"), "eip155:999999");
});

test("the slice helper answers for one exact triple", () => {
  const slice = routeSlice({ implementation: "BINANCE_B402", network: BSC, assetRef: USDT });
  assert.equal(slice.cells.length, 16);
  assert.equal(slice.assetSymbol, "USDT");
  const allowed = slice.cells.filter((cell) => cell.allowed);
  assert.equal(allowed.length, 2);
  assert.deepEqual(
    allowed.map((cell) => cell.method).sort(),
    ["PERMIT2_EXACT", "PERMIT2_UP_TO"],
  );
  assert.ok(allowed.every((cell) => cell.facilitator === "BINANCE"));
});

test("the sample policy declines something, so the allowlist is visibly doing work", () => {
  const listed = SAMPLE_COMMERCE_POLICY.assetPolicy.flatMap((entry) => entry.assetRefs);
  assert.ok(listed.includes(USDT));
  assert.ok(!listed.includes(USDC), "a policy that allowed everything would prove nothing");
});
