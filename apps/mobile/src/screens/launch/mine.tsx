import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, RefreshControl, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { launchWords, type LaunchWord } from '@/features/launch/copy'
import { claimApi } from '@/features/launch/launch-api'
import { claimFees, type FlowStep, type LaunchFailure } from '@/features/launch/launch-flow'
import {
  exactPair,
  explorerUrl,
  formatBps,
  formatDate,
  formatRaw,
  shortKey,
  shortPair,
} from '@/features/launch/launch-format'
import {
  agoText,
  canClaim,
  claimFailureKey,
  claimFailureTitleKey,
  claimView,
  isPaused,
  noClaimKey,
  presetName,
  sourceRows,
  toClaimByPair,
  unclaimedOf,
} from '@/features/launch/launch-model'
import {
  knownState,
  pairMoney,
  rowDepth,
  rowHoldersView,
  rowTradeStatus,
  sinceText,
} from '@/features/launch/market-view'
import {
  useCreatorCabinet,
  useLaunchMarketCard,
  useLaunchMarkets,
  useLaunchOpen,
  useLaunchPresets,
  usePageLive,
} from '@/features/launch/use-launch'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { docFromClaim, docFromClaimResult } from '@/features/receipts/receipt-doc'
import { useAccount } from '@/features/session/use-account'
import { usePlaceHold } from '@/features/shell/open-place'
import { useNow } from '@/hooks/use-now'
import { useWallet } from '@/features/wallet/use-wallet'
import type {
  LaunchCabinetRow,
  LaunchClaimReceipt,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchMarketRow,
  LaunchNetworkId,
} from '@/lib/api/v1/types'
import { feel } from '@/lib/haptics'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { ShareReceiptButton } from '@/screens/receipts/share-receipt'

import { holdersCell, TechChip, TradeStatusChip } from './market-parts'
import { ExplorerLink, LaunchTabs, PausedNote, Row, Steps, TokenPicture } from './parts'

/**
 * «Мої лаунчі» — the creator's cabinet, as on the web: what the wallet's
 * launches earned it (each currency apart), then each launch — its state and
 * health as «Лаунчі на Ryntra» says them, its way to the DEX, what it earned
 * from the curve, the move to the DEX and the locked pool, one «Забрати» —
 * and the claim receipts. Every figure is the chain's; a figure not read is
 * said as not read, never as zero.
 */
export function LaunchMineScreen() {
  const router = useRouter()
  const shared = useSharedCopy()
  const locale = useLocale()
  const word = launchWords(locale)
  const account = useAccount()
  const launchOpen = useLaunchOpen()
  const open = launchOpen.open
  const cabinet = useCreatorCabinet(open === true ? account.address : null)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  const data = cabinet.data && cabinet.data.wallet === account.address ? cabinet.data : null

  let body: React.ReactNode
  if (launchOpen.failed)
    body = (
      <StateView
        icon="cloud-offline-outline"
        title={word('launchUnread')}
        action={{ title: word('readAgain'), onPress: launchOpen.retry, loading: launchOpen.reading }}
      />
    )
  else if (open === false) body = <StateView icon="rocket-outline" title={word('unavailable')} />
  else if (!account.address)
    body = (
      <StateView
        icon="wallet-outline"
        title={word('mineConnectTitle')}
        action={{
          title: word('mineConnect'),
          onPress: () => void account.connect(),
          loading: account.busy === 'connect',
        }}
      />
    )
  else if (!data && cabinet.isError)
    body = (
      <StateView
        icon="cloud-offline-outline"
        title={word('mineUnread')}
        action={{ title: word('mineReadAgain'), onPress: () => void cabinet.refetch(), loading: cabinet.isFetching }}
      />
    )
  else if (!data) body = <StateView icon="hourglass-outline" title={word('mineReading')} />
  else if (data.launches.length === 0)
    body = (
      <StateView
        icon="rocket-outline"
        title={word('mineEmptyTitle')}
        action={{ title: word('mineLaunch'), onPress: () => router.replace('/launch' as never) }}
      />
    )
  else
    body = (
      <Cabinet data={data} word={word} locale={locale} address={account.address} marketsOpen={launchOpen.markets} />
    )

  return (
    <Screen
      title={word('mineTitle')}
      onBack={back}
      backLabel={shared.back}
      refreshControl={
        data ? <RefreshControl refreshing={cabinet.isRefetching} onRefresh={() => void cabinet.refetch()} /> : undefined
      }
    >
      <LaunchTabs word={word} current="mine" />
      {body}
    </Screen>
  )
}

