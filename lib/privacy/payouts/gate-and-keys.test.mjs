import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PrivateError } from "../flows.ts";
import { buildWalletPayment, readInbound, dropBook, paidIn } from "../invoices/chain.client.ts";
import { RING_SOL } from "../network.ts";
import { dropKeys, holdKeys } from "../vault.client.ts";
import { payOpen, transfer } from "./run.ts";

/* A payout and a private invoice reach money only through the rules before money, and read the keys the wallet gave. */

const ME = "Me11111111111111111111111111111111111111111";
const FRIEND = "Fr11111111111111111111111111111111111111111";
const BAD = "Bad1111111111111111111111111111111111111111";

const answer = (marks, more = {}) => ({ paused: false, cap: null, marks, ...more });

/** A gate that answers from a table and remembers what it was asked and what it counted. */
function gateOf(reply) {
  const asked = [];
  const counted = [];
  return { asked, counted, ask: async (addresses) => (asked.push(addresses), reply(addresses)), landed: (move, lamports) => counted.push([move, lamports]) };
}

/** An SDK that fails the test if anything is built. */
const noBuild = new Proxy({}, { get: (_, name) => (name === "SOL_MINT" ? RING_SOL : () => assert.fail(`nothing may be built: ${String(name)}`)) });

const stepOf = (gate, sdk = noBuild) => ({ ctx: { sdk, client: {}, gate }, book: { wallet: {}, keys: {}, owner: ME }, wallet: { address: ME }, mint: RING_SOL, on: () => undefined });

test("a payout's transfer asks the rules for every recipient, and a flagged one stops it before anything is built", async () => {
  const gate = gateOf((addresses) => answer(Object.fromEntries(addresses.map((a) => [a, a === BAD ? "flagged" : "clear"]))));
  const batch = { payments: [{ id: "1", to: FRIEND, units: 5n }, { id: "2", to: BAD, units: 7n }], fee: 0n };
  await assert.rejects(transfer(stepOf(gate), batch, null), (error) => error instanceof PrivateError && error.code === "GATE_FLAGGED_TO");
  assert.deepEqual(gate.asked, [[ME, FRIEND], [ME, BAD]]);
});

test("an open payment to someone's wallet asks the rules first; a flagged wallet, or no answer at all, stops it", async () => {
  const flagged = gateOf(() => answer({ [ME]: "clear", [BAD]: "flagged" }));
  await assert.rejects(payOpen(stepOf(flagged), { id: "1", to: BAD, units: 9n }), (error) => error instanceof PrivateError && error.code === "GATE_FLAGGED_TO");
  assert.deepEqual(flagged.asked, [[ME, BAD]]);
  const silent = gateOf(() => null);
  await assert.rejects(payOpen(stepOf(silent), { id: "1", to: FRIEND, units: 9n }), (error) => error instanceof PrivateError && error.code === "GATE_UNCHECKED");
});

const invoice = (more = {}) => ({ id: "i", to: FRIEND, amount: 20_000_000n, mint: RING_SOL, ...more });
const registered = { getUserRecords: async () => ({ records: [{}] }) };

test("paying an invoice from the wallet asks the rules for the payer and the recipient before the deposit is built", async () => {
  const paused = gateOf(() => answer({ [ME]: "clear", [FRIEND]: "clear" }, { paused: true }));
  await assert.rejects(buildWalletPayment({ sdk: noBuild, client: registered, gate: paused }, ME, invoice()), (error) => error instanceof PrivateError && error.code === "GATE_PAUSED");
  const flaggedTo = gateOf((addresses) => answer(Object.fromEntries(addresses.map((a) => [a, a === FRIEND ? "flagged" : "clear"]))));
  await assert.rejects(buildWalletPayment({ sdk: noBuild, client: registered, gate: flaggedTo }, ME, invoice()), (error) => error instanceof PrivateError && error.code === "GATE_FLAGGED_TO");
  const clear = gateOf((addresses) => answer(Object.fromEntries(addresses.map((a) => [a, "clear"]))));
  const built = [];
  const sdk = { buildDepositTransaction: async (args) => (built.push(args), "tx") };
  assert.equal(await buildWalletPayment({ sdk, client: registered, gate: clear }, ME, invoice()), "tx");
  assert.deepEqual(clear.asked, [[ME], [ME, FRIEND]]);
  assert.equal(built.length, 1);
  assert.equal(built[0].recipient, FRIEND);
  paidIn({ sdk, client: registered, gate: clear }, invoice());
  paidIn({ sdk, client: registered, gate: clear }, invoice({ mint: "Other1111111111111111111111111111111111111" }));
  assert.deepEqual(clear.counted, [["in", 20_000_000n]], "only SOL into the ring is counted");
});

test("the invoices read the keys the wallet gave in this tab, without the sealed store", async () => {
  dropBook();
  const keys = { address: () => "Priv111111111111111111111111111111111111111" };
  holdKeys("devnet", ME, keys);
  const opened = [];
  const sdk = {
    Wallet: class {
      constructor(args) {
        opened.push(args);
      }
    },
    syncWallet: async (args) => assert.equal(args.keys, keys),
    getPrivateTokenBalances: () => [],
    getPrivateTransactions: () => [],
  };
  try {
    assert.deepEqual(await readInbound({ sdk, client: {} }, ME), []);
    assert.equal(opened.length, 1, "the book opens on the wallet's keys");
  } finally {
    dropKeys();
    dropBook();
  }
});

test("a payout opens its book on the keys the wallet gave before it looks for older sealed keys", () => {
  const source = readFileSync(new URL("./usePayouts.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function bookFor"), source.indexOf("/** The record's lines"));
  assert.ok(body.includes("heldKeys<WalletKeys>(NETWORK, owner)"), "the wallet's keys are read");
  assert.ok(body.indexOf("heldKeys") < body.indexOf("unseal"), "the wallet's keys come first");
});

test("without the private flag nothing of this opens: no payouts tab and no private invoices", async () => {
  const { privateNetwork } = await import("../network.ts");
  assert.equal(privateNetwork(undefined), null);
  assert.equal(privateNetwork(""), null);
  assert.equal(privateNetwork("mainnet"), null, "only the test network opens it");
  const view = readFileSync(new URL("../../../terminal/money/payouts/payouts-view.ts", import.meta.url), "utf8");
  assert.ok(/payoutsOpen\([^)]*NEXT_PUBLIC_RYNTRA_PRIVATE[^)]*\)[^{]*\{\s*return privateNetwork\(flag\) !== null;/.test(view), "the payouts tab follows the one flag");
  const mode = readFileSync(new URL("../../../terminal/money/private/Mode.tsx", import.meta.url), "utf8");
  assert.ok(mode.includes("const shown = privateNetwork() !== null;"), "the private invoices follow the one flag");
});
