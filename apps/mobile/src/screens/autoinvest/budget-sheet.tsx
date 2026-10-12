import { useState } from 'react'
import { Keyboard, TextInput, View } from 'react-native'

import { Button } from '@/components/button'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import {
  BUDGET_MIN_USD,
  BUDGET_PRESETS_USD,
  budgetOfInput,
  budgetRequest,
  capChoices,
  deviceTimeZone,
  writeFailureWords,
} from '@/features/autoinvest/rule-model'
import { useRules, useRuleWrites } from '@/features/autoinvest/use-rules'
import { monthWords } from '@/features/autoinvest/words'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { dollarsText, parseDollars } from '@/features/invest/buy-model'
import { useAccount } from '@/features/session/use-account'
import { useCopy, useLocale } from '@/lib/i18n'
import { type, useTheme } from '@/theme'

/**
 * «Бюджет місяця» — the person's own ceiling for every rule in a calendar
 * month, a sheet like the purchase's: a sum
 * in dollars under «Не більше на місяць», from $1,
 * typed or $31 · $50 · $100 · $200 — the first a dollar a day
 * for the longest month — what the month has taken so far («Цього місяця $45 з
 * $100»), one line on what the ceiling does and one on what counts,
 * «Зберегти» — and «Прибрати бюджет» while there is one. Only the person sets
 * it and Ryntra never raises it; writing it is the wallet's session, never a
 * transaction. The same sheet opens from the budget's own line — in the block
 * on Home and in Portfolio, and in a new rule's sheet — from a rule the
 * budget holds, from a reminder's purchase it does not cover, and from the
 * note that the month's budget is spent.
 */
export function BudgetSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  if (!visible) return null
  return <BudgetFlow onClose={onClose} />
}

type Busy = null | 'saving' | 'clearing'

function BudgetFlow({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme()
  const copy = useCopy(AUTOINVEST_COPY)
  const buyWords = useCopy(BUY_COPY)
  const locale = useLocale()
  const account = useAccount()
  const session = account.session
  const rules = useRules(session)
  const writes = useRuleWrites(session)
  const budget = rules.data?.budget ?? null
  const current = budget?.capUsd ?? null
  // What the person typed or picked; until then the ceiling set now, or $50 — the web's own start.
  const [typedText, setTypedText] = useState<string | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const text = typedText ?? String(current ?? BUDGET_PRESETS_USD[1])
  const typed = parseDollars(text, locale)
  const cap = budgetOfInput(text, locale)
  const choices: readonly Choice<string>[] = capChoices(current).map((usd) => ({
    value: String(usd),
    label: dollarsText(usd, locale),
  }))

  const close = () => {
    if (!busy) onClose()
  }
  const run = async (kind: Exclude<Busy, null>) => {
    Keyboard.dismiss()
    setFailure(null)
    setBusy(kind)
    const result =
      kind === 'clearing'
        ? await writes.clearBudget()
        : await writes.setBudget(budgetRequest({ capUsd: cap ?? 0, budget, deviceZone: deviceTimeZone(), locale }))
    setBusy(null)
    if (result.ok) {
      onClose()
      return
    }
    setFailure(writeFailureWords(result.code, copy, { write: 'budget', dip: false }))
  }

  /* The one button, by what stands in the way: the wallet, its session, the sum. */
  let button: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }
  if (!account.address)
    button = { title: buyWords.connect, onPress: () => void account.connect(), loading: account.busy === 'connect' }
  else if (!session)
    button = { title: buyWords.signIn, onPress: () => void account.signIn(), loading: account.signingIn }
  else if (typed !== null && typed < BUDGET_MIN_USD) button = { title: buyWords.minimum, disabled: true }
  else if (busy === 'saving') button = { title: copy.saving, loading: true }
  else button = { title: copy.save, onPress: () => void run('saving'), disabled: cap === null || busy !== null }

  return (
    <Sheet visible title={copy.monthBudget} onClose={close} scroll>
      <View className="gap-4 pb-2">
        {/* The budget's sum is the month's ceiling for all rules — never one purchase. */}
        <View className="gap-0.5">
          <Txt variant="labelSm" tone="faint" caps className="text-center" importantForAccessibility="no">
            {copy.atMostPerMonth}
          </Txt>
          <TextInput
            value={text.length > 0 ? `$${text}` : ''}
            onChangeText={(value) => setTypedText(value.replace(/[^\d.,]/g, '').slice(0, 12))}
            keyboardType="decimal-pad"
            placeholder="$0"
            placeholderTextColor={colors.fgMuted}
            selectionColor={colors.brand}
            cursorColor={colors.brand}
            accessibilityLabel={copy.atMostPerMonth}
            editable={busy === null}
            textAlign="center"
            className="text-fg"
            style={[type.display, { fontSize: 44, lineHeight: 52, paddingVertical: 4 }]}
          />
        </View>
        <ChoiceChips
          choices={choices}
          value={cap !== null ? String(cap) : ''}
          onChange={(value) => setTypedText(value)}
          quiet
          fill
          disabled={busy !== null}
        />
        {budget ? (
          <Txt variant="ui" tone="muted" className="text-center" tabular>
            {monthWords(budget, copy, locale)}
          </Txt>
        ) : null}
        <Txt variant="body" className="text-center">
          {copy.budgetLine}
        </Txt>
        <Txt variant="ui" tone="faint" className="text-center">
          {copy.budgetCounts}
        </Txt>
        {failure ? (
          <Txt variant="ui" tone="danger" className="text-center">
            {failure}
          </Txt>
        ) : null}
        <Button
          title={button.title}
          size="lg"
          onPress={button.onPress}
          disabled={button.disabled}
          loading={button.loading}
        />
        {session && current !== null ? (
          <Button
            title={copy.removeBudget}
            variant="ghost"
            loading={busy === 'clearing'}
            disabled={busy !== null}
            onPress={() => void run('clearing')}
          />
        ) : null}
      </View>
    </Sheet>
  )
}
