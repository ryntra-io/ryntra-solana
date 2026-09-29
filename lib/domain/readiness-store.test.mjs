// Run from repo root: node --test --test-isolation=none lib/domain/readiness-store.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { trrAppend, trrList } from "./readiness-store.ts";

const receipt = {
  schemaVersion: 1,
  kind: "trade-readiness",
  evaluatedAt: 1_750_000_000_000,
  evaluator: { id: "evaluate-readiness", version: 1 },
  policy: {
    id: "planned-trade",
    version: 1,
    config: { maxRiskPct: 2, requiresThesis: true, requiresStop: true },
  },
  instrument: {
    chain: "robinhood-chain",
    kind: "rwa-perp",
    base: "NVDA",
    quote: "USDG",
  },
  capability: {
    route: "arcus-perps-clob",
    state: {
      protocol: "live",
      ryntra: "paper",
      user: "unknown",
      verifiedAt: "2026-07-14",
      source: "official-docs",
    },
  },
  signals: [],
  plan: {
    thesis: "Breakout retest with bounded downside",
    entry: "100",
    stop: "95",
    invalidation: "Close below support",
    targets: ["110"],
    riskPct: 1,
  },
  compliance: { status: "unknown", source: "unverified", checkedAt: null },
  intent: {
    kind: "paper-order",
    route: "arcus-perps-clob",
    instrument: {
      chain: "robinhood-chain",
      kind: "rwa-perp",
      base: "NVDA",
      quote: "USDG",
    },
    side: "buy",
    size: "1",
    limitPrice: "100",
    executionMode: "wallet-signed",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    createdAt: 1_750_000_000_000,
  },
  verdict: { level: "caution", reasons: ["compliance-unknown"] },
};

test("trrAppend sends one immutable DecisionReceipt v1 envelope and preserves the typed RPC result", async () => {
  const stored = {
    id: "22222222-2222-4222-8222-222222222222",
    receiptKey: "33333333-3333-4333-8333-333333333333",
    recordedAt: "2026-07-14T13:30:00.000Z",
    receipt,
  };
  let observed;
  const call = async (fn, args) => {
    observed = { fn, args };
    return { ok: true, data: stored };
  };

  const result = await trrAppend(call, {
    telegramId: 42,
    receiptKey: stored.receiptKey,
    receipt,
  });

  assert.deepEqual(observed, {
    fn: "trr_append",
    args: {
      p_telegram_id: 42,
      p_receipt_key: stored.receiptKey,
      p_receipt: receipt,
    },
  });
  assert.deepEqual(result, { ok: true, data: stored });
});

test("trrList keeps database conflicts and failures explicit", async () => {
  const failure = { ok: false, error: "decision receipt idempotency conflict" };
  const call = async () => failure;
  assert.deepEqual(await trrList(call, 42, 25), failure);
});
