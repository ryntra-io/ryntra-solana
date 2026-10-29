import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SIG_PLACEHOLDER,
  RIALTO_ACTION_TYPEHASH,
  RIALTO_DIRECT_SWAP_SELECTOR,
  RIALTO_ROUTER_RUNTIME_CODE_HASH,
  RIALTO_EXECUTE_SELECTOR,
  SPOT_FEE_RECIPIENT_ADDRESS,
  readRialtoDirectRoutePin,
  readRialtoExecutionTokenMetadata,
  readSpotQuoteFee,
  SPOT_MIN_NOTIONAL_USDG,
  validateSpotExecutionIntent,
} from "./spot-exec-policy.ts";
import {
  approvePermit2,
  needsPermit2Approval,
  prepareSpotSwap,
  SpotApprovalRequiredError,
  SpotIntentExpiredError,
  SpotSubmissionUnknownError,
  SpotApprovalUnknownError,
  submitPreparedSpotSwap,
} from "./spot-exec.ts";
import {
  PERMIT2_ADDRESS,
  SPOT_CHAIN_ID,
  SPOT_CHAIN_ID_HEX,
  SPOT_SETTLEMENT_ROUTER_ADDRESS,
  USDG_ADDRESS,
} from "./spot.ts";
import { keccak256Hex } from "../crypto/keccak.ts";

const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const SELL_TOKEN = USDG_ADDRESS;
const BUY_TOKEN = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";
const TAKER = "0x3333333333333333333333333333333333333333";
const SELL_AMOUNT = 11_000_000n;
const MIN_BUY_AMOUNT = "25000000000000000";
const QUOTE_ID = "a10b42e8-73c4-4d33-a94a-69af7cd910be";
const WITNESS_QUOTE_ID = `0x${"44".repeat(32)}`;

const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const addressWord = (value) => value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const bytes32Word = (value) => value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const replaceCalldataWord = (data, index, replacement) => {
  const start = 10 + index * 64;
  return data.slice(0, start) + replacement + data.slice(start + 64);
};


function fixture(nowMs = NOW_MS, actionOverride = {}) {
  const deadline = String(Math.floor(nowMs / 1000) + 90);
  const referralCode = `0x${"55".repeat(32)}`;
  const actionSellAmount = SELL_AMOUNT - SELL_AMOUNT * 10n / 10_000n;
  const routePin = readRialtoDirectRoutePin(SELL_TOKEN, BUY_TOKEN);
  assert.ok(routePin);
  const action = {
    kind: 0n,
    target: routePin.target,
    sellToken: SELL_TOKEN,
    buyToken: BUY_TOKEN,
    sellAmount: actionSellAmount,
    scalar: 0n,
    minBuyAmount: BigInt(MIN_BUY_AMOUNT),
    selector: RIALTO_DIRECT_SWAP_SELECTOR,
    direction: 0n,
    nestedSellAmount: actionSellAmount,
    nestedMinBuyAmount: BigInt(MIN_BUY_AMOUNT),
    nestedRecipient: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    nestedDeadline: BigInt(deadline),
    finalScalar: 36n,
    ...actionOverride,
  };
  const actionBytes = [
    action.selector.slice(2),
    word(action.direction),
    word(action.nestedSellAmount),
    word(action.nestedMinBuyAmount),
    addressWord(action.nestedRecipient),
    word(action.nestedDeadline),
  ].join("");
  const actionWords = [
    word(action.kind),
    addressWord(action.target),
    addressWord(action.sellToken),
    addressWord(action.buyToken),
    word(action.sellAmount),
    word(action.scalar),
    word(action.minBuyAmount),
    word(0x120),
    word(action.finalScalar),
  ];
  const actionEncoded = [
    RIALTO_ACTION_TYPEHASH.slice(2),
    ...actionWords.slice(0, 7),
    keccak256Hex(`0x${actionBytes}`).slice(2),
    actionWords[8],
  ].join("");
  const actionHash = keccak256Hex(`0x${actionEncoded}`);
  const actionsHash = keccak256Hex(actionHash);
  const actionTuple = [
    ...actionWords,
    word(actionBytes.length / 2),
    actionBytes.padEnd(Math.ceil(actionBytes.length / 64) * 64, "0"),
  ].join("");
  const actions = [word(1), word(32), actionTuple].join("");
  const permit = [
    addressWord(TAKER),
    word(1),
    word(deadline),
    word(0x80),
    word(65),
    SIG_PLACEHOLDER + "00".repeat(31),
  ].join("");
  const staticHead = [
    addressWord(SELL_TOKEN),
    addressWord(BUY_TOKEN),
    word(SELL_AMOUNT),
    word(MIN_BUY_AMOUNT),
    addressWord(TAKER),
    word(deadline),
    addressWord(SPOT_FEE_RECIPIENT_ADDRESS),
    word(10),
    word(0),
    bytes32Word(referralCode),
    bytes32Word(WITNESS_QUOTE_ID),
    word(0x1a0),
    word(0x2a0),
  ].join("");
  const feeAmount = SELL_AMOUNT * 11n / 10_000n;

  return {
    venue: "rialto",
    buyAmount: "26000000000000000",
    sellAmount: SELL_AMOUNT.toString(),
    minBuyAmount: MIN_BUY_AMOUNT,
    quoteId: QUOTE_ID,
    fees: [],
    needsAllowance: false,
    tx: {
      to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
      data: `${RIALTO_EXECUTE_SELECTOR}${staticHead}${permit}${actions}`,
      value: "0x0",
    },
    toSign: {
      domain: {
        name: "Permit2",
        chainId: SPOT_CHAIN_ID,
        verifyingContract: PERMIT2_ADDRESS,
      },
      primaryType: "PermitWitnessTransferFrom",
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "witness", type: "RialtoSwap" },
        ],
        RialtoSwap: [
          { name: "recipient", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "minBuyAmount", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "feeRecipient", type: "address" },
          { name: "srcBps", type: "uint16" },
          { name: "dstBps", type: "uint16" },
          { name: "referralCode", type: "bytes32" },
          { name: "quoteId", type: "bytes32" },
          { name: "actionsHash", type: "bytes32" },
        ],
      },
      message: {
        permitted: { token: SELL_TOKEN, amount: SELL_AMOUNT.toString() },
        spender: SPOT_SETTLEMENT_ROUTER_ADDRESS,
        nonce: "1",
        deadline,
        witness: {
          recipient: TAKER,
          buyToken: BUY_TOKEN,
          minBuyAmount: MIN_BUY_AMOUNT,
          deadline,
          feeRecipient: SPOT_FEE_RECIPIENT_ADDRESS,
          srcBps: "10",
          dstBps: "0",
          referralCode,
          quoteId: WITNESS_QUOTE_ID,
          actionsHash,
        },
      },
    },
    raw: {
      platform_fee: {
        total_bps: 11,
        fees: [{
          side: "source",
          token: SELL_TOKEN,
          symbol: "USDG",
          decimals: 6,
          bps: "11",
          bps_x100: 1100,
          amount: feeAmount.toString(),
          amount_decimal: "0.0121",
          recipient: SPOT_FEE_RECIPIENT_ADDRESS,
        }],
      },
    },
  };
}

