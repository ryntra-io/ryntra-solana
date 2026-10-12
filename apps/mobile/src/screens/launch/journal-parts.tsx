import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Card } from '@/components/card'
import { Icon, type IconName } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import type { LaunchWord } from '@/features/launch/copy'
import {
  JOURNAL_AT_ONCE,
  journalDetail,
  journalFigures,
  journalFloor,
  journalMark,
  journalName,
  journalNotes,
  journalRows,
  whyRules,
  type JournalRow,
} from '@/features/launch/journal-view'
import { explorerUrl, formatDate } from '@/features/launch/launch-format'
import { ruleText, sinceText } from '@/features/launch/market-view'
import { useNow } from '@/hooks/use-now'
import type { LaunchJournalResponse, LaunchMarketHealthResponse } from '@/lib/api/v1/types'
import { RECEIPTS_COPY } from '@/features/receipts/copy'
import { docFromJournal } from '@/features/receipts/receipt-doc'
import { useCopy, type Locale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { journalMarkWords } from '@/screens/receipts/doc-sheet'
import { ShareReceiptSheet } from '@/screens/receipts/share-receipt'

import { EnforceChip, RuleRow } from './market-parts'

const ICONS: Readonly<Record<string, IconName>> = {
  LAUNCHED: 'rocket-outline',
  CREATOR_LOCKED: 'lock-closed',
  FEES_SHARED: 'share-social-outline',
  CREATOR_SOLD: 'trending-down',
  GRADUATED: 'flag-outline',
  FLOOR_POOL: 'cash-outline',
  FLOOR_PLACED: 'layers-outline',
  FLOOR_WITHDRAWN: 'return-down-back-outline',
  FLOOR_RAISED: 'arrow-up-circle-outline',
  FLOOR_ADDED: 'add-circle-outline',
  CREATOR_BOUGHT: 'trending-up',
  FEE_CLAIMED: 'wallet-outline',
}

type Common = Readonly<{
  log: LaunchJournalResponse
  health: LaunchMarketHealthResponse | null
  symbol: string
  word: LaunchWord
  locale: Locale
}>

/**
 * «Бортовий журнал» on a market's page: the three newest entries — each in
 * words with its amounts, its mark and its transaction, «Чому?» opening the
 * rule it stands on — and «Усі» for the whole log; Ryntra's ladder above
 * them only while it stands. Read in part, or holding more than it gives,
 * the log says so. The proofs on chain are quiet links, as on the cards
 * above it: the brand's orange is left to «Чому?» opened and to «Усі».
 */
export function JournalCard({
  log,
  failed,
  stale = false,
  onRetry,
  health,
  symbol,
  word,
  locale,
}: Omit<Common, 'log'> & {
  log: LaunchJournalResponse | null
  /** Not read, and nothing read before. */
  failed: boolean
  /** The last read again failed: the entries are the earlier read, and say so. */
  stale?: boolean
  onRetry: () => void
}) {
  const now = useNow(30_000)
  const [all, setAll] = useState(false)
  if (!log)
    return (
      <Card className="gap-2">
        <Txt variant="labelSm" tone="faint" caps>
          {word('logTitle')}
        </Txt>
        {failed ? (
          <Retry text={word('logUnread')} word={word} onRetry={onRetry} />
        ) : (
          <Txt variant="ui" tone="muted">
            {word('logReading')}
          </Txt>
        )}
      </Card>
    )
  const rows = journalRows(log.events)
  const first = rows.slice(0, JOURNAL_AT_ONCE)
  // The log's time under it, as the web's card says it: stale when reading it again failed.
  const checked = word(stale ? 'marketStale' : 'marksChecked', { ago: sinceText(log.observedAt, word, locale, now) })
  const common = { log, health, symbol, word, locale }
  return (
    <Card className="gap-1">
      <Txt variant="labelSm" tone="faint" caps className="pb-1">
        {word('logTitle')}
      </Txt>
      <Floor {...common} onRetry={onRetry} />
      <Entries rows={first} now={now} {...common} />
      {rows.length > first.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={word('logAllLabel')}
          onPress={() => setAll(true)}
          hitSlop={8}
          className="min-h-11 flex-row items-center gap-1 self-start"
        >
          <Txt variant="ui" tone="brand">
            {word('logAll')}
          </Txt>
          <Icon name="chevron-forward" size={16} color="brand" />
        </Pressable>
      ) : null}
      <Notes log={log} word={word} all={false} />
      <Status text={checked} warn={stale} />
      <Sheet visible={all} title={word('logTitle')} onClose={() => setAll(false)} scroll>
        <View className="gap-1 pb-4">
          <Status text={checked} warn={stale} />
          <Floor {...common} onRetry={onRetry} />
          <Entries rows={rows} now={now} {...common} />
          <Notes log={log} word={word} all />
        </View>
      </Sheet>
    </Card>
  )
}

