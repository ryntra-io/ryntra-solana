import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { ToggleRow } from '@/components/field'
import { Txt } from '@/components/txt'
import { MEMORY_COPY } from '@/features/assistant/memory-copy'
import {
  EXPERIENCES,
  GOALS,
  HORIZONS,
  initialAnswers,
  pctText,
  profileUpdateOf,
  quietWindowOf,
  RISKS,
  SKIP_UPDATE,
  type MeetAnswers,
  type RiskPct,
} from '@/features/assistant/memory-model'
import { profileSaved, useSaveProfile } from '@/features/assistant/use-memory'
import { deviceTimezone } from '@/features/monitoring/monitoring-model'
import type { AssistantProfileResponse, AssistantProfileUpdate, Session } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { cn } from '@/utils/cn'

export type MeetProps = {
  session: Session
  /** The profile as read: `profile` null — the first time; otherwise «Змінити» from what Ryntra knows. */
  read: AssistantProfileResponse
  mode: 'first' | 'edit'
  /** Saved or skipped: the server's answer, which replaces the read. */
  onDone: (next: AssistantProfileResponse) => void
  /** Closed without a word written (only in `edit`). */
  onCancel: () => void
  /** After the answers, «Стежити за першим токеном» opens «Стежу». */
  onFirstWatch: () => void
}

const STEPS = 5

