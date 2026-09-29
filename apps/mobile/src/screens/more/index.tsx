import Constants from 'expo-constants'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable } from 'react-native'

import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import type { IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Txt } from '@/components/txt'
import { webHrefOf } from '@/features/monitoring/deep-link'
import { unreadCount } from '@/features/monitoring/monitoring-model'
import { useSurface } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { DOOR_DESTINATIONS, MORE_PAGES, PLACES_COPY, type MorePage } from '@/features/shell/places'
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

/** The icon of each page «Ще» holds. */
const PAGE_ICONS: Readonly<Record<MorePage, IconName>> = {
  swap: 'swap-horizontal-outline',
  bridge: 'git-compare-outline',
  send: 'arrow-up-outline',
  receive: 'arrow-down-outline',
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
 * «Ще» — one version for everyone, guests included (canon v5.3 В28, §3): the
 * web's pages first, in the Owner's order — Обмін (Trade on a swap), Міст,
 * Надіслати, Отримати (the wallet's own address), Винагороди, Демо-прогнози;
 * a page only ryntra.io has built is marked ↗ and opens there. Then the
 * wallet and its monitoring, the appearance and the language, and where the
 * product lives. No switch of depth: what «Профі» held lives a tap deeper in
 * the places themselves. `receive=1` — the web's `/app/receive` — opens the
 * address at once; closing it drops the word, so it opens once.
 */
export function MoreScreen() {
  const router = useRouter()
  const copy = useCopy(COPY)
  const places = useCopy(PLACES_COPY)
  const locale = useLocale()
  const account = useAccount()
  const unread = unreadCount(useSurface(account.session, locale))
  const version = Constants.expoConfig?.version ?? '—'
  const { receive } = useLocalSearchParams<{ receive?: string }>()
  const [receiving, setReceiving] = useState(false)
  const closeReceive = () => {
    setReceiving(false)
    if (receive) router.setParams({ receive: '' })
  }
  const open = (page: MorePage) => {
    const destination = DOOR_DESTINATIONS[page]
    if (destination.kind === 'sheet') setReceiving(true)
    else if (destination.kind === 'screen') router.push(destination.path as never)
    else {
      const web = webHrefOf(destination.path)
      if (web) void Linking.openURL(web)
    }
  }
  return (
    <Screen title={copy.title}>
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
        visible={receiving || receive === '1'}
        address={account.address}
        purpose="receive"
        onClose={closeReceive}
        onConnect={() => void account.connect()}
        connecting={account.busy === 'connect'}
      />
    </Screen>
  )
}
