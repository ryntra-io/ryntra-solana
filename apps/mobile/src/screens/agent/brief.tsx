import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { ToggleRow } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import type { AgentCopy } from '@/features/agent/copy'
import { BRIEF_TIMES, useBrief, useSaveBrief } from '@/features/agent/use-brief'
import { briefMomentInZone } from '@/features/agent/voice'
import { mapDeepLink } from '@/features/monitoring/deep-link'
import { useOpenPlace } from '@/features/shell/open-place'
import { useNow } from '@/hooks/use-now'
import type { AssistantBriefLine, AssistantBriefPart, AssistantBriefResponse, Session } from '@/lib/api'
import { useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { formatDay, formatMoment } from '@/utils/format'

import { MarkChip } from './marks'

/** A news line opens its publisher's page; any other line the phone's own place for it, where it has one. */
function useOpenLine() {
  const router = useRouter()
  const openPlace = useOpenPlace()
  return (line: AssistantBriefLine): (() => void) | null => {
    if (!line.href) return null
    if (line.kind === 'market-news' || line.kind === 'token-news') {
      const href = line.href
      return /^https:\/\//.test(href) ? () => openLink(href) : null
    }
    const mapped = mapDeepLink(line.href)
    if (mapped.kind !== 'native') return null
    return () => (mapped.path.startsWith('/(tabs)') ? openPlace(mapped.path) : router.push(mapped.path as never))
  }
}

/** One line of the brief: its mark, the line, its source and time — every figure with its own. */
function Line({ line, copy, now, locale, onPress }: { line: AssistantBriefLine; copy: AgentCopy; now: number; locale: Locale; onPress: (() => void) | null }) {
  const body = (
    <View className="gap-1.5">
      <MarkChip mark={line.mark} copy={copy} />
      <Txt variant="body" selectable={!onPress}>
        {line.text}
      </Txt>
      <View className="flex-row items-center gap-1">
        <Txt variant="labelSm" tone="faint" className="flex-1" numberOfLines={1}>
          {[line.source, line.observedAt ? formatMoment(line.observedAt, now, locale) : null].filter(Boolean).join(' · ')}
        </Txt>
        {onPress ? <Icon name="chevron-forward" size={14} color="fgMuted" /> : null}
      </View>
    </View>
  )
  if (!onPress) return body
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={line.text} onPress={onPress} className="active:opacity-80">
      {body}
    </Pressable>
  )
}

/** A part of the brief: «Сьогодні на ринку» or the wallet's own — the model's words over the server's lines. */
function Part({ part, copy, now, locale }: { part: AssistantBriefPart; copy: AgentCopy; now: number; locale: Locale }) {
  const openLine = useOpenLine()
  if (part.words.length === 0 && part.lines.length === 0 && !part.note) return null
  return (
    <Card className="gap-3">
      <Txt variant="labelSm" tone="faint" caps>
        {part.title}
      </Txt>
      {part.words.map((words, index) => (
        <Txt key={index} variant="body" selectable>
          {words}
        </Txt>
      ))}
      {part.lines.length > 0 ? (
        <View className="gap-4">
          {part.lines.map((line, index) => (
            <Line key={`${line.kind}-${index}`} line={line} copy={copy} now={now} locale={locale} onPress={openLine(line)} />
          ))}
        </View>
      ) : null}
      {part.note ? (
        <Txt variant="ui" tone="muted">
          {part.note}
        </Txt>
      ) : null}
    </Card>
  )
}

/** The zone as a person reads it: Kyiv by its name in the app's language, any other by its own. */
function zoneLabel(zone: string, copy: AgentCopy): string {
  return zone === 'Europe/Kyiv' ? copy.briefKyiv : zone
}

