import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyAsync, getPublicKeyAsync } from "@noble/ed25519";

import {
  encodeAppMessage,
  encodePageReady,
  encodeRequest,
  isPageReady,
  isShareName,
  MAX_SHARE_TEXT,
  MAX_TRANSACTIONS,
  parseAppMessage,
  parsePageRequest,
  parseResult,
  REQUEST_TIMEOUT_MS,
} from "./protocol.ts";
import { createAppBridge } from "./client.ts";
import { base58, createFakeApp, fakeAppTransport } from "./mock.ts";
import { externalSigner } from "./signer.ts";
import { MAINNET_ONLY, routeSigner } from "./route.ts";
import { attachAppBridge, detachAppBridge, fromApp, looksLikeApp, webViewTransport } from "./page.ts";
import { shareNameOf } from "./protocol.ts";

// CITY-6b: the city's side of the bridge to the Ryntra app (`docs/city/APP-BRIDGE.md`), end to end against a fake app
// that reads every request with the app's parser and signs with a throwaway key. Nothing here touches a network.

const ADDRESS = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const SEED = new Uint8Array(32).fill(7);
const wire = (m) => JSON.stringify({ v: 1, ...m });
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** Timers the test moves by hand: the 120 s wait without waiting 120 s. */
function manualTimers() {
  let now = 0;
  const due = new Map();
  let next = 0;
  return {
    timers: {
      set: (run, ms) => {
        const id = ++next;
        due.set(id, { at: now + ms, run });
        return id;
      },
      clear: (id) => due.delete(id),
    },
    advance: (ms) => {
      now += ms;
      for (const [id, entry] of [...due]) {
        if (entry.at <= now) {
          due.delete(id);
          entry.run();
        }
      }
    },
  };
}

/** A legacy transaction with one signer — the key given — and no instructions: enough to be signed for real. */
function unsignedTransaction(publicKey) {
  const message = new Uint8Array([1, 0, 1, 2, ...publicKey, ...new Uint8Array(32), ...new Uint8Array(32).fill(9), 0]);
  return { message, wire: new Uint8Array([1, ...new Uint8Array(64), ...message]) };
}

async function paired(options = {}) {
  const app = createFakeApp({ secretKey: SEED, name: "Seed Vault", ...options });
  const clock = manualTimers();
  const bridge = createAppBridge(fakeAppTransport(app), { timers: clock.timers });
  await app.ready();
  await flush();
  return { app, bridge, clock, address: await app.address(), publicKey: await getPublicKeyAsync(SEED) };
}

/* ── The parsers ───────────────────────────────────────────────────────── */

test("the page reads the app's two events and its answers, and nothing else", () => {
  assert.deepEqual(parseAppMessage(wire({ type: "app.ready", version: "1.4.0", platform: "android", wallet: null })), {
    kind: "event", type: "app.ready", version: "1.4.0", platform: "android", wallet: null,
  });
  assert.deepEqual(parseAppMessage(wire({ type: "wallet.changed", wallet: { address: ADDRESS, name: "Phantom" }, extra: "dropped" })), {
    kind: "event", type: "wallet.changed", wallet: { address: ADDRESS, name: "Phantom" },
  });
  assert.deepEqual(parseAppMessage(wire({ id: "p1", ok: true, result: { shared: true } })), { kind: "response", id: "p1", ok: true, result: { shared: true } });
  assert.deepEqual(parseAppMessage(wire({ id: "p1", ok: false, error: { code: "declined", message: "no" } })), {
    kind: "response", id: "p1", ok: false, error: { code: "declined", message: "no" },
  });

  const refused = [
    { v: 1, type: "app.ready", version: "1", platform: "android", wallet: null }, // an object, not the JSON string
    "not json",
    JSON.stringify([1, 2]),
    JSON.stringify({ v: 2, type: "app.ready", version: "1", platform: "android", wallet: null }),
    wire({ type: "app.ready", version: "1", platform: "ios", wallet: null }),
    wire({ type: "app.ready", version: "", platform: "android", wallet: null }),
    wire({ type: "app.ready", version: "1", platform: "android" }),
    wire({ type: "wallet.changed", wallet: { address: "0xnot-solana", name: "Phantom" } }),
    wire({ type: "wallet.changed", wallet: { address: ADDRESS, name: "" } }),
    wire({ type: "wallet.sign", wallet: null }),
    wire({ type: "funds.move", amount: 1 }),
    wire({ id: "p1", ok: true }),
    wire({ id: "p1", ok: false, error: { code: "teapot", message: "?" } }),
    wire({ id: "p1", ok: "yes", result: {} }),
    wire({ id: "x".repeat(65), ok: true, result: {} }),
    wire({ id: "", ok: true, result: {} }),
    null,
    42,
  ];
  for (const message of refused) assert.equal(parseAppMessage(message), null, String(message));
});

