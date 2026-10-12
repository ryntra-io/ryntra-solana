import { useState } from 'react'
import { View } from 'react-native'

import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import { launchWords } from '@/features/launch/copy'
import {
  SAMPLE_HEALTH_CURVE,
  SAMPLE_HEALTH_DEX,
  SAMPLE_JOURNAL,
  SAMPLE_MARKET_CARD,
  SAMPLE_MARKETS,
} from '@/features/launch/market-samples'
import { healthDoorLine } from '@/features/launch/market-view'
import type {
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchJournalEvent,
  LaunchJournalResponse,
  LaunchMarketHealthResponse,
  LaunchMarketResponse,
  LaunchMarketRow,
  LaunchTokenResponse,
} from '@/lib/api/v1/types'
import { useLocale } from '@/lib/i18n'

import { LaunchSuccess } from './launch-success'
import { JournalCard } from './journal-parts'
import { HealthSheet, MarketStateCard, RulesCard } from './market-parts'
import { MarketCard } from './markets'
import { Cabinet, ClaimResult } from './mine'
import { PausedNote } from './parts'
import { About, Marks, MarketBody, ReceiptDoor, TokenHead } from './token'

/*
 * Ryntra Launch in the development gallery: a token's page with its market,
 * «Мої лаунчі» with what two launches earned, and the ends of a launch and a
 * claim — drawn from sample answers in the contract's shapes, every address
 * and signature made up, so each is seen in both themes and both languages
 * before a real token exists.
 */

const ME = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
const MINT = '7SKYne72sKvopLugvb4ibrpy1goHYAfRo68Q67A1vVDw'
const MINT2 = 'J4Dhtz6H2bc3TjddmPngPfSokeUYHJxkRyHLSXxqPzzE'
const CONFIG = 'KUkQmudh2bbQBY95LpcRBKsarjGmLKmoR8uXxLgyUa3'
const POOL = '12bsPEhAgbfCaFv6GuxFGcKv1nz3TLXERtgcLRiKYyXm'
const ESCROW = '8TAyiL4d8juZSAVHRLPZFF3jdfe7CotfteWUkoSmbBLV'
const SNIPER = 'JXgcWb8xsgyhc72hmXstuUyp7HvoJ1wPimDfhceiovw'
const BUYER = 'BUYX9j2wca4rjYwTij3H17wM4kYiHbT9uRD7k3ozFBxg'
const OTHER = 'rEGbG2sq7PYPyFQy6Z7V3qytZDdurrvxihf8zQ7Laax'
const SIG = 'YSVkFJC5xYEJj3WwwxW5yB9c2djidUa7R8GUGedJ55Sf6DtajHGyLnBNjAbxr7WzPLiUnHMcAK3HtJ7g2U5jkNL'
const SIG2 = '3vfUryy1zRpNqHMvoAH6Cp6C4Lhsd8Uio5YzJsH3E5oRR1UPbozfJj5Uk8wvFKL1Czxydb7u55psbyY5ycssEzf7'
const SIG3 = '3MibcJ7y9UNA5K7WEtTLwDG4dVTqpzDPuDzt6keyxyYawtuvuFEs1uRwdrM4perKVBX4pRFXVdLaS1qAoDpGzRGM'
const USDC = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6, dollar: true }
const AT = '2026-10-06T10:00:00.000Z'
const T0 = Date.parse(AT) / 1000

