import assert from "node:assert/strict";
import test from "node:test";
import { getAddressDecoder } from "@solana/kit";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import {
  createMemoryAuthorizationCache,
  registerSeekerConnect,
  SeekerConnectError,
  SeekerConnectWalletName,
} from "@solana-mobile/seeker-connect-wallet-standard";

/**
 * Seeker Connect through Ryntra's own wallet client (SKR-1), with the
 * package's real Wallet Standard wallet and a scripted transport in place of
 * the Nostr relay and the phone — the hook the package provides for exactly
 * this (`seekerLink`). What is proved here is ours: the wallet is found by the
 * registry `wallet.client.ts` already keeps, it connects and restores
 * silently, it is asked for `solana:signTransaction` and never for
 * sign-and-send, its network is the registered one, its failures are read by
 * code, Disconnect only forgets the token, and its sign-in passes the server's
 * own SIWS check.
 *
 * The key below is generated in memory for the test and never leaves it.
 */

/* A browser without Android: the real registration in `wallet.client.ts` stays
   out of the way, and this file registers the wallet itself, with the fake link. */
const target = new EventTarget();
globalThis.window = Object.assign(target, {
  navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) node-test" },
  location: { origin: "https://ryntra.io", host: "ryntra.io", href: "https://ryntra.io/app" },
  localStorage: (() => {
    const items = new Map();
    return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: (key) => items.delete(key) };
  })(),
});

const wallet = await import("./wallet.client.ts");
const { setSeekerCountSinkForTests } = await import("./seeker-connect.client.ts");
/* Where each Seeker connect's count would go to `/api/track`. */
const counted = [];
setSeekerCountSinkForTests((event) => counted.push(event));
const signin = await import("./wallet-signin.client.ts");
const { buildSiwsInput, siwsMessageText, verifySiws } = await import("../auth/siws.ts");

const priv = utils.randomPrivateKey();
const pub = await getPublicKeyAsync(priv);
const ADDRESS = String(getAddressDecoder().decode(pub));

function fakeLink() {
  const calls = { sessions: 0, authorize: [], signTransactions: [], signAndSend: 0, signMessages: 0 };
  let failNext = null;
  let capabilities = { features: ["solana:signTransactions"], supportsSignAndSendTransactions: true, supportedTransactionVersions: ["legacy", 0] };
  const session = {
    authorize: async (request) => {
      calls.authorize.push(request ?? {});
      return { accounts: [{ address: ADDRESS, publicKey: pub, label: "Seeker" }], authToken: `token-${calls.authorize.length}`, walletUriBase: "https://wallet.example" };
    },
    deauthorize: async () => {
      throw new Error("deauthorize must never be called: Disconnect forgets the token locally");
    },
    getCapabilities: async () => capabilities,
    signMessages: async ({ payloads }) => {
      calls.signMessages++;
      /* Mobile Wallet Adapter's shape: the message with the signature appended. */
      return Promise.all(payloads.map(async (payload) => Uint8Array.from([...payload, ...(await signAsync(payload, priv))])));
    },
    signTransactions: async ({ payloads }) => {
      calls.signTransactions.push(payloads);
      return payloads.map((payload) => Uint8Array.from([...payload, 0xaa]));
    },
    signAndSendTransactions: async () => {
      calls.signAndSend++;
      throw new Error("signAndSendTransactions must never be called by Ryntra");
    },
  };
  return {
    calls,
    failWith: (error) => (failNext = error),
    capabilities: (next) => (capabilities = next),
    link: {
      transact: async (_config, callback) => {
        calls.sessions++;
        if (failNext) {
          const error = failNext;
          failNext = null;
          throw error;
        }
        return callback(session);
      },
    },
  };
}

const presented = [];
const presenter = { interactionStarted: () => () => undefined, interactionFailed: (error) => presented.push(error.code) };
const fake = fakeLink();
const cache = createMemoryAuthorizationCache();

/* Discovery first, then the wallet: the order a page meets when the package arrives after mount. */
assert.deepEqual(wallet.detectWallets().map((entry) => entry.name), []);
const seeker = registerSeekerConnect({
  identity: { name: "Ryntra", uri: "https://ryntra.io", icon: "/brand/icon-192.png" },
  relayDomain: "relay.primal.net",
  seekerLink: fake.link,
  authorizationCache: cache,
  presenter,
});

test("Seeker Connect is found by the registry the page already keeps, and listed only once a Seeker is likely", () => {
  assert.equal(SeekerConnectWalletName, "Seeker Connect");
  assert.equal(wallet.seekerRegistered(), true, "registered: the panel can offer it as a quiet row");
  /* No Seeker likely yet: the lists other pages read stay as they were (Phantom first on any Android phone). */
  assert.deepEqual(wallet.detectWallets().map((entry) => entry.name), []);
  assert.deepEqual(seeker.chains, ["solana:mainnet"], "the registration's network");
});

