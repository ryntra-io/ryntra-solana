// Run from repo root: node --test lib/compliance/gate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "./gate.ts";

const { classifyCompliance } = gate;

// A real UA response (ARCUS-API.md, verified 2026-07-07): both products unrestricted.
const UA_OK = { geo: { country: "UA", region: "UA-68", restrictions: { perpetuals: false, spot: false }, bypassed: false } };

test("UA is allowed for both products — never blocked", () => {
  const v = classifyCompliance(UA_OK);
  assert.equal(v.venueSpotAllowed, true);
  assert.equal(v.venuePerpsAllowed, true);
  assert.equal(v.spotBlockReason, null);
  assert.equal(v.country, "UA");
  assert.equal(v.region, "UA-68");
});

test("spot/perps restrictions are INDEPENDENT booleans", () => {
  const v = classifyCompliance({ geo: { restrictions: { spot: false, perpetuals: true } } });
  assert.equal(v.venueSpotAllowed, true);
  assert.equal(v.venuePerpsAllowed, false);
  assert.equal(v.spotBlockReason, null); // spot allowed even though perps restricted
});

test("geo-restricted spot → blocked with reason 'geo'", () => {
  const v = classifyCompliance({ geo: { country: "US", restrictions: { spot: true, perpetuals: true } } });
  assert.equal(v.venueSpotAllowed, false);
  assert.equal(v.spotBlockReason, "geo");
});

test("wallet BLOCKED → blocked with reason 'wallet' (takes precedence over geo)", () => {
  const v = classifyCompliance({ geo: { restrictions: { spot: false } }, address: { status: "BLOCKED" } });
  assert.equal(v.walletAllowed, false);
  assert.equal(v.spotBlockReason, "wallet");
});

test("wallet BLOCKED wins even if geo also restricted (single message, wallet first)", () => {
  const v = classifyCompliance({ geo: { restrictions: { spot: true } }, address: { status: "BLOCKED" } });
  assert.equal(v.spotBlockReason, "wallet");
});

test("wallet COMPLIANT + geo allowed → nothing blocks", () => {
  const v = classifyCompliance({ ...UA_OK, address: { status: "COMPLIANT" } });
  assert.equal(v.walletAllowed, true);
  assert.equal(v.spotBlockReason, null);
});

test("unknown (null / failed fetch) NEVER blocks and never reads allowed", () => {
  const v = classifyCompliance(null);
  assert.equal(v.venueSpotAllowed, null);
  assert.equal(v.walletAllowed, null);
  assert.equal(v.spotBlockReason, null); // the venue enforces on submit; a flaky check must not lock out
});

test("missing restrictions object → venue unknown, not blocked", () => {
  const v = classifyCompliance({ geo: { country: "UA" } });
  assert.equal(v.venueSpotAllowed, null);
  assert.equal(v.spotBlockReason, null);
});

test("bypassed VPN/proxy flag is surfaced", () => {
  assert.equal(classifyCompliance({ geo: { bypassed: true, restrictions: { spot: false } } }).bypassed, true);
  assert.equal(classifyCompliance(UA_OK).bypassed, false);
});

test("state-changing spot actions require a fresh explicit geo and wallet allow", () => {
  assert.equal(typeof gate.isSpotComplianceReady, "function");
  const ready = gate.isSpotComplianceReady;
  const checkedAt = 1_800_000_000_000;
  const explicitAllow = classifyCompliance({
    ...UA_OK,
    address: { status: "COMPLIANT" },
  });

  assert.equal(ready(explicitAllow, checkedAt, checkedAt + 30_000), true);
  assert.equal(ready(explicitAllow, checkedAt, checkedAt + 60_001), false, "stale verdict");
  assert.equal(ready(classifyCompliance(null), checkedAt, checkedAt), false, "unknown verdict");
  assert.equal(ready(classifyCompliance(UA_OK), checkedAt, checkedAt), false, "wallet not screened");
  assert.equal(ready(classifyCompliance({
    ...UA_OK,
    address: { status: "BLOCKED" },
  }), checkedAt, checkedAt), false, "blocked wallet");
  assert.equal(ready(classifyCompliance({
    geo: { ...UA_OK.geo, bypassed: true },
    address: { status: "COMPLIANT" },
  }), checkedAt, checkedAt), false, "detected bypass");
});
test("money paths require an explicit false bypass flag", () => {
  const checkedAt = 1_800_000_000_000;
  const missingBypass = classifyCompliance({
    geo: { country: "UA", restrictions: { perpetuals: false, spot: false } },
    address: { status: "COMPLIANT" },
  });
  assert.equal(missingBypass.bypassed, null);
  assert.equal(gate.isSpotComplianceReady(missingBypass, checkedAt, checkedAt), false);
});

test("an echoed compliance address may not differ from the requested wallet", () => {
  const requested = "0x1111111111111111111111111111111111111111";
  const other = "0x2222222222222222222222222222222222222222";
  const checkedAt = 1_800_000_000_000;
  const verdict = classifyCompliance({
    ...UA_OK,
    address: { address: other, status: "COMPLIANT" },
  }, requested);
  assert.equal(verdict.walletAllowed, null);
  assert.equal(gate.isSpotComplianceReady(verdict, checkedAt, checkedAt), false);
});
