import { View } from 'react-native'

import { Card } from '@/components/card'
import { launchWords } from '@/features/launch/copy'
import type {
  LaunchClaimSubmitResponse,
  LaunchCreatorCabinetResponse,
  LaunchMarketResponse,
  LaunchTokenResponse,
} from '@/lib/api/v1/types'
import { useLocale } from '@/lib/i18n'

import { LaunchSuccess } from './launch-success'
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
    launches: 2,
    graduated: 0,
    unread: 1,
    amounts: [
      { pairMint: USDC.mint, symbol: 'USDC', decimals: 6, dollar: true, earnedRaw: '17240000', claimedRaw: '5230000' },
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
        markets={{ [MINT]: MARKET, [MINT2]: 'unread' }}
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
