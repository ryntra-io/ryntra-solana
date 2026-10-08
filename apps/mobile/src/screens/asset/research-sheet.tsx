import { Pressable, View } from 'react-native'

import { FactRow } from '@/components/fact-row'
import { Icon, type IconName } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { DETAILS_COPY, isAssetCategory, type DetailsCopy } from '@/features/invest/details-copy'
import type { MarketDetail, StockAsset } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { issuerLabel, referenceWord, sessionWord, unitsLine } from '@/lib/stocks'
import { openLink } from '@/lib/open-link'
import {
  formatAmount,
  formatClock,
  formatCount,
  formatDay,
  formatPercent,
  formatPrice,
  formatShare,
  formatUsdCompact,
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

function authorityWord(disabled: boolean | null, words: DetailsCopy): string {
  return disabled === null ? '—' : disabled ? words.authorityOff : words.authorityOn
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
}

/**
 * The facts behind the figures — the venue's audit and stats, the issuer's
 * catalogue and reserves for a stock, the mint as the chain states it, the
 * pool, the links — one tap deep, each with its time and its source. Nothing
 * here is an opinion; the evidence card from the analytics line joins later.
 * The words and figures are in the person's language; the venue, the issuer
 * and the chain keep their names.
 */
export function ResearchSheet({ visible, onClose, market, observedAt, stock }: ResearchSheetProps) {
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
      title={words.researchTitle(market.symbol)}
      subtitle={words.asOf(formatClock(observedAt))}
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
            value={authorityWord(market.audit.mintAuthorityDisabled, words)}
            mono={false}
          />
        )}
        {onchain ? null : (
          <FactRow
            label={words.freezeAuthority}
            value={authorityWord(market.audit.freezeAuthorityDisabled, words)}
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
          label={words.marketCap}
          value={formatUsdCompact(market.marketCapUsd, locale)}
          detail={words.fullyDiluted(formatUsdCompact(market.fdvUsd, locale))}
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
          <FactRow
            label={words.exchange}
            value={rep.exchange ? rep.exchange.name : '—'}
            detail={rep.exchange ? `${rep.exchange.mic} · ${rep.exchange.timezone}` : null}
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
          <FactRow
            label={words.reserves}
            value={stock?.reserves ? words.sharesHeld(formatAmount(Number(stock.reserves.sharesHeld), 2, locale)) : '—'}
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
        <FactRow label={words.tokenAddress} value={shortAddress(market.mint, 6)} detail={market.mint} />
        <FactRow
          label={words.program}
          value={
            onchain
              ? onchain.programKind.replace('_', ' ')
              : market.tokenProgram
                ? shortAddress(market.tokenProgram, 6)
                : '—'
          }
          mono={onchain === null}
        />
        <FactRow label={words.decimals} value={market.decimals === null ? '—' : `${market.decimals}`} />
        {onchain ? (
          <FactRow
            label={words.supply}
            value={supplyOf(onchain.supplyRaw, onchain.decimals, locale)}
            detail={words.slot(onchain.slot === null ? '—' : `${onchain.slot}`, formatClock(onchain.observedAt))}
          />
        ) : null}
        {onchain ? (
          <FactRow
            label={words.mintAuthority}
            value={onchain.mintAuthority ? shortAddress(onchain.mintAuthority, 6) : words.none}
          />
        ) : null}
        {onchain ? (
          <FactRow
            label={words.freezeAuthority}
            value={onchain.freezeAuthority ? shortAddress(onchain.freezeAuthority, 6) : words.none}
          />
        ) : null}
        <FactRow
          label={words.pool}
          value={stock?.pool ? stock.pool.name : '—'}
          detail={
            stock?.pool
              ? `${stock.pool.dex ?? '—'} · ${formatUsdCompact(stock.pool.reserveUsd, locale)} · ${shortAddress(stock.pool.address, 6)}`
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
