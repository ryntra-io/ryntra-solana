import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LAUNCH_RECEIPT_FACTS_SOURCE, buildLaunchReceiptFacts, launchCreationProblems, launchObservationProblems } from "./receipt.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

/* The rehearsal's Classic token on devnet, as the venue observed it after graduation, and its creation transaction. */
const observation = fixture("devnet-classic-observation.json");
const creation = fixture("devnet-classic-creation.json");
const { poolPayer } = fixture("devnet-classic-config.json");
const outside = fixture("devnet-outside-launch.json");
const input = { cluster: "devnet", observation, creation, ryntraPoolPayer: poolPayer, observedAt: "2026-10-05T06:10:00.000Z" };

test("the rehearsal's token is a Ryntra launch by every rule the chain can show", () => {
  assert.deepEqual(launchObservationProblems(observation), []);
  assert.deepEqual(launchCreationProblems(observation, creation, poolPayer), []);
  const facts = buildLaunchReceiptFacts(input);
  assert.equal(facts.source, LAUNCH_RECEIPT_FACTS_SOURCE);
  assert.equal(facts.preset, "classic");
  assert.equal(facts.token2022.mintAuthority, null);
  assert.deepEqual(facts.token2022.extensions, ["MetadataPointer", "TokenMetadata"]);
  assert.equal(facts.curve.migrated, true);
  assert.equal(facts.graduated.compounding, true);
  assert.equal(facts.graduated.positions.length, 2, "the partner's and the creator's");
  /* The creator's purchase comes from the creation transaction itself, never from what the caller says. */
  assert.deepEqual(facts.creatorFirstBuy, { quoteInRaw: creation.creatorQuoteInRaw, tokensOutRaw: creation.creatorTokensOutRaw, capRaw: "50000000000000" });
  assert.ok(BigInt(creation.creatorTokensOutRaw) > 0n);
  assert.deepEqual(
    facts.marks.map((mark) => mark.code),
    /* Graduated: the buyers' money left the curve for the pool, whose two positions are locked for ever. */
    ["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK", "LP_LOCKED_FOREVER", "LP_LOCKED_FOREVER"],
  );
  for (const mark of facts.marks) assert.match(mark.account, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `${mark.code} leads to an account on chain`);
  assert.equal(facts.created.at, new Date(creation.blockTime * 1000).toISOString());
});

test("a token opened on Ryntra's public config without Ryntra's pool payer gets no receipt", () => {
  assert.equal(outside.observation.preset, "classic", "the same config");
  assert.ok(launchCreationProblems(outside.observation, outside.creation, poolPayer).some((line) => /not launched through Ryntra/.test(line)));
  assert.throws(() => buildLaunchReceiptFacts({ ...input, observation: outside.observation, creation: outside.creation }), /not launched through Ryntra/);
});

