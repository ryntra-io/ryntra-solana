import { useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { QUESTION_MAX, questionOf } from '@/features/agent/agent-model'
import type { AgentCopy } from '@/features/agent/copy'
import type { ServerVoice } from '@/features/agent/use-voice'
import { clockOf, withSpokenWords } from '@/features/agent/voice'
import { creditsText } from '@/features/assistant/credits-model'
import { useLocale, type Locale } from '@/lib/i18n'
import { type, useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { formatCount } from '@/utils/format'

import { listen, speechAvailable } from '../../../modules/ryntra-speech'

export type ComposerVoice = {
  /** The language the microphone listens in — the person's choice, kept on the phone. */
  language: Locale
  onToggleLanguage: () => void
  /** The recording Ryntra's server hears (a proven wallet with credits); null — only the phone's own recognition. */
  server: ServerVoice | null
  /** The server's price of 30 seconds (`prices.voice`); null while unknown. */
  perBlock: number | null
}

export type ComposerProps = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  pending: boolean
  placeholder: string
  failure: string | null
  /** A lost connection is said quietly: the question is kept. */
  failureQuiet: boolean
  /** The count or the time under the composer — what an answer with the model costs today; null says nothing. */
  footLine: string | null
  copy: AgentCopy
  voice: ComposerVoice
}

/** Where the phone's speech to text listens. */
const SPEECH_LANGUAGE = { en: 'en-US', uk: 'uk-UA' } as const

/** The line about the voice: where it stands, what a press does, what it cost — or null when there is nothing to say. */
function voiceLine(
  server: ServerVoice | null,
  fellBack: boolean,
  heardOnPhone: boolean,
  perBlock: number | null,
  copy: AgentCopy,
  locale: Locale,
): string | null {
  if (server) {
    if (server.problem) return copy.voiceProblem[server.problem]
    switch (server.phase) {
      case 'opening':
        return copy.voiceOpening
      case 'recording':
        return copy.voiceRecording(clockOf(server.seconds))
      case 'recorded':
        return copy.voiceRecorded(clockOf(server.seconds))
      case 'hearing':
        return copy.voiceHearing
      default:
        break
    }
    if (server.spent) {
      const credits = creditsText(server.spent.credits, locale)
      return server.spent.free >= server.spent.credits && server.spent.credits > 0
        ? copy.voiceHeardFree(credits)
        : copy.voiceHeard(credits)
    }
    if (fellBack && perBlock !== null) return copy.voicePhoneFailed(creditsText(perBlock, locale))
  }
  return heardOnPhone ? copy.voiceCheck : null
}

/**
 * The words to Ryntra. The microphone opens Android's own speech-to-text screen first, in the language the person
 * chose (UA · EN beside it); where the phone has none, or it failed, a proven wallet records instead — sent to
 * Ryntra's server only on «Розпізнати · N кредитів» at the price shown. Either way the words land in the field to be
 * read and corrected — voice is input only, never sent by itself. Orange only while there are words to send.
 */
export function Composer({
  value,
  onChange,
  onSend,
  pending,
  placeholder,
  failure,
  failureQuiet,
  footLine,
  copy,
  voice,
}: ComposerProps) {
  const { colors } = useTheme()
  const locale = useLocale()
  const input = useRef<TextInput>(null)
  const [listening, setListening] = useState(false)
  // Asked once: whether this phone has a speech-to-text screen at all.
  const [canSpeak] = useState(speechAvailable)
  // The phone's recognition failed once here: the recording takes its place for this screen.
  const [fellBack, setFellBack] = useState(false)
  const [heardOnPhone, setHeardOnPhone] = useState(false)
  // The phone's screen closed with nothing heard (its own errors often close it so): the recording is offered beside it.
  const [offer, setOffer] = useState(false)
  const server = voice.server?.supported ? voice.server : null
  const recording = server !== null && (!canSpeak || fellBack) && voice.perBlock !== null
  const phase = server?.phase ?? 'idle'
  const busyVoice = listening || phase === 'opening' || phase === 'hearing'
  const canSend = !pending && questionOf(value) !== null && phase !== 'opening' && phase !== 'recording' && phase !== 'hearing'
  const offered = canSpeak || recording

  const focusField = () => setTimeout(() => input.current?.focus(), 150)

  const speak = async () => {
    if (listening || pending) return
    server?.clear()
    setOffer(false)
    setListening(true)
    const heard = await listen(SPEECH_LANGUAGE[voice.language], copy.speakPrompt)
    setListening(false)
    if (heard.kind === 'failed') {
      // The phone's own recognizer failed: the recording is offered where the wallet can pay for it.
      if (server) setFellBack(true)
      return
    }
    if (heard.kind === 'closed') {
      if (server && voice.perBlock !== null) setOffer(true)
      return
    }
    onChange(withSpokenWords(value, heard.words, QUESTION_MAX))
    setHeardOnPhone(true)
    // The words are the person's to read and edit before anything is sent.
    focusField()
  }

  const press = () => {
    if (!recording) {
      void speak()
      return
    }
    if (phase === 'recording') server?.stop()
    else if (phase === 'idle') server?.start()
  }

  const offerShown = offer && !recording && server !== null && voice.perBlock !== null
  const line = offerShown
    ? copy.voiceOffer(creditsText(voice.perBlock ?? 0, locale))
    : voiceLine(recording ? server : null, fellBack, heardOnPhone, voice.perBlock, copy, locale)
  const problem = recording && server?.problem !== null && server?.problem !== undefined
  const micIcon = phase === 'recording' ? 'stop-circle-outline' : listening ? 'mic' : 'mic-outline'
  const micLabel = recording ? (phase === 'recording' ? copy.voiceRecordStop : copy.voiceRecord) : copy.speak

  return (
    <View className="gap-1.5 border-t border-line bg-ground px-4 pb-3 pt-3">
      {failure ? (
        <Txt variant="ui" tone={failureQuiet ? 'muted' : 'danger'}>
          {failure}
        </Txt>
      ) : null}
      <View className="flex-row items-end gap-2">
        <View className="flex-1 flex-row items-end rounded-btn border border-line bg-surface pl-3" style={{ minHeight: 44 }}>
          <TextInput
            ref={input}
            value={value}
            onChangeText={(next) => {
              onChange(next)
              if (server?.problem || server?.spent) server.clear()
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.fgMuted}
            selectionColor={colors.brand}
            cursorColor={colors.brand}
            multiline
            maxLength={QUESTION_MAX}
            editable={!pending}
            accessibilityLabel={placeholder}
            className="flex-1 text-fg"
            style={[type.body, { paddingVertical: 10, maxHeight: 120 }]}
          />
          {offered ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.voiceLangSwitch(voice.language)}
                disabled={busyVoice || phase === 'recording'}
                onPress={voice.onToggleLanguage}
                hitSlop={4}
                className="h-11 items-center justify-center px-1 active:opacity-70"
              >
                <Txt variant="labelSm" tone="faint">
                  {copy.voiceLang(voice.language)}
                </Txt>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={micLabel}
                accessibilityState={{ disabled: pending || busyVoice, busy: busyVoice || phase === 'recording' }}
                disabled={pending || busyVoice || phase === 'recorded'}
                onPress={press}
                hitSlop={4}
                className="h-11 w-11 items-center justify-center active:opacity-70"
              >
                <Icon name={micIcon} size={20} color={phase === 'recording' ? 'brand' : 'muted'} />
              </Pressable>
            </>
          ) : (
            <View style={{ width: 12 }} />
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.ask}
          accessibilityState={{ disabled: !canSend, busy: pending }}
          disabled={!canSend}
          onPress={() => {
            setHeardOnPhone(false)
            // A recording still waiting for «Розпізнати» is let go: the field's words are what is asked.
            if (phase === 'recorded') server?.cancel()
            server?.clear()
            onSend()
          }}
          className={cn(
            'h-11 w-11 items-center justify-center rounded-btn',
            canSend ? 'bg-brand active:bg-brand-pressed' : 'border border-line bg-surface',
          )}
        >
          <Icon name="arrow-up" size={22} color={canSend ? 'onBrand' : 'muted'} />
        </Pressable>
      </View>
      {offerShown && server ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.voiceRecord}
          onPress={() => {
            setOffer(false)
            setFellBack(true)
            server.start()
          }}
          className="h-9 flex-row items-center gap-1.5 self-start rounded-btn border border-line bg-surface px-3 active:bg-hover"
        >
          <Icon name="radio-button-on-outline" size={16} color="muted" />
          <Txt variant="ui">{copy.voiceRecordInstead}</Txt>
        </Pressable>
      ) : null}
      {recording && server && (phase === 'recorded' || phase === 'hearing') ? (
        <View className="flex-row items-center gap-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.voiceHear(server.price === null ? '—' : creditsText(server.price, locale))}
            accessibilityState={{ disabled: phase === 'hearing' || server.price === null, busy: phase === 'hearing' }}
            disabled={phase === 'hearing' || server.price === null}
            onPress={server.hear}
            className="h-9 flex-row items-center rounded-btn border border-line bg-surface px-3 active:bg-hover"
          >
            <Txt variant="ui">{server.price === null ? copy.voiceHear('—') : copy.voiceHear(creditsText(server.price, locale))}</Txt>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.voiceDiscard}
            disabled={phase === 'hearing'}
            onPress={server.cancel}
            hitSlop={6}
            className="py-1 active:opacity-70"
          >
            <Txt variant="ui" tone="muted">
              {copy.voiceDiscard}
            </Txt>
          </Pressable>
        </View>
      ) : null}
      {/* The voice's own line above, the next question's price always below it: neither hides the other. */}
      {line ? (
        <Txt
          variant="labelSm"
          tone={problem ? 'danger' : 'faint'}
          numberOfLines={3}
          accessibilityLiveRegion={phase === 'recording' ? 'none' : 'polite'}
        >
          {line}
        </Txt>
      ) : null}
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="labelSm" tone="faint" className="flex-1" numberOfLines={2}>
          {footLine ?? ''}
        </Txt>
        {value.length > QUESTION_MAX - 200 ? (
          <Txt variant="labelSm" tone="faint">
            {`${formatCount(value.length, locale)} / ${formatCount(QUESTION_MAX, locale)}`}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}
