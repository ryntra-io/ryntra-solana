import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formalizeStrategy, reviewEvidence } from './openai.ts';
import { applyReviewChanges } from './ai-schemas.ts';
import { needsDevelopmentRepository } from "../development-repository.mjs";

const aiProposal = {
  proposal: {
    schemaVersion: 1,
    name: 'BTC RSI recovery',
    universe: { provider: 'tradingview', symbol: 'BYBIT:BTCUSDT', assetClass: 'crypto' },
    timeframe: '4h',
    thesis: 'Test whether confirmed RSI recovery works above a long-term trend filter.',
    indicators: [
      { id: 'rsi-main', kind: 'rsi', source: 'close', length: 14 },
      { id: 'ema-filter', kind: 'ema', source: 'close', length: 200 },
    ],
    entryLogic: 'all',
    entryRules: [
      { left: { kind: 'indicator', id: 'rsi-main' }, operator: 'crosses_above', right: { kind: 'number', value: 30 } },
      { left: { kind: 'price', source: 'close' }, operator: 'above', right: { kind: 'indicator', id: 'ema-filter' } },
    ],
    exitLogic: 'any',
    exitRules: [
      { left: { kind: 'indicator', id: 'rsi-main' }, operator: 'above', right: { kind: 'number', value: 55 } },
    ],
    filters: [],
    stop: { kind: 'percent', value: 2.5 },
    sizing: { kind: 'risk_percent', value: 1 },
    riskPolicy: { maxDrawdownPercent: 12, maxOpenPositions: 1, allowShort: false },
    costModel: { commissionBps: 10, spreadBps: 5, slippageBps: 8, fundingBpsPerDay: 0 },
    assumptions: ['Orders fill after a confirmed bar close.'],
  },
  assumptionsAdded: ['No intrabar execution is assumed.'],
  unsupported: [],
  clarificationQuestions: [],
};

const strategySpec = {
  schemaVersion: 1,
  name: aiProposal.proposal.name,
  universe: aiProposal.proposal.universe,
  timeframe: aiProposal.proposal.timeframe,
  thesis: aiProposal.proposal.thesis,
  indicators: aiProposal.proposal.indicators,
  entry: {
    kind: aiProposal.proposal.entryLogic,
    rules: aiProposal.proposal.entryRules.map((rule) => ({ kind: 'compare', ...rule })),
  },
  exit: {
    kind: aiProposal.proposal.exitLogic,
    rules: aiProposal.proposal.exitRules.map((rule) => ({ kind: 'compare', ...rule })),
  },
  filters: [],
  stop: aiProposal.proposal.stop,
  sizing: aiProposal.proposal.sizing,
  riskPolicy: aiProposal.proposal.riskPolicy,
  costModel: aiProposal.proposal.costModel,
  assumptions: aiProposal.proposal.assumptions,
};

const evidence = {
  quality: 'basic',
  verdict: 'mixed-evidence',
  score: 47,
  metrics: {
    trades: 32,
    netPnl: 120,
    totalReturnPercent: 1.2,
    benchmarkReturnPercent: 8,
    winRatePercent: 55,
    maxDrawdownPercent: 9,
    expectancy: 3.75,
    profitFactor: 1.1,
  },
  dimensions: {
    dataCompleteness: 10,
    sampleSize: 4,
    costs: 12,
    oos: 7,
    regimes: 6,
    leakage: 0,
    parameterSensitivity: 0,
    forwardEvidence: 0,
    reproducibility: 5,
    executionRealism: 3,
  },
  warnings: ['forward-evidence-missing', 'leakage-risk-blocking'],
};

const reviewProposal = {
  explanation: 'Returns weaken after costs and the sample has no forward evidence.',
  evidenceReferences: ['metrics.totalReturnPercent', 'warnings.forward-evidence-missing'],
  risks: ['The result may be overfit to the revealed test window.'],
  nextHypothesis: {
    statement: 'Require a rising EMA 200 at entry.',
    rationale: 'This tests whether trend regime explains the unstable result.',
    changes: [{ kind: 'indicator-length', indicatorId: 'ema-filter', value: 220 }],
    expectedObservation: 'Fewer trades with lower drawdown across validation windows.',
    falsificationCriterion: 'Reject if validation drawdown does not improve by at least 10%.',
  },
};

