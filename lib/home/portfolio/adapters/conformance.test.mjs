import assert from "node:assert/strict";
import test from "node:test";

import { compareDecimal, decimal } from "../decimal.ts";
import { normalizeAgentBudgetEntry } from "./agent-control.ts";
import { normalizeArcusPosition } from "./arcus.ts";
import { expectConformant } from "./conformance.fixture.mjs";
import { normalizePaperTrade } from "./paper.ts";
import { normalizeRobinhoodEvmHolding } from "./robinhood-evm.ts";
import { normalizeSolanaHolding } from "./solana.ts";
import { normalizeStellarHolding } from "./stellar.ts";

const observedAt = "2026-08-22T10:00:00.000Z";
const assetRef = "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function paperTrade(overrides = {}) {
  return {
    id: "paper-trade-1",
    market: "BTC-USD",
    side: "long",
    entry_price: 60000,
    size: 0.1,
    sl: 59000,
    tp: null,
    status: "open",
    exit_price: null,
    exit_reason: null,
    fees: 2,
    pnl: null,
    checklist: null,
    reason: "paper plan",
    followed_plan: null,
    mistake_tag: null,
    lesson: null,
    opened_at: observedAt,
    closed_at: null,
    ...overrides,
  };
}

test("PaperTrade normalizes identity only and refuses to invent exact float exposure", () => {
  const records = expectConformant(normalizePaperTrade({
    ownerRef: "owner_example",
    accountRef: "paper_account",
    sourceId: "paper",
    sourceVersion: "1",
    observedAt,
    evidenceRefs: ["evidence:paper:1"],
    trade: paperTrade(),
  }));
  assert.equal(records.length, 1);
  assert.equal(records[0].positionType, "PAPER");
  assert.equal(records[0].book, "PAPER");
  assert.equal(records[0].exposureLegs[0].notional, null);
  assert.match(records[0].exposureLegs[0].unknownReason, /exact decimal/i);

  assert.deepEqual(normalizePaperTrade({
    ownerRef: "owner_example",
    accountRef: "paper_account",
    sourceId: "paper",
    sourceVersion: "1",
    observedAt,
    evidenceRefs: ["evidence:paper:1"],
    trade: paperTrade({ status: "closed", closed_at: observedAt, exit_price: 61000, exit_reason: "manual", pnl: 98 }),
  }), { ok: true, records: [] });
});

test("ArcusPosition is an aggregate PERP slot whose notional is independent of valuation", () => {
  const records = expectConformant(normalizeArcusPosition({
    ownerRef: "owner_example",
    accountRef: "0x1111111111111111111111111111111111111111",
    connectionId: "arcus_connection",
    sourceId: "arcus",
    sourceVersion: null,
    observedAt,
    evidenceRefs: ["evidence:arcus:positions"],
    networkRef: "robinhood-chain",
    instrumentKey: "BTC-USD-PERP",
    underlyingKey: "BTC",
    representationKey: "arcus:BTC-USD-PERP",
    quoteCurrency: "USD",
    freshnessPolicy: { maxAgeSeconds: 10 },
    position: {
      marketDisplayName: "BTC-USD",
      side: "SHORT",
      size: "2",
      averageEntryPrice: "90",
      unrealizedPnl: "5",
      markPrice: "100",
      cumulativeFunding: { sinceOpen: "1" },
    },
  }));
  assert.equal(records[0].positionType, "PERP");
  assert.equal(records[0].valuationContribution, "NONE");
  assert.equal(records[0].exposureLegs[0].direction, "SHORT");
  assert.equal(compareDecimal(records[0].exposureLegs[0].notional.amount, decimal("200", 0)), 0);
});

test("Robinhood/EVM holding requires the identity and time its UI-local row drops", () => {
  const incomplete = normalizeRobinhoodEvmHolding({
    ownerRef: "owner_example",
    accountRef: "0x1111111111111111111111111111111111111111",
    networkRef: "robinhood-chain",
    sourceId: "robinhood-wallet",
    connectionId: "wallet_connection",
    sourcePositionKey: null,
    positionSlotKey: null,
    observedAt: null,
    evidenceRefs: ["evidence:onchain:balance"],
    instrumentKey: "TSLA",
    underlyingKey: "TSLA",
    representationKey: "eip155:46630/erc20:0x1111111111111111111111111111111111111111",
    positionType: "RWA",
    amountRaw: "5000000",
    decimals: 6,
    price: null,
  });
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) assert.equal(incomplete.code, "SOURCE_CONTRACT_INSUFFICIENT");

  const records = expectConformant(normalizeRobinhoodEvmHolding({
    ownerRef: "owner_example",
    accountRef: "0x1111111111111111111111111111111111111111",
    networkRef: "robinhood-chain",
    sourceId: "robinhood-wallet",
    connectionId: "wallet_connection",
    sourcePositionKey: "balance:token-account",
    positionSlotKey: "balance:token-account",
    observedAt,
    evidenceRefs: ["evidence:onchain:balance"],
    instrumentKey: "TSLA",
    underlyingKey: "TSLA",
    representationKey: "eip155:46630/erc20:0x1111111111111111111111111111111111111111",
    positionType: "RWA",
    amountRaw: "5000000",
    decimals: 6,
    price: {
      value: { units: "2000", scale: 2 },
      currency: "USD",
      sourceRef: "price:arcus:TSLA",
      observedAt,
      validUntil: null,
      freshnessPolicy: { maxAgeSeconds: 120 },
    },
  }));
  assert.equal(records[0].valuation.state, "PRICED");
  assert.equal(compareDecimal(records[0].valuation.value.amount, decimal("100", 0)), 0);
});

