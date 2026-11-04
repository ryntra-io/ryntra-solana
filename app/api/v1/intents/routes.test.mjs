/*
 * `/api/v1/intents` end to end through the route files themselves (CITY-161), on the stand's memory store
 * (`RYNTRA_INTENTS=memory`): an agent prepares a transfer with no wallet and no key, the person's city reads it,
 * claims it from Ryntra's own origin, sends the receipt, and the agent reads the signature back; the link never opens a
 * second time. Each route only hands the request to `lib/intents` (tested step by step in `lib/intents/*.test.mjs`).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/* The routes load as Next loads them: `@/…` from the repository root, relative imports without an extension, and
   `next/server` (which Node's ESM resolver needs as `next/server.js`). */
const ROOT = new URL("../../../../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const candidates = [];
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), ROOT).href;
      candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`);
    } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      candidates.push(base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`);
    } else {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith("node:") && specifier.includes("/") && !/\.[cm]?js$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
        throw error;
      }
    }
    for (const candidate of candidates) {
      const path = fileURLToPath(candidate);
      if (existsSync(path) && !statSync(path).isDirectory()) return nextResolve(candidate, context);
    }
    return nextResolve(specifier, context);
  },
});

process.env.RYNTRA_INTENTS = "memory";
process.env.RYNTRA_PUBLIC_ORIGIN = "https://ryntra.io";
// The transfer flows below run where the owner opened transfers; the closed default has its own test.
process.env.RYNTRA_INTENTS_TRANSFER = "open";
delete process.env.VERCEL;

const create = await import("./route.ts");
const one = await import("./[id]/route.ts");
const claim = await import("./[id]/claim/route.ts");
const release = await import("./[id]/release/route.ts");
const receipt = await import("./[id]/receipt/route.ts");
const qr = await import("./[id]/qr/route.ts");
const signed = await import("./[id]/signed/route.ts");
const { signWire, STRANGER_PRIVATE_KEY_PKCS8 } = await import("../../solana/swap/golden/fixtures.mjs");
const golden = JSON.parse(readFileSync(new URL("../../solana/swap/golden/transcripts.json", import.meta.url), "utf8"));
/** The wallet's signed bytes: the golden order, signed by its taker (PERSON) with the transcripts' test-only key. */
const ORDER_WIRE = golden["order: SOL to USDT with the verified referral fee is a signable Review"].steps.at(-1).body.order.transactionBase64;
const SIGNED_WIRE = signWire(ORDER_WIRE).wire;
const cancel = await import("./[id]/cancel/route.ts");

const SITE = "https://ryntra.io";
const FRIEND = "7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs";
const PERSON = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** The signature the chain names for those bytes. */
const SIG = golden["execute: exact bytes through Jupiter settle MATCHED with a Receipt"].steps.at(-1).body.signature;

let ip = 0;
/** Each test from its own address, so the windows of one never spend another's. */
const from = () => `203.0.113.${++ip}`;

