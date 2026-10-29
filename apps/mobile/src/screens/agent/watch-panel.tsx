import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips } from '@/components/choice-chips'
import { Field } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { creditsText } from '@/features/assistant/credits-model'
import { useTasks } from '@/features/assistant/tasks'
import { WATCH_COPY, type WatchCopy } from '@/features/assistant/watch-copy'
import { useWatches, useWatchWrite } from '@/features/assistant/watches'
import {
  channelsToSend,
  COOLDOWNS,
  cooldownChoice,
  createBody,
  DEFAULT_COOLDOWN,
  draftOf,
  EMPTY_DRAFT,
  focusedWatch,
  ruleOf,
  shownProblem,
  stateTone,
  watchFailureOf,
  type Channels,
  type Cooldown,
  type WatchChoice,
  type WatchDraft,
  type WatchFailure,
} from '@/features/assistant/watches-model'
import { useNow } from '@/hooks/use-now'
import type { AssistantWatch, AssistantWatchPreset, AssistantWatchesResponse, Session } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { useTheme } from '@/theme'
import { DASH, formatMoment } from '@/utils/format'

import { ChannelRows, ConfirmSheet, Label, TasksPanel, TokenPicker, type PickedToken } from './tasks-panel'

export type AssistantToken = Readonly<{ mint: string; symbol: string | null }>

export type WatchPanelProps = {
  session: Session
  /** A watch's note (`?watch=wch_…`): that card in view; `all` or null — the tab alone. */
  focusId: string | null
  /** «Стежити» from a token's page: the new watch's token already chosen. */
  token: AssistantToken | null
  /** «Чому? · N»: the watch's question goes into the conversation's field, asked on the person's press at its price. */
  onAsk: (question: string) => void
  /** A task's note (`?task=t_…`): that task's card in view. */
  taskId: string | null
  /** A task's conversation — every run's answer — opened in «Розмова». */
  onOpenConversation: (sessionId: string) => void
}

/** How long a card a note opened stays marked. */
const MARK_MS = 2_500

/* ------------------------------------------------------------ the rule */

/** The rule's own fields — «Детально» on a new watch, and «Змінити» on a card. */
function RuleFields({ draft, setDraft, copy }: { draft: WatchDraft; setDraft: (draft: WatchDraft) => void; copy: WatchCopy }) {
  const set = (patch: Partial<WatchDraft>) => setDraft({ ...draft, ...patch })
  const problem = shownProblem(draft)
  const windows = [
    { value: 'm5' as const, label: copy.m5 },
    { value: 'h1' as const, label: copy.h1 },
    { value: 'h24' as const, label: copy.h24 },
  ]
  return (
    <View className="gap-4">
      <View className="gap-2">
        <Label>{copy.kind}</Label>
        <ChoiceChips
          value={draft.kind}
          onChange={(kind) => set({ kind })}
          choices={[
            { value: 'price', label: copy.kindPrice },
            { value: 'move', label: copy.kindMove },
            { value: 'volume', label: copy.kindVolume },
            { value: 'liquidity', label: copy.kindLiquidity },
          ]}
          size="sm"
          quiet
        />
      </View>
      {draft.kind === 'price' ? (
        <>
          <ChoiceChips
            value={draft.direction}
            onChange={(direction) => set({ direction })}
            choices={[
              { value: 'below', label: copy.below },
              { value: 'above', label: copy.above },
            ]}
            size="sm"
            quiet
            fill
          />
          <Field
            label={copy.level}
            value={draft.level}
            onChangeText={(level) => set({ level })}
            keyboardType="decimal-pad"
            suffix="$"
            error={problem === 'level' ? copy.need.level : null}
          />
        </>
      ) : null}
      {draft.kind === 'move' ? (
        <>
          <ChoiceChips
            value={draft.move}
            onChange={(move) => set({ move })}
            choices={[
              { value: 'down', label: copy.down },
              { value: 'up', label: copy.up },
              { value: 'any', label: copy.any },
            ]}
            size="sm"
            quiet
          />
          <Field
            label={copy.pct}
            value={draft.pct}
            onChangeText={(pct) => set({ pct })}
            keyboardType="decimal-pad"
            suffix="%"
            error={problem === 'pct' ? copy.need.pct : null}
          />
          <View className="gap-2">
            <Label>{copy.window}</Label>
            <ChoiceChips value={draft.window} onChange={(window) => set({ window })} choices={windows} size="sm" quiet fill />
          </View>
        </>
      ) : null}
      {draft.kind === 'volume' ? (
        <Field
          label={copy.factor}
          value={draft.factor}
          onChangeText={(factor) => set({ factor })}
          keyboardType="decimal-pad"
          suffix="×"
          error={problem === 'factor' ? copy.need.factor : null}
        />
      ) : null}
      {draft.kind === 'liquidity' ? (
        <>
          <ChoiceChips
            value={draft.liq}
            onChange={(liq) => set({ liq })}
            choices={[
              { value: 'drop', label: copy.drop },
              { value: 'rise', label: copy.rise },
              { value: 'any', label: copy.any },
            ]}
            size="sm"
            quiet
          />
          <Field
            label={copy.pct}
            value={draft.liqPct}
            onChangeText={(liqPct) => set({ liqPct })}
            keyboardType="decimal-pad"
            suffix="%"
            error={problem === 'liqPct' ? copy.need.liqPct : null}
          />
          <View className="gap-2">
            <Label>{copy.window}</Label>
            <ChoiceChips
              value={draft.liqWindow}
              onChange={(liqWindow) => set({ liqWindow })}
              choices={windows.filter((row) => row.value !== 'm5') as { value: 'h1' | 'h24'; label: string }[]}
              size="sm"
              quiet
              fill
            />
          </View>
          <Field
            label={copy.pool}
            value={draft.pool}
            onChangeText={(pool) => set({ pool })}
            autoCapitalize="none"
            autoCorrect={false}
            hint={copy.poolHint}
            error={problem === 'pool' ? copy.need.pool : null}
          />
        </>
      ) : null}
    </View>
  )
}

