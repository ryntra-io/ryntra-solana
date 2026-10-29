// Run from repo root: node --test lib/solana/treasury/model.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_LIMIT_CAP_RAW,
  CHAIN_REFUSAL_CODES,
  chainRefusalOf,
  MAX_PAYOUTS,
  agentIssues,
  delayParts,
  executableAt,
  formatRaw,
  limitIssues,
  parseAmount,
  parsePayouts,
  proposalActions,
  roleMask,
  rolesOfMask,
  treasuryIssues,
  treasuryNetworkFrom,
} from "./model.ts";

const A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const C = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

const all = (address) => ({ address, initiate: true, vote: true, execute: true });

test("the treasury is served only where the deployment names its network", () => {
  assert.equal(treasuryNetworkFrom(undefined), null);
  assert.equal(treasuryNetworkFrom(""), null);
  assert.equal(treasuryNetworkFrom("devnet"), "devnet");
  assert.equal(treasuryNetworkFrom(" Mainnet "), "mainnet");
  assert.equal(treasuryNetworkFrom("mainnet-beta"), "mainnet");
  assert.equal(treasuryNetworkFrom("testnet"), null);
});

test("amounts are read once into base units, never through a float", () => {
  assert.equal(parseAmount("1.5", 9), 1_500_000_000n);
  assert.equal(parseAmount("1,5", 6), 1_500_000n);
  assert.equal(parseAmount("1 000", 6), 1_000_000_000n);
  assert.equal(parseAmount("0.000001", 6), 1n);
  assert.equal(parseAmount("0.0000001", 6), null, "past the asset's decimals");
  assert.equal(parseAmount("0", 6), null);
  assert.equal(parseAmount("-1", 6), null);
  assert.equal(parseAmount("1e3", 6), null);
  assert.equal(parseAmount("1,000.5", 6), null, "a thousands comma is not guessed at");
  assert.equal(parseAmount("1,000", 6), null, "nor a comma before three digits");
  assert.equal(parseAmount("0,125", 6), 125_000n, "a decimal comma before a fraction still reads");
  assert.equal(parseAmount("12 500,5", 6), 12_500_500_000n);
  assert.equal(parseAmount("100 200", 6), 100_200_000_000n, "a field's own grouping reads; a line's columns do not (below)");
  assert.equal(parseAmount("100\t7", 6), null);
  assert.equal(parseAmount("1 00", 6), null);
  assert.equal(formatRaw(1_500_000_000n, 9), "1.5");
  assert.equal(formatRaw(100_000_000n, 6), "100");
  assert.equal(formatRaw(1n, 6), "0.000001");
});

test("roles are Squads' permission bits", () => {
  assert.equal(roleMask({ initiate: true, vote: true, execute: true }), 7);
  assert.equal(roleMask({ initiate: false, vote: true, execute: false }), 2);
  assert.deepEqual(rolesOfMask(5), { initiate: true, vote: false, execute: true });
});

test("a treasury's rules: the creator is a member, every role is filled, the threshold is reachable", () => {
  assert.deepEqual(treasuryIssues({ creator: A, members: [all(A), all(B)], threshold: 2, timeLockSeconds: 86_400 }), []);
  const codes = (draft) => treasuryIssues(draft).map((issue) => issue.code);
  assert.ok(codes({ creator: C, members: [all(A)], threshold: 1, timeLockSeconds: 0 }).includes("CREATOR_NOT_MEMBER"));
  assert.ok(codes({ creator: A, members: [all(A), all(B)], threshold: 3, timeLockSeconds: 0 }).includes("THRESHOLD_RANGE"));
  assert.ok(codes({ creator: A, members: [{ ...all(A), execute: false }], threshold: 1, timeLockSeconds: 0 }).includes("NO_EXECUTOR"));
  assert.ok(codes({ creator: A, members: [{ address: A, initiate: false, vote: false, execute: false }], threshold: 1, timeLockSeconds: 0 }).includes("MEMBER_NO_ROLE"));
  assert.ok(codes({ creator: A, members: [all(A), all(A)], threshold: 1, timeLockSeconds: 0 }).includes("MEMBER_TWICE"));
  assert.ok(codes({ creator: A, members: [all(A)], threshold: 1, timeLockSeconds: 91 * 86_400 }).includes("TIME_LOCK_RANGE"));
  /* A voter-only member with a separate initiator and executor is a complete set of roles. */
  const split = [
    { address: A, initiate: true, vote: false, execute: false },
    { address: B, initiate: false, vote: true, execute: false },
    { address: C, initiate: false, vote: false, execute: true },
  ];
  assert.deepEqual(treasuryIssues({ creator: A, members: split, threshold: 1, timeLockSeconds: 0 }), []);
  assert.ok(codes({ creator: A, members: split, threshold: 2, timeLockSeconds: 0 }).includes("THRESHOLD_RANGE"), "two votes from one voter");
});

