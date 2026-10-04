// Run from repo root: node --test lib/attribution/registry.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { findCapability, resolveFeeIdentity } from "../core/capabilities.ts";
import {
  isPublishable,
  ATTRIBUTION_REGISTRY,
  ATTRIBUTION_REGISTRY_VERSION,
  FEE_WALLET_PRODUCTS,
  awaitingAddresses,
  feeWalletOf,
  publicRegistry,
  publicRegistryDocument,
  registryFacts,
  registryStatus,
  solanaFeeOwners,
  validateRegistry,
} from "./registry.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const REFERRAL = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const NEW_WALLET = "MemeFeeWa11et1111111111111111111111111111111";
const SIG = (seed) => `constructed${seed}`.padEnd(88, "1");
const byId = (id, rows = ATTRIBUTION_REGISTRY) => rows.find((row) => row.id === id);
const withRow = (id, patch) => ATTRIBUTION_REGISTRY.map((row) => (row.id === id ? { ...row, ...patch } : row));

test("the registry holds: every row valid, every address once, every role in its place", () => {
  assert.equal(ATTRIBUTION_REGISTRY_VERSION, "1.0.0");
  assert.deepEqual(validateRegistry(), []);
});

test("a fee wallet for each of swap, memes, stocks, bots and API; payouts for cashback, friends and integrators; one treasury", () => {
  assert.deepEqual([...FEE_WALLET_PRODUCTS], ["swap", "memes", "stocks", "bots", "api"]);
  for (const product of FEE_WALLET_PRODUCTS) {
    const row = byId(`solana-fee-${product}`);
    assert.deepEqual([row.network, row.role, row.kind, row.countedAs, row.products.join()], ["solana", "FEE", "FEE_WALLET", "FEES", product]);
  }
  for (const [id, role] of [["solana-payout-cashback", "PAYOUT_CASHBACK"], ["solana-payout-friends", "PAYOUT_FRIENDS"], ["solana-payout-integrators", "PAYOUT_INTEGRATORS"]]) {
    const row = byId(id);
    assert.deepEqual([row.role, row.kind, row.countedAs], [role, "PAYOUT_WALLET", "SUPPLY_SIDE"], `${id}: a payout is the supply side's share, never revenue`);
  }
  assert.deepEqual([byId("solana-treasury").kind, byId("solana-treasury").countedAs], ["TREASURY_WALLET", "NONE"], "nothing is charged into the treasury");
  assert.equal(byId("solana-payout-rewards").role, "PAYOUT_REWARDS", "the wallet that pays cashback and friends today has its own row until the payouts move");
  assert.equal(byId("relay-app-fee").address, null, "the bridge's recipient is published once it is used for nothing else");
});

test("the identities at work are the referral account and its two token accounts; where each started is read from the chain, never written here", () => {
  assert.deepEqual(publicRegistry().map((row) => [row.id, row.address]), [
    ["solana-jupiter-referral", REFERRAL],
    ["solana-jupiter-referral-sol", "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY"],
    ["solana-jupiter-referral-usdc", "55p9Zk8tzq6YhnPgopW5X1sX5kHX1v1zuRiQNwqa5hYH"],
  ]);
  for (const row of ATTRIBUTION_REGISTRY) assert.equal("start" in row || "example" in row, false, `${row.id}: no start written in code`);
  const text = read("lib/attribution/registry.ts");
  assert.doesNotMatch(text, /[1-9A-HJ-NP-Za-km-z]{80,90}|0x[0-9a-fA-F]{64}/, "no transaction is committed in the registry");
  assert.doesNotMatch(text, /secret|private.?key|seed phrase|mnemonic/i);
});

test("chain facts: a fee identity starts at its earliest credit in any mint, a referral token account at its earliest credit in its own mint", () => {
  const credits = [
    { identity: "solana-jupiter-referral", mint: USDC, signature: SIG("b"), slot: 300, blockTime: 1_790_000_300 },
    { identity: "solana-jupiter-referral", mint: WSOL, signature: SIG("a"), slot: 100, blockTime: 1_790_000_100 },
    { identity: "solana-fee-memes", mint: WSOL, signature: SIG("m"), slot: 500, blockTime: null },
  ];
  const facts = registryFacts(credits);
  assert.deepEqual(facts.get("solana-jupiter-referral"), { network: "solana", block: 100, time: new Date(1_790_000_100_000).toISOString(), tx: SIG("a") });
  assert.equal(facts.get("solana-jupiter-referral-sol").block, 100);
  assert.equal(facts.get("solana-jupiter-referral-usdc").block, 300);
  assert.equal(facts.has("solana-fee-memes"), false, "a place without an address has no facts");
  const filled = withRow("solana-fee-memes", { address: NEW_WALLET });
  assert.deepEqual(registryFacts(credits, filled).get("solana-fee-memes"), { network: "solana", block: 500, time: null, tx: SIG("m") });

  const document = publicRegistryDocument(undefined, facts);
  assert.equal(document.observed, true);
  assert.deepEqual(document.rows.map((row) => [row.id, row.status, row.start?.block ?? null, row.example]), [
    ["solana-jupiter-referral", "LISTED", 100, SIG("a")],
    ["solana-jupiter-referral-sol", "LISTED", 100, SIG("a")],
    ["solana-jupiter-referral-usdc", "LISTED", 300, SIG("b")],
  ]);
  const unread = publicRegistryDocument();
  assert.equal(unread.observed, false, "without a whole read, a missing start means unknown — never 'none yet'");
  assert.ok(unread.rows.every((row) => row.start === null && row.example === null));
});

