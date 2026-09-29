import { Tabs } from 'expo-router/js-tabs'

import { Icon, type IconName } from '@/components/icon'
import { unreadCount } from '@/features/monitoring/monitoring-model'
import { useSurface } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { BADGE_TAB, badgeOf, drawnTabs, TAB_TITLES, type ShellTab } from '@/features/shell/shell'
import { useCopy, useLocale } from '@/lib/i18n'
import { fonts, useTheme } from '@/theme'

const ICONS: Readonly<Record<ShellTab, Readonly<{ icon: IconName; active: IconName }>>> = {
  home: { icon: 'home-outline', active: 'home' },
  markets: { icon: 'trending-up-outline', active: 'trending-up' },
  agent: { icon: 'sparkles-outline', active: 'sparkles' },
  portfolio: { icon: 'pie-chart-outline', active: 'pie-chart' },
  more: { icon: 'ellipsis-horizontal-circle-outline', active: 'ellipsis-horizontal-circle' },
}

/**
 * Home · Markets · Agent · Portfolio · More — the target shell (canon §5.3,
 * §20.11); the Agent tab is the assistant (M11). The doors of the built shell
 * that lost their tab (Trade, Strategies) are paths the deep-link mapper
 * rewrites to the surfaces they always opened, so a saved link lands where
 * it did before; nothing hidden is drawn here.
 */
export default function TabsLayout() {
  const { colors } = useTheme()
  const titles = useCopy(TAB_TITLES)
  const locale = useLocale()
  const account = useAccount()
  // The unread notes of the wallet, as the server counts them, on the tab where attention lives.
  const unread = unreadCount(useSurface(account.session, locale))
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
      {drawnTabs().map((entry) => (
        <Tabs.Screen
          key={entry.route}
          name={entry.route}
          options={{
            title: titles[entry.tab],
            tabBarBadge: entry.tab === BADGE_TAB ? badgeOf(unread) : undefined,
            tabBarBadgeStyle: {
              backgroundColor: colors.brand,
              color: colors.onBrand,
              fontFamily: fonts.sansMedium,
              fontSize: 10,
            },
            tabBarIcon: ({ focused, size }) => (
              <Icon
                name={focused ? ICONS[entry.tab].active : ICONS[entry.tab].icon}
                size={size}
                color={focused ? 'brand' : 'muted'}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}
