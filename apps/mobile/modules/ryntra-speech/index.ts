import { requireOptionalNativeModule } from 'expo'
import { PermissionsAndroid } from 'react-native'

type Recorded = Readonly<{ audio: string; mime: string; seconds: number }>

type RyntraSpeechNative = {
  isAvailable(): boolean
  listen(language: string, prompt: string): Promise<string | null>
  startRecording?(): Promise<boolean>
  stopRecording?(): Promise<Recorded | null>
  cancelRecording?(): void
}

/** Absent in a build made before the module (an older dev client): the microphone is then not offered. */
const native = requireOptionalNativeModule<RyntraSpeechNative>('RyntraSpeech')

/** Whether this phone has a speech-to-text screen the app can open. */
export function speechAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false
  } catch {
    return false
  }
}

/**
 * What Android's speech-to-text screen gave back: the words heard; `closed` — the person closed it or nothing was
 * heard; `failed` — the recognizer itself failed (no network for it, no language pack): the recording is offered.
 */
export type Heard =
  Readonly<{ kind: 'words'; words: string }> | Readonly<{ kind: 'closed' }> | Readonly<{ kind: 'failed' }>

/**
 * Android's own speech-to-text screen in the given language (`uk-UA`, `en-US`). Voice is input only — the words are
 * the person's to read and edit.
 */
export async function listen(language: string, prompt: string): Promise<Heard> {
  if (!native) return { kind: 'failed' }
  try {
    const heard = await native.listen(language, prompt)
    if (heard === null || heard === undefined) return { kind: 'failed' }
    const words = heard.trim()
    return words ? { kind: 'words', words } : { kind: 'closed' }
  } catch {
    return { kind: 'failed' }
  }
}

/** Whether this build can record (a dev client older than the recording has `listen` only). */
export function recordingAvailable(): boolean {
  return typeof native?.startRecording === 'function'
}

/** Why the recording did not start: the person did not allow the microphone, or the microphone did not open. */
export type RecordStart = 'recording' | 'denied' | 'failed'

/**
 * The microphone for a recording: the permission asked here, on the person's own press, never before; then the
 * recording starts. At two minutes the phone stops writing by itself.
 */
export async function startRecording(): Promise<RecordStart> {
  if (!native?.startRecording) return 'failed'
  try {
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return 'denied'
    return (await native.startRecording()) ? 'recording' : 'failed'
  } catch {
    return 'failed'
  }
}

/** The recording ended: its bytes (base64), type and whole seconds — the file is already deleted; null when empty. */
export async function stopRecording(): Promise<Recorded | null> {
  if (!native?.stopRecording) return null
  try {
    return await native.stopRecording()
  } catch {
    return null
  }
}

/** The recording let go: nothing kept. */
export function cancelRecording(): void {
  try {
    native?.cancelRecording?.()
  } catch {
    // nothing was recording
  }
}
