// Run from repo root: node --test city/lib/quarter/account.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { createMockWorld } = await import("./mock.ts");
const { createQuarterStore } = await import("./store.ts");
const { accountKey, createAccountStore, LINES, readiness } = await import("./account.ts");
const { FIRST_SLOT } = await import("./plot.ts");

/**
 * Whose quarter it is: claiming and building ask for a wallet signed in to Ryntra first — connect, one signed
 * message, then the claim or the build; a refusal anywhere changes nothing. The quarter shown is the signed-in
 * wallet's: another wallet reads its own place, and no wallet is a visitor's city.
 */

const A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/** The world as the server keeps it: a guest's place in its cookie, an account's under the account, joined once. */
function server() {
  const worlds = new Map();
  const world = (who) => {
    if (!worlds.has(who)) worlds.set(who, createMockWorld({ storage: null }));
    return worlds.get(who);
  };
  const s = { account: null, reads: 0, claims: [] };
  s.client = () => {
    const who = s.account ?? "guest";
    const w = world(who);
    return {
      ...w,
      async me() {
        s.reads += 1;
        // The guest joins the account on its first signed-in read.
        if (s.account && worlds.has("guest") && !worlds.has(`${s.account}:joined`)) {
          worlds.set(`${s.account}:joined`, true);
          const guest = worlds.get("guest");
          if (await guest.me()) worlds.set(s.account, guest);
          worlds.delete("guest");
        }
        return world(who).me();
      },
      async claim(key) {
        s.claims.push(who);
        return world(who).claim(key);
      },
    };
  };
  return s;
}

function setup({ wallets = ["Phantom", "Solflare"], fact = { status: "known", signedIn: false, walletAddress: null }, connectAs = A, sign = "ok" } = {}) {
  const srv = server();
  const quarter = createQuarterStore({ client: srv.client, retryMs: 0 });
  const listeners = { wallet: new Set(), session: new Set() };
  const emit = (kind) => listeners[kind].forEach((l) => l());
  const state = { connection: null, fact, error: null, connectAs, sign, signIns: 0, signOuts: 0 };
  const deps = {
    quarter,
    wallet: {
      connection: () => state.connection,
      wallets: () => wallets.map((name) => ({ name })),
      async connect(name) {
        if (state.connectAs === null) return false;
        state.connection = { wallet: name, address: state.connectAs };
        emit("wallet");
        return true;
      },
      error: () => state.error,
      disconnect() {
        state.connection = null;
        emit("wallet");
      },
      subscribe: (l) => (listeners.wallet.add(l), () => listeners.wallet.delete(l)),
    },
    session: {
      fact: () => state.fact,
      revalidate: async () => state.fact,
      subscribe: (l) => (listeners.session.add(l), () => listeners.session.delete(l)),
    },
    async signIn(connection) {
      state.signIns += 1;
      if (state.sign === "declined") return { ok: false, state: "declined", message: "Nothing was signed." };
      state.fact = { status: "known", signedIn: true, walletAddress: connection.address };
      srv.account = connection.address;
      emit("session");
      return { ok: true };
    },
    async signOut() {
      state.signOuts += 1;
      state.fact = { status: "known", signedIn: false, walletAddress: null };
      srv.account = null;
      emit("session");
    },
  };
  const account = createAccountStore(deps);
  const stop = account.getState().start();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  /** Another wallet account in the wallet itself, as `watchWalletAccounts` reports it. */
  const switchTo = (address) => {
    state.connection = { wallet: state.connection.wallet, address };
    emit("wallet");
  };
  return { account, quarter, srv, state, stop, tick, switchTo };
}

test("whose quarter: no wallet is a visitor, a wallet signed in is its account, the session unread decides nothing", () => {
  const known = (signedIn, walletAddress) => ({ status: "known", signedIn, walletAddress });
  const c = { wallet: "Phantom", address: A };
  assert.equal(accountKey(known(true, A), null), null);
  assert.equal(readiness(known(true, A), null), "wallet");
  assert.equal(accountKey({ status: "unknown", signedIn: false, walletAddress: null }, c), undefined);
  assert.equal(readiness({ status: "down", signedIn: true, walletAddress: A }, c), "checking");
  assert.equal(readiness(known(false, null), c), "sign");
  assert.equal(readiness(known(true, B), c), "sign", "signed in with another wallet: this one signs");
  assert.equal(accountKey(known(true, A), c), `wallet:${A}`);
  assert.equal(readiness(known(true, null), c), "ready", "an account from another door keeps its quarter");
});

