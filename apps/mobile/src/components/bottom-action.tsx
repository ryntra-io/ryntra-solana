import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, type ButtonProps } from '@/components/button'
import { Txt } from '@/components/txt'

export type BottomActionProps = Pick<ButtonProps, 'title' | 'onPress' | 'loading' | 'disabled' | 'variant'> & {
  /** One line above the button: the fact the action depends on. */
  hint?: string
}

/** Height to reserve under scrolling content so the last row clears the docked action. */
export const BOTTOM_ACTION_INSET = 96

/** The screen's one next action, docked above the system bar. */
export function BottomAction({ hint, ...button }: BottomActionProps) {
  const insets = useSafeAreaInsets()
  return (
    <View
      className="gap-2 border-t border-line bg-ground px-4 pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      {hint ? (
        <Txt variant="ui" tone="faint" className="text-center">
          {hint}
        </Txt>
      ) : null}
      <Button size="lg" {...button} />
    </View>
  )
}
