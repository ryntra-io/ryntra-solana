import { Pressable, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { cn } from '@/utils/cn'

/**
 * The rule's chip over Trade's ticket (1.31.0): «За правилом · SOL» and what
 * it buys and when — or, when the ticket is not the rule's purchase now, why
 * — with «×» to trade without the rule. Open, it wears the brand's line; any
 * other state is said in the warning tone, with no action but leaving.
 */
export function RuleChip({
  title,
  line,
  open,
  leaveLabel,
  onLeave,
  disabled = false,
}: {
  title: string
  line: string | null
  open: boolean
  leaveLabel: string
  onLeave: () => void
  disabled?: boolean
}) {
  return (
    <View
      className={cn(
        'flex-row items-center gap-3 rounded-sm border bg-surface py-3 pl-4 pr-2',
        open ? 'border-brand-line' : 'border-line',
      )}
    >
      <Icon name="repeat-outline" size={18} color={open ? 'brand' : 'muted'} />
      <View className="flex-1 gap-0.5">
        <Txt variant="ui" numberOfLines={1}>
          {title}
        </Txt>
        {line ? (
          <Txt variant="ui" tone={open ? 'muted' : 'warning'} tabular>
            {line}
          </Txt>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={leaveLabel}
        onPress={onLeave}
        disabled={disabled}
        hitSlop={8}
        className="h-11 w-11 items-center justify-center rounded-btn active:bg-hover"
      >
        <Icon name="close" size={20} color="muted" />
      </Pressable>
    </View>
  )
}

/** «Твоє правило · $5 · SOL · щотижня · ср о 19:00» — the rule a purchase is made under, as «Перевірка» says it. */
export function RuleReviewRow({ label, line }: { label: string; line: string }) {
  return (
    <View className="flex-row gap-3 rounded-sm border border-line bg-surface px-4 py-3">
      <Txt variant="ui" tone="faint" style={{ width: 112 }}>
        {label}
      </Txt>
      <Txt variant="ui" tabular className="flex-1">
        {line}
      </Txt>
    </View>
  )
}