const TOKEN: LaunchTokenResponse = {
  network: 'solana:mainnet',
  token: MINT,
  name: 'Moon Owl',
  symbol: 'OWLM',
  description: 'A night bird for the ones who trade after midnight.',
  image: null,
  links: { website: 'https://example.com/', x: 'https://x.com/moonowl', telegram: null },
  preset: 'protected',
  creator: ME,
  launchedAt: AT,
  signature: SIG,
  progressBps: 1840,
  migrated: false,
  lock: {
    schedule: '1m-3m',
    escrow: ESCROW,
    signature: SIG2,
    state: 'LOCKED',
    reason: null,
    cliffAt: '2026-11-05T10:00:00.000Z',
    endsAt: '2027-01-04T10:00:00.000Z',
  },
  feeSharing: null,
  receipt: {
    source: 'ryntra.solana.launch-receipt.facts@1',
    network: 'solana',
    cluster: 'mainnet',
    preset: 'protected',
    config: CONFIG,
    token: MINT,
    pool: POOL,
    creator: ME,
    created: { signature: SIG, slot: 1, at: AT },
    creatorFirstBuy: { quoteInRaw: '20000000', tokensOutRaw: '3846153846154', capRaw: '20000000000000' },
    creatorLock: {
      escrow: ESCROW,
      lockedRaw: '3846153846154',
      cliffAt: '2026-11-05T10:00:00.000Z',
      endsAt: '2027-01-04T10:00:00.000Z',
    },
    feeSharing: null,
    token2022: {
      supplyRaw: '1000000000000000',
      decimals: 6,
      mintAuthority: null,
      freezeAuthority: null,
      transferHookProgram: null,
      metadataUpdateAuthority: null,
      metadataPointerAuthority: null,
      extensions: ['MetadataPointer', 'TokenMetadata'],
    },
    curve: {
      quoteReserveRaw: '2208000000',
      migrationQuoteThresholdRaw: '12000000000',
      progressBps: 1840,
      migrated: false,
    },
    graduated: null,
    marks: [
      { code: 'CREATOR_BUY_LOCKED', account: ESCROW },
      { code: 'MINT_REVOKED', account: MINT },
      { code: 'NO_FREEZE', account: MINT },
      { code: 'METADATA_FIXED', account: MINT },
      { code: 'NO_TRANSFER_HOOK', account: MINT },
      { code: 'CURVE_HOLDS_FUNDS', account: POOL },
    ],
    observedAt: AT,
  },
  receiptProblems: [],
  shareLink: `https://ryntra.io/app/launch/${MINT}`,
  observedAt: AT,
}

const MARKET: LaunchMarketResponse = {
  network: 'solana:mainnet',
  token: MINT,
  venue: 'curve',
  pair: USDC,
  supplyRaw: '1000000000000000',
  tokenDecimals: 6,
  price: { pair: 0.00000912, usd: 0.00000912 },
  marketCap: { pair: 9120, usd: 9120 },
  sinceLaunchBps: 8240,
  liquidity: { pair: 2208, usd: 2208 },
  volume24h: { pair: 4310, usd: 4310, complete: true },
  progress: { bps: 1840, migrated: false, reserveRaw: '2208000000', thresholdRaw: '12000000000' },
  curveFee: { nowBps: 100, endBps: 100, sniperUntil: null },
  holders: {
    count: 14,
    atLeast: false,
    rows: [
      { owner: POOL, amountRaw: '780000000000000', shareBps: 7800, labels: ['curve'] },
      { owner: ESCROW, amountRaw: '3846153846154', shareBps: 38, labels: ['lock'] },
      { owner: SNIPER, amountRaw: '21000000000000', shareBps: 210, labels: ['sniper'] },
      { owner: BUYER, amountRaw: '14000000000000', shareBps: 140, labels: [] },
      { owner: OTHER, amountRaw: '9000000000000', shareBps: 90, labels: [] },
    ],
    groups: {
      creatorBps: 38,
      snipers: { shareBps: 210, wallets: 1 },
      bundle: { shareBps: 0, wallets: 0, atLeast: false },
      top10Bps: 1460,
    },
  },
  trades: {
    rows: [
      {
        signature: SIG3,
        at: '2026-10-06T11:40:00.000Z',
        side: 'buy',
        venue: 'curve',
        trader: BUYER,
        payer: BUYER,
        traderLabels: [],
        tokensRaw: '14000000000000',
        pairRaw: '120000000',
        feeRaw: '1200000',
        marketCapPair: 9120,
      },
      {
        signature: SIG2,
        at: '2026-10-06T10:05:00.000Z',
        side: 'sell',
        venue: 'curve',
        trader: SNIPER,
        payer: SNIPER,
        traderLabels: ['sniper'],
        tokensRaw: '4000000000000',
        pairRaw: '21000000',
        feeRaw: '210000',
        marketCapPair: 6400,
      },
      {
        signature: SIG,
        at: '2026-10-06T10:00:00.000Z',
        side: 'buy',
        venue: 'curve',
        trader: ME,
        payer: ME,
        traderLabels: ['creator'],
        tokensRaw: '3846153846154',
        pairRaw: '20000000',
        feeRaw: '200000',
        marketCapPair: 5000,
      },
    ],
    complete: true,
    read: 3,
  },
  chart: {
    points: [
      { t: T0, marketCapPair: 5000 },
      { t: T0 + 300, marketCapPair: 6400 },
      { t: T0 + 1800, marketCapPair: 5900 },
      { t: T0 + 3600, marketCapPair: 7800 },
      { t: T0 + 6000, marketCapPair: 9120 },
    ],
    markers: [{ t: T0, kind: 'creator-buy', signature: SIG }],
  },
  risk: [
    { code: 'SNIPERS_HOLD', level: 'attention', values: { shareBps: 210, wallets: 1 }, source: null },
    { code: 'FEW_HOLDERS', level: 'attention', values: { count: 14 }, source: null },
    { code: 'YOUNG', level: 'info', values: { seconds: 6000 }, source: null },
  ],
  creator: { address: ME, curves: 1, tradesComplete: true },
  trading: { venue: 'curve', pool: POOL, referral: true, jupiter: false },
  observedAt: '2026-10-06T11:40:00.000Z',
}

