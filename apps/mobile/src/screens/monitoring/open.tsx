import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { ScreenHeader } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY } from '@/features/autoinvest/copy'
import { isInstant, isRuleId, rulePurchaseParams } from '@/features/autoinvest/rule-model'
import { useRule } from '@/features/autoinvest/use-rules'
import { useCompanyShelf } from '@/features/invest/use-shelf'
import { recordJourney } from '@/features/journeys/journey-store'
import { MONITORING_COPY } from '@/features/monitoring/copy'
import { webHrefOf } from '@/features/monitoring/deep-link'
import { listsPath } from '@/features/shell/places'
import { parseNoteRef, type NoteTarget } from '@/features/monitoring/monitoring-model'
import { useMarkRead, useResolvedNote } from '@/features/monitoring/use-monitoring'
import { PLANS_COPY } from '@/features/plans/copy'
import { useAccount } from '@/features/session/use-account'
import { SessionGate } from '@/features/wallet/wallet-gate'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { PlanRow } from '@/screens/plans/plan-row'

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)
const SYMBOL = /^[A-Za-z0-9._-]{1,32}$/

/**
 * The resolver behind every deep link into the monitoring: `?n=<note|monitor>`
 * from a push, a Telegram button or the web's own link, `?href=<web path>`
 * for a page the phone has no surface for, `?rule=<id>&due=<instant>` for an
 * autoinvest reminder's own link (M16). It reads the wallet's surface and
 * plans afresh, marks the note read as the web's link does, and replaces
 * itself with the exact plan — or, for a reminder, with its company's
 * purchase under the rule, the rule read afresh first; for the note that the
 * month's budget is spent, with Home and the budget's sheet; for an issuer's
 * event (M19), with the token's page and its swap's sheet — and the event's own
 * link, `?stock=<symbol>&open=convert|sell`, finds the token on the shelf and
 * opens the same, no session needed to read it. When the surface names
 * a symbol two plans share, it asks — it never guesses. Nothing here carries a
 * quote, a finding or a prepared order: the plan's own Review and the
 * company's own «Перевірка» read today's figures.
 */
