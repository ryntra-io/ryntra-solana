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
  SOLANA_FEE_WALLET,
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
const FEE_WALLET = "5sWCoxARMPyGdqTu9ru6z69REZ1ZZLojcb1rfABDP2Ne";
const SIG = (seed) => `constructed${seed}`.padEnd(88, "1");
/* Ryntra Launch's identities, published since Launch opened to people (2026-10-06); the pool payer once its address is written. */
const LAUNCH_ROWS = [
  ["solana-launch-config-classic", "B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G"],
  ["solana-launch-config-protected", "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G"],
  ["solana-launch-fee-claimer", "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA"],
  ...ATTRIBUTION_REGISTRY.filter((row) => row.id === "solana-launch-pool-payer" && row.address !== null).map((row) => [row.id, row.address]),
  ["solana-launch-executor", "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU"],
  ["solana-launch-referral-usdc", "4kVogGhWqheXKjteM2urywUS5L8q7AnSNJCYDna4VrDy"],
];
const byId = (id, rows = ATTRIBUTION_REGISTRY) => rows.find((row) => row.id === id);
const withRow = (id, patch) => ATTRIBUTION_REGISTRY.map((row) => (row.id === id ? { ...row, ...patch } : row));

test("the registry holds: every row valid, every address once, every role in its place", () => {
  assert.equal(ATTRIBUTION_REGISTRY_VERSION, "1.0.0");
  assert.deepEqual(validateRegistry(), []);
});

test("one fee wallet for swap, memes, stocks, bots and API; payouts for cashback, friends and integrators; one treasury", () => {
  assert.deepEqual([...FEE_WALLET_PRODUCTS], ["swap", "memes", "stocks", "bots", "api"]);
  const row = byId("solana-fee-wallet");
  assert.deepEqual([row.network, row.role, row.kind, row.countedAs, row.address, row.products.join()], ["solana", "FEE", "FEE_WALLET", "FEES", FEE_WALLET, "swap,memes,stocks,bots,api"]);
  assert.equal(SOLANA_FEE_WALLET, FEE_WALLET);
  for (const product of FEE_WALLET_PRODUCTS) assert.equal(feeWalletOf(product), FEE_WALLET, `${product}: its fee lands in the one fee wallet`);
  for (const [id, role] of [["solana-payout-cashback", "PAYOUT_CASHBACK"], ["solana-payout-friends", "PAYOUT_FRIENDS"], ["solana-payout-integrators", "PAYOUT_INTEGRATORS"]]) {
    const row = byId(id);
    assert.deepEqual([row.role, row.kind, row.countedAs], [role, "PAYOUT_WALLET", "SUPPLY_SIDE"], `${id}: a payout is the supply side's share, never revenue`);
  }
  assert.deepEqual([byId("solana-treasury").kind, byId("solana-treasury").countedAs], ["TREASURY_WALLET", "NONE"], "nothing is charged into the treasury");
  assert.equal(byId("solana-payout-rewards").role, "PAYOUT_REWARDS", "the wallet that pays cashback and friends today has its own row until the payouts move");
  assert.equal(byId("relay-app-fee").address, null, "the bridge's recipient is published once it is used for nothing else");
});

