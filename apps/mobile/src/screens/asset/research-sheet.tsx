import { Pressable, ToastAndroid, View } from 'react-native'

import { FactRow } from '@/components/fact-row'
import { HelpDot } from '@/components/help-dot'
import { Icon, type IconName } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { exchangeClock, exchangeShort, moneyShort, venueName } from '@/features/invest/company-facts'
import { DETAILS_COPY, isAssetCategory, type DetailsCopy } from '@/features/invest/details-copy'
import type { MarketDetail, StockAsset } from '@/lib/api'
import { canCopy, copyText } from '@/lib/clipboard'
import { feel } from '@/lib/haptics'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { issuerLabel, referenceWord, sessionWord, unitsLine } from '@/lib/stocks'
import { openLink } from '@/lib/open-link'
import {
  DASH,
  formatAmount,
  formatClock,
  formatCount,
  formatDay,
  formatPercent,
  formatPrice,
  formatShare,
  shortAddress,
} from '@/utils/format'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-0.5 pt-3">
      <Txt variant="labelSm" tone="faint" caps className="pb-1">
        {title}
      </Txt>
      {children}
    </View>
  )
}

function authorityWord(disabled: boolean | null, on: string, words: DetailsCopy): string {
  return disabled === null ? '—' : disabled ? words.authorityOff : on
}

/**
 * Whether new tokens can be minted, or the token frozen, in plain words: «Вимкнено» where the chain records no one,
 * «Можливий» where it records an address — the address itself behind «?», never a bare address on the row (ST-5 r6).
 */
function AuthorityValue({ on, help, title }: { on: string; help: string; title: string }) {
  return (
    <View className="-my-1 flex-row items-center gap-1">
      <Txt variant="ui" selectable>
        {on}
      </Txt>
      <HelpDot title={title} body={help} size={16} />
    </View>
  )
}

/** A raw supply through the mint's decimals, whole units. */
function supplyOf(raw: string, decimals: number, locale: Locale): string {
  const value = Number(raw) / 10 ** decimals
  return Number.isFinite(value) ? formatAmount(value, 0, locale) : '—'
}

