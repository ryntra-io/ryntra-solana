import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { askedSum, buildStop, costsOf, isView, noteOf, payRequest, readRequest, shownStatus, signStop, sol, stillOpen, submitStop, typedAmount } from "./flow.ts";
import { PAY } from "./words.ts";

/* CITY-156: the payer's page as a window of the city. The rules are pure and run here as they are; the payment runs
   end to end against a stub engine and a stub wallet — the same routes, bodies and order the page uses, nothing sent
   anywhere. The live pass with a real wallet on mainnet is the owner's canary. */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PYUSD = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const RECIPIENT = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
const PAYER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SIGNATURE = "3vZ8sRkd2kN9mEJcVJbW7K1yC6p8oQGJ4fH2Lr9aT5XqBnU8wYeD3sP6mZ1cR4tV7hK9jN2gF5xL8bQ3dW6eA1s";

function request(overrides = {}) {
  return {
    id: "pay_7Hq2Lr9aT5XqBnU8",
    network: "mainnet",
    status: "AWAITING",
    note: null,
    token: { symbol: "USDC", mint: USDC, decimals: 6 },
    amount: { raw: "25000000", display: "25" },
    description: "Design work",
    recipient: { abbreviated: "4EeX…KGW", address: RECIPIENT },
    reference: "Ref1111111111111111111111111111111111111111",
    createdAt: "2026-10-31T10:00:00.000Z",
    expiresAt: "2026-11-01T10:00:00.000Z",
    paid: null,
    received: null,
    ...overrides,
  };
}

const view = (overrides) => ({ request: request(overrides), payUrl: `solana:${RECIPIENT}?amount=25` });

/** A stub of the engine's three routes, keeping every call as the page made it. */
function engine(answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const next = answers.shift();
    if (!next) throw new Error(`no answer for ${url}`);
    if (next === "throw") throw new TypeError("network");
    return { ok: next.status < 400, status: next.status, json: async () => next.body };
  };
  return { fetch, calls };
}

const built = (signableMs = 25_000) => ({ status: 200, body: { data: { intentId: "intent_abc12345", unsignedWireBase64: "AQAB", signableMs } } });

test("the status the window says: the engine's, and «on its way» for a payment this page sent", () => {
  assert.equal(shownStatus("AWAITING", false), "awaiting");
  assert.equal(shownStatus("AWAITING", true), "pending");
  assert.equal(shownStatus("PAID", true), "paid", "paid wins over this page's own record");
  assert.equal(shownStatus("EXPIRED", false), "expired");
  assert.equal(shownStatus("CHECKING", false), "checking");
  assert.equal(shownStatus("UNKNOWN", false), "checking");
  assert.equal(stillOpen("AWAITING"), true);
  assert.equal(stillOpen("CHECKING"), true);
  assert.equal(stillOpen("PAID"), false);
  assert.equal(stillOpen("EXPIRED"), false);
});

test("the costs before the wallet: the network's floor, no Ryntra fee, a coin's account — exact for USDC, a floor for others", () => {
  assert.equal(sol(5_000n), "0.000005");
  assert.equal(sol(2_039_280n), "0.00203928");
  assert.equal(sol(1_000_000_000n), "1");
  assert.deepEqual(costsOf({ mint: null }), { networkSol: "0.000005", opensAccount: false, classic: false, accountSol: "0.00203928" });
  assert.deepEqual(costsOf({ mint: USDC }), { networkSol: "0.000005", opensAccount: true, classic: true, accountSol: "0.00203928" });
  assert.equal(costsOf({ mint: PYUSD }).classic, false, "a Token-2022 coin's account is larger and it may keep a fee");
});