test("a silent restore with nothing cached asks nobody and restores nothing", async () => {
  const before = fake.calls.sessions;
  const result = await wallet.reconnectWallet("Seeker Connect");
  assert.equal(result.ok, false);
  assert.equal(result.state, "REFUSED");
  assert.equal(fake.calls.sessions, before, "a silent connect must not launch the wallet");
});

test("connect authorizes once on the registered network; a silent restore then needs no wallet launch", async () => {
  let heard = 0;
  const unsubscribe = wallet.subscribeWallets(() => heard++);
  const result = await wallet.connectWallet("Seeker Connect");
  unsubscribe();
  assert.equal(result.ok, true);
  assert.equal(result.connection.address, ADDRESS);
  /* A Seeker answered: from now on it is listed, and the lists were told. */
  assert.deepEqual(wallet.detectWallets().map((entry) => entry.name), ["Seeker Connect"]);
  assert.ok(heard > 0);
  assert.equal(fake.calls.authorize.at(-1).chain, "solana:mainnet");
  const sessions = fake.calls.sessions;
  const restored = await wallet.reconnectWallet("Seeker Connect");
  assert.equal(restored.ok, true);
  assert.equal(restored.connection.address, ADDRESS);
  assert.equal(fake.calls.sessions, sessions, "restored from the cached token, silently");
});

test("signing asks for solana:signTransaction only and returns the wallet's exact bytes", async () => {
  const unsigned = Uint8Array.of(1, 2, 3, 4);
  const result = await wallet.signTransaction({ wallet: "Seeker Connect", address: ADDRESS, unsignedWireBase64: Buffer.from(unsigned).toString("base64"), chain: "solana:mainnet" });
  assert.equal(result.ok, true);
  assert.deepEqual([...Buffer.from(result.signedWireBase64, "base64")], [1, 2, 3, 4, 0xaa]);
  assert.deepEqual([...fake.calls.signTransactions.at(-1)[0]], [1, 2, 3, 4]);
  const many = await wallet.signTransactions({ wallet: "Seeker Connect", address: ADDRESS, unsignedWireBase64: ["AQI=", "AwQ="], chain: "solana:mainnet" });
  assert.equal(many.ok, true);
  assert.equal(many.signedWireBase64.length, 2);
  assert.equal(fake.calls.signAndSend, 0, "sign-and-send is never asked");
  assert.equal(wallet.walletSignsV1("Seeker Connect"), false, "legacy and v0 only: no v1 bytes are built for it");
});

