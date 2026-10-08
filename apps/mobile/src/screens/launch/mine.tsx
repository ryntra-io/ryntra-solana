import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { claimApi, fetchLaunchMarket } from '@/features/launch/launch-api'
import { claimFees, type FlowStep, type LaunchFailure } from '@/features/launch/launch-flow'
import {
  exactPair,
  explorerUrl,
  formatBps,
  formatCountShort,
  formatDate,
  formatMoneyShort,
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
  earningsUnreadKey,
  isPaused,
  noClaimKey,
  presetName,
  sourceRows,
  toClaimByPair,
  unclaimedOf,
} from '@/features/launch/launch-model'
import { useCreatorCabinet, useLaunchOpen, useLaunchPresets } from '@/features/launch/use-launch'
import { useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import { useWallet } from '@/features/wallet/use-wallet'
import type {
  LaunchCabinetRow,
  LaunchClaimReceipt,
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchMarketResponse,
  LaunchNetworkId,
} from '@/lib/api/v1/types'
import { feel } from '@/lib/haptics'
import { useLocale, useSharedCopy, type Locale } from '@/lib/i18n'

import { ExplorerLink, LaunchTabs, PausedNote, Row, Steps, TokenPicture } from './parts'

/**
 * «Мої лаунчі» — the creator's cabinet, as on the web: what the wallet's
 * launches earned it (each currency apart), then each launch — its way to the
 * DEX, the day's volume and holders, what it earned and what can be claimed
 * now, one «Забрати» — and the claim receipts. Every figure is the chain's; a
 * figure not read is said as not read, never as zero.
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
        detail={word('mineConnectLine')}
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
        detail={word('mineEmptyLine')}
        action={{ title: word('mineLaunch'), onPress: () => router.replace('/launch' as never) }}
      />
    )
  else body = <Cabinet data={data} word={word} locale={locale} address={account.address} />

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
      <Txt variant="ui" tone="muted">
        {word('mineLede')}
      </Txt>
      {body}
    </Screen>
  )
}

/** The day's volume and the holders, from each token's own market — one token at a time, so a public node is not asked in a burst. */
function useMarkets(tokens: readonly string[]) {
  const [markets, setMarkets] = useState<Record<string, LaunchMarketResponse | 'unread'>>({})
  const key = tokens.join(',')
  useEffect(() => {
    let live = true
    void (async () => {
      for (const token of key ? key.split(',') : []) {
        if (!live) return
        let answer: LaunchMarketResponse | 'unread'
        try {
          answer = await fetchLaunchMarket(token)
        } catch {
          answer = 'unread'
        }
        if (!live) return
        setMarkets((current) => ({ ...current, [token]: answer }))
      }
    })()
    return () => {
      live = false
    }
  }, [key])
  return markets
}

export function Cabinet({
  data,
  word,
  locale,
  address,
  markets: given,
}: {
  data: LaunchCreatorCabinetResponse
  word: LaunchWord
  locale: Locale
  address: string
  /** Each token's market as already read — the gallery's samples; read here otherwise. */
  markets?: Readonly<Record<string, LaunchMarketResponse | 'unread'>>
}) {
  const tokens = useMemo(() => (given ? [] : data.launches.map((row) => row.token)), [data.launches, given])
  const read = useMarkets(tokens)
  const markets = given ?? read
  return (
    <>
      <Summary data={data} word={word} locale={locale} />
      {data.launches.map((row) => (
        <LaunchCard
          key={row.token}
          row={row}
          market={markets[row.token]}
          network={data.network}
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
  market,
  network,
  word,
  locale,
  address,
}: {
  row: LaunchCabinetRow
  market: LaunchMarketResponse | 'unread' | undefined
  network: LaunchNetworkId
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
  const [sources, setSources] = useState(false)
  const running = useRef(false)
  const earnings = row.earnings
  const presetLabel = presetName(row.preset, presets.data?.presets, locale, word)
  const busy = phase === 'prepare' || phase === 'sign' || phase === 'send'
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

  const figure = (read: (data: LaunchMarketResponse) => string) =>
    market === undefined ? word('mineMarketReading') : market === 'unread' ? word('mineNotRead') : read(market)
  const shared = row.feeSharing !== null && row.feeSharing.state !== 'FAILED'

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
      <View className="flex-row flex-wrap gap-1.5">
        <Chip label={word('presetChip', { name: presetLabel })} caps={false} />
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

      <View className="flex-row flex-wrap">
        <Stat
          label={word('mineEarned')}
          value={earnings ? shortPair(earnings.mine.earnedRaw, row.pair, locale) : word(earningsUnreadKey(row))}
          unread={!earnings}
        />
        <Stat
          label={word('mineToClaim')}
          value={earnings ? exactPair(earnings.mine.unclaimedRaw, row.pair, locale) : word(earningsUnreadKey(row))}
          unread={!earnings}
        />
        <Stat
          label={word('mineVolume')}
          value={figure(
            (data) =>
              `${data.volume24h.complete ? '' : '≥ '}${formatMoneyShort(data.volume24h.pair, locale, data.pair.dollar, data.pair.symbol)}`,
          )}
          unread={market === undefined || market === 'unread'}
        />
        <Stat
          label={word('mineHolders')}
          value={figure((data) => `${data.holders.atLeast ? '≥ ' : ''}${formatCountShort(data.holders.count, locale)}`)}
          unread={market === undefined || market === 'unread'}
        />
      </View>

      {earnings ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setSources(true)}
          hitSlop={8}
          className="min-h-11 justify-center self-start"
        >
          <Txt variant="ui" tone="brand">
            {word('mineBreakdown')}
          </Txt>
        </Pressable>
      ) : null}

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
        <Button
          title={word('claim', { amount: exactPair(unclaimed, row.pair, locale) })}
          size="lg"
          onPress={() => void claim()}
        />
      ) : (
        <Txt variant="ui" tone="muted">
          {word(noClaimKey(row))}
        </Txt>
      )}

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

      <Sheet visible={sources} title={row.name} subtitle={word('mineBreakdown')} onClose={() => setSources(false)}>
        <View className="px-4 pb-2">
          {shared && earnings ? (
            <Txt variant="ui" tone="muted" className="pb-1">
              {word('mineBreakdownShare', { pct: formatBps(earnings.mine.shareBps, locale) })}
            </Txt>
          ) : null}
          {sourceRows(row).map((entry) => (
            <Row
              key={entry.source}
              label={word(`source_${entry.source}`)}
              value={
                entry.later
                  ? word('sourceAfterDex')
                  : `${shortPair(entry.earnedRaw, row.pair, locale)}${entry.leftRaw !== null ? ` · ${word('sourceLeft', { amount: exactPair(entry.leftRaw, row.pair, locale) })}` : ''}`
              }
              tone={entry.later ? 'muted' : 'fg'}
            />
          ))}
        </View>
      </Sheet>
    </Card>
  )
}

function Stat({ label, value, unread }: { label: string; value: string; unread?: boolean }) {
  return (
    <View className="w-1/2 gap-0.5 py-1.5 pr-2">
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
          </View>
        ) : null}
      </Sheet>
    </Card>
  )
}
