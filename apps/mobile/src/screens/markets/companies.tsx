import { useRouter } from 'expo-router'
import { useMemo, useState, type ReactNode } from 'react'
import { Keyboard, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import type { IconName } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { SearchInput } from '@/components/search-field'
import { Txt } from '@/components/txt'
import { INVEST_COPY } from '@/features/invest/copy'
import { CRYPTO_SHOWN, matchCoins, matchShelf, premiumPhrase } from '@/features/invest/shelf'
import { useCoinShelf, useCompanyShelf } from '@/features/invest/use-shelf'
import { MARKETS_TOOL_PATHS, MARKETS_TOOLS, PLACES_COPY, type MarketsTool } from '@/features/shell/places'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale } from '@/lib/i18n'
import { coinItem, companyItem, RowSkeleton, ShelfRow, type ShelfItem } from '@/screens/invest/shelf-ui'
import { useTheme } from '@/theme'
import { DASH, formatAt } from '@/utils/format'

/** The icon of each tool of «Для досвідчених». */
const TOOL_ICONS: Readonly<Record<MarketsTool, IconName>> = {
  spot: 'swap-horizontal-outline',
  stocks: 'business-outline',
  trends: 'flame-outline',
}

/** Companies on the first screen before «Показати ще», and how many each press adds. */
const COMPANIES_SHOWN = 12
const MORE_STEP = 24

