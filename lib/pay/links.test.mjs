import assert from "node:assert/strict";
import test from "node:test";

import { PayLinkListResponseSchema, PayLinkResponseSchema, PayLinkSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { createPayLink, listPayLinks, readPayLink } from "./links.server.ts";
import { FORBIDDEN_PUBLIC_KEYS, PAYMENT_DESCRIPTION_MAX, PAYMENT_EXPIRATIONS } from "./model.ts";
import { writePaymentSettlement } from "./store.ts";
import { PAY_LINK_DESCRIPTION_MAX, PAY_LINK_EXPIRATIONS } from "../api/v1/contract.ts";

const WALLET = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ORIGIN = "https://ryntra.io";
const NOW = new Date("2026-09-29T09:00:00.000Z");

function deps(store, overrides = {}) {
  let n = 0;
  return {
    store,
    readMint: async (mint) => (mint === USDC ? { ok: true, decimals: 6 } : { ok: false, reason: "not a mint" }),
    symbolOf: async (mint) => (mint === USDC ? "USDC" : null),
    now: () => NOW,
    newId: () => `7mKq3x9ZpQv2Lr${"abcdefghijk"[n++ % 11]}t`,
    ...overrides,
  };
}

const input = (overrides = {}) => ({ mint: USDC, amount: "1.50", description: "  Dinner   split ", expiration: "7d", ...overrides });

test("the contract's bounds are the engine's own", () => {
  assert.deepEqual([...PAY_LINK_EXPIRATIONS], [...PAYMENT_EXPIRATIONS]);
  assert.equal(PAY_LINK_DESCRIPTION_MAX, PAYMENT_DESCRIPTION_MAX);
});

test("a link asks money for the proven wallet, carries both addresses and says nothing about its creator", async () => {
  const store = createMemoryGuardStore();
  const created = await createPayLink(deps(store), { wallet: WALLET, sessionId: "session-1", input: input(), origin: ORIGIN });
  assert.equal(created.ok, true);
  const { link } = created;
  PayLinkResponseSchema.parse({ link });
  assert.equal(link.recipient.address, WALLET);
  assert.equal(link.url, `${ORIGIN}/pay/${link.id}`);
  assert.match(link.payUrl, new RegExp(`^solana:${WALLET}\\?`));
  assert.match(link.payUrl, new RegExp(`reference=${link.reference}`));
  assert.match(link.payUrl, /amount=1\.5(&|$)/);
  assert.match(link.payUrl, new RegExp(`spl-token=${USDC}`));
  assert.deepEqual(link.token, { symbol: "USDC", mint: USDC, decimals: 6 });
  assert.deepEqual(link.amount, { raw: "1500000", display: "1.5" });
  assert.equal(link.description, "Dinner split");
  assert.equal(link.status, "AWAITING");
  assert.equal(link.paid, null);
  assert.equal(link.expiresAt, "2026-10-06T09:00:00.000Z");
  const keys = new Set(JSON.stringify(link).match(/"([a-zA-Z]+)":/g).map((entry) => entry.slice(1, -2)));
  for (const forbidden of FORBIDDEN_PUBLIC_KEYS) assert.ok(!keys.has(forbidden), `the link carries ${forbidden}`);
});

test("an open link for SOL, and the refusals said as codes", async () => {
  const store = createMemoryGuardStore();
  const open = await createPayLink(deps(store), { wallet: WALLET, sessionId: null, input: input({ mint: null, amount: null, description: null }), origin: ORIGIN });
  assert.equal(open.ok, true);
  assert.deepEqual(open.link.token, { symbol: "SOL", mint: null, decimals: 9 });
  assert.equal(open.link.amount, null);
  assert.equal(open.link.payUrl.includes("amount="), false);

  const tooPrecise = await createPayLink(deps(store), { wallet: WALLET, sessionId: null, input: input({ amount: "1.0000001" }), origin: ORIGIN });
  assert.deepEqual([tooPrecise.ok, tooPrecise.code], [false, "AMOUNT_INVALID"]);
  const zero = await createPayLink(deps(store), { wallet: WALLET, sessionId: null, input: input({ amount: "0" }), origin: ORIGIN });
  assert.deepEqual([zero.ok, zero.code], [false, "AMOUNT_INVALID"]);
  const notMint = await createPayLink(deps(store), { wallet: WALLET, sessionId: null, input: input({ mint: OTHER }), origin: ORIGIN });
  assert.deepEqual([notMint.ok, notMint.code], [false, "MINT_UNREADABLE"]);
});

test("the list is the wallet's own, newest first; one link reads paid with what arrived", async () => {
  const store = createMemoryGuardStore();
  const clock = { at: NOW };
  const make = async (wallet, minutes) => {
    clock.at = new Date(NOW.getTime() + minutes * 60_000);
    const created = await createPayLink(deps(store, { now: () => clock.at, newId: undefined }), { wallet, sessionId: null, input: input(), origin: ORIGIN });
    assert.equal(created.ok, true);
    return created.link;
  };
  const first = await make(WALLET, 0);
  const second = await make(WALLET, 5);
  await make(OTHER, 10);

  const listed = await listPayLinks(store, { wallet: WALLET, origin: ORIGIN, now: NOW });
  PayLinkListResponseSchema.parse({ address: WALLET, links: [...listed] });
  assert.deepEqual(listed.map((entry) => entry.id), [second.id, first.id]);

  const signature = "5".repeat(64) + "a".repeat(24);
  await writePaymentSettlement(store, {
    schema: "ryntra.pay.settlement",
    schemaVersion: "1.0.0",
    id: first.id,
    state: "PAID",
    signature,
    creditedRaw: "1500000",
    payer: OTHER,
    paidAt: "2026-09-29T09:03:00.000Z",
    observedAt: "2026-09-29T09:03:05.000Z",
    checkedAt: "2026-09-29T09:03:05.000Z",
    failures: 0,
    lastError: null,
  });
  const paid = await readPayLink(store, { id: first.id, origin: ORIGIN, observe: false, now: NOW });
  PayLinkSchema.parse(paid);
  assert.equal(paid.status, "PAID");
  assert.deepEqual(paid.paid, { signature, creditedRaw: "1500000", credited: "1.5", paidAt: "2026-09-29T09:03:00.000Z" });
  /* The payer's address is the chain's fact, but the link never names who paid. */
  assert.equal(JSON.stringify(paid).includes(OTHER), false);

  assert.equal(await readPayLink(store, { id: "not-an-id", origin: ORIGIN, observe: false }), null);
  assert.equal(await readPayLink(store, { id: "7mKq3x9ZpQv2Lr9t", origin: ORIGIN, observe: false }), null);
});

test("a paid link of a thousand or more says what arrived as one plain decimal", async () => {
  const store = createMemoryGuardStore();
  const created = await createPayLink(deps(store), { wallet: WALLET, sessionId: null, input: input({ amount: "1250" }), origin: ORIGIN });
  assert.equal(created.ok, true);
  await writePaymentSettlement(store, { schema: "ryntra.pay.settlement", schemaVersion: "1.0.0", id: created.link.id, state: "PAID", signature: "5".repeat(64) + "a".repeat(24), creditedRaw: "1250000000", payer: OTHER, paidAt: null, observedAt: "2026-09-29T09:03:05.000Z", checkedAt: "2026-09-29T09:03:05.000Z", failures: 0, lastError: null });
  const paid = PayLinkSchema.parse(await readPayLink(store, { id: created.link.id, origin: ORIGIN, observe: false, now: NOW }));
  assert.equal(paid.paid.credited, "1250");
});

test("an outage while reading the mint is UNAVAILABLE, and a catalogue name too long for a link is the mint abbreviated", async () => {
  const store = createMemoryGuardStore();
  const down = await createPayLink(deps(store, { readMint: async () => ({ ok: false, reason: "The endpoint did not answer.", unavailable: true }) }), { wallet: WALLET, sessionId: null, input: input(), origin: ORIGIN });
  assert.deepEqual([down.ok, down.code], [false, "UNAVAILABLE"]);
  const long = await createPayLink(deps(store, { symbolOf: async () => "A".repeat(30) }), { wallet: WALLET, sessionId: null, input: input(), origin: ORIGIN });
  assert.equal(long.ok, true);
  assert.equal(long.link.token.symbol, "EPjF…Dt1v");
});
