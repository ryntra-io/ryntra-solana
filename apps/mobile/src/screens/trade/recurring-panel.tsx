import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/button'
import { HelpDot } from '@/components/help-dot'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import { ruleBuyRouteOf, ruleForMint } from '@/features/autoinvest/rule-model'
import { useRuleAsset } from '@/features/autoinvest/use-rule-asset'
import { useRules } from '@/features/autoinvest/use-rules'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { useShelfNames } from '@/features/invest/use-shelf'
import { useAccount } from '@/features/session/use-account'
import { RULE_TICKET_COPY } from '@/features/trade/rule-ticket'
import type { TradeAsset } from '@/features/trade/trade-model'
import { fetchMarketsByMints, type RuleBinding } from '@/lib/api'
import { useCopy } from '@/lib/i18n'
import { AutoinvestPanel } from '@/screens/autoinvest/autoinvest-sheet'
import { BudgetSheet } from '@/screens/autoinvest/budget-sheet'

/**
 * «Регулярно» in Trade: the rule on the ticket's token,
 * beside «Ринок» — written here when there is none, managed here when there is
 * one, its floor and facts of risk before the button (`AutoinvestPanel`). A
 * guest gets the way in, what a rule does behind «?» (ST-4); the wallet's rules are read
 * behind its session. A token's open reminder is bought on this ticket
 * (`onBuyUnderRule`); a company's on its own page, where its purchase is. A
 * token no rule can name offers the market order beside its reason.
 */
export function RecurringPanel({
  asset,
  onBuyUnderRule,
  onMarket,
}: {
  asset: TradeAsset
  onBuyUnderRule: (binding: RuleBinding) => void
  onMarket: () => void
}) {
  const router = useRouter()
  const words = useCopy(RULE_TICKET_COPY)
  const ruleCopy = useCopy(AUTOINVEST_COPY)
  const buyWords = useCopy(BUY_COPY)
  const account = useAccount()
  const session = account.session
  const rules = useRules(session)
  const nameOf = useShelfNames()
  const [budgetOpen, setBudgetOpen] = useState(false)
  // The token's market row — the same read the ticket made: whether it is a company, and its price for a fall's rule.
  const row = useQuery({
    queryKey: ['trade', 'asset', asset.mint],
    queryFn: ({ signal }) => fetchMarketsByMints([asset.mint], signal),
    staleTime: 60_000,
    retry: 1,
  })
  const market = row.data?.rows.find((candidate) => candidate.mint === asset.mint) ?? null
  /* Whether it is a company or a token is the server's own word (`class`, 1.31.0) — the same read the rule's sheet makes;
     the market's category stands in only while it is read, and only where it names one. */
  const standing = useRuleAsset(asset.mint, session !== null)
  const category = market?.category ?? null
  const token: boolean | null = standing.read
    ? standing.read.class !== 'stock'
    : category === 'stock'
      ? false
      : category === 'crypto' || category === 'meme'
        ? true
        : standing.status === 'reading' || standing.status === 'idle'
          ? null
          : true

  if (!session) {
    return (
      <View className="gap-3 rounded-sm border border-line bg-surface p-4">
        <View className="flex-row items-center gap-1">
          <Txt variant="ui" tone="muted" className="shrink">
            {words.recurring}
          </Txt>
          <HelpDot title={words.recurring} body={words.recurringGuest} />
        </View>
        {account.address ? (
          <Button
            title={buyWords.signIn}
            size="lg"
            loading={account.signingIn}
            onPress={() => void account.signIn()}
          />
        ) : (
          <Button
            title={buyWords.connect}
            size="lg"
            loading={account.busy === 'connect'}
            onPress={() => void account.connect()}
          />
        )}
      </View>
    )
  }
  /* No rule can name the token — the server's word: refused outright, or a market no read knows at all. Said, with the
     one next step — the market order. A token the server can name stands on its read even where the market row is
     missing. */
  const unnamed =
    standing.status === 'refused' || (row.data !== undefined && !market && standing.status === 'failed')
  if (unnamed) {
    return (
      <View className="items-start gap-2 rounded-sm border border-line bg-surface p-4">
        {/* Refused is the server's «no»; both reads failed is only unknown — said so, with the way to read again. */}
        <Txt variant="ui" tone="muted">
          {standing.status === 'refused' ? ruleCopy.noRuleOnToken : ruleCopy.tokenUnreadable}
        </Txt>
        <View className="flex-row flex-wrap gap-2">
          {standing.status === 'refused' ? null : (
            <Button
              title={ruleCopy.tryAgain}
              variant="secondary"
              size="sm"
              loading={standing.refetching}
              onPress={() => {
                standing.refetch()
                void row.refetch()
              }}
            />
          )}
          <Button title={ruleCopy.buyAtMarket} variant="secondary" size="sm" onPress={onMarket} />
        </View>
      </View>
    )
  }
  const priceUsd = market?.price ?? standing.read?.priceUsd ?? null
  const ready = market !== null || standing.read !== null
  if (!rules.data || !ready || token === null) {
    return rules.isError || (row.isError && !standing.read) ? (
      <View className="items-start gap-2 rounded-sm border border-line bg-surface p-4">
        <Txt variant="ui" tone="muted">
          {words.rulesDown}
        </Txt>
        <Button
          title={buyWords.tryAgain}
          variant="secondary"
          size="sm"
          onPress={() => {
            void rules.refetch()
            void row.refetch()
          }}
        />
      </View>
    ) : (
      <View className="gap-2" accessibilityRole="progressbar" accessibilityLabel={words.readingRule}>
        <Skeleton className="h-10 rounded-pill" />
        <Skeleton className="h-24 rounded-sm" />
      </View>
    )
  }

  const rule = ruleForMint(rules.data.rules, asset.mint)
  return (
    <>
      <AutoinvestPanel
        mode={rule ? { kind: 'manage', rule } : { kind: 'compose', amountUsd: null }}
        company={{
          mint: asset.mint,
          // A token's rule is named by its symbol (1.31.0); a company by the name a person knows it by.
          name: token ? asset.symbol : (nameOf(asset.mint) ?? asset.name),
          icon: asset.icon,
          preIpo: false,
          truth: null,
          priceUsd,
          token,
        }}
        budget={rules.data.budget}
        onClose={onMarket}
        onBuyNow={(owned, occurrence) => {
          if (token) onBuyUnderRule({ ruleId: owned.id, dueAt: occurrence.dueAt })
          else router.push(ruleBuyRouteOf(owned, occurrence.dueAt) as never)
        }}
        onChangeBudget={() => setBudgetOpen(true)}
        onMarketBuy={onMarket}
      />
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />
    </>
  )
}
