import { useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/button'
import { ReceiptCard } from '@/components/receipt-card'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import { ruleWhenLine } from '@/features/autoinvest/words'
import { dollarsText } from '@/features/invest/buy-model'
import { lowerFirst, RULE_TICKET_COPY } from '@/features/trade/rule-ticket'
import { RuleChip, RuleReviewRow } from '@/screens/trade/rule-parts'
import type { AutoinvestRule, RuleAssetRead, RuleFloorCheck, RuleOccurrence } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'

import { AutoinvestSheet, BlockNote, TokenStanding } from './autoinvest-sheet'
import { HomeRuleCard } from './rules-block'
import { RuleCard } from './rule-card'

/*
 * «Регулярна купівля для всього» (M35, 1.31.0) as the gallery shows it, on
 * labelled sample data — a development build only: a meme's facts of risk and
 * its floor, a token under the floor, a SOL rule with its price condition
 * against the price when it was turned on, and a BONK rule whose purchase the
 * floor deferred, as their cards and the rule's own sheet draw them.
 */

const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const AT = '2026-10-01T09:00:00.000Z'

const floor = (verdict: RuleFloorCheck['verdict'], liquidityUsd: number | null, ageHours: number | null): RuleFloorCheck => ({
  verdict,
  liquidityUsd,
  floorUsd: 25_000,
  ageHours,
  minAgeHours: 24,
  dataAt: '2026-10-07T11:58:00.000Z',
  checkedAt: '2026-10-07T11:58:05.000Z',
})

const READ_MEME: RuleAssetRead = {
  asset: {
    network: 'solana:mainnet',
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'Bonk',
    issuer: { id: 'jupiter-verified', label: 'Jupiter' },
    underlying: { symbol: 'Bonk', name: 'Bonk' },
    decimals: 5,
    unitBasis: 'token',
    kind: 'meme',
  },
  name: 'Bonk',
  class: 'meme',
  priceUsd: 0.00001834,
  priceAt: '2026-10-07T11:58:00.000Z',
  reference: 'enabled',
  floor: floor('met', 7_200_000, 24_528),
  risk: {
    verified: true,
    ageHours: 24_528,
    liquidityUsd: 7_200_000,
    topHoldersPct: 38.2,
    mintAuthorityDisabled: true,
    freezeAuthorityDisabled: true,
    organicScore: 91,
  },
  refusal: null,
  observedAt: '2026-10-07T11:58:05.000Z',
}

const READ_THIN: RuleAssetRead = {
  ...READ_MEME,
  name: 'NEWT',
  floor: floor('below', 18_400, 30),
  risk: {
    verified: false,
    ageHours: 30,
    liquidityUsd: 18_400,
    topHoldersPct: 64,
    mintAuthorityDisabled: false,
    freezeAuthorityDisabled: null,
    organicScore: 12,
  },
  refusal: { code: 'RULE_LIQUIDITY_LOW', message: 'NEWT: liquidity $18,400 — below the floor of $25,000' },
}

const occurrence = (dueAt: string, state: RuleOccurrence['state'], extra: Partial<RuleOccurrence> = {}): RuleOccurrence => ({
  dueAt,
  openUntil: new Date(Date.parse(dueAt) + 86_400_000).toISOString(),
  state,
  remindedAt: null,
  signature: null,
  spentUsd: state === 'bought' ? 1 : null,
  boughtAt: null,
  trigger: null,
  condition: null,
  amountUsd: null,
  events: null,
  ...extra,
})

const RULE_SOL: AutoinvestRule = {
  id: 'rule_00000000000000000000000000000035',
  owner: 'sample',
  network: 'solana:mainnet',
  kind: 'schedule',
  asset: {
    network: 'solana:mainnet',
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    issuer: { id: 'jupiter-verified', label: 'Jupiter' },
    underlying: { symbol: 'SOL', name: 'Wrapped SOL' },
    decimals: 9,
    unitBasis: 'token',
    kind: 'crypto',
  },
  name: 'SOL',
  amountUsd: 1,
  schedule: { cadence: 'daily', weekday: null, monthDay: null, time: '19:00', timeZone: 'Europe/Kyiv' },
  dip: null,
  payments: null,
  priceCondition: { limitPct: 5, referenceUsd: 150, referenceAt: AT },
  status: 'active',
  nextDueAt: '2026-10-07T16:00:00.000Z',
  occurrences: [occurrence('2026-10-06T16:00:00.000Z', 'bought')],
  createdAt: AT,
  updatedAt: AT,
}

const RULE_BONK: AutoinvestRule = {
  ...RULE_SOL,
  id: 'rule_00000000000000000000000000000036',
  asset: READ_MEME.asset,
  name: 'Bonk',
  amountUsd: 2,
  schedule: { cadence: 'weekly', weekday: 3, monthDay: null, time: '19:00', timeZone: 'Europe/Kyiv' },
  priceCondition: null,
  nextDueAt: null,
  occurrences: [occurrence('2026-10-07T09:00:00.000Z', 'deferred', { floor: floor('below', 18_400, 24_528) })],
}

export function TokenRuleSamples() {
  const copy = useCopy(AUTOINVEST_COPY)
  const locale = useLocale()
  const ticket = useCopy(RULE_TICKET_COPY)
  const [open, setOpen] = useState<AutoinvestRule | null>(null)
  const usd = dollarsText(RULE_SOL.amountUsd, locale)
  return (
    <View className="gap-3">
      {/* Trade as the SOL rule's purchase: the chip, the Review's row and the receipt; then a closed reminder's chip. */}
      <RuleChip
        title={`${ticket.byYourRule} · SOL`}
        line={`${usd} · ${ruleWhenLine(RULE_SOL, locale)}`}
        open
        leaveLabel={ticket.tradeWithoutRule}
        onLeave={() => undefined}
      />
      <RuleReviewRow
        label={ticket.yourRule}
        line={`${usd} · SOL · ${lowerFirst(ruleWhenLine(RULE_SOL, locale))}`}
      />
      <ReceiptCard
        status="settled"
        title={`${ticket.boughtByRule} · SOL`}
        paid="1 USDC"
        received={locale === 'uk' ? '0,008417 SOL' : '0.008417 SOL'}
        at={AT}
        signature="sample-rule-receipt"
      />
      <RuleChip
        title={`${ticket.byYourRule} · SOL`}
        line={ticket.reminderClosed}
        open={false}
        leaveLabel={ticket.tradeWithoutRule}
        onLeave={() => undefined}
      />
      <TokenStanding read={READ_MEME} copy={copy} locale={locale} compact={false} />
      <Txt variant="labelSm" tone="faint">
        A token under the floor
      </Txt>
      <TokenStanding read={READ_THIN} copy={copy} locale={locale} compact />
      <BlockNote block="noRule" copy={copy} />
      {[RULE_SOL, RULE_BONK].map((rule) => (
        <HomeRuleCard
          key={rule.id}
          rule={rule}
          budget={null}
          icon={null}
          copy={copy}
          locale={locale}
          now={NOW}
          switching={false}
          onPress={() => setOpen(rule)}
          onToggle={() => undefined}
        />
      ))}
      {[RULE_SOL, RULE_BONK].map((rule) => (
        <RuleCard key={rule.id} rule={rule} budget={null} now={NOW} onPress={() => setOpen(rule)} />
      ))}
      <Button title="Open the SOL rule's sheet" variant="secondary" onPress={() => setOpen(RULE_SOL)} />
      <Button title="Open the Bonk rule's sheet" variant="secondary" onPress={() => setOpen(RULE_BONK)} />
      {open ? (
        <AutoinvestSheet
          visible
          mode={{ kind: 'manage', rule: open }}
          company={{ mint: open.asset.mint, name: open.name, icon: null, preIpo: false, truth: null, priceUsd: null }}
          budget={null}
          onClose={() => setOpen(null)}
          onBuyNow={() => undefined}
          onChangeBudget={() => undefined}
        />
      ) : null}
    </View>
  )
}
