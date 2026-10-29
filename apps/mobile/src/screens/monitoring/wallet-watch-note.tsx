import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { Chip } from '@/components/chip'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { noteWords } from '@/features/monitoring/monitoring-model'
import { WALLET_WATCH_COPY } from '@/features/monitoring/wallet-watch-copy'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import {
  readWalletFollows,
  setWalletWatchAlerts,
  stopWalletWatch,
  type MonitoringNote,
  type Session,
  type WalletFollows,
  type WalletWatchAlerts,
} from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatMoment } from '@/utils/format'

const followsKey = (address: string) => [PRIVATE_QUERY_KEY, 'wallet-follows', address] as const

/** `Ab3d…9xYz` — a wallet named by its address where it has no name. */
function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

/**
 * A followed wallet's note on the phone (SOL-R4, 1.63.0): the phone has no «Гаманці», so the note is shown here with
 * its own words, its token and its time — never the site — and how the wallet's trades are told: every trade, only
 * sales, or none; «Не стежити» lets it go. Nothing here trades.
 */
export function WalletWatchNote({
  session,
  wallet,
  note,
}: {
  session: Session
  wallet: string
  note: MonitoringNote | null
}) {
  const copy = useCopy(WALLET_WATCH_COPY)
  const locale = useLocale()
  const now = useNow(30_000)
  const queryClient = useQueryClient()
  const key = followsKey(session.address)
  const follows = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readWalletFollows(session, signal),
    staleTime: 30_000,
    retry: 1,
  })
  const [confirming, setConfirming] = useState(false)
  const [said, setSaid] = useState<'saved' | 'stopped' | 'failed' | null>(null)
  const settle = (next: WalletFollows) => queryClient.setQueryData(key, next)
  const change = useMutation({
    mutationFn: (alerts: WalletWatchAlerts) => setWalletWatchAlerts(session, wallet, alerts, locale),
    onSuccess: (next) => {
      settle(next)
      setSaid('saved')
    },
    onError: () => setSaid('failed'),
  })
  const stop = useMutation({
    mutationFn: () => stopWalletWatch(session, wallet, locale),
    onSuccess: (next) => {
      settle(next)
      setSaid('stopped')
    },
    onError: () => setSaid('failed'),
  })

  const follow = follows.data?.wallets.find((row) => row.address === wallet) ?? null
  const words = note ? noteWords(note, locale) : null
  const name = follow?.name ?? note?.context ?? shortAddress(wallet)
  const busy = change.isPending || stop.isPending

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8 pt-2">
      {/* A wallet with no note and not followed has nothing to show but the line below. */}
      {words || follow || follows.isPending ? (
        <Card className="gap-2">
          <Txt variant="labelSm" tone="faint" caps>
            {copy.title}
          </Txt>
          {words ? (
            <>
              <Txt variant="ui">{words.title}</Txt>
              {words.reason ? (
                <Txt variant="body" tone="muted">
                  {words.reason}
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt variant="ui" tone="muted">
              {copy.noNote}
            </Txt>
          )}
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Chip label={name} caps={false} />
            {follow?.via ? <Chip label={follow.via.symbol} caps={false} /> : null}
            {note ? (
              <Txt variant="labelSm" tone="faint">
                {formatMoment(note.createdAt, now, locale)}
              </Txt>
            ) : null}
          </View>
        </Card>
      ) : null}

      {follows.isPending ? (
        <Skeleton className="h-28 rounded-sm" />
      ) : follows.isError && !follows.data ? (
        <Txt variant="ui" tone="danger">
          {copy.readFailed}
        </Txt>
      ) : said === 'stopped' || !follow ? (
        <Txt variant="ui" tone="muted">
          {said === 'stopped' ? copy.stopped : copy.notFollowed}
        </Txt>
      ) : (
        <Card className="gap-3">
          <Txt variant="ui">{copy.alerts}</Txt>
          <ChoiceChips
            value={follow.alerts}
            disabled={busy}
            onChange={(alerts) => {
              setSaid(null)
              if (alerts !== follow.alerts) change.mutate(alerts)
            }}
            choices={[
              { value: 'all', label: copy.alertsAll },
              { value: 'sells', label: copy.alertsSells },
              { value: 'off', label: copy.alertsOff },
            ]}
            fill
            size="sm"
          />
          <Txt variant="labelSm" tone={said === 'failed' ? 'danger' : 'faint'}>
            {busy ? copy.saving : said === 'saved' ? copy.saved : said === 'failed' ? copy.failed : ' '}
          </Txt>
          <Button title={copy.stop} variant="secondary" size="sm" disabled={busy} onPress={() => setConfirming(true)} />
        </Card>
      )}

      <Sheet visible={confirming} title={copy.stopConfirmTitle} onClose={() => setConfirming(false)}>
        <View className="gap-3 pb-3">
          <Txt variant="ui" tone="muted">
            {copy.stopConfirmBody}
          </Txt>
          <Button
            title={copy.stopConfirm}
            variant="danger"
            loading={stop.isPending}
            onPress={() => {
              setConfirming(false)
              setSaid(null)
              stop.mutate()
            }}
          />
          <Button title={copy.keep} variant="ghost" onPress={() => setConfirming(false)} />
        </View>
      </Sheet>
    </ScrollView>
  )
}