/**
 * A launch's row of «Лаунчі на Ryntra»: its state and health, still being
 * read, not read now, not on the list yet (a launch newer than the list's
 * read — its own card is read), or `none` where the server has no such read.
 */
export type MarketRead = LaunchMarketRow | 'reading' | 'unread' | 'missing' | 'none'

/**
 * Each launch's state and health from «Лаунчі на Ryntra» — one read for
 * every card, as the list itself reads them, and read again while the page
 * is in view; nothing asked where the server has no markets' reads.
 */
function useMarketRows(enabled: boolean): (token: string) => MarketRead {
  const live = usePageLive()
  const markets = useLaunchMarkets(enabled, live)
  return (token) => {
    if (!enabled) return 'none'
    const row = markets.data?.markets.find((entry) => entry.token === token)
    if (row) return row
    return markets.data ? 'missing' : markets.isError ? 'unread' : 'reading'
  }
}

/** A launch the list does not carry yet: its own market card, read once. */
function useOwnMarket(token: string, market: MarketRead): MarketRead {
  const card = useLaunchMarketCard(market === 'missing' ? token : null)
  if (market !== 'missing') return market
  return card.data ? card.data.market : card.isError ? 'unread' : 'reading'
}

export function Cabinet({
  data,
  word,
  locale,
  address,
  marketsOpen = true,
  markets: given,
}: {
  data: LaunchCreatorCabinetResponse
  word: LaunchWord
  locale: Locale
  address: string
  /** Whether the server names the markets' reads (1.36.0); without them no state or health is drawn. */
  marketsOpen?: boolean
  /** Each token's market row as already read — the gallery's samples; read here otherwise. */
  markets?: Readonly<Record<string, MarketRead>>
}) {
  const read = useMarketRows(!given && marketsOpen)
  const marketOf = (token: string): MarketRead => (given ? (given[token] ?? 'unread') : read(token))
  return (
    <>
      <Summary data={data} word={word} locale={locale} />
      {data.launches.map((row) => (
        <LaunchCard
          key={row.token}
          row={row}
          market={marketOf(row.token)}
          network={data.network}
          readAt={data.observedAt}
          word={word}
          locale={locale}
          address={address}
        />
      ))}
      <Receipts receipts={data.receipts} network={data.network} word={word} locale={locale} />
    </>
  )
}

/** What all the wallet's launches earned it, each currency apart — never a community token turned into dollars. */
function Summary({ data, word, locale }: { data: LaunchCreatorCabinetResponse; word: LaunchWord; locale: Locale }) {
  const now = useNow(15_000)
  const card = data.card
  const toClaim = toClaimByPair(data)
  const amounts = [...card.amounts].sort((a, b) => Number(b.dollar) - Number(a.dollar))
  const pairOf = (amount: (typeof amounts)[number]) => ({
    symbol: amount.symbol,
    decimals: amount.decimals,
    dollar: amount.dollar,
  })
  return (
    <Card className="gap-3">
      <View className="gap-1">
        <Txt variant="labelSm" tone="faint" caps>
          {word('mineEarned')}
        </Txt>
        {amounts.length === 0 ? (
          <Txt variant="dataLg">—</Txt>
        ) : (
          amounts.map((amount) => (
            <Txt key={amount.pairMint} variant="dataLg">
              {shortPair(amount.earnedRaw, pairOf(amount), locale)}
            </Txt>
          ))
        )}
      </View>
      <View className="flex-row gap-3">
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {word('mineToClaim')}
          </Txt>
          {amounts.map((amount) => (
            <Txt key={amount.pairMint} variant="data">
              {exactPair(toClaim.get(amount.pairMint) ?? 0n, pairOf(amount), locale)}
            </Txt>
          ))}
        </View>
        <View className="flex-1 gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {word('mineClaimed')}
          </Txt>
          {amounts.map((amount) => (
            <Txt key={amount.pairMint} variant="data">
              {shortPair(amount.claimedRaw, pairOf(amount), locale)}
            </Txt>
          ))}
        </View>
      </View>
      <Txt variant="ui" tone="muted">
        {`${word('mineLaunches')} ${card.launches} · ${word('mineOnDex')} ${card.graduated} · ${word('mineSince', { date: formatDate(card.period.from, locale) })}`}
      </Txt>
      {/* Every figure carries its time: when the chain was read for this cabinet. */}
      <Txt variant="labelSm" tone="faint">
        {word('marketRead', { ago: readAgo(word, data.observedAt, now) })}
      </Txt>
      {card.unread > 0 ? (
        <Txt variant="ui" tone="warning">
          {word('mineSummaryUnread', { n: card.unread })}
        </Txt>
      ) : null}
    </Card>
  )
}

