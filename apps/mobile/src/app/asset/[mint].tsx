import { Redirect, useLocalSearchParams } from 'expo-router'

import { isInstant, isRuleId } from '@/features/autoinvest/rule-model'
import { isMint } from '@/lib/api'
import { AssetScreen } from '@/screens/asset'

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

/**
 * `/asset/<mint>` — a market by its address; anything else goes back to Markets. `buy=1` opens a company's
 * purchase; `rule=<id>&due=<instant>` opens the purchase under that autoinvest reminder; `autoinvest=1`
 * opens the company's «Автоінвест» sheet; `convert=1` opens the swap before the issuer's deadline and `sell=1` the
 * sale for USDC, where the token has such an event.
 */
export default function AssetRoute() {
  const params = useLocalSearchParams<{
    mint: string
    symbol?: string
    category?: string
    buy?: string
    rule?: string
    due?: string
    autoinvest?: string
    convert?: string
    sell?: string
  }>()
  const mint = first(params.mint)
  if (!isMint(mint)) return <Redirect href="/(tabs)" />
  const rule = first(params.rule)
  const due = first(params.due)
  return (
    <AssetScreen
      mint={mint}
      symbol={first(params.symbol)}
      category={first(params.category)}
      openBuy={first(params.buy) === '1'}
      reminder={isRuleId(rule) ? { ruleId: rule, dueAt: isInstant(due) ? due : null } : null}
      openAutoinvest={first(params.autoinvest) === '1'}
      openConvert={first(params.convert) === '1' ? 'swap' : first(params.sell) === '1' ? 'sell' : null}
    />
  )
}
