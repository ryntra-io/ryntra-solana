import { test } from "node:test";
import assert from "node:assert/strict";

import { assetsOf } from "./assets.ts";
import { feeShort } from "./deposit.ts";
import { EMPTY_SEND } from "./form.ts";
import { closeMoney, useMoney } from "./open.ts";
import { environmentOf } from "./send.ts";
import { setMoneyEnv, useMoneyStore } from "./store.ts";
import { bundle, EVM, FRIEND, memoryStorage, no, ok, OWNER, scriptedFetch, USDC } from "./test-fixtures.mjs";

// The store's money paths, with a scripted engine and no wallet. Each test sets the window's world as it needs it.

const DEPOSIT = "/api/swap/deposit-address";
const PLAN = "/api/solana/transfer/plan";

const wallet = {
  owner: OWNER,
  assets: assetsOf([
    { kind: "NATIVE_SOL", mint: null, amountRaw: "2400000000", spendableRaw: "2390000000", decimals: 9, catalog: { usdPrice: "150" } },
    { kind: "TOKEN", mint: USDC, amountRaw: "12500000", spendableRaw: "12500000", decimals: 6, catalog: { symbol: "USDC", isVerified: true, usdPrice: "1" } },
  ]),
  complete: true,
  at: 0,
};

const EMPTY_DEPOSIT = { network: null, address: null, status: "idle", progress: null, since: 0 };

function world({ open, fetch }) {
  setMoneyEnv({ open, fetch, storage: () => memoryStorage(), now: () => Date.parse("2026-10-28T12:00:00Z"), refreshCity: () => {}, connection: () => ({ wallet: "Stub", address: OWNER }) });
  useMoneyStore.setState({ owner: OWNER, wallet, walletRead: "ready", deposit: EMPTY_DEPOSIT });
}

test("with the money switch closed, an address on another network is never asked for", async () => {
  const engine = scriptedFetch({});
  world({ open: false, fetch: engine.fetch });
  await useMoneyStore.getState().pickDeposit("base");
  assert.equal(engine.calls.length, 0);
  assert.deepEqual(useMoneyStore.getState().deposit, EMPTY_DEPOSIT);
  // Not even a deposit already on screen is followed.
  useMoneyStore.setState({ deposit: { ...EMPTY_DEPOSIT, network: "base", address: { network: "base", address: EVM, recipient: OWNER, feeUsd: 0.03, seconds: 20 } } });
  await useMoneyStore.getState().readDepositProgress();
  assert.equal(engine.calls.length, 0);
});

test("with the switch open, the engine gives the address and it is shown for this wallet", async () => {
  const engine = scriptedFetch({ [DEPOSIT]: [ok({ data: { network: "base", address: EVM, recipient: OWNER, feeUsd: 0.03, seconds: 20 } })] });
  world({ open: true, fetch: engine.fetch });
  await useMoneyStore.getState().pickDeposit("base");
  assert.deepEqual(engine.asked(DEPOSIT)[0].body, { network: "base", recipient: OWNER });
  assert.equal(useMoneyStore.getState().deposit.address?.address, EVM);
  assert.equal(feeShort(0.03), "fee ≈ $0.03");
  assert.equal(feeShort(null), null);
});

test("typing on Bridge while a price is asked for is kept, and the stale price is dropped", () => {
  world({ open: true, fetch: scriptedFetch({}).fetch });
  const before = useMoneyStore.getState().bridge;
  useMoneyStore.setState({ bridge: { ...before, to: EVM, amount: "1", phase: "quoting" } });
  useMoneyStore.getState().setBridgeAmount("12");
  useMoneyStore.getState().setBridgeTo("");
  const bridge = useMoneyStore.getState().bridge;
  assert.deepEqual([bridge.amount, bridge.to, bridge.phase, bridge.quote], ["12", "", "idle", null]);
  // Once a transfer is being built, the form holds still.
  useMoneyStore.setState({ bridge: { ...bridge, phase: "planning" } });
  useMoneyStore.getState().setBridgeAmount("99");
  assert.equal(useMoneyStore.getState().bridge.amount, "12");
  useMoneyStore.setState({ bridge: { ...before } });
});

test("from the tap that confirms a transfer, the window stays until the engine answers", async () => {
  let answer;
  const pending = new Promise((resolve) => (answer = resolve));
  const fetch = async (url) => {
    assert.equal(url, PLAN);
    return pending;
  };
  world({ open: true, fetch });
  const review = { bundle: bundle(), authorized: environmentOf(bundle(), "USDC") };
  useMoneyStore.setState({ send: { ...EMPTY_SEND, assetId: USDC, to: FRIEND, amount: "2.5", recents: [FRIEND], recentsRead: true, review } });
  useMoney.setState({ open: true, tab: "send", busy: false });

  const confirming = useMoneyStore.getState().confirmSend();
  assert.equal(useMoneyStore.getState().send.phase, "preparing");
  assert.equal(useMoney.getState().busy, true);
  closeMoney();
  assert.equal(useMoney.getState().open, true, "the window does not close while the wallet is about to open");

  const refused = no(503, "PLAN_UNAVAILABLE");
  answer({ ok: false, status: refused.status, json: async () => refused.body });
  await confirming;
  assert.equal(useMoneyStore.getState().send.phase, "idle");
  assert.equal(useMoney.getState().busy, false);
  closeMoney();
  assert.equal(useMoney.getState().open, false);
});

test("«To» is checked by the engine and read by the security source, and the risk is for that address only", async () => {
  const RECIPIENT = "/api/v1/money/recipient";
  const EVIDENCE = "/api/v1/research/address-evidence";
  const engine = scriptedFetch({
    [RECIPIENT]: [ok({ input: "address", next: "transfer", problem: null, address: FRIEND, destination: { opensAccount: false }, asked: null, link: null })],
    [EVIDENCE]: [ok({ state: "FRESH", served: "provider", reason: null, evidence: { sanctions: { state: "sanctioned", related: false }, findings: { state: "answered", high: 0, medium: 0 } } })],
  });
  world({ open: true, fetch: engine.fetch });
  useMoneyStore.setState({ send: { ...EMPTY_SEND, assetId: USDC } });
  useMoneyStore.getState().setTo(FRIEND);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(engine.asked(EVIDENCE)[0].url, `${EVIDENCE}?address=${FRIEND}`);
  assert.equal(engine.asked(EVIDENCE)[0].headers["X-Ryntra-API"], "1");
  assert.deepEqual(useMoneyStore.getState().send.risk, { address: FRIEND, summary: "sanctioned" });
  assert.equal(useMoneyStore.getState().send.check?.status, "done");
  // Another «To» drops the word about the last one at once.
  useMoneyStore.getState().setTo("");
  assert.equal(useMoneyStore.getState().send.risk, null);
});

test("with the switch closed, Send and Bridge ask the engine nothing", async () => {
  const engine = scriptedFetch({});
  world({ open: false, fetch: engine.fetch });
  const review = { bundle: bundle(), authorized: environmentOf(bundle(), "USDC") };
  useMoneyStore.setState({ send: { ...EMPTY_SEND, assetId: USDC, to: FRIEND, amount: "2.5", recents: [FRIEND], recentsRead: true, review } });
  await useMoneyStore.getState().reviewSend();
  await useMoneyStore.getState().confirmSend();
  await useMoneyStore.getState().quoteBridge();
  await useMoneyStore.getState().reviewBridge();
  await useMoneyStore.getState().confirmBridge();
  await useMoneyStore.getState().followOrder();
  assert.equal(engine.calls.length, 0);
});
