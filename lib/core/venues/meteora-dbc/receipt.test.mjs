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
    ["MINT_REVOKED", "NO_FREEZE", "METADATA_FIXED", "NO_TRANSFER_HOOK", "CURVE_HOLDS_FUNDS", "LP_LOCKED_FOREVER", "LP_LOCKED_FOREVER"],
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

test("before graduation the receipt has no pool marks and no pool", () => {
  const onCurve = { ...observation, curve: { ...observation.curve, migrated: false }, graduated: null };
  const facts = buildLaunchReceiptFacts({ ...input, observation: onCurve });
  assert.equal(facts.graduated, null);
  assert.ok(!facts.marks.some((mark) => mark.code === "LP_LOCKED_FOREVER"));
});

test("no purchase in the creation means no first-buy line, not a zero one", () => {
  const facts = buildLaunchReceiptFacts({ ...input, creation: { ...creation, creatorTokensOutRaw: "0", creatorQuoteInRaw: "0" } });
  assert.equal(facts.creatorFirstBuy, null);
});
