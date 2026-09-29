import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceProofIdentity,
  evidenceProofSigningAvailable,
  evidenceReportHash,
  issueEvidenceProof,
  verifyEvidenceProof,
} from './evidence-proof.ts';
import { EvidenceBundleSchema } from './ai-schemas.ts';

const strategySpec = {
  schemaVersion: 1,
  name: 'BTC RSI recovery',
  universe: { provider: 'tradingview', symbol: 'BYBIT:BTCUSDT', assetClass: 'crypto' },
  timeframe: '4h',
  thesis: 'Test whether confirmed RSI recovery works above a long-term trend filter.',
  indicators: [
    { id: 'rsi-main', kind: 'rsi', source: 'close', length: 14 },
    { id: 'ema-filter', kind: 'ema', source: 'close', length: 200 },
  ],
  entry: {
    kind: 'all',
    rules: [
      {
        kind: 'compare',
        left: { kind: 'indicator', id: 'rsi-main' },
        operator: 'crosses_above',
        right: { kind: 'number', value: 30 },
      },
    ],
  },
  exit: {
    kind: 'any',
    rules: [
      {
        kind: 'compare',
        left: { kind: 'indicator', id: 'rsi-main' },
        operator: 'above',
        right: { kind: 'number', value: 55 },
      },
    ],
  },
  filters: [],
  stop: { kind: 'percent', value: 2.5 },
  sizing: { kind: 'risk_percent', value: 1 },
  riskPolicy: { maxDrawdownPercent: 12, maxOpenPositions: 1, allowShort: false },
  costModel: { commissionBps: 10, spreadBps: 5, slippageBps: 8, fundingBpsPerDay: 0 },
  assumptions: ['Orders fill after a confirmed bar close.'],
};

const payload = {
  telegramId: 123456,
  strategy: {
    spec: strategySpec,
    versionId: '11111111-1111-4111-8111-111111111111',
  },
  evidence: {
    quality: 'basic',
    verdict: 'mixed-evidence',
    score: 49,
    metrics: {
      trades: 25,
      netPnl: 100,
      totalReturnPercent: 1,
      benchmarkReturnPercent: 2,
      winRatePercent: 52,
      maxDrawdownPercent: 8,
      expectancy: 4,
      profitFactor: 1.2,
    },
    dimensions: {
      dataCompleteness: 10,
      sampleSize: 4,
      costs: 12,
      oos: 7,
      regimes: 0,
      leakage: 11,
      parameterSensitivity: 0,
      forwardEvidence: 0,
      reproducibility: 5,
      executionRealism: 0,
    },
    warnings: ['oos-self-attested', 'forward-evidence-missing'],
  },
};

const secret = 'strategy-lab-test-secret-32-bytes-minimum';

test('evidence proof binds user, full canonical spec, version, and deterministic report', () => {
  const proof = issueEvidenceProof(payload, secret);
  assert.match(proof, /^v2\.[a-f0-9]{64}$/);
  assert.equal(verifyEvidenceProof(payload, proof, secret), 'valid');
  assert.equal(verifyEvidenceProof({ ...payload, telegramId: 999 }, proof, secret), 'invalid');
  assert.equal(verifyEvidenceProof({
    ...payload,
    strategy: { ...payload.strategy, versionId: '22222222-2222-4222-8222-222222222222' },
  }, proof, secret), 'invalid');
  assert.equal(verifyEvidenceProof({
    ...payload,
    strategy: {
      ...payload.strategy,
      spec: {
        ...payload.strategy.spec,
        riskPolicy: { ...payload.strategy.spec.riskPolicy, maxDrawdownPercent: 13 },
      },
    },
  }, proof, secret), 'invalid');
  assert.equal(verifyEvidenceProof({
    ...payload,
    evidence: { ...payload.evidence, score: 50 },
  }, proof, secret), 'invalid');
});

test('evidence proof fails closed when the server secret is unavailable', () => {
  assert.equal(evidenceProofSigningAvailable('short'), false);
  assert.equal(evidenceProofSigningAvailable(secret), true);
  assert.equal(issueEvidenceProof(payload, 'short'), null);
  assert.equal(verifyEvidenceProof(payload, 'v2.' + '0'.repeat(64), 'short'), 'unconfigured');
  assert.equal(verifyEvidenceProof(payload, 'malformed', secret), 'invalid');
});

test('evidence schema rejects score and dimension tampering', () => {
  assert.equal(EvidenceBundleSchema.safeParse(payload.evidence).success, true);
  assert.equal(EvidenceBundleSchema.safeParse({
    ...payload.evidence,
    score: payload.evidence.score + 1,
  }).success, false);
});

test('persisted evidence proof binds exact experiment, report, and canonical evidence hash', () => {
  const evidenceIdentity = createEvidenceProofIdentity(payload.evidence, {
    experimentId: '33333333-3333-4333-8333-333333333333',
    evidenceReportId: '44444444-4444-4444-8444-444444444444',
  });
  assert.equal(evidenceIdentity.evidenceHash, evidenceReportHash(payload.evidence));
  const persisted = { ...payload, evidenceIdentity };
  const proof = issueEvidenceProof(persisted, secret);
  assert.match(proof, /^v2\.[a-f0-9]{64}$/);
  assert.equal(verifyEvidenceProof(persisted, proof, secret), 'valid');
  assert.equal(verifyEvidenceProof({
    ...persisted,
    evidenceIdentity: {
      ...evidenceIdentity,
      experimentId: '55555555-5555-4555-8555-555555555555',
    },
  }, proof, secret), 'invalid');
  assert.equal(verifyEvidenceProof({
    ...persisted,
    evidenceIdentity: {
      ...evidenceIdentity,
      evidenceReportId: '66666666-6666-4666-8666-666666666666',
    },
  }, proof, secret), 'invalid');
  assert.equal(verifyEvidenceProof({
    ...persisted,
    evidenceIdentity: { ...evidenceIdentity, evidenceHash: '0'.repeat(64) },
  }, proof, secret), 'invalid');
  assert.equal(issueEvidenceProof({
    ...payload,
    evidenceIdentity: {
      experimentId: evidenceIdentity.experimentId,
      evidenceReportId: null,
      evidenceHash: evidenceIdentity.evidenceHash,
    },
  }, secret), null);
});
