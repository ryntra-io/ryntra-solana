import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import { FactRow } from '@/components/fact-row'
import { HelpDot } from '@/components/help-dot'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { CREDITS_COPY, type CreditsCopy } from '@/features/assistant/credits-copy'
import { creditUnit, creditsText, questionsOf } from '@/features/assistant/credits-model'
import { refusalCode, useCreditOrders, useWelcomeCredits } from '@/features/assistant/credits-orders'
import {
  entryAmount,
  entryDelta,
  entryLabel,
  freeQuestionsDaily,
  nearDayCap,
  openOrderOf,
  orderPayable,
  shownEntries,
  welcomeRefusalOf,
} from '@/features/assistant/credits-panel-model'
import { useCredits } from '@/features/assistant/use-credits'
import { useNow } from '@/hooks/use-now'
import type { AssistantCreditEntry, AssistantCredits, Session } from '@/lib/api'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { formatAt, formatCount } from '@/utils/format'

import { CreditOrderCard, CreditOrdersSheet, CreditsPackagesSheet } from './credits-buy'

export type CreditsPanelProps = {
  session: Session
  /** A credits order the person came back to (`/pay/<id>` of an order, or a note): its state in view. */
  orderId: string | null
}

const PRICE_KEYS = ['question', 'alertExplain', 'tokenReport', 'priceMove', 'voice', 'deep', 'plan'] as const

type Door = 'purchases' | 'history' | 'prices' | null

