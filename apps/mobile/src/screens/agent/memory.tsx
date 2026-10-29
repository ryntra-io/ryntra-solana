import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Field, ToggleRow } from '@/components/field'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { MEMORY_COPY, type MemoryCopy } from '@/features/assistant/memory-copy'
import {
  ABOUT_MAX,
  memoryFailureOf,
  NOTE_MAX,
  NOTE_MIN,
  noteSourceText,
  notesNewestFirst,
  profileSummary,
  walletLine,
} from '@/features/assistant/memory-model'
import { useForgetAll, useForgetNote, useMemory, useWriteMemory } from '@/features/assistant/use-memory'
import { useNow } from '@/hooks/use-now'
import type { AssistantMemoryNote, AssistantMemoryResponse, Session } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { formatMoment } from '@/utils/format'

export type KnowsSheetProps = {
  visible: boolean
  onClose: () => void
  session: Session
  /** «Змінити» the answers of «Знайомство». */
  onChangeProfile: () => void
}

/** A failed write in words: a secret said plainly, anything else as the memory not reachable now. */
function failureText(error: unknown, copy: MemoryCopy, needsNetwork: string): string {
  const failure = memoryFailureOf(error)
  return failure === 'secret' ? copy.memSecret : failure === 'network' ? needsNetwork : copy.memFailed
}

/** A label over its part, small caps as every section label. */
function Label({ children }: { children: string }) {
  return (
    <Txt variant="labelSm" tone="faint" caps>
      {children}
    </Txt>
  )
}

/** One note: the person's words, where they came from and when, «Забути». */
function NoteRow({
  note,
  copy,
  locale,
  now,
  busy,
  onForget,
}: {
  note: AssistantMemoryNote
  copy: MemoryCopy
  locale: Locale
  now: number
  busy: boolean
  onForget: () => void
}) {
  return (
    <View className="flex-row items-center gap-2 border-b border-line py-3">
      <View className="flex-1 gap-1">
        <Txt variant="body" selectable>
          {note.text}
        </Txt>
        <Txt variant="labelSm" tone="faint" numberOfLines={1}>
          {`${noteSourceText(note.source, locale)} · ${formatMoment(note.at, now, locale)}`}
        </Txt>
      </View>
      <Button
        title={copy.memForget}
        variant="ghost"
        size="sm"
        disabled={busy}
        accessibilityLabel={`${copy.memForget}: ${note.text}`}
        onPress={onForget}
      />
    </View>
  )
}

