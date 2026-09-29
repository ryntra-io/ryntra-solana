import type { ReactNode } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/button'
import { Icon, type IconName } from '@/components/icon'
import { Txt } from '@/components/txt'

export type StateViewProps = {
  icon: IconName
  /** One line that says what is (or is not) here. */
  title: string
  /** One more line at most — the fact that ends the state, not an explanation. */
  detail?: string
  /** The single action that ends the state, when one exists. */
  action?: { title: string; onPress: () => void; loading?: boolean }
  tone?: 'neutral' | 'danger'
  children?: ReactNode
}

/**
 * An empty or failed surface is composed, not abandoned: an icon, one line,
 * one action. Used for empty lists, gated tabs and failed loads alike.
 */
export function StateView({ icon, title, detail, action, tone = 'neutral', children }: StateViewProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8 py-12">
      <View className="h-14 w-14 items-center justify-center rounded-md border border-line bg-surface">
        <Icon name={icon} size={26} color={tone === 'danger' ? 'dangerInk' : 'muted'} />
      </View>
      <View className="items-center gap-1">
        <Txt variant="title" className="text-center">
          {title}
        </Txt>
        {detail ? (
          <Txt variant="body" tone="muted" className="text-center">
            {detail}
          </Txt>
        ) : null}
      </View>
      {children ? <View className="flex-row flex-wrap items-center justify-center gap-2">{children}</View> : null}
      {action ? (
        <Button
          title={action.title}
          onPress={action.onPress}
          loading={action.loading}
          variant={tone === 'danger' ? 'secondary' : 'primary'}
          className="mt-2 min-w-48"
        />
      ) : null}
    </View>
  )
}