const validate = (quote = fixture()) => validateSpotExecutionIntent({
  quote,
  taker: TAKER,
  sellToken: SELL_TOKEN,
  buyToken: BUY_TOKEN,
  sellAmount: SELL_AMOUNT,
  nowMs: NOW_MS,
});

test("accepts a fully bound Rialto Permit2 execution intent", () => {
  assert.deepEqual(validate(), {
    srcBps: 10, dstBps: 0, signedBps: 10, totalBps: 11, side: "source",
    recipient: SPOT_FEE_RECIPIENT_ADDRESS, token: SELL_TOKEN.toLowerCase(),
    symbol: "USDG", decimals: 6,
    amount: "12100", amountDecimal: "0.0121",
  });
  assert.deepEqual(readSpotQuoteFee(fixture()), validate());
});
test("accepts and exact-checks the reverse destination-fee direct route", () => {
  const reverseMin = 39_390_512n;
  const q = fixture(NOW_MS, {
    sellToken: BUY_TOKEN,
    buyToken: SELL_TOKEN,
    sellAmount: SELL_AMOUNT,
    minBuyAmount: reverseMin,
    direction: 1n,
    nestedSellAmount: SELL_AMOUNT,
    nestedMinBuyAmount: reverseMin,
  });
  q.buyAmount = "39588455";
  q.minBuyAmount = reverseMin.toString();
  q.toSign.message.permitted.token = BUY_TOKEN;
  q.toSign.message.witness.buyToken = SELL_TOKEN;
  q.toSign.message.witness.minBuyAmount = reverseMin.toString();
  q.toSign.message.witness.srcBps = "0";
  q.toSign.message.witness.dstBps = "10";
  q.raw.platform_fee = {
    total_bps: 11,
    fees: [{
      side: "destination",
      token: SELL_TOKEN,
      symbol: "USDG",
      decimals: 6,
      bps: "11",
      bps_x100: 1100,
      amount: "43595",
      amount_decimal: "0.043595",
      recipient: SPOT_FEE_RECIPIENT_ADDRESS,
    }],
  };
  q.tx.data = replaceCalldataWord(q.tx.data, 0, addressWord(BUY_TOKEN));
  q.tx.data = replaceCalldataWord(q.tx.data, 1, addressWord(SELL_TOKEN));
  q.tx.data = replaceCalldataWord(q.tx.data, 3, word(reverseMin));
  q.tx.data = replaceCalldataWord(q.tx.data, 7, word(0));
  q.tx.data = replaceCalldataWord(q.tx.data, 8, word(10));

  assert.deepEqual(validateSpotExecutionIntent({
    quote: q, taker: TAKER, sellToken: BUY_TOKEN, buyToken: SELL_TOKEN, sellAmount: SELL_AMOUNT, nowMs: NOW_MS,
  }), {
    srcBps: 0, dstBps: 10, signedBps: 10, totalBps: 11, side: "destination",
    recipient: SPOT_FEE_RECIPIENT_ADDRESS, token: SELL_TOKEN.toLowerCase(),
    symbol: "USDG", decimals: 6, amount: "43595", amountDecimal: "0.043595",
  });

  const drift = structuredClone(q);
  drift.raw.platform_fee.fees[0].amount = "43594";
  drift.raw.platform_fee.fees[0].amount_decimal = "0.043594";
  assert.throws(() => validateSpotExecutionIntent({
    quote: drift, taker: TAKER, sellToken: BUY_TOKEN, buyToken: SELL_TOKEN, sellAmount: SELL_AMOUNT, nowMs: NOW_MS,
  }), /destination platform fee amount/i);
});

test("pins canonical metadata and direct routes for the audited execution scope", () => {
  const audited = [
    ["0x322F0929c4625eD5bAd873c95208D54E1c003b2d", "TSLA"],
    ["0xAf3D76f1834a1D425780943c99Ea8a608F8A93f9", "AAPL"],
    ["0x86923F96303D656E4aa86D9d42d1e57ad2023fdc", "AMD"],
  ];
  assert.deepEqual(readRialtoExecutionTokenMetadata(USDG_ADDRESS), { symbol: "USDG", decimals: 6 });
  for (const [token, symbol] of audited) {
    assert.deepEqual(readRialtoExecutionTokenMetadata(token), { symbol, decimals: 18 }, symbol);
    assert.ok(readRialtoDirectRoutePin(USDG_ADDRESS, token), symbol + " buy");
    assert.ok(readRialtoDirectRoutePin(token, USDG_ADDRESS), symbol + " sell");
  }
  const unknown = "0x1111111111111111111111111111111111111111";
  assert.equal(readRialtoExecutionTokenMetadata(unknown), null);
  assert.equal(readRialtoDirectRoutePin(USDG_ADDRESS, unknown), null);
  assert.equal(readRialtoDirectRoutePin(unknown, USDG_ADDRESS), null);
  assert.equal(readRialtoDirectRoutePin(BUY_TOKEN, unknown), null);
});