test("a broken rule is a refusal, never a missing mark", () => {
  const mint = observation.mint;
  const broken = [
    [{ preset: null }, /not one of Ryntra's presets/],
    [{ configProblems: ["the metadata can be changed"] }, /its config: the metadata can be changed/],
    [{ mint: { ...mint, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" } }, /not a Token-2022 mint/],
    [{ mint: { ...mint, mintAuthority: observation.creator } }, /mint authority/],
    [{ mint: { ...mint, freezeAuthority: observation.creator } }, /freeze/],
    [{ mint: { ...mint, transferHookProgram: observation.creator } }, /transfer hook/],
    [{ mint: { ...mint, metadataRead: "FAILED", metadataUpdateAuthority: null } }, /could not be read/],
    [{ mint: { ...mint, metadataRead: "MISSING" } }, /carries no metadata/],
    [{ mint: { ...mint, metadataUpdateAuthority: observation.creator } }, /metadata can be updated/],
    [{ mint: { ...mint, metadataPointerAuthority: observation.creator } }, /pointer can be moved/],
    [{ mint: { ...mint, metadataPointerAddress: observation.creator } }, /points away from the mint/],
    [{ mint: { ...mint, extensions: [...mint.extensions, "PermanentDelegate"] } }, /PermanentDelegate/],
    [{ mint: { ...mint, supplyRaw: "1000000000000001" } }, /the supply is/],
    [{ mint: { ...mint, decimals: 9 } }, /decimals/],
    [{ graduated: { ...observation.graduated, collectFeeMode: 0 } }, /does not compound/],
    [{ graduated: { ...observation.graduated, baseFeeMode: 1 } }, /market cap/],
    [{ graduated: { ...observation.graduated, positions: [{ ...observation.graduated.positions[0], unlockedLiquidity: "1" }] } }, /not locked for ever/],
    [{ graduated: null }, /pool was not found/],
  ];
  for (const [change, message] of broken) {
    const changed = { ...observation, ...change };
    assert.ok(launchObservationProblems(changed).some((line) => message.test(line)), JSON.stringify(Object.keys(change)));
    assert.throws(() => buildLaunchReceiptFacts({ ...input, observation: changed }), /Not a Ryntra launch/);
  }
});

test("another launch's creation transaction cannot vouch for this token", () => {
  /* The token opened outside Ryntra, offered with the creation transaction of a real Ryntra launch by the same creator. */
  const substituted = launchCreationProblems(outside.observation, creation, poolPayer);
  assert.ok(substituted.some((line) => /created another token/.test(line)), substituted.join(" | "));
  assert.throws(() => buildLaunchReceiptFacts({ ...input, observation: outside.observation, creation }), /created another token/);
});

test("the creation transaction decides: a failed creation, another creator, a purchase above the cap", () => {
  const init = creation.initialized;
  const cases = [
    [{ initialized: null }, /initializes no curve/],
    [{ initialized: { ...init, baseMint: poolPayer } }, /created another token/],
    [{ initialized: { ...init, pool: poolPayer } }, /created another token/],
    [{ initialized: { ...init, config: poolPayer } }, /created another token/],
    [{ signers: creation.signers.filter((signer) => signer !== observation.token) }, /created another token/],
    [{ initialized: { ...init, payer: observation.creator } }, /not launched through Ryntra/],
    [{ failed: true }, /creation transaction failed/],
    [{ creator: poolPayer }, /another creator/],
    [{ creatorTokensOutRaw: "50000000000001" }, /above the preset's cap/],
    [{ feePayer: observation.creator }, /not launched through Ryntra/],
    [{ signers: [observation.creator] }, /not launched through Ryntra/],
  ];
  for (const [change, message] of cases) {
    assert.ok(launchCreationProblems(observation, { ...creation, ...change }, poolPayer).some((line) => message.test(line)), JSON.stringify(change));
    assert.throws(() => buildLaunchReceiptFacts({ ...input, creation: { ...creation, ...change } }), /Not a Ryntra launch/);
  }
});

test("before graduation the receipt has no pool marks and no pool — the curve holds the money", () => {
  const vault = "Vau1t11111111111111111111111111111111111111";
  const onCurve = { ...observation, curve: { ...observation.curve, migrated: false, quoteVault: vault }, graduated: null };
  const facts = buildLaunchReceiptFacts({ ...input, observation: onCurve });
  assert.equal(facts.graduated, null);
  assert.ok(!facts.marks.some((mark) => mark.code === "LP_LOCKED_FOREVER"));
  assert.deepEqual(facts.marks.find((mark) => mark.code === "CURVE_HOLDS_FUNDS"), { code: "CURVE_HOLDS_FUNDS", account: vault }, "it leads to the curve's vault, where the money is seen");
});

test("no purchase in the creation means no first-buy line, not a zero one", () => {
  const facts = buildLaunchReceiptFacts({ ...input, creation: { ...creation, creatorTokensOutRaw: "0", creatorQuoteInRaw: "0" } });
  assert.equal(facts.creatorFirstBuy, null);
});

test("«Творець заблокував свою покупку» only when Met Lock's escrow of this token holds the first purchase and no one can cancel it", async () => {
  const { creatorLockProblems } = await import("./receipt.ts");
  const token = "F4pmJAEZDtJ4JPE7QwK7zrD6R1Ypgi7nTCGxTM7AsLGQ";
  const creator = "BXYvPJc4o3qJx1JtvbMYsihVDmB8QCnzjP7oLw2h5Kcd";
  const observation = { token, creator };
  const creation = { creatorTokensOutRaw: "9809619000000", creator };
  const lock = {
    escrow: "AhbXS62myLjRMgc94ejDAXdHAxuuEXnKYcNiYLZ6aMYZ",
    program: "LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn",
    mint: token,
    creator,
    recipient: creator,
    totalRaw: "9809619000000",
    claimedRaw: "0",
    heldRaw: "9809619000000",
    cliffAt: 100,
    endsAt: 200,
    cancelMode: 0,
    updateRecipientMode: 0,
    cancelledAt: 0,
  };
  assert.deepEqual(creatorLockProblems(observation, creation, lock, 1), []);
  assert.ok(creatorLockProblems(observation, creation, { ...lock, cancelMode: 1 }, 1).length, "a lock the creator could cancel is no lock");
  assert.ok(creatorLockProblems(observation, creation, { ...lock, totalRaw: "1" }, 1).length, "a lock of less than the purchase");
  assert.ok(creatorLockProblems(observation, creation, { ...lock, recipient: lock.escrow }, 1).length, "a lock for someone else");
  assert.ok(creatorLockProblems(observation, creation, { ...lock, heldRaw: "0" }, 1).length, "an escrow that holds nothing");
  assert.ok(creatorLockProblems(observation, creation, { ...lock, program: creator }, 1).length, "not Met Lock");
  assert.ok(creatorLockProblems(observation, { creatorTokensOutRaw: "0", creator }, lock, 1).length, "no purchase, nothing to lock");
  assert.ok(creatorLockProblems(observation, creation, lock, 200).length, "a lock past its end locks nothing: the mark goes");
  assert.ok(creatorLockProblems(observation, creation, { ...lock, claimedRaw: lock.totalRaw }, 150).length, "everything claimed: the mark goes");
  assert.deepEqual(creatorLockProblems(observation, creation, { ...lock, claimedRaw: "1", heldRaw: "9809618999999" }, 150), [], "after the cliff, unlocking: the mark stays");
});

test("«Спільнота» sharing the creator's fees: the curve's creator role held by the vault from this token's own mint is the creator's, not another creator's", () => {
  const vault = "A89FiHwbvemvEricJFBTU63s1hEqzoTeJRGen2BsVPDR";
  const partner = "Fb2AbDwuQ4yNvmQRK7bTZWXoDZRE3AYLcqamPyhg4tL8";
  const feeSharing = {
    vault,
    owner: creation.creator,
    tokenMint: "8QwXVdfGjmnjZjF3TkzT4FZzA8J1gg9s8SfF9TUxFgEX",
    base: observation.token,
    totalShare: 10_000,
    fundedRaw: "0",
    users: [
      { address: creation.creator, share: 6_000, claimedRaw: "0" },
      { address: partner, share: 4_000, claimedRaw: "0" },
    ],
  };
  const shared = { ...observation, preset: "community", creator: vault, feeSharing };
  assert.deepEqual(launchCreationProblems(shared, creation, poolPayer), []);
  /* The vault of another token, made by someone else, or not sharing with the creator: another creator. */
  for (const wrong of [{ base: partner }, { owner: partner }, { users: [{ address: partner, share: 10_000, claimedRaw: "0" }] }]) {
    assert.ok(launchCreationProblems({ ...shared, feeSharing: { ...feeSharing, ...wrong } }, creation, poolPayer).includes("the creation names another creator"));
  }
  assert.ok(launchCreationProblems({ ...shared, preset: "classic" }, creation, poolPayer).includes("the creation names another creator"), "only «Спільнота» shares the creator's fees");
  assert.ok(launchCreationProblems({ ...observation, creator: vault, feeSharing: null }, creation, poolPayer).includes("the creation names another creator"));
});