function LinkRow({ icon, label, url, a11y }: { icon: IconName; label: string; url: string; a11y: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={a11y}
      onPress={() => openLink(url)}
      className="flex-row items-center gap-3 border-b border-line py-2.5 active:bg-hover"
    >
      <Icon name={icon} size={18} />
      <Txt variant="ui" className="flex-1">
        {label}
      </Txt>
      <Txt variant="labelSm" tone="faint" numberOfLines={1} className="max-w-[55%]">
        {url.replace(/^https?:\/\//, '')}
      </Txt>
      <Icon name="open-outline" size={16} color="fgMuted" />
    </Pressable>
  )
}

export type ResearchSheetProps = {
  visible: boolean
  onClose: () => void
  market: MarketDetail
  observedAt: string
  stock: StockAsset | null
  /** The pool's own price stands far from the share (ST-5 r8): the cap and the FDV built on it are dashes. */
  poolPriceFar?: boolean
}

/**
 * The facts behind the figures — the venue's audit and stats, the issuer's
 * catalogue and reserves for a stock, the mint as the chain states it, the
 * pool, the links — one tap deep, each with its time and its source. Nothing
 * here is an opinion; the evidence card from the analytics line joins later.
 * The words and figures are in the person's language; the venue, the issuer
 * and the chain keep their names.
 */
export function ResearchSheet({
  visible,
  onClose,
  market,
  observedAt,
  stock,
  poolPriceFar = false,
}: ResearchSheetProps) {
  const locale = useLocale()
  const words = useCopy(DETAILS_COPY)
  const row = stock?.row ?? null
  const rep = row?.representation ?? null
  const onchain = stock && !('error' in stock.onchain) ? stock.onchain : null
  const multiplier = stock ? (stock.chainMultiplier ?? row?.multiplier ?? null) : null
  const links = [
    market.links.website ? { icon: 'globe-outline' as const, label: words.website, url: market.links.website } : null,
    market.links.twitter ? { icon: 'logo-twitter' as const, label: 'X', url: market.links.twitter } : null,
    market.links.telegram
      ? { icon: 'paper-plane-outline' as const, label: 'Telegram', url: market.links.telegram }
      : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null)
  const category = market.category
  const categoryWord = isAssetCategory(category) ? words.researchCategories[category] : (category ?? '—')

  return (
    <Sheet
      visible={visible}
      title={words.researchTitle}
      subtitle={`${market.symbol} · ${words.asOf(formatClock(observedAt))}`}
      onClose={onClose}
      scroll
    >
      <Section title={words.sectionMarket}>
        <FactRow label={words.category} value={categoryWord} mono={false} />
        <FactRow
          label={words.verifiedByVenue}
          value={market.verified ? words.yes : words.no}
          mono={false}
          tone={market.verified ? 'fg' : 'warning'}
        />
        <FactRow
          label={words.organicScore}
          value={market.organicScore === null ? '—' : `${Math.round(market.organicScore)}`}
          detail={market.organicScoreLabel ? `${words.organicLabel(market.organicScoreLabel)} · Jupiter` : 'Jupiter'}
        />
        <FactRow label={words.holders} value={formatCount(market.holders, locale)} detail={formatClock(observedAt)} />
        <FactRow
          label={words.topHolders}
          value={formatShare(market.audit.topHoldersPct, locale)}
          detail={words.shareOfSupply}
        />
        {onchain ? null : (
          <FactRow
            label={words.mintAuthority}
            value={authorityWord(market.audit.mintAuthorityDisabled, words.mintOn, words)}
            mono={false}
          />
        )}
        {onchain ? null : (
          <FactRow
            label={words.freezeAuthority}
            value={authorityWord(market.audit.freezeAuthorityDisabled, words.freezeOn, words)}
            mono={false}
          />
        )}
        <FactRow label={words.firstPool} value={formatDay(market.firstPoolAt, undefined, locale)} />
        <FactRow label={words.change1h} value={formatPercent(market.change1hPct, locale)} />
        <FactRow
          label={words.trades24h}
          value={words.buysSells(
            formatCount(market.stats.h24.buys, locale),
            formatCount(market.stats.h24.sells, locale),
          )}
          detail={
            market.stats.h24.traders === null ? null : words.traders(formatCount(market.stats.h24.traders, locale))
          }
        />
        <FactRow
          // A stock token's cap is the token's value on the chain, never the company's (ST-5 r7).
          label={stock !== null || market.category === 'stock' ? words.tokenMarketCap : words.marketCap}
          value={poolPriceFar ? DASH : (moneyShort(market.marketCapUsd, locale) ?? DASH)}
          detail={words.fullyDiluted(poolPriceFar ? DASH : (moneyShort(market.fdvUsd, locale) ?? DASH))}
          last
        />
      </Section>

      {row && rep ? (
        <Section title={words.sectionIssuer}>
          <FactRow label={words.issuer} value={issuerLabel(rep.issuer.id, 'full')} mono={false} />
          <FactRow
            label={words.underlying}
            value={rep.underlying.name ? `${rep.underlying.name} · ${rep.underlying.symbol}` : rep.underlying.symbol}
            mono={false}
          />
          <FactRow label="ISIN" value={rep.underlying.isin ?? '—'} />
          {/* The exchange by its short name and its clock in words — never its MIC or its time-zone ID (ST-5 r6). */}
          <FactRow
            label={words.exchange}
            value={exchangeShort(rep.exchange) ?? '—'}
            detail={exchangeClock(rep.exchange?.timezone, locale)}
            mono={false}
          />
          <FactRow
            label={words.confirmedBy}
            value={rep.issuerConfirmation === 'issuer-catalogue' ? words.issuerCatalogue : words.venueTagOnly}
            mono={false}
            tone={rep.issuerConfirmation === 'issuer-catalogue' ? 'fg' : 'warning'}
          />
          <FactRow
            label={words.reference}
            value={formatPrice(row.reference.perShare, locale)}
            detail={
              row.reference.perShare === null
                ? words.noIssuerReference
                : `${row.reference.source.label} · ${referenceWord(row.reference.state, locale).toLowerCase()} · ${formatClock(row.reference.fetchedAt)}`
            }
          />
          <FactRow
            label={words.session}
            value={sessionWord(row.session.period, locale)}
            detail={row.session.nextChangeAt ? words.nextChange(formatClock(row.session.nextChangeAt)) : null}
            mono={false}
          />
          <FactRow
            label={words.units}
            value={unitsLine(rep.symbol, rep.underlying.symbol, multiplier?.current ?? null, locale) ?? '—'}
            detail={
              stock?.multiplierAgreement === 'agree'
                ? words.chainIssuerAgree
                : stock?.multiplierAgreement === 'differ'
                  ? words.chainIssuerDiffer
                  : words.fromChain
            }
          />
          {/* The issuer's tokens in circulation stand under the reserves; what they, the chain's supply and the backing
              each count is the same «?» as the supply's — beside this figure too, since the two need not agree (ST-5 r9). */}
          <FactRow
            label={words.reserves}
            value={stock?.reserves ? words.sharesHeld(formatAmount(Number(stock.reserves.sharesHeld), 2, locale)) : '—'}
            right={
              stock?.reserves ? (
                <View className="-my-1 flex-row items-center gap-1">
                  <Txt variant="data" selectable>
                    {words.sharesHeld(formatAmount(Number(stock.reserves.sharesHeld), 2, locale))}
                  </Txt>
                  <HelpDot
                    title={words.supplyHelpTitle}
                    body={[words.supplyHelp, words.reservesHelp]}
                    size={16}
                  />
                </View>
              ) : undefined
            }
            detail={
              stock?.reserves
                ? words.reservesDetail(
                    formatAmount(Number(stock.reserves.circulatingSupply), 2, locale),
                    stock.reserves.custodians.join(', '),
                    formatClock(stock.reserves.observedAt),
                  )
                : words.notAttested
            }
            last
          />
        </Section>
      ) : null}

      <Section title={words.sectionOnchain}>
        {/* The address once, short, with its copy beside it; the program and the decimals are the chain's plumbing,
            not a fact a person reads (ST-5 r4). */}
        <FactRow
          label={words.tokenAddress}
          value={shortAddress(market.mint, 6)}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${words.copyAddress}: ${market.mint}`}
              disabled={!canCopy}
              onPress={() => {
                if (!copyText(market.mint)) return
                feel('review')
                ToastAndroid.show(words.copied, ToastAndroid.SHORT)
              }}
              hitSlop={6}
              className="-my-1 min-h-8 flex-row items-center gap-1.5 rounded-btn px-1 active:bg-hover"
            >
              <Txt variant="data" tabular>
                {shortAddress(market.mint, 6)}
              </Txt>
              {canCopy ? <Icon name="copy-outline" size={16} color="muted" /> : null}
            </Pressable>
          }
        />
        {/* The supply with its time (the chain's slot is plumbing); what it, the reserves and the backing each count
            behind «?», since the chain's supply and the issuer's circulation need not agree (ST-5 r6). */}
        {onchain ? (
          <FactRow
            label={words.supply}
            value={supplyOf(onchain.supplyRaw, onchain.decimals, locale)}
            detail={formatClock(onchain.observedAt)}
            right={
              <View className="-my-1 flex-row items-center gap-1">
                <Txt variant="data" selectable>
                  {supplyOf(onchain.supplyRaw, onchain.decimals, locale)}
                </Txt>
                <HelpDot
                  title={words.supplyHelpTitle}
                  body={stock?.reserves ? [words.supplyHelp, words.reservesHelp] : words.supplyHelp}
                  size={16}
                />
              </View>
            }
          />
        ) : null}
        {onchain ? (
          <FactRow
            label={words.mintAuthority}
            value={onchain.mintAuthority ? words.mintOn : words.authorityOff}
            mono={false}
            right={
              onchain.mintAuthority ? (
                <AuthorityValue
                  on={words.mintOn}
                  title={words.mintAuthority}
                  help={words.mintBy(onchain.mintAuthority)}
                />
              ) : undefined
            }
          />
        ) : null}
        {onchain ? (
          <FactRow
            label={words.freezeAuthority}
            value={onchain.freezeAuthority ? words.freezeOn : words.authorityOff}
            mono={false}
            right={
              onchain.freezeAuthority ? (
                <AuthorityValue
                  on={words.freezeOn}
                  title={words.freezeAuthority}
                  help={words.freezeBy(onchain.freezeAuthority)}
                />
              ) : undefined
            }
          />
        ) : null}
        {/* The pool by its venue's name and what it holds — never the venue's slug or the pool's address (ST-5 r6). */}
        <FactRow
          label={words.pool}
          value={stock?.pool ? stock.pool.name : '—'}
          detail={
            stock?.pool
              ? [
                  venueName(stock.pool.dex),
                  stock.pool.reserveUsd !== null ? words.inPool(moneyShort(stock.pool.reserveUsd, locale) ?? DASH) : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || null
              : null
          }
          mono={false}
          last
        />
      </Section>

      {links.length > 0 ? (
        <Section title={words.sectionLinks}>
          {links.map((link) => (
            <LinkRow
              key={link.url}
              icon={link.icon}
              label={link.label}
              url={link.url}
              a11y={words.opensInBrowser(link.label)}
            />
          ))}
        </Section>
      ) : null}

      <Txt variant="labelSm" tone="faint" className="pt-4">
        {words.sources(rep ? issuerLabel(rep.issuer.id, 'full') : null)}
      </Txt>
    </Sheet>
  )
}