test("rejects forged platform-fee token metadata", () => {
  const decimals = fixture();
  decimals.raw.platform_fee.fees[0].decimals = 18;
  decimals.raw.platform_fee.fees[0].amount_decimal = "0.0000000000000121";
  assert.throws(() => validate(decimals), /canonical token metadata/i);
  assert.equal(readSpotQuoteFee(decimals), null);

  const symbol = fixture();
  symbol.raw.platform_fee.fees[0].symbol = "USDC";
  assert.throws(() => validate(symbol), /canonical token metadata/i);
  assert.equal(readSpotQuoteFee(symbol), null);
});

test("enforces the fresh RFQ minimum on either USDG leg before signing", () => {
  const minimumUnits = BigInt(SPOT_MIN_NOTIONAL_USDG) * 1_000_000n;

  const usdSell = fixture();
  usdSell.sellAmount = (minimumUnits - 1n).toString();
  assert.throws(() => validateSpotExecutionIntent({
    quote: usdSell,
    taker: TAKER,
    sellToken: SELL_TOKEN,
    buyToken: BUY_TOKEN,
    sellAmount: minimumUnits - 1n,
    nowMs: NOW_MS,
  }), /minimum order is 10 USDG/i);

  const usdReceive = fixture();
  usdReceive.buyAmount = (minimumUnits - 1n).toString();
  usdReceive.minBuyAmount = (minimumUnits - 2n).toString();
  assert.throws(() => validateSpotExecutionIntent({
    quote: usdReceive,
    taker: TAKER,
    sellToken: BUY_TOKEN,
    buyToken: SELL_TOKEN,
    sellAmount: SELL_AMOUNT,
    nowMs: NOW_MS,
  }), /minimum order is 10 USDG/i);
});

test("rejects fee-side semantics outside the audited USDG behavior", () => {
  const wrongBuy = fixture();
  wrongBuy.toSign.message.witness.srcBps = "0";
  wrongBuy.toSign.message.witness.dstBps = "10";
  assert.throws(() => validate(wrongBuy), /fee side.*audited USDG semantics/i);
  assert.equal(readSpotQuoteFee(wrongBuy), null);

  const wrongSell = fixture();
  wrongSell.toSign.message.permitted.token = BUY_TOKEN;
  wrongSell.toSign.message.witness.buyToken = SELL_TOKEN;
  assert.throws(() => validateSpotExecutionIntent({
    quote: wrongSell,
    taker: TAKER,
    sellToken: BUY_TOKEN,
    buyToken: SELL_TOKEN,
    sellAmount: SELL_AMOUNT,
    nowMs: NOW_MS,
  }), /fee side.*audited USDG semantics/i);
  assert.equal(readSpotQuoteFee(wrongSell), null);
});


test("rejects venue, router, value and calldata substitution", () => {
  const cases = [
    ["venue", (q) => { q.venue = "arcus"; }],
    ["router", (q) => { q.tx.to = "0x9999999999999999999999999999999999999999"; }],
    ["native value", (q) => { q.tx.value = "1"; }],
    ["malformed value", (q) => { q.tx.value = "wat"; }],
    ["non-hex calldata", (q) => { q.tx.data = `0xzz${SIG_PLACEHOLDER}`; }],
    ["missing signature slot", (q) => { q.tx.data = "0x1234"; }],
    ["duplicate signature slot", (q) => { q.tx.data += SIG_PLACEHOLDER; }],
    ["wrong selector", (q) => { q.tx.data = `0x12345678${q.tx.data.slice(10)}`; }],
    ["calldata sell token", (q) => { q.tx.data = q.tx.data.slice(0, 10) + addressWord(BUY_TOKEN) + q.tx.data.slice(74); }],
    ["action body", (q) => { q.tx.data = q.tx.data.replace(RIALTO_DIRECT_SWAP_SELECTOR.slice(2), "2303d44a"); }],
    ["trailing word", (q) => { q.tx.data += word(0); }],
  ];
  for (const [name, mutate] of cases) {
    const q = fixture();
    mutate(q);
    assert.throws(() => validate(q), undefined, name);
  }
});

test("rejects self-consistent actions outside the exact supported direct route", () => {
  const cases = [
    ["kind", { kind: 1n }],
    ["target", { target: TAKER }],
    ["sell token", { sellToken: BUY_TOKEN }],
    ["buy token", { buyToken: SELL_TOKEN }],
    ["sell amount", { sellAmount: SELL_AMOUNT }],
    ["scalar", { scalar: 1n }],
    ["minimum", { minBuyAmount: 1n }],
    ["selector", { selector: "0x2303d44a" }],
    ["direction", { direction: 1n }],
    ["nested amount", { nestedSellAmount: 1n }],
    ["nested minimum", { nestedMinBuyAmount: 1n }],
    ["nested recipient", { nestedRecipient: TAKER }],
    ["nested deadline", { nestedDeadline: BigInt(NOW_SECONDS + 91) }],
    ["final scalar", { finalScalar: 0n }],
  ];
  for (const [name, override] of cases) {
    assert.throws(() => validate(fixture(NOW_MS, override)), /action|route|token|amount|output|deadline|scalar|direction|recipient|payload/i, name);
  }
});

test("rejects unbound Permit2 domain and trade fields", () => {
  const cases = [
    ["chain missing", (q) => { delete q.toSign.domain.chainId; }],
    ["wrong chain", (q) => { q.toSign.domain.chainId = 1; }],
    ["verifier missing", (q) => { delete q.toSign.domain.verifyingContract; }],
    ["wrong verifier", (q) => { q.toSign.domain.verifyingContract = SELL_TOKEN; }],
    ["primary type", (q) => { q.toSign.primaryType = "PermitTransferFrom"; }],
    ["sell token missing", (q) => { delete q.toSign.message.permitted.token; }],
    ["wrong sell token", (q) => { q.toSign.message.permitted.token = BUY_TOKEN; }],
    ["amount missing", (q) => { delete q.toSign.message.permitted.amount; }],
    ["amount smaller", (q) => { q.toSign.message.permitted.amount = (SELL_AMOUNT - 1n).toString(); }],
    ["amount larger", (q) => { q.toSign.message.permitted.amount = (SELL_AMOUNT + 1n).toString(); }],
    ["spender missing", (q) => { delete q.toSign.message.spender; }],
    ["wrong spender", (q) => { q.toSign.message.spender = BUY_TOKEN; }],
    ["recipient missing", (q) => { delete q.toSign.message.witness.recipient; }],
    ["wrong recipient", (q) => { q.toSign.message.witness.recipient = BUY_TOKEN; }],
    ["buy token missing", (q) => { delete q.toSign.message.witness.buyToken; }],
    ["wrong buy token", (q) => { q.toSign.message.witness.buyToken = SELL_TOKEN; }],
    ["min output missing", (q) => { delete q.toSign.message.witness.minBuyAmount; }],
    ["wrong min output", (q) => { q.toSign.message.witness.minBuyAmount = "1"; }],
    ["quote sell amount", (q) => { q.sellAmount = (SELL_AMOUNT + 1n).toString(); }],
    ["quote id missing", (q) => { delete q.quoteId; }],
    ["quote id malformed", (q) => { q.quoteId = "not-a-rialto-quote-id"; }],
    ["witness quote id missing", (q) => { delete q.toSign.message.witness.quoteId; }],
    ["witness quote id malformed", (q) => { q.toSign.message.witness.quoteId = "0x1234"; }],
  ];
  for (const [name, mutate] of cases) {
    const q = fixture();
    mutate(q);
    assert.throws(() => validate(q), undefined, name);
  }
});

