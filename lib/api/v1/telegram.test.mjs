import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import { connectTelegramChannel, verifyTelegramConnectCode } from "../../account/notifications.ts";
import { createMemoryGuardStore } from "../../guard/store.ts";
import { TelegramChannelResponseSchema, TelegramConnectRequestSchema, TelegramConnectResponseSchema } from "./contract.ts";
import { connectWalletTelegramChannel, disconnectWalletTelegramChannel, readWalletTelegramChannel } from "./telegram.server.ts";

/*
 * Contract 1.11.0 — the Telegram channel over
 * the bearer. The same channel Settings connects: a read creates nothing, a
 * connect resolves the wallet's own account and answers a signed code that
 * names exactly that account, a disconnect removes the binding, and one
 * wallet never sees another wallet's channel.
 */
const WALLET_A = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const WALLET_B = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ACCOUNT_A = "3f9a1c2e-7b4d-4e8f-9a0b-1c2d3e4f5a6b";
const ACCOUNT_B = "0a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const T0 = Date.parse("2026-09-22T20:00:00.500Z");

function world(overrides = {}) {
  const store = createMemoryGuardStore();
  const owners = new Map([[WALLET_A, ACCOUNT_A]]);
  const created = [];
  return {
    store,
    owners,
    created,
    deps: {
      store,
      accountByWallet: async (_chain, address) => owners.get(address) ?? null,
      accountResolveSolana: async (address, language) => {
        const known = owners.get(address);
        if (known) return { ok: true, accountId: known, isNew: false };
        owners.set(address, ACCOUNT_B);
        created.push({ address, language });
        return { ok: true, accountId: ACCOUNT_B, isNew: true };
      },
      now: () => T0,
      ...overrides,
    },
  };
}

describe("the Telegram channel over the bearer", () => {
  let previous;
  beforeEach(() => {
    previous = process.env.BETA_TOKEN_SECRET;
    process.env.BETA_TOKEN_SECRET = "stand-secret-of-at-least-sixteen";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.BETA_TOKEN_SECRET;
    else process.env.BETA_TOKEN_SECRET = previous;
  });

  it("reads the wallet's own channel — the handle and the moment, never the Telegram id — and creates nothing for a wallet no account owns", async () => {
    const { store, deps, created } = world();
    assert.deepEqual((await readWalletTelegramChannel(WALLET_A, deps)).body, { telegram: { connected: false, username: null, connectedAt: null } });
    await connectTelegramChannel(store, { accountId: ACCOUNT_A, telegramId: 777001, username: "ryntra_owner", now: new Date(T0).toISOString() });
    const read = await readWalletTelegramChannel(WALLET_A, deps);
    assert.equal(read.ok, true);
    assert.deepEqual(read.body, { telegram: { connected: true, username: "ryntra_owner", connectedAt: new Date(T0).toISOString() } });
    assert.equal(JSON.stringify(read.body).includes("777001"), false, "the Telegram id never leaves the server");
    assert.equal(TelegramChannelResponseSchema.safeParse(read.body).success, true);
    /* Wallet B: no account, so no channel — and reading made none. */
    assert.deepEqual((await readWalletTelegramChannel(WALLET_B, deps)).body.telegram.connected, false);
    assert.deepEqual(created, []);
  });

  it("connects through a signed fifteen-minute code that names exactly the wallet's account, creating the account on the first connect", async () => {
    const { deps, created } = world();
    const own = await connectWalletTelegramChannel(WALLET_A, "en", deps);
    assert.equal(own.ok, true);
    assert.equal(TelegramConnectResponseSchema.safeParse(own.body).success, true);
    const code = new URL(own.body.link).searchParams.get("start");
    assert.deepEqual(verifyTelegramConnectCode(code, T0 + 60_000), { accountId: ACCOUNT_A });
    assert.equal(own.body.expiresAt, "2026-09-22T20:15:00.000Z", "the instant the code itself dies, to the second");
    assert.equal(verifyTelegramConnectCode(code, Date.parse(own.body.expiresAt) + 1_000), null);
    /* A wallet without an account gets one, in its own language — the web's sign-in resolution. */
    const fresh = await connectWalletTelegramChannel(WALLET_B, "uk", deps);
    assert.equal(fresh.ok, true);
    assert.deepEqual(verifyTelegramConnectCode(new URL(fresh.body.link).searchParams.get("start"), T0), { accountId: ACCOUNT_B });
    assert.deepEqual(created, [{ address: WALLET_B, language: "uk" }]);
    assert.deepEqual(TelegramConnectRequestSchema.parse({}), { locale: "en" }, "the language defaults, and nothing else is accepted");
    assert.equal(TelegramConnectRequestSchema.safeParse({ locale: "uk", accountId: ACCOUNT_A }).success, false, "a client cannot name an account");
  });

  it("disconnects the wallet's own binding and leaves another account's alone", async () => {
    const { store, deps, owners } = world();
    owners.set(WALLET_B, ACCOUNT_B);
    await connectTelegramChannel(store, { accountId: ACCOUNT_A, telegramId: 1, username: "a", now: new Date(T0).toISOString() });
    await connectTelegramChannel(store, { accountId: ACCOUNT_B, telegramId: 2, username: "b", now: new Date(T0).toISOString() });
    const removed = await disconnectWalletTelegramChannel(WALLET_A, deps);
    assert.deepEqual(removed.body, { telegram: { connected: false, username: null, connectedAt: null } });
    assert.equal((await readWalletTelegramChannel(WALLET_A, deps)).body.telegram.connected, false);
    assert.equal((await readWalletTelegramChannel(WALLET_B, deps)).body.telegram.username, "b", "the other wallet's channel stands");
    const none = world();
    assert.equal((await disconnectWalletTelegramChannel(WALLET_B, none.deps)).ok, true, "nothing to remove is not a failure");
  });

  it("an account store that does not answer, or a deployment that cannot sign, is UNAVAILABLE — never a guessed channel or an unsigned link", async () => {
    const silent = world({ accountByWallet: async () => undefined, accountResolveSolana: async () => ({ ok: false, error: "unavailable" }) });
    for (const outcome of [await readWalletTelegramChannel(WALLET_A, silent.deps), await connectWalletTelegramChannel(WALLET_A, "en", silent.deps), await disconnectWalletTelegramChannel(WALLET_A, silent.deps)]) {
      assert.equal(outcome.ok, false);
      assert.equal(outcome.code, "UNAVAILABLE");
    }
    delete process.env.BETA_TOKEN_SECRET;
    const unsigned = await connectWalletTelegramChannel(WALLET_A, "en", world().deps);
    assert.equal(unsigned.ok, false);
    assert.equal(unsigned.code, "UNAVAILABLE");
  });

  it("the route resolves the wallet through the one proof helper, refuses an unserved major, and reads no cookie itself", () => {
    const source = readFileSync(new URL("../../../app/api/v1/notifications/telegram/route.ts", import.meta.url), "utf8");
    assert.match(source, /export async function GET[\s\S]*?requireWalletProof\(request, "read"\)/);
    assert.match(source, /export async function POST[\s\S]*?requireWalletProof\(request, "mutation"\)/);
    assert.match(source, /export async function DELETE[\s\S]*?requireWalletProof\(request, "mutation"\)/);
    assert.equal(source.match(/apiMajorRefusal\(request\.headers\)/g).length, 3);
    assert.doesNotMatch(source, /cookies\(|\.cookies\.get|getWalletProof\(\)|getSession\(/);
  });
});