test("the sum: asked, or typed by the payer — a comma is a point, never rounded", () => {
  assert.equal(askedSum(request()), "25 USDC");
  const open = request({ amount: null });
  assert.equal(askedSum(open), null);
  assert.deepEqual(typedAmount(request(), "ignored"), { ok: true, raw: "25000000", text: null });
  assert.deepEqual(typedAmount(open, "12,5"), { ok: true, raw: "12500000", text: "12.5" });
  assert.deepEqual(typedAmount(open, " 0.75 "), { ok: true, raw: "750000", text: "0.75" });
  assert.deepEqual(typedAmount(open, ".5"), { ok: true, raw: "500000", text: "0.5" });
  assert.deepEqual(typedAmount(open, ""), { ok: false, why: "empty" });
  assert.deepEqual(typedAmount(open, "0"), { ok: false, why: "empty" });
  assert.deepEqual(typedAmount(open, "0.000"), { ok: false, why: "empty" });
  assert.deepEqual(typedAmount(open, "1.1234567"), { ok: false, why: "invalid" }, "more decimals than the coin has is refused, not rounded");
});

test("the one line when what arrived is not what was asked", () => {
  assert.equal(noteOf(request()), null);
  assert.deepEqual(noteOf(request({ note: "WRONG_TOKEN" })), { kind: "wrongCoin" });
  assert.deepEqual(noteOf(request({ note: "UNDERPAID", received: { raw: "20000000", feeWithheldRaw: null } })), { kind: "short", received: "20 USDC", amount: "25 USDC", fee: null });
  assert.deepEqual(
    noteOf(request({ note: "UNDERPAID", received: { raw: "24990000", feeWithheldRaw: "10000" } })),
    { kind: "short", received: "24.99 USDC", amount: "25 USDC", fee: "0.01 USDC" },
    "only the coin's own fee stood between: it says so",
  );
  assert.deepEqual(noteOf(request({ note: "OVERPAID", received: { raw: "30000000", feeWithheldRaw: null } })), { kind: "more", received: "30 USDC" });
  assert.deepEqual(noteOf(request({ amount: null, note: "OVERPAID", received: { raw: "30000000", feeWithheldRaw: null } })), { kind: "total", received: "30 USDC" });
});

test("a test payment, end to end: built inside the press, signed by the wallet, sent once, then on its way", async () => {
  const stub = engine([built(), { status: 200, body: { data: { signature: SIGNATURE, view: view({}) } } }]);
  const phases = [];
  const signed = [];
  const outcome = await payRequest(
    { fetch: stub.fetch, sign: async (wire) => (signed.push(wire), { ok: true, signedWireBase64: "SIGNED" }), onPhase: (p) => phases.push(p) },
    { id: "pay_7Hq2Lr9aT5XqBnU8", payer: PAYER, amount: null },
  );
  assert.equal(outcome.kind, "sent");
  assert.equal(outcome.signature, SIGNATURE);
  assert.ok(outcome.view && outcome.view.request.id === "pay_7Hq2Lr9aT5XqBnU8");
  assert.deepEqual(phases, ["preparing", "wallet", "sending"]);
  assert.deepEqual(signed, ["AQAB"], "the wallet signed the engine's exact bytes");
  assert.deepEqual(stub.calls, [
    { url: "/api/pay/pay_7Hq2Lr9aT5XqBnU8/transaction", method: "POST", body: { payer: PAYER, amount: null } },
    { url: "/api/pay/pay_7Hq2Lr9aT5XqBnU8/submit", method: "POST", body: { intentId: "intent_abc12345", signedWireBase64: "SIGNED" } },
  ]);
});

test("an open request carries the typed amount to the engine, as the engine reads it", async () => {
  const stub = engine([built(), { status: 200, body: { data: { signature: SIGNATURE, view: null } } }]);
  await payRequest({ fetch: stub.fetch, sign: async () => ({ ok: true, signedWireBase64: "SIGNED" }) }, { id: "pay_open", payer: PAYER, amount: "12.5" });
  assert.deepEqual(stub.calls[0].body, { payer: PAYER, amount: "12.5" });
});

