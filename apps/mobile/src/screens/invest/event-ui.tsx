import { View } from 'react-native'

import { Button } from '@/components/button'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'

/** The issuer's event in one line, an hourglass before it — said in amber wherever it stands. */
export function EventLine({ line, size = 16 }: { line: string; size?: number }) {
  return (
    <View className="flex-row items-start gap-2">
      <Icon name="hourglass-outline" size={size} color="warningInk" style={{ marginTop: 1 }} />
      <Txt variant="ui" tone="warning" className="flex-1">
        {line}
      </Txt>
    </View>
  )
}

export type EventActions = Readonly<{
  /** «Обміняти на SpaceX (SPCXx)» — null while the window is closed or the target is not read. */
  swap: Readonly<{ title: string; onPress: () => void }> | null
  /** «Продати за USDC» — quiet. */
  sell: Readonly<{ title: string; onPress: () => void }>
}>

/**
 * The issuer's event on a private company's page and under a held position
 * (the IPO and conversion watch; M19, as ryntra.io draws it): the deadline in
 * a box before any figure — for a holder, the swap as the one orange action
 * right under it and the sale beside it, quiet. Nothing here swaps: each
 * action opens the swap's sheet, where «Перевірка» and the wallet's signature
 * decide.
 */
export function EventBanner({
  line,
  actions = null,
  compact = false,
}: {
  line: string
  actions?: EventActions | null
  /** Under a position in a list: smaller buttons, side by side where they fit. */
  compact?: boolean
}) {
  return (
    <View className="gap-2">
      <View className="rounded-sm border border-line bg-surface px-4 py-3">
        <EventLine line={line} />
      </View>
      {actions ? <EventButtons actions={actions} compact={compact} /> : null}
    </View>
  )
}

/**
 * A holder's two actions on the issuer's event: the swap, the one orange action, and the sale beside it, quiet —
 * under the event's box, or under the line of «Шлях компанії» on the private token's own page.
 */
export function EventButtons({ actions, compact = false }: { actions: EventActions; compact?: boolean }) {
  return (
    <View className={compact ? 'flex-row flex-wrap gap-2' : 'gap-2'}>
      {actions.swap ? (
        <Button title={actions.swap.title} size={compact ? 'sm' : 'lg'} onPress={actions.swap.onPress} />
      ) : null}
      <Button
        title={actions.sell.title}
        variant={compact ? 'ghost' : 'secondary'}
        size={compact ? 'sm' : 'lg'}
        onPress={actions.sell.onPress}
      />
    </View>
  )
}