test("the app's parser takes the six requests as the contract writes them and refuses the rest", () => {
  const tx = b64(new Uint8Array(200).fill(1));
  const ok = [
    { id: "a", type: "wallet.connect" },
    { id: "a", type: "wallet.disconnect" },
    { id: "a", type: "wallet.signMessage", message: b64(new TextEncoder().encode("Sign in to Ryntra")) },
    { id: "a", type: "wallet.signTransactions", transactions: [tx, tx] },
    { id: "a", type: "share.file", name: "clip.mp4", mime: "video/mp4", data: b64([1, 2, 3]), text: "I'm in" },
    { id: "a", type: "open.external", url: "https://x.com/intent/post?text=hi" },
  ];
  for (const request of ok) assert.equal(parsePageRequest(wire(request))?.type, request.type, request.type);
  assert.deepEqual(parsePageRequest(wire({ id: "a", type: "wallet.connect", sneaky: true })), { v: 1, id: "a", type: "wallet.connect" });

  const refused = [
    { type: "wallet.connect" },
    { id: "a", type: "wallet.sendTransaction", transactions: [tx] },
    { id: "a", type: "wallet.signTransactions", transactions: [] },
    { id: "a", type: "wallet.signTransactions", transactions: Array(MAX_TRANSACTIONS + 1).fill(tx) },
    { id: "a", type: "wallet.signTransactions", transactions: ["not base64!"] },
    { id: "a", type: "wallet.signTransactions", transactions: [b64(new Uint8Array(4200))] },
    { id: "a", type: "wallet.signMessage", message: "" },
    { id: "a", type: "share.file", name: "clip.gif", mime: "image/gif", data: b64([1]) },
    { id: "a", type: "share.file", name: "../clip.mp4", mime: "video/mp4", data: b64([1]) },
    { id: "a", type: "share.file", name: "clip.mp4", mime: "video/mp4", data: "" },
    { id: "a", type: "share.file", name: "ryntra-дог.mp4", mime: "video/mp4", data: b64([1]) },
    { id: "a", type: "share.file", name: "clip.mp4", mime: "video/mp4", data: b64([1]), text: "x".repeat(MAX_SHARE_TEXT + 1) },
    { id: "a", type: "open.external", url: "http://ryntra.io" },
    { id: "a", type: "open.external", url: "javascript:alert(1)" },
    { id: "a", type: "open.external", url: "intent://scan/#Intent;end" },
    { id: "a", type: "open.external", url: "https://user:pass@ryntra.io" },
    { id: "a", type: "open.external", url: "/c/mint" },
  ];
  for (const request of refused) assert.equal(parsePageRequest(wire(request)), null, JSON.stringify(request).slice(0, 80));
});

