import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'

import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import { isListedToken } from '@/features/autoinvest/floor'
import { purchaseSumUsd, reminderOffer, ruleBuyRouteOf, ruleForMint } from '@/features/autoinvest/rule-model'
import { useRules } from '@/features/autoinvest/use-rules'
import { dollarsText } from '@/features/invest/buy-model'
import { useNow } from '@/hooks/use-now'
import type { RuleBinding, Session } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'

/**
 * Trade's line while a rule's reminder is open for the asset a Buy receives:
 * «Нагадування правила відкрите · $20», a purchase
 * here does not close it — the rule counts only a purchase by the rule — and
 * the way to that purchase: «Купити $20 за правилом →», the company's page
 * with the purchase bound to the rule. The rules are the wallet's, read
 * behind its session; the ticket, its figures and its path do not change. A
 * line, never a second orange action. On a token of the venue's list (1.31.0)
 * the rule's purchase is this same ticket: `onBuy` turns it into the purchase
 * in place; a company's stays on its page.
 */
export function RuleReminderNotice({
  session,
  mint,
  onBuy,
}: {
  session: Session
  mint: string | null
  onBuy?: (binding: RuleBinding) => void
}) {
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
  const buyByRule = () => {
    if (onBuy && isListedToken(rule.asset)) onBuy({ ruleId: rule.id, dueAt: due.dueAt })
    else router.push(ruleBuyRouteOf(rule, due.dueAt) as never)
  }
  return (
    <View className="gap-1.5 rounded-sm border border-line bg-surface px-4 py-3">
      <View className="flex-row items-center gap-1">
        <Icon name="time-outline" size={14} color="brand" />
        <Txt variant="ui" tabular className="shrink">
          {`${copy.reminderOpenHere} · ${usd}`}
        </Txt>
        {/* A purchase here does not close the reminder — said one tap deep, never as a line in the ticket. */}
        <HelpDot title={copy.reminderOpenHere} body={copy.plainHereLeavesOpen} />
      </View>
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