/** «Кредити» — the balance, today's free credits, «Поповнити» through the wallet, receipts and history (AI-04, AI-12). */
export function CreditsPanel({ session, orderId }: CreditsPanelProps) {
  const copy = useCopy(CREDITS_COPY)
  const shared = useSharedCopy()
  const locale = useLocale()
  const now = useNow(30_000)
  const read = useCredits(session)
  const purchase = read.data?.purchase ?? null
  const available = purchase?.available ?? false
  const orders = useCreditOrders(session, available)
  const welcome = useWelcomeCredits(session)
  /** An order chosen on this tab — a package just bought, or one brought back from «Покупки» — under the order named then. */
  const [picked, setPicked] = useState<Readonly<{ id: string; under: string | null }> | null>(null)
  /** None named: the newest order a payment can still arrive for, kept once found so it stays on screen as it turns paid. */
  const [found, setFound] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)
  const [door, setDoor] = useState<Door>(null)
  /** Refused as taken or not eligible: the ask is not offered again on this tab. */
  const [welcomeClosed, setWelcomeClosed] = useState(false)

  const list = orders.data?.orders
  if (found === null && list) {
    const open = openOrderOf(list, now)
    if (open) setFound(open.id)
  }
  // An order the person came back to is the one on screen, until they choose another here.
  const current = (picked && picked.under === orderId ? picked.id : null) ?? orderId ?? found
  const pick = (id: string) => setPicked({ id, under: orderId })

  if (read.isPending) {
    return (
      <View className="gap-4 px-4 pt-2" accessibilityRole="progressbar">
        <Skeleton className="h-44 rounded-sm" />
        <Skeleton className="h-36 rounded-sm" />
      </View>
    )
  }
  if (!read.data) {
    return (
      <StateView
        icon="alert-circle-outline"
        tone="danger"
        title={copy.readFailed}
        action={{ title: shared.tryAgain, onPress: () => void read.refetch(), loading: read.isFetching }}
      />
    )
  }

  const { credits, entries } = read.data
  const questions = questionsOf(credits)
  const freeDaily = freeQuestionsDaily(credits)
  const welcomeRefusal = welcome.isError ? welcomeRefusalOf(refusalCode(welcome.error)) : null
  const welcomeOpen = credits.welcomeOffer === 'open' && !welcomeClosed && welcome.data === undefined
  const shownHistory = shownEntries(entries)
  const orderCount = list?.length ?? null
  const currentOrder = list?.find((one) => one.id === current) ?? null
  const orderWaiting = current !== null && (currentOrder === null || orderPayable(currentOrder, now, false))

  return (
    <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8 pt-2">
      <Card className="gap-3">
        <View className="flex-row items-center justify-between gap-2">
          <Txt variant="labelSm" tone="faint" caps>
            {copy.balance}
          </Txt>
          <HelpDot
            title={copy.howTitle}
            body={[
              freeDaily > 0 ? copy.what(freeDaily, formatCount(freeDaily, locale)) : copy.whatNoFree,
              copy.what2,
              credits.holder === 'account' ? `${copy.rate} · ${copy.account}` : copy.rate,
            ]}
          />
        </View>
        <View className="gap-1">
          <View className="flex-row items-baseline gap-2">
            <Txt variant="display" tabular>
              {formatCount(credits.balance, locale)}
            </Txt>
            <Txt variant="ui" tone="muted">
              {creditUnit(credits.balance, locale)}
            </Txt>
          </View>
          {questions !== null ? (
            <Txt variant="ui" tone="muted">
              {copy.questions(questions, formatCount(questions, locale))}
            </Txt>
          ) : null}
        </View>
        <View className="gap-1">
          <Txt variant="ui">
            {[
              copy.freeToday(formatCount(credits.free.left, locale), formatCount(credits.free.daily, locale)),
              copy.freeNew(formatAt(credits.free.resetsAt, now, locale)),
            ].join(' · ')}
          </Txt>
          {nearDayCap(credits) ? (
            <Txt variant="ui" tone="warning">
              {copy.dayCap(
                formatCount(credits.dailySpend.used, locale),
                formatCount(credits.dailySpend.cap, locale),
                formatAt(credits.dailySpend.resetsAt, now, locale),
              )}
            </Txt>
          ) : null}
          <Txt variant="labelSm" tone="faint">
            {copy.readAt(formatAt(read.dataUpdatedAt > 0 ? new Date(read.dataUpdatedAt).toISOString() : null, now, locale))}
          </Txt>
        </View>
        {available ? (
          // An order waiting for its signature is the one orange action; «Поповнити» steps back beside it.
          <Button
            title={copy.topUp}
            size="lg"
            variant={orderWaiting ? 'secondary' : 'primary'}
            onPress={() => setBuying(true)}
          />
        ) : null}
      </Card>

      {current ? <CreditOrderCard key={current} session={session} orderId={current} copy={copy} /> : null}

      {welcomeOpen ? (
        <View className="gap-2">
          <Button
            title={copy.welcome}
            variant="secondary"
            loading={welcome.isPending}
            onPress={() =>
              welcome.mutate(undefined, {
                onError: (error) => {
                  if (welcomeRefusalOf(refusalCode(error)).final) setWelcomeClosed(true)
                },
              })
            }
          />
          <Txt variant="labelSm" tone="faint">
            {copy.welcomeNote}
          </Txt>
        </View>
      ) : null}
      {welcome.data ? (
        <Txt variant="ui" tone="success">
          {copy.welcomeDone(creditsText(welcome.data.granted ?? 0, locale))}
        </Txt>
      ) : welcomeRefusal ? (
        <Txt variant="ui" tone={welcomeRefusal.final ? 'muted' : 'danger'}>
          {copy[welcomeRefusal.key]}
        </Txt>
      ) : null}

      {purchase && !available ? (
        <Txt variant="ui" tone="muted">
          {copy.buyClosed}
        </Txt>
      ) : null}

      <Card padded={false}>
        {available ? (
          <DoorRow
            icon="receipt-outline"
            label={copy.purchases}
            line={orderCount ? copy.purchasesLine(orderCount) : undefined}
            onPress={() => setDoor('purchases')}
          />
        ) : null}
        <DoorRow icon="time-outline" label={copy.history} line={copy.historyLine} onPress={() => setDoor('history')} />
        <DoorRow
          icon="pricetag-outline"
          label={copy.prices}
          line={copy.pricesLine}
          value={creditsText(credits.prices.question, locale)}
          onPress={() => setDoor('prices')}
          last
        />
      </Card>

      {available && purchase ? (
        <CreditsPackagesSheet
          visible={buying}
          onClose={() => setBuying(false)}
          session={session}
          purchase={purchase}
          copy={copy}
          onOpened={pick}
        />
      ) : null}
      {available ? (
        <CreditOrdersSheet
          visible={door === 'purchases'}
          onClose={() => setDoor(null)}
          session={session}
          copy={copy}
          onPick={pick}
        />
      ) : null}
      <Sheet visible={door === 'history'} title={copy.history} onClose={() => setDoor(null)} scroll>
        <History entries={shownHistory} copy={copy} now={now} locale={locale} />
      </Sheet>
      <Sheet visible={door === 'prices'} title={copy.prices} subtitle={copy.rate} onClose={() => setDoor(null)} scroll>
        <Prices credits={credits} copy={copy} locale={locale} />
      </Sheet>
    </ScrollView>
  )
}

/** What was added and spent: a hold and its release are not shown — they net to nothing. */
function History({ entries, copy, now, locale }: { entries: readonly AssistantCreditEntry[]; copy: CreditsCopy; now: number; locale: Locale }) {
  if (entries.length === 0) {
    return (
      <Txt variant="ui" tone="muted" className="pb-3">
        {copy.noHistory}
      </Txt>
    )
  }
  return (
    <View className="pb-3">
      {entries.map((entry, index) => (
        <FactRow
          key={`${entry.at}-${index}`}
          label={entryLabel(entry, copy)}
          value={entryAmount(entry, locale)}
          tone={entryDelta(entry) > 0 ? 'success' : 'fg'}
          detail={formatAt(entry.at, now, locale)}
          last={index === entries.length - 1}
        />
      ))}
    </View>
  )
}

/** Each paid answer at the server's price; a figure the server did not name is a dash. */
function Prices({ credits, copy, locale }: { credits: AssistantCredits; copy: CreditsCopy; locale: Locale }) {
  return (
    <View className="pb-3">
      {PRICE_KEYS.map((key, index) => (
        <FactRow
          key={key}
          label={copy.priceRows[key]}
          value={formatCount(credits.prices[key], locale)}
          last={index === PRICE_KEYS.length - 1}
        />
      ))}
      <Txt variant="labelSm" tone="faint" className="pt-2">
        {copy.what2}
      </Txt>
    </View>
  )
}
