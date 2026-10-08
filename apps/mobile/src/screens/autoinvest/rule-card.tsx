import { Pressable, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import { floorHeld, floorLine } from '@/features/autoinvest/floor'
import { deferralLine } from '@/features/autoinvest/price-condition'
import { missedOf, purchaseSumUsd, ruleFace, zoneOfRule } from '@/features/autoinvest/rule-model'
import {
  dayWords,
  dueWords,
  gatheredLine,
  keptTail,
  priceWord,
  ruleWhenLine,
  unbroken,
  unbrokenParts,
  unbrokenTail,
  wholeParts,
} from '@/features/autoinvest/words'
import { dollarsText } from '@/features/invest/buy-model'
import type { AutoinvestRule, RuleBudget } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'

/**
 * A company's rule in «Автоінвест»'s place under «Купити» ( * M16): how much and how often, and what comes next — the next purchase, the
 * pause, the month's budget holding it, or, while its reminder is open, «Час
 * твоєї покупки». A purchase the price condition holds back says «Купівлю
 * відкладено · правило перевірить знову» with why under it — the reason, the
 * figure and the data's time. A «З оплат» rule reads «Автоінвест · З
 * оплат» with its terms and what it has gathered — «Накопичено $0,60 ·
 * нагадаю від $1» — and its open reminder the sum it gathered. A
 * reminder that passed without a signature says «Пропущено» once and is never
 * caught up. One tap opens the rule, or buys the open reminder.
 */
export function RuleCard({
  rule,
  budget,
  now,
  onPress,
}: {
  rule: AutoinvestRule
  budget: RuleBudget | null
  now: number
  onPress: () => void
}) {
  const copy = useCopy(AUTOINVEST_COPY)
  const locale = useLocale()
  const face = ruleFace(rule, budget, now)
  const zone = zoneOfRule(rule)
  const usd = dollarsText(rule.amountUsd, locale)
  const last = missedOf(rule, face)
  // Under an open reminder, its own sum (1.19.0); a «З оплат» rule is named by its kind — its sum is only its least.
  const title =
    face.kind === 'due'
      ? `${copy.timeToBuy} · ${dollarsText(purchaseSumUsd(rule, face.occurrence), locale)}`
      : `${copy.autoinvest} · ${rule.payments ? copy.fromPayments : usd}`
  const sub =
    face.kind === 'paused'
      ? `${ruleWhenLine(rule, locale)} · ${copy.onPause}`
      : face.kind === 'due'
        ? ruleWhenLine(rule, locale)
        : face.kind === 'deferred'
          ? unbrokenParts(copy.deferredShort)
          : face.kind === 'held'
            ? unbrokenParts(copy.heldShort)
            : face.kind === 'next'
              ? `${copy.nextPurchase}: ${unbroken(dueWords(face.atMs, face.timeZone, locale))}`
              : face.kind === 'dip'
                ? `${ruleWhenLine(rule, locale)} · ${copy.remindAtShort} ${priceWord(face.triggerUsd, locale)}`
                : face.kind === 'payments'
                  ? wholeParts(
                      `${ruleWhenLine(rule, locale)} · ${gatheredLine(face.gatheredUsd, face.minimumUsd, locale)}`,
                    )
                  : ruleWhenLine(rule, locale)
  const missed = last
    ? `${copy.lastMissed} · ${unbroken(rule.dip ? dayWords(Date.parse(last.dueAt), zone, locale) : dueWords(Date.parse(last.dueAt), zone, locale))}`
    : null
  // Why it waits: the figure against the reference and the data's time, as the rule's own judgement stated it.
  // A token's purchase held back by its floor (1.31.0) says so first: a thin pool is the reason whatever the price says.
  const floor = face.kind === 'deferred' ? floorHeld(face.occurrence) : null
  const deferral = floor
    ? keptTail(floorLine(floor, rule.name, locale))
    : face.kind === 'deferred' && face.occurrence.condition
      ? unbrokenTail(deferralLine(face.occurrence.condition, rule.name, now, zone, locale))
      : null
  const warn = face.kind === 'held' || face.kind === 'deferred'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, sub, deferral, missed].filter(Boolean).join('. ')}
      onPress={onPress}
      className="flex-row items-center gap-2.5 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
    >
      <Icon
        name={face.kind === 'due' ? 'time-outline' : 'repeat-outline'}
        size={18}
        color={face.kind === 'due' ? 'brand' : 'muted'}
      />
      <View className="flex-1 gap-0.5">
        <Txt variant="ui" tabular>
          {title}
        </Txt>
        <Txt variant="ui" tone={warn ? 'warning' : 'faint'} tabular>
          {sub}
        </Txt>
        {deferral ? (
          <Txt variant="ui" tone="muted" tabular>
            {deferral}
          </Txt>
        ) : null}
        {missed ? (
          <Txt variant="ui" tone="faint" tabular>
            {missed}
          </Txt>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={16} color="fgMuted" />
    </Pressable>
  )
}
