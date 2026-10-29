import * as Haptics from 'expo-haptics'

import type { TradeCue } from '@/features/trade/trade-cues'

/**
 * A cue as the phone's own haptic pattern. A phone without a motor, or one
 * that says no, is left alone — a cue never stands between the person and
 * the screen.
 */
export function feel(cue: TradeCue) {
  const played =
    cue === 'review'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : cue === 'sent'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        : Haptics.notificationAsync(
            cue === 'done'
              ? Haptics.NotificationFeedbackType.Success
              : cue === 'declined'
                ? Haptics.NotificationFeedbackType.Warning
                : Haptics.NotificationFeedbackType.Error,
          )
  played.catch(() => undefined)
}

/** A held block lifting for arranging: one medium tap, the phone's own. */
export function feelHold() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
}