test("rejects malformed Permit2 type schemas and out-of-range nonces", () => {
  const cases = [
    ["missing types", (q) => { delete q.toSign.types; }],
    ["unexpected type", (q) => { q.toSign.types.Unused = []; }],
    ["domain field", (q) => { q.toSign.types.EIP712Domain.push({ name: "version", type: "string" }); }],
    ["TokenPermissions order", (q) => { q.toSign.types.TokenPermissions.reverse(); }],
    ["Permit2 shell field", (q) => { q.toSign.types.PermitWitnessTransferFrom[1].type = "bytes32"; }],
    ["missing witness field", (q) => { q.toSign.types.RialtoSwap.splice(4, 1); }],
    ["duplicate witness field", (q) => { q.toSign.types.RialtoSwap.push({ name: "actionsHash", type: "bytes32" }); }],
    ["witness address type", (q) => { q.toSign.types.RialtoSwap[0].type = "bytes32"; }],
    ["signed witness integer", (q) => { q.toSign.types.RialtoSwap[5].type = "int16"; }],
    ["witness bytes32 type", (q) => { q.toSign.types.RialtoSwap[9].type = "bytes"; }],
    ["missing nonce", (q) => { delete q.toSign.message.nonce; }],
    ["minimum width", (q) => { q.toSign.types.RialtoSwap[2].type = "uint128"; }],
    ["deadline width", (q) => { q.toSign.types.RialtoSwap[3].type = "uint256"; }],
    ["negative nonce", (q) => { q.toSign.message.nonce = "-1"; }],
    ["oversized nonce", (q) => { q.toSign.message.nonce = (1n << 256n).toString(); }],
  ];
  for (const [name, mutate] of cases) {
    const q = fixture();
    mutate(q);
    assert.throws(() => validate(q), /type|schema|nonce/i, name);
  }
});

test("rejects expired, mismatched and unreasonably long deadlines", () => {
  const expired = fixture();
  expired.toSign.message.deadline = String(NOW_SECONDS);
  expired.toSign.message.witness.deadline = String(NOW_SECONDS);
  assert.throws(() => validate(expired), /expired/i);

  const mismatched = fixture();
  mismatched.toSign.message.witness.deadline = String(NOW_SECONDS + 91);
  assert.throws(() => validate(mismatched), /deadline/i);

  const unbounded = fixture();
  unbounded.toSign.message.deadline = String(NOW_SECONDS + 3601);
  unbounded.toSign.message.witness.deadline = String(NOW_SECONDS + 3601);
  assert.throws(() => validate(unbounded), /deadline/i);
});