test("no wallet: «Claim your spot» opens the wallets first and claims nothing until one connects and signs", async () => {
  const { account, quarter, srv, state, tick } = setup();
  await tick();
  assert.equal(quarter.getState().owner, null);
  assert.equal(quarter.getState().status, "none");
  assert.equal(await account.getState().begin("claim", "card"), false);
  assert.equal(account.getState().step, "pick");
  assert.deepEqual(srv.claims, []);
  assert.equal(await account.getState().pick("Phantom"), true);
  assert.equal(state.signIns, 1);
  assert.deepEqual(srv.claims, [A], "claimed under the wallet's account, not as a guest");
  assert.equal(quarter.getState().owner, `wallet:${A}`);
  assert.equal(quarter.getState().status, "resident");
  assert.equal(quarter.getState().mode, "arrive");
  assert.equal(account.getState().step, null);
});

test("one wallet in the browser connects straight away; a wallet already signed in claims with no signature", async () => {
  const one = setup({ wallets: ["Phantom"] });
  assert.equal(await one.account.getState().begin("claim", "card"), true);
  assert.equal(one.state.signIns, 1);
  assert.equal(one.quarter.getState().status, "resident");

  const signed = setup({ fact: { status: "known", signedIn: true, walletAddress: A } });
  signed.srv.account = A;
  signed.state.connection = { wallet: "Phantom", address: A };
  await signed.account.getState().sync();
  assert.equal(signed.quarter.getState().owner, `wallet:${A}`);
  assert.equal(await signed.account.getState().begin("claim", "card"), true);
  assert.equal(signed.state.signIns, 0);
  assert.deepEqual(signed.srv.claims, [A]);
});

test("closing the wallet or refusing the message changes nothing, and says so", async () => {
  const closed = setup({ connectAs: null });
  await closed.account.getState().begin("claim", "card");
  assert.equal(await closed.account.getState().pick("Phantom"), false);
  assert.equal(closed.account.getState().error, LINES.noWallet);
  assert.deepEqual(closed.srv.claims, []);

  const declined = setup({ sign: "declined" });
  await declined.account.getState().begin("claim", "card");
  assert.equal(await declined.account.getState().pick("Phantom"), false);
  assert.equal(declined.account.getState().error, LINES.declined);
  assert.equal(declined.account.getState().step, null);
  assert.deepEqual(declined.srv.claims, []);
  assert.equal(declined.quarter.getState().owner, null, "a wallet connected but not signed in is still a visitor");
  assert.equal(declined.quarter.getState().status, "none");
});

test("a guest's quarter joins the account at sign-in, and building goes on from it", async () => {
  const { account, quarter, srv, state } = setup({ wallets: ["Phantom"] });
  // Claimed before this change, as a guest with no wallet.
  const guest = await srv.client().claim("k0");
  srv.claims.length = 0;
  assert.equal(await account.getState().begin("build", "card"), true);
  assert.equal(state.signIns, 1);
  assert.equal(quarter.getState().status, "resident");
  assert.equal(quarter.getState().me.quarter.id, guest.quarter.id, "the same lot, now the account's");
  assert.equal(quarter.getState().mode, "arrive");
  assert.deepEqual(srv.claims, [], "an existing place is entered, not claimed again");
});

test("switching wallets reads the place again; disconnecting returns the visitor's city and signs the wallet out", async () => {
  const { account, quarter, srv, state, switchTo, tick } = setup({ wallets: ["Phantom"] });
  await account.getState().begin("claim", "card");
  const mine = quarter.getState().me.quarter.id;
  const reads = srv.reads;

  // Another account in the wallet: this browser has not signed in with it, so nothing of the first one stays.
  switchTo(B);
  await tick();
  assert.equal(quarter.getState().owner, null);
  assert.equal(quarter.getState().me, null);
  assert.equal(quarter.getState().status, "none");

  // It signs in: its own place is read (none yet), never the first wallet's.
  assert.equal(await account.getState().begin(null, "top"), true);
  assert.equal(quarter.getState().owner, `wallet:${B}`);
  assert.ok(srv.reads > reads);
  assert.equal(quarter.getState().status, "none");

  // Back to the first wallet, signed in again: its quarter comes back as it was.
  switchTo(A);
  await account.getState().begin(null, "top");
  assert.equal(quarter.getState().me.quarter.id, mine);

  await account.getState().disconnect();
  assert.equal(state.connection, null);
  assert.equal(state.signOuts, 1);
  assert.equal(quarter.getState().owner, null);
  assert.equal(quarter.getState().me, null);
  assert.equal(quarter.getState().mode, "city");
});

test("a build answered after the wallet changed does not land on the other wallet's screen", async () => {
  const { account, quarter, switchTo, tick } = setup({ wallets: ["Phantom"] });
  await account.getState().begin("claim", "card");
  quarter.getState().arrived();
  quarter.getState().pick(FIRST_SLOT);
  const placing = quarter.getState().place();
  assert.ok(quarter.getState().landing, "the home is on its way down");
  switchTo(B);
  await tick();
  assert.equal(await placing, false);
  assert.equal(quarter.getState().me, null);
  assert.equal(quarter.getState().landing, null);
});
