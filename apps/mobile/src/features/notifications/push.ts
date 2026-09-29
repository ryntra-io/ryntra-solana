/**
 * The phone's push side, behind one small interface: permission, the
 * provider's device token, the taps and the arrivals. The implementation
 * is `expo-notifications` over Firebase Cloud Messaging — the provider the
 * server delivers through. Without the Owner's Firebase client
 * configuration in the build the token cannot be read and the phone says
 * so honestly; everything else (the inbox, the taps, the preferences)
 * works without it. No token is ever logged.
 */

import * as Notifications from 'expo-notifications'
import { Linking, Platform } from 'react-native'

import { linkOfNotificationData } from '@/features/monitoring/deep-link'

export type PushPermission = 'granted' | 'denied' | 'undetermined'

export type PushTokenRead =
  Readonly<{ ok: true; token: string }> | Readonly<{ ok: false; reason: 'no-config' | 'failed' }>

/** A tap on a note: the link the server put in it, and an id to handle it once. */
export type PushTap = Readonly<{ id: string; link: string | null; at: number }>

export type PushDevice = Readonly<{
  permission: () => Promise<PushPermission>
  requestPermission: () => Promise<PushPermission>
  token: () => Promise<PushTokenRead>
  onToken: (listener: (token: string) => void) => () => void
  onTap: (listener: (tap: PushTap) => void) => () => void
  lastTap: () => PushTap | null
  clearLastTap: () => void
  onReceived: (listener: () => void) => () => void
  /** The channel a plan's note is shown on; created once, idempotent. */
  ensureChannel: () => Promise<void>
  openSystemSettings: () => Promise<void>
}>

export const PLAN_CHANNEL_ID = 'plans'

/** Android reports a permission never asked for as denied-but-askable; only a refusal the system will not ask about again is a denial. */
function permissionOf(status: Readonly<{ status: string; granted: boolean; canAskAgain?: boolean }>): PushPermission {
  if (status.granted || status.status === 'granted') return 'granted'
  if (status.status === 'denied' && status.canAskAgain === false) return 'denied'
  return 'undetermined'
}

function tapOf(response: Notifications.NotificationResponse): PushTap {
  const request = response.notification.request
  return {
    id: `${request.identifier}:${response.notification.date}`,
    link: linkOfNotificationData(request.content.data),
    at: Date.now(),
  }
}

/** A rejection from the token read that means the build carries no Firebase client configuration. */
export function isMissingConfig(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '')
  return /googleServicesFile|FirebaseApp|Firebase Messaging instance|fcm-credentials/i.test(text)
}

let handlerSet = false

/** A note that arrives while the app is open is shown the same way as one that arrives while it is closed. */
function ensureForegroundHandler() {
  if (handlerSet) return
  handlerSet = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })
}

/**
 * A note shown by the phone itself, shaped exactly as the server's push
 * (the title, the label-and-title body, the link in the data) — for the
 * development gallery to walk the tap path without a provider. Never
 * called from a product screen.
 */
export async function postLocalNote(input: Readonly<{ title: string; body: string; link: string }>): Promise<void> {
  ensureForegroundHandler()
  // Android 13+ shows nothing without the permission; the gallery asks for it the way the settings screen would.
  const granted = await Notifications.getPermissionsAsync()
  if (!granted.granted) await Notifications.requestPermissionsAsync()
  await Notifications.scheduleNotificationAsync({
    content: { title: input.title, body: input.body, data: { link: input.link } },
    trigger: null,
  })
}

export const pushDevice: PushDevice = {
  permission: async () => permissionOf(await Notifications.getPermissionsAsync()),
  requestPermission: async () => permissionOf(await Notifications.requestPermissionsAsync()),
  token: async () => {
    try {
      const read = await Notifications.getDevicePushTokenAsync()
      const token = typeof read.data === 'string' ? read.data.trim() : ''
      return token.length >= 16 ? { ok: true, token } : { ok: false, reason: 'failed' }
    } catch (error) {
      return { ok: false, reason: isMissingConfig(error) ? 'no-config' : 'failed' }
    }
  },
  onToken: (listener) => {
    const subscription = Notifications.addPushTokenListener((token) => {
      if (typeof token.data === 'string' && token.data.length >= 16) listener(token.data)
    })
    return () => subscription.remove()
  },
  onTap: (listener) => {
    ensureForegroundHandler()
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => listener(tapOf(response)))
    return () => subscription.remove()
  },
  lastTap: () => {
    const response = Notifications.getLastNotificationResponse()
    return response ? tapOf(response) : null
  },
  clearLastTap: () => {
    try {
      Notifications.clearLastNotificationResponse()
    } catch {
      // Nothing to clear.
    }
  },
  onReceived: (listener) => {
    ensureForegroundHandler()
    const subscription = Notifications.addNotificationReceivedListener(() => listener())
    return () => subscription.remove()
  },
  ensureChannel: async () => {
    if (Platform.OS !== 'android') return
    ensureForegroundHandler()
    try {
      await Notifications.setNotificationChannelAsync(PLAN_CHANNEL_ID, {
        name: 'Plans',
        description: 'A plan of yours needs attention.',
        importance: Notifications.AndroidImportance.HIGH,
        enableVibrate: true,
        showBadge: true,
      })
    } catch {
      // The channel is a courtesy; a note without it still shows on the default one.
    }
  },
  openSystemSettings: async () => {
    try {
      await Linking.openSettings()
    } catch {
      // The settings app refused; nothing else to do.
    }
  },
}
