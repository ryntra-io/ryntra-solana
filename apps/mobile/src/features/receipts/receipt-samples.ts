/**
 * Receipts as the development gallery draws them — one of every kind, from
 * the contract's own shapes, with made-up but well-formed figures. The
 * screens never read this; nothing here is a person's record.
 */

import type { WalletAction } from '../../lib/api.ts'
import type { Locale } from '../../lib/i18n.ts'
import { HISTORY_COPY } from '../history/copy.ts'
import { historyRow, historyTitle } from '../history/history-model.ts'
import { launchWords } from '../launch/copy.ts'
import { SAMPLE_JOURNAL } from '../launch/market-samples.ts'
import { RECEIPTS_COPY } from './copy.ts'
import {
  docFromClaim,
  docFromClaimResult,
  docFromHistory,
  docFromJournal,
  docFromLaunch,
  docFromLaunchTrade,
  docFromSend,
  docFromSwap,
  type ReceiptDoc,
} from './receipt-doc.ts'

const WALLET = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
const RECIPIENT = 'rEGbG2sq7PYPyFQy6Z7V3qytZDdurrvxihf8zQ7Laax'
const MINT = '7SKYne72sKvopLugvb4ibrpy1goHYAfRo68Q67A1vVDw'
const SOL = 'So11111111111111111111111111111111111111112'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDC = { mint: USDC_MINT, symbol: 'USDC', decimals: 6, dollar: true }
const SIG = (n: number) => `sample${n}YSVkFJC5xYEJj3WwwxW5yB9c2djidUa7R8GUGedJ55Sf6DtajHGyLnBNjAbxr7Wz`
const at = (hours: number) => new Date(Date.parse('2026-10-10T12:00:00.000Z') - hours * 3_600_000).toISOString()

function action(over: Partial<WalletAction> & Pick<WalletAction, 'actionId'>): WalletAction {
  return {
    lane: 'SWAP',
    outcome: 'DONE',
    out: { mint: USDC_MINT, amountRaw: '25000000', decimals: 6, symbol: 'USDC' },
    in: { mint: SOL, amountRaw: '123456789', decimals: 9, symbol: 'SOL' },
    destination: 'SOLANA',
    signature: over.actionId,
    fee: {
      collected: true,
      basisPoints: 50,
      amountRaw: '125000',
      decimals: 6,
      symbol: 'USDC',
      usd: 0.125,
      asset: USDC_MINT,
    },
    origin: { surface: 'SPOT', side: 'BUY' },
    startedAt: at(1),
    updatedAt: at(1),
    ...over,
  }
}