/** One answer a row, the whole width a press — the chosen one marked as a chip is. */
function Options<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T | null
  options: readonly (readonly [T, string])[]
  onPick: (value: T) => void
}) {
  return (
    <View className="gap-2" accessibilityRole="radiogroup">
      {options.map(([id, label]) => {
        const selected = id === value
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => onPick(id)}
            className={cn(
              'h-11 justify-center rounded-btn border px-4',
              selected ? 'border-brand-chip-line bg-brand-chip' : 'border-line bg-surface active:bg-hover',
            )}
          >
            <Txt variant="ui" tone={selected ? 'brand' : 'fg'} numberOfLines={1}>
              {label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * «Знайомство» (1.58.0): a card in the conversation, five short questions one at a time — the goal, the experience,
 * the risk per trade (1 % suggested), the horizon, where notes go with quiet hours. «Пропустити» on every step is an
 * answer too; in `edit` it is «Скасувати» and nothing is written. The answers shape only how Ryntra words an answer —
 * never a buy or a sell. After the first answers: «Готово» with the first watch offered; the answer reaches the
 * conversation (`onDone`) when that closes, so the card is not taken away mid-word.
 */
export function Meet({ session, read, mode, onDone, onCancel, onFirstWatch }: MeetProps) {
  const copy = useCopy(MEMORY_COPY)
  const locale = useLocale()
  const queryClient = useQueryClient()
  const save = useSaveProfile(session)
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<MeetAnswers>(() => initialAnswers(read))
  const [saved, setSaved] = useState<AssistantProfileResponse | null>(null)
  const [quietWindow] = useState(() => quietWindowOf(read, deviceTimezone()))

  // The answer written where every reader finds it, then handed to the conversation — once.
  const committed = useRef(false)
  const commit = (next: AssistantProfileResponse) => {
    if (committed.current) return
    committed.current = true
    profileSaved(queryClient, session.address, next)
    onDone(next)
  }
  // Left on «Готово» without a press (the screen closed): the answers still reach every reader.
  const pendingRef = useRef<AssistantProfileResponse | null>(null)
  useEffect(() => {
    pendingRef.current = saved
  }, [saved])
  useEffect(
    () => () => {
      const next = pendingRef.current
      if (next && !committed.current) {
        committed.current = true
        profileSaved(queryClient, session.address, next)
      }
    },
    [queryClient, session.address],
  )

  const write = (body: AssistantProfileUpdate) => {
    if (save.isPending) return
    save.mutate(body, {
      onSuccess: (next) => {
        if ('goal' in body && mode === 'first') setSaved(next)
        else commit(next)
      },
    })
  }

  if (saved) {
    return (
      <Card className="gap-3" accessibilityLiveRegion="polite">
        <Txt variant="body">{copy.meetDone}</Txt>
        <View className="flex-row items-center gap-2">
          <Button
            title={copy.meetFirstWatch}
            size="sm"
            onPress={() => {
              commit(saved)
              onFirstWatch()
            }}
          />
          <Button title={copy.meetClose} variant="ghost" size="sm" onPress={() => commit(saved)} />
        </View>
      </Card>
    )
  }

  const set = (patch: Partial<MeetAnswers>) => setAnswers((current) => ({ ...current, ...patch }))
  const choose = (patch: Partial<MeetAnswers>) => {
    set(patch)
    setStep((at) => Math.min(STEPS - 1, at + 1))
  }
  const body = profileUpdateOf(answers, quietWindow)
  const answered = [answers.goal, answers.experience, answers.riskPct, answers.horizon][step] ?? null
  const question = [copy.meetGoal, copy.meetExperience, copy.meetRisk, copy.meetHorizon, copy.meetWhere][step]

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <Txt variant="ui" className="flex-1" accessibilityRole="header">
          {copy.meetTitle}
        </Txt>
        <Txt variant="labelSm" tone="faint" tabular>
          {copy.meetStep(step + 1)}
        </Txt>
      </View>
      <View className="flex-row gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: STEPS }, (_, index) => (
          <View key={index} className={cn('h-1 flex-1 rounded-pill', index <= step ? 'bg-brand' : 'bg-line')} />
        ))}
      </View>
      {step === 0 && mode === 'first' ? (
        <Txt variant="ui" tone="muted">
          {copy.meetLead}
        </Txt>
      ) : null}

      <View className="gap-2">
        <Txt variant="body" accessibilityLiveRegion="polite">
          {question}
        </Txt>
        {step === 2 ? (
          <Txt variant="labelSm" tone="faint">
            {copy.meetRiskNote}
          </Txt>
        ) : null}
      </View>

      {step === 0 ? (
        <Options
          value={answers.goal}
          options={GOALS.map((id) => [id, { learn: copy.meetGoalLearn, trade: copy.meetGoalTrade, hold: copy.meetGoalHold }[id]] as const)}
          onPick={(goal) => choose({ goal })}
        />
      ) : null}
      {step === 1 ? (
        <Options
          value={answers.experience}
          options={EXPERIENCES.map((id) => [id, { new: copy.meetExpNew, some: copy.meetExpSome, pro: copy.meetExpPro }[id]] as const)}
          onPick={(experience) => choose({ experience })}
        />
      ) : null}
      {step === 2 ? (
        <ChoiceChips
          value={String(answers.riskPct)}
          choices={RISKS.map((value) => ({ value: String(value), label: `${pctText(value, locale)} %` }))}
          onChange={(value) => choose({ riskPct: Number(value) as RiskPct })}
          fill
        />
      ) : null}
      {step === 3 ? (
        <Options
          value={answers.horizon}
          options={HORIZONS.map((id) => [id, { hours: copy.meetHorHours, days: copy.meetHorDays, weeks: copy.meetHorWeeks }[id]] as const)}
          onPick={(horizon) => choose({ horizon })}
        />
      ) : null}
      {step === 4 ? (
        <View>
          <Txt variant="ui" tone="muted" className="border-b border-line py-3">
            {copy.meetInbox}
          </Txt>
          <ToggleRow label="Telegram" value={answers.telegram} onChange={(telegram) => set({ telegram })} />
          <ToggleRow label="Push" value={answers.push} onChange={(push) => set({ push })} />
          <ToggleRow
            label={copy.meetQuiet(quietWindow.start, quietWindow.end)}
            hint={copy.meetQuietHint}
            value={answers.quiet}
            onChange={(quiet) => set({ quiet })}
            last
          />
        </View>
      ) : null}

      {save.isError ? (
        <Txt variant="labelSm" tone="danger" accessibilityRole="alert">
          {copy.meetFailed}
        </Txt>
      ) : null}

      <View className="flex-row items-center gap-1">
        {step > 0 ? (
          <Button title={copy.meetBack} variant="ghost" size="sm" disabled={save.isPending} onPress={() => setStep((at) => at - 1)} />
        ) : null}
        <View className="flex-1" />
        {mode === 'edit' ? (
          <Button title={copy.meetCancel} variant="ghost" size="sm" disabled={save.isPending} onPress={onCancel} />
        ) : (
          <Button title={copy.meetSkip} variant="ghost" size="sm" disabled={save.isPending} onPress={() => write(SKIP_UPDATE)} />
        )}
        {step < STEPS - 1 && answered !== null ? (
          <Button title={copy.meetNext} variant="secondary" size="sm" onPress={() => setStep((at) => at + 1)} />
        ) : null}
        {step === STEPS - 1 ? (
          <Button
            title={copy.meetSave}
            size="sm"
            disabled={body === null}
            loading={save.isPending}
            onPress={() => {
              if (body) write(body)
            }}
          />
        ) : null}
      </View>
    </Card>
  )
}