test("an answer is read for the request it answers: as many signed as given, a real address", () => {
  const tx = b64(new Uint8Array(100));
  assert.deepEqual(parseResult("wallet.signTransactions", { signed: [tx, tx] }, { transactions: [tx, tx] }), { signed: [tx, tx] });
  assert.equal(parseResult("wallet.signTransactions", { signed: [tx] }, { transactions: [tx, tx] }), null, "fewer than given is nothing usable");
  assert.equal(parseResult("wallet.signTransactions", { signed: "abc" }), null);
  assert.equal(parseResult("wallet.connect", { address: "nope", name: "Phantom" }), null);
  assert.equal(parseResult("wallet.signMessage", { signature: "***", signedMessage: tx }), null);
  assert.equal(parseResult("share.file", { shared: "yes" }), null);
  assert.deepEqual(parseResult("open.external", { anything: 1 }), {});
});

test("what one side encodes the other side's parser reads back", () => {
  const request = encodeRequest("p9", "open.external", { url: "https://ryntra.io/c/x" });
  assert.deepEqual(parsePageRequest(request), { v: 1, id: "p9", type: "open.external", url: "https://ryntra.io/c/x" });
  const event = encodeAppMessage({ kind: "event", type: "wallet.changed", wallet: null });
  assert.deepEqual(parseAppMessage(event), { kind: "event", type: "wallet.changed", wallet: null });
  assert.equal(JSON.parse(event).kind, undefined, "the parser's own word stays off the wire");
});

/* ── Round trips with a fake app ───────────────────────────────────────── */

test("app.ready says the app is here and which wallet it holds", async () => {
  const app = createFakeApp({ secretKey: SEED, name: "Seed Vault", connected: true });
  const bridge = createAppBridge(fakeAppTransport(app));
  assert.equal(bridge.ready(), null);
  const ready = bridge.whenReady(1_000);
  await app.ready();
  assert.equal(await ready, true);
  assert.deepEqual(bridge.ready(), { version: "0.0.0-mock", platform: "android" });
  assert.deepEqual(bridge.wallet(), { address: await app.address(), name: "Seed Vault" });
  const heard = [];
  bridge.subscribe((event) => heard.push(event));
  await app.changeWallet(false);
  assert.equal(bridge.wallet(), null);
  assert.equal(heard.at(-1).type, "wallet.changed");
  bridge.close();
});

test("connect, then sign the exact bytes of a message: the signature is the wallet's own", async () => {
  const { bridge, address, publicKey } = await paired();
  const connected = await bridge.request("wallet.connect", {});
  assert.deepEqual(connected, { ok: true, result: { address, name: "Seed Vault" } });
  assert.equal(address, base58(publicKey));
  assert.deepEqual(bridge.wallet(), { address, name: "Seed Vault" });

  const message = new TextEncoder().encode("ryntra.io wants you to sign in with your Solana account");
  const signed = await bridge.request("wallet.signMessage", { message: b64(message) });
  assert.equal(signed.ok, true);
  assert.equal(signed.result.signedMessage, b64(message));
  assert.equal(await verifyAsync(Buffer.from(signed.result.signature, "base64"), message, publicKey), true);
});

test("signTransactions gives back each transaction signed, in order, and nothing else changed", async () => {
  const { bridge, publicKey } = await paired();
  await bridge.request("wallet.connect", {});
  const one = unsignedTransaction(publicKey);
  const answer = await bridge.request("wallet.signTransactions", { transactions: [b64(one.wire), b64(one.wire)] });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.signed.length, 2);
  const out = Buffer.from(answer.result.signed[0], "base64");
  assert.deepEqual(out.subarray(65), Buffer.from(one.message), "the message is the one given");
  assert.equal(await verifyAsync(out.subarray(1, 65), one.message, publicKey), true);
});

