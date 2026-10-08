import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  conditionFromParam,
  metricLabel,
  metricOf,
  onUnknownOf,
  thresholdText,
  withCondition,
} from './evidence-model.ts'

const METRICS = [
  {
    id: 'dex_volume_usd',
    provider: 'nansen',
    unit: 'usd',
    aggregation: 'whole-market',
    windows: ['24h', '7d'],
    conditionModes: ['advisory', 'required'],
    words: {
      en: { label: 'DEX volume', meaning: '', sentence: '' },
      uk: { label: 'Обсяг на DEX', meaning: '', sentence: '' },
    },
  },
  {
    id: 'mint_authority',
    provider: 'ddxyz',
    unit: 'flag',
    aggregation: 'whole-market',
    windows: ['now'],
    conditionModes: ['advisory', 'required'],
    words: {
      en: { label: 'Mint authority', meaning: '', sentence: '' },
      uk: { label: 'Право випуску', meaning: '', sentence: '' },
    },
  },
  {
    id: 'top10_holder_share_pct',
    provider: 'ddxyz',
    unit: 'percent',
    aggregation: 'whole-market',
    windows: ['now'],
    conditionModes: ['advisory', 'required'],
    words: {
      en: { label: 'Top-10 share', meaning: '', sentence: '' },
      uk: { label: 'Частка топ-10', meaning: '', sentence: '' },
    },
  },
]
const FLAGS = { present: 'present', renounced: 'renounced' }

test('a carried rule is read as the web builder reads it: advisory, the figure to two significant digits', () => {
  assert.deepEqual(conditionFromParam('dex_volume_usd:24h:lt:1234567'), {
    metric: 'dex_volume_usd',
    window: '24h',
    operator: 'lt',
    threshold: 1_200_000,
    mode: 'advisory',
    onUnknown: 'warn',
  })
  assert.equal(conditionFromParam('top10_holder_share_pct:now:gt:35.5')?.threshold, 35)
  assert.equal(conditionFromParam('dex_net_volume_usd:7d:lt:-2500')?.threshold, -2500)
  for (const junk of [
    null,
    '',
    'dex_volume_usd:1h:lt:5',
    'dex_volume_usd:24h:between:5',
    'DEX:24h:lt:5',
    'dex_volume_usd:24h:lt:1e9',
  ]) {
    assert.equal(conditionFromParam(junk), null, String(junk))
  }
  assert.equal(onUnknownOf('required'), 'block')
  assert.equal(onUnknownOf('advisory'), 'warn')
})

test('a carried rule replaces the plan’s own on the same metric and window, and joins the others', () => {
  const own = [
    {
      metric: 'dex_volume_usd',
      window: '24h',
      operator: 'gt',
      threshold: 5_000_000,
      mode: 'required',
      onUnknown: 'block',
    },
    { metric: 'mint_authority', window: 'now', operator: 'lt', threshold: 1, mode: 'required', onUnknown: 'block' },
  ]
  const carried = {
    metric: 'dex_volume_usd',
    window: '24h',
    operator: 'lt',
    threshold: 1_000_000,
    mode: 'advisory',
    onUnknown: 'warn',
  }
  assert.deepEqual(withCondition(own, carried), [own[1], carried])
  const weekly = { ...carried, window: '7d' }
  assert.deepEqual(withCondition(own, weekly), [...own, weekly])
})

test('a rule in the reader’s words and its unit', () => {
  const volume = metricOf(METRICS, 'dex_volume_usd')
  assert.equal(metricLabel(volume, 'dex_volume_usd', 'uk'), 'Обсяг на DEX')
  assert.equal(metricLabel(null, 'whale_net_flow_usd', 'en'), 'whale net flow usd')
  assert.equal(thresholdText(volume, 1_000_000, FLAGS, 'en'), '$1M')
  assert.equal(thresholdText(volume, -2500, FLAGS, 'en'), '−$2.5K')
  assert.equal(thresholdText(metricOf(METRICS, 'top10_holder_share_pct'), 35, FLAGS, 'en'), '35%')
  assert.equal(thresholdText(metricOf(METRICS, 'mint_authority'), 1, FLAGS, 'en'), 'present')
  assert.equal(thresholdText(metricOf(METRICS, 'mint_authority'), 0, FLAGS, 'en'), 'renounced')
  assert.equal(thresholdText(null, 12, FLAGS, 'en'), '12')
  assert.equal(thresholdText(volume, 1_500_000, FLAGS, 'uk'), '$1,5M')
  assert.equal(thresholdText(metricOf(METRICS, 'top10_holder_share_pct'), 12.5, FLAGS, 'uk'), '12,5%')
})
