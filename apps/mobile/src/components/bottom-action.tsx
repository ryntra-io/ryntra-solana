import { useEffect, useState } from 'react'
import { Keyboard, Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, type ButtonProps } from '@/components/button'
import { Txt } from '@/components/txt'

export type BottomActionProps = Pick<ButtonProps, 'title' | 'onPress' | 'loading' | 'disabled' | 'variant'> & {
  /** One line above the button: the fact the action depends on. */
  hint?: string
  /** Docked above the bar of places, which already keeps the system bar's room. */
  aboveBar?: boolean
}

/** Height to reserve under scrolling content so the last row clears the docked action. */
export const BOTTOM_ACTION_INSET = 96

/**
 * How far the keyboard stands over the screen's bottom edge — 0 while it is
 * down. Android draws edge to edge, so the window is never resized for the
 * keyboard (adjustResize alone does nothing there): the docked action lifts
 * itself, as the sheets lift theirs. Android reports the keyboard's height
 * above the system bar, iOS from the screen's edge.
 */
function useKeyboardFromEdge(systemBar: number): number {
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const ios = Platform.OS === 'ios'
    const shown = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (event) =>
      setHeight(Math.max(0, event.endCoordinates.height)),
    )
    const hidden = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  if (height === 0) return 0
  return Platform.OS === 'ios' ? height : height + systemBar
}

/**
 * The screen's one next action, docked above the system bar — and above the
 * keyboard while one is up, so a step being typed into keeps its button in
 * sight.
 */
export function BottomAction({ hint, aboveBar = false, ...button }: BottomActionProps) {
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardFromEdge(insets.bottom)
  // Over the keyboard the system bar's room is the keyboard's; the bar of places steps aside while it is up.
  const paddingBottom = keyboard > 0 || aboveBar ? 12 : Math.max(insets.bottom, 12)
  return (
    <View className="gap-2 border-t border-line bg-ground px-4 pt-3" style={{ paddingBottom, marginBottom: keyboard }}>
      {hint ? (
        <Txt variant="ui" tone="faint" className="text-center">
          {hint}
        </Txt>
      ) : null}
      <Button size="lg" {...button} />
    </View>
  )
}
