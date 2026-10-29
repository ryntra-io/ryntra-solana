import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Icon, type IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Txt } from '@/components/txt'
import { useRules } from '@/features/autoinvest/use-rules'
import { activeCount } from '@/features/bots/bots'
import { PLACE_HOME_COPY } from '@/features/home/place-copy'
import { siteHrefOf, webHrefOf } from '@/features/monitoring/deep-link'
import { APP_VERSION } from '@/features/notifications/use-notifications'
import { usePlans } from '@/features/plans/use-plans'
import { CreditsBadge } from '@/screens/agent/credits-badge'
import { useAccount } from '@/features/session/use-account'
import {
  MENU_AUX,
  MENU_COPY,
  MENU_DESTINATIONS,
  menuGroups,
  type MenuGroup,
  type NavItemId,
} from '@/features/shell/menu'
import { useMenuGroups } from '@/features/shell/use-menu-groups'
import { useOpenPlace } from '@/features/shell/open-place'
import { PLACES_COPY, type PlaceDestination } from '@/features/shell/places'
import { useCopy, useLocale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { useTheme } from '@/theme'
import { cn } from '@/utils/cn'

/** Each group's glyph — the core's own (candles, a bot, a percent, a wallet, a landmark), from the nearest set. */
function GroupIcon({ icon }: { icon: MenuGroup['icon'] }) {
  const { colors } = useTheme()
  if (icon === 'chart-candlestick') return <MaterialIcons name="candlestick-chart" size={20} color={colors.muted} />
  if (icon === 'bot') return <MaterialCommunityIcons name="robot-outline" size={20} color={colors.muted} />
  if (icon === 'percent') return <MaterialCommunityIcons name="percent-circle-outline" size={20} color={colors.muted} />
  if (icon === 'landmark') return <Icon name="business-outline" size={20} />
  return <Icon name="wallet-outline" size={20} />
}

/** A row that leaves the app for a site: marked ↗ and said so. */
const leaves = (destination: PlaceDestination) => destination.kind === 'site' || destination.kind === 'web'

type RowProps = {
  label: string
  onPress: () => void
  external: string | null
  value?: string
  /** A small mark before the arrow — the assistant's credits. */
  mark?: React.ReactNode
  last: boolean
}

/** A row inside an open group: the word, indented under the group's word, and where it goes. */
function Row({ label, onPress, external, value, mark, last }: RowProps) {
  return (
    <Pressable
      accessibilityRole={external ? 'link' : 'button'}
      accessibilityLabel={[label, value, external].filter(Boolean).join(', ')}
      onPress={onPress}
      className={cn(
        'min-h-12 flex-row items-center gap-3 pl-[52px] pr-4 active:bg-hover',
        !last && 'border-b border-line',
      )}
    >
      <Txt variant="ui" className="flex-1">
        {label}
      </Txt>
      {value ? (
        <Txt variant="data" tone="muted">
          {value}
        </Txt>
      ) : null}
      {mark}
      <Icon
        name={external ? 'arrow-up-outline' : 'chevron-forward'}
        size={16}
        color="fgMuted"
        style={external ? { transform: [{ rotate: '45deg' }] } : undefined}
      />
    </Pressable>
  )
}

type HeadProps = {
  icon: React.ReactNode
  label: string
  open: boolean
  onPress: () => void
  last: boolean
}

/** A group's head: its glyph, its word and the arrow that opens and shuts its rows. */
function Head({ icon, label, open, onPress, last }: HeadProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={label}
      onPress={onPress}
      className={cn('min-h-14 flex-row items-center gap-3 px-4 active:bg-hover', !last && 'border-b border-line')}
    >
      <View className="w-6 items-center">{icon}</View>
      <Txt variant="ui" className="flex-1">
        {label}
      </Txt>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color="fgMuted" />
    </Pressable>
  )
}

const AUX_ICONS: Readonly<Record<keyof typeof MENU_AUX, IconName>> = {
  settings: 'settings-outline',
  help: 'help-circle-outline',
}

/**
 * «Меню» (Menu 3, decision 55): Home, then the groups that live in the phone — each opened and shut by its arrow and
 * remembered on this phone, Гроші open until the person shuts it — and apart at the foot Налаштування and Допомога;
 * the version under it. No network row and no «Інші продукти»: the phone is Ryntra on Solana alone (`menu.ts`). Rows
 * are words only: no line under them, nothing to read before choosing. A row opens the phone's own screen or a place
 * of the bar; a site's row says it opens the browser. `receive=1` — an older link to the address — opens «Отримати».
 */
