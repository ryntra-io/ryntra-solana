import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { useHoldings } from '@/features/portfolio/use-portfolio'
import type { Prepared } from '@/features/trade/trade-flow'
import { USDC_ASSET, type TradeAsset } from '@/features/trade/trade-model'
import { useTrade } from '@/features/trade/use-trade'
import { useWallet } from '@/features/wallet/use-wallet'
import { useMarket, useStockAsset } from '@/hooks/use-market'
import { useLocale } from '@/lib/i18n'
import { isSupportedIssuer } from '@/lib/stocks'

import { BUY_COPY } from './buy-copy'
import { SALE_COPY } from './sale-copy'
import {
  amountFieldInput,
  amountFieldText,
  issuerFeeOf,
  parseDollars,
  ryntraFeeFigures,
  truthLine,
  unitsFromRaw,
} from './buy-model'
import {
  isCompanySale,
  isWholePosition,
  MIN_SALE_USD,
  openingSaleUsd,
  positionUsd,
  rawForUsd,
  saleAction,
  saleAmountText,
  saleCheckRows,
  saleOrderRows,
  saleShareRaw,
  saleShares,
  shareUsd,
  type SaleCompany,
  type SalePct,
} from './sale-model'
import { companyDisplayName } from './shelf'

const rawOf = (value: string | undefined): bigint | null => (value && /^\d+$/.test(value) ? BigInt(value) : null)

/** What the sheet knows of the company before its read answers — the list's or the page's name and icon. */
export type SaleHint = Readonly<{ name: string; icon: string | null; ticker: string }>

/**
 * The company as its sale needs it, read the way its page reads it — the
 * issuer's confirmed representation, its decimals and multiplier, the token's
 * truth and fee, its price, whether its issuer halted trading. Null while the
 * read is on its way; `failed` when it could not be read.
 */
export function useSaleCompany(mint: string, hint: SaleHint) {
  const locale = useLocale()
  const market = useMarket(mint)
  const stock = useStockAsset(mint)
  const detail = market.data?.market ?? null
  const asset = stock.data ?? null
  let company: SaleCompany | null = null
  const rep = asset?.row.representation ?? null
  // A price still being read is a read, not a company that cannot be sold.
  const pricePending = asset !== null && asset.row.market.priceUsd == null && market.isPending
  if (asset && rep && isSupportedIssuer(rep.issuer.id) && !pricePending) {
    // The company as a person names it — never the token's catalogue name a Portfolio row carries.
    const preIpo = rep.instrument?.class === 'pre-ipo'
    const name = companyDisplayName(rep.underlying.name ?? rep.name, preIpo ? null : rep.underlying.symbol)
    const onchain = 'error' in asset.onchain ? null : asset.onchain
    const listed = asset.row.market.priceUsd ?? detail?.price ?? null
    const price = typeof listed === 'number' && Number.isFinite(listed) && listed > 0 ? listed : null
    const feeBps = asset.row.transferFee?.basisPoints ?? null
    company = {
      mint,
      ticker: detail?.symbol ?? hint.ticker,
      name,
      icon: detail?.icon ?? hint.icon,
      decimals: onchain?.decimals ?? detail?.decimals ?? null,
      multiplier: asset.chainMultiplier?.current ?? asset.row.multiplier?.current ?? null,
      unit: rep.instrument?.unitBasis === 'token' ? 'token' : 'share',
      preIpo,
      truth: truthLine(rep.issuer.id, name, locale, feeBps),
      issuerFee: issuerFeeOf(asset.row.transferFee),
      priceUsd: price,
      sellable: rep.tradingHalted !== true && price !== null,
    }
  }
  // An issuer Ryntra no longer supports is not sold here: said as a company that could not be read, never a wait.
  return {
    company,
    failed: (stock.isError && !asset) || (asset !== null && company === null),
    retry: () => void stock.refetch(),
  }
}

