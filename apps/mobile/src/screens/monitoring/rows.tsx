import { Pressable, View } from 'react-native'

import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import type { MonitoringCopy } from '@/features/monitoring/copy'
import { noteWords } from '@/features/monitoring/monitoring-model'
import type { MonitoringCard, MonitoringNote } from '@/lib/api'
import { useCopy, type Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { formatAge, formatMoment } from '@/utils/format'

const KNOWN_STATUS = ['watching', 'needs_attention', 'paused', 'unavailable'] as const
type KnownStatus = (typeof KNOWN_STATUS)[number]

/** The status in the app's words; a status the app does not know yet is said as the server titled it. */
function statusWord(card: MonitoringCard, copy: MonitoringCopy): string {
  const known = KNOWN_STATUS.find((status) => status === card.status)
  return known ? copy.status[known as KnownStatus] : card.title
}

export type WatchRowProps = {
  card: MonitoringCard
  copy: MonitoringCopy
  locale: Locale
  now: number
  onPress: () => void
  last?: boolean
}

/** One watched plan: its label, its state, when the server last looked — and the door to the plan. */
export function WatchRow({ card, copy, locale, now, onPress, last }: WatchRowProps) {
  const word = statusWord(card, copy)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.label}, ${word}`}
      onPress={onPress}
      className={cn('flex-row items-center gap-3 py-3 active:bg-hover', last ? '' : 'border-b border-line')}
    >
      <View className="flex-1 gap-1">
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Txt variant="ui" numberOfLines={1} className="shrink">
            {card.label}
          </Txt>
          <Chip label={word} tone={card.status === 'unavailable' ? 'warning' : 'neutral'} />
          {card.paper ? <Chip label={copy.paper} /> : null}
        </View>
        <Txt variant="labelSm" tone="faint">
          {card.lastCheckedAt ? `${copy.lastChecked} ${formatAge(card.lastCheckedAt, now, locale)}` : copy.notChecked}
        </Txt>
      </View>
      <Icon name="chevron-forward" size={18} color="fgMuted" />
    </Pressable>
  )
}

export type NoteRowProps = {
  note: MonitoringNote
  copy: MonitoringCopy
  locale: Locale
  now: number
  onPress: () => void
  /** Present on an unread note: the one-tap mark without opening. */
  onMarkRead?: () => void
  /** Ryntra's conversation about this note (M11): why it came, whether it still holds — an explanation, never an action. */
  onAsk?: () => void
  askLabel?: string
  last?: boolean
}

/**
 * One note of the inbox: the dot while unread, the server's own title and
 * reason, the plan it names, when it was written. Tapping opens the plan
 * and marks the note read; the check marks it read where it is.
 */
export function NoteRow({ note, copy, locale, now, onPress, onMarkRead, onAsk, askLabel, last }: NoteRowProps) {
  const { colors } = useTheme()
  const ruleCopy = useCopy(AUTOINVEST_COPY)
  const words = noteWords(note, locale)
  // An autoinvest note (M16) is a reminder or the month's budget, an issuer's event (M19) says its own deadline:
  // no plan to explain, so no question for Ryntra.
  const ownWords =
    note.subject?.kind === 'autoinvest-rule' ||
    note.subject?.kind === 'autoinvest-budget' ||
    note.subject?.kind === 'issuer-event'
  // What became of a reminder as the rule reads it now (1.13.0): said beside it; an open one is the note's own words;
  // 1.18.0: a purchase the price condition still holds back — the note leads to the company, where why is said.
  const ruleState =
    note.ruleState === 'bought'
      ? ruleCopy.lastBought
      : note.ruleState === 'pending'
        ? ruleCopy.lastPending
        : note.ruleState === 'missed'
          ? ruleCopy.lastMissed
          : note.ruleState === 'held'
            ? ruleCopy.budgetSpent
            : note.ruleState === 'deferred'
              ? ruleCopy.purchaseDeferred
              : null
  return (
    <View className={cn('flex-row items-center gap-2 py-3', last ? '' : 'border-b border-line')}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${note.context}: ${words.title}${ruleState ? `. ${ruleState}` : ''}`}
        accessibilityState={{ selected: note.unread }}
        onPress={onPress}
        className="flex-1 flex-row items-start gap-3 active:opacity-80"
      >
        {/* The dot is sized in style: the smallest spacing classes never reach the compiled stylesheet. */}
        <View style={{ width: 8, paddingTop: 7, alignItems: 'center' }}>
          {note.unread ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />
          ) : null}
        </View>
        <View className="flex-1 gap-1">
          <Txt variant="ui" tone={note.unread ? 'fg' : 'muted'}>
            {words.title}
          </Txt>
          {words.reason ? (
            <Txt variant="labelSm" tone="faint" numberOfLines={3}>
              {words.reason}
            </Txt>
          ) : null}
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Chip label={note.context} caps={false} />
            {ruleState ? (
              <Chip label={ruleState} caps={false} tone={note.ruleState === 'held' ? 'warning' : 'neutral'} />
            ) : null}
            {note.paper ? <Chip label={copy.paper} /> : null}
            {words.foreign && note.locale ? (
              <Chip label={copy.noteLanguage(copy.languageName[note.locale])} caps={false} />
            ) : null}
            <Txt variant="labelSm" tone="faint">
              {formatMoment(note.createdAt, now, locale)}
            </Txt>
          </View>
        </View>
      </Pressable>
      {onAsk && !note.paper && !ownWords ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={askLabel}
          onPress={onAsk}
          hitSlop={6}
          className="h-11 w-11 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="sparkles-outline" size={20} color="muted" />
        </Pressable>
      ) : null}
      {onMarkRead ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.markRead}
          onPress={onMarkRead}
          hitSlop={6}
          className="h-11 w-11 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="checkmark-circle-outline" size={22} color="muted" />
        </Pressable>
      ) : (
        <Icon name="chevron-forward" size={18} color="fgMuted" />
      )}
    </View>
  )
}
