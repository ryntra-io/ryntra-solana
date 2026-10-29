import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useHoldings } from '@/features/portfolio/use-portfolio'
import type { Prepared } from '@/features/trade/trade-flow'
import { USDC_ASSET, type TradeAsset } from '@/features/trade/trade-model'
import { useTrade } from '@/features/trade/use-trade'
import { useWallet } from '@/features/wallet/use-wallet'
import { useMarket } from '@/hooks/use-market'
import { SOL_MINT } from '@/lib/api'
import { useLocale } from '@/lib/i18n'

import { BUY_COPY } from './buy-copy'
import { buyCosts, unitsFromRaw, type IssuerFee } from './buy-model'
import {
  CONVERT_SHARES_PCT,
  convertAction,
  convertReviewRows,
  isConvert,
  rawDecimalText,
  shareRaw,
  type ConvertMode,
  type ConvertShare,
  type ListedPrice,
} from './conversion-watch'

/** The private token a swap or a sale takes from the wallet — named, drawn and counted as its page read it. */
export type ConvertToken = Readonly<{
  mint: string
  /** The token's symbol as the issuer names it («SPACEX»). */
  symbol: string
  /** The company, as a person names it. */
  name: string
  icon: string | null
  decimals: number | null
  /** The Scaled UI Amount multiplier in force (SPACEX ×5). */
  multiplier: number | null
  /** The fee the mint withholds on every transfer — PreStocks' 1 %; null when none. */
  issuerFee: IssuerFee | null
}>

/** The listed token a swap lands in, with what the Review says about it. */
export type ConvertInto = Readonly<{
  mint: string
  symbol: string
  company: string
  icon: string | null
  decimals: number | null
  multiplier: number | null
  /** The company's price the rate is said against; null while neither the exchange's nor the token's is read. */
  listed: ListedPrice | null
  /** What the listed token is, in its issuer's words. */
  truth: string | null
}>

const rawOf = (value: string | undefined): bigint | null => (value && /^\d+$/.test(value) ? BigInt(value) : null)

/**
 * The swap before the issuer's deadline, or the quiet sale, on the phone —
 * the sheet's state over Trade's own flow (M3: the server's exact Review, the
 * wallet's signature over those bytes, the one submission, the receipt, the
 * recovery of a signature the app closed on), as a Sell of the private token
 * into the listed one (or into USDC). This hook adds only what the sheet says
 * around it: how much of what the wallet holds — all, half, a quarter — what
 * that brings and costs from the live quote, the four rows of «Перевірка» and
 * the one action. A Review the app closed on comes back only when it is this
 * token's swap into this target.
 */
