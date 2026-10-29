import { View } from 'react-native'

import { Txt } from '@/components/txt'
import { SHEET_COPY, clockOf } from '@/features/trade/sheet-copy'
import { reviewView, SOL_ASSET, USDC_ASSET } from '@/features/trade/trade-model'
import type { SwapOrderCore } from '@/lib/api'
import { TRADE_COPY } from '@/features/trade/copy'
import { SIGNING_COPY } from '@/features/wallet/signing-copy'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'

import { CheckRows, DoneBody, SheetAction, ValidFor, WaitBody } from './sheet-parts'

/* Visibly synthetic: a sample order the gallery draws the sheet's steps on — never a real wallet or signature (M28). */
const SAMPLE_AT = '2026-10-17T12:00:00.000Z'
const SAMPLE_ORDER: SwapOrderCore = {
  requestId: 'sample-request',
  inputMint: USDC_ASSET.mint,
  outputMint: SOL_ASSET.mint,
  inAmountRaw: '25000000',
  outAmountRaw: '239537000',
  minReceivedRaw: '238339000',
  slippageBps: 50,
  priceImpactPct: '0.0002',
  router: 'jupiter',
  platformFee: { basisPoints: 50, mint: USDC_ASSET.mint },
  totalFeeBasisPoints: 50,
  ryntraFee: {
    mechanism: 'JUPITER_PLATFORM_FEE',
    state: 'APPLIED',
    basisPoints: 50,
    requestedBasisPoints: 50,
    asset: USDC_ASSET.mint,
    symbol: 'USDC',
    decimals: 6,
    amountRaw: '125000',
    usd: null,
  },
  signatureFeeLamports: '5000',
  priorityFeeLamports: '15000',
  rentFeeLamports: '0',
  inUsdValue: '25',
  outUsdValue: '24.97',
  swapUsdValue: '25',
  route: [{ label: 'Jupiter', basisPoints: 10000 }],
  taker: null,
  observedAt: SAMPLE_AT,
  reviewExpiresAt: SAMPLE_AT,
}

/** One step as the sheet draws it, framed like the sheet. */
function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-lg border border-line bg-elevated p-4">
      <Txt variant="title">{title}</Txt>
      {children}
    </View>
  )
}

/** The new look's sheet after the ticket (M44.3): «Перевірка», the wait for the wallet and «Готово» — on samples. */
export function SheetSamples() {
  const locale = useLocale()
  const words = useCopy(SHEET_COPY)
  const trade = useCopy(TRADE_COPY)
  const signing = useCopy(SIGNING_COPY)
  const shared = useSharedCopy()
  const view = reviewView(
    {
      order: SAMPLE_ORDER,
      mode: 'buy',
      pay: USDC_ASSET,
      receive: SOL_ASSET,
      decimals: { [USDC_ASSET.mint]: 6, [SOL_ASSET.mint]: 9 },
      exact: true,
    },
    locale,
  )
  return (
    <View className="gap-4">
      {view ? (
        <Step title={words.check}>
          <CheckRows view={view} what="Solana" />
          <ValidFor text={words.validFor(clockOf(30))} stale={false} />
          <SheetAction title={words.confirmInWallet} onPress={() => undefined} />
        </Step>
      ) : null}
      {/* The wallet's wait (M45): the Ledger line, ninety seconds, «Скасувати». */}
      <Step title={words.check}>
        <WaitBody sending={false} onCancel={() => undefined} />
      </Step>
      {/* Back in «Перевірка» after «Скасувати», after ninety seconds without an answer, after Ledger's 6808. */}
      <Step title={words.check}>
        <Txt variant="ui" tone="danger">
          {trade.failures.walletCancelled}
        </Txt>
        <SheetAction title={words.confirmInWallet} onPress={() => undefined} />
      </Step>
      <Step title={words.check}>
        <ValidFor text={words.stale} stale />
        <Txt variant="ui" tone="danger">
          {trade.failures.walletTimeout}
        </Txt>
        <SheetAction title={words.refreshCheck} variant="secondary" onPress={() => undefined} />
      </Step>
      {/* AG-2: the wallet answered after the bytes' ~30 s — built again by itself, then said plainly the second time. */}
      <Step title={words.check}>
        {view ? <CheckRows view={view} what="Solana" /> : null}
        <ValidFor text={words.validFor(clockOf(30))} stale={false} />
        <Txt variant="ui" tone="warning">
          {trade.failures.bytesRebuilt}
        </Txt>
        <SheetAction title={words.confirmInWallet} onPress={() => undefined} />
      </Step>
      {/* AG-2b: pressed while the Review renews its bytes — the wallet opens by itself once they are fresh. */}
      <Step title={words.check}>
        {view ? <CheckRows view={view} what="Solana" /> : null}
        <ValidFor text={words.renewingThenWallet} stale={false} />
        <SheetAction title={words.confirmInWallet} onPress={() => undefined} loading />
      </Step>
      <Step title={words.check}>
        <ValidFor text={words.validFor(clockOf(30))} stale={false} />
        <Txt variant="ui" tone="warning">
          {trade.failures.priceRenewed}
        </Txt>
        <SheetAction title={words.confirmInWallet} onPress={() => undefined} />
      </Step>
      <Step title={words.check}>
        <ValidFor text={words.stale} stale />
        <Txt variant="ui" tone="danger">
          {trade.failures.deviceConfirm}
        </Txt>
        <SheetAction title={words.refreshCheck} variant="secondary" onPress={() => undefined} />
      </Step>
      <Step title={words.check}>
        <Txt variant="ui" tone="danger">
          {trade.failures.ledgerBlind}
        </Txt>
        <SheetAction title={words.tryAgain} onPress={() => undefined} />
      </Step>
      {/* A sign-in the wallet did not sign: a Ledger may refuse the message (request 56 is still open). */}
      <Step title={shared.signIn}>
        <Txt variant="ui" tone="danger">
          {signing.signInRefused}
        </Txt>
      </Step>
      <Step title={words.check}>
        <WaitBody sending />
      </Step>
      <Step title={words.finish}>
        <DoneBody
          tone="done"
          title={words.done.buy}
          big="0,239537 SOL"
          line="25 USDC · 12:00"
          note={null}
          onReceipt={() => undefined}
        />
      </Step>
    </View>
  )
}
