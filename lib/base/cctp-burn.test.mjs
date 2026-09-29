import assert from "node:assert/strict";
import test from "node:test";

import {
  anyDestinationCallerHex,
  CCTP_DEPOSIT_FOR_BURN_SELECTOR,
  encodeDepositForBurn,
  encodeErc20Approve,
  ERC20_APPROVE_SELECTOR,
  planBaseCctpBurn,
  solanaMintRecipient,
} from "./cctp-burn.ts";

/**
 * One real mainnet Base burn, used as the specification.
 *
 * CCTP V1 exposes a `depositForBurn` with the same name and five arguments, so
 * the selector and the argument order cannot be taken from a name — both were
 * read off `0xf5ee059095c0bcdb7e20bd65c841e1104f2500d0036633ee21b7c267e583bd04`,
 * a Base transfer of 94,439,594,248 base units to domain 0 with a zero fee
 * ceiling, a zero destination caller and Standard finality.
 */
const LIVE = Object.freeze({
  selector: "0x8e0250ee",
  amountRaw: "94439594248",
  destinationDomain: 0,
  mintRecipientHex: "00000000000000000000000007ae8551be970cb1cca11dd7a11f47ae82e70e67",
  burnToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  destinationCallerHex: "0".repeat(64),
  maxFeeRaw: "0",
  minFinalityThreshold: 2000,
  words: [
    "00000000000000000000000000000000000000000000000000000015fd09d908",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "00000000000000000000000007ae8551be970cb1cca11dd7a11f47ae82e70e67",
    "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0000000000000000000000000000000000000000000000000000000000000000",
    "00000000000000000000000000000000000000000000000000000000000007d0",
  ],
});

test("the encoder reproduces a real mainnet Base burn word for word", function () {
  const data = encodeDepositForBurn(LIVE);
  assert.equal(data.slice(0, 10), LIVE.selector);
  assert.equal(CCTP_DEPOSIT_FOR_BURN_SELECTOR, LIVE.selector);
  const words = data.slice(10).match(/.{64}/g) ?? [];
  assert.equal(words.length, 7);
  words.forEach((word, index) => assert.equal(word, LIVE.words[index], `argument ${index}`));
});

test("a fee ceiling at or above the amount is refused before a wallet opens", function () {
  assert.throws(
    () => encodeDepositForBurn({ ...LIVE, maxFeeRaw: LIVE.amountRaw }),
    /fee ceiling must be below the amount/,
  );
});

test("a recipient that is not thirty-two bytes never becomes calldata", function () {
  assert.throws(() => encodeDepositForBurn({ ...LIVE, mintRecipientHex: "ab" }), /thirty-two bytes/);
  assert.throws(() => encodeDepositForBurn({ ...LIVE, destinationCallerHex: "ab" }), /thirty-two bytes/);
  assert.throws(() => encodeDepositForBurn({ ...LIVE, burnToken: "0x1234" }), /Not a 20-byte EVM address/);
});

/**
 * The recipient on a Solana destination.
 *
 * This is the field that decides where the money lands, and the trap is that a
 * Solana public key and a Solana *token account* are both thirty-two bytes and
 * both look like an address. CCTP credits the token account.
 */
test("a Solana address encodes as the thirty-two bytes CCTP carries", function () {
  const hex = solanaMintRecipient("25EcQPRGr4gTbd5aiSwcE39XEUkDWLwGS6DrZN6b8R9b");
  assert.equal(hex, "0ff166450fed325c833117e8d6f71a38f7ed3e9bac0b67ffd3af17ba33fe24ea");
  assert.equal(hex.length, 64);
  assert.throws(() => solanaMintRecipient("0x152d117c0cfdd2e807a4e7cc4d839da9586ec401"), /Not a Solana address/);
});

test("anyone may complete the mint, and it is thirty-two zero bytes that says so", function () {
  assert.equal(anyDestinationCallerHex(), "0".repeat(64));
});

test("the approval is written for the exact amount, never for an unlimited one", function () {
  const data = encodeErc20Approve("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d", "2000000");
  assert.equal(data.slice(0, 10), ERC20_APPROVE_SELECTOR);
  const words = data.slice(10).match(/.{64}/g) ?? [];
  assert.equal(words[0], `${"0".repeat(24)}28b5a0e9c621a5badaa536219b3a228c8168cf5d`);
  assert.equal(BigInt(`0x${words[1]}`), 2_000_000n);
  assert.notEqual(BigInt(`0x${words[1]}`), (1n << 256n) - 1n);
});

const CHAIN = {
  usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  messenger: "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d",
};

/* `planBaseCctpBurn` reaches the chain through `baseRpcCall`, `baseEthCall` and
   `readBaseErc20Balance`. Rather than stubbing three modules, the plan is
   exercised through a handle whose `fetch` is replaced — the same seam the
   rest of the Base tests use. */
function stubFetch(table) {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const key = body.method === "eth_call" ? `eth_call:${String(body.params[0].data).slice(0, 10)}` : body.method;
    const answer = table[key];
    if (answer === undefined) throw new Error(`no stub for ${key}`);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: answer }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const provider = {
  direction: "BASE_TO_SOLANA",
  sourceDomain: 6,
  destinationDomain: 5,
  fees: { state: "AVAILABLE", observedAt: "2026-09-04T00:00:00.000Z", tiers: [
    { mode: "FAST", finalityThreshold: 1000, minimumFeeBps: "1" },
    { mode: "STANDARD", finalityThreshold: 2000, minimumFeeBps: "0" },
  ] },
};

