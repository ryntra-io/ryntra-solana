import { Image } from 'expo-image'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  CITY_FLARE,
  CITY_FONT,
  CITY_FONT_STRONG,
  CITY_GROUND,
  CITY_MARK,
  CITY_MARK_SIZE,
  CITY_ON_FLARE,
  CITY_PEARL,
} from '@/features/city/city-look'
import type { CityCover as CoverKind } from '@/features/city/city-page'

/**
 * What stands over the city while it cannot show (decision 75): the launch screen itself — the night and the Ryntra
 * mark in its middle, where the system's launch screen put it, so the one gives way to the other without a seam.
 * Opening — a thin line of light breathes under the mark; no connection or a page that did not open — one line and
 * one button. It fades away once the live city is there. No picture stands in for the city.
 */
export function CityCover({
  kind,
  title,
  action,
  loadingLabel,
  onRetry,
  onShown,
}: {
  kind: CoverKind
  title: string
  action: string
  loadingLabel: string
  onRetry: () => void
  /** The mark is on screen: the launch screen may go. */
  onShown: () => void
}) {
  const insets = useSafeAreaInsets()
  const visible = kind !== 'none'
  const [opacity] = useState(() => new Animated.Value(1))
  const [breath] = useState(() => new Animated.Value(0))

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 180 : 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }, [visible, opacity])

  const opening = kind === 'loading'
  useEffect(() => {
    if (!opening) return
    let loop: Animated.CompositeAnimation | null = null
    let stopped = false
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (stopped || reduced) return
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breath, {
            toValue: 1,
            duration: 1100,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(breath, {
            toValue: 0,
            duration: 1100,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      )
      loop.start()
    })
    return () => {
      stopped = true
      loop?.stop()
    }
  }, [opening, breath])

  const quiet = kind === 'offline' || kind === 'failed'
  const lineOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] })
  const lineScale = breath.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] })

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.root, { opacity }]}
    >
      <View style={styles.center} pointerEvents="none">
        <Image
          source={CITY_MARK}
          style={styles.mark}
          contentFit="contain"
          transition={0}
          onDisplay={onShown}
          accessible={false}
        />
        {opening ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={loadingLabel} style={styles.lineSlot}>
            <Animated.View style={[styles.line, { opacity: lineOpacity, transform: [{ scaleX: lineScale }] }]} />
          </View>
        ) : null}
      </View>
      {quiet ? (
        <View style={[styles.say, { paddingBottom: insets.bottom + 40 }]}>
          <Text accessibilityRole="header" style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
            hitSlop={8}
          >
            <Text style={styles.buttonText}>{action}</Text>
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  root: { backgroundColor: CITY_GROUND },
  // The mark stands where the launch screen put it: the window's middle, whatever the system bars are.
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: CITY_MARK_SIZE, height: CITY_MARK_SIZE },
  // The line hangs under the mark without moving it from the middle.
  lineSlot: {
    position: 'absolute',
    top: '50%',
    marginTop: CITY_MARK_SIZE / 2 + 28,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  line: { width: 56, height: 2, borderRadius: 1, backgroundColor: CITY_FLARE },
  say: { position: 'absolute', left: 24, right: 24, bottom: 0, alignItems: 'center', gap: 20 },
  title: { color: CITY_PEARL, fontFamily: CITY_FONT_STRONG, fontSize: 22, lineHeight: 28, textAlign: 'center' },
  button: {
    minWidth: 200,
    height: 52,
    paddingHorizontal: 28,
    borderRadius: 26,
    backgroundColor: CITY_FLARE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  buttonText: { color: CITY_ON_FLARE, fontFamily: CITY_FONT, fontSize: 16, letterSpacing: 0.2 },
})
