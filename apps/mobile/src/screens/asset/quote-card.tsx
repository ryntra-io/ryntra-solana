import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { FactRow } from '@/components/fact-row'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { DETAILS_COPY } from '@/features/invest/details-copy'
import { useStockQuote } from '@/hooks/use-market'
import {
  isNetworkError,
  STOCK_QUOTE_MAX_USD,
  STOCK_QUOTE_MIN_USD,
  STOCK_QUOTE_PRESETS_USD,
  type StockAsset,
  type StockSide,
} from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { judgeReference, referenceWord, unitsLine } from '@/lib/stocks'
import { type, useTheme } from '@/theme'
import { formatClock, formatPercent, formatPrice } from '@/utils/format'

type PresetKey = `${(typeof STOCK_QUOTE_PRESETS_USD)[number]}` | 'own'

/** Whole dollars in the language's shape: «$10,000» · «$10 000». */
function wholeDollars(usd: number, locale: Locale): string {
  return `$${usd.toLocaleString(locale === 'uk' ? 'uk-UA' : 'en-US')}`
}

/** The typed amount as whole dollars inside the quotable range, or null when it is not an amount yet; a comma marks the fraction too. */
export function parseAmount(text: string): number | null {
  const value = Number(text.replace(',', '.').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(value) || value < STOCK_QUOTE_MIN_USD) return null
  return Math.min(Math.round(value), STOCK_QUOTE_MAX_USD)
}

/**
 * The size-aware quote: what this amount actually executes at, through the
 * same path Trade will use, stated per underlying share against the
 * reference. Presets are examples; the Review in Trade quotes the real amount
 * again. The words and figures are in the person's language.
 */
export function QuoteCard({ asset, now }: { asset: StockAsset; now: number }) {
  const { colors } = useTheme()
  const locale = useLocale()
  const words = useCopy(DETAILS_COPY)
  const rep = asset.row.representation
  const [side, setSide] = useState<StockSide>('BUY')
  const [preset, setPreset] = useState<PresetKey>('1000')
  const [own, setOwn] = useState('')
  const [ownUsd, setOwnUsd] = useState<number | null>(null)
  const usd = preset === 'own' ? ownUsd : Number(preset)
  const quote = useStockQuote(rep.mint, side, usd)

  const sides: readonly Choice<StockSide>[] = [
    { value: 'BUY', label: words.buy },
    { value: 'SELL', label: words.sell },
  ]
  const presets: readonly Choice<PresetKey>[] = [
    ...STOCK_QUOTE_PRESETS_USD.map((amount) => ({
      value: `${amount}` as PresetKey,
      label: wholeDollars(amount, locale),
    })),
    { value: 'own', label: words.ownAmount },
  ]

  const submitOwn = () => setOwnUsd(parseAmount(own))

  const result = quote.data
  const referenceState = result
    ? judgeReference({
        perShare: result.reference.perShare,
        fetchedAt: result.reference.fetchedAt,
        exchangeOpen: asset.row.session.exchangeOpen,
        nowMs: now,
      })
    : null
  const unitsWord = result && result.multiplier !== null ? rep.underlying.symbol : rep.symbol
  const fee = (result ? result.feeBasisPoints / 100 : 0).toFixed(2)

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="title" className="shrink">
          {words.quoteTitle}
        </Txt>
        <ChoiceChips choices={sides} value={side} onChange={setSide} size="sm" />
      </View>
      <ChoiceChips choices={presets} value={preset} onChange={setPreset} size="sm" />
      {preset === 'own' ? (
        <View className="flex-row items-center gap-2">
          <View className="h-11 flex-1 flex-row items-center gap-1 rounded-btn border border-line-strong bg-ground px-3">
            <Txt variant="data" tone="muted">
              $
            </Txt>
            <TextInput
              value={own}
              onChangeText={setOwn}
              onSubmitEditing={submitOwn}
              keyboardType="decimal-pad"
              returnKeyType="done"
              placeholder={words.yourAmount}
              placeholderTextColor={colors.fgMuted}
              selectionColor={colors.brand}
              cursorColor={colors.brand}
              accessibilityLabel={words.yourAmountA11y}
              className="flex-1 text-fg"
              style={[type.data, { paddingVertical: 0 }]}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.quoteThis}
            onPress={submitOwn}
            className="h-11 items-center justify-center rounded-btn bg-brand px-4 active:bg-brand-pressed"
          >
            <Txt variant="ui" tone="onBrand">
              {words.quote}
            </Txt>
          </Pressable>
        </View>
      ) : null}

      {usd === null ? (
        <Txt variant="ui" tone="faint">
          {words.quoteRange(wholeDollars(STOCK_QUOTE_MIN_USD, locale), wholeDollars(STOCK_QUOTE_MAX_USD, locale))}
        </Txt>
      ) : quote.isPending ? (
        <View className="gap-2" accessibilityRole="progressbar" accessibilityLabel={words.asking}>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3.5 w-52" />
        </View>
      ) : quote.isError && !result ? (
        <View className="gap-1">
          <Txt variant="ui" tone="danger">
            {words.quoteDown}
          </Txt>
          <Txt variant="ui" tone="faint">
            {isNetworkError(quote.error)
              ? words.quoteNeedsNetwork
              : locale === 'en'
                ? quote.error.message
                : words.quoteDownLine}
          </Txt>
        </View>
      ) : result ? (
        <View className="gap-1" style={{ opacity: quote.isFetching || quote.isPlaceholderData ? 0.6 : 1 }}>
          <View className="flex-row items-baseline gap-2">
            <Txt variant="dataLg">{locale === 'uk' ? result.tokenScaled.replace('.', ',') : result.tokenScaled}</Txt>
            <Txt variant="ui" tone="muted">
              {unitsWord}
            </Txt>
          </View>
          <Txt variant="ui" tone="faint">
            {side === 'BUY'
              ? words.receiveFor(formatPrice(result.usd, locale))
              : words.giveFor(formatPrice(result.usd, locale))}
          </Txt>
          <View className="pt-1">
            <FactRow label={words.perShareRow} value={formatPrice(result.executablePerShare, locale)} />
            <FactRow
              label={words.deviation}
              value={formatPercent(result.deviationPct, locale)}
              tone={
                result.deviationPct === null || Math.abs(result.deviationPct) < 0.5
                  ? 'fg'
                  : Math.abs(result.deviationPct) < 2
                    ? 'warning'
                    : 'danger'
              }
              detail={
                result.reference.perShare !== null && referenceState
                  ? words.referenceDetail(
                      formatPrice(result.reference.perShare, locale),
                      referenceWord(referenceState, locale).toLowerCase(),
                    )
                  : words.noReference
              }
            />
            <FactRow label={words.priceImpact} value={formatPercent(Number(result.priceImpactPct), locale)} />
            <FactRow
              label={words.feeInQuote}
              value={`${locale === 'uk' ? fee.replace('.', ',') : fee}%`}
              detail={result.source.label}
            />
            <FactRow
              label={words.units}
              value={unitsLine(rep.symbol, rep.underlying.symbol, result.multiplier, locale) ?? '—'}
              last
            />
          </View>
          <View className="flex-row flex-wrap items-center gap-2 pt-1">
            <Txt variant="labelSm" tone="faint">
              {words.quotedAt(formatClock(result.observedAt), result.source.label)}
            </Txt>
            {quote.isError ? <Chip label={words.quoteRefreshFailed} tone="warning" caps={false} /> : null}
          </View>
        </View>
      ) : null}
      <Txt variant="labelSm" tone="faint">
        {words.examples}
      </Txt>
    </Card>
  )
}