test("Solana current route shape fails closed without token-account identity and snapshot time", () => {
  const currentShape = normalizeSolanaHolding({
    ownerRef: "owner_example",
    sourceId: "solana-holdings",
    connectionId: "solana_connection",
    networkRef: "solana:devnet",
    owner: "11111111111111111111111111111111",
    mint: "So11111111111111111111111111111111111111112",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    amountRaw: "1000000000",
    decimals: 9,
    tokenAccountRef: null,
    observedAt: null,
    evidenceRefs: ["evidence:solana:holding"],
  });
  assert.equal(currentShape.ok, false);
  if (!currentShape.ok) assert.equal(currentShape.code, "SOURCE_IDENTITY_UNAVAILABLE");

  const records = expectConformant(normalizeSolanaHolding({
    ownerRef: "owner_example",
    sourceId: "solana-holdings",
    connectionId: "solana_connection",
    networkRef: "solana:devnet",
    owner: "11111111111111111111111111111111",
    mint: "So11111111111111111111111111111111111111112",
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    amountRaw: "1000000000",
    decimals: 9,
    tokenAccountRef: "token-account-1",
    observedAt,
    evidenceRefs: ["evidence:solana:holding"],
  }));
  assert.equal(records[0].positionType, "WALLET_ASSET");
  assert.equal(records[0].valuation.state, "UNPRICED");
});

test("resolved Stellar holding normalizes while unresolved evidence remains non-positive", () => {
  const asset = { model: "CLASSIC", code: "USDC", issuer: "GISSUER", contractId: null, decimals: 7, native: false };
  const records = expectConformant(normalizeStellarHolding({
    ownerRef: "owner_example",
    sourceId: "stellar-horizon",
    connectionId: "stellar_connection",
    networkRef: "stellar:public",
    asset,
    evidence: {
      state: "FRESH",
      data: {
        account: "GACCOUNT",
        trustlineRequired: true,
        trustlineExists: true,
        authorized: true,
        balance: "1250.0000000",
        limit: "922337203685.4775807",
        additionalSubentries: 0,
        subentryCount: 1,
      },
      sources: [{ ref: "stellar:public:horizon:/accounts/GACCOUNT", label: "Horizon account" }],
      observedAt,
      ageSeconds: 0,
      maxAgeSeconds: 30,
    },
  }));
  assert.equal(records[0].quantity.amount.units, "12500000000");

  const unresolved = normalizeStellarHolding({
    ownerRef: "owner_example",
    sourceId: "stellar-horizon",
    connectionId: "stellar_connection",
    networkRef: "stellar:public",
    asset,
    evidence: {
      state: "UNAVAILABLE",
      data: null,
      sources: [],
      observedAt,
      reason: "Horizon did not answer",
    },
  });
  assert.equal(unresolved.ok, false);
  if (!unresolved.ok) assert.equal(unresolved.code, "UNSUPPORTED_SOURCE_STATE");
});

function ledger(state = "RESERVED") {
  return {
    schemaVersion: "1.0.0",
    ledgerId: "ledger-1",
    version: 1,
    ownerRef: "owner_example",
    mandateRef: { id: "mandate-1", version: 1 },
    assetRef,
    period: { startsAt: "2026-08-22T00:00:00.000Z", endsAt: "2026-08-23T00:00:00.000Z" },
    allocated: "1000",
    available: "500",
    entries: [{ entryId: "entry-1", actionId: "action-1", state, amount: "500", updatedAt: observedAt }],
  };
}

test("AgentBudgetLedger entries are distinct reservations and terminal states never become holdings", () => {
  const records = expectConformant(normalizeAgentBudgetEntry({
    ledger: ledger("RESERVED"),
    entryId: "entry-1",
    sourceId: "agent-control-budget",
    connectionId: null,
    assetScale: 6,
    evidenceRefs: ["evidence:agent-ledger"],
  }));
  assert.equal(records[0].positionType, "AGENT_COMMITMENT");
  assert.equal(records[0].positionSlotKey, "action-1");
  assert.equal(records[0].cashState, "COMMITTED");

  assert.deepEqual(normalizeAgentBudgetEntry({
    ledger: ledger("RELEASED"),
    entryId: "entry-1",
    sourceId: "agent-control-budget",
    connectionId: null,
    assetScale: 6,
    evidenceRefs: ["evidence:agent-ledger"],
  }), { ok: true, records: [] });
});
