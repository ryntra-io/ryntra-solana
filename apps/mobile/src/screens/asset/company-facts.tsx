import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { COMPANY_COPY, type CompanyCopy } from '@/features/invest/company-copy'
import {
  aboutFacts,
  chartDay,
  issuerFeeText,
  privateStats,
  tradingDay,
  truthTopicOf,
  whatYouBuyFacts,
  yearPoints,
  yearRange,
  yearStartsLate,
  type CompanyFact,
  type CompanyHead,
  type CompanyStat,
} from '@/features/invest/company-facts'
import { truthTopicText, type TruthTopic } from '@/features/invest/truth-topics'
import { useCandles } from '@/hooks/use-market'
import { useNow } from '@/hooks/use-now'
import type { MarketDetail, StockAsset } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { formatMoment, formatPrice } from '@/utils/format'

/**
 * A company's facts at rest — the web's company page
 * under the purchase, each block a set of figures
 * with its label and, under the block, where they come from and when:
 * «Ключові показники» (a private company's valuation, the price over the
 * year), «Про компанію» (a private company's standing, where the share lists),
 * «Що ти купуєш» (the issuer's label and line — its whole text one tap deeper —
 * the issuer, the backing, the dividends, the issuer's fee) and «Торги на
 * Solana · 24 год» (the token's day). A figure no source states is not drawn;
 * a block with nothing to say is not drawn at all. The company's SEC figures,
 * its industry and what it does are the web's own files, asked of line A
 * (request 37) — nothing stands in for them.
 */
export function CompanyFacts({
  mint,
  market,
  observedAt,
  stale,
  asset,
  head,
  name,
}: {
  mint: string
  market: MarketDetail
  /** When the venue's read of the token was observed. */
  observedAt: string | null
  /** The venue's read on screen is an earlier one. */
  stale: boolean
  asset: StockAsset
  head: CompanyHead
  name: string
}) {
  const words = useCopy(COMPANY_COPY)
  const locale = useLocale()
  // A market read kept from another day names its day.
  const now = useNow(60_000)
  const { row } = asset
  const rep = row.representation
  const preIpo = rep.instrument?.class === 'pre-ipo'
  const stats = preIpo && row.issuerMark ? privateStats(row.issuerMark, rep.issuer.label, words, locale) : []
  const about = aboutFacts(head, words)
  const feeBps = row.transferFee?.basisPoints ?? null
  const bought = whatYouBuyFacts(
    {
      issuer: rep.issuer.id,
      issuerLabel: rep.issuer.label,
      reserves: asset.reserves,
      multiplier: asset.chainMultiplier?.current ?? row.multiplier?.current ?? null,
      feeBps,
      chainRead: !('error' in asset.onchain),
    },
    words,
    locale,
  )
  const topicId = truthTopicOf(rep.issuer.id)
  const topic = topicId ? truthTopicText(topicId, locale, issuerFeeText(feeBps, locale)) : null
  const day = tradingDay(market, words, locale)
  return (
    <View className="gap-4">
      <KeyStats mint={mint} price={market.price} stats={stats} words={words} locale={locale} />
      {about.length > 0 ? (
        <Block title={words.aboutCompany}>
          <Facts items={about} />
        </Block>
      ) : null}
      <Block title={words.whatYouBuy}>
        {topic ? <TruthRow topic={topic} company={name} words={words} /> : null}
        <Facts items={bought} ruled={topic !== null} />
      </Block>
      <Block
        title={words.tradingOnSolana}
        source={
          day.stats.length > 0 || day.pressure
            ? [words.marketSource(formatMoment(observedAt, now, locale)), stale ? words.notUpdated : null]
                .filter(Boolean)
                .join(' · ')
            : null
        }
      >
        {day.stats.length === 0 && !day.pressure ? (
          <Txt variant="ui" tone="muted">
            {words.tradingUnread}
          </Txt>
        ) : (
          <>
            {day.stats.length > 0 ? <Stats items={day.stats} /> : null}
            {day.pressure ? <Pressure pressure={day.pressure} words={words} /> : null}
            {day.since ? (
              <Txt variant="ui" tone="faint" tabular>
                {day.since}
              </Txt>
            ) : null}
          </>
        )}
      </Block>
    </View>
  )
}