test("more than the app's four go in two windows, in order; a no in the second gives back nothing signed (CITY-213)", async () => {
  const { app, bridge, publicKey } = await paired();
  await bridge.request("wallet.connect", {});
  const address = bridge.wallet().address;
  const signer = externalSigner(bridge);
  const wires = Array.from({ length: 6 }, () => b64(unsignedTransaction(publicKey).wire));
  const asked = [];
  const stop = bridge.subscribe(() => {});
  const request = bridge.request;
  const counting = { ...bridge, request: (type, fields) => (asked.push(fields.transactions?.length), request(type, fields)) };
  const both = await externalSigner(counting).signTransactions({ address, unsignedWireBase64: wires });
  stop();
  assert.equal(both.ok, true);
  assert.deepEqual(asked, [4, 2]);
  assert.equal(both.signedWireBase64.length, 6);
  for (const [index, signed] of both.signedWireBase64.entries()) {
    assert.deepEqual(Buffer.from(signed, "base64").subarray(65), Buffer.from(wires[index], "base64").subarray(65), "each comes back in its place");
  }
  const four = await signer.signTransactions({ address, unsignedWireBase64: wires.slice(0, 4) });
  assert.equal(four.signedWireBase64.length, 4);
  let calls = 0;
  const secondNo = { ...bridge, request: (type, fields) => (++calls === 2 ? app.once("wallet.signTransactions", "decline") : null, request(type, fields)) };
  const refused = await externalSigner(secondNo).signTransactions({ address, unsignedWireBase64: wires });
  assert.equal(refused.ok, false);
  assert.equal(refused.signedWireBase64, undefined, "the first window's signatures do not leave the signer");
});

test("a transaction as large as the app reads passes the page's parser; a larger one does not", async () => {
  const { bridge } = await paired();
  await bridge.request("wallet.connect", {});
  const big = (bytes) => b64(new Uint8Array(bytes).fill(1));
  assert.notEqual((await bridge.request("wallet.signTransactions", { transactions: [big(4096)] })).code, "invalid");
  assert.equal((await bridge.request("wallet.signTransactions", { transactions: [big(4099)] })).code, "invalid");
});

test("a no in the wallet is an answer, `declined`; a failure, unsupported and busy come back as they are", async () => {
  const { app, bridge } = await paired();
  app.once("wallet.connect", "decline");
  assert.deepEqual(await bridge.request("wallet.connect", {}), { ok: false, code: "declined", message: "The person said no." });
  app.once("wallet.connect", "fail");
  assert.equal((await bridge.request("wallet.connect", {})).code, "failed");
  app.once("share.file", "unsupported");
  assert.equal((await bridge.request("share.file", { name: "a.png", mime: "image/png", data: b64([1]) })).code, "unsupported");
  app.once("wallet.connect", "busy");
  assert.equal((await bridge.request("wallet.connect", {})).code, "busy");
});

test("no answer in 120 s is `failed`, and an answer after that is dropped", async () => {
  const clock = manualTimers();
  const sent = [];
  let push = null;
  const bridge = createAppBridge({ post: (data) => sent.push(JSON.parse(data)), listen: (receive) => ((push = receive), () => {}) }, { timers: clock.timers });
  let settled = null;
  void bridge.request("wallet.connect", {}).then((answer) => (settled = answer));
  clock.advance(REQUEST_TIMEOUT_MS - 1);
  await flush();
  assert.equal(settled, null, "the wallet window may stay open for two minutes");
  clock.advance(1);
  await flush();
  assert.equal(settled.ok, false);
  assert.equal(settled.code, "failed");
  assert.equal(bridge.pending(), 0);
  // The app answers late: nobody waits for that id any more.
  push(wire({ id: sent[0].id, ok: true, result: { address: ADDRESS, name: "Phantom" } }));
  assert.equal(bridge.wallet(), null, "a late answer changes nothing");
  void bridge.request("wallet.connect", {});
  assert.equal(sent.length, 2, "and the wallet is free for the next request");
});