/** «Не частіше ніж»: the pause between two alerts of one watch. */
function CooldownChips({ value, onChange, copy }: { value: Cooldown; onChange: (value: Cooldown) => void; copy: WatchCopy }) {
  return (
    <View className="gap-2">
      <Label>{copy.cooldown}</Label>
      <ChoiceChips
        value={String(value)}
        onChange={(next) => onChange(Number(next) as Cooldown)}
        choices={COOLDOWNS.map((minutes) => ({ value: String(minutes), label: copy.cooldownLabel(minutes) }))}
        size="sm"
        quiet
        fill
      />
    </View>
  )
}

/* ------------------------------------------------------------ a new watch */

const DETAIL = 'detail'

/**
 * «Стежити за токеном» in four presses: the token, when to write (the server's presets, or «Детально» for the rule
 * itself and the pause between alerts), where, «Увімкнути». A level on a token Jupiter does not price is refused —
 * then the sheet offers the move in % instead.
 */
function NewWatchSheet({
  onClose,
  read,
  initial,
  session,
  locale,
  copy,
}: {
  onClose: () => void
  read: AssistantWatchesResponse
  initial: PickedToken | null
  session: Session
  locale: Locale
  copy: WatchCopy
}) {
  const write = useWatchWrite(session, locale)
  const [token, setToken] = useState<PickedToken | null>(initial)
  const [choice, setChoice] = useState<WatchChoice>({ kind: 'preset', preset: read.presets[0]?.id ?? 'drop24h' })
  const [cooldown, setCooldown] = useState<Cooldown>(DEFAULT_COOLDOWN)
  const [chosen, setChosen] = useState<Channels>({ telegram: true, push: true })
  const [failure, setFailure] = useState<WatchFailure | null>(null)

  const sends = channelsToSend(chosen, read.channels)
  const body = createBody(token?.mint ?? null, choice, cooldown, sends, locale)
  const presetValue = choice.kind === 'preset' ? choice.preset : DETAIL

  const start = () => {
    if (!body || write.isPending) return
    setFailure(null)
    write.mutate(
      { kind: 'create', body },
      { onSuccess: onClose, onError: (error) => setFailure(watchFailureOf(error)) },
    )
  }

  const toDraft = (draft: WatchDraft) => {
    setFailure(null)
    setChoice({ kind: 'rule', draft })
  }

  return (
    <Sheet visible title={copy.newWatch} subtitle={copy.freeLeft(read.limit.left, read.limit.free)} onClose={onClose} scroll>
      <View className="gap-5 pb-3">
        <View className="gap-2">
          <Label>{copy.token}</Label>
          <TokenPicker token={token} onChange={setToken} copy={copy} />
        </View>
        <View className="gap-2">
          <Label>{copy.preset}</Label>
          <ChoiceChips
            value={presetValue}
            onChange={(value) => {
              setFailure(null)
              if (value === DETAIL) setChoice({ kind: 'rule', draft: choice.kind === 'rule' ? choice.draft : EMPTY_DRAFT })
              else setChoice({ kind: 'preset', preset: value as AssistantWatchPreset })
            }}
            choices={[
              ...read.presets.map((row) => ({ value: row.id as string, label: row.text })),
              { value: DETAIL, label: copy.detail },
            ]}
            size="sm"
          />
        </View>
        {choice.kind === 'rule' ? (
          <>
            <RuleFields draft={choice.draft} setDraft={toDraft} copy={copy} />
            <CooldownChips value={cooldown} onChange={setCooldown} copy={copy} />
          </>
        ) : null}
        <ChannelRows available={read.channels} chosen={chosen} onChange={setChosen} copy={copy} />
        {failure ? (
          <View className="gap-2">
            <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
              {copy.failure[failure]}
            </Txt>
            {failure === 'unpriced' ? (
              <Button title={copy.watchMove} variant="secondary" size="sm" onPress={() => toDraft({ ...EMPTY_DRAFT, kind: 'move' })} />
            ) : failure === 'noPrice' ? (
              <Button
                title={copy.setLevel}
                variant="secondary"
                size="sm"
                onPress={() =>
                  toDraft({
                    ...EMPTY_DRAFT,
                    kind: 'price',
                    direction: choice.kind === 'preset' && choice.preset === 'above' ? 'above' : 'below',
                  })
                }
              />
            ) : null}
          </View>
        ) : null}
        <Button title={copy.start} onPress={start} disabled={body === null} loading={write.isPending} />
      </View>
    </Sheet>
  )
}

