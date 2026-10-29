import { Pressable, View } from 'react-native'

import { Chip } from '@/components/chip'
import { Icon, type IconName } from '@/components/icon'
import { Txt } from '@/components/txt'
import { HISTORY_COPY } from '@/features/history/copy'
import { historyAmounts, historyTitle, type HistoryKind, type HistoryRow } from '@/features/history/history-model'
import { HIDDEN_AMOUNT } from '@/features/home/home-model'
import { useCopy, useLocale } from '@/lib/i18n'
import { saidFigure } from '@/utils/format'

import { STATUS_TONE } from './receipt-sheet'

const KIND_ICON: Readonly<Record<HistoryKind, IconName>> = {
  buy: 'arrow-down-circle-outline',
  sell: 'arrow-up-circle-outline',
  swap: 'swap-horizontal-outline',
  send: 'arrow-up-outline',
  receive: 'arrow-down-outline',
  bridge: 'git-merge-outline',
  crossSwap: 'shuffle-outline',
  other: 'ellipse-outline',
}

/**
 * One operation of the statement: its kind's mark, what happened and the amounts, its state when it is not settled
 * and its time — `time` is the clock under History's day, or the day and clock where rows of many days stand together.
 * `hidden` — Home's eye is closed: the amounts read ••••••, on screen and to a screen reader.
 */
export function HistoryRowView({
  item,
  time,
  onPress,
  last,
  hidden = false,
}: {
  item: HistoryRow
  time: string
  onPress: () => void
  last: boolean
  hidden?: boolean
}) {
  const copy = useCopy(HISTORY_COPY)
  const locale = useLocale()
  const amounts = hidden ? HIDDEN_AMOUNT : historyAmounts(item)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${historyTitle(item, copy.words)}, ${saidFigure(amounts, locale)}, ${copy.status[item.status]}, ${time}`}
      onPress={onPress}
      className={`flex-row items-start gap-3 py-3 active:bg-hover ${last ? '' : 'border-b border-line'}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-elevated">
        <Icon name={KIND_ICON[item.kind]} size={18} color="fg" />
      </View>
      {/* The money is never cut: the title may take two lines, the amounts the row's whole width (wrapping when they
          must), the time under them — no column beside the figures to squeeze them (ST-5). */}
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-start gap-2">
          <Txt variant="ui" numberOfLines={2} className="flex-1">
            {historyTitle(item, copy.words)}
          </Txt>
          {/* A settled row needs no badge — that is what a statement is; anything else says its state. */}
          {item.status !== 'done' ? <Chip label={copy.status[item.status]} tone={STATUS_TONE[item.status]} /> : null}
        </View>
        <Txt variant="data" tone="faint">
          {amounts}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {time}
        </Txt>
      </View>
    </Pressable>
  )
}