test("one request to the wallet at a time: a second is `busy` before the app is asked; a share still goes", async () => {
  const { app, bridge } = await paired();
  app.once("wallet.connect", "silent");
  void bridge.request("wallet.connect", {});
  await flush();
  const second = await bridge.request("wallet.signMessage", { message: b64([1, 2, 3]) });
  assert.equal(second.code, "busy");
  assert.equal(app.requests.filter((r) => r.type === "wallet.signMessage").length, 0, "the app never heard the second");
  const share = await bridge.request("share.file", { name: "clip.png", mime: "image/png", data: b64([1, 2]) });
  assert.deepEqual(share, { ok: true, result: { shared: true } });
});

test("a request the parser would refuse is never sent; an answer of the wrong shape is `failed`", async () => {
  const { app, bridge } = await paired();
  const before = app.log.length;
  assert.equal((await bridge.request("open.external", { url: "javascript:alert(1)" })).code, "invalid");
  assert.equal((await bridge.request("wallet.signTransactions", { transactions: [] })).code, "invalid");
  assert.equal(app.log.length, before, "nothing reached the app");

  // An app that answers a connect with something that is not a wallet.
  const sent = [];
  let push = null;
  const odd = createAppBridge({ post: (data) => sent.push(JSON.parse(data)), listen: (receive) => ((push = receive), () => {}) });
  const asked = odd.request("wallet.connect", {});
  push(wire({ id: sent[0].id, ok: true, result: { address: "0x123", name: "Evil" } }));
  assert.equal((await asked).code, "failed");
  assert.equal(odd.wallet(), null);
});

test("the app's own parser answers `invalid` to a request it cannot read, by its id", async () => {
  const app = createFakeApp({ secretKey: SEED });
  const heard = [];
  app.onSend((data) => heard.push(parseAppMessage(data)));
  app.receive(wire({ id: "q1", type: "wallet.signTransactions", transactions: ["@@"] }));
  app.receive(wire({ type: "wallet.connect" }));
  await flush();
  assert.deepEqual(heard, [{ kind: "response", id: "q1", ok: false, error: { code: "invalid", message: "The request did not pass the parser." } }]);
});

/* ── The external signer and the city's one door ───────────────────────── */

function spyBrowser() {
  const calls = [];
  return {
    calls,
    signer: {
      signTransaction: async (args) => (calls.push(["signTransaction", args]), { ok: true, signedWireBase64: "browser" }),
      signTransactions: async (args) => (calls.push(["signTransactions", args]), { ok: true, signedWireBase64: ["browser"] }),
      signInWithWallet: async (...args) => (calls.push(["signIn", args]), { ok: false, state: "FAILED", reason: "browser" }),
    },
  };
}

test("in the app every signature goes through the bridge, and nothing — not a no, not a timeout — falls back to the browser", async () => {
  const { app, bridge, clock, address, publicKey } = await paired();
  const browser = spyBrowser();
  const city = routeSigner({ app: () => externalSigner(bridge), browser: browser.signer });
  await bridge.request("wallet.connect", {});
  const tx = b64(unsignedTransaction(publicKey).wire);

  const signed = await city.signTransaction({ wallet: "Seed Vault", address, unsignedWireBase64: tx, chain: "solana:mainnet" });
  assert.equal(signed.ok, true);

  app.once("wallet.signTransactions", "decline");
  assert.deepEqual(await city.signTransactions({ wallet: "Seed Vault", address, unsignedWireBase64: [tx], chain: "solana:mainnet" }), { ok: false, reason: "Nothing was signed." });

  app.once("wallet.signTransactions", "busy");
  assert.equal((await city.signTransaction({ wallet: "Seed Vault", address, unsignedWireBase64: tx })).ok, false);

  app.once("wallet.signTransactions", "silent");
  const waiting = city.signTransaction({ wallet: "Seed Vault", address, unsignedWireBase64: tx });
  await flush();
  clock.advance(REQUEST_TIMEOUT_MS);
  assert.equal((await waiting).ok, false);

  // A devnet step (the launch's test run) is refused in the app, never handed to another wallet.
  assert.deepEqual(await city.signTransactions({ wallet: "Seed Vault", address, unsignedWireBase64: [tx], chain: "solana:devnet" }), { ok: false, reason: MAINNET_ONLY });

  // Another wallet's address — a browser wallet taken before the app spoke — is not signed for.
  const other = await city.signTransaction({ wallet: "Phantom", address: ADDRESS, unsignedWireBase64: tx });
  assert.equal(other.ok, false);

  app.once("wallet.signMessage", "decline");
  const signIn = await city.signIn("Seed Vault", { address }, "Sign in to Ryntra");
  assert.equal(signIn.state, "CANCELLED");

  assert.deepEqual(browser.calls, [], "the browser's wallets were never asked");
});