test("swap terminal binds the selected buy token into execution validation", () => {
  const source = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  assert.match(
    source,
    /prepareSpotSwap\(\s*eth, address, sellToken\.address, buyToken\.address, sellAmountRaw/,
  );
});

test("wallet signing and transaction submission require separate user actions", () => {
  const execution = readFileSync(new URL("./spot-exec.ts", import.meta.url), "utf8");
  const terminal = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");

  assert.match(execution, /export async function prepareSpotSwap\(/);
  assert.match(execution, /export async function submitPreparedSpotSwap\(/);
  assert.match(terminal, /const doSignSwap = useCallback/);
  assert.match(terminal, /const doSubmitSwap = useCallback/);
  assert.match(terminal, /if \(pendingSwap\) void doSubmitSwap\(\);/);
  assert.match(terminal, /else if \(needsApprove\) void doApprove\(\);/);
  assert.match(terminal, /else void doSignSwap\(\);/);
  assert.match(terminal, /executionContextRef\.current !== executionContextKey/);
  assert.match(terminal, /pendingSwap\.contextKey !== executionContextKey/);
  assert.doesNotMatch(terminal, /executeSpotSwap\(/);
});
test("preparation signs the RFQ without submitting an on-chain transaction", async (t) => {
  const methods = [];
  const signature = `0x${"77".repeat(65)}`;
  const txHash = `0x${"88".repeat(32)}`;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "eth_call") return { json: async () => ({ result: `0x${"ff".repeat(32)}` }) };
    if (body.method === "eth_getTransactionReceipt") return { json: async () => ({ result: { status: "0x1" } }) };
    throw new Error(`unexpected RPC method ${body.method}`);
  };
  const eth = {
    request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_signTypedData_v4") return signature;
      if (method === "eth_sendTransaction") return txHash;
      throw new Error(`unexpected wallet method ${method}`);
    },
  };

  const routePin = readRialtoDirectRoutePin(SELL_TOKEN, BUY_TOKEN);
  assert.ok(routePin);
  const runtimeTargets = [];
  const prepared = await prepareSpotSwap(
    eth, TAKER, SELL_TOKEN, BUY_TOKEN, SELL_AMOUNT, () => {}, async () => fixture(Date.now()), async (target) => {
      runtimeTargets.push(target.toLowerCase());
      if (target.toLowerCase() === SPOT_SETTLEMENT_ROUTER_ADDRESS.toLowerCase()) return RIALTO_ROUTER_RUNTIME_CODE_HASH;
      if (target.toLowerCase() === routePin.target) return routePin.runtimeCodeHash;
      throw new Error("unexpected runtime target");
    },
  );
  assert.deepEqual(runtimeTargets, [SPOT_SETTLEMENT_ROUTER_ADDRESS.toLowerCase(), routePin.target]);
  assert.deepEqual(methods, ["eth_chainId", "eth_accounts", "eth_signTypedData_v4"]);
  assert.match(prepared.data, new RegExp(signature.slice(2), "i"));
  assert.equal(prepared.feeBps, 11);
  assert.equal(prepared.feeSide, "source");

  let broadcast = null;
  await submitPreparedSpotSwap(eth, prepared, () => {}, (hash) => { broadcast = hash; });
  assert.deepEqual(methods, ["eth_chainId", "eth_accounts", "eth_signTypedData_v4", "eth_chainId", "eth_accounts", "eth_sendTransaction"]);
  assert.equal(broadcast, txHash);
  const beforeRuntimeDrift = methods.length;
  await assert.rejects(
    () => prepareSpotSwap(
      eth, TAKER, SELL_TOKEN, BUY_TOKEN, SELL_AMOUNT, () => {}, async () => fixture(Date.now()), async (target) =>
        target.toLowerCase() === SPOT_SETTLEMENT_ROUTER_ADDRESS.toLowerCase()
          ? RIALTO_ROUTER_RUNTIME_CODE_HASH
          : `0x${"00".repeat(32)}`,
    ),
    /action target runtime changed/i,
  );
  assert.deepEqual(methods.slice(beforeRuntimeDrift), ["eth_chainId", "eth_accounts"]);
});

test("unsupported direct routes fail before any wallet request", async () => {
  let calls = 0;
  const eth = { request: async () => { calls += 1; throw new Error("wallet must not be called"); } };
  await assert.rejects(
    () => prepareSpotSwap(
      eth, TAKER, USDG_ADDRESS, "0x1111111111111111111111111111111111111111",
      SELL_AMOUNT, () => {}, async () => fixture(Date.now()),
    ),
    /audited allowlist/i,
  );
  assert.equal(calls, 0);
});

test("an expired signed RFQ is rejected before the wallet is called", async () => {
  let calls = 0;
  const eth = { request: async () => { calls += 1; throw new Error("wallet must not be called"); } };
  const prepared = {
    from: TAKER,
    to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    data: "0x1234",
    quoteId: QUOTE_ID,
    sellAmount: SELL_AMOUNT.toString(),
    buyAmount: "1",
    minBuyAmount: "1",
    expiresAtMs: Date.now() + 5_000,
  };
  await assert.rejects(() => submitPreparedSpotSwap(eth, prepared, () => {}), SpotIntentExpiredError);
  assert.equal(calls, 0);
});
test("a network switch ends preparation before the signing prompt", async () => {
  const methods = [];
  const eth = {
    request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return "0x1";
      if (method === "wallet_switchEthereumChain") return null;
      throw new Error(`unexpected wallet method ${method}`);
    },
  };
  await assert.rejects(
    () => prepareSpotSwap(eth, TAKER, SELL_TOKEN, BUY_TOKEN, SELL_AMOUNT, () => {}, async () => {
      throw new Error("quote must not be requested after a network prompt");
    }),
    /press Swap again/i,
  );
  assert.deepEqual(methods, ["eth_chainId", "wallet_switchEthereumChain"]);
});

test("missing Permit2 allowance never chains an approval transaction into signing", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ json: async () => ({ result: "0x0" }) });
  const methods = [];
  const eth = {
    request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      throw new Error(`unexpected wallet method ${method}`);
    },
  };
  await assert.rejects(
    () => prepareSpotSwap(eth, TAKER, SELL_TOKEN, BUY_TOKEN, SELL_AMOUNT, () => {}, async () => fixture(Date.now())),
    SpotApprovalRequiredError,
  );
  assert.deepEqual(methods, ["eth_chainId", "eth_accounts"]);
});
test("approval stops after a network switch instead of chaining the approval prompt", async () => {
  const methods = [];
  const eth = {
    request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return "0x1";
      if (method === "wallet_switchEthereumChain") return null;
      throw new Error("unexpected wallet method " + method);
    },
  };
  await assert.rejects(
    () => approvePermit2(eth, TAKER, SELL_TOKEN, () => {}),
    /press Approve again/i,
  );
  assert.deepEqual(methods, ["eth_chainId", "wallet_switchEthereumChain"]);
});

test("submission stops after a network switch instead of chaining the transaction prompt", async () => {
  const methods = [];
  const eth = {
    request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return "0x1";
      if (method === "wallet_switchEthereumChain") return null;
      throw new Error("unexpected wallet method " + method);
    },
  };
  const prepared = {
    from: TAKER,
    to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    data: "0x1234",
    quoteId: QUOTE_ID,
    sellAmount: SELL_AMOUNT.toString(),
    buyAmount: "1",
    minBuyAmount: "1",
    expiresAtMs: Date.now() + 60_000,
  };
  await assert.rejects(
    () => submitPreparedSpotSwap(eth, prepared, () => {}),
    /press Confirm transaction again/i,
  );
  assert.deepEqual(methods, ["eth_chainId", "wallet_switchEthereumChain"]);
});

test("submission rejects an active-account change before sending", async () => {
  const methods = [];
  const eth = {
    request: async ({ method }) => {
      methods.push(method);
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [BUY_TOKEN];
      if (method === "eth_sendTransaction") throw new Error("transaction must not be requested");
      throw new Error("unexpected wallet method " + method);
    },
  };
  const prepared = {
    from: TAKER,
    to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    data: "0x1234",
    quoteId: QUOTE_ID,
    sellAmount: SELL_AMOUNT.toString(),
    buyAmount: "1",
    minBuyAmount: "1",
    expiresAtMs: Date.now() + 60_000,
  };
  await assert.rejects(
    () => submitPreparedSpotSwap(eth, prepared, () => {}),
    /active wallet account changed/i,
  );
  assert.deepEqual(methods, ["eth_chainId", "eth_accounts"]);
});

