import { Pressable, View } from 'react-native'

import { Txt } from '@/components/txt'
import type { AutoinvestCopy } from '@/features/autoinvest/copy'
import { budgetView } from '@/features/autoinvest/rule-model'
import { budgetRowWords } from '@/features/autoinvest/words'
import { dollarsText } from '@/features/invest/buy-model'
import type { RuleBudget } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import { fonts, useTheme } from '@/theme'

/**
 * The month's budget as its own line (canon v5.3 В29; M20) — in the
 * «Автоінвест» block on Home and in Portfolio, and in a new rule's sheet:
 * «Бюджет не задано · Задати», or «Бюджет місяця $10 з $50 · Змінити» over
 * the month's bar in the text's own colour — amber once it is spent, and then
 * «Бюджет вичерпано · Правила стоять до 1-го числа» under it. One tap opens
 * the budget's own sheet, where the sum reads «Не більше на місяць». A rule's
 * sum never stands in this line: it is each purchase, the budget the month's
 * ceiling for every rule. Null until the rules' read has said the budget.
 */
export function BudgetRow({
  budget,
  copy,
  locale,
  onEdit,
}: {
  budget: RuleBudget | null
  copy: AutoinvestCopy
  locale: Locale
  onEdit: () => void
}) {
  const { colors } = useTheme()
  const view = budgetView(budget)
  if (!view) return null
  const line = budgetRowWords(view, copy, locale)
  const unset = view.kind === 'unset'
  const spent = view.kind === 'capped' && view.exhausted
  const label = [
    line,
    spent ? `${copy.budgetSpent} · ${copy.rulesStand}` : null,
    unset ? copy.setBudget : copy.changeBudget,
  ]
    .filter(Boolean)
    .join('. ')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onEdit}
      className="gap-2 rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {view.kind === 'unset' ? (
          <Txt variant="ui" tone="muted" className="shrink">
            {copy.budgetNotSet}
          </Txt>
        ) : (
          <Txt variant="ui" tone="muted" tabular className="shrink">
            {`${copy.monthBudget} `}
            <Txt variant="ui" tabular style={{ fontFamily: fonts.sansSemibold }}>
              {`${dollarsText(view.countedUsd, locale)} ${copy.of} ${dollarsText(view.capUsd, locale)}`}
            </Txt>
          </Txt>
        )}
        <Txt variant="ui" tone="fg" style={{ textDecorationLine: 'underline' }}>
          {unset ? copy.setShort : copy.changeShort}
        </Txt>
      </View>
      {view.kind === 'capped' ? (
        <View style={{ height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: colors.track }}>
          <View
            style={{
              width: `${view.percent}%`,
              height: '100%',
              borderRadius: 999,
              backgroundColor: view.exhausted ? colors.warning : colors.fg,
            }}
          />
        </View>
      ) : null}
      {spent ? (
        <Txt variant="ui" tone="warning">
          {`${copy.budgetSpent} · ${copy.rulesStand}`}
        </Txt>
      ) : null}
    </Pressable>
  )
}