test("in a browser — no bridge, or an app that never said app.ready — the browser's wallets sign, as before", async () => {
  const browser = spyBrowser();
  const city = routeSigner({ app: () => null, browser: browser.signer });
  await city.signTransaction({ wallet: "Phantom", address: ADDRESS, unsignedWireBase64: "AA==", chain: "solana:mainnet" });
  await city.signTransactions({ wallet: "Phantom", address: ADDRESS, unsignedWireBase64: ["AA=="], chain: "solana:devnet" });
  await city.signIn("Phantom", { address: ADDRESS }, "text");
  assert.deepEqual(browser.calls.map(([name]) => name), ["signTransaction", "signTransactions", "signIn"]);
});

test("the external signer answers in Wallet Standard's shapes: a closed wallet is CANCELLED, quiet", async () => {
  const { app, bridge, address } = await paired();
  const signer = externalSigner(bridge);
  app.once("wallet.connect", "decline");
  assert.deepEqual(await signer.connect(), { ok: false, state: "CANCELLED", reason: "" });
  const connected = await signer.connect();
  assert.deepEqual(connected, { ok: true, connection: { wallet: "Seed Vault", address, chains: ["solana:mainnet"] } });
  app.once("wallet.connect", "unsupported");
  assert.equal((await signer.connect()).state, "UNSUPPORTED");
  await signer.disconnect();
  assert.equal(bridge.wallet(), null);
  assert.equal((await signer.signTransaction({ address, unsignedWireBase64: "AA==" })).ok, false, "no wallet, nothing asked");
});

/* ── The page: which window is the app's ───────────────────────────────── */

function fakeWindow({ agent = "Mozilla/5.0 (Linux; Android 14) RyntraApp/1.4.0", native = true } = {}) {
  const posted = [];
  const listeners = { window: new Set(), document: new Set() };
  const win = {
    navigator: { userAgent: agent },
    location: { origin: "https://ryntra.io", search: "" },
    addEventListener: (_type, listener) => listeners.window.add(listener),
    removeEventListener: (_type, listener) => listeners.window.delete(listener),
    document: {
      addEventListener: (_type, listener) => listeners.document.add(listener),
      removeEventListener: (_type, listener) => listeners.document.delete(listener),
    },
    ...(native ? { ReactNativeWebView: { postMessage: (data) => posted.push(data) } } : {}),
  };
  const deliver = (where, data, extra = {}) => {
    for (const listener of listeners[where]) listener({ data, source: null, origin: "", ...extra });
  };
  return { win, posted, deliver, listeners };
}

test("the page is in the app only with both marks: the WebView's object and RyntraApp/ in the user agent", () => {
  assert.equal(looksLikeApp(fakeWindow().win), true);
  assert.equal(looksLikeApp(fakeWindow({ agent: "Mozilla/5.0 Chrome/129" }).win), false);
  assert.equal(looksLikeApp(fakeWindow({ native: false }).win), false);
  assert.equal(looksLikeApp(fakeWindow({ agent: "NotRyntraApp/1" }).win), false);
});