test("the identities at work are the referral account, its two token accounts, the fee wallet and Ryntra Launch's; where each started is read from the chain, never written here", () => {
  assert.deepEqual(publicRegistry().map((row) => [row.id, row.address]), [
    ["solana-jupiter-referral", REFERRAL],
    ["solana-jupiter-referral-sol", "A3QWi67fFpQ2PrGXghjLMQdWAkHeN43NbFp9FxpCeorY"],
    ["solana-jupiter-referral-usdc", "55p9Zk8tzq6YhnPgopW5X1sX5kHX1v1zuRiQNwqa5hYH"],
    ["solana-fee-wallet", FEE_WALLET],
    ...LAUNCH_ROWS,
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
    { identity: "solana-fee-wallet", mint: WSOL, signature: SIG("m"), slot: 500, blockTime: null },
    { identity: "solana-payout-cashback", mint: WSOL, signature: SIG("p"), slot: 50, blockTime: null },
  ];
  const facts = registryFacts(credits);
  assert.deepEqual(facts.get("solana-jupiter-referral"), { network: "solana", block: 100, time: new Date(1_790_000_100_000).toISOString(), tx: SIG("a") });
  assert.equal(facts.get("solana-jupiter-referral-sol").block, 100);
  assert.equal(facts.get("solana-jupiter-referral-usdc").block, 300);
  assert.deepEqual(facts.get("solana-fee-wallet"), { network: "solana", block: 500, time: null, tx: SIG("m") });
  assert.equal(facts.has("solana-payout-cashback"), false, "a place without an address has no facts");

  /* A launch identity is not credited: its start is the first transaction it took part in, read on its own. */
  const starts = new Map([["solana-launch-config-classic", { network: "solana", block: 453_497_859, time: null, tx: SIG("c") }]]);
  const document = publicRegistryDocument(undefined, facts, new Map(), starts);
  assert.equal(document.observed, true);
  assert.deepEqual(document.rows.map((row) => [row.id, row.status, row.start?.block ?? null, row.example]), [
    ["solana-jupiter-referral", "LISTED", 100, SIG("a")],
    ["solana-jupiter-referral-sol", "LISTED", 100, SIG("a")],
    ["solana-jupiter-referral-usdc", "LISTED", 300, SIG("b")],
    ["solana-fee-wallet", "LISTED", 500, SIG("m")],
    ...LAUNCH_ROWS.map(([id]) => [id, "LISTED", id === "solana-launch-config-classic" ? 453_497_859 : null, id === "solana-launch-config-classic" ? SIG("c") : null]),
  ]);
  assert.equal(publicRegistryDocument(undefined, facts, new Map(), new Map([["solana-fee-wallet", { network: "solana", block: 1, time: null, tx: SIG("z") }]])).rows.find((row) => row.id === "solana-fee-wallet").start.block, 500, "a credited identity starts at its first credit, never at a start read for another kind");
  assert.equal(document.rows.find((row) => row.id === "solana-launch-fee-claimer").observed, false, "a launch identity without its start read is unknown, not «none yet»");
  const unread = publicRegistryDocument();
  assert.equal(unread.observed, false, "without a whole read, a missing start means unknown — never 'none yet'");
  assert.ok(unread.rows.every((row) => row.start === null && row.example === null));
});

test("a place without an address counts nothing and is never published", () => {
  assert.deepEqual(awaitingAddresses(), [
    "relay-app-fee",
    "solana-payout-cashback",
    "solana-payout-friends",
    "solana-payout-integrators",
    "solana-payout-rewards",
    "solana-treasury",
  ]);
  for (const id of awaitingAddresses()) assert.equal(registryStatus(byId(id)), "AWAITING_ADDRESS");
});

test("Ryntra Launch: each preset's config counts the launchpad's fees, the multisig that collects them counts nothing twice", () => {
  for (const id of ["solana-launch-config-classic", "solana-launch-config-protected"]) {
    const row = byId(id);
    assert.deepEqual([row.role, row.kind, row.countedAs, row.products.join()], ["LAUNCH_CONFIG", "DBC_CONFIG", "FEES", "launch"], id);
  }
  assert.deepEqual([byId("solana-launch-fee-claimer").kind, byId("solana-launch-fee-claimer").countedAs], ["DBC_FEE_CLAIMER", "NONE"], "the same money, arriving later");
  assert.deepEqual([byId("solana-launch-pool-payer").kind, byId("solana-launch-pool-payer").countedAs], ["LAUNCH_POOL_PAYER", "NONE"]);
  /* The executor sends graduations and holds Ryntra's liquidity: it takes no fee and is paid none of the partner's. */
  assert.deepEqual([byId("solana-launch-executor").role, byId("solana-launch-executor").kind, byId("solana-launch-executor").countedAs], ["LAUNCH_EXECUTOR", "LAUNCH_EXECUTOR", "NONE"]);
  /* The executor's own wallet since 2026-10-09: drawn on the public page, its actions attributable to it. */
  assert.equal(byId("solana-launch-executor").address, "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU");
  assert.equal(isPublishable(byId("solana-launch-executor")), true, "the executor's address is on the public page");
  assert.deepEqual(
    ["solana-launch-config-classic", "solana-launch-config-protected", "solana-launch-fee-claimer"].map((id) => byId(id).address),
    ["B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1G", "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G", "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA"],
    "the mainnet configs and the multisig vault that claims their fees",
  );
  for (const id of ["solana-launch-config-classic", "solana-launch-config-protected", "solana-launch-fee-claimer"]) {
    assert.equal(isPublishable(byId(id)), true, `${id}: drawn on the public page since Launch opened to people`);
  }
  assert.equal(solanaFeeOwners().some((owner) => owner.id.startsWith("solana-launch")), false, "the swap fee reader counts no launch identity");
  /* Meteora's referral in a launch's trades: the vault's USDC account, counted by the swap event's referral fee. */
  const referral = byId("solana-launch-referral-usdc");
  assert.deepEqual([referral.role, referral.kind, referral.countedAs, referral.parent, referral.mint, referral.products.join()], ["LAUNCH_REFERRAL", "METEORA_REFERRAL_TOKEN_ACCOUNT", "FEES", "solana-launch-fee-claimer", USDC, "launch"]);
  assert.equal(isPublishable(referral), true);
  assert.match(validateRegistry(withRow("solana-launch-referral-usdc", { mint: null })).join("\n"), /names its account and its mint/);
  assert.match(validateRegistry(withRow("solana-launch-referral-usdc", { countedAs: "NONE" })).join("\n"), /disagree/);
  assert.match(validateRegistry(withRow("solana-launch-fee-claimer", { address: FEE_WALLET })).join("\n"), /already solana-fee-wallet's/, "the launch claimer is no other wallet");
  assert.match(validateRegistry(withRow("solana-launch-config-classic", { countedAs: "NONE" })).join("\n"), /disagree/);
  assert.match(validateRegistry(withRow("solana-launch-pool-payer", { products: ["launch", "memes"] })).join("\n"), /Ryntra Launch alone/);
  assert.match(validateRegistry([...ATTRIBUTION_REGISTRY, { ...byId("solana-launch-fee-claimer"), id: "solana-launch-fee-claimer-two" }]).join("\n"), /LAUNCH_FEE_CLAIMER: more than one open row/);
});

test("the validator refuses what would mislead a counter", () => {
  assert.match(validateRegistry(withRow("solana-fee-wallet", { address: REFERRAL })).join("\n"), /already solana-jupiter-referral's/, "one address, one job");
  assert.match(validateRegistry(withRow("solana-fee-wallet", { address: `0x${"1".repeat(40)}` })).join("\n"), /not a base58 address/);
  assert.match(validateRegistry(withRow("relay-app-fee", { address: REFERRAL })).join("\n"), /not a 0x address/);
  assert.match(validateRegistry(withRow("solana-payout-cashback", { countedAs: "FEES" })).join("\n"), /disagree/, "a payout is never counted as fees");
  assert.match(validateRegistry(withRow("solana-treasury", { end: { block: 1, time: "2026-10-04T00:00:00.000Z" } })).join("\n"), /without an address cannot end/);
  assert.match(validateRegistry(withRow("solana-fee-wallet", { products: ["swap", "memes", "stocks", "bots"] })).join("\n"), /fee wallet for api: 0 rows/);
  assert.match(validateRegistry([...ATTRIBUTION_REGISTRY, { ...byId("solana-fee-wallet"), id: "solana-fee-memes", address: NEW_WALLET, products: ["memes"] }]).join("\n"), /fee wallet for memes: 2 rows/, "one open fee wallet per product");
  assert.match(validateRegistry([...ATTRIBUTION_REGISTRY, { ...byId("solana-treasury"), id: "solana-treasury-two" }]).join("\n"), /TREASURY: 2 rows/);
});

test("the chain reader counts the referral account and every fee wallet with an address; a product may move to a wallet of its own", () => {
  assert.deepEqual(solanaFeeOwners().map((owner) => [owner.id, owner.kind]), [["solana-jupiter-referral", "JUPITER_REFERRAL_ACCOUNT"], ["solana-fee-wallet", "FEE_WALLET"]]);
  assert.equal(feeWalletOf("memes"), FEE_WALLET);
  const split = [...withRow("solana-fee-wallet", { products: ["swap", "stocks", "bots", "api"] }), { ...byId("solana-fee-wallet"), id: "solana-fee-memes", address: NEW_WALLET, products: ["memes"] }];
  assert.deepEqual(validateRegistry(split), []);
  assert.deepEqual(solanaFeeOwners(split).map((owner) => owner.id), ["solana-jupiter-referral", "solana-fee-wallet", "solana-fee-memes"]);
  assert.equal(feeWalletOf("memes", "solana", split), NEW_WALLET);
  assert.equal(feeWalletOf("swap", "solana", split), FEE_WALLET);
  assert.equal(feeWalletOf("swap", "base"), null, "a Solana wallet is never another network's");
  assert.equal(publicRegistry(split).length, 5 + LAUNCH_ROWS.length, "an address once written is published");
  const retired = withRow("solana-jupiter-referral", { end: { block: 460_000_000, time: "2026-11-01T00:00:00.000Z" } });
  assert.deepEqual(solanaFeeOwners(retired).map((owner) => [owner.id, owner.endSlot]), [["solana-jupiter-referral", 460_000_000], ["solana-fee-wallet", null]], "a retired identity keeps its history, bounded by its end");
  assert.equal(registryStatus(byId("solana-jupiter-referral", retired)), "RETIRED");
});

test("the core's capability registry asks this registry for a product's fee wallet", () => {
  const pump = findCapability("solana", "pump", "swap");
  assert.deepEqual(resolveFeeIdentity(pump, "memes", { jupiterReferralAccount: REFERRAL, relayAppFeeRecipient: null, mayanReferrerSolana: null }), { product: "memes", kind: "FEE_WALLET", address: FEE_WALLET });
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
  const old = { ...byId("solana-fee-wallet"), end: { block: 460_000_000, time: "2026-11-01T00:00:00.000Z" } };
  const rotated = [...ATTRIBUTION_REGISTRY.filter((row) => row.id !== "solana-fee-wallet"), old, { ...old, id: "solana-fee-wallet-2", address: "MemeFeeWa11et2222222222222222222222222222222", end: null }];
  assert.deepEqual(validateRegistry(rotated), []);
  assert.equal(feeWalletOf("memes", "solana", rotated), "MemeFeeWa11et2222222222222222222222222222222");
  assert.deepEqual(solanaFeeOwners(rotated).map((owner) => [owner.id, owner.endSlot]), [["solana-jupiter-referral", null], ["solana-fee-wallet", 460_000_000], ["solana-fee-wallet-2", null]]);
});

test("a wallet that pays friends' rewards is registered and never published: everyone it pays would be named as an inviter", () => {
  const filled = withRow("solana-payout-friends", { address: NEW_WALLET });
  const withRewards = filled.map((row) => (row.id === "solana-payout-rewards" ? { ...row, address: "Rewards1111111111111111111111111111111111111" } : row));
  assert.deepEqual(validateRegistry(withRewards), []);
  assert.equal(isPublishable(byId("solana-payout-friends", withRewards)), false);
  assert.equal(isPublishable(byId("solana-payout-rewards", withRewards)), false);
  assert.ok(!publicRegistry(withRewards).some((row) => row.role === "PAYOUT_FRIENDS" || row.role === "PAYOUT_REWARDS"));
});