function ProgressBar({ bps, label }: { bps: number; label: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(bps / 100) }}
      className="h-1.5 overflow-hidden rounded-pill bg-track"
    >
      <View className="h-full rounded-pill bg-brand" style={{ width: `${Math.max(bps / 100, 1)}%` }} />
    </View>
  )
}

type ClaimPhase = 'idle' | FlowStep | 'done' | 'error'

function LaunchCard({
  row,
  market: listed,
  network,
  readAt,
  word,
  locale,
  address,
}: {
  row: LaunchCabinetRow
  market: MarketRead
  network: LaunchNetworkId
  /** When the chain was read for the cabinet — the time its earnings carry. */
  readAt: string
  word: LaunchWord
  locale: Locale
  address: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const wallet = useWallet()
  const presets = useLaunchPresets()
  const [phase, setPhase] = useState<ClaimPhase>('idle')
  const [failure, setFailure] = useState<LaunchFailure | null>(null)
  const [result, setResult] = useState<LaunchClaimSubmitResponse | null>(null)
  const [cost, setCost] = useState<string | null>(null)
  const [paused, setPaused] = useState(false)
  const running = useRef(false)
  const earnings = row.earnings
  const presetLabel = presetName(row.preset, presets.data?.presets, locale, word)
  const busy = phase === 'prepare' || phase === 'sign' || phase === 'send'
  // While it is prepared, signed or sent, a note's tap or a quick action waits for it (`place-hold.ts`).
  usePlaceHold(busy)
  const unclaimed = unclaimedOf(row)

  const claim = async () => {
    if (running.current) return
    running.current = true
    setFailure(null)
    setCost(null)
    try {
      if (wallet.address !== address) {
        setFailure({ step: 'before', code: 'WALLET_CHANGED', detail: null })
        setPhase('error')
        return
      }
      const outcome = await claimFees({
        api: claimApi(row.token),
        wallet: { signTransactions: wallet.signTransactions },
        address,
        onStep: (step) => {
          if (step === 'sign') feel('review')
          if (step === 'send') feel('sent')
          setPhase(step)
        },
        onBuilt: (built) => setCost(built.networkCostLamports),
      })
      if (outcome.ok) {
        feel(claimView(outcome.result).kind === 'done' ? 'done' : 'sent')
        setResult(outcome.result)
        setPhase('done')
        void queryClient.invalidateQueries({ queryKey: ['launch', 'cabinet'] })
        return
      }
      if (isPaused(outcome.failure.code)) {
        setPaused(true)
        setPhase('idle')
        return
      }
      // Cancelled in the wallet: nothing was sent, and the button is back.
      feel(outcome.failure.code === 'WALLET_REFUSED' ? 'declined' : 'failed')
      setFailure(outcome.failure)
      setPhase(outcome.failure.code === 'WALLET_REFUSED' ? 'idle' : 'error')
      // An answer lost at the send may hide a claim that went out: the cabinet is read again so its receipts say.
      if (outcome.failure.step === 'send') void queryClient.invalidateQueries({ queryKey: ['launch', 'cabinet'] })
    } finally {
      running.current = false
    }
  }

  const shared = row.feeSharing !== null && row.feeSharing.state !== 'FAILED'
  const market = useOwnMarket(row.token, listed)
  const now = useNow(15_000)
  // «Забрати {amount}» says what waits; the rows then say only what each source earned.
  // Just claimed: what was left before is not said again beside the claim's own result, until the cabinet reads anew.
  const leftShown = !(canClaim(row, paused) && !busy) && phase !== 'done'

  return (
    <Card className="gap-3">
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(`/launch/${row.token}` as never)}
        className="flex-row items-center gap-3"
      >
        <TokenPicture uri={row.image} size={48} />
        <View className="flex-1 gap-0.5">
          <Txt variant="title" numberOfLines={1}>
            {row.name}
          </Txt>
          <Txt variant="ui" tone="muted" numberOfLines={1}>
            {`$${row.symbol} · ${word('mineLaunchedAt', { date: formatDate(row.launchedAt, locale) })} · ${shortKey(row.token)}`}
          </Txt>
        </View>
        <Icon name="chevron-forward" size={18} color="fgMuted" />
      </Pressable>
      <View className="flex-row flex-wrap items-center gap-1.5">
        {/* One status, as on every list — can it be traded now; the stage, said to TalkBack, is the market's page's. */}
        {typeof market === 'object' && market.read ? (
          <TradeStatusChip
            status={rowTradeStatus(market)}
            word={word}
            hint={market.state && knownState(market.state.code) ? word(`stateHint_${market.state.code}`) : undefined}
          />
        ) : null}
        {typeof market === 'object' && market.technicalValidation ? <TechChip word={word} standalone /> : null}
        {presetLabel ? <Chip label={word('presetChip', { name: presetLabel })} caps={false} /> : null}
        {row.role === 'recipient' && earnings ? (
          <Chip label={word('mineRoleShare', { pct: formatBps(earnings.mine.shareBps, locale) })} caps={false} />
        ) : null}
      </View>

      <View className="gap-1.5">
        <View className="flex-row items-center justify-between">
          <Txt variant="ui" tone="muted">
            {row.migrated ? word('graduated') : word('progress')}
          </Txt>
          {row.progressBps === null ? (
            <Txt variant="ui" tone="faint">
              {word('progressUnknown')}
            </Txt>
          ) : row.migrated ? (
            <Icon name="checkmark-circle" size={16} color="successInk" />
          ) : (
            <Txt variant="data">{formatBps(row.progressBps, locale)}</Txt>
          )}
        </View>
        {row.progressBps !== null && !row.migrated ? (
          <ProgressBar bps={row.progressBps} label={word('progress')} />
        ) : null}
      </View>

      {market === 'none' ? null : <MarketHealth market={market} word={word} locale={locale} />}

      <View>
        <View className="flex-row items-center justify-between gap-2 pb-1">
          <Txt variant="labelSm" tone="faint" caps>
            {word('mineBySource')}
          </Txt>
          {earnings ? (
            <Txt variant="labelSm" tone="faint">
              {sinceText(readAt, word, locale, now)}
            </Txt>
          ) : null}
        </View>
        {shared && earnings ? (
          <Txt variant="ui" tone="muted" className="pb-1">
            {word('mineBreakdownShare', { pct: formatBps(earnings.mine.shareBps, locale) })}
          </Txt>
        ) : null}
        {/* Not read: one line says so and how to read again — never a zero, never three rows of the same word. */}
        {!earnings ? (
          <Txt variant="ui" tone="muted">
            {word(noClaimKey(row))}
          </Txt>
        ) : null}
        {sourceRows(row).map((entry) => (
          <Row
            key={entry.source}
            label={word(`source_${entry.source}`)}
            value={
              entry.later
                ? word('sourceAfterDex')
                : `${shortPair(entry.earnedRaw, row.pair, locale)}${entry.leftRaw !== null && leftShown ? ` · ${word('sourceLeft', { amount: exactPair(entry.leftRaw, row.pair, locale) })}` : ''}`
            }
            tone={entry.later ? 'muted' : 'fg'}
            mono={!entry.later}
          />
        ))}
        {/* What waits to be claimed is said by «Забрати» itself; said here only where that button is not. */}
        {earnings && unclaimed > 0n && leftShown ? (
          <Row label={word('mineToClaim')} value={exactPair(unclaimed, row.pair, locale)} />
        ) : null}
      </View>

      {row.feeSharing ? <Sharing row={row} address={address} network={network} word={word} locale={locale} /> : null}

      {paused ? <PausedNote word={word} onCheck={() => setPaused(false)} /> : null}

      {phase === 'done' && result ? (
        <ClaimResult
          result={result}
          row={row}
          network={network}
          word={word}
          locale={locale}
          onClose={() => setPhase('idle')}
        />
      ) : busy ? (
        <View className="gap-2">
          <Steps
            word={word}
            phase={phase as FlowStep}
            labels={{ prepare: 'stepPrepareClaim', send: 'stepSendClaim' }}
          />
          {phase !== 'prepare' ? (
            <Txt variant="labelSm" tone="faint">
              {cost === null ? word('claimCostUnknown') : word('claimCost', { sol: formatRaw(cost, 9, locale, 6) })}
            </Txt>
          ) : null}
        </View>
      ) : canClaim(row, paused) ? (
        // One card of many: its claim is quiet, so the screen never stacks orange actions.
        <Button
          title={word('claim', { amount: exactPair(unclaimed, row.pair, locale) })}
          variant="secondary"
          onPress={() => void claim()}
        />
      ) : earnings ? (
        <Txt variant="ui" tone="muted">
          {word(noClaimKey(row))}
        </Txt>
      ) : null}

      {failure && phase !== 'done' ? (
        failure.code === 'WALLET_REFUSED' ? (
          <Txt variant="ui" tone="muted" accessibilityLiveRegion="polite">
            {word('walletCancelled')}
          </Txt>
        ) : (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            className="gap-1.5 rounded-sm border border-line bg-danger-soft px-3 py-3"
          >
            <View className="flex-row items-center gap-2">
              <Icon name="alert-circle" size={18} color="dangerInk" />
              <Txt variant="ui" tone="danger">
                {word(claimFailureTitleKey(failure.code, failure.step === 'send'))}
              </Txt>
            </View>
            <Txt variant="ui">{word(claimFailureKey(failure.code, failure.step === 'send'))}</Txt>
            {phase === 'error' ? (
              <Button title={word('claimAgain')} variant="secondary" onPress={() => setPhase('idle')} />
            ) : null}
          </View>
        )
      ) : null}
    </Card>
  )
}