/** The contract's example markets: one on the DEX with Ryntra's ladder at work, one on its curve. */
const DEX_MINT = SAMPLE_MARKETS.markets[0]!.token

const CABINET: LaunchCreatorCabinetResponse = {
  network: 'solana:mainnet',
  wallet: ME,
  launches: [
    {
      token: MINT,
      name: 'Moon Owl',
      symbol: 'OWLM',
      image: null,
      preset: 'protected',
      creator: ME,
      role: 'creator',
      launchedAt: AT,
      pair: USDC,
      progressBps: 1840,
      migrated: false,
      earnings: {
        role: {
          curve: { earnedRaw: '17240000', unclaimedRaw: '12010000' },
          graduation: { earnedRaw: '0', unclaimedRaw: '0' },
          lp: { earnedRaw: '0', unclaimedRaw: '0' },
          earnedRaw: '17240000',
          unclaimedRaw: '12010000',
        },
        mine: { shareBps: 10_000, earnedRaw: '17240000', unclaimedRaw: '12010000', claimedRaw: '5230000' },
      },
      feeSharing: null,
      claimable: true,
    },
    {
      // On the DEX: every source earned, the curve's part claimed already.
      token: DEX_MINT,
      name: 'Example Owl',
      symbol: 'EXOWL',
      image: null,
      preset: 'classic',
      creator: ME,
      role: 'creator',
      launchedAt: '2026-10-01T08:00:00.000Z',
      pair: USDC,
      progressBps: 10_000,
      migrated: true,
      earnings: {
        role: {
          curve: { earnedRaw: '41200000', unclaimedRaw: '0' },
          graduation: { earnedRaw: '12360000', unclaimedRaw: '12360000' },
          lp: { earnedRaw: '860000', unclaimedRaw: '860000' },
          earnedRaw: '54420000',
          unclaimedRaw: '13220000',
        },
        mine: { shareBps: 10_000, earnedRaw: '54420000', unclaimedRaw: '13220000', claimedRaw: '41200000' },
      },
      feeSharing: null,
      claimable: true,
    },
    {
      token: MINT2,
      name: 'Night Owl',
      symbol: 'NOWL',
      image: null,
      preset: 'classic',
      creator: ME,
      role: 'creator',
      launchedAt: '2026-10-06T08:00:00.000Z',
      pair: USDC,
      progressBps: null,
      migrated: null,
      earnings: null,
      feeSharing: null,
      claimable: false,
    },
  ],
  receipts: [
    {
      token: MINT,
      name: 'Moon Owl',
      symbol: 'OWLM',
      signature: SIG3,
      at: '2026-10-06T11:00:00.000Z',
      pair: USDC,
      paid: { curve: '5230000', graduation: '0', lp: '0' },
      vaultPaidRaw: null,
      receivedRaw: '5230000',
    },
  ],
  card: {
    source: 'ryntra.launch.creator-earnings-card@1',
    kind: 'creator',
    wallet: ME,
    network: 'solana:mainnet',
    period: { from: '2026-10-06T08:00:00.000Z', to: '2026-10-06T11:40:00.000Z' },
    launches: 3,
    graduated: 1,
    unread: 1,
    amounts: [
      { pairMint: USDC.mint, symbol: 'USDC', decimals: 6, dollar: true, earnedRaw: '71660000', claimedRaw: '46430000' },
    ],
    receipts: [SIG3],
  },
  observedAt: '2026-10-06T11:40:00.000Z',
}

const RECEIPT = CABINET.receipts[0]!
const CLAIMS: readonly LaunchClaimSubmitResponse[] = [
  { state: 'CONFIRMED', receipts: [RECEIPT], pending: [], failed: [] },
  {
    state: 'PARTIAL',
    receipts: [{ ...RECEIPT, receivedRaw: '3000000' }],
    pending: [],
    failed: [{ signature: SIG2, reason: 'expired' }],
  },
  { state: 'PENDING', receipts: [], pending: [SIG2], failed: [] },
]

