import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { HelpMark, HelpSheet } from '@/components/help-dot'
import { Icon, type IconName } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useSharedCopy } from '@/lib/i18n'

export type StateViewProps = {
  icon: IconName
  /** One line that says what is (or is not) here. */
  title: string
  /** One more line at most — the fact that ends the state, not an explanation. */
  detail?: string
  /** What the state means, one tap deep behind «?» beside the title — never a line on the screen. */
  help?: { title: string; body: string | readonly string[] }
  /** The single action that ends the state, when one exists. */
  action?: { title: string; onPress: () => void; loading?: boolean }
  tone?: 'neutral' | 'danger'
  children?: ReactNode
}

/**
 * An empty or failed surface is composed, not abandoned: an icon, one line,
 * one action. Used for empty lists, gated tabs and failed loads alike.
 */
export function StateView({ icon, title, detail, help, action, tone = 'neutral', children }: StateViewProps) {
  const [helpOpen, setHelpOpen] = useState(false)
  const shared = useSharedCopy()
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8 py-12">
      {help ? (
        <HelpSheet visible={helpOpen} onClose={() => setHelpOpen(false)} title={help.title} body={help.body} />
      ) : null}
      <View className="h-14 w-14 items-center justify-center rounded-md border border-line bg-surface">
        <Icon name={icon} size={26} color={tone === 'danger' ? 'dangerInk' : 'muted'} />
      </View>
      <View className="items-center gap-1">
        {help ? (
          // The title and its «?» are one press: the whole line opens what the state means, read aloud as one button.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${shared.whatItMeans}`}
            onPress={() => setHelpOpen(true)}
            hitSlop={8}
            className="rounded-btn px-1 active:bg-hover"
          >
            <Txt variant="title" className="text-center">
              {title}
              {' '}
              <HelpMark title={help.title} onPress={() => setHelpOpen(true)} inline />
            </Txt>
          </Pressable>
        ) : (
          <Txt variant="title" className="text-center">
            {title}
          </Txt>
        )}
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