export function OpenNoteScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const locale = useLocale()
  const copy = useCopy(MONITORING_COPY)
  const plansCopy = useCopy(PLANS_COPY)
  const ruleCopy = useCopy(AUTOINVEST_COPY)
  const shared = useSharedCopy()
  const now = useNow(30_000)
  const params = useLocalSearchParams<{
    n?: string | string[]
    href?: string | string[]
    rule?: string | string[]
    due?: string | string[]
    symbol?: string | string[]
    stock?: string | string[]
    open?: string | string[]
  }>()
  const ref = parseNoteRef(first(params.n))
  const web = webHrefOf(first(params.href))
  const account = useAccount()
  const session = account.session
  const { resolved, plans, monitoring, reading, settling } = useResolvedNote(session, locale, ref)
  const markRead = useMarkRead(session)
  const mark = markRead.mutate
  const done = useRef(false)
  const shelf = useCompanyShelf()

  /* A reminder: named by its note, or by its own link. */
  const linkRule = first(params.rule)
  const linkDue = first(params.due)
  const linkSymbol = first(params.symbol)
  const ruleTarget: Extract<NoteTarget, { kind: 'rule' }> | null =
    resolved?.target.kind === 'rule'
      ? resolved.target
      : !ref && isRuleId(linkRule)
        ? {
            kind: 'rule',
            ruleId: linkRule,
            dueAt: isInstant(linkDue) ? linkDue : null,
            symbol: linkSymbol && SYMBOL.test(linkSymbol) ? linkSymbol : null,
          }
        : null
  const ruleRead = useRule(session, ruleTarget?.ruleId ?? null)
  // A rule that is gone still opens its company when the reminder named it: the page says the rule is gone.
  const goneMint =
    ruleTarget?.symbol && shelf.shelf
      ? ([...shelf.shelf.companies, ...shelf.shelf.privateCompanies].find((card) => card.ticker === ruleTarget.symbol)
          ?.mint ?? null)
      : null

  /* An issuer's event by its own link (M19): the token by its symbol, the swap or the sale. */
  const linkStock = first(params.stock)
  const linkOpen = first(params.open)
  const stockSymbol = !ref && linkStock && SYMBOL.test(linkStock) ? linkStock : null
  const stockAction = linkOpen === 'convert' || linkOpen === 'sell' ? linkOpen : null
  const stockLink = stockSymbol !== null && stockAction !== null
  const stockMint =
    stockLink && shelf.shelf
      ? (shelf.shelf.events.find((event) => event.symbol === stockSymbol)?.mint ??
        [...shelf.shelf.companies, ...shelf.shelf.privateCompanies].find((card) => card.ticker === stockSymbol)?.mint ??
        null)
      : null
  const stockUnknown = stockLink && shelf.shelf !== null && stockMint === null

  const toInbox = () => router.replace('/monitoring')

  // A link is answered from the server as it stands now, not from the last read.
  const refetch = monitoring.refetch
  const refetchPlans = plans.refetch
  useEffect(() => {
    if (!ref || !session) return
    recordJourney('note_resolve', { target: ref.kind })
    void refetch()
    void refetchPlans()
    // Once per note, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.id, session?.address])

  // The one outcome that leaves this screen on its own: the exact plan, once.
  useEffect(() => {
    if (done.current || !resolved) return
    if (resolved.target.kind === 'plan') {
      done.current = true
      if (resolved.note?.unread) mark(resolved.note.id)
      router.replace({
        pathname: '/plans/[id]',
        params: {
          id: resolved.target.planId,
          from: 'monitoring',
          ...(resolved.note ? { note: resolved.note.id } : {}),
        },
      })
    } else if (resolved.target.kind === 'web') {
      done.current = true
      if (resolved.note?.unread) mark(resolved.note.id)
      const href = webHrefOf(resolved.target.href)
      if (href) void Linking.openURL(href)
    } else if (resolved.target.kind === 'budget') {
      // The month's autoinvest budget, spent: Home with the budget's sheet, as the web's own link opens it.
      done.current = true
      if (resolved.note?.unread) mark(resolved.note.id)
      router.replace({ pathname: '/(tabs)', params: { budget: 'edit' } })
    } else if (resolved.target.kind === 'issuer') {
      // An issuer's deadline on a held token: its page with the swap's sheet, as the web's own link opens it.
      done.current = true
      if (resolved.note?.unread) mark(resolved.note.id)
      router.replace({
        pathname: '/asset/[mint]',
        params: { mint: resolved.target.mint, category: 'stock', convert: '1' },
      })
    }
  }, [resolved, mark, router])

  // A reminder: its company's purchase under the rule, once the rule is read — or, gone, its company alone.
  const ruleId = ruleTarget?.ruleId ?? null
  const ruleDue = ruleTarget?.dueAt ?? null
  const ruleSymbol = ruleTarget?.symbol ?? null
  const noteId = resolved?.note?.id ?? null
  const noteUnread = resolved?.note?.unread === true
  useEffect(() => {
    if (done.current || !ruleId || ruleRead.read !== 'ready') return
    const rule = ruleRead.rule
    const mint = rule?.asset.mint ?? goneMint
    if (!mint) return
    done.current = true
    if (noteId && noteUnread) mark(noteId)
    router.replace({
      pathname: '/asset/[mint]',
      params: rulePurchaseParams({ mint, symbol: rule?.asset.symbol ?? ruleSymbol, ruleId, dueAt: ruleDue }),
    })
  }, [ruleId, ruleDue, ruleSymbol, ruleRead.read, ruleRead.rule, goneMint, noteId, noteUnread, mark, router])

  // An issuer's event by its link: the token's page with the swap's sheet — or, a symbol the shelf does not know, the
  // Stocks list where it is found.
  useEffect(() => {
    if (done.current || !stockSymbol || !stockAction) return
    if (stockMint) {
      done.current = true
      router.replace({
        pathname: '/asset/[mint]',
        params: { mint: stockMint, symbol: stockSymbol, category: 'stock', [stockAction]: '1' },
      })
    } else if (stockUnknown) {
      done.current = true
      router.replace(listsPath('stock') as never)
    }
  }, [stockSymbol, stockAction, stockMint, stockUnknown, router])

  // A web-only page: opened once, and said.
  useEffect(() => {
    if (done.current || !web || ref) return
    done.current = true
    void Linking.openURL(web)
  }, [web, ref])

  const resolving = (
    <View className="gap-3 px-4 pt-2" accessibilityRole="progressbar" accessibilityLabel={copy.resolving}>
      <Txt variant="ui" tone="faint" className="px-1">
        {copy.resolving}
      </Txt>
      <Skeleton className="h-24 rounded-sm" />
    </View>
  )

  let body
  if (stockLink) {
    body = resolving
  } else if (!ref && !ruleTarget && web) {
    body = (
      <StateView
        icon="globe-outline"
        title={copy.webTitle}
        detail={copy.webDetail}
        action={{ title: copy.openOnWeb, onPress: () => void Linking.openURL(web) }}
      />
    )
  } else if (!ref && !ruleTarget) {
    body = (
      <StateView
        icon="notifications-off-outline"
        title={copy.unknownTitle}
        detail={copy.unknownDetail}
        action={{ title: copy.backToInbox, onPress: toInbox }}
      />
    )
  } else if (!session) {
    body = null
  } else if (ruleTarget) {
    if (ruleRead.read === 'failed')
      body = (
        <StateView
          icon="alert-circle-outline"
          tone="danger"
          title={ruleCopy.ruleReadFailed}
          action={{
            title: ruleCopy.tryAgain,
            onPress: () => void ruleRead.query.refetch(),
            loading: ruleRead.query.isFetching,
          }}
        />
      )
    else if (ruleRead.read === 'ready' && !ruleRead.rule && !goneMint && shelf.shelf)
      body = (
        <StateView
          icon="repeat-outline"
          title={ruleCopy.ruleGone}
          action={{ title: copy.backToInbox, onPress: toInbox }}
        />
      )
    else body = resolving
  } else if (!resolved) {
    body = (
      <View className="gap-3 px-4 pt-2" accessibilityRole="progressbar" accessibilityLabel={copy.resolving}>
        <Txt variant="ui" tone="faint" className="px-1">
          {reading ? copy.resolving : copy.couldNotLoad}
        </Txt>
        <Skeleton className="h-24 rounded-sm" />
        <Skeleton className="h-16 rounded-sm" />
      </View>
    )
  } else if (resolved.target.kind === 'choose') {
    const candidates = resolved.target.planIds
      .map((id) => plans.data?.plans.find((plan) => plan.id === id) ?? null)
      .filter((plan) => plan !== null)
    const symbol = resolved.target.symbol
    body = (
      <View className="gap-3 px-4 pt-2">
        {resolved.note ? (
          <Card className="gap-1">
            <Txt variant="ui">{resolved.note.title}</Txt>
            {resolved.note.reason ? (
              <Txt variant="labelSm" tone="faint">
                {resolved.note.reason}
              </Txt>
            ) : null}
          </Card>
        ) : null}
        <View className="gap-1 px-1">
          <Txt variant="title">{copy.choosePlanTitle(symbol)}</Txt>
          <Txt variant="ui" tone="muted">
            {copy.choosePlanDetail}
          </Txt>
        </View>
        <Card padded={false} className="px-4">
          {candidates.map((plan, index) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              copy={plansCopy}
              locale={locale}
              now={now}
              onPress={() => {
                if (resolved.note?.unread) mark(resolved.note.id)
                router.replace({
                  pathname: '/plans/[id]',
                  params: { id: plan.id, from: 'monitoring', ...(resolved.note ? { note: resolved.note.id } : {}) },
                })
              }}
              last={index === candidates.length - 1}
            />
          ))}
        </Card>
      </View>
    )
  } else if (resolved.target.kind === 'gone') {
    body = (
      <StateView
        icon="git-branch-outline"
        title={copy.goneTitle}
        detail={copy.goneDetail}
        action={{ title: copy.backToInbox, onPress: toInbox }}
      />
    )
  } else if (resolved.target.kind === 'unknown' && settling) {
    body = resolving
  } else if (resolved.target.kind === 'unknown') {
    body = (
      <StateView
        icon="notifications-off-outline"
        title={copy.unknownTitle}
        detail={copy.unknownDetail}
        action={{ title: copy.backToInbox, onPress: toInbox }}
      />
    )
  } else if (resolved.target.kind === 'web') {
    const href = webHrefOf(resolved.target.href)
    body = (
      <StateView
        icon="globe-outline"
        title={copy.webTitle}
        detail={copy.webDetail}
        action={
          href
            ? { title: copy.openOnWeb, onPress: () => void Linking.openURL(href) }
            : { title: copy.backToInbox, onPress: toInbox }
        }
      />
    )
  } else {
    body = resolving
  }

  return (
    <View className="flex-1 bg-ground" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 px-2 pt-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shared.back}
          onPress={() => (router.canGoBack() ? router.back() : toInbox())}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-btn active:bg-hover"
        >
          <Icon name="arrow-back" size={22} color="fg" />
        </Pressable>
        <View className="flex-1">
          <ScreenHeader title={copy.title} />
        </View>
      </View>
      {/* A page that opens on the web needs no session on the phone; everything else is the wallet's own. */}
      {(!ref && !ruleTarget && web) || stockLink ? body : <SessionGate what={copy.title}>{body}</SessionGate>}
    </View>
  )
}