/** A block: its title, its figures, and where they come from and when — once, under it. */
function Block({ title, source = null, children }: { title: string; source?: string | null; children: ReactNode }) {
  return (
    <Card className="gap-4">
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      {children}
      {source ? (
        <Txt variant="labelSm" tone="faint">
          {source}
        </Txt>
      ) : null}
    </Card>
  )
}

/** Figures two to a row: the label, the figure, a word that qualifies it. */
function Stats({ items }: { items: readonly CompanyStat[] }) {
  const rows: CompanyStat[][] = []
  for (let index = 0; index < items.length; index += 2) rows.push(items.slice(index, index + 2))
  return (
    <View className="gap-4">
      {rows.map((pair) => (
        <View key={pair.map((item) => item.key).join('-')} className="flex-row gap-4">
          {pair.map((item) => (
            <View key={item.key} className="flex-1 gap-0.5">
              <Txt variant="ui" tone="faint">
                {item.label}
              </Txt>
              <Txt variant="title" tabular>
                {item.value}
              </Txt>
              {item.hint ? (
                <Txt variant="labelSm" tone="faint">
                  {item.hint}
                </Txt>
              ) : null}
            </View>
          ))}
          {pair.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  )
}

/** Facts as label over value — a long name wraps under its own label, never beside another. */
function Facts({ items, ruled = false }: { items: readonly CompanyFact[]; ruled?: boolean }) {
  return (
    <View className={ruled ? 'gap-4 border-t border-line pt-4' : 'gap-4'}>
      {items.map((item) => (
        <View key={item.key} className="gap-0.5">
          <Txt variant="ui" tone="faint">
            {item.label}
          </Txt>
          <Txt variant="ui">{item.value}</Txt>
          {item.note ? (
            <Txt variant="labelSm" tone="faint">
              {item.note}
            </Txt>
          ) : null}
        </View>
      ))}
    </View>
  )
}

/** «Ключові показники»: a private company's valuation, then the price over the year. Drawn only with something to say. */
function KeyStats({
  mint,
  price,
  stats,
  words,
  locale,
}: {
  mint: string
  price: number | null
  stats: readonly CompanyStat[]
  words: CompanyCopy
  locale: Locale
}) {
  const now = useNow(60_000)
  const candles = useCandles(mint, '1d')
  const range = useMemo(
    () => (candles.data ? yearRange(yearPoints(candles.data.candles, price, now), price, now) : null),
    [candles.data, price, now],
  )
  if (stats.length === 0 && !range && !candles.isPending) return null
  return (
    <Block title={words.keyStats}>
      {stats.length > 0 ? <Stats items={stats} /> : null}
      {range ? (
        <View className="gap-2">
          <View className="flex-row items-baseline justify-between gap-3">
            <Txt variant="ui" tone="faint">
              {words.yearRange}
            </Txt>
            {yearStartsLate(range, now) ? (
              <Txt variant="ui" tone="faint" tabular>
                {words.since(chartDay(range.since, locale))}
              </Txt>
            ) : null}
          </View>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={words.yearRangeA11y(formatPrice(range.low, locale), formatPrice(range.high, locale))}
            className="my-1 h-1.5 rounded-pill bg-track"
          >
            {range.position === null ? null : (
              <>
                <View
                  className="absolute bottom-0 left-0 top-0 rounded-pill bg-muted"
                  style={{ width: `${range.position * 100}%`, opacity: 0.55 }}
                />
                <View
                  className="absolute h-4 w-4 rounded-pill border-surface bg-fg"
                  style={{ left: `${range.position * 100}%`, top: -5, marginLeft: -8, borderWidth: 3 }}
                />
              </>
            )}
          </View>
          <View className="flex-row justify-between gap-4">
            <View className="gap-0.5">
              <Txt variant="ui" tabular>
                {formatPrice(range.low, locale)}
              </Txt>
              <Txt variant="labelSm" tone="faint">
                {`${words.yearLow} · ${chartDay(range.lowAt, locale)}`}
              </Txt>
            </View>
            <View className="items-end gap-0.5">
              <Txt variant="ui" tabular>
                {formatPrice(range.high, locale)}
              </Txt>
              <Txt variant="labelSm" tone="faint">
                {`${words.yearHigh} · ${chartDay(range.highAt, locale)}`}
              </Txt>
            </View>
          </View>
        </View>
      ) : candles.isPending ? (
        <Skeleton className="h-14 w-full rounded-sm" />
      ) : null}
    </Block>
  )
}

/** The issuer's label as a chip — its whole text one tap deeper — and its one line under it. */
function TruthRow({ topic, company, words }: { topic: TruthTopic; company: string; words: CompanyCopy }) {
  const [open, setOpen] = useState(false)
  return (
    <View className="items-start gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${topic.title} · ${words.whatIsThis}`}
        onPress={() => setOpen(true)}
        className="min-h-8 flex-row items-center gap-1.5 rounded-pill border border-line-strong bg-elevated pl-3 pr-2 active:bg-hover"
      >
        <Txt variant="ui">{topic.title}</Txt>
        <Icon name="help-circle-outline" size={16} color="muted" />
      </Pressable>
      <Txt variant="ui" tone="muted">
        {topic.short}
      </Txt>
      <TruthSheet visible={open} topic={topic} company={company} words={words} onClose={() => setOpen(false)} />
    </View>
  )
}

/** What the label means, in full: what it is, a simple example and the one limitation (the web's `?`). */
function TruthSheet({
  visible,
  topic,
  company,
  words,
  onClose,
}: {
  visible: boolean
  topic: TruthTopic
  company: string
  words: CompanyCopy
  onClose: () => void
}) {
  return (
    <Sheet visible={visible} title={topic.title} subtitle={company} onClose={onClose} scroll>
      <View className="gap-4 pb-2">
        <Txt variant="body">{topic.what}</Txt>
        <View className="gap-1">
          <Txt variant="label" tone="faint" caps>
            {words.example}
          </Txt>
          {topic.example.map((line) => (
            <Txt key={line} variant="body">
              {line}
            </Txt>
          ))}
        </View>
        <View className="gap-1">
          <Txt variant="label" tone="warning" caps>
            {words.important}
          </Txt>
          <Txt variant="body">{topic.important}</Txt>
        </View>
      </View>
    </Sheet>
  )
}

/** Buying against selling by the day's trades: two figures and one bar, never a verdict. */
function Pressure({
  pressure,
  words,
}: {
  pressure: Readonly<{ buys: string; sells: string; buyPct: number }>
  words: CompanyCopy
}) {
  return (
    <View className="gap-2 border-t border-line pt-4">
      <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <View className="flex-row gap-3">
          <Txt variant="ui" tone="success" tabular>
            {words.buys(pressure.buys)}
          </Txt>
          <Txt variant="ui" tone="danger" tabular>
            {words.sells(pressure.sells)}
          </Txt>
        </View>
        <Txt variant="labelSm" tone="faint">
          {words.byTrades}
        </Txt>
      </View>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={words.pressureA11y(pressure.buys, pressure.sells)}
        className="h-2 flex-row overflow-hidden rounded-pill"
      >
        <View className="bg-success" style={{ width: `${pressure.buyPct}%` }} />
        <View className="w-0.5 bg-surface" />
        <View className="flex-1 bg-danger" style={{ opacity: 0.7 }} />
      </View>
    </View>
  )
}
