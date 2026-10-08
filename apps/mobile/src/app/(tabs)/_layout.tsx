import { useRouter } from 'expo-router'
import { Tabs } from 'expo-router/js-tabs'

import { Icon, type IconName } from '@/components/icon'
import { unreadCount } from '@/features/monitoring/monitoring-model'
import { useSurface } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { BADGE_TAB, badgeOf, drawnTabs, LAUNCH_ACTION_LABEL, TAB_TITLES, type ShellTab } from '@/features/shell/shell'
import { useQuickActions } from '@/features/shell/use-quick-actions'
import { useCopy, useLocale } from '@/lib/i18n'
import { fonts, useTheme } from '@/theme'

const ICONS: Readonly<Record<ShellTab, Readonly<{ icon: IconName; active: IconName }>>> = {
  home: { icon: 'home-outline', active: 'home' },
  markets: { icon: 'trending-up-outline', active: 'trending-up' },
  launch: { icon: 'add-circle-outline', active: 'add-circle' },
  portfolio: { icon: 'pie-chart-outline', active: 'pie-chart' },
  more: { icon: 'ellipsis-horizontal-circle-outline', active: 'ellipsis-horizontal-circle' },
}

/**
 * Головна · Ринки · + Лаунч · Портфель · Ще — the menu v6.2 on a phone,
 * the web's own five. The «+» is an action: a press opens «Запустити
 * токен» over the bar and never becomes the bar's current place. Ryntra is a
 * button on the screens and a row of «Ще», not a place here.
 */
export default function TabsLayout() {
  const router = useRouter()
  const { colors } = useTheme()
  const titles = useCopy(TAB_TITLES)
  const launchLabel = useCopy(LAUNCH_ACTION_LABEL)
  const locale = useLocale()
  const account = useAccount()
  // The unread notes of the wallet, as the server counts them, on the place where attention lives.
  const unread = unreadCount(useSurface(account.session, locale))
  // A long press on the launcher icon: four doors into the places.
  useQuickActions()
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.ground },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontFamily: fonts.sansMedium, fontSize: 11, letterSpacing: 0.2 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 1, elevation: 0 },
      }}
    >
      {drawnTabs().map((entry) => {
        const action = entry.action
        return (
          <Tabs.Screen
            key={entry.route}
            name={entry.route}
            listeners={
              action
                ? {
                    tabPress: (event) => {
                      event.preventDefault()
                      router.push(action as never)
                    },
                  }
                : undefined
            }
            options={{
              title: titles[entry.tab],
              tabBarAccessibilityLabel: action ? launchLabel : titles[entry.tab],
              tabBarBadge: entry.tab === BADGE_TAB ? badgeOf(unread) : undefined,
              tabBarBadgeStyle: {
                backgroundColor: colors.brand,
                color: colors.onBrand,
                fontFamily: fonts.sansMedium,
                fontSize: 10,
              },
              tabBarIcon: ({ focused, size }) =>
                action ? (
                  <Icon name={ICONS[entry.tab].icon} size={size + 4} color="fg" />
                ) : (
                  <Icon
                    name={focused ? ICONS[entry.tab].active : ICONS[entry.tab].icon}
                    size={size}
                    color={focused ? 'brand' : 'muted'}
                  />
                ),
            }}
          />
        )
      })}
    </Tabs>
  )
}
