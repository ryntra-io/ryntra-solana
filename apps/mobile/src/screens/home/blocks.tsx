import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Button } from '@/components/button'
import { Chip, type ChipTone } from '@/components/chip'
import { Icon, type IconName } from '@/components/icon'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import type { HomeCopy } from '@/features/home/copy'
import type { AttentionItem, MovePeriod, WatchMove } from '@/features/home/home-model'
import type { BlockState } from '@/features/home/use-home'
import { formatUnits } from '@/features/trade/trade-model'
import type { MarketRow } from '@/lib/api'
import { useLocale, type Locale } from '@/lib/i18n'
import { cn } from '@/utils/cn'
import { formatAge, formatClock, formatMoment, formatPercent, formatPrice, localizeFigures, signOf } from '@/utils/format'

/* ---- the block: a label, one fact beside it, then its rows ---- */

export type BlockProps = {
  title: string
  /** One short fact after the title: a count, a period, a time. */
  fact?: string | null
  /** The door on the right of the label, when the block has one. */
  action?: Readonly<{ label: string; onPress: () => void }> | null
  children: ReactNode
}

/** One block of Home. The label names it, the fact qualifies it, the rows below say what is there. */
export function Block({ title, fact, action, children }: BlockProps) {
  return (
    <View className="gap-2">
      <View className="flex-row items-end justify-between gap-3 px-1">
        <Txt variant="labelSm" tone="faint" caps className="shrink">
          {title}
          {fact ? ` · ${fact}` : ''}
        </Txt>
        {action ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={8} className="active:opacity-70">
            {/* Quiet: a block's door is never the screen's one orange action. */}
            <Txt variant="labelSm" tone="muted">
              {action.label}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  )
}

/** A resting block: the shape of two rows. */
export function BlockSkeleton({ label, rows = 2 }: { label: string; rows?: number }) {
  return (
    <View
      className="gap-2 rounded-sm border border-line bg-surface px-4 py-3"
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 py-1">
          <Skeleton className="h-8 w-8 rounded-pill" />
          <View className="flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-40" />
          </View>
          <Skeleton className="h-3.5 w-14" />
        </View>
      ))}
    </View>
  )
}

/** A block whose read failed with nothing to show: one line and the one action. */
export function BlockError({
  text,
  retry,
  retrying,
  label,
}: {
  text: string
  retry: () => void
  retrying: boolean
  label: string
}) {
  return (
    <View className="flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3">
      <Icon name="alert-circle-outline" size={18} color="muted" />
      <Txt variant="ui" tone="muted" className="flex-1">
        {text}
      </Txt>
      <Button title={label} variant="secondary" size="sm" onPress={retry} loading={retrying} />
    </View>
  )
}

/** One quiet line where a block has nothing to list — with its door when it has one. */
export function QuietLine({
  text,
  icon = 'checkmark-circle-outline',
  onPress,
}: {
  text: string
  icon?: IconName
  onPress?: () => void
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-sm border border-line bg-surface px-4 py-3',
        onPress && 'active:bg-hover',
      )}
    >
      <Icon name={icon} size={18} color="muted" />
      <Txt variant="ui" tone="muted" className="flex-1">
        {text}
      </Txt>
      {onPress ? <Icon name="chevron-forward" size={16} color="fgMuted" /> : null}
    </Pressable>
  )
}

/** Where a block stands before its rows can be drawn; null when it is ready. */
export function blockGate({
  state,
  label,
  errorText,
  retry,
  retrying,
  retryLabel,
}: {
  state: BlockState
  label: string
  errorText: string
  retry: () => void
  retrying: boolean
  retryLabel: string
}): ReactNode | null {
  if (state === 'loading') return <BlockSkeleton label={label} />
  if (state === 'error') return <BlockError text={errorText} retry={retry} retrying={retrying} label={retryLabel} />
  return null
}

/* ---- attention rows ---- */

function WarningRow({
  icon,
  title,
  detail,
  footer,
  chip,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName
  title: string
  detail?: string | null
  footer?: string | null
  chip?: Readonly<{ label: string; tone: ChipTone }> | null
  onPress: () => void
  accessibilityLabel: string
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className="gap-1.5 rounded-sm border border-warning-soft bg-warning-soft px-4 py-3 active:opacity-80"
    >
      <View className="flex-row items-center gap-2">
        <Icon name={icon} size={18} color="warningInk" />
        <Txt variant="ui" tone="warning" className="flex-1">
          {title}
        </Txt>
        {chip ? <Chip label={chip.label} tone={chip.tone} caps={false} /> : null}
        <Icon name="chevron-forward" size={16} color="warningInk" />
      </View>
      {detail ? (
        <Txt variant="ui" tone="muted">
          {detail}
        </Txt>
      ) : null}
      {footer ? (
        <Txt variant="labelSm" tone="faint">
          {footer}
        </Txt>
      ) : null}
    </Pressable>
  )
}

export type AttentionRowProps = {
  item: AttentionItem
  copy: HomeCopy
  locale: Locale
  now: number
  onPress: () => void
}

/**
 * One thing that needs a look: the unfinished operation, a monitoring card
 * (saying honestly when it cannot name one plan, or opens on the web), an
 * entry rule that ran out. Each row is one door.
 */