export function useConvert(token: ConvertToken, mode: ConvertMode, into: ConvertInto | null) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const wallet = useWallet()
  const swap = mode === 'swap' && into !== null

  /* ---- what the wallet holds of the token, and its SOL — the read Portfolio and Trade share ---- */
  const holdings = useHoldings(wallet.address)
  const read = holdings.data?.data ?? null
  const held = read?.holdings.find((holding) => holding.mint === token.mint) ?? null
  // A token account not seen is a zero only when the whole wallet was read.
  const heldRaw = !read ? null : held ? rawOf(held.spendableRaw) : read.tokenRead === 'COMPLETE' ? 0n : null
  const decimals = held?.decimals ?? token.decimals
  const multiplier = token.multiplier ?? held?.uiMultiplier ?? null
  const needsSol = read !== null && /^0+$/.test(read.lamports)

  /* ---- how much: all, half or a quarter, never rounded up ---- */
  const [share, setShare] = useState<ConvertShare>(100)
  const partRaw = shareRaw(heldRaw, share)
  const amountText = partRaw !== null && decimals !== null ? rawDecimalText(partRaw, decimals) : ''
  const giveUnits = partRaw !== null ? unitsFromRaw(partRaw.toString(), decimals, multiplier) : null
  // A share of a balance too small to be one is drawn but not offered.
  const shares = CONVERT_SHARES_PCT.map((pct) => ({ pct, offered: shareRaw(heldRaw, pct) !== null }))

  /* ---- Trade's own flow: a Sell of the token into the target (the compiler keeps these objects stable) ---- */
  const pay: TradeAsset = { mint: token.mint, symbol: token.symbol, name: token.name, icon: token.icon, decimals }
  const receive: TradeAsset = swap
    ? { mint: into.mint, symbol: into.symbol, name: into.company, icon: into.icon, decimals: into.decimals }
    : USDC_ASSET
  const restore = (prepared: Prepared) => isConvert(prepared.context, token.mint, receive.mint)
  const trade = useTrade({ mode: 'sell', legs: { pay, receive }, amountText, restore })

  /* ---- SOL's price, for the network fee said in dollars ---- */
  const sol = useMarket(SOL_MINT)
  const solUsd = sol.data?.market?.price ?? null

  /* ---- what the share brings and costs, from the live quote ---- */
  const quote = trade.quote
  const intoMultiplier = swap ? into.multiplier : null
  const feeBps = token.issuerFee?.basisPoints ?? null
  const inUsd = quote?.order.inUsdValue == null ? null : Number(quote.order.inUsdValue)
  const estimate = !quote
    ? null
    : {
        units: unitsFromRaw(quote.order.outAmountRaw, quote.decimals[receive.mint] ?? receive.decimals, intoMultiplier),
        costs:
          inUsd === null || !Number.isFinite(inUsd)
            ? null
            : buyCosts({
                spendUsd: inUsd,
                inUsdValue: quote.order.inUsdValue,
                outUsdValue: quote.order.outUsdValue,
                totalFeeBasisPoints: quote.order.totalFeeBasisPoints,
                issuerFeeBps: feeBps,
                priceImpactPct: quote.order.priceImpactPct,
                signatureFeeLamports: quote.order.signatureFeeLamports,
                priorityFeeLamports: quote.order.priorityFeeLamports,
                // The quote has no taker: whether an account is opened is known only on the exact order.
                rentFeeLamports: null,
                solUsd,
              }),
      }

  /* ---- «Перевірка»: the exact order in four rows ---- */
  const prepared = trade.prepared
  const listed = into?.listed ?? null
  const company = into?.company ?? token.name
  const words = BUY_COPY[locale]
  const rows = !prepared
    ? null
    : convertReviewRows({
        mode: swap ? 'swap' : 'sell',
        order: prepared.order.order,
        token: { symbol: token.symbol, multiplier },
        giveDecimals: prepared.context.payDecimals,
        getDecimals: prepared.context.receiveDecimals,
        target: swap
          ? { mint: into.mint, symbol: into.symbol, company: into.company, multiplier: into.multiplier }
          : null,
        listed,
        company,
        issuerFee: token.issuerFee,
        solUsd,
        locale,
        words: { atLeast: words.atLeast, reserve: words.reserve, issuerFee: words.issuerFee },
      })

  /* ---- the one action ---- */
  const action = convertAction({
    lockedReview: trade.lockedReview !== null,
    connected: trade.account.address !== null,
    signedIn: trade.account.session !== null,
    heldRaw,
    decimalsKnown: decimals !== null,
    preparing: trade.phase === 'preparing',
    needsSol,
    unavailable: trade.quoteBlocked || (trade.quoteFailure !== null && !trade.quoteFailure.retryable),
    priced: trade.quote !== null && trade.amountRaw !== null && trade.amountRaw === trade.typedRaw,
  })

  /* ---- after a fill the wallet is read again, so the page, Home and Portfolio show what arrived ---- */
  const address = trade.account.address
  const settledAt = trade.settled?.at ?? null
  useEffect(() => {
    if (!settledAt || !address) return
    void queryClient.invalidateQueries({ queryKey: ['trade', 'holdings', address] })
  }, [settledAt, address, queryClient])

  return {
    trade,
    locale,
    mode: (swap ? 'swap' : 'sell') as ConvertMode,
    receive,
    share,
    pickShare: setShare,
    shares,
    /** What the wallet holds of the token, raw; null while it is not read. */
    heldRaw,
    /** The share on screen in the unit the wallet shows; null while nothing is held or read. */
    giveUnits,
    multiplier,
    /** The listed token's multiplier, for what a swap brings; null for a sale. */
    intoMultiplier,
    decimals,
    needsSol,
    estimate,
    rows,
    action,
  }
}

export type ConvertController = ReturnType<typeof useConvert>
