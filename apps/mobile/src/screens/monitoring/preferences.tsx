import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips } from '@/components/choice-chips'
import { FactRow } from '@/components/fact-row'
import { Field, ToggleRow } from '@/components/field'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { MONITORING_COPY, type MonitoringCopy } from '@/features/monitoring/copy'
import {
  deviceTimezone,
  inQuietHours,
  isValidQuietHours,
  normalizeClock,
  QUIET_PRESETS,
  quietHoursText,
} from '@/features/monitoring/monitoring-model'
import { useUpdatePreferences } from '@/features/monitoring/use-monitoring'
import type { PhoneState } from '@/features/notifications/device-registry'
import { clearDeviceRecord } from '@/features/notifications/device-store'
import { pushDevice } from '@/features/notifications/push'
import {
  useDisablePhone,
  useEnablePhone,
  usePhoneState,
  useServerDevices,
} from '@/features/notifications/use-notifications'
import { useMonitoring } from '@/features/plans/use-plans'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { isNetworkError, type QuietHours } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { formatMoment } from '@/utils/format'
import { openLink } from '@/lib/open-link'

const TELEGRAM_SETTINGS_URL = 'https://ryntra.io/app/settings#account'

function phoneLine(
  state: PhoneState,
  copy: MonitoringCopy,
  registeredAt: string | null,
  now: number,
  locale: 'en' | 'uk',
): string {
  switch (state) {
    case 'on':
      return registeredAt
        ? `${copy.phoneOn} ${copy.phoneRegistered(formatMoment(registeredAt, now, locale))}`
        : copy.phoneOn
    case 'off_permission':
      return copy.phoneNoPermission
    case 'off_no_config':
      return copy.phoneNoConfig
    case 'off_web':
      return copy.phoneWebOff
    case 'unknown':
      return registeredAt ? copy.phoneRegistered(formatMoment(registeredAt, now, locale)) : copy.phoneOff
    default:
      return copy.phoneOff
  }
}

/** The quiet-hours editor: presets, two clock fields, the device's timezone, one Save. */
function QuietHoursCard({
  value,
  copy,
  saving,
  onSave,
  onClear,
  now,
}: {
  value: QuietHours | null
  copy: MonitoringCopy
  saving: boolean
  onSave: (hours: QuietHours) => void
  onClear: () => void
  now: number
}) {
  const [enabled, setEnabled] = useState(value !== null)
  const [start, setStart] = useState(value?.start ?? '22:00')
  const [end, setEnd] = useState(value?.end ?? '07:00')
  const timezone = value?.timezone ?? deviceTimezone()
  const draft: QuietHours = { start: normalizeClock(start), end: normalizeClock(end), timezone }
  const valid = isValidQuietHours(draft)
  const dirty = value === null ? enabled : !enabled || draft.start !== value.start || draft.end !== value.end
  const preset = QUIET_PRESETS.find((row) => row.start === draft.start && row.end === draft.end)
  const quietNow = inQuietHours(now, value)

  return (
    <Card padded={false} className="px-4">
      <ToggleRow
        label={copy.quiet}
        hint={value ? `${quietHoursText(value)} · ${value.timezone}` : copy.quietOff}
        value={enabled}
        onChange={(next) => {
          setEnabled(next)
          if (!next && value !== null) onClear()
        }}
        last={!enabled}
      />
      {enabled ? (
        <View className="gap-3 py-3">
          {quietNow ? <Chip label={copy.quietNow} tone="brand" /> : null}
          <ChoiceChips
            choices={QUIET_PRESETS.map((row) => ({
              value: `${row.start}-${row.end}`,
              label: `${row.start}–${row.end}`,
            }))}
            value={preset ? `${preset.start}-${preset.end}` : ''}
            onChange={(chosen) => {
              const [from, until] = chosen.split('-')
              if (from && until) {
                setStart(from)
                setEnd(until)
              }
            }}
            size="sm"
          />
          <View className="flex-row gap-3">
            <Field
              label={copy.quietFrom}
              value={start}
              onChangeText={setStart}
              onBlur={() => setStart(normalizeClock(start))}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              placeholder="22:00"
              error={start.length > 0 && !isValidQuietHours({ ...draft, end: '00:00' }) ? copy.clockNeeded : null}
              className="flex-1"
            />
            <Field
              label={copy.quietUntil}
              value={end}
              onChangeText={setEnd}
              onBlur={() => setEnd(normalizeClock(end))}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              placeholder="07:00"
              error={end.length > 0 && !isValidQuietHours({ ...draft, start: '00:00' }) ? copy.clockNeeded : null}
              className="flex-1"
            />
          </View>
          <FactRow label={copy.quietTimezone} value={timezone} mono={false} last />
          <Button
            title={copy.save}
            onPress={() => valid && onSave(draft)}
            disabled={!valid || !dirty}
            loading={saving}
          />
        </View>
      ) : null}
    </Card>
  )
}

/**
 * Where the wallet's notes go. The inbox always; Telegram and this phone as
 * the person switches them; quiet hours for both. Every switch is the
 * server's preference written at once and read back; the phone's own
 * registration is the device registry's record. Connecting a Telegram
 * channel stays on ryntra.io — the bearer has no door to it.
 */
