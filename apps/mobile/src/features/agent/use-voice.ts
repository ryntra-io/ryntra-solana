import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { ApiError, assistantApi, type AssistantCredits, type Session } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import { readPreference, writePreference } from '@/lib/preferences'

import { cancelRecording, recordingAvailable, startRecording, stopRecording } from '../../../modules/ryntra-speech'

import {
  RECORDING_MAX_SECONDS,
  recordingCredits,
  recordingId,
  recordingKept,
  recordingProblemOf,
  speechLanguage,
  type RecordingProblem,
} from './voice'

const VOICE_LANGUAGE_KEY = 'ryntra.voice-language.v1'

/** The phone's own language tag, as the system names it. */
function deviceTag(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale ?? ''
  } catch {
    return ''
  }
}

/** The language the microphone listens in, and its switch — the choice kept on this phone. */
export function useVoiceLanguage(appLocale: Locale): readonly [Locale, () => void] {
  const [language, setLanguage] = useState<Locale>(() =>
    speechLanguage(appLocale, deviceTag(), readPreference<'en' | 'uk' | ''>(VOICE_LANGUAGE_KEY, ['en', 'uk'], '') || null),
  )
  const toggle = useCallback(() => {
    setLanguage((current) => {
      const next: Locale = current === 'uk' ? 'en' : 'uk'
      writePreference(VOICE_LANGUAGE_KEY, next)
      return next
    })
  }, [])
  return [language, toggle] as const
}

/** `opening` — the phone asks the person for the microphone; nothing is recorded yet. */
export type RecordingPhase = 'idle' | 'opening' | 'recording' | 'recorded' | 'hearing'

export type ServerVoice = Readonly<{
  /** False in a build that cannot record: no fallback is offered there. */
  supported: boolean
  phase: RecordingPhase
  /** The seconds recorded so far, or of the recording waiting to be heard. */
  seconds: number
  /** What hearing the recording waiting costs, shown on its button; null while the price is unknown. */
  price: number | null
  problem: RecordingProblem | null
  /** Credits taken for the last recording heard, and how many of them were the day's free ones. */
  spent: Readonly<{ credits: number; free: number }> | null
  start: () => void
  stop: () => void
  hear: () => void
  cancel: () => void
  clear: () => void
}>

type Clip = Readonly<{ audio: string; mime: string; seconds: number; id: string }>

function randomBytes(bytes: Uint8Array): Uint8Array {
  const source = (globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }).crypto
  if (source?.getRandomValues) return source.getRandomValues(bytes)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return bytes
}

/**
 * The paid fallback of the field's microphone (AI-08, 1.64.0): a recording made on the phone, sent to Ryntra's server
 * only by «Розпізнати · N кредитів» — the price shown before anything is sent, `prices.voice` for each started 30 s —
 * and heard there. What comes back is written after the field's words for the person to correct; nothing is asked
 * without «Спитати». `onCredits` gets the credits after a recording was sent (null — read them again).
 */