test("Permit2 allowance discovery is quote-independent and fails closed on RPC errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let allowance = 0n;
  globalThis.fetch = async () => ({ json: async () => ({ result: "0x" + allowance.toString(16) }) });

  assert.equal(await needsPermit2Approval(SELL_TOKEN, TAKER, SELL_AMOUNT), true, "zero");
  allowance = SELL_AMOUNT - 1n;
  assert.equal(await needsPermit2Approval(SELL_TOKEN, TAKER, SELL_AMOUNT), true, "partial");
  allowance = SELL_AMOUNT;
  assert.equal(await needsPermit2Approval(SELL_TOKEN, TAKER, SELL_AMOUNT), false, "exact");
  allowance = SELL_AMOUNT + 1n;
  assert.equal(await needsPermit2Approval(SELL_TOKEN, TAKER, SELL_AMOUNT), false, "excess");

  globalThis.fetch = async () => { throw new Error("RPC unavailable"); };
  assert.equal(await needsPermit2Approval(SELL_TOKEN, TAKER, SELL_AMOUNT), null, "unknown is not sufficient");
});

test("rejects unsupported or excessive signed settlement fees", () => {
  const cases = [
    ["non-empty quote fees", (q) => { q.fees = [{ amount: "1" }]; }],
    ["missing quote fees", (q) => { delete q.fees; }],
    ["excessive source bps", (q) => { q.toSign.message.witness.srcBps = "101"; }],
    ["excessive destination bps", (q) => { q.toSign.message.witness.dstBps = "101"; }],
    ["unsupported fee recipient", (q) => { q.toSign.message.witness.feeRecipient = SELL_TOKEN; }],
    ["missing platform fee", (q) => { delete q.raw.platform_fee; }],
    ["platform bps drift", (q) => { q.raw.platform_fee.total_bps = 15; }],
    ["platform amount drift", (q) => { q.raw.platform_fee.fees[0].amount = "1"; }],
    ["platform recipient drift", (q) => { q.raw.platform_fee.fees[0].recipient = BUY_TOKEN; }],
  ];
  for (const [name, mutate] of cases) {
    const q = fixture();
    mutate(q);
    assert.throws(() => validate(q), /fee|bps/i, name);
  }

  const zero = fixture();
  zero.toSign.message.witness.srcBps = "0";
  assert.throws(() => validate(zero), /fee|leg/i);
});

test("a prepared intent is one-shot after the wallet send request starts", async () => {
  for (const mode of ["rejected", "ambiguous", "malformed"]) {
    let sends = 0;
    const eth = {
      request: async ({ method }) => {
        if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
        if (method === "eth_accounts") return [TAKER];
        if (method === "eth_sendTransaction") {
          sends += 1;
          if (mode === "rejected") throw Object.assign(new Error("User rejected"), { code: 4001 });
          if (mode === "ambiguous") throw new Error("provider disconnected");
          return "not-a-transaction-hash";
        }
        throw new Error("unexpected wallet method " + method);
      },
    };
    const prepared = Object.freeze({
      from: TAKER,
      to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
      data: "0x1234",
      quoteId: QUOTE_ID,
      sellAmount: SELL_AMOUNT.toString(),
      buyAmount: "1",
      minBuyAmount: "1",
      expiresAtMs: Date.now() + 60_000,
    });

    await assert.rejects(() => submitPreparedSpotSwap(eth, prepared, () => {}));
    await assert.rejects(
      () => submitPreparedSpotSwap(eth, prepared, () => {}),
      /already used|consumed/i,
      mode,
    );
    assert.equal(sends, 1, mode);
  }
});

test("terminal exposes wallet actions only for the canonical audited direct route", () => {
  const source = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /!address \|\| !sellToken \|\| !quote \|\| need/);
  assert.match(source, /q\.venue\.toLowerCase\(\) === "rialto"/);
  assert.match(source, /readRialtoExecutionTokenMetadata/);
  assert.match(source, /sellToken\.symbol !== sellMetadata\.symbol \|\| sellToken\.decimals !== sellMetadata\.decimals/);
  assert.match(source, /const needsApprove = executionRouteSupported && approvalState === "required"/);
  assert.match(source, /!buyToken \|\| !executionRouteSupported \|\| need == null/);
  assert.match(source, /const canApprove =[\s\S]{0,120}executionRouteSupported/);
  assert.match(source, /const canSwap =[\s\S]{0,120}executionRouteSupported/);
  assert.match(source, /const canRetryApproval =[\s\S]{0,120}executionRouteSupported/);
  assert.match(source, /arcusCap\.ryntra === "live" && executionRouteSupported \? c\.routes\.executable : c\.routes\.unsupported/);
  assert.match(source, /!executionRouteSupported \? c\.executionUnsupportedCta[\s\S]{0,500}needsApprove \? c\.approveOneTime/);
  assert.match(source, /setQuoteRefreshKey\(\(n\) => n \+ 1\)/);

  for (const handler of ["const doApprove", "const doSignSwap"]) {
    const start = source.indexOf(handler);
    const end = source.indexOf(handler === "const doApprove" ? "const doSignSwap" : "const doSubmitSwap", start);
    const body = source.slice(start, end);
    const routeGuard = body.indexOf("hasAuditedRialtoExecution");
    const inFlightGuard = body.indexOf("if (walletActionInFlightRef.current) return;");
    assert.ok(routeGuard >= 0 && routeGuard < inFlightGuard, handler + " route guard runs before wallet ownership");
  }
});

test("confirmation reviews the exact signed RFQ and fail-closed compliance gates every wallet action", () => {
  const source = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  assert.match(source, /const reviewBuyAmount = pendingSwap[\s\S]{0,160}intent\.buyAmount/);
  assert.match(source, /data-testid="signed-intent-review"/);
  assert.match(source, /<span>{c\.networkGas}<\/span><b>{c\.networkGasWallet}<\/b>/);
  assert.match(source, /intent\.expiresAtMs/);
  assert.match(source, /isSpotComplianceReady/);
  assert.match(source, /const canApprove =[\s\S]{0,500}complianceReady/);
  assert.match(source, /const canSubmit =[\s\S]{0,250}complianceReady/);
});

