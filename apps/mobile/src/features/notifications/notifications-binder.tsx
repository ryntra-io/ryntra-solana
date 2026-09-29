import { useQueryClient } from '@tanstack/react-query'
import { useRootNavigationState, useRouter, type Href } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { recordJourney } from '@/features/journeys/journey-store'
import { mapDeepLink } from '@/features/monitoring/deep-link'
import { useSurface } from '@/features/plans/use-plans'
import { useSession } from '@/features/session/session-store'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { registerDevice, type Session } from '@/lib/api'
import { useLocale } from '@/lib/i18n'

import { OnceSet, recordOf, registrationNeeded } from './device-registry'
import { readDeviceRecord, writeDeviceRecord } from './device-store'
import { pushDevice, type PushTap } from './push'
import { APP_VERSION } from './use-notifications'

const MONITORING_KEY = [PRIVATE_QUERY_KEY, 'monitoring'] as const
/** A return to the foreground re-reads the inbox no more often than this. */
const REFRESH_AFTER_MS = 20_000

const handled = new OnceSet()

/**
 * Binds the phone's push side to the session: the taps, the arrivals, the
 * device's registration. A tap opens what the note's link names through
 * the one mapper — the exact plan, never a Review, never a signature. An
 * arrival re-reads the inbox from the server; nothing is counted or kept
 * on the phone. The registration is refreshed when the token, the version,
 * the language or the quiet hours change, only for the wallet whose bearer
 * is live, and only while a record for that wallet exists (the person
 * turned this phone on).
 */
export function NotificationsBinder() {
  const { session } = useSession()
  const locale = useLocale()
  const router = useRouter()
  const navigation = useRootNavigationState()
  const queryClient = useQueryClient()
  const surface = useSurface(session, locale)
  const surfaceRead = surface !== null
  const quiet = surface?.preferences.quietHours ?? null
  // The window as a value, so a re-read of the surface that changed nothing re-registers nothing.
  const quietKey = quiet ? `${quiet.start}|${quiet.end}|${quiet.timezone}` : ''
  const ready = Boolean(navigation?.key)
  const lastRefresh = useRef(0)
  const pending = useRef<PushTap | null>(null)

  // The channel and the foreground handler, once.
  useEffect(() => {
    void pushDevice.ensureChannel()
  }, [])

  // A tap: the launch's own, then every later one; each handled once.
  useEffect(() => {
    const open = (tap: PushTap) => {
      if (!handled.take(tap.id)) return
      if (!tap.link) return
      const mapped = mapDeepLink(tap.link)
      recordJourney('note_tap', { target: mapped.kind })
      if (mapped.kind === 'unknown') return
      router.navigate(mapped.path as Href)
    }
    const deliver = (tap: PushTap) => {
      if (ready) open(tap)
      else pending.current = tap
    }
    const launch = pushDevice.lastTap()
    if (launch) {
      deliver(launch)
      pushDevice.clearLastTap()
    }
    if (ready && pending.current) {
      const tap = pending.current
      pending.current = null
      open(tap)
    }
    return pushDevice.onTap(deliver)
  }, [ready, router])

  // An arrival, or a return to the foreground, re-reads the inbox from the server.
  useEffect(() => {
    if (!session) return
    const refresh = () => {
      const now = Date.now()
      if (now - lastRefresh.current < REFRESH_AFTER_MS) return
      lastRefresh.current = now
      void queryClient.invalidateQueries({ queryKey: MONITORING_KEY })
    }
    const stopReceived = pushDevice.onReceived(() => {
      lastRefresh.current = 0
      refresh()
    })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh()
    })
    return () => {
      stopReceived()
      subscription.remove()
    }
  }, [session, queryClient])

  // The registration kept fresh for the wallet that turned this phone on.
  useEffect(() => {
    if (!session || !surfaceRead) return
    const [start, end, timezone] = quietKey.split('|')
    const quietHours = quietKey && start && end && timezone ? { start, end, timezone } : null
    let cancelled = false
    const keep = async (live: Session, token: string | null) => {
      const record = readDeviceRecord(live.address)
      if (!record) return
      const current = token ?? (await pushDevice.token().then((read) => (read.ok ? read.token : null)))
      if (cancelled || !current) return
      const registration = registrationNeeded({
        address: live.address,
        token: current,
        appVersion: APP_VERSION,
        locale,
        quietHours,
        record,
        now: Date.now(),
      })
      if (!registration) return
      try {
        const answer = await registerDevice(live, registration)
        if (!cancelled) writeDeviceRecord(recordOf(registration, answer, live.address, Date.now()))
      } catch {
        // Offline or refused: the record stays as it was and the next start tries again.
      }
    }
    void keep(session, null)
    const stopToken = pushDevice.onToken((token) => void keep(session, token))
    return () => {
      cancelled = true
      stopToken()
    }
  }, [session, locale, quietKey, surfaceRead])

  return null
}