async function planWith(table, overrides = {}) {
  const { createBaseRpcHandle } = await import("./rpc.ts");
  const handle = createBaseRpcHandle({ fetchImpl: stubFetch(table) });
  return planBaseCctpBurn(handle, {
    provider,
    owner: "0x152d117c0cfdd2e807a4e7cc4d839da9586ec401",
    destinationOwner: "7XxNTiBLVmy7KiTFWMUWHXRF7fJWZFTX8XEFiSpJvbSj",
    destinationTokenAccount: "25EcQPRGr4gTbd5aiSwcE39XEUkDWLwGS6DrZN6b8R9b",
    destinationAccountExists: true,
    amountRaw: "2000000",
    now: () => new Date("2026-09-04T00:00:00.000Z"),
    ...overrides,
  });
}

const hexWord = (value) => `0x${value.toString(16).padStart(64, "0")}`;

test("a sufficient allowance is one wallet prompt, and the burn is priced", async function () {
  const built = await planWith({
    "eth_call:0x70a08231": hexWord(10_000_000n),
    "eth_call:0xdd62ed3e": hexWord(10_000_000n),
    eth_getBalance: "0x2386f26fc10000",
    eth_gasPrice: "0x5f5e100",
    eth_estimateGas: "0x30d40",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.plan.walletPrompts, 1);
  assert.equal(built.plan.calls.length, 1);
  assert.equal(built.plan.calls[0].purpose, "BURN");
  assert.equal(built.plan.calls[0].to.toLowerCase(), CHAIN.messenger);
  assert.equal(built.plan.allowance.sufficient, true);
  assert.equal(built.plan.allowance.approveAmountRaw, null);
  assert.equal(built.plan.totalMaximumCostWei, (200_000n * 100_000_000n).toString());
  assert.equal(built.plan.affordable, true);
  assert.equal(built.plan.expectedReceiveRaw, "2000000", "a zero-basis-point Standard tier takes nothing");
});

test("a short allowance is two prompts, and the second one is honestly unpriced", async function () {
  const built = await planWith({
    "eth_call:0x70a08231": hexWord(10_000_000n),
    "eth_call:0xdd62ed3e": hexWord(0n),
    eth_getBalance: "0x2386f26fc10000",
    eth_gasPrice: "0x5f5e100",
    eth_estimateGas: "0xea60",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.plan.walletPrompts, 2);
  assert.deepEqual(built.plan.calls.map((call) => call.purpose), ["APPROVE", "BURN"]);
  assert.equal(built.plan.calls[0].to.toLowerCase(), CHAIN.usdc);
  assert.equal(built.plan.allowance.approveAmountRaw, "2000000");
  /* The burn genuinely would revert until the approval lands, so it carries a
     reason rather than a number nobody read anywhere. */
  assert.equal(built.plan.calls[1].gasEstimate, null);
  assert.match(built.plan.calls[1].unpricedReason, /cannot price the transfer until the permission/);
  assert.equal(built.plan.totalMaximumCostWei, null);
  assert.equal(built.plan.affordable, null);
});

test("a wallet holding less USDC than the transfer is refused before anything is built", async function () {
  const built = await planWith({
    "eth_call:0x70a08231": hexWord(1_000n),
    "eth_call:0xdd62ed3e": hexWord(10_000_000n),
    eth_getBalance: "0x2386f26fc10000",
    eth_gasPrice: "0x5f5e100",
    eth_estimateGas: "0x30d40",
  });
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, "BALANCE_INSUFFICIENT");
});

test("an unreadable allowance is not a granted one", async function () {
  const built = await planWith({
    "eth_call:0x70a08231": hexWord(10_000_000n),
    "eth_call:0xdd62ed3e": "not-hex",
    eth_getBalance: "0x2386f26fc10000",
    eth_gasPrice: "0x5f5e100",
    eth_estimateGas: "0x30d40",
  });
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, "ALLOWANCE_UNREADABLE");
  assert.match(built.reason, /unknown permission is not a granted one/);
});

test("a fee that could not be read is not a zero fee", async function () {
  const built = await planWith(
    {
      "eth_call:0x70a08231": hexWord(10_000_000n),
      "eth_call:0xdd62ed3e": hexWord(10_000_000n),
      eth_getBalance: "0x2386f26fc10000",
      eth_gasPrice: "0x5f5e100",
      eth_estimateGas: "0x30d40",
    },
    { provider: { ...provider, fees: { state: "UNAVAILABLE", code: "REFUSED", status: 403 } } },
  );
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.equal(built.code, "PROVIDER_FACTS_UNAVAILABLE");
});

test("the plan names the destination token account, not the wallet behind it", async function () {
  const built = await planWith({
    "eth_call:0x70a08231": hexWord(10_000_000n),
    "eth_call:0xdd62ed3e": hexWord(10_000_000n),
    eth_getBalance: "0x2386f26fc10000",
    eth_gasPrice: "0x5f5e100",
    eth_estimateGas: "0x30d40",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.plan.destinationOwner, "7XxNTiBLVmy7KiTFWMUWHXRF7fJWZFTX8XEFiSpJvbSj");
  assert.equal(built.plan.destinationRecipient, "25EcQPRGr4gTbd5aiSwcE39XEUkDWLwGS6DrZN6b8R9b");
  assert.equal(
    built.plan.mintRecipientHex,
    "0x0ff166450fed325c833117e8d6f71a38f7ed3e9bac0b67ffd3af17ba33fe24ea",
  );
  /* And the calldata carries that same account, so the two cannot drift. */
  const burn = built.plan.calls.find((call) => call.purpose === "BURN");
  assert.match(burn.data, /0ff166450fed325c833117e8d6f71a38f7ed3e9bac0b67ffd3af17ba33fe24ea/);
});
