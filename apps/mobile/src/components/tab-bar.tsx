import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { useEffect, useState } from 'react'
import { Keyboard, Pressable, View } from 'react-native'

import { Icon, type IconName } from '@/components/icon'
import { Txt } from '@/components/txt'
import { BADGE_TAB, drawnTabs, type ShellRoute, type ShellTab } from '@/features/shell/shell'
import { fonts, page, useTheme } from '@/theme'

/**
 * Each place's glyph — the city's towers for «Місто»; the core's own for the menu's groups: the house and the pie, the candles of «Торгівля» — in
 * Material's set, which alone draws them — and the wallet of «Гроші». «Меню» keeps its three lines when current — a
 * filled glyph would outweigh the rest.
 */
const ICONS: Readonly<Record<Exclude<ShellTab, 'trading'>, Readonly<{ icon: IconName; active: IconName }>>> = {
  city: { icon: 'business-outline', active: 'business' },
  home: { icon: 'home-outline', active: 'home' },
  money: { icon: 'wallet-outline', active: 'wallet' },
  portfolio: { icon: 'pie-chart-outline', active: 'pie-chart' },
  menu: { icon: 'menu-outline', active: 'menu-outline' },
}

/** Words of the bar grow with the person's font size up to here; past it the bar's height would clip them. */
const MAX_FONT_SCALE = 1.3

function PlaceIcon({ tab, focused }: { tab: ShellTab; focused: boolean }) {
  const { colors } = useTheme()
  // The current place's glyph is the orange word's colour, as the web's icon follows its `currentColor`.
  if (tab === 'trading')
    return <MaterialIcons name="candlestick-chart" size={22} color={focused ? colors.brandInk : colors.muted} />
  return <Icon name={focused ? ICONS[tab].active : ICONS[tab].icon} size={22} color={focused ? 'brandInk' : 'muted'} />
}

const TAB_OF: Readonly<Record<string, ShellTab>> = Object.fromEntries(
  drawnTabs().map((entry) => [entry.route satisfies ShellRoute, entry.tab]),
)

/** The bar's height above the system bar — the core's `size.header`, the web's row of sections. */
const BAR_HEIGHT = 56

/**
 * The bar of places, drawn as the web draws its row of sections: the page's
 * own ground under a border, the place on screen in the orange word with a
 * brand bar on its edge, the rest quiet — without the web's glow, which
 * Android does not draw true. It steps aside while the keyboard is up.
 */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors } = useTheme()
  const [keyboard, setKeyboard] = useState(false)
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true))
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  if (keyboard) return null
  return (
    <View
      className="border-t border-line bg-ground"
      style={{ height: BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }}
    >
      {/* The places stand over the page's column, so on a wide window they sit under it, not spread to the edges. */}
      <View
        accessibilityRole="tablist"
        className="w-full flex-1 flex-row self-center"
        style={{ maxWidth: page.overview }}
      >
        {state.routes.map((route, index) => {
          const tab = TAB_OF[route.name]
          if (!tab) return null
          const { options } = descriptors[route.key]
          const focused = state.index === index
          const title = typeof options.title === 'string' ? options.title : route.name
          const badge = tab === BADGE_TAB ? options.tabBarBadge : undefined
          const press = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params)
          }
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge !== undefined ? `${title}, ${badge}` : title}
              onPress={press}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              android_ripple={{ color: colors.brandChip }}
              className="flex-1 items-center justify-center gap-1"
            >
              {focused ? <View className="absolute left-3 right-3 top-0 h-0.5 rounded-pill bg-brand" /> : null}
              <View>
                <PlaceIcon tab={tab} focused={focused} />
                {badge !== undefined ? (
                  <View className="absolute -right-2.5 -top-1.5 h-4 min-w-4 items-center justify-center rounded-pill bg-brand px-1">
                    <Txt
                      variant="labelSm"
                      tone="onBrand"
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={{ letterSpacing: 0 }}
                    >
                      {String(badge)}
                    </Txt>
                  </View>
                ) : null}
              </View>
              <Txt
                variant="labelSm"
                tone={focused ? 'brand' : 'muted'}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontFamily: focused ? fonts.sansSemibold : fonts.sansMedium,
                  fontSize: 12,
                  lineHeight: 16,
                  letterSpacing: 0,
                }}
              >
                {title}
              </Txt>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