test("a place without an address counts nothing and is never published", () => {
  assert.deepEqual(awaitingAddresses(), [
    "solana-fee-swap",
    "solana-fee-memes",
    "solana-fee-stocks",
    "solana-fee-bots",
    "solana-fee-api",
    "relay-app-fee",
    "solana-payout-cashback",
    "solana-payout-friends",
    "solana-payout-integrators",
    "solana-payout-rewards",
    "solana-treasury",
  ]);
  for (const id of awaitingAddresses()) assert.equal(registryStatus(byId(id)), "AWAITING_ADDRESS");
});

test("the validator refuses what would mislead a counter", () => {
  assert.match(validateRegistry(withRow("solana-fee-memes", { address: REFERRAL })).join("\n"), /already solana-jupiter-referral's/, "one address, one job");
  assert.match(validateRegistry(withRow("solana-fee-memes", { address: `0x${"1".repeat(40)}` })).join("\n"), /not a base58 address/);
  assert.match(validateRegistry(withRow("relay-app-fee", { address: REFERRAL })).join("\n"), /not a 0x address/);
  assert.match(validateRegistry(withRow("solana-payout-cashback", { countedAs: "FEES" })).join("\n"), /disagree/, "a payout is never counted as fees");
  assert.match(validateRegistry(withRow("solana-fee-bots", { end: { block: 1, time: "2026-10-04T00:00:00.000Z" } })).join("\n"), /without an address cannot end/);
  assert.match(validateRegistry(ATTRIBUTION_REGISTRY.filter((row) => row.id !== "solana-fee-api")).join("\n"), /fee wallet for api: 0 rows/);
  assert.match(validateRegistry([...ATTRIBUTION_REGISTRY, { ...byId("solana-treasury"), id: "solana-treasury-two" }]).join("\n"), /TREASURY: 2 rows/);
});

test("the chain reader counts the referral account and every fee wallet with an address; a product's wallet is its own", () => {
  assert.deepEqual(solanaFeeOwners().map((owner) => [owner.id, owner.kind]), [["solana-jupiter-referral", "JUPITER_REFERRAL_ACCOUNT"]]);
  assert.equal(feeWalletOf("memes"), null);
  const filled = withRow("solana-fee-memes", { address: NEW_WALLET });
  assert.deepEqual(validateRegistry(filled), []);
  assert.deepEqual(solanaFeeOwners(filled).map((owner) => owner.id), ["solana-jupiter-referral", "solana-fee-memes"]);
  assert.equal(feeWalletOf("memes", "solana", filled), NEW_WALLET);
  assert.equal(feeWalletOf("swap", "base", withRow("solana-fee-swap", { address: NEW_WALLET })), null, "a Solana wallet is never another network's");
  assert.equal(publicRegistry(filled).length, 4, "an address once written is published");
  const retired = withRow("solana-jupiter-referral", { end: { block: 460_000_000, time: "2026-11-01T00:00:00.000Z" } });
  assert.deepEqual(solanaFeeOwners(retired).map((owner) => [owner.id, owner.endSlot]), [["solana-jupiter-referral", 460_000_000]], "a retired identity keeps its history, bounded by its end");
  assert.equal(registryStatus(byId("solana-jupiter-referral", retired)), "RETIRED");
});

test("the core's capability registry asks this registry for a product's fee wallet", () => {
  const pump = findCapability("solana", "pump", "swap");
  assert.deepEqual(resolveFeeIdentity(pump, "memes", { jupiterReferralAccount: REFERRAL, relayAppFeeRecipient: null, mayanReferrerSolana: null }), { product: "memes", kind: "FEE_WALLET", address: null });
});

test("the JSON route serves the published rows with the chain's facts, public, cached at the edge", () => {
  const route = read("app/api/stats/registry/route.ts");
  assert.match(route, /registryDocumentOf\(await readAttribution\(\)\)/);
  assert.match(route, /s-maxage=600/);
  assert.doesNotMatch(route, /getAdminSession|cookies\(/);
  const server = read("lib/attribution/stats.server.ts");
  assert.match(server, /chain\.coverage\.complete && !chain\.coverage\.truncated/, "facts only from a read that saw the whole history");
});

test("a fee wallet is rotated by giving the old row an end and adding a new one: both kept, one open", () => {
  const old = { ...ATTRIBUTION_REGISTRY.find((row) => row.id === "solana-fee-memes"), address: NEW_WALLET, end: { block: 460_000_000, time: "2026-11-01T00:00:00.000Z" } };
  const rotated = [...ATTRIBUTION_REGISTRY.filter((row) => row.id !== "solana-fee-memes"), old, { ...old, id: "solana-fee-memes-2", address: "MemeFeeWa11et2222222222222222222222222222222", end: null }];
  assert.deepEqual(validateRegistry(rotated), []);
  assert.equal(feeWalletOf("memes", "solana", rotated), "MemeFeeWa11et2222222222222222222222222222222");
  assert.deepEqual(solanaFeeOwners(rotated).map((owner) => [owner.id, owner.endSlot]), [["solana-jupiter-referral", null], ["solana-fee-memes", 460_000_000], ["solana-fee-memes-2", null]]);
});

test("a wallet that pays friends' rewards is registered and never published: everyone it pays would be named as an inviter", () => {
  const filled = withRow("solana-payout-friends", { address: NEW_WALLET });
  const withRewards = filled.map((row) => (row.id === "solana-payout-rewards" ? { ...row, address: "Rewards1111111111111111111111111111111111111" } : row));
  assert.deepEqual(validateRegistry(withRewards), []);
  assert.equal(isPublishable(byId("solana-payout-friends", withRewards)), false);
  assert.equal(isPublishable(byId("solana-payout-rewards", withRewards)), false);
  assert.ok(!publicRegistry(withRewards).some((row) => row.role === "PAYOUT_FRIENDS" || row.role === "PAYOUT_REWARDS"));
});
