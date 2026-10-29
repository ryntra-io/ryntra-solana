import { Pressable, View } from 'react-native'

import { Txt } from '@/components/txt'
import { CREDITS_COPY } from '@/features/assistant/credits-copy'
import { badgeText, badgeVisible } from '@/features/assistant/credits-panel-model'
import { useCredits } from '@/features/assistant/use-credits'
import type { Session } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatCount } from '@/utils/format'

const PILL = 'h-7 min-w-7 flex-row items-center justify-center rounded-pill border border-line bg-elevated px-2.5'

/**
 * The balance of credits as a small quiet pill on the way into the assistant — only for a proven wallet (a session)
 * whose balance is above zero; an unknown balance shows nothing, never a zero. Never placed in Portfolio: credits are
 * the service's own units, not an asset. With `onPress` it opens the «Кредити» tab; without it, it is a plain mark.
 */
export function CreditsBadge({ session, onPress }: { session: Session | null; onPress?: () => void }) {
  const copy = useCopy(CREDITS_COPY)
  const locale = useLocale()
  const read = useCredits(session)
  const credits = read.data?.credits
  if (!credits || !badgeVisible(session !== null, credits)) return null
  const label = copy.badge(formatCount(credits.balance, locale))
  const text = (
    <Txt variant="data" tone="muted" numberOfLines={1}>
      {badgeText(credits.balance, locale)}
    </Txt>
  )
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} className={PILL}>
        {text}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      className={`${PILL} active:bg-hover`}
    >
      {text}
    </Pressable>
  )
}
