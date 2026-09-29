import { Pressable, View } from 'react-native'

import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import type { PlansCopy } from '@/features/plans/copy'
import { entryExpired, planIssuerLabel, statusTone, unitBasisOf } from '@/features/plans/plan-model'
import type { MonitoringCard, TradingPlan } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import { HIDDEN_AMOUNT } from '@/features/home/home-model'
import { formatAmount, formatMoment, formatUsd } from '@/utils/format'

export type PlanRowProps = {
  plan: TradingPlan
  copy: PlansCopy
  locale: Locale
  now: number
  attention?: boolean
  /** Home may hide money figures; the plan's state and version still show. */
  hideMoney?: boolean
  onPress: () => void
  last?: boolean
}

/** One plan in a list: the asset, its state, the planned spend and size, when it last changed. */
export function PlanRow({ plan, copy, locale, now, attention, hideMoney = false, onPress, last }: PlanRowProps) {
  const sizing = plan.current.sizing
  const unit = unitBasisOf(plan.asset)
  const expired = entryExpired(plan, now)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${plan.asset.symbol}, ${copy.status[plan.status]}, ${hideMoney ? HIDDEN_AMOUNT : formatUsd(sizing.notionalUsd)}`}
      onPress={onPress}
      className={`flex-row items-center gap-3 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Txt variant="ui">{plan.asset.symbol}</Txt>
          <Chip label={copy.status[plan.status]} tone={statusTone(plan.status)} />
          {attention ? <Chip label={copy.attention} tone="warning" /> : null}
          {expired ? <Chip label={copy.status.expired} tone="warning" /> : null}
        </View>
        <Txt variant="data" tone="faint" numberOfLines={1}>
          {hideMoney
            ? HIDDEN_AMOUNT
            : `${formatUsd(sizing.notionalUsd)} · ${formatAmount(sizing.units, 4)} ${copy.units[unit]}`}{' '}
          · {copy.version(plan.version)}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {planIssuerLabel(plan.asset, copy.retiredIssuer)} · {formatMoment(plan.updatedAt, now, locale)}
        </Txt>
      </View>
      <Icon name="chevron-forward" size={18} color="fgMuted" />
    </Pressable>
  )
}

export type AttentionCardProps = {
  card: MonitoringCard
  /** The words before the check time: 'Last checked'. */
  lastChecked: string
  locale: Locale
  now: number
  onPress: () => void
  /** A paper plan's marker, when the surface says so. */
  paperLabel?: string
}

/** What the monitoring says about a plan right now: its title, its reason, when it was checked — and the one door. */
export function AttentionCard({ card, lastChecked, locale, now, onPress, paperLabel }: AttentionCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.label}: ${card.title}`}
      onPress={onPress}
      className="gap-1.5 rounded-sm border border-warning-soft bg-warning-soft px-4 py-3 active:opacity-80"
    >
      <View className="flex-row items-center gap-2">
        <Icon name="alert-circle-outline" size={18} color="warningInk" />
        <Txt variant="ui" tone="warning" className="flex-1">
          {card.label} · {card.title}
        </Txt>
        {card.paper && paperLabel ? <Chip label={paperLabel} /> : null}
        <Icon name="chevron-forward" size={16} color="warningInk" />
      </View>
      {card.reason ? (
        <Txt variant="ui" tone="muted">
          {card.reason}
        </Txt>
      ) : null}
      <Txt variant="labelSm" tone="faint">
        {card.lastCheckedAt ? `${lastChecked} ${formatMoment(card.lastCheckedAt, now, locale)}` : card.cta}
      </Txt>
    </Pressable>
  )
}