/**
 * A market's health as «Лаунчі на Ryntra» says it: depth at −5 % and holders
 * over $1, with when the chain was read; not read is said, never a zero. The
 * state's chip stands above with the preset.
 */
function MarketHealth({ market, word, locale }: { market: MarketRead; word: LaunchWord; locale: Locale }) {
  const now = useNow(15_000)
  if (typeof market !== 'object' || !market.read)
    return (
      <View className="gap-0.5">
        <Txt variant="labelSm" tone="faint" caps>
          {word('healthTitle')}
        </Txt>
        <Txt variant="ui" tone="muted">
          {market === 'reading' ? word('marketReading') : word('notRead')}
        </Txt>
      </View>
    )
  const depth = rowDepth(market)
  const holders = rowHoldersView(market)
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between gap-2">
        <Txt variant="labelSm" tone="faint" caps>
          {word('healthTitle')}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {sinceText(market.observedAt, word, locale, now)}
        </Txt>
      </View>
      <View className="flex-row">
        <Stat
          label={word('colDepth')}
          value={
            depth.kind === 'raw'
              ? pairMoney(depth.raw, market.pair, locale)
              : depth.kind === 'curveFull'
                ? word('curveFull')
                : word('notRead')
          }
          unread={depth.kind !== 'raw'}
        />
        <Stat label={word('colHolders')} value={holdersCell(holders, word, locale)} unread={holders.kind !== 'count'} />
      </View>
    </View>
  )
}

