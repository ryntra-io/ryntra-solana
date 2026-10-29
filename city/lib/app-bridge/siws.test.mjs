import { test } from "node:test";
import assert from "node:assert/strict";

import { attachAppBridge } from "./page.ts";
import { createFakeApp, fakeAppTransport } from "./mock.ts";
import { proveWallet } from "../trade/proof.ts";
import { resetWalletFactForTests, walletFact } from "../../../lib/account/wallet-proof-store.client.ts";
import { buildSiwsInput, siwsMessageText, verifySiws } from "../../../lib/auth/siws.ts";

// CITY-6b: Ryntra's Sign In With Solana from the city in the app. The server's own builder writes the message and its
// own verifier checks the signature (`lib/auth/siws.ts`, as `/api/auth/solana` uses them); between the two, the
// city's `proveWallet` hands the exact bytes to a fake app's wallet through the bridge. Only `fetch` is a stub.

const DOMAIN = "ryntra.io";
const URI = "https://ryntra.io";

const app = createFakeApp({ secretKey: new Uint8Array(32).fill(3), name: "Seed Vault", connected: true });
attachAppBridge({ addEventListener() {}, removeEventListener() {} }, { transport: fakeAppTransport(app) });
await app.ready();
const ADDRESS = await app.address();

/** The two routes of `/api/auth/solana` and the session read, over the server's own SIWS functions. */
function server() {
  resetWalletFactForTests();
  const issued = new Map();
  const posts = [];
  let nonce = 0;
  const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url);
    if (path.startsWith("/api/auth/solana/session")) return json({ signedIn: false, walletAddress: null, proof: null, at: 1 });
    if (path.startsWith("/api/auth/solana?") && (init.method ?? "GET") === "GET") {
      const query = new URLSearchParams(path.split("?")[1]);
      const input = buildSiwsInput({ domain: DOMAIN, uri: URI, address: query.get("address"), nonce: `nonce${++nonce}abcdef`, now: Date.now(), action: query.get("action"), locale: "en" });
      issued.set(input.nonce, input);
      return json({ input, message: siwsMessageText(input) });
    }
    if (path === "/api/auth/solana" && init.method === "POST") {
      const body = JSON.parse(init.body);
      posts.push(body);
      const signedMessage = new Uint8Array(Buffer.from(body.signedMessage, "base64"));
      const nonceInText = /Nonce: (\S+)/.exec(new TextDecoder().decode(signedMessage))?.[1];
      const expected = issued.get(nonceInText);
      if (!expected) return json({ ok: false }, 400);
      const verdict = await verifySiws({
        signedMessage,
        signature: new Uint8Array(Buffer.from(body.signature, "base64")),
        expected: { domain: DOMAIN, uri: URI, nonce: expected.nonce, address: body.address, action: body.action, locale: "en" },
        now: Date.now(),
      });
      return verdict.ok ? json({ ok: true, expiresAt: "2026-10-28T00:00:00.000Z" }) : json({ ok: false, reason: verdict.reason }, 401);
    }
    throw new Error(`unexpected ${path}`);
  };
  return { posts };
}

test("sign-in in the app: the server's text, signed byte for byte by the app's wallet, passes the server's check", async () => {
  const { posts } = server();
  const outcome = await proveWallet({ wallet: "Seed Vault", address: ADDRESS }, { signIn: true });
  assert.deepEqual(outcome, { ok: true });

  const asked = app.requests.filter((request) => request.type === "wallet.signMessage");
  assert.equal(asked.length, 1, "one message, no transaction");
  assert.equal(app.requests.some((request) => request.type === "wallet.signTransactions"), false);
  const text = Buffer.from(asked[0].message, "base64").toString("utf8");
  assert.match(text, /^ryntra\.io wants you to sign in with your Solana account:/);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].action, "signin");
  assert.equal(posts[0].address, ADDRESS);
  assert.equal(Buffer.from(posts[0].signedMessage, "base64").toString("utf8"), text, "the server gets back its own text");
  assert.equal(walletFact().signedIn, true);
  assert.equal(walletFact().walletAddress, ADDRESS);
});

test("a no in the app's wallet signs nothing and posts nothing", async () => {
  const { posts } = server();
  app.once("wallet.signMessage", "decline");
  const outcome = await proveWallet({ wallet: "Seed Vault", address: ADDRESS }, { signIn: true });
  assert.deepEqual(outcome, { ok: false, state: "declined", message: "Nothing was signed." });
  assert.equal(posts.length, 0);
});
