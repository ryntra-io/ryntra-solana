import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { Field, ToggleRow } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { SearchInput } from '@/components/search-field'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { creditsText } from '@/features/assistant/credits-model'
import { useTasks, useTaskWrite } from '@/features/assistant/tasks'
import {
  askOf,
  createTaskBody,
  DAILY_TIMES,
  DEFAULT_DAILY_TIME,
  fittingEvery,
  focusedTask,
  ownZone,
  pauseBody,
  QUESTION_MAX,
  QUESTION_MIN,
  resumeBody,
  rhythmFits,
  rhythmOf,
  someRhythmOff,
  TASK_EVERY,
  TASK_KINDS,
  taskFailureOf,
  tasksFull,
  tasksOff,
  taskStatus,
  type TaskFailure,
  type TaskKind,
} from '@/features/assistant/tasks-model'
import { WATCH_COPY, type WatchCopy } from '@/features/assistant/watch-copy'
import { useTokenSearch } from '@/features/assistant/watches'
import { channelOffer, channelsToSend, isAddress, QUICK_TOKENS, type Channels } from '@/features/assistant/watches-model'
import { useNow } from '@/hooks/use-now'
import type { AssistantTask, AssistantTaskEvery, AssistantTasksResponse, Session } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { DASH, formatAt, shortAddress } from '@/utils/format'

/* ------------------------------------------------------------ shared with «Стежу» */

/** A token as the picker holds it: its mint always, its symbol and image when the catalogue gave them. */
export type PickedToken = Readonly<{ mint: string; symbol: string | null; name: string | null; icon: string | null }>


/**
 * A token for a watch or a task: the four most people start from, a search by ticker or name, or an address pasted
 * as it is — the server reads the token by its mint when the watch starts. Chosen, it is one row with «Змінити».
 */
