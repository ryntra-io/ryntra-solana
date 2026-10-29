// Run from repo root: node --test lib/predictions/funding.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { resetAggAdapterCache, getPredictionProvider } from "./agg/adapter.ts";
import { checkWithdrawal, previewWithdrawal, readFunding, submitWithdrawal } from "./funding-account.ts";
import {
  DESTINATION_MISMATCH,
  PROVIDER_REFRESH_TIMEOUT_MS,
  WITHDRAW_SEND_LEASE_MS,
  WITHDRAW_SEND_TIMEOUT_MS,
  depositPhase,
  fundingEnabled,
  fundingViewFor,
  mapDeposits,
  mapLiveBalance,
  mapPreview,
  mapWithdrawal,
  parseUsdcAmount,
  rawToAmount,
  receiveDropped,
  receiveFloorRaw,
  solanaDepositTarget,
  withdrawalPhase,
} from "./funding.ts";
import { WithdrawBodySchema, WithdrawPreviewBodySchema, predictionProofWallet } from "./route-contract.ts";
import { writeLink } from "./session.ts";
import { seal } from "./vault.ts";

/*
 * The money paths of a person with one Solana wallet, replayed against the
 * aggregator's answers (`fixtures/agg-funding.json`): the deposit address on
 * Solana, the live balance, the deposits, a withdrawal priced, sent, lost on
 * the way, refused, re-priced, settled. The real adapter and the real SDK
 * talk to a local server that answers as the aggregator does; nothing leaves
 * this machine and no key is in the fixture.
 */

const AGG = JSON.parse(readFileSync(new URL("./fixtures/agg-funding.json", import.meta.url), "utf8"));
const WALLET = "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY";
const WALLET_B = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SOLANA = 792703809;
const ON = { PREDICTIONS_LIVE_FUNDING: "on", PREDICTIONS_LIVE_WALLETS: "HSxcfwks1J75kyu7EPjeiuLxPv9baNgMHrSponVBETmY,9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", BETA_TOKEN_SECRET: "test-secret-of-sufficient-length" };
const OFF = { BETA_TOKEN_SECRET: "test-secret-of-sufficient-length" };
process.env.BETA_TOKEN_SECRET = ON.BETA_TOKEN_SECRET;
const UUID_A = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const UUID_B = "0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b";

function durableStore() {
  return { ...createMemoryGuardStore(), durability: "DURABLE_MULTI_WRITER" };
}

function jwt(expSeconds, sub = "u1") {
  return `h.${Buffer.from(JSON.stringify({ sub, exp: expSeconds })).toString("base64url")}.s`;
}

/** The provider user behind a bearer the fake aggregator receives. */
function subOf(authorization) {
  try {
    return JSON.parse(Buffer.from(String(authorization ?? "").replace(/^Bearer /, "").split(".")[1], "base64url").toString("utf8")).sub;
  } catch {
    return null;
  }
}

/** The wallet's provider session, as a sign-in leaves it. */
async function linked(store, wallet = WALLET, sub = "u1") {
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  await writeLink(
    store,
    {
      wallet,
      externalId: `ryntra:solana:${wallet}`,
      providerUserId: "agguser",
      providerWallet: wallet,
      externalIdLinked: true,
      linkAttemptedAt: stamp,
      linkError: null,
      access: seal(jwt(now / 1000 + 3600, sub), ON),
      refresh: seal("refresh-1", ON),
      accessExpiresAt: new Date(now + 3_600_000).toISOString(),
      state: "active",
      stateReason: null,
      createdAt: stamp,
      updatedAt: stamp,
      refreshedAt: null,
    },
    null,
  );
  return store;
}

/**
 * The aggregator, answering from the fixture. `script` decides per call:
 * `preview` — the answers of successive previews; `withdraw` — of successive
 * sends (`"drop"` closes the socket without an answer); `status` — of
 * successive status reads.
 */
async function aggServer(t, script = {}) {
  const seen = [];
  const refreshes = [];
  const queues = { preview: [...(script.preview ?? ["withdrawPreviewQuoted"])], withdraw: [...(script.withdraw ?? ["withdrawAccepted"])], status: [...(script.status ?? ["withdrawalCompleted"])] };
  const next = (name) => (queues[name].length > 1 ? queues[name].shift() : queues[name][0]);
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const url = new URL(request.url, "http://agg");
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, appId: request.headers["x-app-id"], bearer: (request.headers.authorization ?? "").startsWith("Bearer ") });
      const key =
        request.method === "GET" && url.pathname === "/execution/deposit-addresses" ? (script.addresses ?? "depositAddresses")
        : request.method === "GET" && url.pathname === "/execution/balances" ? "balancesLive"
        : request.method === "GET" && url.pathname === "/users/activity" ? "activityDeposits"
        : request.method === "POST" && url.pathname === "/execution/withdrawable/quote" ? "withdrawableQuote"
        : request.method === "POST" && url.pathname === "/execution/withdraw/preview" ? next("preview")
        : request.method === "POST" && url.pathname === "/execution/withdraw" ? next("withdraw")
        : request.method === "GET" && url.pathname.startsWith("/execution/withdrawals/") ? next("status")
        : null;
      if (request.method === "POST" && url.pathname === "/auth/token/refresh") {
        refreshes.push(body?.refreshToken ?? null);
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ accessToken: jwt(Date.now() / 1000 + 3600), refreshToken: `refresh-${refreshes.length + 1}` }));
        return;
      }
      if (key === "drop") {
        request.socket.destroy();
        return;
      }
      /* `addressFor` — each provider user has a managed wallet of its own: the deposit address answered for this bearer. */
      const own = key === "depositAddresses" && script.addressFor ? { status: 200, body: { ...AGG.depositAddresses.body, svmAddress: script.addressFor(subOf(request.headers.authorization)) } } : null;
      const answer = own ?? (key === null ? { status: 404, body: { message: "not here" } } : (SPECIAL[key] ?? AGG[key]));
      response.statusCode = answer.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(answer.body).split("{{destination}}").join(body?.destinationAddress ?? WALLET));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const saved = { id: process.env.AGG_APP_ID, base: process.env.AGG_API_BASE_URL };
  process.env.AGG_APP_ID = "app-under-test";
  process.env.AGG_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  resetAggAdapterCache();
  t.after(() => {
    server.close();
    if (saved.id === undefined) delete process.env.AGG_APP_ID;
    else process.env.AGG_APP_ID = saved.id;
    if (saved.base === undefined) delete process.env.AGG_API_BASE_URL;
    else process.env.AGG_API_BASE_URL = saved.base;
    resetAggAdapterCache();
  });
  return { seen, refreshes, sends: () => seen.filter((s) => s.method === "POST" && s.path === "/execution/withdraw") };
}

