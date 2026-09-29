import assert from "node:assert/strict";
import test from "node:test";

import { RecipientCheckResponseSchema } from "../api/v1/contract.ts";
import { checkRecipient } from "./recipient-check.server.ts";

const FROM = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TO = "DiYBuFEwKMG1fcUYjeyfg4sannSmXpk4TtRFeH1tjHtM";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "3EpVCPUgyjq2MfGeCttyey6bs5zya5wjYZ2BE6yDg6bm";
const REFERENCE = "82ZJ7nbGpixjeDCmEhUcmwXYfvurzAgGdtSMuHnUgyny";
const NOW = new Date("2026-09-29T09:00:00.000Z");

function link(overrides = {}) {
  return {
    id: "7mKq3x9ZpQv2Lr5t",
    url: "https://ryntra.io/pay/7mKq3x9ZpQv2Lr5t",
    payUrl: `solana:${TO}?amount=1&spl-token=${USDC}&reference=${REFERENCE}`,
    status: "AWAITING",
    note: null,
    token: { symbol: "USDC", mint: USDC, decimals: 6 },
    amount: { raw: "1000000", display: "1" },
    description: null,
    recipient: { abbreviated: "DiYB…jHtM", address: TO },
    reference: REFERENCE,
    createdAt: "2026-09-29T08:00:00.000Z",
    expiresAt: "2026-10-06T08:00:00.000Z",
    paid: null,
    ...overrides,
  };
}

function deps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      linkHosts: ["ryntra.io", "www.ryntra.io"],
      readLink: async (id) => (calls.push(["readLink", id]), id === "7mKq3x9ZpQv2Lr5t" ? link() : null),
      linkIdByReference: async (reference) => (calls.push(["reference", reference]), reference === REFERENCE ? "7mKq3x9ZpQv2Lr5t" : null),
      resolveNative: async (address) => (calls.push(["native", address]), { ok: true, kind: "WALLET_OWNER", owner: address, destinationTokenAccount: null, createsAccount: false }),
      resolveToken: async (args) => (calls.push(["token", args]), { ok: true, kind: "WALLET_OWNER", owner: args.address, destinationTokenAccount: ATA, createsAccount: true }),
      tokenProgramOf: async (mint) => (calls.push(["mint", mint]), mint === USDC ? { ok: true, tokenProgram: TOKEN_PROGRAM } : { ok: false }),
      now: () => NOW,
      ...overrides,
    },
  };
}

async function check(query, overrides) {
  const { deps: d, calls } = deps(overrides);
  const answer = await checkRecipient(d, query);
  /* Every answer this can give is one the contract describes. */
  RecipientCheckResponseSchema.parse(answer);
  return { answer, calls };
}

test("an address that can receive SOL: go to the transfer, with what the chain says", async () => {
  const { answer } = await check({ to: TO, from: FROM });
  assert.equal(answer.next, "transfer");
  assert.equal(answer.problem, null);
  assert.equal(answer.input, "address");
  assert.equal(answer.address, TO);
  assert.deepEqual(answer.asset, { mint: null });
  assert.deepEqual(answer.destination, { kind: "wallet", owner: TO, account: TO, opensAccount: false });
  assert.equal(answer.checkedAt, NOW.toISOString());
});

test("a token goes through the builder's own classifier, with the token program the chain names", async () => {
  const { answer, calls } = await check({ to: TO, mint: USDC });
  assert.equal(answer.next, "transfer");
  assert.deepEqual(answer.destination, { kind: "wallet", owner: TO, account: ATA, opensAccount: true });
  assert.deepEqual(calls.find(([name]) => name === "token")[1], { address: TO, mint: USDC, tokenProgram: TOKEN_PROGRAM });
});

