import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable } from 'react-native'

import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import { Screen } from '@/components/screen'
import { Txt } from '@/components/txt'
import { BLOCKS_COPY } from '@/features/home/blocks-copy'
import { arrangeable, availableBlocks } from '@/features/home/home-blocks'
import { accountState } from '@/features/home/home-model'
import { useHomeLayout } from '@/features/home/use-home-layout'
import { siteHrefOf } from '@/features/monitoring/deep-link'
import { unreadCount } from '@/features/monitoring/monitoring-model'
import { useSurface } from '@/features/plans/use-plans'
import { accountDeletionMailto, DELETION_POLICY_URL } from '@/features/session/account-deletion'
import { useAccount } from '@/features/session/use-account'
import { HELP_URL, PLACES_COPY } from '@/features/shell/places'
import { WalletPanel } from '@/features/wallet/wallet-panel'
import { SIGNING_COPY } from '@/features/wallet/signing-copy'
import {
  LOCALE_PREFERENCES,
  setLocalePreference,
  useCopy,
  useLocale,
  useLocalePreference,
  useSharedCopy,
  type Copy,
  type LocalePreference,
} from '@/lib/i18n'
import { PRIVACY_URL, TERMS_URL } from '@/lib/legal'
import { openLink } from '@/lib/open-link'
import { ArrangeSheet } from '@/screens/home/arrange-sheet'
import {
  DENSITIES,
  getThemeMode,
  setDensity,
  setThemeMode,
  THEME_MODES,
  useDensity,
  type Density,
  type ThemeMode,
} from '@/theme'

type SettingsCopy = Readonly<{
  title: string
  appearance: string
  language: string
  account: string
  monitoring: string
  deleteData: string
  byMail: string
  ryntra: string
  docs: string
  terms: string
  privacy: string
  version: string
  gallery: string
  theme: Readonly<Record<ThemeMode, string>>
  density: string
  home: string
  densities: Readonly<Record<Density, string>>
  locales: Readonly<Record<LocalePreference, string>>
}>

const COPY: Copy<SettingsCopy> = {
  en: {
    title: 'Settings',
    appearance: 'Appearance',
    language: 'Language',
    account: 'Account',
    monitoring: 'Inbox',
    deleteData: 'Delete account data',
    byMail: 'opens your mail app',
    ryntra: 'Ryntra',
    docs: 'Docs',
    terms: 'Terms of Use',
    privacy: 'Privacy',
    version: 'Version',
    gallery: 'Design gallery',
    theme: { dark: 'Graphite', light: 'Porcelain', system: 'As the system' },
    density: 'Density',
    home: 'Home',
    densities: { regular: 'Regular', compact: 'Compact' },
    locales: { en: 'English', uk: 'Українська', system: 'System' },
  },
  uk: {
    title: 'Налаштування',
    appearance: 'Вигляд',
    language: 'Мова',
    account: 'Акаунт',
    monitoring: 'Вхідні',
    deleteData: 'Видалити дані акаунта',
    byMail: 'відкриває пошту',
    ryntra: 'Ryntra',
    docs: 'Документація',
    terms: 'Умови використання',
    privacy: 'Приватність',
    version: 'Версія',
    gallery: 'Галерея дизайну',
    theme: { dark: 'Graphite', light: 'Porcelain', system: 'Як у системі' },
    density: 'Щільність',
    home: 'Головна',
    densities: { regular: 'Звичайна', compact: 'Компактна' },
    locales: { en: 'English', uk: 'Українська', system: 'Системна' },
  },
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

function ThemePicker({ labels }: { labels: SettingsCopy['theme'] }) {
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

/** The web's two densities: the same screens, tighter or roomier — never a different app. */
function DensityPicker({ labels }: { labels: SettingsCopy['densities'] }) {
  const density = useDensity()
  return (
    <Segmented
      options={DENSITIES.map((value) => ({ value, label: labels[value] }))}
      value={density}
      onChange={setDensity}
    />
  )
}

function LanguagePicker({ labels }: { labels: SettingsCopy['locales'] }) {
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
 * «Налаштування» — a row at the foot of «Меню»: the wallet and its monitoring,
 * the look and the language, and where the product lives. What «Ще» once drew
 * below its doors before the menu v6.2, gathered in one place.
 */
export function SettingsScreen() {
  const router = useRouter()
  const copy = useCopy(COPY)
  const places = useCopy(PLACES_COPY)
  const signing = useCopy(SIGNING_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const account = useAccount()
  const unread = unreadCount(useSurface(account.session, locale))
  const blocks = useCopy(BLOCKS_COPY)
  const layout = useHomeLayout()
  const [arranging, setArranging] = useState(false)
  const available = availableBlocks(accountState(account.address, account.session) !== 'guest')
  const rows = arrangeable(layout, available)
  const version = Constants.expoConfig?.version ?? '—'
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))
  return (
    <Screen title={copy.title} onBack={back} backLabel={shared.back}>
      <SectionLabel>{copy.account}</SectionLabel>
      <WalletPanel />
      <Card padded={false}>
        <DoorRow
          icon={unread > 0 ? 'notifications' : 'notifications-outline'}
          label={copy.monitoring}
          value={unread > 0 ? String(unread) : undefined}
          onPress={() => router.push('/monitoring')}
        />
        <DoorRow icon="finger-print-outline" label={signing.title} onPress={() => router.push('/signing')} />
        <DoorRow
          icon="trash-outline"
          label={copy.deleteData}
          external={copy.byMail}
          onPress={() => {
            Linking.openURL(accountDeletionMailto(account.address, locale)).catch(
              () => void Linking.openURL(DELETION_POLICY_URL).catch(() => undefined),
            )
          }}
          last
        />
      </Card>
      <SectionLabel>{copy.appearance}</SectionLabel>
      <ThemePicker labels={copy.theme} />
      <SectionLabel>{copy.density}</SectionLabel>
      <DensityPicker labels={copy.densities} />
      <SectionLabel>{copy.home}</SectionLabel>
      <Card padded={false}>
        <DoorRow
          icon="grid-outline"
          label={blocks.title}
          value={blocks.shown(rows.filter((block) => block.on).length, rows.length)}
          onPress={() => setArranging(true)}
          last
        />
      </Card>
      <SectionLabel>{copy.language}</SectionLabel>
      <LanguagePicker labels={copy.locales} />
      <SectionLabel>{copy.ryntra}</SectionLabel>
      <Card padded={false}>
        <DoorRow
          icon="globe-outline"
          label="ryntra.io"
          external={places.onWeb}
          onPress={() => openLink(siteHrefOf('https://ryntra.io', locale))}
        />
        <DoorRow
          icon="document-text-outline"
          label={copy.docs}
          external={places.onWeb}
          onPress={() => openLink(siteHrefOf(HELP_URL, locale))}
        />
        <DoorRow icon="reader-outline" label={copy.terms} external={places.onWeb} onPress={() => openLink(TERMS_URL)} />
        <DoorRow
          icon="shield-checkmark-outline"
          label={copy.privacy}
          external={places.onWeb}
          onPress={() => openLink(PRIVACY_URL)}
        />
        <DoorRow icon="information-circle-outline" label={copy.version} value={version} last={!__DEV__} />
        {__DEV__ ? (
          <DoorRow icon="color-palette-outline" label={copy.gallery} onPress={() => router.push('/gallery')} last />
        ) : null}
      </Card>
      <ArrangeSheet visible={arranging} available={available} onClose={() => setArranging(false)} />
    </Screen>
  )
}