export function TokenPicker({
  token,
  onChange,
  copy,
}: {
  token: PickedToken | null
  onChange: (token: PickedToken | null) => void
  copy: WatchCopy
}) {
  const [query, setQuery] = useState('')
  const search = useTokenSearch(query)
  const text = query.trim()
  const pasted = isAddress(text) ? text : null

  if (token) {
    const short = shortAddress(token.mint)
    const symbol = token.symbol ?? short
    return (
      <View className="flex-row items-center gap-3 rounded-btn border border-line bg-surface px-3 py-2">
        <AssetIcon symbol={symbol} icon={token.icon} size={28} />
        <View className="flex-1 gap-0.5">
          <Txt variant="ui" numberOfLines={1}>
            {symbol}
          </Txt>
          {symbol !== short ? (
            <Txt variant="data" tone="faint" numberOfLines={1}>
              {short}
            </Txt>
          ) : null}
        </View>
        <Button
          title={copy.change}
          variant="ghost"
          size="sm"
          onPress={() => {
            setQuery('')
            onChange(null)
          }}
        />
      </View>
    )
  }

  const rows = search.data ?? []
  return (
    <View className="gap-3">
      <ChoiceChips
        choices={QUICK_TOKENS.map((row) => ({ value: row.mint, label: row.symbol }))}
        value=""
        onChange={(mint) => {
          const quick = QUICK_TOKENS.find((row) => row.mint === mint)
          if (quick) onChange({ mint: quick.mint, symbol: quick.symbol, name: null, icon: null })
        }}
        size="sm"
        tall
      />
      <View className="flex-row">
        <SearchInput
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder={copy.search}
          label={copy.search}
        />
      </View>
      {search.isFetching && text.length >= 2 ? (
        <Txt variant="labelSm" tone="faint">
          {copy.searching}
        </Txt>
      ) : search.isError && !pasted ? (
        <Txt variant="labelSm" tone="faint">
          {copy.searchFailed}
        </Txt>
      ) : null}
      {pasted && !rows.some((row) => row.mint === pasted) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${copy.byAddress} ${shortAddress(pasted)}`}
          onPress={() => onChange({ mint: pasted, symbol: null, name: null, icon: null })}
          className="min-h-11 flex-row items-center gap-3 rounded-btn px-1 active:bg-hover"
        >
          <Txt variant="ui" className="flex-1">
            {copy.byAddress}
          </Txt>
          <Txt variant="data" tone="faint">
            {shortAddress(pasted)}
          </Txt>
        </Pressable>
      ) : null}
      {search.isSuccess && !search.isFetching && rows.length === 0 && !pasted ? (
        <Txt variant="labelSm" tone="faint">
          {copy.noMatch}
        </Txt>
      ) : null}
      {rows.length > 0 ? (
        <View>
          {rows.map((row) => (
            <Pressable
              key={row.mint}
              accessibilityRole="button"
              accessibilityLabel={`${row.symbol} ${row.name}`}
              onPress={() => onChange({ mint: row.mint, symbol: row.symbol, name: row.name, icon: row.icon })}
              className="min-h-12 flex-row items-center gap-3 rounded-btn px-1 active:bg-hover"
            >
              <AssetIcon symbol={row.symbol} icon={row.icon} size={28} />
              <View className="flex-1">
                <Txt variant="ui" numberOfLines={1}>
                  {row.symbol}
                </Txt>
                <Txt variant="labelSm" tone="faint" numberOfLines={1}>
                  {row.name}
                </Txt>
              </View>
              <Txt variant="data" tone="faint">
                {shortAddress(row.mint)}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

/** One small heading over a group of choices. */
export function Label({ children }: { children: string }) {
  return (
    <Txt variant="labelSm" tone="faint" caps>
      {children}
    </Txt>
  )
}


/**
 * «Куди»: the Inbox always; Telegram and Push only when the answer says they are connected — what is not connected is
 * named in one quiet line, never offered as a switch that does nothing.
 */
export function ChannelRows({
  available,
  chosen,
  onChange,
  copy,
}: {
  available: Channels
  chosen: Channels
  onChange: (chosen: Channels) => void
  copy: WatchCopy
}) {
  const offer = channelOffer(available)
  return (
    <View className="gap-1">
      <Label>{copy.where}</Label>
      <Txt variant="ui" tone="muted" className="py-2">
        {copy.inboxAlways}
      </Txt>
      {offer.telegram ? (
        <ToggleRow label="Telegram" value={chosen.telegram} onChange={(telegram) => onChange({ ...chosen, telegram })} last={!offer.push} />
      ) : null}
      {offer.push ? <ToggleRow label="Push" value={chosen.push} onChange={(push) => onChange({ ...chosen, push })} last /> : null}
      {offer.missing.length > 0 ? (
        <Txt variant="labelSm" tone="faint">
          {copy.notConnected(offer.missing.join(' · '))}
        </Txt>
      ) : null}
    </View>
  )
}

/** A question before something that cannot be undone — «Вимкнути» of a watch or a task. */
export function ConfirmSheet({
  visible,
  title,
  body,
  confirm,
  cancel,
  loading,
  onConfirm,
  onClose,
}: {
  visible: boolean
  title: string
  body: string
  confirm: string
  cancel: string
  loading: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View className="gap-4 pb-2">
        <Txt variant="body" tone="muted">
          {body}
        </Txt>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button title={cancel} variant="secondary" onPress={onClose} disabled={loading} />
          </View>
          <View className="flex-1">
            <Button title={confirm} variant="danger" onPress={onConfirm} loading={loading} />
          </View>
        </View>
      </View>
    </Sheet>
  )
}

/* ------------------------------------------------------------ a task */

/** The scheduled kinds as a person picks them — the web's order: news and moves of a token first. */
function kindLabel(kind: TaskKind, copy: WatchCopy): string {
  return copy.taskKind[kind]
}

/**
 * One task: its name and rhythm, when it runs next (or why it rests), the price of a run and of a day, its latest
 * answer with its time; «Пауза», «Продовжити за N» at the price of a run now, «Відповіді», «Вимкнути».
 */
function TaskCard({
  task,
  price,
  limit,
  marked,
  onLayoutY,
  onOpenConversation,
  session,
  locale,
  copy,
  now,
}: {
  task: AssistantTask
  /** The price of a run now — what «Продовжити» shows and sends; null while not read. */
  price: number | null
  /** How many tasks a wallet keeps — named when a write is refused for it. */
  limit: number
  marked: boolean
  onLayoutY: (y: number) => void
  onOpenConversation: (sessionId: string) => void
  session: Session
  locale: Locale
  copy: WatchCopy
  now: number
}) {
  const write = useTaskWrite(session)
  const [asking, setAsking] = useState(false)
  const [failure, setFailure] = useState<TaskFailure | null>(null)
  const status = taskStatus(task)
  const paused = task.status === 'paused'
  const credits = (count: number) => creditsText(count, locale)
  const onError = (error: unknown) => setFailure(taskFailureOf(error))
  const statusText =
    status.kind === 'next'
      ? copy.taskNext(formatAt(status.at, now, locale))
      : status.kind === 'paused'
        ? copy.taskPaused
        : status.kind === 'pausedCredits'
          ? copy.taskPausedCredits
          : status.kind === 'pausedPrice'
            ? copy.taskPausedPrice
            : null
  const priceText = paused ? copy.taskPriceNow(price) : copy.taskPrice(task.priceCredits, task.perDayCredits)
  const sessionId = task.sessionId
  return (
    <Card className={marked ? 'gap-2 border-brand-line' : 'gap-2'} onLayout={(event) => onLayoutY(event.nativeEvent.layout.y)}>
      <View className="flex-row items-start gap-2">
        <Txt variant="ui" className="flex-1" numberOfLines={2}>
          {task.name}
        </Txt>
        <Txt variant="labelSm" tone="faint">
          {task.rhythm}
        </Txt>
      </View>
      {statusText ? (
        <Txt variant="labelSm" tone={status.kind === 'pausedCredits' || status.kind === 'pausedPrice' ? 'warning' : 'faint'}>
          {statusText}
        </Txt>
      ) : null}
      <Txt variant="labelSm" tone="faint">
        {priceText}
      </Txt>
      {task.skippedAt ? (
        <Txt variant="labelSm" tone="faint">
          {copy.taskSkipped(formatAt(task.skippedAt, now, locale))}
        </Txt>
      ) : null}
      {task.last ? (
        <View className="gap-0.5 border-t border-line pt-2">
          <Txt variant="labelSm" tone="faint">
            {formatAt(task.last.at, now, locale)}
          </Txt>
          <Txt variant="body" numberOfLines={3}>
            {task.last.headline}
          </Txt>
        </View>
      ) : null}
      {failure ? (
        <Txt variant="labelSm" tone="danger" accessibilityLiveRegion="polite">
          {failure === 'limit' ? copy.taskFailure.limit(limit) : copy.taskFailure[failure]}
        </Txt>
      ) : null}
      <View className="flex-row flex-wrap gap-2 pt-1">
        {paused ? (
          <Button
            title={copy.taskResumeAt(price === null ? DASH : credits(price))}
            variant="secondary"
            size="sm"
            disabled={price === null}
            loading={write.isPending && !asking}
            onPress={() => {
              if (price === null) return
              setFailure(null)
              write.mutate({ kind: 'update', id: task.id, body: resumeBody(task, price) }, { onError })
            }}
          />
        ) : (
          <Button
            title={copy.taskPause}
            variant="secondary"
            size="sm"
            loading={write.isPending && !asking}
            onPress={() => {
              setFailure(null)
              write.mutate({ kind: 'update', id: task.id, body: pauseBody(task) }, { onError })
            }}
          />
        )}
        {sessionId ? (
          <Button title={copy.taskAnswers} variant="ghost" size="sm" onPress={() => onOpenConversation(sessionId)} />
        ) : null}
        <Button title={copy.taskRemove} variant="ghost" size="sm" disabled={write.isPending} onPress={() => setAsking(true)} />
      </View>
      <ConfirmSheet
        visible={asking}
        title={copy.taskRemoveTitle}
        body={copy.taskRemoveAsk}
        confirm={copy.taskRemove}
        cancel={copy.cancel}
        loading={write.isPending}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setFailure(null)
          write.mutate(
            { kind: 'remove', id: task.id },
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

/* ------------------------------------------------------------ a new task */

/**
 * «Нове доручення»: what to ask (a question of one's own, a token's news or move, the portfolio), how often (a rhythm
 * that does not fit the day's runs cannot be picked), «лише коли нове», where — and the price of a run and of a day,
 * shown before «Увімкнути» and sent back exactly as shown.
 */
function NewTaskSheet({
  onClose,
  read,
  available,
  session,
  locale,
  copy,
}: {
  onClose: () => void
  read: AssistantTasksResponse
  available: Channels
  session: Session
  locale: Locale
  copy: WatchCopy
}) {
  const write = useTaskWrite(session)
  const [kind, setKind] = useState<TaskKind>('news')
  const [question, setQuestion] = useState('')
  const [token, setToken] = useState<PickedToken | null>(null)
  const [chosenEvery, setEvery] = useState<AssistantTaskEvery>('1h')
  const [time, setTime] = useState(DEFAULT_DAILY_TIME)
  const [onlyNew, setOnlyNew] = useState(true)
  const [chosen, setChosen] = useState<Channels>({ telegram: true, push: true })
  const [failure, setFailure] = useState<TaskFailure | null>(null)

  const every = fittingEvery(read, chosenEvery)
  const off = tasksOff(read)
  const price = read.pricePerRun
  const perDay = rhythmOf(read, every)?.perDayCredits ?? null
  const ask = askOf(kind, question, token)
  const zone = ownZone()
  const body = off
    ? null
    : createTaskBody({
        ask,
        every,
        time,
        zone,
        locale,
        onlyWhenNew: onlyNew,
        channels: channelsToSend(chosen, available),
        shownPrice: price,
      })
  const short = question.trim().length > 0 && question.trim().length < QUESTION_MIN

  const turnOn = () => {
    if (!body || write.isPending) return
    setFailure(null)
    write.mutate(
      { kind: 'create', body },
      { onSuccess: onClose, onError: (error) => setFailure(taskFailureOf(error)) },
    )
  }

  return (
    <Sheet visible title={copy.taskNew} onClose={onClose} scroll>
      <View className="gap-5 pb-3">
        <View className="gap-2">
          <Label>{copy.taskWhat}</Label>
          <ChoiceChips
            value={kind}
            onChange={setKind}
            choices={TASK_KINDS.map((value) => ({ value, label: kindLabel(value, copy) }))}
            size="sm"
          />
        </View>
        {kind === 'question' ? (
          <Field
            label={copy.taskQuestion}
            value={question}
            onChangeText={setQuestion}
            placeholder={copy.taskQuestionPlaceholder}
            maxLength={QUESTION_MAX}
            multiline
            mono={false}
            error={short ? copy.taskQuestionNeed : null}
          />
        ) : kind === 'portfolio' ? null : (
          <View className="gap-2">
            <Label>{copy.token}</Label>
            <TokenPicker token={token} onChange={setToken} copy={copy} />
          </View>
        )}
        <View className="gap-2">
          <Label>{copy.taskHowOften}</Label>
          <ChoiceChips
            value={every}
            onChange={setEvery}
            choices={TASK_EVERY.map((value) => ({
              value,
              label: copy.taskEvery[value],
              disabled: !rhythmFits(read, value),
            }))}
            size="sm"
            quiet
          />
          {someRhythmOff(read) && !off ? (
            <Txt variant="labelSm" tone="faint">
              {copy.taskRunsLeft(read.runs.cap)}
            </Txt>
          ) : null}
        </View>
        {every === '1d' ? (
          <View className="gap-2">
            <Label>{`${copy.taskTime} · ${zone}`}</Label>
            <ChoiceChips
              value={time}
              onChange={setTime}
              choices={DAILY_TIMES.map((value) => ({ value, label: value }))}
              size="sm"
              quiet
              scroll
            />
          </View>
        ) : null}
        <View>
          <ToggleRow label={copy.taskOnlyNew} value={onlyNew} onChange={setOnlyNew} last />
        </View>
        <ChannelRows available={available} chosen={chosen} onChange={setChosen} copy={copy} />
        {off ? (
          <Txt variant="ui" tone="muted">
            {copy.taskOff}
          </Txt>
        ) : (
          <View className="gap-1">
            <Txt variant="ui">{copy.taskPriceBefore(price, perDay)}</Txt>
            <Txt variant="labelSm" tone="faint">
              {copy.taskFreeFirst}
            </Txt>
          </View>
        )}
        {failure ? (
          <Txt variant="ui" tone="danger" accessibilityLiveRegion="polite">
            {failure === 'limit' ? copy.taskFailure.limit(read.limit) : copy.taskFailure[failure]}
          </Txt>
        ) : null}
        <Button title={copy.taskTurnOn} onPress={turnOn} disabled={body === null} loading={write.isPending} />
      </View>
    </Sheet>
  )
}

/* ------------------------------------------------------------ the list */

export type TasksPanelProps = {
  session: Session
  /** A task's note (`?task=t_…`): that card in view and marked a moment. */
  taskId: string | null
  /** Where answers may go besides the Inbox, as «Стежу»'s read says; null while not read — then both are offered. */
  channels: Channels | null
  /** A task's conversation — every run's answer — opened in «Розмова». */
  onOpenConversation: (sessionId: string) => void
  /** The host's scroll: brings a point of this panel (its own top is 0 of the host's content) into view. */
  onFocusY?: (y: number) => void
}

/** How long a card a note opened stays marked. */
const MARK_MS = 2_500

/** «Доручення» (AI-19, 1.59.0) — under the watches in «Стежу»: questions Ryntra asks itself on a schedule. */
export function TasksPanel({ session, taskId, channels, onOpenConversation, onFocusY }: TasksPanelProps) {
  const copy = useCopy(WATCH_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const now = useNow(60_000)
  const tasks = useTasks(session)
  const [making, setMaking] = useState(false)
  const [marked, setMarked] = useState<string | null>(null)
  const rootY = useRef(0)
  const listY = useRef(0)
  const cardY = useRef(new Map<string, number>())
  const scrolledTo = useRef<string | null>(null)

  const read = tasks.data ?? null
  const focus = read ? focusedTask(taskId, read.tasks) : null
  useEffect(() => {
    if (!focus || scrolledTo.current === focus) return
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      const y = cardY.current.get(focus)
      if (y !== undefined) {
        scrolledTo.current = focus
        onFocusY?.(rootY.current + listY.current + y)
        setMarked(focus)
      }
      if (y !== undefined || tries >= 10) clearInterval(timer)
    }, 150)
    return () => clearInterval(timer)
  }, [focus, onFocusY])
  useEffect(() => {
    if (!marked) return
    const timer = setTimeout(() => setMarked(null), MARK_MS)
    return () => clearTimeout(timer)
  }, [marked])

  const available: Channels = channels ?? { telegram: true, push: true }
  const full = tasksFull(read)
  const off = tasksOff(read)
  return (
    <View className="gap-3 pt-2" onLayout={(event) => (rootY.current = event.nativeEvent.layout.y)}>
      <View className="flex-row items-center gap-2">
        <Txt variant="title" className="flex-1" accessibilityRole="header">
          {copy.tasksTitle}
        </Txt>
        <HelpDot title={copy.tasksHowTitle} body={copy.tasksHow} />
      </View>
      {tasks.isPending ? (
        <View className="gap-3" accessibilityRole="progressbar">
          <Skeleton className="h-24 rounded-sm" />
        </View>
      ) : tasks.isError && !read ? (
        <View className="gap-2">
          <Txt variant="ui" tone="danger">
            {copy.tasksLoadFailed}
          </Txt>
          <Button
            title={shared.tryAgain}
            variant="secondary"
            size="sm"
            loading={tasks.isFetching}
            onPress={() => void tasks.refetch()}
            style={{ alignSelf: 'flex-start' }}
          />
        </View>
      ) : read ? (
        <>
          <View className="gap-3" onLayout={(event) => (listY.current = event.nativeEvent.layout.y)}>
            {read.tasks.length === 0 ? (
              <Txt variant="body" tone="muted">
                {off ? copy.taskOff : copy.tasksNone}
              </Txt>
            ) : (
              read.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  price={read.pricePerRun}
                  limit={read.limit}
                  marked={marked === task.id}
                  onLayoutY={(y) => cardY.current.set(task.id, y)}
                  onOpenConversation={onOpenConversation}
                  session={session}
                  locale={locale}
                  copy={copy}
                  now={now}
                />
              ))
            )}
          </View>
          {full ? (
            <Txt variant="labelSm" tone="faint">
              {copy.taskFailure.limit(read.limit)}
            </Txt>
          ) : off ? null : (
            <Button title={copy.taskNew} variant="secondary" onPress={() => setMaking(true)} />
          )}
          {making ? (
            <NewTaskSheet
              onClose={() => setMaking(false)}
              read={read}
              available={available}
              session={session}
              locale={locale}
              copy={copy}
            />
          ) : null}
        </>
      ) : null}
    </View>
  )
}