test("bytes that aged in the wallet are never sent: built once more and the wallet asked again", async () => {
  let clock = 0;
  const stub = engine([built(12_000), built(25_000), { status: 200, body: { data: { signature: SIGNATURE, view: null } } }]);
  let asked = 0;
  const outcome = await payRequest(
    {
      fetch: stub.fetch,
      now: () => clock,
      sign: async () => {
        asked += 1;
        if (asked === 1) clock += 15_000; // the person took fifteen seconds over bytes that had twelve left
        return { ok: true, signedWireBase64: `SIGNED-${asked}` };
      },
    },
    { id: "pay_slow", payer: PAYER, amount: null },
  );
  assert.equal(outcome.kind, "sent");
  assert.equal(asked, 2);
  assert.deepEqual(stub.calls.map((c) => c.url), ["/api/pay/pay_slow/transaction", "/api/pay/pay_slow/transaction", "/api/pay/pay_slow/submit"]);
  assert.equal(stub.calls[2].body.signedWireBase64, "SIGNED-2", "only the fresh signature goes out");
});

test("a refusal stops the payment with nothing sent, in the window's words", async () => {
  const run = async (answers, sign = async () => ({ ok: true, signedWireBase64: "SIGNED" })) => {
    const stub = engine(answers);
    const outcome = await payRequest({ fetch: stub.fetch, sign }, { id: "pay_x", payer: PAYER, amount: null });
    return { outcome, calls: stub.calls };
  };
  const self = await run([{ status: 422, body: { error: { code: "SELF_PAYMENT", message: "…" } } }]);
  assert.deepEqual(self.outcome, { kind: "stopped", stop: "self" });
  assert.equal(self.calls.length, 1, "nothing was signed or sent");
  assert.deepEqual((await run([{ status: 409, body: { error: { code: "ALREADY_PAID" } } }])).outcome, { kind: "stopped", stop: "paid" });
  assert.deepEqual((await run([{ status: 410, body: { error: { code: "EXPIRED" } } }])).outcome, { kind: "stopped", stop: "ended" });
  assert.deepEqual((await run([{ status: 409, body: { error: { code: "PAYMENT_PENDING" } } }])).outcome, { kind: "stopped", stop: "onItsWay" });
  assert.deepEqual((await run([{ status: 422, body: { error: { code: "SIMULATION_FAILED" } } }])).outcome, { kind: "stopped", stop: "network" });
  assert.deepEqual((await run(["throw"])).outcome, { kind: "stopped", stop: "failed" });
  const refused = await run([built()], async () => ({ ok: false, reason: "User rejected the request." }));
  assert.deepEqual(refused.outcome, { kind: "stopped", stop: "refused" });
  assert.equal(refused.calls.length, 1, "a wallet's «no» sends nothing");
  assert.deepEqual((await run([built()], async () => ({ ok: false, reason: "Wallet locked" }))).outcome, { kind: "stopped", stop: "wallet" });
  assert.deepEqual((await run([built(), { status: 409, body: { error: { code: "BYTES_MISMATCH" } } }])).outcome, { kind: "stopped", stop: "changed" });
  assert.deepEqual((await run([built(), { status: 410, body: { error: { code: "INTENT_EXPIRED" } } }])).outcome, { kind: "stopped", stop: "aged" });
  assert.deepEqual((await run([built(), { status: 502, body: { error: { code: "SUBMIT_FAILED" } } }])).outcome, { kind: "stopped", stop: "failed" });
});