/** The sheet's body once the memory is read. */
function Knows({
  read,
  session,
  copy,
  locale,
  onChangeProfile,
}: {
  read: AssistantMemoryResponse
  session: Session
  copy: MemoryCopy
  locale: Locale
  onChangeProfile: () => void
}) {
  const shared = useSharedCopy()
  const now = useNow(60_000)
  const write = useWriteMemory(session)
  const forget = useForgetNote(session)
  const forgetAll = useForgetAll(session)
  // «Про мене» as typed; null — the field follows the record.
  const [aboutDraft, setAboutDraft] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [confirmAll, setConfirmAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = write.isPending || forget.isPending || forgetAll.isPending

  const about = aboutDraft ?? read.about ?? ''
  const aboutDirty = about.trim() !== (read.about ?? '')
  const fail = (caught: unknown) => setError(failureText(caught, copy, shared.needsNetwork))
  const run = <T,>(mutate: (options: { onSuccess: () => void; onError: (caught: unknown) => void }) => T, after?: () => void) => {
    if (busy) return
    setError(null)
    mutate({ onSuccess: () => after?.(), onError: fail })
  }

  const summary = profileSummary(read.profile, locale)
  const notes = notesNewestFirst(read.notes)

  return (
    <View className="gap-5 pb-4">
      <Txt variant="ui" tone="muted">
        {copy.memLead}
      </Txt>

      <View className="gap-1">
        <Label>{copy.memProfile}</Label>
        <View className="flex-row items-center gap-2">
          <Txt variant="body" className="flex-1">
            {summary ?? (read.profile?.skipped ? copy.memProfileSkipped : copy.memProfileNone)}
          </Txt>
          <Button title={copy.memChange} variant="secondary" size="sm" onPress={onChangeProfile} />
        </View>
      </View>

      <View className="gap-2">
        <Field
          label={copy.memAbout}
          value={about}
          onChangeText={setAboutDraft}
          placeholder={copy.memAboutPlaceholder}
          maxLength={ABOUT_MAX}
          multiline
          mono={false}
          hint={`${about.length} / ${ABOUT_MAX}`}
        />
        {aboutDirty ? (
          <Button
            title={copy.memSave}
            variant="secondary"
            size="sm"
            className="self-end"
            loading={write.isPending}
            onPress={() =>
              run(
                (options) => write.mutate({ about: about.trim().length > 0 ? about.trim() : null }, options),
                () => setAboutDraft(null),
              )
            }
          />
        ) : null}
      </View>

      <View>
        <Label>{copy.memNotes}</Label>
        <ToggleRow
          label={copy.memNoticing}
          hint={copy.memNoticingHint}
          value={read.noticing}
          onChange={(noticing) => run((options) => write.mutate({ noticing }, options))}
        />
        {notes.length === 0 ? (
          <Txt variant="ui" tone="muted" className="py-3">
            {copy.memNoNotes}
          </Txt>
        ) : (
          notes.map((item) => (
            <NoteRow
              key={item.id}
              note={item}
              copy={copy}
              locale={locale}
              now={now}
              busy={busy}
              onForget={() => run((options) => forget.mutate(item.id, options))}
            />
          ))
        )}
        <View className="flex-row items-end gap-2 pt-3">
          <Field
            label={copy.memAddLabel}
            value={note}
            onChangeText={setNote}
            placeholder={copy.memAddPlaceholder}
            maxLength={NOTE_MAX}
            mono={false}
            className="flex-1"
            returnKeyType="done"
          />
          <Button
            title={copy.memAdd}
            variant="secondary"
            disabled={note.trim().length < NOTE_MIN}
            loading={write.isPending && note.trim().length >= NOTE_MIN}
            onPress={() => run((options) => write.mutate({ note: note.trim() }, options), () => setNote(''))}
          />
        </View>
      </View>

      <Txt variant="labelSm" tone="faint">
        {walletLine(read.wallet, locale)}
      </Txt>

      {error ? (
        <Txt variant="ui" tone="danger" accessibilityRole="alert">
          {error}
        </Txt>
      ) : null}

      {confirmAll ? (
        <View className="gap-2">
          <Txt variant="ui">{copy.memForgetAllAsk}</Txt>
          <View className="flex-row gap-2">
            <Button
              title={copy.memForgetAllYes}
              variant="danger"
              size="sm"
              loading={forgetAll.isPending}
              onPress={() =>
                run(
                  (options) => forgetAll.mutate(undefined, options),
                  () => {
                    setConfirmAll(false)
                    setAboutDraft(null)
                  },
                )
              }
            />
            <Button title={copy.memForgetAllNo} variant="ghost" size="sm" onPress={() => setConfirmAll(false)} />
          </View>
        </View>
      ) : read.about || read.notes.length > 0 ? (
        <Button title={copy.memForgetAll} variant="ghost" size="sm" className="self-start" onPress={() => setConfirmAll(true)} />
      ) : null}
    </View>
  )
}

/** «Що Ryntra знає про тебе» (1.59.0): «Про мене», the notes with their source and «Забути», «Помічати», «Забути все». */
export function KnowsSheet({ visible, onClose, session, onChangeProfile }: KnowsSheetProps) {
  const copy = useCopy(MEMORY_COPY)
  const locale = useLocale()
  const shared = useSharedCopy()
  const memory = useMemory(session, visible)

  let body
  if (memory.data) {
    body = (
      <Knows
        read={memory.data}
        session={session}
        copy={copy}
        locale={locale}
        onChangeProfile={() => {
          onClose()
          onChangeProfile()
        }}
      />
    )
  } else if (memory.isError) {
    body = (
      <View className="items-start gap-3 pb-4">
        <Txt variant="ui" tone="danger">
          {copy.memFailed}
        </Txt>
        <Button
          title={shared.tryAgain}
          variant="secondary"
          size="sm"
          loading={memory.isFetching}
          onPress={() => void memory.refetch()}
        />
      </View>
    )
  } else {
    body = (
      <View className="gap-3 pb-4" accessibilityRole="progressbar">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-24 rounded-sm" />
        <Skeleton className="h-16 rounded-sm" />
      </View>
    )
  }

  return (
    <Sheet visible={visible} title={copy.memTitle} onClose={onClose} scroll>
      {body}
    </Sheet>
  )
}

export type RememberedLineProps = {
  session: Session
  /** The notes a message just left — said under the conversation with «Забути»; nothing is kept unseen. */
  notes: readonly AssistantMemoryNote[]
  onDismiss: () => void
}

/** «Запам'ятала: «…» · Забути» — under the conversation, after a message left a note. */
export function RememberedLine({ session, notes, onDismiss }: RememberedLineProps) {
  const copy = useCopy(MEMORY_COPY)
  const shared = useSharedCopy()
  const forget = useForgetNote(session)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (notes.length === 0) return null

  const forgetAll = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      for (const item of notes) await forget.mutateAsync(item.id)
      onDismiss()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className="flex-row items-center gap-2 rounded-btn border border-line bg-surface py-1 pl-3" accessibilityRole="summary">
      <Icon name="bookmark-outline" size={14} color="fgMuted" />
      <Txt variant="labelSm" tone={failed ? 'danger' : 'muted'} className="flex-1" numberOfLines={2}>
        {failed ? copy.memFailed : `${copy.memRemembered} «${notes.map((item) => item.text).join('», «')}»`}
      </Txt>
      <Button title={copy.memForget} variant="ghost" size="sm" loading={busy} onPress={() => void forgetAll()} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shared.close}
        onPress={onDismiss}
        hitSlop={8}
        className="h-9 w-9 items-center justify-center rounded-btn active:bg-hover"
      >
        <Icon name="close" size={16} color="muted" />
      </Pressable>
    </View>
  )
}