/**
 * One sale from a position on the phone — the sheet's state over Trade's own
 * flow (the server's exact Review, the wallet's signature over those bytes,
 * the one submission, the receipt, the recovery of a signature the app closed
 * on), as a Sell of the company's token into USDC. This hook adds only what the
 * sheet says around it: the sum in dollars or a share of the position, what it
 * brings and costs from the live quote, the four rows of «Перевірка» as the
 * server counts them, and the one action. A Review the app closed on comes back
 * only when it is this company's sale.
 */
export function useSale(company: SaleCompany) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const wallet = useWallet()

  /* ---- what the wallet holds of the company, and its SOL — the read Portfolio and Trade share ---- */
  const holdings = useHoldings(wallet.address)
  const read = holdings.data?.data ?? null
  const held = read?.holdings.find((holding) => holding.mint === company.mint) ?? null
  // A token account not seen is a zero only when the whole wallet was read.
  const heldRaw = !read ? null : held ? rawOf(held.spendableRaw) : read.tokenRead === 'COMPLETE' ? 0n : null
  const decimals = company.decimals ?? held?.decimals ?? null
  const multiplier = company.multiplier ?? held?.uiMultiplier ?? null
  const price = company.priceUsd
  const valueUsd = positionUsd(heldRaw, decimals, multiplier, price)
  const needsSol = read !== null && /^0+$/.test(read.lamports)

  /* ---- the sum: dollars typed, or a share of the position — 100 % is exactly what the wallet holds ---- */
  // Until the person types or picks, the field stands on the opening sum: $10 for a position worth that much.
  const [typed, setTyped] = useState<string | null>(null)
  const [pickedPct, setPickedPct] = useState<SalePct | null>(null)
  /* The price a typed sum is counted at, fixed when the sum is set: the live price ticks every half minute, and a sum
     re-counted on each tick would leave the button waiting for a new quote just as the person presses it. */
  const [sumPrice, setSumPrice] = useState<number | null>(null)
  if (sumPrice === null && price !== null) setSumPrice(price)
  const countAt = sumPrice ?? price
  // The position at that same price: what the field, the whole-position test and the button all count against.
  const countValue = positionUsd(heldRaw, decimals, multiplier, countAt)
  const opening = openingSaleUsd(countValue)
  const amountText = typed ?? (opening !== null ? amountFieldText(opening, locale) : '')
  const amountUsd = parseDollars(amountText, locale)
  const shares = saleShares(heldRaw, decimals, multiplier, countAt)
  // A picked share as dollars at a price: the whole position to the cent, a part never rounded up.
  const pickedText = (pct: SalePct, at: number | null): string => {
    const usd =
      pct === 100 ? positionUsd(heldRaw, decimals, multiplier, at) : shareUsd(heldRaw, decimals, multiplier, at, pct)
    return usd !== null ? amountFieldText(usd, locale) : ''
  }
  // A sum under the minimum asks for no price — unless it is the whole position, which may be less than a dollar.
  const underMinimum =
    pickedPct === null &&
    amountUsd !== null &&
    amountUsd < MIN_SALE_USD &&
    !(countValue !== null && isWholePosition(amountUsd, countValue))
  const saleRaw =
    heldRaw === null || underMinimum || !company.sellable
      ? null
      : pickedPct !== null
        ? saleShareRaw(heldRaw, pickedPct)
        : rawForUsd(amountUsd, heldRaw, decimals, multiplier, countAt)

  /* ---- Trade's own flow: a Sell of the company into USDC ---- */
  // The compiler keeps these objects stable between renders.
  const pay: TradeAsset = {
    mint: company.mint,
    symbol: company.ticker,
    name: company.name,
    icon: company.icon,
    decimals,
  }
  const legs = { pay, receive: USDC_ASSET }
  const restore = (prepared: Prepared) => isCompanySale(prepared.context, company.mint)
  const trade = useTrade({ mode: 'sell', legs, amountText: saleAmountText(saleRaw, decimals), restore })
  // A price that has moved more than 1 % is taken afresh while nothing is under way — never under an open Review.
  if (
    price !== null &&
    sumPrice !== null &&
    Math.abs(price / sumPrice - 1) > 0.01 &&
    trade.phase === 'idle' &&
    !trade.busy
  ) {
    setSumPrice(price)
    // A picked share keeps saying its own sum at the new price.
    if (pickedPct !== null) setTyped(pickedText(pickedPct, price))
  }

  /* ---- what the sum brings and costs, from the live quote — the server's count when it gives one ---- */
  const quote = trade.quote
  const quoteCheck = quote?.check ?? null
  const estimate = !quote
    ? null
    : {
        gotUsd: quoteCheck?.get.amount ?? unitsFromRaw(quote.order.outAmountRaw, USDC_ASSET.decimals, null),
        costsUsd: quoteCheck?.costs?.usd ?? null,
      }

  /* ---- «Перевірка»: the exact order in four rows ---- */
  const prepared = trade.prepared
  const words = BUY_COPY[locale]
  const rowWords = {
    atLeast: words.atLeast,
    reserve: words.reserve,
    issuerFee: words.issuerFee,
    ryntraFee: words.ryntraFee,
    truthUnknown: words.truthUnknown,
    mayFail: SALE_COPY[locale].saleMayFail,
  }
  const orderCheck = prepared?.order.check ?? null
  // Ryntra's own fee on the exact order, said inside «Усі витрати» beside the issuer's, as the web says it.
  const ryntraFee = ryntraFeeFigures(prepared?.order.order, locale)
  const rows = !prepared
    ? null
    : orderCheck
      ? saleCheckRows(orderCheck, { unit: company.unit, company: company.name, locale, words: rowWords, ryntraFee })
      : saleOrderRows({
          order: prepared.order.order,
          payDecimals: prepared.context.payDecimals,
          receiveDecimals: prepared.context.receiveDecimals,
          multiplier,
          unit: company.unit,
          company: company.name,
          truth: company.truth,
          preIpo: company.preIpo,
          issuerFee: company.issuerFee,
          ryntraFee,
          locale,
          words: rowWords,
        })

  /* ---- the one action ---- */
  const action = saleAction({
    lockedReview: trade.lockedReview !== null,
    connected: trade.account.address !== null,
    signedIn: trade.account.session !== null,
    heldRaw,
    companyRead: decimals !== null,
    sellable: company.sellable,
    valueUsd: countValue,
    amountUsd,
    pickedPct,
    preparing: trade.phase === 'preparing',
    needsSol,
    unavailable: trade.quoteBlocked || (trade.quoteFailure !== null && !trade.quoteFailure.retryable),
    priced: trade.quote !== null && trade.amountRaw !== null && trade.amountRaw === trade.typedRaw,
  })

  /* ---- after a fill the wallet is read again, so the page, Home and Portfolio show what is left ---- */
  const address = trade.account.address
  const settledAt = trade.settled?.at ?? null
  useEffect(() => {
    if (!settledAt || !address) return
    void queryClient.invalidateQueries({ queryKey: ['trade', 'holdings', address] })
  }, [settledAt, address, queryClient])

  const pickShare = (pct: SalePct) => {
    setPickedPct(pct)
    setSumPrice(price)
    setTyped(pickedText(pct, price))
  }

  return {
    trade,
    locale,
    amountText,
    setAmountText: (text: string) => {
      // One decimal mark and cents at most; a refused key leaves the field — and a picked share — as they were (ST-5).
      const next = amountFieldInput(amountText, text, 2, locale)
      if (next === amountText) return
      setPickedPct(null)
      setSumPrice(price)
      setTyped(next)
    },
    amountUsd,
    shares,
    pickedPct,
    pickShare,
    /** What the wallet holds of the company, raw; null while it is not read. */
    heldRaw,
    decimals,
    multiplier,
    /** The position at the price the sum is counted at — the one figure the sheet says. */
    valueUsd: countValue,
    needsSol,
    estimate,
    rows,
    action,
  }
}

export type SaleController = ReturnType<typeof useSale>