/* ------------------------------------------------------------ a card */

/** «Змінити»: the rule, the pause and where alerts go, by the version the card shows; a changed rule starts afresh. */
function EditSheet({
  watch,
  available,
  onClose,
  session,
  locale,
  copy,
}: {
  watch: AssistantWatch
  available: Channels
  onClose: () => void
  session: Session
  locale: Locale
  copy: WatchCopy
}) {
  const write = useWatchWrite(session, locale)
  const [draft, setDraft] = useState<WatchDraft>(() => draftOf(watch.rule))
  const [cooldown, setCooldown] = useState<Cooldown>(() => cooldownChoice(watch.cooldownMinutes))
  const [chosen, setChosen] = useState<Channels>(watch.channels)
  const [failure, setFailure] = useState<WatchFailure | null>(null)
  const rule = ruleOf(draft)
  const ruleChanged = rule !== null && JSON.stringify(rule) !== JSON.stringify(watch.rule)
  const save = () => {
    if (!rule || write.isPending) return
    setFailure(null)
    write.mutate(
      {
        kind: 'update',
        id: watch.id,
        body: {
          ifVersion: watch.version,
          ...(ruleChanged ? { rule } : {}),
          cooldownMinutes: cooldown,
          channels: channelsToSend(chosen, available),
        },
      },
      { onSuccess: onClose, onError: (error) => setFailure(watchFailureOf(error)) },
    )
  }
  return (
    <Sheet visible title={copy.editTitle} subtitle={watch.symbol} onClose={onClose} scroll>
      <View className="gap-5 pb-3">
        <RuleFields draft={draft} setDraft={setDraft} copy={copy} />
        <CooldownChips value={cooldown} onChange={setCooldown} copy={copy} />
        <ChannelRows available={available} chosen={chosen} onChange={setChosen} copy={copy} />
        {failure ? (
          <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
            {copy.failure[failure]}
          </Txt>
        ) : null}
        <Button title={copy.save} onPress={save} disabled={rule === null} loading={write.isPending} />
      </View>
    </Sheet>
  )
}