test("the WebView's message is heard on window and document; a frame posting into the page is not the app", async () => {
  const { win, posted, deliver } = fakeWindow();
  assert.equal(fromApp({ source: null, origin: "" }, win), true);
  assert.equal(fromApp({ source: win, origin: "https://ryntra.io" }, win), true);
  assert.equal(fromApp({ source: {}, origin: "https://evil.example" }, win), false);
  assert.equal(fromApp({ source: null, origin: "https://evil.example" }, win), false);

  const bridge = createAppBridge(webViewTransport(win));
  deliver("document", wire({ type: "app.ready", version: "1.4.0", platform: "android", wallet: null }), { source: {}, origin: "https://evil.example" });
  assert.equal(bridge.ready(), null, "a frame cannot say app.ready");
  deliver("document", wire({ type: "app.ready", version: "1.4.0", platform: "android", wallet: null }));
  assert.equal(bridge.ready()?.version, "1.4.0");

  const asked = bridge.request("wallet.connect", {});
  const { id } = JSON.parse(posted[0]);
  const answer = wire({ id, ok: true, result: { address: ADDRESS, name: "Phantom" } });
  deliver("window", answer);
  deliver("document", answer); // the twin is dropped by its id
  assert.deepEqual(await asked, { ok: true, result: { address: ADDRESS, name: "Phantom" } });
  assert.equal(bridge.pending(), 0);
  bridge.close();
});

test("a shared file's name is the app's kind: ASCII, no path, the extension kept", () => {
  assert.equal(shareNameOf("ryntra-bonk.mp4"), "ryntra-bonk.mp4");
  assert.equal(shareNameOf("ryntra-дог.mp4"), "ryntra.mp4");
  assert.equal(shareNameOf("ryntra-$WIF 🚀.webm"), "ryntra-WIF.webm");
  assert.equal(shareNameOf("Café-tower.png"), "Cafe-tower.png");
  assert.equal(shareNameOf("../../etc/passwd"), "etc-passwd");
  assert.equal(shareNameOf("🚀"), "ryntra");
  assert.equal(shareNameOf(`${"a".repeat(120)}.mp4`).length, 80);
  for (const name of ["ryntra-дог.mp4", "..", "$$$.png", `${"я".repeat(90)}.mp4`]) assert.ok(isShareName(shareNameOf(name)), name);
});

test("the page says page.ready once it listens in the WebView, and the app's answer makes it the app", async () => {
  // A page whose code came after the app's first app.ready: it would wait for nothing without its hello.
  assert.equal(isPageReady(encodePageReady()), true);
  assert.equal(isPageReady(wire({ id: "a", type: "page.ready" })), false, "a hello has no id");
  assert.equal(parsePageRequest(encodePageReady()), null, "a hello is not a request");

  const { win, posted, deliver } = fakeWindow();
  const bridge = attachAppBridge(win);
  assert.deepEqual(posted.map((data) => JSON.parse(data)), [{ v: 1, type: "page.ready" }]);
  assert.equal(bridge?.ready(), null);
  deliver("document", wire({ type: "app.ready", version: "1.18.0", platform: "android", wallet: null }));
  assert.equal(bridge?.ready()?.version, "1.18.0");
  detachAppBridge();

  // The fake app answers the hello as the app does; a bridge made without it says nothing first.
  const app = createFakeApp({ secretKey: SEED });
  const quiet = createAppBridge(fakeAppTransport(app));
  await flush();
  assert.equal(quiet.ready(), null);
  const greeting = createAppBridge(fakeAppTransport(app), { hello: true });
  await flush();
  assert.equal(greeting.ready()?.platform, "android");
  assert.equal(app.requests.length, 0, "the hello is not a request");
  quiet.close();
  greeting.close();

  // In a browser nothing is said and nothing is made.
  assert.equal(attachAppBridge(fakeWindow({ native: false }).win), null);
  detachAppBridge();
});