function Stat({ label, value, unread }: { label: string; value: string; unread?: boolean }) {
  return (
    <View className="w-1/2 gap-0.5 py-1 pr-2">
      <Txt variant="labelSm" tone="faint" caps>
        {label}
      </Txt>
      <Txt variant={unread ? 'ui' : 'data'} tone={unread ? 'faint' : 'fg'}>
        {value}
      </Txt>
    </View>
  )
}

/** The shares written for ever in the vault: who takes what of the creator's fees. */
function Sharing({
  row,
  address,
  network,
  word,
  locale,
}: {
  row: LaunchCabinetRow
  address: string
  network: LaunchNetworkId
  word: LaunchWord
  locale: Locale
}) {
  const sharing = row.feeSharing!
  if (sharing.state === 'FAILED')
    return (
      <Txt variant="ui" tone="muted">
        {word('mineShareFailed')}
      </Txt>
    )
  return (
    <View className="gap-1 rounded-sm border border-line px-3 py-2">
      <View className="flex-row items-center justify-between">
        <Txt variant="labelSm" tone="faint" caps>
          {word('mineShares')}
        </Txt>
        <ExplorerLink label={word('feeShareVault')} url={explorerUrl(network, 'account', sharing.vault)} />
      </View>
      {sharing.shares.map((share) => (
        <Row
          key={share.address}
          label={
            share.address === address
              ? word('you')
              : share.address === row.creator
                ? `${word('label_creator')} · ${shortKey(share.address)}`
                : shortKey(share.address)
          }
          value={formatBps(share.bps, locale)}
        />
      ))}
      {sharing.state === 'PENDING' ? (
        <Txt variant="labelSm" tone="faint">
          {word('mineSharePending')}
        </Txt>
      ) : null}
    </View>
  )
}

