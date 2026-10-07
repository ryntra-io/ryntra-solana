import Constants from 'expo-constants'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Linking, Pressable } from 'react-native'

import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import type { IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Txt } from '@/components/txt'
import { launchWords } from '@/features/launch/copy'
import { useLaunchOpen } from '@/features/launch/use-launch'
import { webHrefOf } from '@/features/monitoring/deep-link'
import { unreadCount } from '@/features/monitoring/monitoring-model'
import { useSurface } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { MONEY_COPY } from '@/features/money/copy'
import {
  DOOR_DESTINATIONS,
  MONEY_PAGES,
  MORE_PAGES,
  PLACES_COPY,
  type MoneyPage,
  type MorePage,
} from '@/features/shell/places'
import { WalletPanel } from '@/features/wallet/wallet-panel'
import {
  LOCALE_PREFERENCES,
  setLocalePreference,
  useCopy,
  useLocale,
  useLocalePreference,
  type Copy,
  type LocalePreference,
} from '@/lib/i18n'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { getThemeMode, setThemeMode, THEME_MODES, type ThemeMode } from '@/theme'

type MoreCopy = Readonly<{
  title: string
  appearance: string
  language: string
  account: string
  monitoring: string
  ryntra: string
  docs: string
  version: string
  gallery: string
  theme: Readonly<Record<ThemeMode, string>>
  locales: Readonly<Record<LocalePreference, string>>
}>

const COPY: Copy<MoreCopy> = {
  en: {
    title: 'More',
    appearance: 'Appearance',
    language: 'Language',
    account: 'Account',
    monitoring: 'Monitoring',
    ryntra: 'Ryntra',
    docs: 'Docs',
    version: 'Version',
    gallery: 'Design gallery',
    theme: { dark: 'Dark', light: 'Light', system: 'System' },
    locales: { en: 'English', uk: 'Українська', system: 'System' },
  },
  uk: {
    title: 'Ще',
    appearance: 'Вигляд',
    language: 'Мова',
    account: 'Акаунт',
    monitoring: 'Моніторинг',
    ryntra: 'Ryntra',
    docs: 'Документація',
    version: 'Версія',
    gallery: 'Галерея дизайну',
    theme: { dark: 'Темна', light: 'Світла', system: 'Системна' },
    locales: { en: 'English', uk: 'Українська', system: 'Системна' },
  },
}

/** The icon of each door of «Гроші». */
const MONEY_ICONS: Readonly<Record<MoneyPage, IconName>> = {
  topUp: 'add-circle-outline',
  send: 'arrow-up-outline',
  receive: 'arrow-down-outline',
  link: 'link-outline',
}

/** The icon of each page «Ще» holds. */
const PAGE_ICONS: Readonly<Record<MorePage, IconName>> = {
  swap: 'swap-horizontal-outline',
  bridge: 'git-compare-outline',
  rewards: 'gift-outline',
  predictions: 'stats-chart-outline',
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Txt variant="labelSm" tone="faint" caps className="px-1 pt-2">
      {children}
    </Txt>
  )
}

/** One choice out of a few, as a segmented row — the theme, the language. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <Card padded={false} className="flex-row overflow-hidden p-1" accessibilityRole="radiogroup">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            className={`h-10 flex-1 items-center justify-center rounded-xs ${selected ? 'bg-elevated border border-line-strong' : 'active:bg-hover'}`}
          >
            <Txt variant="ui" tone={selected ? 'fg' : 'muted'}>
              {option.label}
            </Txt>
          </Pressable>
        )
      })}
    </Card>
  )
}

function ThemePicker({ labels }: { labels: MoreCopy['theme'] }) {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode)
  return (
    <Segmented
      options={THEME_MODES.map((option) => ({ value: option.mode, label: labels[option.mode] }))}
      value={mode}
      onChange={(next) => {
        setMode(next)
        setThemeMode(next)
      }}
    />
  )
}

function LanguagePicker({ labels }: { labels: MoreCopy['locales'] }) {
  const preference = useLocalePreference()
  return (
    <Segmented
      options={LOCALE_PREFERENCES.map((value) => ({ value, label: labels[value] }))}
      value={preference}
      onChange={setLocalePreference}
    />
  )
}

/**
 * «Ще» — one version for everyone, guests included (canon v5.3 В28, §3):
 * «Лаунч · Свій токен» first while Launch is served (M33), then «Гроші» (M31) — Поповнити (the top-up sheet), Надіслати, Отримати,
 * Посилання на оплату — then the web's pages in the Owner's order: Обмін
 * (Trade on a swap), Міст, Винагороди, Демо-прогнози; a page only ryntra.io
 * has built is marked ↗ and opens there. Then the wallet and its monitoring,
 * the appearance and the language, and where the product lives. No switch of
 * depth: what «Профі» held lives a tap deeper in the places themselves.
 * `receive=1` — an older link to the address — opens «Отримати».
 */