export function LaunchTokenSamples() {
  const locale = useLocale()
  const word = launchWords(locale)
  return (
    <View className="gap-3">
      <TokenHead token={TOKEN} word={word} locale={locale} />
      <MarketBody token={TOKEN} market={MARKET} word={word} locale={locale} />
      <Marks token={TOKEN} word={word} />
      <About token={TOKEN} word={word} />
      <ReceiptDoor token={TOKEN} word={word} locale={locale} />
    </View>
  )
}

export function LaunchMineSamples() {
  const locale = useLocale()
  const word = launchWords(locale)
  return (
    <View className="gap-3">
      <Cabinet
        data={CABINET}
        word={word}
        locale={locale}
        address={ME}
        markets={{
          [MINT]: { ...SAMPLE_MARKETS.markets[1]!, token: MINT },
          [DEX_MINT]: SAMPLE_MARKETS.markets[0]!,
          [MINT2]: 'unread',
        }}
      />
      {CLAIMS.map((claim) => (
        <Card key={claim.state}>
          <ClaimResult
            result={claim}
            row={CABINET.launches[0]!}
            network="solana:mainnet"
            word={word}
            locale={locale}
            onClose={() => undefined}
          />
        </Card>
      ))}
      <PausedNote word={word} />
      <PausedNote word={word} scope="launching" />
    </View>
  )
}

export function LaunchDoneSamples() {
  const locale = useLocale()
  const word = launchWords(locale)
  const submit = {
    token: MINT,
    signature: SIG,
    state: 'LAUNCHED' as const,
    lock: TOKEN.lock,
    tokenPath: `/app/launch/${MINT}`,
  }
  return (
    <View className="gap-3">
      <LaunchSuccess
        word={word}
        locale={locale}
        result={{ ok: true, submit, token: TOKEN, symbol: 'OWLM', image: null }}
        onAnother={() => undefined}
      />
      <LaunchSuccess
        word={word}
        locale={locale}
        result={{
          ok: true,
          submit: { ...submit, state: 'PENDING', lock: null },
          token: null,
          symbol: 'OWLM',
          image: null,
        }}
        onAnother={() => undefined}
      />
    </View>
  )
}

/** The market on its DAMM v2 pool, as the contract's example of the health has it: the market's own read beside it. */
const MARKET_DEX: LaunchMarketResponse = {
  ...MARKET,
  token: SAMPLE_HEALTH_DEX.token,
  venue: 'pool',
  progress: { bps: 10000, migrated: true, reserveRaw: '15454411163', thresholdRaw: '15454411163' },
  trading: { ...MARKET.trading, pool: SAMPLE_MARKET_CARD.addresses.pool ?? POOL },
}

const MARKET_CURVE: LaunchMarketResponse = {
  ...MARKET,
  token: SAMPLE_HEALTH_CURVE.token,
  progress: { bps: 3999, migrated: false, reserveRaw: '6180000000', thresholdRaw: '15454411163' },
}

/** The executor stopped where its steps stand: derived from the contract's example, the one thing changed. */
const HEALTH_PAUSED: LaunchMarketHealthResponse = {
  ...SAMPLE_HEALTH_DEX,
  state: { code: 'PAUSED_RISK', since: '2026-10-09T09:00:00.000Z' },
  engine: { ...SAMPLE_HEALTH_DEX.engine, acts: false, pause: { code: 'STOPPED', at: '2026-10-09T09:00:00.000Z' } },
}

/** A market not read in time: the record's facts only, every figure null. */
const ROW_UNREAD: LaunchMarketRow = {
  ...SAMPLE_MARKETS.markets[1]!,
  token: MINT2,
  name: 'Quiet Fox',
  symbol: 'QFOX',
  technicalValidation: false,
  read: false,
  state: null,
  venue: null,
  progress: null,
  depth5Raw: null,
  traded24h: null,
  holders: null,
  holdersAtLeast: false,
}

const ENTRY: LaunchJournalEvent = {
  kind: 'LAUNCHED',
  at: AT,
  signature: SIG,
  actor: 'creator',
  pairRaw: null,
  tokensRaw: null,
  priceLow: null,
  priceHigh: null,
  soldBps: null,
  soldOf: null,
  enforcement: 'rule',
}

/**
 * A log read in part and holding more than it gives, on a market after the
 * DEX: a sale of the creator's over the supply, Ryntra's ladder moved up after
 * its emptying (one entry), the shared fees, an entry a later contract adds,
 * and the ladder there but not read now.
 */