function Section({
  title,
  aside,
  note,
  children,
}: {
  title: ReactNode
  aside?: string | null
  note?: string | null
  children: ReactNode
}) {
  return (
    <View className="gap-1">
      <View className="gap-0.5 pt-2">
        <View className="flex-row flex-wrap items-baseline gap-x-1.5">
          <Txt variant="title" accessibilityRole="header">
            {title}
          </Txt>
          {aside ? (
            <Txt variant="ui" tone="faint">
              {`· ${aside}`}
            </Txt>
          ) : null}
        </View>
        {note ? (
          <Txt variant="ui" tone="faint">
            {note}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  )
}

function Rows({
  items,
  shown,
  onOpen,
  today,
}: {
  items: readonly ShelfItem[]
  shown: number
  onOpen: (item: ShelfItem) => void
  today: string
}) {
  const locale = useLocale()
  const visible = items.slice(0, shown)
  return (
    <View>
      {visible.map((item, index) => (
        <ShelfRow
          key={item.key}
          item={item}
          locale={locale}
          today={today}
          onPress={() => onOpen(item)}
          last={index === visible.length - 1}
        />
      ))}
    </View>
  )
}

/**
 * Markets, for everyone (canon v5.1 §3; M14; one version since v5.3 В28):
 * **Компанії** first — one company, one card, in the published order — then
 * «Приватні компанії · для досвідчених» — PreStocks' eight (canon v5.2
 * В25–В27; M18), «Це не акція» on every card and its price against PreStocks'
 * valuation — then «Для досвідчених», what «Профі» held a tap deeper: Спот
 * (Trade), Акції and Тренди (the four lists with their sorts, memes among
 * them) — then «Долари», «Крипта», and one search over all of them, which
 * hides the tools while it holds a word. A row is a logo, a name, a price in
 * dollars and the day's change; the ticker, the issuer, the session, the mint,
 * the pools and the clock in UTC live on the company's page under «Деталі».
 */
export function CompaniesMarkets() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { colors } = useTheme()
  const locale = useLocale()
  const now = useNow(60_000)
  const copy = useCopy(INVEST_COPY)
  const places = useCopy(PLACES_COPY)
  const shelf = useCompanyShelf()
  const coins = useCoinShelf()
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(COMPANIES_SHOWN)
  const [cryptoShown, setCryptoShown] = useState(CRYPTO_SHOWN)
  const searching = query.trim().length > 0

  const companies = useMemo(
    () => matchShelf(shelf.shelf?.companies ?? [], query).map((card) => companyItem(card)),
    [shelf.shelf, query],
  )
  const privates = useMemo(
    () =>
      matchShelf(shelf.shelf?.privateCompanies ?? [], query).map((card) =>
        companyItem(card, copy.notAShare, premiumPhrase(card.premiumPct, locale, copy)),
      ),
    [shelf.shelf, query, copy, locale],
  )
  const dollars = useMemo(() => matchCoins(coins.shelf?.dollars ?? [], query).map(coinItem), [coins.shelf, query])
  const crypto = useMemo(() => matchCoins(coins.shelf?.crypto ?? [], query).map(coinItem), [coins.shelf, query])

  // Every card carries the ticker the page is opened by; a coin is opened by its address alone.
  const tickers = useMemo(() => {
    const map = new Map<string, string>()
    for (const card of [...(shelf.shelf?.companies ?? []), ...(shelf.shelf?.privateCompanies ?? [])]) {
      map.set(card.mint, card.ticker)
    }
    return map
  }, [shelf.shelf])
  const open = (item: ShelfItem) => {
    Keyboard.dismiss()
    const symbol = tickers.get(item.mint)
    router.push({ pathname: '/asset/[mint]', params: symbol ? { mint: item.mint, symbol } : { mint: item.mint } })
  }

  const shelfTime = shelf.shelf ? formatAt(shelf.shelf.fetchedAt, now, locale) : null
  const subtitle = shelf.shelf
    ? shelf.fromDevice
      ? shelf.query.isError
        ? `${copy.pricesAt(shelfTime ?? DASH)} · ${copy.notUpdated}`
        : copy.updating
      : shelf.query.isError
        ? `${copy.pricesAt(shelfTime ?? DASH)} · ${copy.notUpdated}`
        : copy.pricesAt(shelfTime ?? DASH)
    : undefined

  const refreshing =
    (shelf.query.isFetching && shelf.query.data !== undefined) ||
    ((coins.crypto.isFetching || coins.dollars.isFetching) && coins.shelf !== null && !coins.pending)
  const refresh = () => {
    void shelf.query.refetch()
    void coins.refetch()
  }

  /* ---- the companies ---- */
  let companiesBody: ReactNode
  if (shelf.shelf) {
    companiesBody =
      companies.length > 0 ? (
        <>
          <Rows items={companies} shown={searching ? companies.length : shown} onOpen={open} today={copy.today} />
          {!searching && companies.length > shown ? (
            <Button
              title={copy.showMore}
              variant="secondary"
              onPress={() => setShown((count) => count + MORE_STEP)}
              className="mt-2"
            />
          ) : null}
        </>
      ) : null
  } else if (shelf.query.isError) {
    companiesBody = (
      <View className="items-start gap-3 py-3">
        <Txt variant="ui" tone="muted">
          {copy.shelfDown}
        </Txt>
        <Button
          title={copy.reload}
          variant="secondary"
          size="sm"
          loading={shelf.query.isFetching}
          onPress={() => void shelf.query.refetch()}
        />
      </View>
    )
  } else {
    companiesBody = <RowSkeleton count={COMPANIES_SHOWN} />
  }

  /* ---- the coins ---- */
  let coinsBody: ReactNode = null
  if (!coins.shelf) {
    coinsBody = coins.failed ? (
      <View className="items-start gap-3 py-3">
        <Txt variant="ui" tone="muted">
          {copy.coinsDown}
        </Txt>
        <Button title={copy.reload} variant="secondary" size="sm" onPress={() => void coins.refetch()} />
      </View>
    ) : (
      <Section title={copy.crypto}>
        <RowSkeleton count={4} />
      </Section>
    )
  }

  const nothing =
    searching &&
    shelf.shelf !== null &&
    coins.shelf !== null &&
    companies.length + privates.length + dollars.length + crypto.length === 0

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <ScreenHeader title={copy.marketsTitle} subtitle={subtitle} />
      <View className="flex-row px-4 pb-3">
        <SearchInput
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder={copy.search}
          label={copy.search}
          clearLabel={copy.clearSearch}
        />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-8"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {nothing ? (
          <Txt variant="body" tone="muted" className="pt-2" accessibilityRole="text">
            {copy.nothingFound}
          </Txt>
        ) : null}

        {companiesBody !== null && (!searching || companies.length > 0 || !shelf.shelf) ? (
          <Section title={copy.companies} note={searching ? null : copy.byVolume}>
            {companiesBody}
          </Section>
        ) : null}

        {/* Each row says «Not a share» itself; the issuer's terms are on the company's own page (M27). */}
        {privates.length > 0 ? (
          <Section title={copy.privateCompanies} aside={copy.forExperienced}>
            <Rows items={privates} shown={privates.length} onOpen={open} today={copy.today} />
          </Section>
        ) : null}

        {searching ? null : (
          <Section title={places.experienced}>
            <Card padded={false} className="mt-2">
              {MARKETS_TOOLS.map((tool, index) => (
                <DoorRow
                  key={tool}
                  icon={TOOL_ICONS[tool]}
                  label={places.tools[tool]}
                  line={places.toolLines[tool]}
                  onPress={() => {
                    Keyboard.dismiss()
                    router.push(MARKETS_TOOL_PATHS[tool] as never)
                  }}
                  last={index === MARKETS_TOOLS.length - 1}
                />
              ))}
            </Card>
          </Section>
        )}

        {dollars.length > 0 ? (
          <Section title={copy.dollars}>
            <Rows items={dollars} shown={dollars.length} onOpen={open} today={copy.today} />
          </Section>
        ) : null}

        {crypto.length > 0 ? (
          <Section title={copy.crypto} note={searching ? null : copy.byVolume}>
            <Rows items={crypto} shown={searching ? crypto.length : cryptoShown} onOpen={open} today={copy.today} />
            {!searching && crypto.length > cryptoShown ? (
              <Button
                title={copy.showMore}
                variant="secondary"
                onPress={() => setCryptoShown((count) => count + CRYPTO_SHOWN)}
                className="mt-2"
              />
            ) : null}
          </Section>
        ) : null}

        {coinsBody}
      </ScrollView>
    </View>
  )
}
