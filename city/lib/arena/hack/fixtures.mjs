// Shared fixtures for the Hack library's tests (CITY-223). Not a test file itself (no `.test.mjs`), so the runner
// never executes it; the test files import it. It registers the world's TypeScript hooks before loading the library,
// so a test may import it first and then the `.ts` modules resolve.
import "../../../../lib/world/testing/hooks.mjs";
import { createHash } from "node:crypto";

export const hack = await import("./index.ts");

/** A deterministic 44-character base58 address from a seed — always matches `ADDRESS`. */
export function addr(seed) {
  const alpha = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 44; i += 1) s += alpha[(seed * 31 + i * 7 + 13) % alpha.length];
  return s;
}

export const PROTOCOL = addr(1);
export const OWNER_A = addr(2);
export const OWNER_B = addr(3);
export const PROGRAM = addr(4);
export const PROGRAM2 = addr(5);
export const ACCOUNT = addr(6);

/** A 64-hex hash of a label, the shape a judge log hash has. */
export const hashOf = (label) => createHash("sha256").update(String(label)).digest("hex");
export const RUN_HASH = hashOf("run-1");

/** A verifier that trusts the signature `"good"` from the body's own protocol wallet; anything else is not permitted. */
export const verify = (body, sig) => sig != null && sig.signature === "good" && sig.signer === body.protocol;

export function makeScope(over = {}) {
  return { programs: [PROGRAM], instructions: ["swap", "withdraw"], ...over };
}

export function makeTarget(over = {}) {
  return { kind: "fork", program: PROGRAM, slot: 250_000_000, ...over };
}

const OPENS = Date.parse("2026-11-08T12:00:00Z");
const CLOSES = OPENS + 7 * 24 * 3_600_000;
export const WINDOW = { opensAt: OPENS, closesAt: CLOSES };
export const AT = OPENS + 3_600_000;

export function makeOrder(over = {}) {
  return {
    format: hack.ORDER_FORMAT,
    id: "order-1",
    protocol: PROTOCOL,
    title: "Audit the vault program on a fork",
    target: makeTarget(),
    scope: makeScope(),
    reward: { pool: "pool-1", note: "training run" },
    opensAt: OPENS,
    closesAt: CLOSES,
    status: "draft",
    ...over,
  };
}

/** A grant for an order, signed `"good"` by the order's protocol owner unless overridden. */
export function makeGrant(order, over = {}) {
  const body = {
    format: hack.GRANT_FORMAT,
    order: order.id,
    protocol: order.protocol,
    target: order.target,
    scope: order.scope,
    opensAt: order.opensAt,
    closesAt: order.closesAt,
    nonce: "nonce-1",
    ...over.body,
  };
  return { ...body, signature: { signer: order.protocol, signature: "good", ...over.signature } };
}

export function makeFinding(order, over = {}) {
  return {
    format: hack.FINDING_FORMAT,
    id: "finding-1",
    order: order.id,
    hunter: "agent-7",
    hunterOwner: OWNER_A,
    target: { program: PROGRAM, instruction: "withdraw" },
    vulnClass: "auth-bypass",
    severity: "high",
    title: "Withdraw skips the owner check",
    logHash: RUN_HASH,
    submittedAt: AT,
    status: "submitted",
    ...over,
  };
}

/** A crafted judge verdict for the rules tests; `verdict` drives it, `logHash` ties it to a finding. */
export function makeProof(over = {}) {
  const verdict = over.verdict ?? "PASS";
  return {
    judgement: {
      verdict,
      reason: over.reason ?? (verdict === "PASS" ? "TESTS_PASSED" : verdict === "FAIL" ? "TESTS_FAILED" : verdict === "BLOCKED" ? "FALSE_CLAIM" : "UNCLEAR"),
      level: "L2",
      detail: "run",
      payable: verdict === "PASS",
      rerun: false,
      logHash: over.logHash ?? RUN_HASH,
      ...over.judgement,
    },
    deterministic: over.deterministic ?? true,
  };
}