test("a submit whose answer was lost is never signed or sent again: the status read settles it", async () => {
  const lost = engine([built(), "throw"]);
  let signs = 0;
  const outcome = await payRequest({ fetch: lost.fetch, sign: async () => (signs++, { ok: true, signedWireBase64: "SIGNED" }) }, { id: "pay_lost", payer: PAYER, amount: null });
  assert.deepEqual(outcome, { kind: "stopped", stop: "unclear" });
  assert.equal(signs, 1);
  assert.equal(lost.calls.length, 2);
  const gateway = engine([built(), { status: 504, body: null }]);
  assert.deepEqual(await payRequest({ fetch: gateway.fetch, sign: async () => ({ ok: true, signedWireBase64: "SIGNED" }) }, { id: "pay_gw", payer: PAYER, amount: null }), { kind: "stopped", stop: "unclear" });
  /* The engine already took these bytes: that payment is the one on its way. */
  const again = engine([built(), { status: 409, body: { error: { code: "ALREADY_SUBMITTED", signature: SIGNATURE } } }]);
  assert.deepEqual(await payRequest({ fetch: again.fetch, sign: async () => ({ ok: true, signedWireBase64: "SIGNED" }) }, { id: "pay_again", payer: PAYER, amount: null }), { kind: "sent", signature: SIGNATURE, view: null });
});

test("the stops map every engine code the page can meet", () => {
  assert.equal(buildStop("AMOUNT_REQUIRED"), "needAmount");
  assert.equal(buildStop("AMOUNT_INVALID"), "badAmount");
  assert.equal(buildStop("UNAVAILABLE"), "paused");
  assert.equal(buildStop("RATE_LIMITED"), "failed");
  assert.equal(buildStop(null), "failed");
  assert.equal(signStop("Request declined"), "refused");
  assert.equal(signStop("cancelled by user"), "refused");
  assert.equal(submitStop("SIGNATURE_MISSING"), "changed");
  assert.equal(submitStop("UNAVAILABLE"), "paused");
  /* Every stop has its words in both languages. */
  const page = readFileSync(join(ROOT, "city/components/pay/PayerPage.tsx"), "utf8");
  const table = page.slice(page.indexOf("const STOP_WORD"), page.indexOf("};", page.indexOf("const STOP_WORD")));
  for (const [, , key] of table.matchAll(/^\s+(\w+): '(\w+)',$/gm)) {
    assert.equal(typeof PAY.en[key], "string", `en.${key}`);
    assert.equal(typeof PAY.uk[key], "string", `uk.${key}`);
  }
  assert.equal([...table.matchAll(/^\s+(\w+): '(\w+)',$/gm)].length, 14, "fourteen stops, fourteen lines");
});

test("the status read: the engine's public view, a link that is gone, or nothing new", async () => {
  const ok = engine([{ status: 200, body: { data: view({ status: "PAID" }) } }]);
  const read = await readRequest(ok.fetch, "pay_7Hq2Lr9aT5XqBnU8");
  assert.equal(read.request.status, "PAID");
  assert.deepEqual(ok.calls, [{ url: "/api/pay/pay_7Hq2Lr9aT5XqBnU8", method: "GET", body: null }]);
  assert.equal(await readRequest(engine([{ status: 404, body: {} }]).fetch, "x"), "gone");
  assert.equal(await readRequest(engine([{ status: 429, body: {} }]).fetch, "x"), null, "a busy engine keeps what the page last knew");
  assert.equal(await readRequest(engine(["throw"]).fetch, "x"), null);
  assert.equal(isView({ request: { id: "x" } }), false);
});

/* ------------------------------------------------------------------ *
 * The page: the city's, with nothing of the old face
 * ------------------------------------------------------------------ */

const SPECIFIER = /(?:from\s+|import\s+|import\(\s*)["']([^"']+)["']/g;
const EXTENSIONS = ["", ".tsx", ".ts", ".css", "/index.tsx", "/index.ts"];
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
/* A type-only import is erased from the build: it reaches no module at run time. */
const values = (source) => strip(source).replace(/^import type [^;]*;/gm, " ");

function resolveImport(from, specifier) {
  const base = specifier.startsWith("@/") ? join(ROOT, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(join(ROOT, from)), specifier) : null;
  if (!base) return specifier;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && !candidate.endsWith("/")) {
      try {
        readFileSync(candidate);
        return relative(ROOT, candidate).split("\\").join("/");
      } catch {
        /* a directory */
      }
    }
  }
  return null;
}