export function useServerVoice({
  session,
  locale,
  perBlock,
  onWords,
  onCredits,
  disabled,
}: {
  session: Session | null
  locale: Locale
  perBlock: number | null
  onWords: (words: string) => void
  onCredits: (credits: AssistantCredits | null) => void
  disabled: boolean
}): ServerVoice {
  const [phase, setPhase] = useState<RecordingPhase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [problem, setProblem] = useState<RecordingProblem | null>(null)
  const [spent, setSpent] = useState<ServerVoice['spent']>(null)
  const clip = useRef<Clip | null>(null)
  const stopping = useRef(false)
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef(0)
  const live = useRef(true)
  const latest = useRef({ onWords, onCredits })
  useEffect(() => {
    latest.current = { onWords, onCredits }
  })
  const [supported] = useState(recordingAvailable)

  const stopTicker = () => {
    if (ticker.current) clearInterval(ticker.current)
    ticker.current = null
  }

  const cancel = useCallback(() => {
    stopTicker()
    cancelRecording()
    clip.current = null
    setPhase('idle')
    setSeconds(0)
  }, [])

  const stop = useCallback(() => {
    if (phase !== 'recording') {
      if (phase === 'opening') cancel()
      return
    }
    // One stop per recording: the clock's two minutes, the app leaving and a press may meet.
    if (stopping.current) return
    stopping.current = true
    stopTicker()
    void stopRecording().then((recorded) => {
      stopping.current = false
      if (!live.current) return
      if (!recorded) {
        setPhase('idle')
        setSeconds(0)
        setProblem('silence')
        return
      }
      const length = Math.min(RECORDING_MAX_SECONDS, Math.max(1, recorded.seconds))
      clip.current = { audio: recorded.audio, mime: recorded.mime, seconds: length, id: recordingId(randomBytes) }
      setSeconds(length)
      setPhase('recorded')
    })
  }, [phase, cancel])

  // The clock the person sees; at two minutes the recording ends by itself.
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  })
  const start = useCallback(() => {
    if (disabled || phase !== 'idle') return
    setProblem(null)
    setSpent(null)
    clip.current = null
    setSeconds(0)
    setPhase('opening')
    void startRecording().then((started) => {
      if (!live.current) {
        if (started === 'recording') cancelRecording()
        return
      }
      if (started !== 'recording') {
        setPhase('idle')
        setProblem(started === 'denied' ? 'denied' : 'recorder')
        return
      }
      startedAt.current = Date.now()
      setPhase('recording')
      stopTicker()
      ticker.current = setInterval(() => {
        const elapsed = (Date.now() - startedAt.current) / 1000
        setSeconds(Math.min(RECORDING_MAX_SECONDS, Math.floor(elapsed)))
        if (elapsed >= RECORDING_MAX_SECONDS) stopRef.current()
      }, 250)
    })
  }, [disabled, phase])

  // The app sent to the background ends the recording where it stands: it waits for «Розпізнати», nothing more is heard.
  const phaseRef = useRef(phase)
  useEffect(() => {
    phaseRef.current = phase
  })
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && phaseRef.current === 'recording') stopRef.current()
    })
    return () => listener.remove()
  }, [])

  // A screen that goes away lets the microphone go and keeps nothing.
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      stopTicker()
      cancelRecording()
    }
  }, [])

  const price = perBlock === null ? null : recordingCredits(Math.max(1, seconds), perBlock)

  const hear = useCallback(() => {
    const waiting = clip.current
    if (!waiting || phase !== 'recorded' || price === null || disabled || !session) return
    setPhase('hearing')
    setProblem(null)
    void assistantApi
      .voice(session, {
        id: waiting.id,
        audio: waiting.audio,
        mime: waiting.mime,
        seconds: waiting.seconds,
        locale,
        acceptCredits: price,
      })
      .then((heard) => {
        if (!live.current || clip.current !== waiting) return
        latest.current.onWords(heard.text)
        latest.current.onCredits(heard.credits ?? null)
        clip.current = null
        setSpent({ credits: heard.spent ?? price, free: heard.free ?? 0 })
        setPhase('idle')
        setSeconds(0)
      })
      .catch((error: unknown) => {
        if (!live.current || clip.current !== waiting) return
        // No answer: the recording waits; sent again under its own id, it is never charged twice.
        const found = error instanceof ApiError ? recordingProblemOf(error.code) : 'failed'
        setProblem(found)
        // A price that moved, credits short, the day's ceiling: the figures are read again before the next press.
        if (found === 'priceChanged' || found === 'noCredits' || found === 'dayCap') latest.current.onCredits(null)
        if (recordingKept(found)) {
          setPhase('recorded')
          return
        }
        clip.current = null
        setPhase('idle')
        setSeconds(0)
      })
  }, [disabled, locale, phase, price, session])

  const clear = useCallback(() => {
    setProblem(null)
    setSpent(null)
  }, [])

  return { supported, phase, seconds, price, problem, spent, start, stop, hear, cancel, clear }
}
