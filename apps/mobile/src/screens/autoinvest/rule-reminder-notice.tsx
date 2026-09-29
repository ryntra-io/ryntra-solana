import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import { purchaseSumUsd, reminderOffer, ruleForMint, rulePurchaseParams } from '@/features/autoinvest/rule-model'
import { useRules } from '@/features/autoinvest/use-rules'
import { dollarsText } from '@/features/invest/buy-model'
import { useNow } from '@/hooks/use-now'
import type { Session } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'

/**
 * Trade's line while a rule's reminder is open for the asset a Buy receives
 * (canon v5.3 В29; M20): «Нагадування правила відкрите · $20», a purchase
 * here does not close it — the rule counts only a purchase by the rule — and
 * the way to that purchase: «Купити $20 за правилом →», the company's page
 * with the purchase bound to the rule. The rules are the wallet's, read
 * behind its session; the ticket, its figures and its path do not change. A
 * line, never a second orange action.
 */
export function RuleReminderNotice({ session, mint }: { session: Session; mint: string | null }) {
  const router = useRouter()
  const copy = useCopy(AUTOINVEST_COPY)
  const locale = useLocale()
  const now = useNow(30_000)
  const rules = useRules(session)
  const rule = mint && rules.data ? ruleForMint(rules.data.rules, mint) : null
  const due = reminderOffer(rule, rules.data?.budget ?? null, now)
  if (!rule || !due) return null
  // The reminder's own sum (1.19.0) — what a «З оплат» rule gathered; the rule's sum for the other kinds.
  const usd = dollarsText(purchaseSumUsd(rule, due), locale)
  const buyByRule = () =>
    router.push({
      pathname: '/asset/[mint]',
      params: rulePurchaseParams({
        mint: rule.asset.mint,
        symbol: rule.asset.symbol,
        ruleId: rule.id,
        dueAt: due.dueAt,
      }),
    })
  return (
    <View className="gap-1.5 rounded-sm border border-line bg-surface px-4 py-3">
      <View className="flex-row items-center gap-1.5">
        <Icon name="time-outline" size={14} color="brand" />
        <Txt variant="ui" tabular className="shrink">
          {`${copy.reminderOpenHere} · ${usd}`}
        </Txt>
      </View>
      <Txt variant="ui" tone="muted">
        {copy.plainHereLeavesOpen}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.buyByRule(usd)}
        onPress={buyByRule}
        hitSlop={8}
        className="flex-row items-center gap-1 self-start py-1 active:opacity-70"
      >
        <Txt variant="ui" tone="fg" style={{ textDecorationLine: 'underline' }}>
          {copy.buyByRule(usd)}
        </Txt>
        <Icon name="arrow-forward" size={14} color="fg" />
      </Pressable>
    </View>
  )
}
