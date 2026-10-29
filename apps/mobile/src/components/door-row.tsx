import { Pressable, View } from 'react-native'

import { Icon, type IconName } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useSpace } from '@/theme'

export type DoorRowProps = {
  icon: IconName
  label: string
  /** One line under the label: what the door is for — never prose. */
  line?: string
  /** A short figure at the right edge: a count, a version. */
  value?: string
  /** Without it the row is a fact, not a door: no chevron, not pressable. */
  onPress?: () => void
  /** The door leaves the app for ryntra.io: marked ↗ and said so to a screen reader. */
  external?: string | null
  last?: boolean
}

/**
 * One door of a place, as a row inside a Card: the icon, the word, what it is
 * for, and where it goes — a chevron into the app, ↗ out to ryntra.io.
 */
export function DoorRow({ icon, label, line, value, onPress, external = null, last = false }: DoorRowProps) {
  const space = useSpace()
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[label, line, external].filter(Boolean).join(', ')}
      disabled={!onPress}
      onPress={onPress}
      className={`min-h-12 flex-row items-center gap-3 px-4 ${space.door} ${onPress ? 'active:bg-hover' : ''} ${last ? '' : 'border-b border-line'}`}
    >
      <Icon name={icon} size={20} />
      <View className="flex-1 gap-0.5">
        <Txt variant="ui">{label}</Txt>
        {line ? (
          <Txt variant="ui" tone="faint">
            {line}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="data" tone="muted">
          {value}
        </Txt>
      ) : null}
      {onPress ? <Icon name={external ? 'open-outline' : 'chevron-forward'} size={18} color="fgMuted" /> : null}
    </Pressable>
  )
}