/**
 * One watch: the token, its rule as the server words it, its state; what it reads now with its source and time; the
 * latest alert with its time; «Чому? · N» at its price, «Пауза / Продовжити», «Змінити», «Вимкнути».
 */
function WatchCard({
  watch,
  available,
  marked,
  onAsk,
  onLayoutY,
  session,
  locale,
  copy,
  now,
}: {
  watch: AssistantWatch
  available: Channels
  marked: boolean
  onAsk: (question: string) => void
  onLayoutY: (y: number) => void
  session: Session
  locale: Locale
  copy: WatchCopy
  now: number
}) {
  const write = useWatchWrite(session, locale)
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<WatchFailure | null>(null)
  const active = watch.status === 'active'
  const onError = (error: unknown) => setFailure(watchFailureOf(error))
  const nowWhere = [watch.now.source, watch.now.observedAt ? formatMoment(watch.now.observedAt, now, locale) : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <Card className={marked ? 'gap-3 border-brand-line' : 'gap-3'} onLayout={(event) => onLayoutY(event.nativeEvent.layout.y)}>
      <View className="flex-row items-center gap-2">
        <Txt variant="title" className="flex-1" numberOfLines={1}>
          {watch.symbol}
        </Txt>
        <Chip label={copy.state[watch.now.state]} tone={stateTone(watch.now.state)} caps={false} />
      </View>
      <Txt variant="body">{watch.ruleText}</Txt>
      <View className="gap-0.5">
        <Txt variant="ui">
          {copy.now}: {watch.now.text ?? DASH}
        </Txt>
        {nowWhere ? (
          <Txt variant="labelSm" tone="faint" numberOfLines={1}>
            {nowWhere}
          </Txt>
        ) : null}
      </View>
      {watch.last ? (
        <View className="gap-0.5 border-t border-line pt-3">
          <Txt variant="ui" numberOfLines={2}>
            {watch.last.title}
          </Txt>
          <Txt variant="labelSm" tone="faint">
            {formatMoment(watch.last.at, now, locale)}
          </Txt>
        </View>
      ) : null}
      {failure ? (
        <Txt variant="labelSm" tone="danger" accessibilityLiveRegion="polite">
          {copy.failure[failure]}
        </Txt>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {watch.explain ? (
          <Button
            title={copy.why(creditsText(watch.explain.priceCredits, locale))}
            variant="secondary"
            size="sm"
            onPress={() => {
              if (watch.explain) onAsk(watch.explain.question)
            }}
          />
        ) : null}
        <Button
          title={active ? copy.pause : copy.resume}
          variant="secondary"
          size="sm"
          loading={write.isPending && !asking}
          onPress={() => {
            setFailure(null)
            // Pause and resume carry no version: safe whatever the pass wrote meanwhile.
            write.mutate({ kind: 'update', id: watch.id, body: { status: active ? 'paused' : 'active' } }, { onError })
          }}
        />
        <Button title={copy.edit} variant="ghost" size="sm" disabled={write.isPending} onPress={() => setEditing(true)} />
        <Button title={copy.off} variant="ghost" size="sm" disabled={write.isPending} onPress={() => setAsking(true)} />
      </View>
      {editing ? (
        <EditSheet watch={watch} available={available} onClose={() => setEditing(false)} session={session} locale={locale} copy={copy} />
      ) : null}
      <ConfirmSheet
        visible={asking}
        title={copy.offTitle}
        body={copy.offAsk}
        confirm={copy.offYes}
        cancel={copy.cancel}
        loading={write.isPending}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setFailure(null)
          write.mutate(
            { kind: 'remove', id: watch.id },
            {
              onSuccess: () => setAsking(false),
              onError: (error) => {
                setAsking(false)
                onError(error)
              },
            },
          )
        }}
      />
    </Card>
  )
}

/* ------------------------------------------------------------ the tab */