/** Answers the fixture does not hold: a session the provider no longer takes, a conflict on the id, a burst limit. */
const SPECIAL = {
  unauthorized: { status: 401, body: { message: "Unauthorized" } },
  conflict: { status: 409, body: { message: "requestId was used with a different body" } },
  busy: { status: 429, body: { message: "Too many requests" } },
  /* Accepted, but naming another destination than the one asked for: another address, or the right address on another chain. */
  acceptedElsewhere: { status: 200, body: { ...AGG.withdrawAccepted.body, destination: { chainId: 792703809, address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", tokenSymbol: "USDC" } } },
  acceptedOtherChain: { status: 200, body: { ...AGG.withdrawAccepted.body, destination: { chainId: 137, address: "{{destination}}", tokenSymbol: "USDC" } } },
  acceptedNoDestination: { status: 200, body: { ...AGG.withdrawAccepted.body, destination: null } },
};

const INPUT = { requestId: UUID_A, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" };

/* ------------------------------------------------------------------ the readers */

test("the Solana deposit address is shown only when the app's supported chains take USDC on Solana", () => {
  const ready = solanaDepositTarget(AGG.depositAddresses.body);
  assert.deepEqual(ready, { state: "ready", address: "AGGsVm1111111111111111111111111111111111111", chainId: SOLANA, chainName: "Solana", token: { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 } });
  assert.deepEqual(solanaDepositTarget(AGG.depositAddressesPending.body), { state: "preparing" });
  const evmOnly = { ...AGG.depositAddresses.body, supportedChains: AGG.depositAddresses.body.supportedChains.filter((c) => c.name !== "Solana") };
  assert.deepEqual(solanaDepositTarget(evmOnly), { state: "unsupported" }, "the docs' own example lists only Polygon and Base: then there is no address");
  const solanaWithoutUsdc = { ...AGG.depositAddresses.body, supportedChains: [{ chainId: SOLANA, name: "Solana", tokens: [{ symbol: "USDT", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 }] }] };
  assert.deepEqual(solanaDepositTarget(solanaWithoutUsdc), { state: "unsupported" });
  assert.deepEqual(solanaDepositTarget({ ...AGG.depositAddresses.body, svmAddress: "0xnot-solana" }), { state: "unsupported" });
});

test("the live balance in dollars: cash by token and chain, what is spendable now and what is held, the positions", () => {
  const balance = mapLiveBalance(AGG.balancesLive.body);
  assert.equal(balance.cashUsd, 15.5);
  assert.equal(balance.availableUsd, 13, "USDC.e without an available figure counts whole");
  assert.equal(balance.reservedUsd, 2.5);
  assert.equal(balance.positionsUsd, 4.2);
  assert.deepEqual(balance.tokens[0], { symbol: "USDC", usd: 12.5, chains: [{ chainId: SOLANA, usd: 10 }, { chainId: 137, usd: 2.5 }] });
  assert.deepEqual(mapLiveBalance({ cash: [{ tokenSymbol: "USDC", totalRaw: "1e6", decimals: 6, chains: [] }] }).cashUsd, 0, "an unreadable figure is left out, not guessed");
  assert.equal(rawToAmount("125000000", 6), 125);
  assert.equal(rawToAmount("1", 6), 0.000001);
  assert.equal(rawToAmount("-1", 6), null);
});

test("deposits: a status the reader knows is said in words; any other is unknown — never credited", () => {
  const rows = mapDeposits(AGG.activityDeposits.body);
  assert.deepEqual(rows.map((r) => [r.id, r.phase, r.amount]), [["dep_pending", "pending", 2.5], ["dep_confirmed", "credited", 10], ["dep_odd", "unknown", 1]]);
  assert.equal(rows[2].providerStatus, "under_review");
  assert.equal(depositPhase(undefined), "unknown");
  assert.equal(depositPhase("failed"), "unknown");
});

test("an amount the person typed becomes raw USDC exactly, or is refused", () => {
  assert.deepEqual(parseUsdcAmount("2,5"), { ok: true, raw: "2500000" });
  assert.deepEqual(parseUsdcAmount("$10"), { ok: true, raw: "10000000" });
  assert.deepEqual(parseUsdcAmount("1 000.25"), { ok: true, raw: "1000250000" });
  assert.deepEqual(parseUsdcAmount("2.5000001"), { ok: false, reason: "too_precise" });
  assert.deepEqual(parseUsdcAmount(""), { ok: false, reason: "empty" });
  assert.deepEqual(parseUsdcAmount("0"), { ok: false, reason: "not_positive" });
  assert.deepEqual(parseUsdcAmount("abc"), { ok: false, reason: "unreadable" });
});

test("previews: quoted with what arrives and the fee; unviable named by the maximum first, the provider's words second", () => {
  assert.deepEqual(mapPreview(AGG.withdrawPreviewQuoted.body, "5000000"), { status: "quoted", amountRaw: "5000000", receiveRaw: "4770000", feeRaw: "230000", expiresAt: "2026-10-21T09:31:00.000Z", maxDeliverableRaw: null, reason: null, providerReason: null });
  assert.equal(mapPreview(AGG.withdrawPreviewInsufficient.body, "5000000").reason, "insufficient");
  const above = mapPreview(AGG.withdrawPreviewAboveMax.body, "99000000");
  assert.equal(above.reason, "above_max");
  assert.equal(above.maxDeliverableRaw, "15270000");
  assert.equal(mapPreview({ pricingStatus: "quoted", receiveAmountRaw: "0" }, "1000000").status, "unviable", "a quote that delivers nothing is not a quote");
  assert.equal(receiveDropped("4770000", "4730000"), false, "under 1 % is the same Review");
  assert.equal(receiveDropped("4770000", "4700000"), true);
  assert.equal(receiveDropped("4770000", null), true);
});

test("a withdrawal's state: the provider's five words, and anything else unknown", () => {
  assert.deepEqual(["pending", "bridging", "transferring", "completed", "partial", "failed", "under_review", undefined].map(withdrawalPhase), ["in_flight", "in_flight", "in_flight", "completed", "partial", "failed", "unknown", "unknown"]);
  const done = mapWithdrawal(AGG.withdrawalCompleted.body);
  assert.equal(done.phase, "completed");
  assert.equal(done.completedRaw, "4771200");
  assert.equal(done.txHashes.length, 2);
  assert.equal(mapWithdrawal({ status: "pending" }), null, "an answer without an id is no withdrawal");
});

test("live money is off unless the deployment switched it on", () => {
  assert.equal(fundingEnabled({}), false);
  assert.equal(fundingEnabled({ PREDICTIONS_LIVE_FUNDING: "true" }), false);
  assert.equal(fundingEnabled({ PREDICTIONS_LIVE_FUNDING: " ON " }), true);
});

/* ------------------------------------------------------------------ the paths */

test("switched off: no address is asked for, no preview, no send — the records stay readable", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const view = await readFunding(store, getPredictionProvider(), WALLET, OFF);
  assert.equal(view.ok, true);
  assert.equal(view.value.enabled, false);
  assert.deepEqual(view.value.deposit, { state: "off" });
  assert.equal(view.value.balance, null);
  assert.deepEqual(view.value.custody, { holder: "AGG", walletProvider: "Portal" });
  const preview = await previewWithdrawal(store, getPredictionProvider(), WALLET, { amountRaw: "5000000" }, OFF);
  assert.equal(preview.code, "FUNDING_OFF");
  const sent = await submitWithdrawal(store, getPredictionProvider(), WALLET, { requestId: UUID_A, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" }, OFF);
  assert.equal(sent.code, "FUNDING_OFF");
  assert.equal(agg.seen.length, 0, "the provider was never asked");
});

test("switched on: the Solana deposit address, the balance and the deposits, read with the person's own session", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const view = await readFunding(store, getPredictionProvider(), WALLET, ON);
  assert.equal(view.ok, true);
  assert.equal(view.value.deposit.state, "ready");
  assert.equal(view.value.deposit.address, "AGGsVm1111111111111111111111111111111111111");
  assert.equal(view.value.deposit.chainId, SOLANA);
  assert.equal(view.value.balance.cashUsd, 15.5);
  assert.equal(view.value.deposits.length, 3);
  assert.equal(view.value.destination, WALLET);
  assert.deepEqual(view.value.limits, { withdrawMinUsd: 1, crossChainMinUsd: 2.5, bridgeFeeUsd: 0.23 });
  assert.equal(view.value.providerFailure, null);
  assert.ok(agg.seen.every((s) => s.appId === "app-under-test" && s.bearer), "every call carries the app and the person's bearer");
  assert.deepEqual(agg.seen.find((s) => s.path === "/execution/balances").query, { mode: "live" });
  assert.deepEqual(agg.seen.find((s) => s.path === "/users/activity").query, { type: "deposit", limit: "10" });
});

test("while the provider still creates the addresses the account says so, and shows no address", async (t) => {
  await aggServer(t, { addresses: "depositAddressesPending" });
  const store = await linked(durableStore());
  const view = await readFunding(store, getPredictionProvider(), WALLET, ON);
  assert.deepEqual(view.value.deposit, { state: "preparing" });
  const preview = await previewWithdrawal(store, getPredictionProvider(), WALLET, { amountRaw: "5000000" }, ON);
  assert.equal(preview.ok, false, "no chain id is guessed while there is no answer");
});

test("a preview always goes to the proven wallet on Solana; under one USDC it is answered without the provider; Max asks the deliverable maximum first", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const priced = await previewWithdrawal(store, provider, WALLET, { amountRaw: "5000000" }, ON);
  assert.equal(priced.ok, true);
  assert.equal(priced.value.receiveRaw, "4770000");
  assert.equal(priced.value.feeRaw, "230000");
  const asked = agg.seen.filter((s) => s.path === "/execution/withdraw/preview");
  assert.deepEqual(asked[0].body, { amountRaw: "5000000", tokenSymbol: "USDC", destinationAddress: WALLET, destinationChainId: SOLANA });

  const small = await previewWithdrawal(store, provider, WALLET, { amountRaw: "500000" }, ON);
  assert.equal(small.value.status, "unviable");
  assert.equal(small.value.reason, "below_minimum");
  assert.equal(agg.seen.filter((s) => s.path === "/execution/withdraw/preview").length, 1, "the provider was not asked for half a dollar");

  await previewWithdrawal(store, provider, WALLET, { max: true }, ON);
  assert.deepEqual(agg.seen.find((s) => s.path === "/execution/withdrawable/quote").body, { tokenSymbol: "USDC", destinationChainId: SOLANA });
  assert.equal(agg.seen.filter((s) => s.path === "/execution/withdraw/preview").at(-1).body.amountRaw, "15270000", "Max prices the exact maximum, so the send that follows carries an amount and a request id, never max");
  assert.equal(agg.sends().length, 0, "a preview sends nothing");
});

test("a confirmed withdrawal is recorded, sent once under its request id, and followed to its end", async (t) => {
  const agg = await aggServer(t, { status: ["withdrawalBridging", "withdrawalCompleted"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const input = { requestId: UUID_A, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" };
  const sent = await submitWithdrawal(store, provider, WALLET, input, ON);
  assert.equal(sent.ok, true);
  assert.equal(sent.value.outcome, "recorded");
  assert.equal(sent.value.withdrawal.phase, "in_flight");
  assert.equal(sent.value.withdrawal.destinationAddress, WALLET);
  assert.deepEqual(agg.sends()[0].body, { requestId: UUID_A, amountRaw: "5000000", tokenSymbol: "USDC", destinationAddress: WALLET, destinationChainId: SOLANA });

  const again = await submitWithdrawal(store, provider, WALLET, input, ON);
  assert.equal(again.value.withdrawal.requestId, UUID_A, "the same confirmation twice is one withdrawal");
  assert.equal(agg.sends().length, 1, "and one send");
  assert.equal(again.value.withdrawal.phase, "in_flight");

  const done = await checkWithdrawal(store, provider, WALLET, UUID_A, ON);
  assert.equal(done.value.phase, "completed");
  assert.equal(done.value.completedUsd, 4.7712);
  assert.equal(done.value.txHashes.length, 2);
  const view = await readFunding(store, provider, WALLET, ON);
  assert.equal(view.value.withdrawals[0].phase, "completed");
  assert.equal(agg.sends().length, 1);
});

test("a send with no answer is unknown — never shown as sent or as not sent — and the check asks the same request again", async (t) => {
  const agg = await aggServer(t, { withdraw: ["drop", "withdrawAccepted"], status: ["withdrawalBridging"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const sent = await submitWithdrawal(store, provider, WALLET, { requestId: UUID_A, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" }, ON);
  assert.equal(sent.value.withdrawal.phase, "unknown");

  const another = await submitWithdrawal(store, provider, WALLET, { requestId: UUID_B, amountRaw: "3000000", reviewedReceiveRaw: "2770000", reviewedFeeRaw: "230000" }, ON);
  assert.equal(another.code, "WITHDRAWAL_OPEN", "no second withdrawal while the first is unknown");

  const read = await readFunding(store, provider, WALLET, ON);
  assert.equal(read.value.withdrawals[0].phase, "unknown", "a read never sends");
  assert.equal(agg.sends().length, 1);

  const checked = await checkWithdrawal(store, provider, WALLET, UUID_A, ON);
  assert.equal(checked.value.phase, "in_flight");
  const sends = agg.sends();
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[1].body, sends[0].body, "the same request id and the same body: the provider answers the original if there was one");

  const switchedOff = await aggServer(t, { withdraw: ["drop"] });
  const store2 = await linked(durableStore());
  await submitWithdrawal(store2, getPredictionProvider(), WALLET, { requestId: UUID_B, amountRaw: "3000000", reviewedReceiveRaw: "2770000", reviewedFeeRaw: "230000" }, ON);
  const waiting = await checkWithdrawal(store2, getPredictionProvider(), WALLET, UUID_B, OFF);
  assert.equal(waiting.value.phase, "unknown");
  assert.equal(switchedOff.sends().length, 1, "switched off, an unknown one waits as it is: nothing is sent again");
});

test("a server error on the send is unknown too; a refusal that creates nothing is refused", async (t) => {
  const agg = await aggServer(t, { withdraw: ["withdrawServerError"] });
  const store = await linked(durableStore());
  const sent = await submitWithdrawal(store, getPredictionProvider(), WALLET, { requestId: UUID_A, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" }, ON);
  assert.equal(sent.value.withdrawal.phase, "unknown");
  assert.equal(agg.sends().length, 1);

  const refusing = await aggServer(t, { withdraw: ["withdrawRefused"] });
  const store2 = await linked(durableStore());
  const refused = await submitWithdrawal(store2, getPredictionProvider(), WALLET, { requestId: UUID_B, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" }, ON);
  assert.equal(refused.value.withdrawal.phase, "refused");
  assert.equal(refused.value.withdrawal.note, "VALIDATION_ERROR");
  const kept = await checkWithdrawal(store2, getPredictionProvider(), WALLET, UUID_B, ON);
  assert.equal(kept.value.phase, "refused");
  assert.equal(refusing.sends().length, 1, "a refused one is not sent again");
});

test("priced again before the send: when it no longer delivers what the Review said, nothing is recorded or sent", async (t) => {
  const agg = await aggServer(t, { preview: ["withdrawPreviewInsufficient"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const gone = await submitWithdrawal(store, provider, WALLET, { requestId: UUID_A, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" }, ON);
  assert.equal(gone.value.outcome, "repriced");
  assert.equal(gone.value.preview.reason, "insufficient");
  const lower = await submitWithdrawal(store, provider, WALLET, { requestId: UUID_B, amountRaw: "5000000", reviewedReceiveRaw: "4900000", reviewedFeeRaw: "100000" }, ON);
  assert.equal(lower.value.outcome, "repriced", "the Review said 4.90 and 4.77 arrives now");
  assert.equal(agg.sends().length, 0);
  const view = await readFunding(store, provider, WALLET, ON);
  assert.equal(view.value.withdrawals.length, 0);
});

test("partial and failed are the provider's terminal words; a status the reader does not know stays unknown", async (t) => {
  for (const [status, phase, completedUsd] of [["withdrawalPartial", "partial", 2.49], ["withdrawalFailed", "failed", null], ["withdrawalUnreadStatus", "unknown", null]]) {
    await aggServer(t, { status: [status] });
    const store = await linked(durableStore());
    const provider = getPredictionProvider();
    await submitWithdrawal(store, provider, WALLET, { requestId: UUID_A, amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000" }, ON);
    const checked = await checkWithdrawal(store, provider, WALLET, UUID_A, ON);
    assert.equal(checked.value.phase, phase, status);
    assert.equal(checked.value.completedUsd, completedUsd, status);
    if (phase === "failed") assert.match(checked.value.note, /liquidity/);
  }
});

test("the request id, the amount and the wallet are checked before anything is asked", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  assert.equal((await submitWithdrawal(store, provider, WALLET, { requestId: "not-a-uuid", amountRaw: "5000000", reviewedReceiveRaw: "4770000", reviewedFeeRaw: null }, ON)).code, "VALIDATION_ERROR");
  assert.equal((await submitWithdrawal(store, provider, WALLET, { requestId: UUID_A, amountRaw: "999999", reviewedReceiveRaw: "900000", reviewedFeeRaw: null }, ON)).code, "VALIDATION_ERROR");
  const evm = "0x52908400098527886e0f7030069857d2e4169ee7";
  assert.equal((await readFunding(store, provider, evm, ON)).code, "UNAUTHORIZED");
  assert.equal((await previewWithdrawal(store, provider, evm, { amountRaw: "5000000" }, ON)).code, "UNAUTHORIZED");
  assert.equal(agg.seen.length, 0);
  const unlinked = await readFunding(durableStore(), provider, WALLET, ON);
  assert.equal(unlinked.code, "NOT_LINKED");
});

/* ------------------------------------------------------------------ after an unknown send */

test("once a send went unanswered, a later refusal of the same request says nothing about the first: it stays unknown, and is asked again", async (t) => {
  const agg = await aggServer(t, { withdraw: ["drop", "busy", "conflict", "withdrawAccepted"], status: ["withdrawalBridging"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  assert.equal((await submitWithdrawal(store, provider, WALLET, INPUT, ON)).value.withdrawal.phase, "unknown");
  assert.equal((await checkWithdrawal(store, provider, WALLET, UUID_A, ON)).value.phase, "unknown", "429 on the second send: the first may still have made it");
  assert.equal((await checkWithdrawal(store, provider, WALLET, UUID_A, ON)).value.phase, "unknown", "409 on the id: one exists or existed");
  assert.equal((await submitWithdrawal(store, provider, WALLET, { ...INPUT, requestId: UUID_B, amountRaw: "3000000", reviewedReceiveRaw: "2770000" }, ON)).code, "WITHDRAWAL_OPEN", "and no second withdrawal meanwhile");
  assert.equal((await checkWithdrawal(store, provider, WALLET, UUID_A, ON)).value.phase, "in_flight");
  const sends = agg.sends();
  assert.equal(sends.length, 4);
  assert.ok(sends.every((s) => JSON.stringify(s.body) === JSON.stringify(sends[0].body)), "every send the same id and body");
});

test("two checks at the same moment send once: the second reads the record the first holds", async (t) => {
  const agg = await aggServer(t, { withdraw: ["drop", "withdrawAccepted"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  await submitWithdrawal(store, provider, WALLET, INPUT, ON);
  const [a, b] = await Promise.all([checkWithdrawal(store, provider, WALLET, UUID_A, ON), checkWithdrawal(store, provider, WALLET, UUID_A, ON)]);
  assert.equal(agg.sends().length, 2, "the first send and one retry");
  assert.ok([a.value.phase, b.value.phase].includes("in_flight"));
  assert.ok([a.value.phase, b.value.phase].every((p) => p === "in_flight" || p === "unknown"), "neither is told it was not sent");
});

test("a record that holds the provider's withdrawal is read, never sent again", async (t) => {
  const agg = await aggServer(t, { withdraw: ["withdrawAccepted"], status: ["withdrawalBridging"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const sent = await submitWithdrawal(store, provider, WALLET, INPUT, ON);
  assert.equal(sent.value.withdrawal.phase, "in_flight");
  const checked = await checkWithdrawal(store, provider, WALLET, UUID_A, ON);
  assert.equal(checked.value.phase, "in_flight");
  assert.equal(agg.sends().length, 1);
});

test("two confirmations of two Reviews at the same moment: at most one leaves", async (t) => {
  const agg = await aggServer(t, { withdraw: ["drop"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const results = await Promise.all([submitWithdrawal(store, provider, WALLET, INPUT, ON), submitWithdrawal(store, provider, WALLET, { ...INPUT, requestId: UUID_B }, ON)]);
  assert.ok(agg.sends().length <= 1, `${agg.sends().length} sends`);
  assert.ok(results.some((r) => !r.ok && r.code === "WITHDRAWAL_OPEN"));
});

test("a session the provider no longer takes is refreshed and the same request goes again", async (t) => {
  const agg = await aggServer(t, { withdraw: ["unauthorized", "withdrawAccepted"] });
  const store = await linked(durableStore());
  const sent = await submitWithdrawal(store, getPredictionProvider(), WALLET, INPUT, ON);
  assert.equal(sent.value.withdrawal.phase, "in_flight");
  assert.equal(agg.refreshes.length, 1);
  const sends = agg.sends();
  assert.equal(sends.length, 2);
  assert.deepEqual(sends[1].body, sends[0].body);
});

test("a send left sending by a request that never finished is asked again after a while; an old unknown one only waits", async (t) => {
  const agg = await aggServer(t, { withdraw: ["drop"] });
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const t0 = Date.now();
  /* The function stopped between the record and the answer: the record is still `sending`. */
  const orders = store.versioned("predictionOrders");
  const key = `withdrawal:solana:mainnet:${WALLET}:${UUID_A}`;
  const base = { kind: "withdrawal", wallet: WALLET, requestId: UUID_A, amountRaw: "5000000", destinationAddress: WALLET, destinationChainId: SOLANA, reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000", providerStatus: null, withdrawalId: null, completedRaw: null, txHashes: [], note: null };
  await orders.compareAndSet(key, null, { ...base, version: 1, phase: "sending", sends: 1, sendingUntil: new Date(t0 + 30_000).toISOString(), createdAt: new Date(t0).toISOString(), updatedAt: new Date(t0).toISOString() });
  assert.equal((await checkWithdrawal(store, provider, WALLET, UUID_A, ON, t0 + 10_000)).value.phase, "sending", "fresh: it may still be on its way");
  assert.equal(agg.sends().length, 0);
  assert.equal((await checkWithdrawal(store, provider, WALLET, UUID_A, ON, t0 + WITHDRAW_SEND_LEASE_MS + 10_000)).value.phase, "unknown", "stale: asked again, no answer");
  assert.equal(agg.sends().length, 1);

  const key2 = `withdrawal:solana:mainnet:${WALLET}:${UUID_B}`;
  await orders.compareAndSet(key2, null, { ...base, requestId: UUID_B, version: 1, phase: "unknown", sends: 1, sendingUntil: null, createdAt: new Date(t0 - 7 * 3_600_000).toISOString(), updatedAt: new Date(t0 - 7 * 3_600_000).toISOString() });
  assert.equal((await checkWithdrawal(store, provider, WALLET, UUID_B, ON, t0)).value.phase, "unknown");
  assert.equal(agg.sends().length, 1, "seven hours old: not sent again on its own");
});

test("cash a venue keeps for itself is in the balance but not available; BNB Chain amounts carry 18 decimals", () => {
  const balance = mapLiveBalance({ cash: [{ tokenSymbol: "USDC", totalRaw: "8000000", availableRaw: "8000000", decimals: 6, chains: [{ chainId: SOLANA, balanceRaw: "5000000", decimals: 6 }, { chainId: 137, balanceRaw: "3000000", decimals: 6, custodyKind: "POLYMARKET_LEGACY", legacyKind: "proxy" }] }] });
  assert.equal(balance.cashUsd, 8);
  assert.equal(balance.availableUsd, 5);
  assert.equal(mapDeposits({ data: [{ id: "d", type: "deposit", status: "confirmed", tokenSymbol: "USDT", amountRaw: "2000000000000000000", chainId: "56", createdAt: "2026-10-21T08:00:00.000Z" }] })[0].amount, 2);
});

test("a record never taken for a send is closed as not sent, never sent on its own later", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const t0 = Date.now();
  const orders = store.versioned("predictionOrders");
  const key = `withdrawal:solana:mainnet:${WALLET}:${UUID_A}`;
  await orders.compareAndSet(key, null, { version: 1, kind: "withdrawal", wallet: WALLET, requestId: UUID_A, amountRaw: "5000000", destinationAddress: WALLET, destinationChainId: SOLANA, reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000", phase: "sending", providerStatus: null, withdrawalId: null, completedRaw: null, txHashes: [], note: null, sends: 0, sendingUntil: null, createdAt: new Date(t0).toISOString(), updatedAt: new Date(t0).toISOString() });
  const checked = await checkWithdrawal(store, getPredictionProvider(), WALLET, UUID_A, ON, t0 + WITHDRAW_SEND_LEASE_MS + 10_000);
  assert.equal(checked.value.phase, "refused");
  assert.equal(checked.value.note, "NOT_SENT");
  assert.equal(agg.sends().length, 0);
});

/* ------------------------------------------------------------------ critic round 2 */

const record = (over) => ({ version: 1, kind: "withdrawal", wallet: WALLET, requestId: UUID_A, amountRaw: "5000000", destinationAddress: WALLET, destinationChainId: SOLANA, reviewedReceiveRaw: "4770000", reviewedFeeRaw: "230000", phase: "unknown", providerStatus: null, withdrawalId: null, completedRaw: null, txHashes: [], note: null, sends: 1, sendingUntil: null, ...over });

test("the money card draws only the signed-in wallet's money: a switch, a sign-out or a late answer for the wallet before draws nothing", () => {
  const forA = { wallet: WALLET, destination: WALLET, deposit: { state: "ready", address: "AGGsVm1111111111111111111111111111111111111" }, withdrawals: [] };
  assert.equal(fundingViewFor(forA, WALLET), forA, "the wallet it was read for");
  assert.equal(fundingViewFor(forA, WALLET_B), null, "switched to B: A's deposit address and destination are not drawn");
  assert.equal(fundingViewFor(forA, null), null, "signed out");
  assert.equal(fundingViewFor(forA, undefined), null);
  assert.equal(fundingViewFor(null, WALLET), null, "a failed read leaves nothing to draw, so the failure shows");
  assert.equal(fundingViewFor({ ...forA, wallet: "" }, ""), null, "no wallet is not a wallet");
});

test("the Review names the least the send may deliver: the bound the send is held to, in whole cents never above it", () => {
  const exact = String((4_770_000n * 9_900n + 9_999n) / 10_000n);
  assert.equal(exact, "4722300");
  assert.equal(receiveDropped("4770000", exact), false, "at the bound it goes");
  assert.equal(receiveDropped("4770000", String(BigInt(exact) - 1n)), true, "a micro-dollar below, it comes back to the person");
  assert.equal(receiveFloorRaw("4770000"), "4720000", "$4.72 — rounded down, so the figure named is never above the bound");
  assert.ok(BigInt(receiveFloorRaw("4770000")) <= BigInt(exact));
  assert.equal(receiveFloorRaw("1000000"), "990000");
  assert.equal(receiveFloorRaw(null), null);
  assert.equal(receiveFloorRaw("x"), null);
});

test("one send's lease outlasts all it may wait on: two sends and two refreshes", async (t) => {
  assert.ok(WITHDRAW_SEND_LEASE_MS >= 2 * WITHDRAW_SEND_TIMEOUT_MS + 2 * PROVIDER_REFRESH_TIMEOUT_MS, `${WITHDRAW_SEND_LEASE_MS} ms`);
  const agg = await aggServer(t, { withdraw: ["drop"] });
  const store = await linked(durableStore());
  const t0 = Date.now();
  const key = `withdrawal:solana:mainnet:${WALLET}:${UUID_A}`;
  /* A send took the record at t0 and is still waiting on a refresh and the send after a 401. */
  await store.versioned("predictionOrders").compareAndSet(key, null, record({ phase: "sending", sendingUntil: new Date(t0 + WITHDRAW_SEND_LEASE_MS).toISOString(), createdAt: new Date(t0).toISOString(), updatedAt: new Date(t0).toISOString() }));
  const during = await checkWithdrawal(store, getPredictionProvider(), WALLET, UUID_A, ON, t0 + 2 * WITHDRAW_SEND_TIMEOUT_MS + PROVIDER_REFRESH_TIMEOUT_MS);
  assert.equal(during.value.phase, "sending");
  assert.equal(agg.sends().length, 0, "while the first run may still be out, a second check sends nothing");
});

test("a withdrawal AGG accepts for another destination — another address, another chain, or none named — is not trusted: unknown, for good", async (t) => {
  for (const answer of ["acceptedElsewhere", "acceptedOtherChain", "acceptedNoDestination"]) {
    const agg = await aggServer(t, { withdraw: [answer], status: ["withdrawalCompleted"] });
    const store = await linked(durableStore());
    const provider = getPredictionProvider();
    const sent = await submitWithdrawal(store, provider, WALLET, INPUT, ON);
    assert.equal(sent.value.withdrawal.phase, "unknown", answer);
    assert.equal(sent.value.withdrawal.note, DESTINATION_MISMATCH, answer);
    assert.equal(sent.value.withdrawal.completedUsd, null);
    /* A later status read naming the wallet does not undo it; the id is kept, so nothing is sent again. */
    const checked = await checkWithdrawal(store, provider, WALLET, UUID_A, ON);
    assert.equal(checked.value.phase, "unknown", answer);
    assert.equal(checked.value.note, DESTINATION_MISMATCH);
    assert.equal(agg.sends().length, 1, `${answer}: sent once`);
    const another = await submitWithdrawal(store, provider, WALLET, { ...INPUT, requestId: UUID_B }, ON);
    assert.equal(another.code, "WITHDRAWAL_OPEN", "it holds a new one back while it is young");
  }
});

test("an unknown withdrawal older than the re-send window says so, is not sent again, and no longer holds a new one back", async (t) => {
  const agg = await aggServer(t);
  const store = await linked(durableStore());
  const provider = getPredictionProvider();
  const t0 = Date.now();
  const old = new Date(t0 - 7 * 3_600_000).toISOString();
  await store.versioned("predictionOrders").compareAndSet(`withdrawal:solana:mainnet:${WALLET}:${UUID_A}`, null, record({ createdAt: old, updatedAt: old }));
  const view = await readFunding(store, provider, WALLET, ON, t0);
  assert.equal(view.value.withdrawals[0].phase, "unknown");
  assert.equal(view.value.withdrawals[0].aged, true);
  const checked = await checkWithdrawal(store, provider, WALLET, UUID_A, ON, t0);
  assert.equal(checked.value.aged, true);
  assert.equal(agg.sends().length, 0, "not sent again on its own");
  const fresh = await submitWithdrawal(store, provider, WALLET, { ...INPUT, requestId: UUID_B }, ON, t0);
  assert.equal(fresh.ok, true, "a new withdrawal goes");
  assert.equal(fresh.value.outcome, "recorded");
  assert.equal(agg.sends().length, 1);
  assert.equal(agg.sends()[0].body.requestId, UUID_B, "under its own request id, never the old one's");
  const young = await readFunding(store, provider, WALLET, ON, t0);
  assert.equal(young.value.withdrawals.find((w) => w.requestId === UUID_B).aged, false);
});

test("an EVM proof is refused by the prediction routes; a Solana proof acts for its own address", () => {
  const evm = predictionProofWallet({ chain: "evm", address: "0x00000000000000000000000000000000000a6600" });
  assert.equal(evm.ok, false);
  assert.equal(evm.code, "UNAUTHORIZED");
  const sol = predictionProofWallet({ chain: "solana", address: WALLET });
  assert.deepEqual(sol, { ok: true, wallet: WALLET });
});

test("a withdrawal body that names a destination, or anything else the contract does not hold, is refused", () => {
  assert.equal(WithdrawBodySchema.safeParse(INPUT).success, true);
  assert.equal(WithdrawBodySchema.safeParse({ ...INPUT, destinationAddress: WALLET_B }).success, false, "no destination from the browser");
  assert.equal(WithdrawBodySchema.safeParse({ ...INPUT, destinationChainId: 137 }).success, false);
  assert.equal(WithdrawBodySchema.safeParse({ ...INPUT, requestId: "not-a-uuid" }).success, false);
  assert.equal(WithdrawPreviewBodySchema.safeParse({ amountRaw: "5000000" }).success, true);
  assert.equal(WithdrawPreviewBodySchema.safeParse({ max: true }).success, true);
  assert.equal(WithdrawPreviewBodySchema.safeParse({ amountRaw: "5000000", destinationAddress: WALLET_B }).success, false);
  assert.equal(WithdrawPreviewBodySchema.safeParse({ max: true, destinationAddress: WALLET_B }).success, false);
});

test("two wallets: B never gets A's deposit address, destination or withdrawal records", async (t) => {
  const A_DEPOSIT = "AGGsVm1111111111111111111111111111111111111";
  const B_DEPOSIT = "AGGsVmBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const agg = await aggServer(t, { addressFor: (sub) => (sub === "userB" ? B_DEPOSIT : A_DEPOSIT) });
  const store = await linked(await linked(durableStore(), WALLET, "userA"), WALLET_B, "userB");
  const provider = getPredictionProvider();
  const sentA = await submitWithdrawal(store, provider, WALLET, INPUT, ON);
  assert.equal(sentA.value.outcome, "recorded");

  const a = await readFunding(store, provider, WALLET, ON);
  const b = await readFunding(store, provider, WALLET_B, ON);
  assert.equal(a.value.deposit.address, A_DEPOSIT);
  assert.equal(b.value.deposit.address, B_DEPOSIT, "B's own managed wallet");
  assert.equal(b.value.destination, WALLET_B);
  assert.equal(a.value.withdrawals.length, 1);
  assert.equal(b.value.withdrawals.length, 0, "A's records are not B's");
  assert.equal((await checkWithdrawal(store, provider, WALLET_B, UUID_A, ON)).code, "NOT_FOUND", "nor can B check A's withdrawal");
  assert.ok(agg.seen.filter((s) => s.path === "/execution/deposit-addresses").length >= 2);

  /* B's own withdrawal under the same request id is B's, to B's wallet; A's is untouched. */
  const sentB = await submitWithdrawal(store, provider, WALLET_B, { ...INPUT, amountRaw: "3000000", reviewedReceiveRaw: "2770000" }, ON);
  assert.equal(sentB.ok, true);
  assert.equal(agg.sends().at(-1).body.destinationAddress, WALLET_B);
  assert.equal((await readFunding(store, provider, WALLET, ON)).value.withdrawals[0].amountUsd, 5);
  assert.equal((await readFunding(store, provider, WALLET_B, ON)).value.withdrawals[0].amountUsd, 3);
});