/** Every module a route reaches: local files by path, packages by name. */
function reach(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    if (!/\.(tsx|ts)$/.test(path) || !existsSync(join(ROOT, path))) continue;
    for (const [, specifier] of values(readFileSync(join(ROOT, path), "utf8")).matchAll(SPECIFIER)) {
      const next = resolveImport(path, specifier);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

test("/pay/<id> and its «not found» are the city's: no shell, lockup, tile or style of the old face is reached", () => {
  for (const route of ["app/pay/[id]/page.tsx", "app/pay/[id]/not-found.tsx"]) {
    const reached = [...reach(route)];
    const old = reached.filter((path) => /^@ryntra\/core|^(app\/brand|app\/app|app\/solana\/workspace|components)\/|^app\/pay\/pay|^lib\/site\/pay-copy/.test(path));
    assert.deepEqual(old, [], `${route} reaches the old face`);
    assert.ok(reached.includes("city/styles/city.module.css"), `${route} stands on the city's root`);
    for (const path of reached.filter((p) => /\.(tsx|ts|css)$/.test(p) && existsSync(join(ROOT, p)))) {
      assert.doesNotMatch(strip(readFileSync(join(ROOT, path), "utf8")), /ryntra-wordmark|ryntra-brand|ry-mark-grad/, `${path} draws nothing of the old lockup`);
    }
  }
  for (const gone of ["app/pay/[id]/pay-client.tsx", "app/pay/pay-brand.tsx", "app/pay/pay.module.css"]) assert.equal(existsSync(join(ROOT, gone)), false, `${gone} is gone`);
});

test("the page says its words through the city's dictionary, and the engine stays the engine", () => {
  const page = strip(readFileSync(join(ROOT, "app/pay/[id]/page.tsx"), "utf8"));
  assert.match(page, /loadPublicPaymentRequest\(\{ store: getGuardRuntime\(\)\.store, id \}\)/, "the first paint is the public read");
  assert.match(page, /if \(!view\) notFound\(\);/);
  assert.match(page, /LANG_BOOT_SCRIPT/, "the person's language before the first paint");
  const missing = strip(readFileSync(join(ROOT, "app/pay/[id]/not-found.tsx"), "utf8"));
  assert.match(missing, /export const metadata: Metadata = payMetadata\(null\);/);
  assert.match(page, /return payMetadata\(await loadPublicPaymentRequest\(/);
  assert.equal(PAY.en.missingTitle, "Link not found");
  assert.equal(PAY.uk.missingTitle, "Посилання не знайдено");
  const flow = strip(readFileSync(join(ROOT, "city/lib/pay/flow.ts"), "utf8"));
  assert.doesNotMatch(flow, /signTransaction|privateKey|secretKey/, "the flow never holds a key; the wallet is handed in");
  assert.doesNotMatch(flow, /\/api\/v1\/pay|lib\/pay\/(transaction|store|observe)/, "the page creates nothing and reads no private record");
});

test("the tab and the preview: the city's words and card, never indexed, for a request and for a wrong link", async () => {
  const { payMetadata } = await import("./meta.ts");
  const asked = payMetadata(view({}));
  assert.deepEqual(asked.title, { absolute: "Payment request · 25 USDC" });
  assert.equal(asked.description, "Design work");
  assert.deepEqual(asked.robots, { index: false, follow: false });
  assert.match(asked.openGraph.images[0].url, /^\/opengraph-image\?v=[0-9a-f]+$/, "the city's own card, the one / shares");
  assert.equal(asked.openGraph.url, "/pay/pay_7Hq2Lr9aT5XqBnU8");
  const missing = payMetadata(null);
  assert.deepEqual(missing.title, { absolute: "Link not found · Ryntra" });
  assert.deepEqual(missing.robots, { index: false, follow: false });
  assert.equal(missing.openGraph.images[0].alt, "Link not found · Ryntra", "the site's old line never rides along as the picture's words");
  assert.doesNotMatch(JSON.stringify([asked, missing]), /tokenized stocks|ryntra-wordmark/i);
});