export function ClaimResult({
  result,
  row,
  network,
  word,
  locale,
  onClose,
}: {
  result: LaunchClaimSubmitResponse
  row: LaunchCabinetRow
  network: LaunchNetworkId
  word: LaunchWord
  locale: Locale
  onClose: () => void
}) {
  const view = claimView(result)
  const receiptWords = useCopy(RECEIPTS_COPY)
  // When the claim came back — the receipt's time where the chain's event has none yet.
  const [answeredAt] = useState(() => new Date().toISOString())
  const doc = docFromClaimResult(
    {
      token: row.token,
      symbol: row.symbol,
      pair: row.pair,
      kind: view.kind,
      receivedRaw: view.receivedRaw,
      // All of it went into the shared vault: what the programs paid, whatever the state says.
      intoVaultRaw:
        view.intoVaultRaw ??
        (view.receivedRaw === 0n
          ? result.receipts.reduce(
              (sum, receipt) =>
                sum + BigInt(receipt.paid.curve) + BigInt(receipt.paid.graduation) + BigInt(receipt.paid.lp),
              0n,
            )
          : null),
      signature: view.signatures[0] ?? null,
      title: receiptWords.claimed(row.symbol),
      at: result.receipts[0]?.at ?? answeredAt,
    },
    locale,
  )
  return (
    <View accessibilityLiveRegion="polite" className="gap-1.5 rounded-sm border border-line bg-elevated px-3 py-3">
      <View className="flex-row items-center gap-2">
        <Icon
          name={view.kind === 'done' ? 'checkmark-circle' : view.kind === 'partial' ? 'alert-circle' : 'time-outline'}
          size={18}
          color={view.kind === 'done' ? 'successInk' : view.kind === 'partial' ? 'warningInk' : 'muted'}
        />
        <Txt variant="ui" className="flex-1">
          {view.kind === 'done'
            ? word('claimDone', { amount: exactPair(view.receivedRaw, row.pair, locale) })
            : view.kind === 'partial'
              ? view.intoVaultRaw !== null
                ? `${word('claimPartial', { amount: exactPair(view.intoVaultRaw, row.pair, locale) })} ${word('receiptIntoVault')}`
                : word('claimPartial', { amount: exactPair(view.receivedRaw, row.pair, locale) })
              : word('claimPendingTitle')}
        </Txt>
      </View>
      <Txt variant="ui" tone="muted">
        {view.kind === 'done'
          ? word('claimDoneLine')
          : view.kind === 'partial'
            ? word('claimPartialLine')
            : word('claimPendingLine')}
      </Txt>
      {view.signatures.map((signature) => (
        <ExplorerLink
          key={signature}
          label={`${word('viewTx')} ${shortKey(signature)}`}
          url={explorerUrl(network, 'tx', signature)}
        />
      ))}
      <ShareReceiptButton variant="button" doc={doc} />
      <Button title={word('claimAgain')} variant="secondary" onPress={onClose} />
    </View>
  )
}