export function MoreScreen() {
  const router = useRouter()
  const copy = useCopy(COPY)
  const places = useCopy(PLACES_COPY)
  const money = useCopy(MONEY_COPY)
  const locale = useLocale()
  const account = useAccount()
  const unread = unreadCount(useSurface(account.session, locale))
  const version = Constants.expoConfig?.version ?? '—'
  const { receive } = useLocalSearchParams<{ receive?: string }>()
  const [toppingUp, setToppingUp] = useState(false)
  const launch = useLaunchOpen()
  const launchWord = launchWords(locale)
  useEffect(() => {
    if (receive !== '1') return
    router.setParams({ receive: '' })
    router.push('/money/receive' as never)
  }, [receive, router])
  const open = (page: MorePage | MoneyPage) => {
    const destination = DOOR_DESTINATIONS[page]
    if (destination.kind === 'sheet') setToppingUp(true)
    else if (destination.kind === 'screen') router.push(destination.path as never)
    else {
      const web = webHrefOf(destination.path)
      if (web) void Linking.openURL(web)
    }
  }
  return (
    <Screen title={copy.title}>
      {launch.open ? (
        <Card padded={false}>
          <DoorRow
            icon="rocket-outline"
            label={launchWord('place')}
            line={launchWord('placeLine')}
            onPress={() => router.push('/launch' as never)}
            last
          />
        </Card>
      ) : null}
      <SectionLabel>{money.money}</SectionLabel>
      <Card padded={false}>
        {MONEY_PAGES.map((page, index) => (
          <DoorRow
            key={page}
            icon={MONEY_ICONS[page]}
            label={money.pages[page]}
            onPress={() => open(page)}
            last={index === MONEY_PAGES.length - 1}
          />
        ))}
      </Card>
      <Card padded={false}>
        {MORE_PAGES.map((page, index) => (
          <DoorRow
            key={page}
            icon={PAGE_ICONS[page]}
            label={places.pages[page]}
            external={DOOR_DESTINATIONS[page].kind === 'web' ? places.onWeb : null}
            onPress={() => open(page)}
            last={index === MORE_PAGES.length - 1}
          />
        ))}
      </Card>
      <SectionLabel>{copy.account}</SectionLabel>
      <WalletPanel />
      <Card padded={false}>
        <DoorRow
          icon={unread > 0 ? 'notifications' : 'notifications-outline'}
          label={copy.monitoring}
          value={unread > 0 ? String(unread) : undefined}
          onPress={() => router.push('/monitoring')}
          last
        />
      </Card>
      <SectionLabel>{copy.appearance}</SectionLabel>
      <ThemePicker labels={copy.theme} />
      <SectionLabel>{copy.language}</SectionLabel>
      <LanguagePicker labels={copy.locales} />
      <SectionLabel>{copy.ryntra}</SectionLabel>
      <Card padded={false}>
        <DoorRow
          icon="globe-outline"
          label="ryntra.io"
          external={places.onWeb}
          onPress={() => void Linking.openURL('https://ryntra.io')}
        />
        <DoorRow
          icon="document-text-outline"
          label={copy.docs}
          external={places.onWeb}
          onPress={() => void Linking.openURL('https://ryntra.io/docs')}
        />
        <DoorRow icon="information-circle-outline" label={copy.version} value={version} last={!__DEV__} />
        {__DEV__ ? (
          <DoorRow icon="color-palette-outline" label={copy.gallery} onPress={() => router.push('/gallery')} last />
        ) : null}
      </Card>
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