test("terminal serializes wallet actions before React can re-render a disabled CTA", () => {
  const source = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  assert.match(source, /const walletActionInFlightRef = useRef\(false\)/);
  const starts = ["const doApprove", "const doSignSwap", "const doSubmitSwap"];
  for (let i = 0; i < starts.length; i += 1) {
    const from = source.indexOf(starts[i]);
    const to = i + 1 < starts.length ? source.indexOf(starts[i + 1]) : source.indexOf("/* Arcus compliance", from);
    const body = source.slice(from, to);
    const guard = body.indexOf("if (walletActionInFlightRef.current) return;");
    const acquire = body.indexOf("walletActionInFlightRef.current = true;");
    const tryAt = body.indexOf("try {");
    assert.ok(guard >= 0 && guard < tryAt, starts[i] + " guard owns no finally");
    assert.ok(acquire > guard && acquire < tryAt, starts[i] + " acquires before try");
    assert.match(body, /finally \{ walletActionInFlightRef\.current = false;/);
  }
});
test("message-only provider cancellation is ambiguous, not a proven user rejection", async () => {
  const eth = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_sendTransaction") throw new Error("request cancelled after provider disconnected");
      throw new Error("unexpected wallet method " + method);
    },
  };
  const prepared = Object.freeze({
    from: TAKER,
    to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    data: "0x1234",
    quoteId: QUOTE_ID,
    sellAmount: SELL_AMOUNT.toString(),
    buyAmount: "1",
    minBuyAmount: "1",
    expiresAtMs: Date.now() + 60_000,
  });
  await assert.rejects(
    () => submitPreparedSpotSwap(eth, prepared, () => {}),
    SpotSubmissionUnknownError,
  );
});

test("post-broadcast receipt timeout remains unknown and the signed intent stays consumed", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
  const base = 1_800_000_000_000;
  const ticks = [base, base, base + 100_000];
  Date.now = () => ticks.shift() ?? base + 100_000;
  globalThis.fetch = async () => ({ json: async () => ({ result: null }) });
  let sends = 0;
  const hash = `0x${"88".repeat(32)}`;
  const eth = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_sendTransaction") { sends += 1; return hash; }
      throw new Error("unexpected wallet method " + method);
    },
  };
  const prepared = Object.freeze({
    from: TAKER,
    to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    data: "0x1234",
    quoteId: QUOTE_ID,
    sellAmount: SELL_AMOUNT.toString(),
    buyAmount: "1",
    minBuyAmount: "1",
    expiresAtMs: base + 60_000,
  });
  await assert.rejects(() => submitPreparedSpotSwap(eth, prepared, () => {}), SpotSubmissionUnknownError);
  await assert.rejects(() => submitPreparedSpotSwap(eth, prepared, () => {}), /used|consumed/i);
  assert.equal(sends, 1);
});

test("malformed receipt status never becomes a successful swap", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const status of [undefined, "0x2"]) {
    globalThis.fetch = async () => ({ json: async () => ({ result: status == null ? {} : { status } }) });
    const eth = {
      request: async ({ method }) => {
        if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
        if (method === "eth_accounts") return [TAKER];
        if (method === "eth_sendTransaction") return `0x${"99".repeat(32)}`;
        throw new Error("unexpected wallet method " + method);
      },
    };
    const prepared = Object.freeze({
      from: TAKER,
      to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
      data: "0x1234",
      quoteId: QUOTE_ID,
      sellAmount: SELL_AMOUNT.toString(),
      buyAmount: "1",
      minBuyAmount: "1",
      expiresAtMs: Date.now() + 60_000,
    });
    await assert.rejects(() => submitPreparedSpotSwap(eth, prepared, () => {}), SpotSubmissionUnknownError);
  }
});

test("terminal blocks fresh money actions after unknown submission and exposes accessible recovery", () => {
  const source = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[submissionUncertain, setSubmissionUncertain\] = useState\(false\)/);
  assert.match(source, /SpotSubmissionUnknownError[\s\S]{0,180}setSubmissionUncertain\(true\)/);
  assert.match(source, /const canSwap =[\s\S]{0,350}!submissionUncertain/);
  assert.match(source, /data-testid="discard-signed-quote"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /aria-live="polite"/);
});
test("concurrent submit calls cannot cross the one-shot claim boundary", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ json: async () => ({ result: { status: "0x1" } }) });

  let releaseFirstChain;
  let chainCalls = 0;
  let sends = 0;
  const eth = {
    request: async ({ method }) => {
      if (method === "eth_chainId") {
        chainCalls += 1;
        if (chainCalls === 1) return new Promise((resolve) => { releaseFirstChain = resolve; });
        return SPOT_CHAIN_ID_HEX;
      }
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_sendTransaction") { sends += 1; return `0x${String(sends).padStart(64, "0")}`; }
      throw new Error("unexpected wallet method " + method);
    },
  };
  const prepared = Object.freeze({
    from: TAKER,
    to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    data: "0x1234",
    quoteId: QUOTE_ID,
    sellAmount: SELL_AMOUNT.toString(),
    buyAmount: "1",
    minBuyAmount: "1",
    expiresAtMs: Date.now() + 60_000,
  });

  const first = submitPreparedSpotSwap(eth, prepared, () => {});
  await Promise.resolve();
  await assert.rejects(() => submitPreparedSpotSwap(eth, prepared, () => {}), /used|progress|consumed/i);
  releaseFirstChain(SPOT_CHAIN_ID_HEX);
  await first;
  assert.equal(sends, 1);
});

test("approval distinguishes explicit rejection from post-request ambiguity", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  t.after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });

  const rejected = Object.assign(new Error("User rejected"), { code: 4001 });
  const rejectEth = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_sendTransaction") throw rejected;
      throw new Error("unexpected wallet method " + method);
    },
  };
  await assert.rejects(() => approvePermit2(rejectEth, TAKER, SELL_TOKEN, () => {}), (error) => error === rejected);

  const ambiguousEth = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_sendTransaction") throw new Error("provider disconnected");
      throw new Error("unexpected wallet method " + method);
    },
  };
  await assert.rejects(
    () => approvePermit2(ambiguousEth, TAKER, SELL_TOKEN, () => {}),
    SpotApprovalUnknownError,
  );

  const base = 1_800_000_000_000;
  const ticks = [base, base + 100_000];
  Date.now = () => ticks.shift() ?? base + 100_000;
  globalThis.fetch = async () => ({ json: async () => ({ result: null }) });
  const hashEth = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_sendTransaction") return `0x${"aa".repeat(32)}`;
      throw new Error("unexpected wallet method " + method);
    },
  };
  await assert.rejects(
    () => approvePermit2(hashEth, TAKER, SELL_TOKEN, () => {}),
    SpotApprovalUnknownError,
  );
});

