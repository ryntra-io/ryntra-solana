import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RELAY_CHAIN_IDS, RELAY_ORDER_CHAIN_NAMES } from "./chains.ts";
import { bridgeAddressOk, bridgeChainView, chainById, depositSenderOf, normalizeBridgeChain, orderNameOf, readBridgeChains } from "./bridge-chains.ts";
import { BRIDGE_SOLANA_PROGRAMS, BridgeQuoteSchema, signatureOfWire, bridgeFacts, bridgeQuoteFailureCode, buildBridgeQuoteBody, checkBridgeQuote, fetchBridgeQuote } from "./bridge-quote.ts";
import { bridgeTokenQuery, readBridgeTokens } from "./bridge-tokens.ts";

/* Relay's own answers, recorded 18.11: `/chains`, `/currencies/v2` for Base, and nine quotes — a native and
   an ERC-20 origin, three Solana origins (one swapped before the deposit), a swap on an EVM origin, Hyperliquid, and two
   deposit addresses (Bitcoin, Tron). */
const dir = new URL("./fixtures/bridge-2026-11-18/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const chains = readBridgeChains(read("chains.json"));
const QUOTES = read("quotes.json");
const chain = (name) => chains.find((entry) => entry.name === name);

const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOLW = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const REQUESTS = {
  "base-eth-to-sol": { origin: "base", destination: "solana", fromToken: "0x0000000000000000000000000000000000000000", toToken: "11111111111111111111111111111111", amountRaw: "10000000000000000", user: EVM, recipient: SOLW },
  "sol-usdc-to-arb-eth": { origin: "solana", destination: "arbitrum", fromToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", toToken: "0x0000000000000000000000000000000000000000", amountRaw: "20000000", user: SOLW, recipient: EVM },
  "sol-jup-to-base-usdc": { origin: "solana", destination: "base", fromToken: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountRaw: "50000000", user: SOLW, recipient: EVM },
  "arb-usdc-to-sol": { origin: "arbitrum", destination: "solana", fromToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", toToken: "11111111111111111111111111111111", amountRaw: "20000000", user: EVM, recipient: SOLW },
  "eth-pepe-to-sol": { origin: "ethereum", destination: "solana", fromToken: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", toToken: "11111111111111111111111111111111", amountRaw: "5000000000000000000000000", user: EVM, recipient: SOLW },
  "sol-bonk-to-base-eth": { origin: "solana", destination: "base", fromToken: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", toToken: "0x0000000000000000000000000000000000000000", amountRaw: "100000000000", user: SOLW, recipient: EVM },
  "hl-usdc-to-sol": { origin: "hyperliquid", destination: "solana", fromToken: "0x00000000000000000000000000000000", toToken: "11111111111111111111111111111111", amountRaw: "2000000000", user: EVM, recipient: SOLW },
  "btc-to-sol-deposit": { origin: "bitcoin", destination: "solana", fromToken: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8", toToken: "11111111111111111111111111111111", amountRaw: "100000", user: null, recipient: SOLW },
  "tron-usdt-to-sol-deposit": { origin: "tron", destination: "solana", fromToken: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "20000000", user: null, recipient: SOLW },
};

const requestOf = (name) => {
  const raw = REQUESTS[name];
  return { ...raw, origin: chain(raw.origin), destination: chain(raw.destination) };
};
const quoteOf = (name) => BridgeQuoteSchema.parse(structuredClone(QUOTES[name]));

test("every chain Relay carries is offered, Solana first, then the ones most reached for", () => {
  assert.ok(chains.length >= 50, `${chains.length} chains`);
  assert.deepEqual(
    chains.slice(0, 5).map((entry) => entry.name),
    ["solana", "base", "ethereum", "arbitrum", "bsc"],
  );
  for (const vm of ["evm", "svm", "bvm", "tvm", "tonvm", "xrpvm", "hypevm", "lvm"]) assert.ok(chains.some((entry) => entry.vm === vm), vm);
  // Past the popular ones, by name.
  const rest = chains.slice(13).map((entry) => entry.label);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, "en")));
});

test("each chain says which wallet signs on it, or that money leaves it through a deposit address", () => {
  assert.equal(chain("solana").wallet, "solana");
  assert.equal(chain("base").wallet, "evm");
  // Hyperliquid: money leaves through a deposit address (its SDK step reaches a host the page may not), lands in the EVM wallet.
  assert.equal(chain("hyperliquid").wallet, null);
  assert.equal(chain("hyperliquid").owner, "evm");
  assert.equal(bridgeChainView(chain("hyperliquid")).send, true);
  assert.equal(chain("bitcoin").wallet, null);
  assert.equal(chain("bitcoin").depositAddress, true);
  assert.equal(bridgeChainView(chain("bitcoin")).send, true);
  // Eclipse: a Solana-shaped chain no wallet here signs on, and Relay opens no deposit address there.
  assert.equal(chain("eclipse").wallet, null);
  assert.equal(bridgeChainView(chain("eclipse")).send, false);
  // A browser is never told an RPC, a contract list or a logo host.
  const view = bridgeChainView(chain("base"));
  assert.equal("rpc" in view, false);
  assert.equal("contracts" in view, false);
  assert.equal(typeof view.native.logo, "boolean");
  // A chain's own coin has a logo of its own on Relay's asset host, not the chain's mark.
  assert.equal(chain("base").native.logo, "https://assets.relay.link/icons/currencies/eth.png");
  assert.equal(chain("solana").native.symbol, "SOL");
  // Relay's own EVM contracts, from the index: the depository and the approval proxy among them.
  assert.ok(chain("base").contracts.includes("0x5567954cd026cebfe486062cb75848e0f1c12e58"));
  assert.equal(chain("base").depository, "0x4cd00e387622c35bddb9b4c962c136462338bc31");
});

test("a chain Relay has closed, whose deposits are off or whose blocks lag is not offered", () => {
  const base = read("chains.json").chains.find((entry) => entry.name === "base");
  assert.ok(normalizeBridgeChain(base));
  assert.equal(normalizeBridgeChain({ ...base, disabled: true }), null);
  assert.equal(normalizeBridgeChain({ ...base, depositEnabled: false }), null);
  assert.equal(normalizeBridgeChain({ ...base, blockProductionLagging: true }), null);
  assert.equal(normalizeBridgeChain({ ...base, vmType: "movevm" }), null);
});

test("the order's chain words read by hand agree with Relay's index, and the index names the rest", () => {
  for (const [network, word] of Object.entries(RELAY_ORDER_CHAIN_NAMES)) {
    const entry = chainById(chains, RELAY_CHAIN_IDS[network]);
    assert.ok(entry, network);
    assert.equal(entry.order, word, network);
    assert.equal(orderNameOf(entry), word, network);
  }
  assert.equal(orderNameOf(chain("bitcoin")), "bitcoin");
  assert.equal(orderNameOf(chain("hyperliquid")), "hyperliquid");
  assert.equal(orderNameOf({ id: 1, order: "mainnet" }), "ethereum", "a hand word wins over the index");
});

test("every recorded quote is read back and accepted: recipient, sender, coins, amount, refunds and steps", () => {
  for (const name of Object.keys(REQUESTS).filter((entry) => entry !== "hl-usdc-to-sol")) {
    assert.deepEqual(checkBridgeQuote(quoteOf(name), requestOf(name)), { ok: true }, name);
  }
  // A quote asking the wallet for a signature (Hyperliquid's authorisation) is not offered: a permit could name any spender.
  assert.deepEqual(checkBridgeQuote(quoteOf("hl-usdc-to-sol"), requestOf("hl-usdc-to-sol")), { ok: false, code: "QUOTE_MISMATCH", field: "steps" });
});

test("a quote paying someone else, or refunding to a stranger, is refused", () => {
  const quote = quoteOf("base-eth-to-sol");
  quote.details.recipient = "CbKGgVKLJFb8bBrf58DnAkdryX6ubewVytn7X957YwNr";
  assert.deepEqual(checkBridgeQuote(quote, requestOf("base-eth-to-sol")), { ok: false, code: "QUOTE_MISMATCH", field: "recipient" });

  const refund = quoteOf("arb-usdc-to-sol");
  refund.protocol.v2.orderData.inputs[0].refunds[0].recipient = "0x1111111111111111111111111111111111111111";
  assert.equal(checkBridgeQuote(refund, requestOf("arb-usdc-to-sol")).field, "refund");

  const elsewhere = quoteOf("sol-usdc-to-arb-eth");
  elsewhere.protocol.v2.orderData.inputs[0].refunds[1].chainId = "polygon";
  assert.equal(checkBridgeQuote(elsewhere, requestOf("sol-usdc-to-arb-eth")).field, "refund");

  // A deposit address has no sender: a refund on the origin would go to the burn address.
  const deposit = quoteOf("btc-to-sol-deposit");
  deposit.protocol.v2.orderData.inputs[0].refunds.push({ chainId: "bitcoin", recipient: depositSenderOf(chain("bitcoin")) });
  assert.equal(checkBridgeQuote(deposit, requestOf("btc-to-sol-deposit")).field, "refund");
});

test("a quote spending another coin, more than typed, or delivering another coin is refused", () => {
  const coin = quoteOf("arb-usdc-to-sol");
  coin.details.currencyIn.currency.address = "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8";
  assert.equal(checkBridgeQuote(coin, requestOf("arb-usdc-to-sol")).field, "currencyIn");
  const more = quoteOf("arb-usdc-to-sol");
  more.details.currencyIn.amount = "20000001";
  assert.equal(checkBridgeQuote(more, requestOf("arb-usdc-to-sol")).field, "amount");
  const other = quoteOf("base-eth-to-sol");
  other.details.currencyOut.currency.address = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  assert.equal(checkBridgeQuote(other, requestOf("base-eth-to-sol")).field, "currencyOut");
});

test("a wallet is asked to sign only Relay's own calls", () => {
  const target = quoteOf("base-eth-to-sol");
  target.steps[0].items[0].data.to = "0x1111111111111111111111111111111111111111";
  assert.equal(checkBridgeQuote(target, requestOf("base-eth-to-sol")).field, "steps");

  // An approval of the coin being spent to someone other than Relay.
  const approval = quoteOf("eth-pepe-to-sol");
  const step = approval.steps.find((entry) => entry.id === "approve");
  step.items[0].data.data = step.items[0].data.data.replace("5567954cd026cebfe486062cb75848e0f1c12e58", "1111111111111111111111111111111111111111");
  assert.equal(checkBridgeQuote(approval, requestOf("eth-pepe-to-sol")).field, "steps");

  // A call on another chain.
  const chainSwap = quoteOf("arb-usdc-to-sol");
  chainSwap.steps[1].items[0].data.chainId = 1;
  assert.equal(checkBridgeQuote(chainSwap, requestOf("arb-usdc-to-sol")).field, "steps");

  // A Solana plan reaching for a program Relay's plans were not read using.
  const program = quoteOf("sol-jup-to-base-usdc");
  program.steps[0].items[0].data.instructions[1].programId = "BPFLoaderUpgradeab1e11111111111111111111111";
  assert.equal(checkBridgeQuote(program, requestOf("sol-jup-to-base-usdc")).field, "steps");
  assert.ok(BRIDGE_SOLANA_PROGRAMS.includes("99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2"));

  // A plan with no Relay program in it, or a plain transfer at its top, is not Relay's plan.
  const noRelay = quoteOf("sol-usdc-to-arb-eth");
  noRelay.steps[0].items[0].data.instructions = [{ ...noRelay.steps[0].items[0].data.instructions[0], programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" }];
  assert.equal(checkBridgeQuote(noRelay, requestOf("sol-usdc-to-arb-eth")).field, "steps");
  const transfer = quoteOf("sol-usdc-to-arb-eth");
  transfer.steps[0].items[0].data.instructions.push({ programId: "11111111111111111111111111111111", keys: [], data: "02000000" });
  assert.equal(checkBridgeQuote(transfer, requestOf("sol-usdc-to-arb-eth")).field, "steps");
});

test("only Relay's entry contracts: never the multicall contracts, never more value or allowance than typed", () => {
  const base = chain("base");
  assert.ok(!base.contracts.includes("0xca11bde05977b3631167028862be2a173976ca11"), "Multicall3 is anyone's");
  assert.ok(!base.contracts.includes("0x0000000000002bdbf1bf3279983603ec279cc6df"), "nor Relay's multicaller");
  assert.ok(base.contracts.includes("0x5567954cd026cebfe486062cb75848e0f1c12e58") && base.contracts.includes("0xccc88a9d1b4ed6b0eaba998850414b24f1c315be"), "approval proxies, every version");
  assert.deepEqual([...base.spenders].sort(), ["0x4cd00e387622c35bddb9b4c962c136462338bc31", "0x5567954cd026cebfe486062cb75848e0f1c12e58", "0xccc88a9d1b4ed6b0eaba998850414b24f1c315be"].sort());

  const multicall = quoteOf("base-eth-to-sol");
  multicall.steps[0].items[0].data.to = "0xca11bde05977b3631167028862be2a173976ca11";
  assert.equal(checkBridgeQuote(multicall, requestOf("base-eth-to-sol")).field, "steps");
  const more = quoteOf("base-eth-to-sol");
  more.steps[0].items[0].data.value = "10000000000000001";
  assert.equal(checkBridgeQuote(more, requestOf("base-eth-to-sol")).field, "steps", "no more ETH than typed");
  const valued = quoteOf("arb-usdc-to-sol");
  valued.steps[1].items[0].data.value = "1";
  assert.equal(checkBridgeQuote(valued, requestOf("arb-usdc-to-sol")).field, "steps", "no ETH with a USDC deposit");

  const unlimited = quoteOf("eth-pepe-to-sol");
  const approve = unlimited.steps.find((entry) => entry.id === "approve").items[0].data;
  approve.data = approve.data.slice(0, 74) + "f".repeat(64);
  assert.equal(checkBridgeQuote(unlimited, requestOf("eth-pepe-to-sol")).field, "steps", "an unlimited approval");
  const toMulticall = quoteOf("arb-usdc-to-sol");
  const approval = toMulticall.steps.find((entry) => entry.id === "approve").items[0].data;
  approval.data = approval.data.replace("4cd00e387622c35bddb9b4c962c136462338bc31", "ca11bde05977b3631167028862be2a173976ca11");
  assert.equal(checkBridgeQuote(toMulticall, requestOf("arb-usdc-to-sol")).field, "steps", "an approval to anyone's contract");

  // The limits hold over all the calls together, not each alone.
  const twice = quoteOf("base-eth-to-sol");
  twice.steps.push(structuredClone(twice.steps[0]));
  assert.equal(checkBridgeQuote(twice, requestOf("base-eth-to-sol")).field, "steps", "two deposits of the whole amount");
  const twoApprovals = quoteOf("arb-usdc-to-sol");
  const second = structuredClone(twoApprovals.steps.find((entry) => entry.id === "approve"));
  second.items[0].data.data = second.items[0].data.data.replace("4cd00e387622c35bddb9b4c962c136462338bc31", "5567954cd026cebfe486062cb75848e0f1c12e58");
  twoApprovals.steps.unshift(second);
  assert.equal(checkBridgeQuote(twoApprovals, requestOf("arb-usdc-to-sol")).field, "steps", "two approvals of the whole amount");

  const signature = quoteOf("base-eth-to-sol");
  signature.steps.unshift({ id: "authorize", kind: "signature", items: [{ status: "incomplete", data: { sign: { signatureKind: "eip712" }, post: { endpoint: "/execute/permits" } } }] });
  assert.equal(checkBridgeQuote(signature, requestOf("base-eth-to-sol")).field, "steps", "a permit to sign");
  // A preview is never executed: its steps are not read, everything else is.
  assert.deepEqual(checkBridgeQuote(signature, requestOf("base-eth-to-sol"), { preview: true }), { ok: true });
  const previewElsewhere = quoteOf("base-eth-to-sol");
  previewElsewhere.details.recipient = "CbKGgVKLJFb8bBrf58DnAkdryX6ubewVytn7X957YwNr";
  assert.equal(checkBridgeQuote(previewElsewhere, requestOf("base-eth-to-sol"), { preview: true }).field, "recipient");
});

test("a deposit address names its refund on the receiving side, or it is not offered", () => {
  const silent = quoteOf("btc-to-sol-deposit");
  delete silent.protocol;
  assert.equal(checkBridgeQuote(silent, requestOf("btc-to-sol-deposit")).field, "refund");
  // XRP and TON: Relay's index says deposit addresses, Relay refuses one when asked (18.11) — money does not leave them here.
  assert.equal(chain("xrp").depositAddress, false);
  assert.equal(chain("ton").depositAddress, false);
  assert.equal(bridgeChainView(chain("ton")).send, false);
});

test("a swap on one network to an address typed: the refund to the sender is the person's own", () => {
  const same = { origin: chain("base"), destination: chain("base"), fromToken: "0x0000000000000000000000000000000000000000", toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amountRaw: "1000", user: EVM, recipient: "0x2222222222222222222222222222222222222222" };
  const quote = quoteOf("base-eth-to-sol");
  quote.details.recipient = same.recipient;
  quote.details.currencyOut.currency = { ...quote.details.currencyOut.currency, chainId: 8453, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
  quote.details.currencyIn.amount = "1000";
  quote.steps[0].items[0].data.value = "1000";
  quote.protocol.v2.orderData.inputs[0].refunds = [{ chainId: "base", recipient: EVM }, { chainId: "base", recipient: same.recipient }];
  assert.deepEqual(checkBridgeQuote(quote, same), { ok: true });
});

test("the question Relay is asked: the engine's slippage and fee, a burn-address sender for a deposit, a referrer only with the key", () => {
  const wallet = buildBridgeQuoteBody({ ...requestOf("base-eth-to-sol"), appFee: { recipient: "0x1234567890123456789012345678901234567890", bps: 25 } });
  assert.equal(wallet.originChainId, 8453);
  assert.equal(wallet.destinationChainId, 792703809);
  assert.equal(wallet.slippageTolerance, "50");
  assert.equal(wallet.tradeType, "EXACT_INPUT");
  assert.deepEqual(wallet.appFees, [{ recipient: "0x1234567890123456789012345678901234567890", fee: "25" }]);
  assert.equal("referrer" in wallet, false);
  assert.equal("useDepositAddress" in wallet, false);
  assert.equal(buildBridgeQuoteBody(requestOf("base-eth-to-sol"), true).referrer, "ryntra");
  assert.equal("appFees" in buildBridgeQuoteBody({ ...requestOf("base-eth-to-sol"), appFee: { recipient: "not-an-address", bps: 25 } }), false);

  const deposit = buildBridgeQuoteBody(requestOf("btc-to-sol-deposit"));
  assert.equal(deposit.useDepositAddress, true);
  assert.equal(deposit.user, "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo");
});

test("what the page shows: amounts, time, the way's cost and a deposit address", () => {
  const facts = bridgeFacts(quoteOf("arb-usdc-to-sol"), false);
  assert.equal(facts.mode, "wallet");
  assert.equal(facts.send.symbol, "USDC");
  assert.equal(facts.get.symbol, "SOL");
  assert.equal(facts.get.decimals, 9);
  assert.equal(facts.prompts, 2, "an approval and the deposit");
  assert.equal(facts.depositAddress, null);
  assert.ok(facts.requestId?.startsWith("0x"));

  const deposit = bridgeFacts(quoteOf("btc-to-sol-deposit"), true);
  assert.equal(deposit.mode, "deposit");
  assert.equal(deposit.depositAddress, "bc1q6nypmcagk0pyehg4kdtmjv0kts0ur7wmwtllz4");
  assert.equal(deposit.send.amountRaw, "100000");
  assert.equal(deposit.prompts, 0);
});

test("Relay's refusals are sorted into what a person can be told", () => {
  assert.equal(bridgeQuoteFailureCode(400, "AMOUNT_TOO_LOW"), "AMOUNT_TOO_SMALL");
  assert.equal(bridgeQuoteFailureCode(400, "NO_SWAP_ROUTES_FOUND"), "NO_ROUTE");
  assert.equal(bridgeQuoteFailureCode(400, "INSUFFICIENT_LIQUIDITY"), "AMOUNT_TOO_LARGE");
  assert.equal(bridgeQuoteFailureCode(429, null), "RATE_LIMITED");
  assert.equal(bridgeQuoteFailureCode(500, null), "HTTP_ERROR");
});

test("the quote is fetched with the key in the header and read through the schema", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(QUOTES["base-eth-to-sol"]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await fetchBridgeQuote(requestOf("base-eth-to-sol"), { apiKey: "k", fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(seen[0].url, "https://api.relay.link/quote");
  assert.equal(seen[0].init.headers["x-api-key"], "k");
  assert.equal(JSON.parse(seen[0].init.body).referrer, "ryntra");

  const refused = await fetchBridgeQuote(requestOf("base-eth-to-sol"), {
    fetchImpl: async () => new Response(JSON.stringify({ errorCode: "AMOUNT_TOO_LOW", message: "Amount too low" }), { status: 400 }),
  });
  assert.deepEqual(refused, { ok: false, code: "AMOUNT_TOO_SMALL", status: 400, provider: { code: "AMOUNT_TOO_LOW", message: "Amount too low" } });
});

test("addresses are checked by the shape of their machine", () => {
  assert.equal(bridgeAddressOk("evm", EVM), true);
  assert.equal(bridgeAddressOk("evm", "0x123"), false);
  assert.equal(bridgeAddressOk("svm", SOLW), true);
  assert.equal(bridgeAddressOk("svm", EVM), false);
  assert.equal(bridgeAddressOk("bvm", "bc1q6nypmcagk0pyehg4kdtmjv0kts0ur7wmwtllz4"), true);
  assert.equal(bridgeAddressOk("bvm", "34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo"), true);
  assert.equal(bridgeAddressOk("bvm", SOLW), false);
  assert.equal(bridgeAddressOk("tvm", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"), true);
  assert.equal(bridgeAddressOk("tonvm", "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADerZ0z"), true);
  assert.equal(bridgeAddressOk("xrpvm", "rrrrrrrrrrrrrrrrrrrrBZbvji"), true);
  assert.equal(bridgeAddressOk("lvm", "462196"), true);
  assert.equal(bridgeAddressOk("hypevm", EVM), true);
});

test("a chain's coins: Relay's default list with an empty term, a search with one", () => {
  assert.deepEqual(bridgeTokenQuery({ chainId: 8453 }), { chainIds: [8453], defaultList: true, limit: 30 });
  assert.deepEqual(bridgeTokenQuery({ chainId: 8453, term: " pepe ", limit: 500 }), { chainIds: [8453], term: "pepe", limit: 50, useExternalSearch: true });
  const tokens = readBridgeTokens(read("currencies-base.json"), 8453);
  assert.ok(tokens.length > 0);
  assert.equal(tokens[0].symbol, "USDC");
  assert.equal(tokens[0].verified, true);
  assert.ok(tokens[0].logo?.startsWith("https://"));
  assert.equal(readBridgeTokens(read("currencies-base.json"), 1).length, 0, "a row of another chain is dropped");
});

test("a signed Solana transaction's id is read from its bytes alone", () => {
  // One signature of 64 bytes (1 … 64), then the message: the id is that signature in base58.
  const bytes = new Uint8Array(1 + 64 + 3);
  bytes[0] = 1;
  for (let index = 0; index < 64; index += 1) bytes[1 + index] = index + 1;
  const wire = Buffer.from(bytes).toString("base64");
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x" + Buffer.from(bytes.slice(1, 65)).toString("hex"));
  let expected = "";
  while (value > 0n) {
    expected = ALPHABET[Number(value % 58n)] + expected;
    value /= 58n;
  }
  assert.equal(signatureOfWire(wire), expected);
  assert.equal(signatureOfWire(Buffer.from(new Uint8Array(70)).toString("base64")), null, "no signature at all");
  assert.equal(signatureOfWire("not base64 !"), null);
});