test("the classifier's refusal is the problem, and nothing is a pass that was not read", async () => {
  for (const code of ["UNSAFE_SOL_RECIPIENT", "RECIPIENT_UNREADABLE", "RECIPIENT_FROZEN"]) {
    const { answer } = await check({ to: TO }, { resolveNative: async () => ({ ok: false, code, reason: "stub" }) });
    assert.equal(answer.next, "none");
    assert.equal(answer.problem, code);
    assert.equal(answer.destination, null);
  }
  const { answer } = await check({ to: TO, mint: "So11111111111111111111111111111111111111112" });
  assert.equal(answer.problem, "MINT_UNREADABLE");
  assert.equal(answer.next, "none");
});

test("what is not an address says why, and reads nothing", async () => {
  const { answer, calls } = await check({ to: "wallet-opuATvsQx" });
  assert.equal(answer.problem, "NOT_AN_ADDRESS");
  assert.equal(answer.next, "none");
  assert.equal(answer.address, null);
  assert.deepEqual(calls, []);
  assert.equal((await check({ to: "" })).answer.problem, "EMPTY");
});

test("the sender's own wallet, or a token account the sender owns, is SELF", async () => {
  const own = await check({ to: FROM, from: FROM });
  assert.equal(own.answer.problem, "SELF");
  assert.deepEqual(own.calls, []);
  const ownAccount = await check(
    { to: ATA, mint: USDC, from: FROM },
    { resolveToken: async () => ({ ok: true, kind: "EXISTING_TOKEN_ACCOUNT", owner: FROM, destinationTokenAccount: ATA, createsAccount: false }) },
  );
  assert.equal(ownAccount.answer.problem, "SELF");
  assert.equal(ownAccount.answer.destination.kind, "token-account");
});

test("a Ryntra link, pasted or scanned by its reference, is paid through the link", async () => {
  const pasted = await check({ to: "https://ryntra.io/pay/7mKq3x9ZpQv2Lr5t", from: FROM });
  assert.equal(pasted.answer.input, "pay-link");
  assert.equal(pasted.answer.next, "pay-link");
  assert.equal(pasted.answer.link.id, "7mKq3x9ZpQv2Lr5t");
  assert.equal(pasted.answer.address, TO);
  assert.deepEqual(pasted.answer.asset, { mint: USDC });

  const scanned = await check({ to: `solana:${TO}?amount=1&spl-token=${USDC}&reference=${REFERENCE}`, from: FROM });
  assert.equal(scanned.answer.input, "solana-pay");
  assert.equal(scanned.answer.next, "pay-link");
  assert.equal(scanned.answer.link.id, "7mKq3x9ZpQv2Lr5t");
  assert.deepEqual(scanned.answer.asked, { amount: "1", mint: USDC, label: null, message: null });
});

test("a link that is paid, expired, missing or one's own is not paid again", async () => {
  for (const [status, problem] of [["PAID", "LINK_PAID"], ["EXPIRED", "LINK_EXPIRED"]]) {
    const { answer } = await check({ to: "https://ryntra.io/pay/7mKq3x9ZpQv2Lr5t" }, { readLink: async () => link({ status }) });
    assert.equal(answer.problem, problem);
    assert.equal(answer.next, "none");
  }
  assert.equal((await check({ to: "https://ryntra.io/pay/7mKq3x9ZpQv2Lr6t" })).answer.problem, "LINK_NOT_FOUND");
  assert.equal((await check({ to: "https://ryntra.io/pay/7mKq3x9ZpQv2Lr5t", from: TO })).answer.problem, "SELF");
});

test("another service's reference or a memo cannot ride a plain transfer, so none is offered", async () => {
  const foreign = "Hn8ZcPcf3xrdP4cK4XoTR8m4cDiE6kvNL3rhq6jbL3yB";
  const referenced = await check({ to: `solana:${TO}?amount=2&reference=${foreign}` });
  assert.equal(referenced.answer.problem, "REFERENCE_UNSUPPORTED");
  assert.equal(referenced.answer.next, "none");
  assert.equal(referenced.answer.address, TO);
  assert.deepEqual(referenced.answer.asked, { amount: "2", mint: null, label: null, message: null });
  const memo = await check({ to: `solana:${TO}?memo=order-42` });
  assert.equal(memo.answer.problem, "REQUEST_UNSUPPORTED");
});