test("a request for another network is refused before the wallet opens", async () => {
  const sessions = fake.calls.sessions;
  const result = await wallet.signTransaction({ wallet: "Seeker Connect", address: ADDRESS, unsignedWireBase64: "AQI=", chain: "solana:devnet" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /signs on solana:mainnet only/);
  assert.equal(fake.calls.sessions, sessions, "nothing was asked of the wallet");
});

test("a closed overlay is an ordinary answer, a launch nothing answered is a quiet note, the rest carry their code", async () => {
  await wallet.forgetWallet("Seeker Connect");
  const cases = [
    ["cancelled", "CANCELLED"],
    ["association-failed", "UNREACHABLE"],
    ["authorization-declined", "REFUSED"],
    ["request-declined", "REFUSED"],
    ["session-closed", "FAILED"],
    ["wallet-error", "FAILED"],
  ];
  for (const [code, state] of cases) {
    fake.failWith(new SeekerConnectError(code, `scripted ${code}`));
    const result = await wallet.connectWallet("Seeker Connect");
    assert.equal(result.ok, false, code);
    assert.equal(result.state, state, code);
    assert.equal(result.code, code, code);
  }
  /* A plain error of the package (misuse) has no code: the panel says it itself. */
  fake.failWith(new Error("not a Seeker code"));
  const plain = await wallet.connectWallet("Seeker Connect");
  assert.equal(plain.ok, false);
  assert.equal(plain.state, "FAILED");
  assert.equal(plain.code, undefined);
});

test("a closed overlay or a launch nothing answered while signing says nothing was signed, in words", async () => {
  assert.equal((await wallet.connectWallet("Seeker Connect")).ok, true);
  fake.failWith(new SeekerConnectError("cancelled", "The wallet interaction was cancelled"));
  const result = await wallet.signTransaction({ wallet: "Seeker Connect", address: ADDRESS, unsignedWireBase64: "AQI=", chain: "solana:mainnet" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Seeker Connect was closed before signing. Nothing was signed.");
  fake.failWith(new SeekerConnectError("association-failed", "No wallet completed association within 30000ms"));
  const unanswered = await wallet.signTransaction({ wallet: "Seeker Connect", address: ADDRESS, unsignedWireBase64: "AQI=", chain: "solana:mainnet" });
  assert.equal(unanswered.ok, false);
  assert.equal(unanswered.reason, "Seeker Connect did not answer. Nothing was signed; try again.");
});

test("sign-in with Seeker passes the server's own SIWS check, once the appended signature is taken off", async () => {
  assert.equal((await wallet.connectWallet("Seeker Connect")).ok, true);
  const now = Date.now();
  const input = buildSiwsInput({ domain: "ryntra.io", uri: "https://ryntra.io", address: ADDRESS, nonce: "AbCdEfGh12345678XyZ0abcd", now, action: "signin" });
  const message = siwsMessageText(input);
  const signed = await signin.signInWithWallet("Seeker Connect", input, message);
  assert.equal(signed.ok, true);
  assert.equal(signed.via, "signMessage");
  assert.equal(new TextDecoder().decode(signed.signedMessage), message, "exactly the text the server issued");
  const verified = await verifySiws({ signedMessage: signed.signedMessage, signature: signed.signature, expected: { domain: "ryntra.io", uri: "https://ryntra.io", nonce: "AbCdEfGh12345678XyZ0abcd", address: ADDRESS, action: "signin" }, now });
  assert.deepEqual(verified, { ok: true, address: ADDRESS });
  fake.failWith(new SeekerConnectError("cancelled", "closed"));
  const cancelled = await signin.signInWithWallet("Seeker Connect", input, message);
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.state, "CANCELLED");
});

test("Disconnect forgets the token locally: no wallet launch, and the next restore finds nothing", async () => {
  assert.equal((await wallet.connectWallet("Seeker Connect")).ok, true);
  const sessions = fake.calls.sessions;
  await wallet.forgetWallet("Seeker Connect");
  assert.equal(fake.calls.sessions, sessions, "deauthorize is never sent");
  assert.equal(await cache.get() ?? null, null);
  assert.equal(seeker.accounts.length, 0);
  const restored = await wallet.reconnectWallet("Seeker Connect");
  assert.equal(restored.ok, false);
  /* Ryntra's own note that a Seeker answered here outlives the token, so the next page load offers it first again. */
  assert.equal(window.localStorage.getItem("ryntra.seeker.answered.v1"), "1");
});

test("a Seeker wallet that only signs and sends is refused, and sign-and-send is still never called", async () => {
  fake.capabilities({ features: [], supportsSignAndSendTransactions: true, supportedTransactionVersions: ["legacy", 0] });
  await wallet.forgetWallet("Seeker Connect");
  assert.equal((await wallet.connectWallet("Seeker Connect")).ok, true);
  assert.equal("solana:signTransaction" in seeker.features, false);
  assert.equal("solana:signAndSendTransaction" in seeker.features, true);
  const result = await wallet.signTransaction({ wallet: "Seeker Connect", address: ADDRESS, unsignedWireBase64: "AQI=", chain: "solana:mainnet" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /can only sign and send in one step/);
  assert.equal(fake.calls.signAndSend, 0);
  /* Still listed while connected, so the panel never says "no wallet" beside its address. */
  assert.deepEqual(wallet.detectWallets().map((entry) => entry.name), ["Seeker Connect"]);
});

test("forgetting another wallet touches nothing of it", async () => {
  let disconnected = 0;
  window.dispatchEvent(Object.assign(new Event("wallet-standard:register-wallet"), {
    detail: ({ register }) => register({
      name: "Phantom",
      icon: "data:image/svg+xml,",
      chains: ["solana:mainnet"],
      accounts: [],
      features: { "standard:connect": { connect: async () => ({ accounts: [] }) }, "standard:disconnect": { disconnect: async () => void disconnected++ }, "solana:signTransaction": {} },
    }),
  }));
  await wallet.forgetWallet("Phantom");
  assert.equal(disconnected, 0);
});

test("every connect the person asks Seeker for is counted by outcome; a silent restore and other wallets are not", async () => {
  fake.capabilities({ features: ["solana:signTransactions"], supportsSignAndSendTransactions: true, supportedTransactionVersions: ["legacy", 0] });
  await wallet.forgetWallet("Seeker Connect");
  counted.length = 0;
  assert.equal((await wallet.connectWallet("Seeker Connect")).ok, true);
  await wallet.reconnectWallet("Seeker Connect");
  await wallet.forgetWallet("Seeker Connect");
  for (const code of ["cancelled", "authorization-declined", "association-failed", "session-closed"]) {
    fake.failWith(new SeekerConnectError(code, `scripted ${code} for ${ADDRESS}`));
    await wallet.connectWallet("Seeker Connect");
  }
  await wallet.connectWallet("Phantom");
  assert.deepEqual(counted.map((event) => [event.name, event.placement]), [
    ["seeker_connect_ok", null],
    ["seeker_connect_cancelled", "cancelled"],
    ["seeker_connect_cancelled", "authorization-declined"],
    ["seeker_connect_failed", "association-failed"],
    ["seeker_connect_failed", "session-closed"],
  ]);
  /* Nothing about the person: no address, no message, no referrer. */
  for (const event of counted) {
    assert.deepEqual(Object.keys(event).sort(), ["locale", "name", "path", "placement", "ref"]);
    assert.equal(event.ref, null);
    assert.ok(!JSON.stringify(event).includes(ADDRESS));
  }
  /* A count that cannot be sent never fails the connect. */
  setSeekerCountSinkForTests(() => {
    throw new Error("network down");
  });
  assert.equal((await wallet.connectWallet("Seeker Connect")).ok, true);
  setSeekerCountSinkForTests((event) => counted.push(event));
});