const JOURNAL_PARTIAL: LaunchJournalResponse = {
  ...SAMPLE_JOURNAL,
  events: [
    {
      ...ENTRY,
      kind: 'CREATOR_SOLD',
      at: '2026-10-09T11:12:56.000Z',
      signature: SIG2,
      pairRaw: '4851364',
      tokensRaw: '989076589761',
      soldBps: 1250,
      soldOf: 'supply',
      enforcement: null,
    },
    {
      ...ENTRY,
      kind: 'FLOOR_RAISED',
      at: '2026-10-08T09:30:00.000Z',
      signature: SIG3,
      actor: 'ryntra',
      pairRaw: '91200000',
      priceLow: 0.0000781,
      priceHigh: 0.0000846,
      enforcement: 'policy',
    },
    {
      ...ENTRY,
      kind: 'FLOOR_WITHDRAWN',
      at: '2026-10-08T09:29:00.000Z',
      signature: SIG,
      actor: 'ryntra',
      pairRaw: '90400000',
      enforcement: 'policy',
    },
    { ...ENTRY, kind: 'SOMETHING_NEW' as LaunchJournalEvent['kind'], at: '2026-10-07T12:00:00.000Z', signature: SIG2 },
    { ...ENTRY, kind: 'FEES_SHARED', at: '2026-10-01T08:00:00.000Z', signature: SIG3 },
    ...SAMPLE_JOURNAL.events,
  ],
  total: 412,
  complete: false,
  floor: null,
  floorUnread: true,
}

/** The contract's examples were read at noon on 9 October: the samples are drawn as of then. */
const SAMPLE_NOW = Date.parse('2026-10-09T12:00:00.000Z')

export function LaunchMarketsSamples() {
  const locale = useLocale()
  const word = launchWords(locale)
  const [sheet, setSheet] = useState<'dex' | 'curve' | null>(null)
  const marks = (TOKEN.receipt?.marks ?? []).map((mark) => mark.code)
  return (
    <View className="gap-3">
      {[...SAMPLE_MARKETS.markets, ROW_UNREAD].map((row) => (
        <MarketCard
          key={row.token}
          row={row}
          word={word}
          locale={locale}
          now={SAMPLE_NOW}
          reading={false}
          onOpen={() => undefined}
        />
      ))}
      <MarketStateCard
        market={MARKET_DEX}
        health={SAMPLE_HEALTH_DEX}
        card={SAMPLE_MARKET_CARD}
        healthFailed={false}
        onRetry={() => undefined}
        word={word}
        locale={locale}
      />
      <MarketStateCard
        market={MARKET_DEX}
        health={HEALTH_PAUSED}
        card={SAMPLE_MARKET_CARD}
        healthFailed={false}
        onRetry={() => undefined}
        word={word}
        locale={locale}
      />
      <MarketStateCard
        market={MARKET_CURVE}
        health={SAMPLE_HEALTH_CURVE}
        card={null}
        healthFailed={false}
        onRetry={() => undefined}
        word={word}
        locale={locale}
      />
      <MarketStateCard
        market={MARKET_CURVE}
        health={null}
        card={null}
        healthFailed
        onRetry={() => undefined}
        word={word}
        locale={locale}
      />
      <RulesCard health={SAMPLE_HEALTH_DEX} marks={marks} word={word} locale={locale} />
      <JournalCard
        log={SAMPLE_JOURNAL}
        failed={false}
        onRetry={() => undefined}
        health={SAMPLE_HEALTH_DEX}
        symbol="EXOWL"
        word={word}
        locale={locale}
      />
      <JournalCard
        log={JOURNAL_PARTIAL}
        failed={false}
        stale
        onRetry={() => undefined}
        health={SAMPLE_HEALTH_DEX}
        symbol="EXOWL"
        word={word}
        locale={locale}
      />
      <JournalCard
        log={null}
        failed
        onRetry={() => undefined}
        health={null}
        symbol="EXOWL"
        word={word}
        locale={locale}
      />
      <Card padded={false}>
        <DoorRow
          icon="pulse-outline"
          label={word('healthTitle')}
          line={healthDoorLine(SAMPLE_HEALTH_DEX, false, word, locale)}
          onPress={() => setSheet('dex')}
        />
        <DoorRow
          icon="pulse-outline"
          label={word('healthTitle')}
          line={healthDoorLine(SAMPLE_HEALTH_CURVE, false, word, locale)}
          onPress={() => setSheet('curve')}
          last
        />
      </Card>
      <HealthSheet
        visible={sheet === 'dex'}
        onClose={() => setSheet(null)}
        health={SAMPLE_HEALTH_DEX}
        card={SAMPLE_MARKET_CARD}
        word={word}
        locale={locale}
      />
      <HealthSheet
        visible={sheet === 'curve'}
        onClose={() => setSheet(null)}
        health={SAMPLE_HEALTH_CURVE}
        card={null}
        word={word}
        locale={locale}
      />
    </View>
  )
}