/** «Стежу» — the wallet's token watches, and «Доручення» under them (AI-05, AI-19). */
export function WatchPanel({ session, focusId, token, onAsk, taskId, onOpenConversation }: WatchPanelProps) {
  const copy = useCopy(WATCH_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const now = useNow(60_000)
  const { colors } = useTheme()
  const watches = useWatches(session, locale)
  const tasks = useTasks(session)
  const [creating, setCreating] = useState(false)
  const [initial, setInitial] = useState<PickedToken | null>(null)
  const [pulling, setPulling] = useState(false)
  const [marked, setMarked] = useState<string | null>(null)

  const scroller = useRef<ScrollView>(null)
  const listY = useRef(0)
  const cardY = useRef(new Map<string, number>())
  const scrolledTo = useRef<string | null>(null)
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  const read = watches.data ?? null
  const scrollToY = useCallback((y: number) => scroller.current?.scrollTo({ y: Math.max(0, y - 12), animated: true }), [])

  /* «Стежити» on a token's page: the sheet opens once on that token, while a free watch is left. */
  if (token && read && openedFor !== token.mint) {
    setOpenedFor(token.mint)
    if (read.limit.left > 0) {
      setInitial({ mint: token.mint, symbol: token.symbol, name: null, icon: null })
      setCreating(true)
    }
  }

  /* A note's watch: in view and marked a moment, once per note. */
  const focus = read ? focusedWatch(focusId, read.watches) : null
  useEffect(() => {
    if (!focus || scrolledTo.current === focus) return
    /* The card's place is known once it is laid out: looked for a few times, then given up quietly. */
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      const y = cardY.current.get(focus)
      if (y !== undefined) {
        scrolledTo.current = focus
        scroller.current?.scrollTo({ y: Math.max(0, listY.current + y - 12), animated: true })
        setMarked(focus)
      }
      if (y !== undefined || tries >= 10) clearInterval(timer)
    }, 150)
    return () => clearInterval(timer)
  }, [focus])
  useEffect(() => {
    if (!marked) return
    const timer = setTimeout(() => setMarked(null), MARK_MS)
    return () => clearTimeout(timer)
  }, [marked])

  if (watches.isPending) {
    return (
      <View className="gap-4 px-4 pt-2" accessibilityRole="progressbar">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-36 rounded-sm" />
        <Skeleton className="h-11 rounded-btn" />
      </View>
    )
  }
  if (watches.isError && !read) {
    return (
      <StateView
        icon="alert-circle-outline"
        tone="danger"
        title={copy.loadFailed}
        action={{ title: shared.tryAgain, onPress: () => void watches.refetch(), loading: watches.isFetching }}
      />
    )
  }
  const data = read!
  const left = data.limit.left
  return (
    <ScrollView
      ref={scroller}
      className="flex-1"
      contentContainerClassName="gap-4 px-4 pb-8 pt-2"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => {
            setPulling(true)
            void Promise.allSettled([watches.refetch(), tasks.refetch()]).finally(() => setPulling(false))
          }}
          tintColor={colors.brand}
          colors={[colors.brand]}
          progressBackgroundColor={colors.elevated}
        />
      }
    >
      <View className="flex-row items-center gap-2">
        <Txt variant="ui" tone="muted" className="flex-1">
          {left > 0 ? copy.freeLeft(left, data.limit.free) : copy.full(data.limit.free)}
        </Txt>
        <HelpDot title={copy.howTitle} body={copy.how} />
      </View>
      <View className="gap-3" onLayout={(event) => (listY.current = event.nativeEvent.layout.y)}>
        {data.watches.length === 0 ? (
          <Txt variant="body" tone="muted">
            {copy.none}
          </Txt>
        ) : (
          data.watches.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              available={data.channels}
              marked={marked === watch.id}
              onAsk={onAsk}
              onLayoutY={(y) => cardY.current.set(watch.id, y)}
              session={session}
              locale={locale}
              copy={copy}
              now={now}
            />
          ))
        )}
      </View>
      {left > 0 ? (
        <Button
          title={copy.newWatch}
          onPress={() => {
            setInitial(null)
            setCreating(true)
          }}
        />
      ) : null}
      <TasksPanel
        session={session}
        taskId={taskId}
        channels={data.channels}
        onOpenConversation={onOpenConversation}
        onFocusY={scrollToY}
      />
      {/* Mounted while open, keyed by its token: every opening starts the form afresh. */}
      {creating ? (
        <NewWatchSheet
          key={initial?.mint ?? 'new'}
          onClose={() => setCreating(false)}
          read={data}
          initial={initial}
          session={session}
          locale={locale}
          copy={copy}
        />
      ) : null}
    </ScrollView>
  )
}
