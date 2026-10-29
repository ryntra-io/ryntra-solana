import { useMemo, type ReactNode } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

import { feelHold } from '@/lib/haptics'

/** How long a finger rests on a block before it lifts for arranging — Android's own long press. */
const HOLD_MS = 450

/**
 * A part of a screen that answers a long press anywhere on it, its own
 * buttons and cards included: once the hold is recognised the press under
 * the finger is cancelled, so a held card never also opens. A finger that
 * moves is a scroll, never a hold.
 */
export function Holdable({ onHold, children }: { onHold: () => void; children: ReactNode }) {
  const gesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(HOLD_MS)
        .runOnJS(true)
        .onStart(() => {
          feelHold()
          onHold()
        }),
    [onHold],
  )
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false}>{children}</View>
    </GestureDetector>
  )
}