function post(path, body, { origin = null, addr = from() } = {}) {
  const headers = { "content-type": "application/json", "x-forwarded-for": addr, "x-ryntra-api": "1" };
  if (origin) headers.origin = origin;
  return new Request(`${SITE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
const get = (path, addr = from(), key = null) => new Request(`${SITE}${path}`, { headers: { "x-forwarded-for": addr, "x-ryntra-api": "1", ...(key ? { "x-ryntra-intent-key": key } : {}) } });
const params = (id) => ({ params: Promise.resolve({ id }) });
const json = async (response) => ({ status: response.status, body: await response.json() });

const transfer = (more = {}) => ({ action: "transfer", coin: USDC, amountRaw: "25000000", to: FRIEND, origin: { kind: "agent", name: "Atlas" }, ...more });

async function prepared(body = transfer()) {
  const made = await json(await create.POST(post("/api/v1/intents", body)));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.match(made.body.creatorKey, /^[A-Za-z0-9_-]{32}$/);
  return Object.assign(made.body.intent, { creatorKey: made.body.creatorKey });
}

test("an agent prepares, the person signs in their own wallet, the agent reads the receipt — and the link never opens again", async () => {
  const intent = await prepared();
  assert.equal(intent.status, "OPEN");
  assert.deepEqual(intent.spec, { action: "transfer", coin: USDC, amountRaw: "25000000", to: FRIEND });
  assert.deepEqual(intent.origin, { kind: "agent", name: "Atlas", verified: false });
  assert.deepEqual(intent.links, { url: `${SITE}/i/${intent.id}`, qr: `${SITE}/api/v1/intents/${intent.id}/qr` });

  const read = await json(await one.GET(get(`/api/v1/intents/${intent.id}`), params(intent.id)));
  assert.equal(read.status, 200);
  assert.equal(read.body.intent.digest, intent.digest);

  const step = { digest: intent.digest, wallet: PERSON };
  // Another site cannot take the person's step.
  for (const origin of [null, "https://evil.example"]) {
    const refused = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, step, { origin }), params(intent.id)));
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, "FORBIDDEN");
  }
  const claimed = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, step, { origin: SITE }), params(intent.id)));
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.intent.status, "CLAIMED");
  assert.ok(claimed.body.intent.claimedUntil);
  assert.equal(claimed.body.intent.sentSignature, null);

  // Before the bytes may leave, the wallet's signed bytes mark the claim — checked by their ed25519 signature.
  const forged = await json(await signed.POST(post(`/api/v1/intents/${intent.id}/signed`, { ...step, signedWireBase64: ORDER_WIRE }, { origin: SITE }), params(intent.id)));
  assert.equal(forged.status, 422);
  assert.equal(forged.body.error.code, "INTENT_SIGNATURE_INVALID");
  const strangers = await json(await signed.POST(post(`/api/v1/intents/${intent.id}/signed`, { ...step, signedWireBase64: signWire(ORDER_WIRE, STRANGER_PRIVATE_KEY_PKCS8).wire }, { origin: SITE }), params(intent.id)));
  assert.equal(strangers.body.error.code, "INTENT_SIGNATURE_INVALID");
  const marked = await json(await signed.POST(post(`/api/v1/intents/${intent.id}/signed`, { ...step, signedWireBase64: SIGNED_WIRE }, { origin: SITE }), params(intent.id)));
  assert.equal(marked.status, 200, JSON.stringify(marked.body));
  assert.equal(marked.body.intent.sentSignature, SIG);
  // From here the claim is never let go; the same wallet pressing again is told to read the signature back.
  const letGo = await json(await release.POST(post(`/api/v1/intents/${intent.id}/release`, step, { origin: SITE }), params(intent.id)));
  assert.equal(letGo.status, 409);
  assert.equal(letGo.body.error.code, "INTENT_SENT");
  const again = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, step, { origin: SITE }), params(intent.id)));
  assert.equal(again.body.intent.sentSignature, SIG);
  // A stranger's read never carries the mark.
  assert.equal((await json(await one.GET(get(`/api/v1/intents/${intent.id}`), params(intent.id)))).body.intent.sentSignature, null);

  const done = await json(await receipt.POST(post(`/api/v1/intents/${intent.id}/receipt`, { ...step, signature: SIG }, { origin: SITE }), params(intent.id)));
  assert.equal(done.status, 200);
  assert.equal(done.body.intent.status, "DONE");
  assert.deepEqual({ ...done.body.intent.receipt, at: undefined }, { wallet: PERSON, signature: SIG, at: undefined, chain: "UNCHECKED" });

  // Anyone with the link sees where it stands; the agent that made it reads the signature with its key.
  const stranger = await json(await one.GET(get(`/api/v1/intents/${intent.id}`), params(intent.id)));
  assert.equal(stranger.body.intent.status, "DONE");
  assert.equal(stranger.body.intent.receipt, null);
  const agent = await json(await one.GET(get(`/api/v1/intents/${intent.id}`, from(), intent.creatorKey), params(intent.id)));
  assert.equal(agent.body.intent.status, "DONE");
  assert.equal(agent.body.intent.receipt.signature, SIG);

  for (const wallet of [PERSON, OTHER]) {
    const again = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, { ...step, wallet }, { origin: SITE }), params(intent.id)));
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "INTENT_USED");
  }
});

test("the wallet said no: the claim is let go and another wallet may take it", async () => {
  const intent = await prepared();
  const step = { digest: intent.digest, wallet: PERSON };
  await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, step, { origin: SITE }), params(intent.id));
  const busy = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, { ...step, wallet: OTHER }, { origin: SITE }), params(intent.id)));
  assert.equal(busy.body.error.code, "INTENT_BUSY");
  const let_go = await json(await release.POST(post(`/api/v1/intents/${intent.id}/release`, step, { origin: SITE }), params(intent.id)));
  assert.equal(let_go.body.intent.status, "OPEN");
  const taken = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, { ...step, wallet: OTHER }, { origin: SITE }), params(intent.id)));
  assert.equal(taken.body.intent.status, "CLAIMED");
});

test("a step that names another digest changes nothing", async () => {
  const intent = await prepared();
  const changed = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, { digest: "f".repeat(64), wallet: PERSON }, { origin: SITE }), params(intent.id)));
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, "INTENT_CHANGED");
  assert.equal((await json(await one.GET(get(`/api/v1/intents/${intent.id}`), params(intent.id)))).body.intent.status, "OPEN");
});

test("no free text and no address to send anyone to: a transaction, a message, a memo or a link is refused", async () => {
  for (const extra of [{ transaction: "AQAB" }, { message: "Urgent: confirm now" }, { memo: "x" }, { url: "https://evil.example" }, { redirect: "https://evil.example" }, { callbackUrl: "https://evil.example" }]) {
    const refused = await json(await create.POST(post("/api/v1/intents", transfer(extra))));
    assert.equal(refused.status, 400, JSON.stringify(extra));
    assert.equal(refused.body.error.code, "VALIDATION_ERROR");
  }
  const named = await json(await create.POST(post("/api/v1/intents", transfer({ origin: { kind: "partner", name: "Ryntra Support" } }))));
  assert.equal(named.status, 422);
  assert.equal(named.body.error.code, "INTENT_ORIGIN_REFUSED");
  const linked = await json(await create.POST(post("/api/v1/intents", transfer({ origin: { kind: "chat", name: "https://evil.example" } }))));
  assert.equal(linked.body.error.code, "VALIDATION_ERROR");
});

test("a swap defaults to SOL and a fifteen-minute deadline; an unknown id is not found", async () => {
  const intent = await prepared({ action: "swap", coin: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", side: "buy", amountRaw: "100000000", origin: { kind: "chat", name: "Atlas" } });
  assert.equal(intent.spec.pay, "SOL");
  assert.equal(Date.parse(intent.expiresAt) - Date.parse(intent.createdAt), 900_000);
  const missing = await json(await one.GET(get("/api/v1/intents/AAAAAAAAAAAAAAAAAAAAAA"), params("AAAAAAAAAAAAAAAAAAAAAA")));
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "INTENT_NOT_FOUND");
});

test("the QR encodes only Ryntra's own link", async () => {
  const intent = await prepared();
  const answer = await qr.GET(get(`/api/v1/intents/${intent.id}/qr`), params(intent.id));
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await answer.text(), /^<svg/);
});

test("an agent's burst is bounded per address", async () => {
  const addr = from();
  let limited = null;
  for (let i = 0; i < 31; i += 1) {
    const answer = await create.POST(post("/api/v1/intents", transfer(), { addr }));
    if (answer.status === 429) limited = i;
  }
  assert.equal(limited, 30);
});

test("phase 1: a transfer prepared from outside is closed by default; a swap is not", async () => {
  process.env.RYNTRA_INTENTS_TRANSFER = "";
  try {
    const closed = await json(await create.POST(post("/api/v1/intents", transfer())));
    assert.equal(closed.status, 422);
    assert.equal(closed.body.error.code, "INTENT_ACTION_CLOSED");
    const swap = await json(await create.POST(post("/api/v1/intents", { action: "swap", coin: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", side: "buy", amountRaw: "100000000", origin: { kind: "agent", name: "Atlas" } })));
    assert.equal(swap.status, 201);
  } finally {
    process.env.RYNTRA_INTENTS_TRANSFER = "open";
  }
});

test("a bound intent opened by another wallet is refused; its creator withdraws it with the key", async () => {
  const intent = await prepared(transfer({ for: PERSON }));
  assert.equal(intent.for, PERSON);
  const foreign = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, { digest: intent.digest, wallet: OTHER }, { origin: SITE }), params(intent.id)));
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.code, "INTENT_WRONG_WALLET");
  const keyless = await json(await cancel.POST(post(`/api/v1/intents/${intent.id}/cancel`, {}), params(intent.id)));
  assert.equal(keyless.body.error.code, "INTENT_KEY_INVALID");
  const withdraw = new Request(`${SITE}/api/v1/intents/${intent.id}/cancel`, { method: "POST", headers: { "x-forwarded-for": from(), "x-ryntra-intent-key": intent.creatorKey } });
  const done = await json(await cancel.POST(withdraw, params(intent.id)));
  assert.equal(done.body.intent.status, "CANCELLED");
  const after = await json(await claim.POST(post(`/api/v1/intents/${intent.id}/claim`, { digest: intent.digest, wallet: PERSON }, { origin: SITE }), params(intent.id)));
  assert.equal(after.status, 410);
  assert.equal(after.body.error.code, "INTENT_CANCELLED");
});

test("closed where the deployment does not say so", async () => {
  process.env.RYNTRA_INTENTS = "";
  try {
    const closed = await json(await create.POST(post("/api/v1/intents", transfer())));
    assert.equal(closed.status, 503);
    assert.equal(closed.body.error.code, "CAPABILITY_UNAVAILABLE");
  } finally {
    process.env.RYNTRA_INTENTS = "memory";
  }
  // Memory is a single-instance stand only: behind several instances it is refused rather than half-working.
  process.env.VERCEL = "1";
  try {
    assert.equal((await create.POST(post("/api/v1/intents", transfer()))).status, 503);
  } finally {
    delete process.env.VERCEL;
  }
});

test("each route runs on node, is never cached, and hands the request to lib/intents", () => {
  for (const file of ["route.ts", "[id]/route.ts", "[id]/claim/route.ts", "[id]/signed/route.ts", "[id]/release/route.ts", "[id]/receipt/route.ts", "[id]/qr/route.ts", "[id]/cancel/route.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /export const runtime = "nodejs";/, file);
    assert.match(source, /export const dynamic = "force-dynamic";/, file);
    assert.match(source, /intentsOrRefusal\(\)/, file);
  }
  for (const file of ["[id]/claim/route.ts", "[id]/signed/route.ts", "[id]/release/route.ts", "[id]/receipt/route.ts"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /sameSiteOrRefusal\(request\)/, file);
  }
});