function validBrief(overrides = {}) {
  return {
    symbol: 'BYBIT:BTCUSDT',
    timeframe: '4h',
    assetClass: 'crypto',
    thesis: 'RSI recovery above EMA 200',
    entryIdea: 'RSI crosses above 30 while close is above EMA 200',
    exitIdea: 'Exit above RSI 55',
    stopPercent: 2.5,
    riskPercent: 1,
    maxDrawdownPercent: 12,
    costModel: { commissionBps: 10, spreadBps: 5, slippageBps: 8, fundingBpsPerDay: 0 },
    ...overrides,
  };
}

function mockClient(outputParsed, providerOptions = {}) {
  const calls = [];
  return {
    calls,
    responses: {
      async parse(body, requestOptions) {
        calls.push({ body, options: requestOptions });
        if (providerOptions.providerError) throw providerOptions.providerError;
        return {
          id: 'resp_test_123',
          output_parsed: outputParsed,
          output: providerOptions.output,
          usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
        };
      },
    },
  };
}

test('staging smoke cannot bypass the hardened Strategy Lab OpenAI helper', { skip: needsDevelopmentRepository("the smoke script scripts/strategy-lab-openai-smoke.mjs") }, async () => {
  const source = await readFile(new URL('../../scripts/strategy-lab-openai-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /formalizeStrategy/);
  assert.match(source, /reviewEvidence/);
  assert.doesNotMatch(source, /import\s+OpenAI\s+from/);
  assert.doesNotMatch(source, /responses\.(?:create|parse)\s*\(/);
});

test('formalization uses Direct Responses API contract and returns a validated StrategySpec', async () => {
  const client = mockClient(aiProposal);
  const result = await formalizeStrategy({
    userKey: 'telegram:123456',
    locale: 'uk',
    brief: validBrief(),
  }, client);

  assert.equal(result.ok, true);
  assert.equal(result.strategy.entry.kind, 'all');
  assert.equal(result.strategy.indicators.length, 2);
  assert.equal(result.audit.responseId, 'resp_test_123');

  const request = client.calls[0].body;
  assert.equal(request.store, false);
  assert.equal(request.model, 'gpt-5.6-terra');
  assert.equal(request.reasoning.effort, 'medium');
  assert.match(request.safety_identifier, /^[a-f0-9]{64}$/);
  assert.notEqual(request.safety_identifier, 'telegram:123456');
  assert.equal('tools' in request, false);
  assert.match(request.instructions, /untrusted data/i);
});

test('formalization requires an explicit asset class before any AI request', async () => {
  const client = mockClient(aiProposal);
  const { assetClass: _assetClass, ...brief } = validBrief();
  const result = await formalizeStrategy({
    userKey: 'telegram:123456',
    locale: 'en',
    brief,
  }, client);

  assert.deepEqual(result, { ok: false, error: 'invalid-request' });
  assert.equal(client.calls.length, 0);
});

test('formalization requires explicit drawdown and cost anchors before any AI request', async () => {
  const invalidBriefs = [
    (() => { const value = validBrief(); delete value.maxDrawdownPercent; return value; })(),
    (() => { const value = validBrief(); delete value.costModel; return value; })(),
    validBrief({ maxDrawdownPercent: 51 }),
    validBrief({ costModel: { commissionBps: 501, spreadBps: 5, slippageBps: 8, fundingBpsPerDay: 0 } }),
  ];
  for (const brief of invalidBriefs) {
    const client = mockClient(aiProposal);
    const result = await formalizeStrategy({
      userKey: 'telegram:123456',
      locale: 'en',
      brief,
    }, client);
    assert.deepEqual(result, { ok: false, error: 'invalid-request' });
    assert.equal(client.calls.length, 0);
  }
});

test('formalization refusal or strict canonical constraint failure degrades safely', async () => {
  const refused = await formalizeStrategy({
    userKey: 'telegram:7',
    locale: 'en',
    brief: validBrief(),
  }, mockClient(null, { output: [{ content: [{ type: 'refusal', refusal: 'Safety refusal.' }] }] }));
  assert.deepEqual(refused, { ok: false, error: 'ai-refused' });

  const missing = await formalizeStrategy({
    userKey: 'telegram:7',
    locale: 'en',
    brief: validBrief(),
  }, mockClient(null));
  assert.deepEqual(missing, { ok: false, error: 'invalid-ai-output' });

  const invalidDrafts = [
    (draft) => { draft.proposal.universe.symbol = 'COINBASE:ETHUSD'; },
    (draft) => { draft.proposal.universe.symbol = 'bad symbol'; },
    (draft) => { draft.proposal.timeframe = '0m'; },
    (draft) => { draft.proposal.thesis = 'x'.repeat(501); },
    (draft) => { draft.proposal.indicators[0].length = 1001; },
    (draft) => { draft.proposal.riskPolicy.maxOpenPositions = 2; },
    (draft) => { draft.proposal.riskPolicy.maxDrawdownPercent = 13; },
    (draft) => { draft.proposal.costModel.commissionBps = 11; },
    (draft) => { draft.proposal.costModel.slippageBps = 501; },
    (draft) => { draft.proposal.assumptions = Array.from({ length: 13 }, () => 'bounded assumption'); },
  ];
  for (const mutate of invalidDrafts) {
    const invalid = structuredClone(aiProposal);
    mutate(invalid);
    const rejected = await formalizeStrategy({
      userKey: 'telegram:8',
      locale: 'en',
      brief: validBrief(),
    }, mockClient(invalid));
    assert.deepEqual(rejected, { ok: false, error: 'invalid-ai-output' });
  }
});

test('provider timeout, quota, rate-limit and availability failures stay distinct', async () => {
  const cases = [
    {
      providerError: Object.assign(new Error('timed out'), { name: 'APIConnectionTimeoutError' }),
      expected: 'ai-timeout',
    },
    {
      providerError: Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' }),
      expected: 'ai-quota',
    },
    {
      providerError: Object.assign(new Error('slow down'), { status: 429, code: 'rate_limit_exceeded' }),
      expected: 'ai-rate-limited',
    },
    {
      providerError: Object.assign(new Error('upstream'), { status: 500 }),
      expected: 'ai-unavailable',
    },
    {
      providerError: new SyntaxError('malformed structured JSON'),
      expected: 'invalid-ai-output',
    },
    {
      providerError: Object.assign(new Error('schema mismatch'), { name: 'ZodError' }),
      expected: 'invalid-ai-output',
    },
  ];

  for (const item of cases) {
    const result = await formalizeStrategy({
      userKey: 'telegram:9',
      locale: 'en',
      brief: validBrief(),
    }, mockClient(aiProposal, { providerError: item.providerError }));
    assert.deepEqual(result, { ok: false, error: item.expected });
  }
});

test('review rejects schema-valid but semantically invented evidence references', async () => {
  const unsafe = structuredClone(reviewProposal);
  unsafe.evidenceReferences = ['metrics.sharpeRatio'];
  const result = await reviewEvidence({
    userKey: 'telegram:10',
    locale: 'en',
    strategy: { spec: strategySpec, versionId: '11111111-1111-4111-8111-111111111111' },
    evidence,
  }, mockClient(unsafe));
  assert.deepEqual(result, { ok: false, error: 'invalid-ai-output' });
});

test('adversarial review receives the full canonical spec and exact version binding', async () => {
  const client = mockClient(reviewProposal);
  const strategy = {
    spec: strategySpec,
    versionId: '11111111-1111-4111-8111-111111111111',
  };
  const result = await reviewEvidence({
    userKey: 'telegram:123456',
    locale: 'en',
    strategy,
    evidence,
  }, client);

  assert.equal(result.ok, true);
  assert.notEqual(result.proposal.nextHypothesis.statement, reviewProposal.nextHypothesis.statement);
  assert.match(result.proposal.nextHypothesis.statement, /paper-only change set/i);
  assert.equal(client.calls[0].body.model, 'gpt-5.6-sol');
  assert.equal(client.calls[0].body.reasoning.effort, 'high');
  assert.equal(client.calls[0].body.store, false);
  assert.equal('tools' in client.calls[0].body, false);
  const payload = JSON.parse(client.calls[0].body.input);
  assert.deepEqual(payload.strategy, strategy);
  assert.equal(payload.strategy.spec.entry.rules[0].right.value, 30);
});

test('adversarial review rejects an invalid spec or version before any AI request', async () => {
  for (const strategy of [
    { spec: { ...strategySpec, timeframe: '0m' }, versionId: '11111111-1111-4111-8111-111111111111' },
    {
      spec: {
        ...strategySpec,
        riskPolicy: { ...strategySpec.riskPolicy, allowShort: true },
      },
      versionId: '11111111-1111-4111-8111-111111111111',
    },
    { spec: strategySpec, versionId: 'not-a-uuid' },
  ]) {
    const client = mockClient(reviewProposal);
    const result = await reviewEvidence({
      userKey: 'telegram:123456',
      locale: 'en',
      strategy,
      evidence,
    }, client);
    assert.deepEqual(result, { ok: false, error: 'invalid-request' });
    assert.equal(client.calls.length, 0);
  }
});

test('review changes derive exact changed fields without mutating the accepted version', () => {
  const proposal = structuredClone(reviewProposal);
  proposal.nextHypothesis.changes.push({ kind: 'stop-percent', value: 3 });
  const next = applyReviewChanges(strategySpec, proposal);

  assert.equal(next.ok, true);
  assert.equal(next.strategy.indicators.find((item) => item.id === 'ema-filter').length, 220);
  assert.equal(next.strategy.stop.value, 3);
  assert.equal(strategySpec.indicators.find((item) => item.id === 'ema-filter').length, 200);
  assert.deepEqual(next.changedFields, ['indicators.ema-filter.length', 'stop.value']);
});

test('review changes reject GPT-declared fields and effective no-ops', () => {
  const declared = structuredClone(reviewProposal);
  declared.nextHypothesis.changedFields = ['riskPolicy.allowShort'];
  assert.deepEqual(applyReviewChanges(strategySpec, declared), { ok: false, error: 'invalid-proposal' });

  const noOp = structuredClone(reviewProposal);
  noOp.nextHypothesis.changes[0].value = 200;
  assert.deepEqual(applyReviewChanges(strategySpec, noOp), { ok: false, error: 'unsupported-change' });
});

test('AI-authored free text is never exposed through formalization in any locale', async () => {
  const markers = [
    'Гарантований прибуток без ризику',
    'Гарантированная прибыль без риска',
    'أرباح مضمونة بلا مخاطر',
    'ganancia garantizada sin riesgo',
  ];
  const unsafe = structuredClone(aiProposal);
  unsafe.proposal.name = markers[0];
  unsafe.proposal.thesis = markers.join(' | ');
  unsafe.proposal.assumptions = markers;
  unsafe.assumptionsAdded = [markers[1]];
  unsafe.unsupported = [markers[2]];
  unsafe.clarificationQuestions = [markers[3]];
  const humanThesis = 'Test whether this remains profitable after realistic costs.';

  const result = await formalizeStrategy({
    userKey: 'telegram:11',
    locale: 'ar',
    brief: validBrief({ thesis: humanThesis, assumptions: ['Human-owned confirmed-bar assumption.'] }),
  }, mockClient(unsafe));

  assert.equal(result.ok, true);
  assert.equal(result.strategy.thesis, humanThesis);
  assert.equal(result.envelope.proposal.thesis, humanThesis);
  assert.equal(result.strategy.name, 'BYBIT:BTCUSDT paper hypothesis');
  const serialized = JSON.stringify({ strategy: result.strategy, envelope: result.envelope });
  for (const marker of markers) assert.equal(serialized.includes(marker), false);
});

test('review keeps only validated references and changes, never AI-authored narrative', async () => {
  const markers = [
    'Profit factor is a standard metric, not a profit promise.',
    'Гарантований прибуток без ризику.',
    'أرباح مضمونة بلا مخاطر.',
    'ganancia garantizada sin riesgo.',
  ];
  const unsafe = structuredClone(reviewProposal);
  unsafe.explanation = markers.join(' ');
  unsafe.risks = [markers[1], markers[2]];
  unsafe.nextHypothesis.statement = markers[3];
  unsafe.nextHypothesis.rationale = markers[0];
  unsafe.nextHypothesis.expectedObservation = markers[1];
  unsafe.nextHypothesis.falsificationCriterion = markers[2];

  const result = await reviewEvidence({
    userKey: 'telegram:12',
    locale: 'uk',
    strategy: { spec: strategySpec, versionId: '11111111-1111-4111-8111-111111111111' },
    evidence,
  }, mockClient(unsafe));

  assert.equal(result.ok, true);
  assert.deepEqual(result.proposal.evidenceReferences, reviewProposal.evidenceReferences);
  assert.deepEqual(result.proposal.nextHypothesis.changes, reviewProposal.nextHypothesis.changes);
  const serialized = JSON.stringify(result.proposal);
  for (const marker of markers) assert.equal(serialized.includes(marker), false);
});
