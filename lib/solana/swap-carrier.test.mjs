/**
 * The carrier of a swap request: the site for a browser, the bearer for the
 * phone (`lib/solana/swap-carrier.ts`, the mobile line's request 13).
 *
 * The decision is met with every outcome the session resolver can hand it —
 * a wallet session, a bearer that is not a reference, a revoked one, an
 * expired one, a store that did not answer — and with the web's three
 * cases: from elsewhere, from this site by `Origin`, from this site by Fetch
 * Metadata. The routes and the server wrapper are pinned by source: each of
 * the four reads its carrier through the one helper, refuses a failed one
 * before the body, binds the bearer's wallet to the wallet it acts for, and
 * keeps no origin check of its own.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decideSwapCarrier, MALFORMED_BEARER, walletMismatch } from "./swap-carrier.ts";

const WALLET = "7Y3cB2ntpYkLM9bcZ5R1o1T3T1jsWFztdp3kuLq6M8Sn";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVL2Jrv6Mm1vV2VuJnwn";
const ORIGIN_REFUSAL = "The swap order request must come from this site.";
const URL_ = "https://ryntra.io/api/solana/swap/order";
const web = (origin = null, secFetchSite = null) => ({ url: URL_, origin, secFetchSite, session: null });
const phone = (session, origin = null) => ({ url: URL_, origin, secFetchSite: null, session });
const walletSession = (address = WALLET) => ({
  ok: true,
  session: { sessionId: "6f1d1a2e-2f3b-4c4d-8e9f-0a1b2c3d4e5f", address, issuedAt: "2026-09-16T12:00:00.000Z", expiresAt: "2026-09-17T12:00:00.000Z" },
  resolved: {},
});

test("a browser keeps the origin check: refused from elsewhere, allowed from this site, no wallet bound", () => {
  assert.deepEqual(decideSwapCarrier(web(), ORIGIN_REFUSAL), { ok: false, status: 403, code: "FORBIDDEN_ORIGIN", message: ORIGIN_REFUSAL });
  const elsewhere = decideSwapCarrier(web("https://evil.example"), ORIGIN_REFUSAL);
  assert.equal(elsewhere.ok, false);
  assert.equal(elsewhere.code, "FORBIDDEN_ORIGIN");
  const byOrigin = decideSwapCarrier(web("https://ryntra.io"), ORIGIN_REFUSAL);
  assert.deepEqual(byOrigin, { ok: true, carrier: "site" });
  assert.deepEqual(decideSwapCarrier(web(null, "same-origin"), ORIGIN_REFUSAL), { ok: true, carrier: "site" });
  assert.equal(decideSwapCarrier(web(null, "cross-site"), ORIGIN_REFUSAL).ok, false);
  /* The site binds no wallet: the signature over the bytes does. */
  assert.equal(walletMismatch(byOrigin, WALLET), false);
  assert.equal(walletMismatch(byOrigin, OTHER), false);
});

test("a wallet session's bearer carries the request without any origin, and binds its wallet", () => {
  const carrier = decideSwapCarrier(phone(walletSession()), ORIGIN_REFUSAL);
  assert.deepEqual(carrier, { ok: true, carrier: "bearer", address: WALLET });
  assert.equal(walletMismatch(carrier, WALLET), false, "the session's own wallet is the taker");
  assert.equal(walletMismatch(carrier, OTHER), true, "another wallet is refused");
});

test("a bearer that fails is refused by its own code and status, and never falls through to the origin check", () => {
  const outcomes = [
    ["UNAUTHORIZED", 401, "The bearer is not a session reference."],
    ["SESSION_EXPIRED", 401, "The session is expired."],
    ["SESSION_REVOKED", 401, "The session was revoked."],
    ["UNAVAILABLE", 503, "The session store did not answer."],
  ];
  for (const [code, status, reason] of outcomes) {
    /* Even from this site: a bearer present decides, a cookie never stands in. */
    for (const origin of [null, "https://ryntra.io"]) {
      const read = decideSwapCarrier(phone({ ok: false, code, reason }, origin), ORIGIN_REFUSAL);
      assert.deepEqual(read, { ok: false, status, code, message: reason }, `${code} from ${origin ?? "nowhere"}`);
    }
  }
});

test("the four swap routes read their carrier through the one helper and bind the bearer's wallet", () => {
  const routes = {
    order: ["app/api/solana/swap/order/route.ts", "input.taker"],
    execute: ["app/api/solana/swap/execute/route.ts", "bundle.taker"],
    cancelReview: ["app/api/solana/swap/cancel-review/route.ts", "parsed.data.owner"],
    recover: ["app/api/solana/swap/recover/route.ts", "parsed.data.owner"],
  };
  for (const [name, [path, wallet]] of Object.entries(routes)) {
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.match(source, /from "@\/lib\/solana\/swap-carrier\.server"/, `${name} imports the server wrapper`);
    const gate = source.indexOf("const carrier = await readSwapCarrier(request, \"");
    assert.ok(gate > 0, `${name} reads its carrier through the helper`);
    assert.ok(source.indexOf("if (!carrier.ok) return ") > gate, `${name} refuses a failed carrier`);
    assert.ok(source.indexOf("readAgentControlJson(request)") > gate, `${name} reads its carrier before the body`);
    assert.ok(source.includes(`walletMismatch(carrier, ${wallet})`), `${name} binds the bearer's wallet to ${wallet}`);
    assert.match(source, /"WALLET_MISMATCH"/, `${name} names the refusal`);
    assert.doesNotMatch(source, /mutationOriginAllowed/, `${name} has no origin check of its own: the helper decides`);
  }
  const server = readFileSync(new URL("./swap-carrier.server.ts", import.meta.url), "utf8");
  assert.match(server, /bearerToken\(request\.headers\)\s*\? await resolveNativeSession\(request\.headers\)\s*: request\.headers\.get\("authorization"\) !== null\s*\? MALFORMED_BEARER\s*: null/, "a bearer present is resolved, a malformed one refused as one (1.22.0), a request without one is the web's");
  const decision = readFileSync(new URL("./swap-carrier.ts", import.meta.url), "utf8");
  assert.match(decision, /if \(request\.session\) \{[\s\S]*?if \(!session\.ok\) return \{ ok: false/, "a failing bearer never falls through");
  assert.match(decision, /mutationOriginAllowed\(request\.url, request\.origin, request\.secFetchSite\)/, "the web keeps its origin check");
});

test("1.22.0: an Authorization header that is no bearer is refused as a native request (401), never sent to the origin check", () => {
  const decided = decideSwapCarrier(phone(MALFORMED_BEARER, "https://ryntra.io"), ORIGIN_REFUSAL);
  assert.deepEqual(decided, { ok: false, status: 401, code: "UNAUTHORIZED", message: MALFORMED_BEARER.reason });
  const server = readFileSync(new URL("./swap-carrier.server.ts", import.meta.url), "utf8");
  assert.match(server, /request\.headers\.get\("authorization"\) !== null\s*\? MALFORMED_BEARER/);
});