/** One receipt of every kind the phone shares, newest first. */
export function sampleDocs(locale: Locale): ReceiptDoc[] {
  const copy = RECEIPTS_COPY[locale]
  const history = HISTORY_COPY[locale]
  const fromHistory = (value: WalletAction) => {
    const row = historyRow(value, locale)
    return docFromHistory(row, historyTitle(row, history.words))
  }
  const context = {
    mode: 'swap' as const,
    pay: { mint: SOL, symbol: 'SOL', name: 'Solana', decimals: 9 },
    receive: { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    payDecimals: 9,
    receiveDecimals: 6,
    inAmountRaw: '20000000',
    outAmountRaw: '1900000',
    minReceivedRaw: '1890000',
  }
  const quote = {
    venue: 'curve' as const,
    side: 'buy' as const,
    amountInRaw: '10000000',
    amountOutRaw: '5000000000',
    minimumOutRaw: '4900000000',
    amountLeftRaw: '0',
    slippageBps: 100,
    feeBps: 100,
    fee: { totalRaw: '100000', creatorRaw: '40000', ryntraRaw: '20000', meteoraRaw: '40000', liquidityRaw: null },
    priceMoveBps: 10,
    marketCapAfter: { raw: '0' } as never,
    referral: true,
    observedAt: at(3),
  }
  const word = launchWords(locale)
  const journal = SAMPLE_JOURNAL.events
    .slice(0, 3)
    .map((entry) => docFromJournal(entry, SAMPLE_JOURNAL, 'COMM', word, locale))
  return [
    fromHistory(action({ actionId: SIG(1) })),
    fromHistory(
      action({
        actionId: SIG(2),
        out: { mint: SOL, amountRaw: '50000000', decimals: 9, symbol: 'SOL' },
        in: { mint: USDC_MINT, amountRaw: '4801234', decimals: 6, symbol: 'USDC' },
        origin: { surface: 'SPOT', side: 'SELL' },
        startedAt: at(2),
      }),
    ),
    docFromSwap(
      {
        title: copy.kinds.swap,
        status: 'done',
        settlement: {
          state: 'MATCHED',
          signature: SIG(3),
          observation: { actualInputRaw: '20000000', actualOutputRaw: '1921719' },
          facts: {
            reconciliation: { state: 'MATCHED' },
            fees: {
              serviceFee: {
                mechanism: 'JUPITER_REFERRAL',
                state: 'COLLECTED',
                basisPoints: 50,
                requestedBasisPoints: 50,
                asset: USDC_MINT,
                symbol: 'USDC',
                decimals: 6,
                amountRaw: '9608',
                usd: null,
              },
            },
          },
          receipt: null,
        },
        context: context as never,
        at: at(2.5),
      },
      locale,
    ),
    docFromLaunchTrade(
      {
        token: MINT,
        symbol: 'THUMB',
        tokenDecimals: 6,
        pair: USDC,
        quote,
        submit: { signature: SIG(4), state: 'CONFIRMED', filled: { tokensRaw: '5010000000', pairRaw: '10000000' } },
        title: copy.launchBought('THUMB'),
        at: at(3),
      },
      locale,
    ),
    docFromClaim(
      {
        token: MINT,
        name: 'Thumb',
        symbol: 'THUMB',
        signature: SIG(5),
        at: at(4),
        pair: USDC,
        paid: { curve: '3000000', graduation: '0', lp: '1500000' },
        vaultPaidRaw: null,
        receivedRaw: '4500000',
      },
      copy.claimed('THUMB'),
      locale,
    ),
    docFromClaimResult(
      {
        token: MINT,
        symbol: 'THUMB',
        pair: USDC,
        kind: 'partial',
        receivedRaw: 1200000n,
        intoVaultRaw: null,
        signature: SIG(6),
        title: copy.claimed('THUMB'),
        at: at(4.5),
      },
      locale,
    ),
    docFromLaunch(
      {
        network: 'solana:mainnet',
        token: MINT,
        name: 'Thumb',
        symbol: 'THUMB',
        creator: WALLET,
        launchedAt: at(6),
        signature: SIG(7),
        receipt: {
          creator: WALLET,
          created: { signature: SIG(7), slot: 1, at: at(6) },
          creatorFirstBuy: { quoteInRaw: '1000000', tokensOutRaw: '197960754204', capRaw: '1' },
          token2022: { decimals: 6 },
          feeSharing: { vault: RECIPIENT, shares: [{ address: WALLET, bps: 10000 }] },
        },
      } as never,
      USDC,
      copy.launched('THUMB'),
      locale,
    ),
    docFromSend(
      {
        outcome: 'sent',
        result: {
          ok: true,
          state: 'RECEIPTED',
          signature: SIG(8),
          sendReceiptFacts: {
            mint: USDC_MINT,
            sender: WALLET,
            recipient: RECIPIENT,
            transferFeeRaw: '0',
            actualBaseFeeLamports: '5000',
            actualPriorityFeeLamports: '1200',
            ataRentLamports: '2039280',
          },
        } as never,
        signature: SIG(8),
        amount: '1.000000',
        symbol: 'USDC',
        title: history.words.sent('USDC'),
        at: at(8),
      },
      locale,
    ),
    fromHistory(
      action({
        actionId: SIG(9),
        outcome: 'FAILED',
        in: null,
        fee: null,
        startedAt: at(9),
      }),
    ),
    ...journal,
  ]
}