export function MenuScreen() {
  const router = useRouter()
  const openPlace = useOpenPlace()
  const words = useCopy(MENU_COPY)
  const places = useCopy(PLACES_COPY)
  const homeWords = useCopy(PLACE_HOME_COPY)
  const account = useAccount()
  const rules = useRules(account.session)
  const plans = usePlans(account.session)
  const running = account.session ? activeCount(rules.data?.rules ?? null, plans.data?.plans ?? null) : null
  const groups = useMenuGroups()
  const locale = useLocale()
  const [toppingUp, setToppingUp] = useState(false)
  const { receive } = useLocalSearchParams<{ receive?: string }>()
  useEffect(() => {
    if (receive !== '1') return
    router.setParams({ receive: '' })
    router.push('/money/receive' as never)
  }, [receive, router])

  const go = (destination: PlaceDestination) => {
    if (destination.kind === 'sheet') setToppingUp(true)
    else if (destination.kind === 'site') openLink(siteHrefOf(destination.url, locale))
    else if (destination.kind === 'web') {
      const web = webHrefOf(destination.path, locale)
      if (web) openLink(web)
    } else if (destination.path.startsWith('/(tabs)')) openPlace(destination.path)
    else router.push(destination.path as never)
  }
  const external = (id: NavItemId) => {
    const destination = MENU_DESTINATIONS[id]
    return destination && leaves(destination) ? words.inBrowser : null
  }
  const drawn = menuGroups()
  const home = MENU_DESTINATIONS.home

  return (
    <Screen title={words.menu}>
      {/* A guest's one action here, as Home's: the wallet first, then everything below answers for it. */}
      {account.address ? null : (
        <Button title={homeWords.connect} loading={account.busy === 'connect'} onPress={() => void account.connect()} />
      )}
      <Card padded={false}>
        {home ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.items.home}
            onPress={() => go(home)}
            className="min-h-14 flex-row items-center gap-3 border-b border-line px-4 active:bg-hover"
          >
            <View className="w-6 items-center">
              <Icon name="home-outline" size={20} />
            </View>
            <Txt variant="ui" className="flex-1">
              {words.items.home}
            </Txt>
            <Icon name="chevron-forward" size={16} color="fgMuted" />
          </Pressable>
        ) : null}
        {drawn.map((group, index) => {
          const open = groups.isOpen(group.id)
          const lastGroup = index === drawn.length - 1
          return (
            <View key={group.id}>
              <Head
                icon={<GroupIcon icon={group.icon} />}
                label={words.groups[group.id]}
                open={open}
                onPress={() => groups.toggle(group.id)}
                last={lastGroup && !open}
              />
              {open
                ? group.rows.map((id, at) => {
                    const destination = MENU_DESTINATIONS[id]
                    if (!destination) return null
                    return (
                      <Row
                        key={id}
                        label={words.items[id]}
                        external={external(id)}
                        value={id === 'bots' && running !== null && running > 0 ? places.active(running) : undefined}
                        // The assistant's credits on the way in: a proven wallet's balance above zero, nothing else.
                        mark={id === 'assistant' ? <CreditsBadge session={account.session} /> : undefined}
                        onPress={() => go(destination)}
                        last={lastGroup && at === group.rows.length - 1}
                      />
                    )
                  })
                : null}
            </View>
          )
        })}
      </Card>
      <Card padded={false}>
        {(Object.keys(MENU_AUX) as (keyof typeof MENU_AUX)[]).map((key, index, keys) => {
          const destination = MENU_AUX[key]
          return (
            <Pressable
              key={key}
              accessibilityRole={leaves(destination) ? 'link' : 'button'}
              accessibilityLabel={[words[key], leaves(destination) ? words.inBrowser : null].filter(Boolean).join(', ')}
              onPress={() => go(destination)}
              className={cn(
                'min-h-14 flex-row items-center gap-3 px-4 active:bg-hover',
                index < keys.length - 1 && 'border-b border-line',
              )}
            >
              <View className="w-6 items-center">
                <Icon name={AUX_ICONS[key]} size={20} />
              </View>
              <Txt variant="ui" className="flex-1">
                {words[key]}
              </Txt>
              <Icon
                name={leaves(destination) ? 'arrow-up-outline' : 'chevron-forward'}
                size={16}
                color="fgMuted"
                style={leaves(destination) ? { transform: [{ rotate: '45deg' }] } : undefined}
              />
            </Pressable>
          )
        })}
      </Card>
      <Txt variant="labelSm" tone="faint" tabular className="text-center">
        {words.version(APP_VERSION)}
      </Txt>
      <TopUpSheet
        visible={toppingUp}
        address={account.address}
        purpose="top-up"
        onClose={() => setToppingUp(false)}
        onConnect={() => void account.connect()}
        connecting={account.busy === 'connect'}
      />
    </Screen>
  )
}