export function AttentionRow({ item, copy, locale, now, onPress }: AttentionRowProps) {
  if (item.kind === 'recovery') {
    const context = item.attempt.context
    const operation = context
      ? `${copy.modes[context.mode]} · ${formatUnits(context.inAmountRaw, context.payDecimals, 6, locale)} ${context.pay.symbol} → ${context.receive.symbol}`
      : null
    return (
      <WarningRow
        icon="hourglass-outline"
        title={copy.recoveryTitle}
        detail={operation ?? copy.recoveryDetail}
        footer={`${operation ? `${copy.recoveryDetail} · ` : ''}${formatAge(item.attempt.recordedAt, now, locale)}`}
        onPress={onPress}
        accessibilityLabel={copy.recoveryTitle}
      />
    )
  }
  if (item.kind === 'entry-expired') {
    return (
      <WarningRow
        icon="time-outline"
        title={`${item.plan.asset.symbol} · ${copy.entryExpired}`}
        footer={formatMoment(item.plan.updatedAt, now, locale)}
        onPress={onPress}
        accessibilityLabel={`${item.plan.asset.symbol}: ${copy.entryExpired}`}
      />
    )
  }
  const { card } = item
  const chip = item.shared
    ? { label: copy.whichPlan(card.label, item.plans.length), tone: 'neutral' as const }
    : card.paper
      ? { label: copy.paper, tone: 'evidence' as const }
      : null
  const footer = card.paper
    ? copy.opensOnWeb
    : card.lastCheckedAt
      ? copy.lastChecked(formatMoment(card.lastCheckedAt, now, locale))
      : card.cta
  return (
    <WarningRow
      icon="alert-circle-outline"
      // A title that already names the asset is not prefixed with it again («NVDAx · NVDAx is above…»).
      title={card.title.startsWith(card.label) ? localizeFigures(card.title, locale) : `${card.label} · ${localizeFigures(card.title, locale)}`}
      detail={card.reason ? localizeFigures(card.reason, locale) : null}
      footer={footer}
      chip={chip}
      onPress={onPress}
      accessibilityLabel={`${card.label}: ${card.title}${item.shared ? `, ${copy.whichPlan(card.label, item.plans.length)}` : ''}`}
    />
  )
}

/* ---- a watchlist move ---- */

export type MoveRowProps = {
  move: WatchMove
  period: MovePeriod
  copy: HomeCopy
  onPress: () => void
  last?: boolean
}

/** One watched asset: identity, the price, its move over the period — and the 24h figure beside it when the period is the last look. */
export function MoveRow({ move, period, copy, onPress, last }: MoveRowProps) {
  const locale = useLocale()
  const { row } = move
  const direction = signOf(move.pct)
  const periodWord = period.kind === 'since' ? copy.since(formatClock(period.at)) : copy.over24h
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.symbol}, ${formatPrice(row.price, locale)}, ${move.pct === null ? copy.notPricedThen : `${formatPercent(move.pct, locale)} ${periodWord}`}`}
      onPress={onPress}
      className={cn('flex-row items-center gap-3 py-2.5 active:bg-hover', last ? '' : 'border-b border-line')}
    >
      <AssetIcon symbol={row.symbol} icon={row.icon} size={32} />
      <View className="flex-1 gap-0.5">
        <Txt variant="ui">{row.symbol}</Txt>
        <Txt variant="labelSm" tone="faint" numberOfLines={1}>
          {row.name}
        </Txt>
      </View>
      <View className="items-end gap-1">
        <Txt variant="data">{formatPrice(row.price, locale)}</Txt>
        <View className="flex-row items-center gap-1.5">
          {period.kind === 'since' ? (
            <Txt variant="labelSm" tone="faint">
              {copy.over24h} {formatPercent(move.dayPct, locale)}
            </Txt>
          ) : null}
          <Chip
            label={formatPercent(move.pct, locale)}
            tone={direction === 'up' ? 'success' : direction === 'down' ? 'danger' : 'neutral'}
            mono
          />
        </View>
      </View>
    </Pressable>
  )
}

/* ---- a trending pick ---- */

/** One mover as a compact pill: the symbol and its 24h move; the door is the asset. */
export function MoverPill({ row, onPress }: { row: MarketRow; onPress: () => void }) {
  const locale = useLocale()
  const direction = signOf(row.change24hPct)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.symbol}, ${formatPercent(row.change24hPct, locale)} in 24 hours`}
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-pill border border-line bg-surface py-1.5 pl-1.5 pr-3 active:bg-hover"
    >
      <AssetIcon symbol={row.symbol} icon={row.icon} size={24} />
      <Txt variant="ui">{row.symbol}</Txt>
      <Txt variant="data" tone={direction === 'up' ? 'success' : direction === 'down' ? 'danger' : 'muted'}>
        {formatPercent(row.change24hPct, locale)}
      </Txt>
    </Pressable>
  )
}

/* ---- a brief line ---- */

export type BriefRowProps = {
  icon: IconName
  text: string
  onPress: () => void
  last?: boolean
}

/** One line of what changed, and where it leads. */
export function BriefRow({ icon, text, onPress, last }: BriefRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      onPress={onPress}
      className={cn('flex-row items-center gap-3 px-4 py-3 active:bg-hover', last ? '' : 'border-b border-line')}
    >
      <Icon name={icon} size={18} color="muted" />
      <Txt variant="ui" className="flex-1">
        {text}
      </Txt>
      <Icon name="chevron-forward" size={16} color="fgMuted" />
    </Pressable>
  )
}