test("a spending limit is a mandate: an empty list of recipients is refused, never sent as «anywhere»", () => {
  const limit = { asset: "USDC", amountRaw: 5_000_000n, period: "day", spenders: [B], destinations: [C] };
  assert.deepEqual(limitIssues(limit), []);
  assert.ok(limitIssues({ ...limit, destinations: [] }).some((issue) => issue.code === "LIMIT_DESTINATIONS_EMPTY"));
  assert.ok(limitIssues({ ...limit, spenders: [] }).some((issue) => issue.code === "LIMIT_SPENDERS_EMPTY"));
  assert.ok(limitIssues({ ...limit, destinations: ["nope"] }).some((issue) => issue.code === "LIMIT_DESTINATION_ADDRESS"));
  /* Squads refuses repeated addresses at execution, after the votes: refused before. */
  assert.ok(limitIssues({ ...limit, spenders: [B, B] }).some((issue) => issue.code === "LIMIT_SPENDER_TWICE"));
  assert.ok(limitIssues({ ...limit, destinations: [C, C] }).some((issue) => issue.code === "LIMIT_DESTINATION_TWICE"));
});

test("an agent's multisig: a short delay, a small amount, its own key", () => {
  const draft = { creator: A, agent: B, timeLockSeconds: 600, limit: { asset: "USDC", amountRaw: 50_000_000n, period: "week", destinations: [C] } };
  assert.deepEqual(agentIssues(draft), []);
  const codes = (patch) => agentIssues({ ...draft, ...patch }).map((issue) => issue.code);
  assert.ok(codes({ timeLockSeconds: 86_400 }).includes("AGENT_TIME_LOCK_RANGE"), "a day is not a short delay");
  assert.ok(codes({ timeLockSeconds: 0 }).includes("AGENT_TIME_LOCK_RANGE"));
  assert.ok(codes({ agent: A }).includes("AGENT_IS_CREATOR"));
  assert.ok(codes({ limit: { ...draft.limit, amountRaw: AGENT_LIMIT_CAP_RAW.USDC + 1n } }).includes("LIMIT_AGENT_CAP"));
  assert.deepEqual(codes({ limit: { ...draft.limit, amountRaw: AGENT_LIMIT_CAP_RAW.USDC } }), []);
  assert.ok(codes({ limit: { ...draft.limit, destinations: [] } }).includes("LIMIT_DESTINATIONS_EMPTY"));
});

test("payouts are pasted one per line; a comma in the amount is its decimal point, never a column", () => {
  const read = parsePayouts(`${A}; 1,5\n\n${B}\t2\n${C} 1000`, 6);
  assert.deepEqual(read.issues, []);
  assert.deepEqual(read.payouts, [
    { to: A, amountRaw: 1_500_000n },
    { to: B, amountRaw: 2_000_000n },
    { to: C, amountRaw: 1_000_000_000n },
  ]);
  const bad = parsePayouts(`${A}\nnot-an-address 5\n${B} 0\n${C} 1\n${C} 2\n${A}; 1`, 6, A);
  assert.deepEqual(
    bad.issues.map((issue) => [issue.code, issue.line]),
    [
      ["PAYOUT_LINE", 1],
      ["PAYOUT_ADDRESS", 2],
      ["PAYOUT_AMOUNT", 3],
      ["PAYOUT_TWICE", 5],
      ["PAYOUT_TO_VAULT", 6],
    ],
  );
  assert.deepEqual(parsePayouts(`${A},1.5`, 6).payouts, [{ to: A, amountRaw: 1_500_000n }], "after a comma column, a decimal point");
  assert.deepEqual(parsePayouts("  \n", 6).issues.map((issue) => issue.code), ["PAYOUTS_EMPTY"]);
  /* A pasted sheet with a third column, or a stray comma: the line is refused, never paid more. */
  for (const line of [`${A}\t100\t7`, `${A} 100 200`, `${A}, 1, 5`, `${A},1,000`, `${A},100,7`, `${A},12,50`, `${A}, 1,5`]) {
    const glued = parsePayouts(line, 6);
    assert.deepEqual(glued.payouts, [], line);
    assert.equal(glued.issues[0]?.code, "PAYOUT_AMOUNT", line);
  }
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const many = Array.from({ length: MAX_PAYOUTS + 1 }, (_, index) => `${"A".repeat(31)}${ALPHABET[index]} 1`).join("\n");
  assert.ok(parsePayouts(many, 6).issues.some((issue) => issue.code === "PAYOUTS_TOO_MANY"));
});