/** A line not read, and the press that reads it again. */
function Retry({ text, word, onRetry }: Readonly<{ text: string; word: LaunchWord; onRetry: () => void }>) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onRetry}
      hitSlop={8}
      className="min-h-11 flex-row flex-wrap items-center gap-x-2"
    >
      <Txt variant="ui" tone="muted">
        {text}
      </Txt>
      <Txt variant="ui" tone="brand">
        {word('readAgain')}
      </Txt>
    </Pressable>
  )
}

/** The entries, the newest first; none read in full is said so — none read in part is left to the note under them. */
function Entries({ rows, now, ...common }: Common & { rows: readonly JournalRow[]; now: number }) {
  if (!rows.length)
    return common.log.complete ? (
      <Txt variant="ui" tone="muted" className="py-2">
        {common.word('logEmpty')}
      </Txt>
    ) : null
  return (
    <View>
      {rows.map((row, index) => (
        <Entry key={`${row.entry.kind}:${row.entry.signature}`} row={row} first={index === 0} now={now} {...common} />
      ))}
    </View>
  )
}

/** A proof on chain: muted words and the outward mark, as the rules and the marks above say it. */
function ChainLink({ label, url, spoken }: Readonly<{ label: string; url: string; spoken: string }>) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={spoken}
      onPress={() => openLink(url)}
      hitSlop={8}
      className="min-h-11 flex-row items-center gap-1"
    >
      <Txt variant="ui" tone="muted">
        {label}
      </Txt>
      <Icon name="open-outline" size={13} color="fgMuted" />
    </Pressable>
  )
}

/**
 * One entry: its name and mark, what it moved, when, its transaction — and
 * «Чому?» where a rule of the market stands behind it, opening that rule in
 * place: its mark, its sentence, its account on Solscan.
 */
