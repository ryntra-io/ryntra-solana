/**
 * The owner policy, golden per verdict branch — including the three doomed
 * transfers the task book names, each refused with its exact reason before
 * any signature could exist.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeRawMintAccount } from "./mint.ts";
import { buildPassport } from "./passport.ts";
import { buildTransferPreflight } from "./preflight.ts";
import { evaluateOwnerPolicy } from "./policy.ts";
import { SolanaPolicyVerdictSchema, POLICY_RULE_IDS } from "./contracts.ts";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function materialOf(name, amountRaw = "1000000") {
  const read = decodeRawMintAccount(fixture(name));
  assert.equal(read.ok, true);
  const built = buildPassport(read.raw);
  assert.equal(built.ok, true);
  const input = {
    schemaVersion: "1.0.0",
    actionRef: "action:solana-token-2022/spl-transfer@1",
    network: "mainnet",
    mint: read.raw.mint,
    sender: "BJE5MMbqXjVwjAF7oxwPYXnTXDyspzZyt4vwenNw5ruG",
    recipient: "7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar",
    amountRaw,
  };
  const preflightResult = buildTransferPreflight({ read, passport: built.passport, input });
  assert.equal(preflightResult.ok, true);
  return { input, passport: built.passport, preflight: preflightResult.preflight };
}

/** A permissive baseline; each test narrows exactly one dial. */
const OPEN_POLICY = {
  schema: "ryntra.solana.owner-policy",
  schemaVersion: "0.1.0",
  allowedNetworks: ["mainnet", "devnet"],
  allowedMints: "ANY",
  allowedTokenPrograms: ["SPL_TOKEN", "TOKEN_2022"],
  acceptPermanentDelegate: true,
  transferHookAllowlist: "NONE_ALLOWED",
  maxFeeBasisPoints: null,
  maxFeeRaw: null,
  recipientAllowlist: "ANY",
  maxAmountRaw: null,
  maxEvidenceAgeSeconds: 86_400 * 365 * 10,
  acceptDefaultFrozenAccounts: false,
  requireHumanApproval: false,
};

const verdictOf = (material, policyPatch, now) =>
  evaluateOwnerPolicy({
    policy: { ...OPEN_POLICY, ...policyPatch },
    ...material,
    now: now ?? new Date(Date.parse(material.passport.observedAt) + 60_000),
  });

test("a plain mint under an open policy reports NO_KNOWN_BLOCKER — and never the word safe", () => {
  const verdict = verdictOf(materialOf("usdc-spl"), {});
  assert.equal(verdict.verdict, "NO_KNOWN_BLOCKER");
  assert.equal(verdict.findings.length, POLICY_RULE_IDS.length, "every rule reports, none is skipped");
  assert.ok(!JSON.stringify(verdict).toLowerCase().includes('"safe"'));
  SolanaPolicyVerdictSchema.parse(verdict);
});

