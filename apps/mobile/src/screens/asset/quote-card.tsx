import { useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, TextInput, View } from 'react-native'

import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { FactRow } from '@/components/fact-row'
import { Icon } from '@/components/icon'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { formatShareUnits, unitsFromRaw } from '@/features/invest/buy-model'
import { DETAILS_COPY } from '@/features/invest/details-copy'
import { farPctText, quoteFar, type LiveShareQuote } from '@/features/invest/pool-warning'
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
import { judgeReference, REFERENCE_STALE_AFTER_MS, referenceWord, unitsLine } from '@/lib/stocks'
import { useKeyboardLift } from '@/screens/launch/keyboard-lift'
import { type, useTheme } from '@/theme'
import { formatClock, formatPercent, formatPrice } from '@/utils/format'

type PresetKey = `${(typeof STOCK_QUOTE_PRESETS_USD)[number]}` | 'own'

/** Whole dollars in the language's shape: «$10,000» · «$10 000». */
function wholeDollars(usd: number, locale: Locale): string {
  return `$${usd.toLocaleString(locale === 'uk' ? 'uk-UA' : 'en-US')}`
}

/**
 * The typed amount to the cent, as typed — «25,5» is $25.50, never $26 (ST-5 r8) — or null when it is not an amount
 * inside the quotable range; a comma marks the fraction too. A sum past the range is refused, never quoted as another.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(',', '.').replace(/[^0-9.]/g, '')
  if (cleaned.length === 0) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  const cents = Math.round(value * 100) / 100
  if (cents < STOCK_QUOTE_MIN_USD || cents > STOCK_QUOTE_MAX_USD) return null
  return cents
}

/** A decimal the server wrote as text, as a number; null for anything else. */
function numberOf(text: string | null | undefined): number | null {
  if (typeof text !== 'string' || !/^\d+(\.\d+)?$/.test(text.trim())) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * The size-aware quote: what this amount actually executes at, through the
 * same path Trade will use, stated per underlying share against the
 * reference. Presets are examples; the Review in Trade quotes the real amount
 * again. The words and figures are in the person's language.
 */
export function QuoteCard({
  asset,
  now,
  onLive,
}: {
  asset: StockAsset
  now: number
  /** A Buy quote's price for one share, told to the page so its pool warning follows the freshest figure (ST-5 r8). */
  onLive?: (live: LiveShareQuote) => void
}) {
  const { colors } = useTheme()
  const locale = useLocale()
  const words = useCopy(DETAILS_COPY)
  const rep = asset.row.representation
  const [side, setSide] = useState<StockSide>('BUY')
  const [preset, setPreset] = useState<PresetKey>('1000')
  const [own, setOwn] = useState('')
  const [ownUsd, setOwnUsd] = useState<number | null>(null)
  // «Котирувати» on a sum outside the range: the range is said then, in amber — never under the keys while typing.
  const [ownRefused, setOwnRefused] = useState(false)
  const usd = preset === 'own' ? ownUsd : Number(preset)
  const quote = useStockQuote(rep.mint, side, usd)
  const refetch = quote.refetch
  const fetching = quote.isFetching
  // The same sum asked again is asked again (ST-5 r10: «Котирувати» on an unchanged $10 left a stale quote standing).
  const askAgain = () => {
    if (!fetching) void refetch()
  }
  // While «Своя сума» is typed, the field and its «Quote» stay above the keyboard (Android draws edge to edge, so the
  // window is never resized): the page's lift follows the row for as long as the field is focused.
  const lift = useKeyboardLift()
  const [typing, setTyping] = useState(false)
  const ownRow = useRef<View>(null)
  const follow = lift?.follow
  const relayout = lift?.relayout
  useEffect(() => {
    if (!typing || !follow) return
    follow({ top: ownRow, bottom: ownRow })
    return () => follow(null)
  }, [typing, follow])

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

  // A tap on the sum already chosen asks for it afresh; «Своя сума» asks from its own field.
  const pickPreset = (next: PresetKey) => {
    if (next === preset && next !== 'own') askAgain()
    setPreset(next)
  }

  const submitOwn = () => {
    const parsed = parseAmount(own)
    if (parsed !== null && parsed === ownUsd) askAgain()
    setOwnUsd(parsed)
    setOwnRefused(parsed === null)
    // The result stands where the keys were: the keyboard goes once the amount is asked for.
    Keyboard.dismiss()
  }

  const result = quote.data
  const referenceState = result
    ? judgeReference({
        perShare: result.reference.perShare,
        fetchedAt: result.reference.fetchedAt,
        exchangeOpen: asset.row.session.exchangeOpen,
        nowMs: now,
      })
    : null
  /* What a person receives is the token (ST-5 r10: «4,565736 NVDA отримаєш за $1 000» — the share count under the
     share's ticker): the tokens by the raw amount and the mint's decimals, the shares they stand for beside them. */
  const decimals = 'error' in asset.onchain ? null : asset.onchain.decimals
  const shareCount = result && result.multiplier !== null ? numberOf(result.tokenScaled) : null
  const tokenCount = result
    ? (unitsFromRaw(result.tokenRaw, decimals, null) ??
      (result.multiplier === null
        ? numberOf(result.tokenScaled)
        : shareCount !== null && result.multiplier > 0
          ? shareCount / result.multiplier
          : null))
    : null
  const fee = (result ? result.feeBasisPoints / 100 : 0).toFixed(2)
  // The quote ages by the reference's own rule: past five minutes it is marked stale, as the reference beside it is.
  const quotedMs = result ? Date.parse(result.observedAt) : Number.NaN
  const quoteStale = result !== undefined && (!Number.isFinite(quotedMs) || now - quotedMs > REFERENCE_STALE_AFTER_MS)
  /* A quote that went stale while the card is open is asked again by itself, once per answer (ST-5 r10): an answer
     that comes back as old stays marked, never asked in a loop. */
  const staleKey =
    quoteStale && result && !fetching && !quote.isError && !quote.isPlaceholderData
      ? `${side}:${usd ?? ''}:${result.observedAt}`
      : null
  const askedStale = useRef<string | null>(null)
  useEffect(() => {
    if (staleKey === null || askedStale.current === staleKey) return
    askedStale.current = staleKey
    void refetch()
  }, [staleKey, refetch])
  /* A price for the share far from the reference (ST-5 r7: SGOVx, «+4 689 447%» beside «Вплив на ціну +1,00%»): the
     distance is the figure that matters, said over the rows; the price impact — the pool's own move — is then no cost
     to read and is not shown. With no reference, no distance is claimed. */
  const far = result ? quoteFar(result.deviationPct, result.reference.perShare) : false
  // The page's pool warning follows this figure — a Buy's own price for a share, the quote's own answer, never a kept one.
  const livePerShare =
    result && side === 'BUY' && !quote.isPlaceholderData && !quote.isError ? result.executablePerShare : null
  const liveUsd = result?.usd ?? null
  // With its own time: the page judges its warning only by a figure for the sum about to be bought, and a fresh one (ST-5 r9).
  const liveAtMs = Number.isFinite(quotedMs) ? quotedMs : null
  useEffect(() => {
    if (onLive && livePerShare !== null && liveUsd !== null && liveAtMs !== null)
      // The quote card's engine: kept apart, it never judges the purchase's warning (ST-5 r10).
      onLive({ perShare: livePerShare, usd: liveUsd, at: liveAtMs, source: 'stock-quote' })
  }, [onLive, livePerShare, liveUsd, liveAtMs])

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="title" className="shrink">
          {words.quoteTitle}
        </Txt>
        <ChoiceChips choices={sides} value={side} onChange={setSide} size="sm" />
      </View>
      <ChoiceChips choices={presets} value={preset} onChange={pickPreset} size="sm" />
      {preset === 'own' ? (
        <View ref={ownRow} collapsable={false} onLayout={() => relayout?.()} className="flex-row items-center gap-2">
          <View className="h-11 flex-1 flex-row items-center gap-1 rounded-btn border border-line-strong bg-ground px-3">
            <Txt variant="data" tone="muted">
              $
            </Txt>
            <TextInput
              value={own}
              onChangeText={(text) => {
                setOwn(text)
                setOwnRefused(false)
              }}
              onSubmitEditing={submitOwn}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
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
        // The range only once a sum outside it was asked for — while the amount is typed nothing sits under the keys.
        ownRefused ? (
          <Txt variant="ui" tone="warning" accessibilityLiveRegion="polite">
            {words.quoteRange(wholeDollars(STOCK_QUOTE_MIN_USD, locale), wholeDollars(STOCK_QUOTE_MAX_USD, locale))}
          </Txt>
        ) : null
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
          {/* The app's own words, never the server's raw message (ST-5 r9). */}
          <Txt variant="ui" tone="faint">
            {isNetworkError(quote.error) ? words.quoteNeedsNetwork : words.quoteDownLine}
          </Txt>
        </View>
      ) : result ? (
        <View className="gap-1" style={{ opacity: quote.isFetching || quote.isPlaceholderData ? 0.6 : 1 }}>
          <View className="flex-row flex-wrap items-baseline gap-x-2">
            <Txt variant="dataLg" tabular>
              {tokenCount === null ? '—' : `≈ ${formatShareUnits(tokenCount, locale)}`}
            </Txt>
            <Txt variant="ui" tone="muted">
              {rep.symbol}
            </Txt>
            {shareCount !== null ? (
              <Txt variant="ui" tone="muted" tabular>
                {words.sharesBeside(formatShareUnits(shareCount, locale), shareCount)}
              </Txt>
            ) : null}
          </View>
          <Txt variant="ui" tone="faint">
            {side === 'BUY'
              ? words.receiveFor(formatPrice(result.usd, locale))
              : words.giveFor(formatPrice(result.usd, locale))}
          </Txt>
          {far && result.deviationPct !== null ? (
            <View accessibilityRole="alert" className="flex-row items-start gap-2 pt-1">
              <Icon name="warning-outline" size={16} color="warningInk" style={{ marginTop: 2 }} />
              <Txt variant="ui" tone="warning" className="flex-1">
                {words.quoteFar(farPctText(result.deviationPct, locale), result.deviationPct > 0)}
              </Txt>
            </View>
          ) : null}
          <View className="pt-1">
            <FactRow label={words.perShareRow} value={formatPrice(result.executablePerShare, locale)} />
            <FactRow
              label={words.executionVsShare}
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
            {far ? null : (
              <FactRow label={words.priceImpact} value={formatPercent(Number(result.priceImpactPct), locale)} />
            )}
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
            {quote.isError ? (
              <Chip label={words.quoteRefreshFailed} tone="warning" caps={false} />
            ) : quoteStale ? (
              <Chip label={words.stale} tone="warning" caps={false} />
            ) : null}
          </View>
        </View>
      ) : null}
    </Card>
  )
}