test("a plain Solana Pay request is checked for the token it asks, not the one the phone had chosen", async () => {
  const { answer, calls } = await check({ to: `solana:${TO}?amount=3&spl-token=${USDC}&label=Shop`, mint: undefined });
  assert.equal(answer.next, "transfer");
  assert.deepEqual(answer.asset, { mint: USDC });
  assert.deepEqual(answer.asked, { amount: "3", mint: USDC, label: "Shop", message: null });
  assert.ok(calls.some(([name]) => name === "token"));
});

test("a reference is public: a scanned request whose terms are not the link's own learns nothing of it", async () => {
  /* Another recipient, token, amount or note than the link's own Solana Pay request states. */
  for (const to of [
    `solana:${FROM}?amount=1&spl-token=${USDC}&reference=${REFERENCE}`,
    `solana:${TO}?amount=500&spl-token=${USDC}&reference=${REFERENCE}`,
    `solana:${TO}?amount=1&reference=${REFERENCE}`,
    `solana:${TO}?amount=1&spl-token=${USDC}&reference=${REFERENCE}&message=Dinner`,
    `solana:${TO}?spl-token=${USDC}&reference=${REFERENCE}`,
  ]) {
    const { answer } = await check({ to });
    assert.equal(answer.problem, "LINK_MISMATCH", to);
    assert.equal(answer.next, "none");
    assert.equal(answer.link, null, "nothing of the link is answered");
  }
  /* The same amount written another way is the same amount. */
  assert.equal((await check({ to: `solana:${TO}?amount=1.000000&spl-token=${USDC}&reference=${REFERENCE}` })).answer.next, "pay-link");
});

test("found by its reference, a paid or expired link says so and nothing more", async () => {
  for (const [status, problem] of [["PAID", "LINK_PAID"], ["EXPIRED", "LINK_EXPIRED"]]) {
    const { answer } = await check({ to: `solana:${TO}?amount=1&spl-token=${USDC}&reference=${REFERENCE}` }, { readLink: async () => link({ status }) });
    assert.equal(answer.problem, problem);
    assert.equal(answer.link, null, `a ${status} link found by its public reference keeps its words to itself`);
  }
});

test("a link the chain could not be read about is never offered as payable", async () => {
  for (const status of ["CHECKING", "UNKNOWN"]) {
    const { answer } = await check({ to: "https://ryntra.io/pay/7mKq3x9ZpQv2Lr5t" }, { readLink: async () => link({ status }) });
    assert.equal(answer.problem, "LINK_UNCONFIRMED", status);
    assert.equal(answer.next, "none");
  }
});

test("a chain that did not answer about the token is unread, not an unreadable mint", async () => {
  const { answer } = await check({ to: TO, mint: USDC }, { tokenProgramOf: async () => ({ ok: false, unavailable: true }) });
  assert.equal(answer.problem, "RECIPIENT_UNREADABLE");
});

test("a link that can no longer be paid answers the same whatever the scan states — no note can be confirmed by varying it", async () => {
  for (const to of [`solana:${TO}?amount=1&spl-token=${USDC}&reference=${REFERENCE}`, `solana:${TO}?amount=1&spl-token=${USDC}&reference=${REFERENCE}&message=rent`]) {
    const { answer } = await check({ to }, { readLink: async () => link({ status: "PAID", description: "rent" }) });
    assert.equal(answer.problem, "LINK_PAID", to);
    assert.equal(answer.link, null);
  }
});

test("a memo the link does not carry makes it another request; leading zeros are the same amount", async () => {
  assert.equal((await check({ to: `solana:${TO}?amount=1&spl-token=${USDC}&reference=${REFERENCE}&memo=inv-9` })).answer.problem, "LINK_MISMATCH");
  const zeros = await check({ to: `solana:${TO}?amount=01&spl-token=${USDC}&reference=${REFERENCE}` });
  assert.equal(zeros.answer.next, "pay-link");
  assert.equal(zeros.answer.asked.amount, "1");
});
