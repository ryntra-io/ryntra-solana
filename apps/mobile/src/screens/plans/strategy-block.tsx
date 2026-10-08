import { View } from 'react-native'

import { Card } from '@/components/card'
import { Chip, type ChipTone } from '@/components/chip'
import { Txt } from '@/components/txt'
import { PLANS_COPY } from '@/features/plans/copy'
import { strategyBlock } from '@/features/plans/plan-model'
import type { PlanCheck, PlanReview } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatUsd } from '@/utils/format'

const VERDICT_TONE: Readonly<Record<PlanReview['verdict'], ChipTone>> = {
  ready: 'success',
  attention: 'warning',
  blocked: 'danger',
}

function CheckLine({ check, tone }: { check: PlanCheck; tone: 'danger' | 'warning' }) {
  const copy = useCopy(PLANS_COPY)
  return (
    <View className="gap-0.5 py-2">
      <View className="flex-row items-center gap-2">
        <Txt variant="ui" tone={tone} className="flex-1">
          {copy.check[check.id]}
        </Txt>
        {check.required ? <Chip label={copy.required} tone={tone} /> : null}
      </View>
      <Txt variant="labelSm" tone="faint">
        {copy.expected} {check.expected}
        {check.actual !== null ? ` · ${copy.actual} ${check.actual}` : ''}
      </Txt>
    </View>
  )
}

/**
 * The Strategy block of a Review under a plan: the server's judgement of
 * the plan's version on this exact order — what failed, what could not be
 * known, how many checks held, what fits the plan at this price. The block
 * is the server's; the phone only says it.
 */
export function StrategyBlock({ review, symbol }: { review: PlanReview; symbol: string }) {
  const copy = useCopy(PLANS_COPY)
  const locale = useLocale()
  const block = strategyBlock(review)
  return (
    <Card className="gap-1">
      <View className="gap-1.5">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.strategyBlock} · {symbol} · {copy.version(review.version)}
        </Txt>
        <View className="flex-row">
          <Chip label={copy.verdict[block.verdict]} tone={VERDICT_TONE[block.verdict]} caps={false} />
        </View>
      </View>
      {block.failed.map((check) => (
        <CheckLine key={`${check.id}-${check.expected}`} check={check} tone="danger" />
      ))}
      {block.unknown.map((check) => (
        <CheckLine key={`${check.id}-${check.expected}`} check={check} tone="warning" />
      ))}
      <Txt variant="labelSm" tone="faint" className="pt-1">
        {copy.checksHeld(block.passed)}
        {block.fitUsd !== null ? ` · ${copy.fits(formatUsd(block.fitUsd, locale))}` : ''}
      </Txt>
    </Card>
  )
}