/** How long ago the chain was read, in Launch's own words. */
function readAgo(word: LaunchWord, observedAt: string, now: number): string {
  return agoText(word, Math.max(0, Math.floor((now - Date.parse(observedAt)) / 1000)))
}

/** The claim receipts: what each program paid by its own event, and what the wallet received — each a tap deeper. */
function Receipts({
  receipts,
  network,
  word,
  locale,
}: {
  receipts: readonly LaunchClaimReceipt[]
  network: LaunchNetworkId
  word: LaunchWord
  locale: Locale
}) {
  const [opened, setOpened] = useState<LaunchClaimReceipt | null>(null)
  const receiptWords = useCopy(RECEIPTS_COPY)
  return (
    <Card className="gap-2">
      <Txt variant="labelSm" tone="faint" caps>
        {word('receiptsTitle')}
      </Txt>
      {receipts.length === 0 ? (
        <Txt variant="ui" tone="muted">
          {word('receiptsEmpty')}
        </Txt>
      ) : (
        receipts.map((receipt) => {
          const paidIn = BigInt(receipt.paid.curve) + BigInt(receipt.paid.graduation) + BigInt(receipt.paid.lp)
          const intoVault = BigInt(receipt.receivedRaw) === 0n && paidIn > 0n
          return (
            <Pressable
              key={receipt.signature}
              accessibilityRole="button"
              onPress={() => setOpened(receipt)}
              className="flex-row items-center gap-3 py-2 active:opacity-70"
            >
              <View className="flex-1 gap-0.5">
                <Txt variant="ui" numberOfLines={1}>
                  {`${receipt.name} · $${receipt.symbol}`}
                </Txt>
                <Txt variant="labelSm" tone="faint">
                  {receipt.at ? formatDate(receipt.at, locale) : '—'}
                </Txt>
              </View>
              <Txt variant="data">
                {intoVault ? `${word('receiptIntoVault')} ` : ''}
                {exactPair(intoVault ? paidIn : receipt.receivedRaw, receipt.pair, locale)}
              </Txt>
              <Icon name="chevron-forward" size={16} color="fgMuted" />
            </Pressable>
          )
        })
      )}
      <Sheet
        visible={opened !== null}
        title={opened ? `${opened.name} · $${opened.symbol}` : ''}
        subtitle={opened?.at ? formatDate(opened.at, locale) : undefined}
        onClose={() => setOpened(null)}
      >
        {opened ? (
          <View className="px-4 pb-2">
            <Txt variant="labelSm" tone="faint" caps className="pb-1">
              {word('receiptPaid')}
            </Txt>
            {(['curve', 'graduation', 'lp'] as const)
              .filter((source) => BigInt(opened.paid[source]) > 0n)
              .map((source) => (
                <Row
                  key={source}
                  label={word(`source_${source}`)}
                  value={`${formatRaw(opened.paid[source], opened.pair.decimals, locale, 4)} ${opened.pair.symbol}`}
                />
              ))}
            {opened.vaultPaidRaw !== null ? (
              <Row
                label={word('receiptVaultPaid')}
                value={`${formatRaw(opened.vaultPaidRaw, opened.pair.decimals, locale, 4)} ${opened.pair.symbol}`}
              />
            ) : null}
            <Row
              label={word('receiptReceived')}
              value={`${formatRaw(opened.receivedRaw, opened.pair.decimals, locale, 4)} ${opened.pair.symbol}`}
            />
            <ExplorerLink
              label={`${word('viewTx')} ${shortKey(opened.signature)}`}
              url={explorerUrl(network, 'tx', opened.signature)}
            />
            <ShareReceiptButton doc={docFromClaim(opened, receiptWords.claimed(opened.symbol), locale)} />
          </View>
        ) : null}
      </Sheet>
    </Card>
  )
}