export function NotificationPreferencesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const locale = useLocale()
  const copy = useCopy(MONITORING_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const account = useAccount()
  const session = account.session
  const monitoring = useMonitoring(session, locale)
  const preferences = monitoring.data?.preferences ?? null
  const update = useUpdatePreferences(session)
  const phone = usePhoneState(session, preferences?.push ?? null)
  const enable = useEnablePhone(session, locale, preferences?.quietHours ?? null, preferences?.push ?? null)
  const disable = useDisablePhone(session)
  const devices = useServerDevices(session)
  const [error, setError] = useState<string | null>(null)

  const back = () => (router.canGoBack() ? router.back() : router.replace('/monitoring'))

  // A record the server no longer holds (the device was stopped from the web) is dropped, not pretended.
  const serverList = devices.data?.devices
  const recordId = phone.record?.deviceId ?? null
  const address = session?.address ?? null
  useEffect(() => {
    if (!serverList || !recordId || !address) return
    if (!serverList.some((row) => row.deviceId === recordId)) clearDeviceRecord(address)
  }, [serverList, recordId, address])

  const say = (caught: unknown) => setError(isNetworkError(caught) ? shared.needsNetwork : copy.saveFailed)

  const setTelegram = async (value: boolean) => {
    setError(null)
    try {
      await update.mutateAsync({ telegram: value })
    } catch (caught) {
      say(caught)
    }
  }

  const setPhone = async (value: boolean) => {
    setError(null)
    try {
      if (value) await enable.mutateAsync()
      else await disable.mutateAsync()
    } catch (caught) {
      say(caught)
    }
  }

  const saveQuiet = async (hours: QuietHours | null) => {
    setError(null)
    try {
      await update.mutateAsync({ quietHours: hours })
    } catch (caught) {
      say(caught)
    }
  }

  const phoneOn = phone.state === 'on' || phone.state === 'unknown'
  const busy = enable.isPending || disable.isPending

  let body
  if (!session) {
    body = null
  } else if (monitoring.isPending) {
    body = (
      <View className="gap-3 px-4 pt-2" accessibilityRole="progressbar">
        <Skeleton className="h-40 rounded-sm" />
        <Skeleton className="h-16 rounded-sm" />
      </View>
    )
  } else if (!preferences) {
    body = (
      <StateView
        icon={isNetworkError(monitoring.error) ? 'cloud-offline-outline' : 'alert-circle-outline'}
        tone="danger"
        title={isNetworkError(monitoring.error) ? shared.noConnection : copy.couldNotLoad}
        action={{ title: shared.tryAgain, onPress: () => void monitoring.refetch(), loading: monitoring.isFetching }}
      />
    )
  } else {
    body = (
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-4 pb-8 pt-2"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2">
          <Txt variant="labelSm" tone="faint" caps className="px-1">
            {copy.where}
          </Txt>
          <Card padded={false} className="px-4">
            <View className="flex-row items-center gap-3 border-b border-line py-3">
              <Txt variant="ui" className="flex-1">
                {copy.inApp}
              </Txt>
              <Chip label={copy.on} tone="success" />
            </View>
            <ToggleRow
              label={copy.telegram}
              // The API does not say whether this wallet's Telegram is linked; the one line says what the switch does.
              hint={copy.telegramHint}
              value={preferences.telegram}
              onChange={(value) => void setTelegram(value)}
            />
            <Pressable
              accessibilityRole="link"
              onPress={() => openLink(TELEGRAM_SETTINGS_URL)}
              className="flex-row items-center gap-3 border-b border-line py-3 active:bg-hover"
            >
              <Icon name="paper-plane-outline" size={18} />
              <Txt variant="ui" className="flex-1">
                {copy.telegramConnect}
              </Txt>
              <Icon name="open-outline" size={16} color="fgMuted" />
            </Pressable>
            <ToggleRow
              label={copy.thisPhone}
              hint={phoneLine(phone.state, copy, phone.record?.registeredAt ?? null, now, locale)}
              value={phoneOn}
              onChange={(value) => {
                if (!busy) void setPhone(value)
              }}
              last={phone.state !== 'off_permission'}
            />
            {phone.state === 'off_permission' ? (
              <View className="py-3">
                <Button
                  title={copy.openSystemSettings}
                  variant="secondary"
                  size="sm"
                  onPress={() => void pushDevice.openSystemSettings()}
                />
              </View>
            ) : null}
          </Card>
        </View>

        {/* Keyed by the server's window, so a change from the web or another device lands in the editor. */}
        <QuietHoursCard
          key={quietHoursText(preferences.quietHours) ?? 'off'}
          value={preferences.quietHours}
          copy={copy}
          saving={update.isPending}
          onSave={(hours) => void saveQuiet(hours)}
          onClear={() => void saveQuiet(null)}
          now={now}
        />

        {error ? (
          <Txt variant="ui" tone="danger" className="px-1">
            {error}
          </Txt>
        ) : null}
      </ScrollView>
    )
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 px-2 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shared.back}
          onPress={back}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
        <View className="flex-1">
          <ScreenHeader title={copy.settings} />
        </View>
      </View>
      <SessionGate what={copy.title}>{body}</SessionGate>
    </View>
  )
}