/** The brief's settings: on or off, its time; when the next one comes and where it goes. */
function Settings({ data, session, copy, now, locale }: { data: AssistantBriefResponse; session: Session; copy: AgentCopy; now: number; locale: Locale }) {
  const save = useSaveBrief(session, locale)
  const [timesOpen, setTimesOpen] = useState(false)
  const { settings, next, channels } = data
  const write = (update: { enabled: boolean; time?: string }) =>
    save.mutate({ enabled: update.enabled, time: update.time ?? settings.time, zone: settings.zone, locale: settings.locale })
  const moment = briefMomentInZone(next.at, settings.zone, now)
  const nextWords = moment
    ? copy.briefWhen(
        moment.day === 'today' ? copy.briefToday : moment.day === 'tomorrow' ? copy.briefTomorrow : formatDay(moment.day, now, locale),
        moment.time,
      )
    : null
  const where = [copy.briefInbox, channels.telegram ? 'Telegram' : null, channels.push ? 'Push' : null].filter(Boolean).join(' · ')
  return (
    <Card className="gap-1">
      <ToggleRow
        label={copy.briefSend}
        value={settings.enabled}
        onChange={(enabled) => {
          if (!save.isPending) write({ enabled })
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.briefTime}: ${settings.time}`}
        disabled={!settings.enabled}
        onPress={() => setTimesOpen(true)}
        className="flex-row items-center gap-3 py-3 active:opacity-80"
        style={{ opacity: settings.enabled ? 1 : 0.5 }}
      >
        <Txt variant="ui" className="flex-1">
          {copy.briefTime}
        </Txt>
        <Txt variant="data">{settings.time}</Txt>
        <Txt variant="ui" tone="muted">
          {zoneLabel(settings.zone, copy)}
        </Txt>
        <Icon name="chevron-forward" size={16} color="fgMuted" />
      </Pressable>
      <View className="gap-1 pb-1">
        <Txt variant="labelSm" tone="faint">
          {settings.enabled
            ? [nextWords ? copy.briefNext(nextWords) : null, copy.briefWhere(where)]
                .filter(Boolean)
                .join(' · ')
            : copy.briefOff}
        </Txt>
        {settings.enabled && next.quiet ? (
          <Txt variant="labelSm" tone="faint">
            {copy.briefQuiet}
          </Txt>
        ) : null}
        {save.isPending ? (
          <Txt variant="labelSm" tone="faint">
            {copy.briefSaving}
          </Txt>
        ) : save.isError ? (
          <Txt variant="labelSm" tone="danger">
            {copy.briefFailed}
          </Txt>
        ) : null}
      </View>
      <Sheet visible={timesOpen} title={copy.briefPickTime} subtitle={zoneLabel(settings.zone, copy)} onClose={() => setTimesOpen(false)}>
        <View className="pb-3">
          <ChoiceChips
            value={settings.time}
            onChange={(time) => {
              setTimesOpen(false)
              if (time !== settings.time) write({ enabled: true, time })
            }}
            choices={BRIEF_TIMES.map((time) => ({ value: time, label: time }))}
            className="flex-wrap"
          />
        </View>
      </Sheet>
    </Card>
  )
}

/**
 * «Ранковий огляд» (1.46.0, AI-10): one summary of the market for everyone, then only what changed in the wallet's own
 * tokens, positions and plans — every line marked fact or unverified, with its source and time; free every day. The
 * settings below it: on or off and the time, the zone as the person chose it on the web.
 */
export function BriefPanel({ session, copy, day = null }: { session: Session; copy: AgentCopy; day?: string | null }) {
  const locale = useLocale()
  const shared = useSharedCopy()
  const now = useNow(60_000)
  // A note's own day — that day's brief, never today's in its place; `latest` (or none) is the newest.
  const brief = useBrief(session, locale, day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null)

  if (brief.isPending) {
    return (
      <View className="gap-4 px-4 pt-2" accessibilityRole="progressbar">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-40 rounded-sm" />
        <Skeleton className="h-28 rounded-sm" />
      </View>
    )
  }
  if (brief.isError && !brief.data) {
    return (
      <StateView
        icon="alert-circle-outline"
        tone="danger"
        title={copy.briefLoadFailed}
        action={{ title: shared.tryAgain, onPress: () => void brief.refetch(), loading: brief.isFetching }}
      />
    )
  }
  const data = brief.data!
  const latest = data.latest
  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8 pt-2">
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-1">
          <Txt variant="title">{latest?.title ?? copy.tabBrief}</Txt>
          <Txt variant="ui" tone="muted">
            {latest ? formatMoment(latest.deliveredAt, now, locale) : copy.briefNone}
          </Txt>
        </View>
        <HelpDot title={copy.briefHowTitle} body={[copy.briefLead, copy.briefHow]} />
      </View>
      {latest ? (
        <>
          <Part part={latest.market} copy={copy} now={now} locale={locale} />
          <Part part={latest.personal} copy={copy} now={now} locale={locale} />
        </>
      ) : null}
      <Settings data={data} session={session} copy={copy} now={now} locale={locale} />
    </ScrollView>
  )
}