function Entry({
  row,
  first,
  now,
  log,
  health,
  symbol,
  word,
  locale,
}: Common & { row: JournalRow; first: boolean; now: number }) {
  const [why, setWhy] = useState(false)
  const [sharing, setSharing] = useState(false)
  const receiptWords = useCopy(RECEIPTS_COPY)
  const { entry, emptied } = row
  const figures = journalFigures(log, symbol, locale)
  const name = journalName(entry, word)
  const detail = journalDetail(entry, figures, word, locale)
  const mark = journalMark(entry)
  const rules = whyRules(entry, health)
  const time = entry.at ? sinceText(entry.at, word, locale, now) : '—'
  const fullTime = entry.at ? formatDate(entry.at, locale) : word('notRead')
  const emptiedLine = emptied?.pairRaw
    ? word('log_FLOOR_RAISED_emptied', { amount: figures.money(emptied.pairRaw) })
    : null
  const sold = entry.kind === 'CREATOR_SOLD'
  return (
    <View className={first ? 'flex-row gap-3 pt-2' : 'flex-row gap-3 border-t border-line pt-3'}>
      <View className="h-8 w-8 items-center justify-center rounded-pill bg-hover">
        <Icon
          name={Object.hasOwn(ICONS, entry.kind) ? ICONS[entry.kind]! : 'document-text-outline'}
          size={16}
          color={sold ? 'dangerInk' : 'muted'}
        />
      </View>
      <View className="flex-1 gap-1">
        {/* One stop for a screen reader: the name, its mark, what it moved and when. */}
        <View
          accessible
          accessibilityLabel={[name, mark ? word(`enforce_${mark}`) : null, detail, emptiedLine, fullTime]
            .filter(Boolean)
            .join('. ')}
          className="gap-1"
        >
          <View className="flex-row items-start justify-between gap-2">
            <Txt variant="ui" tone={sold ? 'danger' : 'fg'} className="flex-1">
              {name}
            </Txt>
            {mark ? <EnforceChip enforcement={mark} word={word} /> : null}
          </View>
          {detail ? (
            <Txt variant="ui" tone="muted">
              {detail}
            </Txt>
          ) : null}
          {/* A move up is one entry: the emptying that came first and its amount under it; its transaction beside the entry's. */}
          {emptiedLine ? (
            <Txt variant="ui" tone="muted">
              {emptiedLine}
            </Txt>
          ) : null}
          <Txt variant="labelSm" tone="muted" className="pt-1">
            {time}
          </Txt>
        </View>
        <View className="flex-row flex-wrap items-center gap-x-4">
          <ChainLink
            label={word('logTx')}
            url={explorerUrl(log.network, 'tx', entry.signature)}
            spoken={`${word('logTx')}: ${name}, ${fullTime}`}
          />
          {emptied ? (
            <ChainLink
              label={word('logTxEmptied')}
              url={explorerUrl(log.network, 'tx', emptied.signature)}
              spoken={`${word('logTx')}: ${word('logTxEmptied')}${emptied.at ? `, ${formatDate(emptied.at, locale)}` : ''}`}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${receiptWords.share}: ${name}`}
            onPress={() => setSharing(true)}
            hitSlop={8}
            className="min-h-11 flex-row items-center gap-1"
          >
            <Txt variant="ui" tone="muted">
              {receiptWords.shareAction}
            </Txt>
            <Icon name="share-social-outline" size={13} color="fgMuted" />
          </Pressable>
          {rules.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: why }}
              accessibilityLabel={`${word('logWhy')} ${name}`}
              onPress={() => setWhy((open) => !open)}
              hitSlop={8}
              className="min-h-11 flex-row items-center gap-1"
            >
              <Txt variant="ui" tone={why ? 'brand' : 'fg'}>
                {word('logWhy')}
              </Txt>
              <Icon name={why ? 'chevron-up' : 'chevron-down'} size={14} color={why ? 'brand' : 'muted'} />
            </Pressable>
          ) : null}
        </View>
        {why && health && rules.length ? (
          <View className="mb-3 gap-3 rounded-sm bg-hover px-3 py-2.5">
            {rules.map((rule, index) => (
              <RuleRow
                key={`${rule.code}:${rule.source?.id ?? index}`}
                rule={rule}
                text={ruleText(rule, health.pair, word, locale, now)}
                network={health.network}
                word={word}
              />
            ))}
          </View>
        ) : null}
      </View>
      {sharing ? (
        <ShareReceiptSheet
          doc={docFromJournal(entry, log, symbol, word, locale)}
          markWords={journalMarkWords(locale)}
          visible
          onClose={() => setSharing(false)}
        />
      ) : null}
    </View>
  )
}

/**
 * Ryntra's ladder above the log, only while it stands — liquidity from
 * Ryntra's fees, never a price held; what the steps are, one press deep. A
 * ladder there but not read now is said so, with the press that reads again.
 */
function Floor({ log, symbol, word, locale, onRetry }: Omit<Common, 'health'> & { onRetry: () => void }) {
  const [what, setWhat] = useState(false)
  const floor = journalFloor(log, journalFigures(log, symbol, locale), word)
  if (!floor) return null
  if (floor.kind === 'unread') return <Retry text={word('floorUnread')} word={word} onRetry={onRetry} />
  return (
    <View className="mb-1 gap-1 rounded-sm bg-hover px-3 pt-2.5">
      <View className="flex-row items-center justify-between gap-2">
        <Txt variant="ui" className="flex-1">
          {word('floorTitle')}
        </Txt>
        <ChainLink
          label={word('floorPool')}
          url={explorerUrl(log.network, 'account', floor.pool)}
          spoken={word('floorPoolLabel')}
        />
      </View>
      <Txt variant="ui" tone="muted">
        {floor.line}
      </Txt>
      {floor.bought ? (
        <Txt variant="ui" tone="muted">
          {floor.bought}
        </Txt>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: what }}
        onPress={() => setWhat((open) => !open)}
        hitSlop={8}
        className="min-h-11 flex-row items-center gap-1 self-start"
      >
        <Txt variant="labelSm" tone="muted">
          {word('floorWhat')}
        </Txt>
        <Icon name={what ? 'chevron-up' : 'chevron-down'} size={14} color="muted" />
      </Pressable>
      {what ? (
        <Txt variant="ui" tone="muted" className="pb-2.5">
          {word('floorNote')}
        </Txt>
      ) : null}
    </View>
  )
}

/** A line about the log itself — a warning with its mark, so the colour never says it alone. */
function Status({ text, warn }: Readonly<{ text: string; warn: boolean }>) {
  return (
    <View className="flex-row items-start gap-1.5 pt-1" accessibilityLiveRegion={warn ? 'polite' : 'none'}>
      {warn ? <Icon name="alert-circle-outline" size={14} color="warningInk" style={{ marginTop: 0 }} /> : null}
      <Txt variant="labelSm" tone={warn ? 'warning' : 'muted'} className="flex-1">
        {text}
      </Txt>
    </View>
  )
}

/** «Прочитано частково» under the entries; «Показано N з M» only where the whole answer is shown. */
function Notes({ log, word, all }: Readonly<{ log: LaunchJournalResponse; word: LaunchWord; all: boolean }>) {
  const notes = journalNotes(log, word, all)
  if (!notes.length) return null
  return (
    <View className="gap-1">
      {notes.map((note) => (
        <Status key={note.text} text={note.text} warn={note.warn} />
      ))}
    </View>
  )
}
