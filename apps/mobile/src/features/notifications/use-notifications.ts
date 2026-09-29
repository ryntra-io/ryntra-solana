import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'

import { useUpdatePreferences } from '@/features/monitoring/use-monitoring'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { listDevices, registerDevice, revokeDevice, type QuietHours, type Session } from '@/lib/api'
import type { Locale } from '@/lib/i18n'

import { phoneState, recordOf, registrationOf, type DeviceRecord, type PhoneState } from './device-registry'
import { clearDeviceRecord, readDeviceRecord, useDeviceRecord, writeDeviceRecord } from './device-store'
import { pushDevice, type PushPermission } from './push'

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'

const PHONE_KEY = ['phone-push'] as const

/** What the phone can do right now: the permission and whether the provider hands a token — read once, re-read on demand. */
export function usePhoneCapability() {
  return useQuery({
    queryKey: PHONE_KEY,
    queryFn: async () => {
      const permission = await pushDevice.permission()
      const token = await pushDevice.token()
      return { permission, tokenAvailable: token.ok, reason: token.ok ? null : token.reason }
    },
    staleTime: 60_000,
    retry: 0,
  })
}

/**
 * Register this phone for the session's wallet: ask Android for the
 * permission when it was never asked, read the provider's token, tell the
 * server, keep the record. Phone notes switched off for the wallet on the
 * web are switched back on, since that is what the tap means.
 */
export function useEnablePhone(
  session: Session | null,
  locale: Locale,
  quietHours: QuietHours | null,
  serverPush: boolean | null,
) {
  const queryClient = useQueryClient()
  const preferences = useUpdatePreferences(session)
  const updatePreferences = preferences.mutateAsync
  return useMutation({
    mutationFn: async (): Promise<PhoneState> => {
      if (!session) return 'off'
      // The provider's token first: a build without the Firebase client configuration has nothing to register,
      // so Android is not asked for a permission the phone could not use.
      const read = await pushDevice.token()
      if (!read.ok) return read.reason === 'no-config' ? 'off_no_config' : 'off'
      let permission: PushPermission = await pushDevice.permission()
      // The system decides whether it may ask again after a refusal; the answer is taken as it comes.
      if (permission !== 'granted') permission = await pushDevice.requestPermission()
      if (permission !== 'granted') return 'off_permission'
      const registration = registrationOf({ token: read.token, appVersion: APP_VERSION, locale, quietHours })
      const answer = await registerDevice(session, registration)
      writeDeviceRecord(recordOf(registration, answer, session.address, Date.now()))
      if (serverPush === false) await updatePreferences({ push: true })
      return 'on'
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PHONE_KEY }),
  })
}

/**
 * Stop notes reaching this phone: the server forgets the device first, then
 * the phone forgets the record — never the other way round, so the toggle
 * is not shown off while the server would still push here. Idempotent.
 */
export function useDisablePhone(session: Session | null) {
  return useMutation({
    mutationFn: async () => {
      if (!session) return
      const record = readDeviceRecord(session.address)
      if (!record) return
      await revokeDevice(session, record.deviceId)
      clearDeviceRecord(session.address)
    },
  })
}

/** The phone's own registration record for this wallet — a screen never sees another wallet's. */
export function usePhoneRecord(session: Session | null): DeviceRecord | null {
  return useDeviceRecord(session?.address ?? null)
}

/**
 * The server's list of this wallet's devices — read on the preferences
 * screen so a record the server no longer holds (revoked from the web) is
 * dropped from the phone instead of pretending.
 */
export function useServerDevices(session: Session | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'devices', session?.address ?? ''],
    queryFn: ({ signal }) => listDevices(session!, signal),
    enabled: session !== null,
    staleTime: 30_000,
    retry: 1,
  })
}

export function usePhoneState(
  session: Session | null,
  serverPush: boolean | null,
): { state: PhoneState; record: DeviceRecord | null } {
  const record = usePhoneRecord(session)
  const capability = usePhoneCapability()
  const state = phoneState({
    record,
    permission: capability.data?.permission ?? null,
    tokenAvailable: capability.data?.tokenAvailable ?? null,
    serverPush,
  })
  return { state, record }
}