test("wallet handlers recheck compliance at action time and ambiguity survives reload", () => {
  const source = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  assert.match(source, /const complianceGateRef = useRef/);
  for (const name of ["const doApprove", "const doSignSwap", "const doSubmitSwap"]) {
    const from = source.indexOf(name);
    const tryAt = source.indexOf("try {", from);
    const guard = source.indexOf("if (!complianceGateRef.current())", from);
    assert.ok(guard > from && guard < tryAt, name + " lacks action-time compliance guard");
  }
  assert.match(source, /localStorage\.setItem\(submissionAttemptKey/);
  assert.match(source, /localStorage\.getItem\(submissionAttemptKey/);
  assert.match(source, /saveSubmissionAttempt/);
  assert.match(source, /clearSubmissionAttempt/);
});

test("wallet money controls have explicit step and accessible names", () => {
  const terminal = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(terminal, /c\.signIntent\.replace\("\{asset\}"/);
  assert.match(terminal, /aria-label=\{[^}]*c\.youPay[^}]*sellSym/);
  assert.match(terminal, /aria-pressed=\{slippageBps === b\}/);
  assert.match(css, /\[data-theme="light"\][^{]*[\s\S]*?\.dm-warnline[^}]*var\(--warning-strong\)/);
});

test("a durable-lock write failure blocks every transaction wallet request", async () => {
  let sends = 0;
  const eth = {
    request: async ({ method }) => {
      if (method === "eth_chainId") return SPOT_CHAIN_ID_HEX;
      if (method === "eth_accounts") return [TAKER];
      if (method === "eth_sendTransaction") {
        sends += 1;
        return `0x${"77".repeat(32)}`;
      }
      throw new Error("unexpected wallet method " + method);
    },
  };
  const storageFailure = () => { throw new Error("durable safety lock unavailable"); };
  await assert.rejects(
    () => approvePermit2(eth, TAKER, SELL_TOKEN, () => {}, undefined, storageFailure),
    /durable safety lock unavailable/i,
  );

  const prepared = Object.freeze({
    from: TAKER,
    to: SPOT_SETTLEMENT_ROUTER_ADDRESS,
    data: "0x1234",
    quoteId: QUOTE_ID,
    sellAmount: SELL_AMOUNT.toString(),
    buyAmount: "1",
    minBuyAmount: "1",
    expiresAtMs: Date.now() + 60_000,
  });
  await assert.rejects(
    () => submitPreparedSpotSwap(eth, prepared, () => {}, undefined, storageFailure),
    /durable safety lock unavailable/i,
  );
  await assert.rejects(
    () => submitPreparedSpotSwap(eth, prepared, () => {}, undefined, storageFailure),
    /durable safety lock unavailable/i,
  );
  assert.equal(sends, 0);
});

test("terminal requires durable storage acknowledgement and renders current fee truth", () => {
  const terminal = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  const copy = readFileSync(new URL("../../app/app/copy.ts", import.meta.url), "utf8");

  assert.match(
    terminal,
    /return window\.localStorage\.getItem\(submissionAttemptKey\(addr\)\) === encoded/,
  );
  assert.match(
    terminal,
    /if \(!saveSubmissionAttempt\((?:address|owner), next\)\) throw new Error\(c\.recoveryStorageFailed\)/,
  );
  assert.doesNotMatch(terminal, /\b0 bps\b/);
  assert.doesNotMatch(copy, /Arcus spot fee:\s*0 bps|Комісія Arcus spot:\s*0 bps|Комиссия Arcus spot:\s*0 bps/i);
  assert.match(copy, /included; do not add/);
  assert.match(terminal, /quoteFee\?\.totalBps \?\? null/);
  assert.match(terminal, /quoteFee !== null/);
  assert.match(terminal, /pendingSwap\.intent\.feeAmountDecimal/);
  assert.match(terminal, /pendingSwap\.intent\.feeSignedBps/);
});

test("ambiguous recovery never retains a false success and stays accessible", () => {
  const terminal = readFileSync(new URL("../../app/robinhood/workspace/swap/swap-terminal.tsx", import.meta.url), "utf8");
  const copy = readFileSync(new URL("../../app/app/copy.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const submitStart = terminal.indexOf("const doSubmitSwap");
  const submitEnd = terminal.indexOf("/* Arcus compliance", submitStart);
  const submit = terminal.slice(submitStart, submitEnd);

  assert.match(submit, /catch \(e\) \{\s*setTxMsg\(null\);/);
  assert.doesNotMatch(terminal, /blockscout\.com\/address\/\$\{address\}/);
  assert.match(terminal, /submissionAttempt\?\.hash \? \(/);
  assert.match(terminal, /c\.recoveryWalletCheck/);
  assert.match(terminal, /c\.recoveryViewTransaction/);
  assert.match(copy, /Open your wallet extension and confirm there is no pending request/);
  assert.match(copy, /View transaction on Blockscout/);
  assert.match(terminal, /className="btn btn-ghost btn-sm tkt-recovery-action"/);
  assert.match(
    css,
    /\.dm-offguard \.tkt-recovery-action\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/,
  );
  assert.match(terminal, /ref=\{statusMessageRef\} tabIndex=\{-1\}/);
  assert.match(terminal, /requestAnimationFrame\(\(\) => statusMessageRef\.current\?\.focus\(\)\)/);
  assert.match(
    css,
    /\.tkt-signed-review \.tkt-row > b\s*\{[^}]*direction:\s*ltr[^}]*unicode-bidi:\s*isolate/,
  );
  assert.match(
    css,
    /* The light rules answer the core's Porcelain too (B1): one selector for both names. */
    /(?:\[data-theme="light"\]|:is\(\[data-theme="light"\], \[data-theme="porcelain"\]\)) \.cb-ok\s*\{[^}]*color:\s*var\(--success-strong\)/,
  );
});