test("what a wallet may do with a proposal follows its roles, its vote and the delay", () => {
  const roles = { initiate: true, vote: true, execute: true };
  assert.deepEqual(proposalActions({ state: "active", roles, voted: null, executableAtSeconds: null, nowSeconds: 0 }), ["approve", "reject"]);
  assert.deepEqual(proposalActions({ state: "active", roles, voted: "approved", executableAtSeconds: null, nowSeconds: 0 }), []);
  assert.deepEqual(proposalActions({ state: "approved", roles, voted: "approved", executableAtSeconds: 100, nowSeconds: 50 }), ["cancel"], "the delay runs: only a cancel");
  assert.deepEqual(proposalActions({ state: "approved", roles, voted: "approved", executableAtSeconds: 100, nowSeconds: 100 }), ["cancel", "execute"]);
  assert.deepEqual(proposalActions({ state: "approved", roles: { initiate: true, vote: false, execute: false }, voted: null, executableAtSeconds: 0, nowSeconds: 1 }), []);
  assert.deepEqual(proposalActions({ state: "executed", roles, voted: null, executableAtSeconds: null, nowSeconds: 1 }), []);
  assert.deepEqual(proposalActions({ state: "approved", roles, voted: null, executableAtSeconds: 0, nowSeconds: 1 }), ["cancel", "execute"]);
  assert.deepEqual(proposalActions({ state: "active", roles: null, voted: null, executableAtSeconds: null, nowSeconds: 1 }), []);
  assert.equal(executableAt("approved", 1_000, 3_600), 4_600);
  assert.equal(executableAt("active", 1_000, 3_600), null);
});

test("a delay is said in its largest whole unit", () => {
  assert.deepEqual(delayParts(0), { value: 0, unit: "s" });
  assert.deepEqual(delayParts(600), { value: 10, unit: "min" });
  assert.deepEqual(delayParts(3_600), { value: 1, unit: "h" });
  assert.deepEqual(delayParts(259_200), { value: 3, unit: "d" });
  assert.deepEqual(delayParts(90), { value: 90, unit: "s" });
});

