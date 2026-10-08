import {
  conditionBounds,
  priceFactsOf,
  referenceKindOf,
  type PriceConditionBounds,
  type PriceFacts,
} from '@/features/autoinvest/price-condition'
import { useCapabilities } from '@/features/plans/use-plans'
import { useStockAsset } from '@/hooks/use-market'
import type { RulePriceReference } from '@/lib/api'

/** «Умова ціни»'s bounds as the server's capabilities state them (1.18.0) — the contract's own until they are read. */
export function useConditionBounds(): PriceConditionBounds {
  const capabilities = useCapabilities()
  return conditionBounds(capabilities.data?.rules?.priceCondition)
}

export type ConditionRead = Readonly<{
  /** Whose figure the price is set against for this company; null when it has none — and no condition is offered. */
  reference: RulePriceReference | null
  facts: PriceFacts | null
  status: 'idle' | 'reading' | 'ready' | 'failed'
}>

/**
 * The facts a rule's price condition is judged on while a sheet shows it:
 * the company's row as `GET /api/stocks/asset` serves
 * it — the same read the order route judges on, shared with the company's
 * page — read again every half minute while `enabled`. A read that fails
 * keeps the last facts, which age into «stale» on their own: the sheet never
 * invents fresh ones.
 */
export function useConditionFacts(mint: string | null, enabled: boolean): ConditionRead {
  const stock = useStockAsset(enabled ? mint : null)
  if (!enabled || !mint) return { reference: null, facts: null, status: 'idle' }
  const read = stock.data
  if (!read) return { reference: null, facts: null, status: stock.isError ? 'failed' : 'reading' }
  const readAt = Date.parse(read.fetchedAt)
  return {
    reference: referenceKindOf(read.row),
    facts: priceFactsOf(read.row, Number.isFinite(readAt) ? readAt : null),
    status: 'ready',
  }
}
