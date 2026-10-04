import assert from "node:assert/strict";
import test, { before } from "node:test";

import { reconnectWallet, watchWalletAccounts } from "./wallet.client.ts";

/**
 * The rule this restore had to keep, not trade away.
 *
 * The workspace has never auto-connected, and its reason stands: a wallet
 * prompt that appears because a page loaded is a permission request nobody
 * made. Since 2026-09-04 one wallet context is a property of the product,
 * which means the connection has to survive navigation — and the only honest
 * way to have both is Wallet Standard's `connect({ silent: true })`, which
 * must not prompt.
 *
 * So the guard is not "does it reconnect". It is **"can it ever ask"**. If a
 * future edit drops that flag, this fails, and the defect it prevents is a
 * wallet popup on page load across the whole product.
 */

const SOLANA_CHAIN = "solana:mainnet";
const SIGN_FEATURE = "solana:signTransaction";
const ADDRESS = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";

/** The Wallet Standard registration api, captured the way a real wallet captures it. */
let register = null;

before(async () => {
  const target = new EventTarget();
  globalThis.window = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  /* A wallet extension listens for the app to announce itself, then registers.
     Capturing the api here is exactly what an extension does. */
  target.addEventListener("wallet-standard:app-ready", (event) => {
    register = event.detail.register;
  });
  /* Any registry read starts discovery, which dispatches app-ready. */
  await reconnectWallet("nobody");
  assert.ok(typeof register === "function", "the registration api was never announced");
});

test("wallet account change and disconnect are observed without a new connect or signature", () => {
  let listener;
  const account = { address: ADDRESS, chains: [SOLANA_CHAIN], features: [SIGN_FEATURE] };
  const wallet = { name: "Account change test", chains: [SOLANA_CHAIN], accounts: [account], features: {
    "standard:events": { on: (_event, callback) => { listener = callback; return () => { listener = null; }; } },
  } };
  const unregister = register(wallet);
  const changes = [];
  const off = watchWalletAccounts(wallet.name, (value) => changes.push(value?.address ?? null));
  try {
    const next = { ...account, address: "11111111111111111111111111111111" };
    wallet.accounts = [next]; listener({ accounts: wallet.accounts });
    wallet.accounts = []; listener({ accounts: [] });
    assert.deepEqual(changes, [next.address, null]);
  } finally { off(); unregister(); }
  assert.equal(listener, null);
});

/** A wallet that records how it was called and answers like a trusted one. */
function fakeWallet({ name = "Phantom", accounts, calls = [] } = {}) {
  const held = accounts ?? [{ address: ADDRESS, chains: [SOLANA_CHAIN], features: [SIGN_FEATURE] }];
  return {
    name,
    icon: "",
    version: "1.0.0",
    chains: [SOLANA_CHAIN],
    accounts: held,
    features: {
      "standard:connect": {
        connect: async (input) => {
          calls.push(input);
          return { accounts: held };
        },
      },
      [SIGN_FEATURE]: {},
    },
  };
}

async function withWallet(wallet, run) {
  const remove = register(wallet);
  try {
    return await run();
  } finally {
    remove();
  }
}

test("a silent restore asks the wallet for silence, explicitly", async () => {
  const calls = [];
  await withWallet(fakeWallet({ calls }), async () => {
    await reconnectWallet("Phantom");
  });

  assert.equal(calls.length, 1, "the restore did not reach the wallet");
  assert.ok(calls[0] !== undefined, "connect() was called with no input, so the wallet may prompt");
  assert.equal(calls[0].silent, true, "the restore can prompt: silent was not requested");
});

test("a wallet that has granted nothing restores nothing, and says so quietly", async () => {
  const result = await withWallet(fakeWallet({ accounts: [] }), async () => reconnectWallet("Phantom"));

  assert.equal(result.ok, false, "an empty grant must not be reported as a connection");
  assert.equal(result.state, "REFUSED", "not-yet-trusted is a refusal, not a failure to report");
});

test("an unknown wallet is refused by name rather than reaching for another", async () => {
  const result = await withWallet(fakeWallet(), async () => reconnectWallet("Solflare"));

  assert.equal(result.ok, false);
  assert.equal(result.state, "NO_WALLET");
  assert.match(result.reason, /Solflare/, "the answer must name the wallet that is missing");
});

test("an account that cannot sign on Solana is not a restored connection", async () => {
  const wallet = fakeWallet({ accounts: [{ address: ADDRESS, chains: ["eip155:1"], features: [] }] });
  const result = await withWallet(wallet, async () => reconnectWallet("Phantom"));

  assert.equal(result.ok, false, "an EVM-only account must never be adopted as a Solana connection");
});

test("a restored connection carries the wallet, the address and its chains", async () => {
  const result = await withWallet(fakeWallet(), async () => reconnectWallet("Phantom"));

  assert.equal(result.ok, true);
  assert.deepEqual(result.connection, { wallet: "Phantom", address: ADDRESS, chains: [SOLANA_CHAIN] });
});