test("a refusal of the network is told by what it means, and whose money ran short by the instruction refused", () => {
  const of = (kind, text, extra = {}) => chainRefusalOf({ kind, text, squadsError: null, payer: null, ...extra });
  /* A wallet the network has never credited: no SOL at all, whatever the action. */
  assert.equal(of("create", "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit."), "TREASURY_WALLET_NO_SOL");
  /* Squads' own errors — named only when Squads itself refused (the caller reads that from the logs). */
  assert.equal(of("execute", "x", { squadsError: "TimeLockNotReleased" }), "TREASURY_DELAY");
  assert.equal(of("vote", "x", { squadsError: "StaleProposal" }), "TREASURY_PROPOSAL_STALE");
  assert.equal(of("vote", "x", { squadsError: "AlreadyApproved" }), "TREASURY_ALREADY_VOTED");
  assert.equal(of("spend", "x", { squadsError: "SpendingLimitExceeded" }), "TREASURY_LIMIT_EXCEEDED");
  assert.equal(of("spend", "x", { squadsError: "InvalidDestination" }), "TREASURY_DESTINATION");
  assert.equal(of("config", "x", { squadsError: "NotAMember" }), "TREASURY_NOT_ALLOWED");
  /* An «Error Code:» line alone is not Squads' word: another Anchor program has an «Unauthorized» too. */
  assert.equal(of("vote", "Program log: AnchorError occurred. Error Code: Unauthorized."), "TREASURY_SUBMIT_FAILED");
  /* «Insufficient lamports» is whoever pays at the refused instruction: a change's execution is the wallet's (its rent
     payer), a batch's line and a spend from the limit the vault's. */
  const transfer = ["Program log: Transfer: insufficient lamports 100, need 200", "custom program error: 0x1"].join("\n");
  assert.equal(of("execute", transfer, { payer: "wallet" }), "TREASURY_WALLET_SHORT");
  assert.equal(of("execute", transfer, { payer: "vault" }), "TREASURY_VAULT_SHORT");
  assert.equal(of("spend", transfer, { payer: "wallet" }), "TREASURY_WALLET_SHORT", "a USDC recipient's account is the wallet's to open");
  assert.equal(of("spend", transfer, { payer: "vault" }), "TREASURY_VAULT_SHORT");
  /* Without the instruction: one-sided kinds are the wallet's; an execution or a spend may be either, and is said so. */
  assert.equal(of("deposit", transfer), "TREASURY_WALLET_SHORT");
  assert.equal(of("payouts", "Program log: Error: insufficient funds"), "TREASURY_WALLET_SHORT");
  assert.equal(of("execute", transfer), "TREASURY_FUNDS_SHORT");
  assert.equal(of("spend", transfer), "TREASURY_FUNDS_SHORT");
  /* The fee is always the fee payer's; rent short on the first account too; on another account, a new address paid
     below the network's minimum — which no top-up of the payer cures. */
  assert.equal(of("spend", "Transaction simulation failed: Insufficient funds for fee"), "TREASURY_WALLET_SHORT");
  assert.equal(of("spend", "Transaction results in an account (0) with insufficient funds for rent"), "TREASURY_WALLET_SHORT");
  assert.equal(of("deposit", "Transaction results in an account (1) with insufficient funds for rent"), "TREASURY_BELOW_RENT");
  assert.equal(of("execute", "Transaction results in an account (3) with insufficient funds for rent", { payer: "vault" }), "TREASURY_BELOW_RENT");
  assert.equal(of("vote", "Blockhash not found"), "TREASURY_BUILD_EXPIRED");
  /* Anything else is the network's refusal in general words, never its raw text as the line. */
  assert.equal(of("vote", "something new"), "TREASURY_SUBMIT_FAILED");
  for (const text of ["", "x", "Error Code: SomethingElse"]) assert.ok(CHAIN_REFUSAL_CODES.includes(of("create", text)));
});


test("a proposal this page cannot show gets no «for» and no «execute» here — «against» and a cancel stay", () => {
  const roles = { initiate: true, vote: true, execute: true };
  assert.deepEqual(proposalActions({ state: "active", roles, voted: null, executableAtSeconds: null, nowSeconds: 0, readable: false }), ["reject"]);
  assert.deepEqual(proposalActions({ state: "approved", roles, voted: null, executableAtSeconds: 0, nowSeconds: 1, readable: false }), ["cancel"]);
  assert.deepEqual(proposalActions({ state: "approved", roles, voted: null, executableAtSeconds: 0, nowSeconds: 1, readable: true }), ["cancel", "execute"]);
});

test("rent short on the vault is the vault's; the chain's own JSON form is read too", () => {
  const of = (text, vaultKeyIndex = null) => chainRefusalOf({ kind: "execute", text, squadsError: null, payer: "vault", vaultKeyIndex });
  assert.equal(of('{"InsufficientFundsForRent":{"account_index":0}}'), "TREASURY_WALLET_SHORT");
  assert.equal(of('{"InsufficientFundsForRent":{"account_index":4}}', 4), "TREASURY_VAULT_SHORT");
  assert.equal(of('{"InsufficientFundsForRent":{"account_index":5}}', 4), "TREASURY_BELOW_RENT");
  assert.equal(of("Transaction results in an account (4) with insufficient funds for rent", 4), "TREASURY_VAULT_SHORT");
});