test("every blocking dial blocks with its exact reason", () => {
  const usdc = materialOf("usdc-spl");
  const cases = [
    [{ allowedNetworks: ["devnet"] }, "NETWORK_ALLOWED", /not among the policy's allowed networks/],
    [{ allowedMints: [] }, "MINT_ALLOWED", /not on the policy's mint allowlist/],
    [{ allowedTokenPrograms: ["TOKEN_2022"] }, "TOKEN_PROGRAM_ALLOWED", /SPL_TOKEN is not among/],
    [{ recipientAllowlist: [] }, "RECIPIENT_ALLOWED", /not on the policy's allowlist/],
    [{ maxAmountRaw: "999" }, "AMOUNT_WITHIN_LIMIT", /exceeds the policy's limit of 999 raw/],
  ];
  for (const [patch, rule, detail] of cases) {
    const verdict = verdictOf(usdc, patch);
    assert.equal(verdict.verdict, "BLOCKED", rule);
    const finding = verdict.findings.find((candidate) => candidate.rule === rule);
    assert.equal(finding.outcome, "BLOCKED");
    assert.match(finding.detail, detail);
  }
});

test("doomed transfer #1 — a permanent delegate the policy does not accept", () => {
  const verdict = verdictOf(materialOf("pyusd-t22"), { acceptPermanentDelegate: false });
  assert.equal(verdict.verdict, "BLOCKED");
  const finding = verdict.findings.find((candidate) => candidate.rule === "PERMANENT_DELEGATE_ACCEPTED");
  assert.match(finding.detail, /issuer can move or burn holder balances/);
  assert.match(finding.detail, /policy does not accept/);
});

test("doomed transfer #2 — the fee exceeds the policy cap, named in numbers", () => {
  const bern = materialOf("bern-t22", "1000000000");
  const bps = bern.preflight.transferFee.basisPoints;
  assert.ok(bps > 0);
  const verdict = verdictOf(bern, { maxFeeBasisPoints: bps - 1 });
  assert.equal(verdict.verdict, "BLOCKED");
  const finding = verdict.findings.find((candidate) => candidate.rule === "FEE_WITHIN_CAP");
  assert.match(finding.detail, new RegExp(`charges ${bps} bps`));
  assert.match(finding.detail, new RegExp(`caps fees at ${bps - 1} bps`));
});

test("doomed transfers #3 — non-transferable and default-frozen mints, via fabricated previews", () => {
  const usdc = materialOf("usdc-spl");

  const nonTransferable = {
    ...usdc,
    preflight: { ...usdc.preflight, structuralBlockers: ["NON_TRANSFERABLE"] },
  };
  let verdict = verdictOf(nonTransferable, {});
  assert.equal(verdict.verdict, "BLOCKED");
  assert.match(
    verdict.findings.find((candidate) => candidate.rule === "NOT_STRUCTURALLY_DOOMED").detail,
    /non-transferable: this transfer cannot exist/,
  );

  const frozen = {
    ...usdc,
    preflight: { ...usdc.preflight, structuralBlockers: ["DEFAULT_ACCOUNT_STATE_FROZEN"] },
  };
  verdict = verdictOf(frozen, { acceptDefaultFrozenAccounts: false });
  assert.equal(verdict.verdict, "BLOCKED");
  assert.match(
    verdict.findings.find((candidate) => candidate.rule === "DEFAULT_FROZEN_ACCEPTED").detail,
    /start frozen.*policy does not accept/s,
  );

  /* The same frozen mint under an accepting policy asks a person instead. */
  verdict = verdictOf(frozen, { acceptDefaultFrozenAccounts: true });
  assert.equal(verdict.verdict, "REVIEW_REQUIRED");
});

test("a transfer hook not on the allowlist blocks; an allowlisted one does not", () => {
  const usdc = materialOf("usdc-spl");
  const hooked = {
    ...usdc,
    preflight: { ...usdc.preflight, hookProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
  };
  let verdict = verdictOf(hooked, { transferHookAllowlist: "NONE_ALLOWED" });
  assert.equal(verdict.verdict, "BLOCKED");
  verdict = verdictOf(hooked, { transferHookAllowlist: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"] });
  assert.equal(verdict.verdict, "NO_KNOWN_BLOCKER");
});

test("stale evidence and unsupported extensions report INCOMPLETE, not a guess", () => {
  const usdc = materialOf("usdc-spl");

  let verdict = verdictOf(usdc, { maxEvidenceAgeSeconds: 1 }, new Date(Date.parse(usdc.passport.observedAt) + 3_600_000));
  assert.equal(verdict.verdict, "INCOMPLETE");
  assert.match(
    verdict.findings.find((candidate) => candidate.rule === "EVIDENCE_FRESH").detail,
    /re-read the mint before deciding/,
  );

  const alien = {
    ...usdc,
    preflight: { ...usdc.preflight, unsupportedKinds: ["SomethingFromTheFuture"] },
  };
  verdict = verdictOf(alien, {});
  assert.equal(verdict.verdict, "INCOMPLETE");
  assert.match(
    verdict.findings.find((candidate) => candidate.rule === "EXTENSIONS_UNDERSTOOD").detail,
    /unknown, not absent/,
  );
});

test("requireHumanApproval alone yields REVIEW_REQUIRED", () => {
  const verdict = verdictOf(materialOf("usdc-spl"), { requireHumanApproval: true });
  assert.equal(verdict.verdict, "REVIEW_REQUIRED");
});

test("precedence: a forbidding rule outranks missing evidence outranks a review flag", () => {
  const usdc = materialOf("usdc-spl");

  /* BLOCKED + INCOMPLETE + REVIEW at once → BLOCKED. */
  const worst = verdictOf(
    { ...usdc, preflight: { ...usdc.preflight, unsupportedKinds: ["X"] } },
    { maxAmountRaw: "1", requireHumanApproval: true },
  );
  assert.equal(worst.verdict, "BLOCKED");

  /* INCOMPLETE + REVIEW → INCOMPLETE. */
  const unknown = verdictOf(
    { ...usdc, preflight: { ...usdc.preflight, unsupportedKinds: ["X"] } },
    { requireHumanApproval: true },
  );
  assert.equal(unknown.verdict, "INCOMPLETE");
});
