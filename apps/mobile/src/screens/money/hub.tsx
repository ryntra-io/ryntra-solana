import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import { Icon, type IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { HIDDEN_AMOUNT } from '@/features/home/home-model'
import { useAmountsHidden } from '@/features/home/last-look'
import { HISTORY_COPY } from '@/features/history/copy'
import { siteHrefOf, webHrefOf } from '@/features/monitoring/deep-link'
import { unitsText, type HistoryRow } from '@/features/history/history-model'
import { useHistory } from '@/features/history/use-history'
import { INVEST_COPY } from '@/features/invest/copy'
import { MONEY_COPY } from '@/features/money/copy'
import { spendableOf } from '@/features/money/money-model'
import { PAY_COPY } from '@/features/money/pay-copy'
import { useRecentRecipients } from '@/features/money/recipients-store'
import { useMyPayLinks } from '@/features/money/use-pay-links'
import { useHoldings } from '@/features/portfolio/use-portfolio'
import { useAccount } from '@/features/session/use-account'
import { MENU_COPY, MENU_DESTINATIONS, MONEY_ACTIONS, rowLives, type NavItemId } from '@/features/shell/menu'
import { HISTORY_PATH, TAB_TITLES } from '@/features/shell/shell'
import { useNow } from '@/hooks/use-now'
import { USDC_MINT } from '@/lib/api'
import { useCopy, useLocale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { HistoryRowView } from '@/screens/history/history-row'
import { ReceiptSheet } from '@/screens/history/receipt-sheet'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { RecentCircle } from '@/screens/money/recent-circle'
import { fonts } from '@/theme'
import { cn } from '@/utils/cn'
import { DASH, formatAt } from '@/utils/format'

/** Each large action's glyph: the plus of a top-up, the paper plane of a send, the arrow in, two ways across. */
const ACTION_ICONS: Readonly<Partial<Record<NavItemId, IconName>>> = {
  deposit: 'add',
  send: 'paper-plane-outline',
  receive: 'arrow-down',
  bridge: 'swap-horizontal-outline',
}

/** No spendable units: nothing read, or every digit a zero. */
const none = (raw: string | null | undefined) => !raw || /^0*$/.test(raw)
/** How many recipients and payments the place draws before «Усі». */
const RECENT_ON_PLACE = 5
const PAYMENTS_ON_PLACE = 3

/**
 * «Гроші» (Menu 3, decision 55): «Можна надіслати» — USDC large, SOL under it
 * with the time it was read (no network named: the phone is Solana alone) — then the core's four large actions, two by two:
 * Поповнити · Надіслати · Отримати · Між мережами. One is orange: Надіслати,
 * or Поповнити while the wallet holds nothing to send. «Між мережами» opens the
 * web's page that brings money to Solana from another network, and says it
 * opens the browser. «Нещодавні», the addresses this phone sent to, a tap
 * starting a transfer to one; «Останні платежі» — the latest sent and received,
 * a payment link still awaiting, and «Усі» in History. «Мій QR» in the head
 * opens «Отримати», where the payment link lives too. `?open=top-up` — the
 * web's `/app/top-up` — opens the top-up at once.
 */
export function MoneyHubScreen() {
  const router = useRouter()
  const money = useCopy(MONEY_COPY)
  // Home's own word for figures a failed read left standing — one wording on Home and in «Гроші».
  const invest = useCopy(INVEST_COPY)
  const pay = useCopy(PAY_COPY)
  const titles = useCopy(TAB_TITLES)
  const menu = useCopy(MENU_COPY)
  const locale = useLocale()
  const now = useNow(60_000)
  const account = useAccount()
  const hidden = useAmountsHidden()
  const holdings = useHoldings(account.address)
  const recents = useRecentRecipients(account.address)
  const history = useHistory(account.address, account.session)
  const links = useMyPayLinks(account.session)
  const { open: opened } = useLocalSearchParams<{ open?: string }>()
  const [toppingUp, setToppingUp] = useState(opened === 'top-up')
  // A payment's row opens its own receipt where it stands; «Усі» opens «Портфель · Історія».
  const [picked, setPicked] = useState<HistoryRow | null>(null)
  const historyCopy = useCopy(HISTORY_COPY)
  // A link that asks for the top-up while the screen is already open opens it once, during render.
  const [openedSeen, setOpenedSeen] = useState(opened)
  if (opened !== openedSeen) {
    setOpenedSeen(opened)
    if (opened === 'top-up') setToppingUp(true)
  }
  // The ask is spent once read, so the same link opens the top-up again.
  useEffect(() => {
    if (opened) router.setParams({ open: undefined })
  }, [opened, router])

  const go = (action: NavItemId) => {
    const destination = MENU_DESTINATIONS[action]
    if (!destination) return
    if (destination.kind === 'sheet') setToppingUp(true)
    else if (destination.kind === 'site') openLink(siteHrefOf(destination.url, locale))
    else if (destination.kind === 'web') {
      const web = webHrefOf(destination.path, locale)
      if (web) openLink(web)
    } else router.push(destination.path as never)
  }
  const openPayLinks = () => router.push('/money/receive?tab=link' as never)

  /* ---- what can be sent: the wallet's spendable USDC and SOL, with the time they were read ---- */
  const data = holdings.data?.data ?? null
  const usdc = data?.holdings.find((row) => row.mint === USDC_MINT) ?? null
  const sol = data?.holdings.find((row) => row.kind === 'NATIVE_SOL') ?? null
  // Unknown is a dash: a row whose spendable did not come, or a token absent from a read that missed accounts.
  const usdcCan = data ? spendableOf(usdc, data.tokenRead === 'COMPLETE') : null
  const solCan = data ? spendableOf(sol, /^0*$/.test(data.lamports)) : null
  const units = (can: ReturnType<typeof spendableOf>, decimals: number, places: number) =>
    can ? unitsText(can.raw, can.decimals ?? decimals, places, locale) : DASH
  // A read that failed after one that answered keeps the last figures, labelled the way Home labels them.
  const notUpdated = holdings.isError
  let balance
  if (!account.address) {
    balance = (
      <Card className="gap-3">
        <Button
          title={money.connectWallet}
          loading={account.busy === 'connect'}
          onPress={() => void account.connect()}
        />
      </Card>
    )
  } else if (!data) {
    balance = holdings.isError ? (
      <Txt variant="ui" tone="muted">
        {money.holdingsFailed}
      </Txt>
    ) : (
      <Skeleton className="h-10 w-44" accessibilityRole="progressbar" />
    )
  } else {
    balance = (
      <View className="gap-1">
        <Txt variant="ui" tone="muted">
          {pay.canSend}
        </Txt>
        <View className="flex-row items-baseline gap-2">
          <Txt variant="display" tabular>
            {hidden ? HIDDEN_AMOUNT : units(usdcCan, 6, 2)}
          </Txt>
          <Txt variant="title" tone="muted">
            USDC
          </Txt>
        </View>
        <Txt variant="labelSm" tone={notUpdated ? 'warning' : 'faint'} tabular>
          {[
            `${hidden ? HIDDEN_AMOUNT : units(solCan, 9, 4)} SOL`,
            formatAt(data.observedAt, now, locale),
            notUpdated ? invest.notUpdated : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Txt>
      </View>
    )
  }

  // One orange action on the screen once the balance is read: «Надіслати», «Поповнити» while the wallet holds nothing
  // to send; a guest's is «Під’єднати гаманець».
  const empty = data !== null && none(usdc?.spendableRaw) && none(sol?.spendableRaw)
  // A failed read keeps «Надіслати» orange: the send reads the balance again itself.
  const primary: NavItemId | null =
    account.address && (data !== null || holdings.isError) ? (empty ? 'deposit' : 'send') : null
  const actions = MONEY_ACTIONS.filter((id) => rowLives(id))
  const pairs = [actions.slice(0, 2), actions.slice(2, 4)].filter((pair) => pair.length > 0)
  const payments = history.rows
    .filter((row) => row.kind === 'send' || row.kind === 'receive')
    .slice(0, PAYMENTS_ON_PLACE)
  const awaiting = (links.data?.links ?? []).filter((link) => link.status === 'AWAITING').length

  return (
    <Screen
      title={titles.money}
      right={
        account.address ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pay.myQr}
            onPress={() => go('receive')}
            className="h-11 w-11 items-center justify-center rounded-pill active:bg-hover"
            hitSlop={4}
          >
            <Icon name="qr-code-outline" size={22} color="fg" />
          </Pressable>
        ) : undefined
      }
    >
      {balance}
      <View className="gap-3" accessibilityRole="toolbar">
        {pairs.map((pair) => (
          <View key={pair.join('-')} className="flex-row gap-3">
            {pair.map((action) => {
              const destination = MENU_DESTINATIONS[action]
              const leaves = destination?.kind === 'web' || destination?.kind === 'site'
              const orange = primary === action
              return (
                <Pressable
                  key={action}
                  accessibilityRole={leaves ? 'link' : 'button'}
                  accessibilityLabel={leaves ? `${menu.items[action]}, ${menu.inBrowser}` : menu.items[action]}
                  onPress={() => go(action)}
                  className={cn(
                    'min-h-[96px] flex-1 justify-between gap-3 rounded-lg p-4 active:opacity-80',
                    orange ? 'bg-brand' : 'border border-line bg-elevated',
                  )}
                >
                  <View className="flex-row items-start justify-between">
                    <Icon
                      name={ACTION_ICONS[action] ?? 'ellipse-outline'}
                      size={24}
                      color={orange ? 'onBrand' : 'fg'}
                    />
                    {leaves ? (
                      <Icon
                        name="arrow-up-outline"
                        size={16}
                        color={orange ? 'onBrand' : 'fgMuted'}
                        style={{ transform: [{ rotate: '45deg' }] }}
                      />
                    ) : null}
                  </View>
                  <Txt
                    variant="ui"
                    tone={orange ? 'onBrand' : undefined}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                    style={{ fontFamily: fonts.sansSemibold }}
                  >
                    {menu.items[action]}
                  </Txt>
                </Pressable>
              )
            })}
          </View>
        ))}
      </View>
      {recents.length > 0 ? (
        <View className="gap-2">
          <Txt variant="title" accessibilityRole="header">
            {pay.recent}
          </Txt>
          <View className="flex-row flex-wrap gap-3">
            {recents.slice(0, RECENT_ON_PLACE).map((entry) => (
              <RecentCircle
                key={entry.address}
                address={entry.address}
                label={pay.actions.send}
                onPress={() => router.push({ pathname: '/money/send', params: { to: entry.address } })}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pay.newRecipient}
              onPress={() => go('send')}
              className="w-16 items-center gap-1.5 active:opacity-80"
            >
              <View className="h-[52px] w-[52px] items-center justify-center rounded-pill border border-dashed border-line-strong">
                <Icon name="add" size={20} color="muted" />
              </View>
              <Txt variant="labelSm" tone="muted" numberOfLines={1}>
                {pay.newRecipient}
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : null}
      {payments.length > 0 || awaiting > 0 ? (
        <View className="gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <Txt variant="title" accessibilityRole="header" className="flex-1">
              {pay.lastPayments}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pay.all}
              // «Усі» opens the list the block is made of: the payments in History, or — when the block holds only
              // payment links awaiting payment — the links themselves in «Отримати». History opens over «Гроші», so
              // Back returns here.
              onPress={() => (payments.length > 0 ? router.push(HISTORY_PATH as never) : openPayLinks())}
              hitSlop={8}
              className="min-h-11 flex-row items-center gap-1 active:opacity-80"
            >
              <Txt variant="ui" tone="muted">
                {pay.all}
              </Txt>
              <Icon name="chevron-forward" size={14} color="fgMuted" />
            </Pressable>
          </View>
          {payments.length > 0 ? (
            <Card padded={false} className="px-4">
              {payments.map((row, index) => (
                <HistoryRowView
                  key={row.id}
                  item={row}
                  time={formatAt(row.at, now, locale)}
                  onPress={() => setPicked(row)}
                  last={index === payments.length - 1 && awaiting === 0}
                  hidden={hidden}
                />
              ))}
            </Card>
          ) : null}
          {awaiting > 0 ? (
            <Card padded={false}>
              <DoorRow
                icon="link-outline"
                label={money.pages.link}
                value={`${money.status.AWAITING} · ${awaiting}`}
                onPress={openPayLinks}
                last
              />
            </Card>
          ) : null}
        </View>
      ) : null}
      {/* Said only once both reads answered: a failed or late read is never «nothing here». */}
      {account.address &&
      recents.length === 0 &&
      payments.length === 0 &&
      awaiting === 0 &&
      history.activity.isSuccess &&
      (account.session === null || links.isSuccess) ? (
        <Txt variant="ui" tone="faint" className="text-center">
          {pay.empty}
        </Txt>
      ) : null}
      <ReceiptSheet row={picked} now={now} locale={locale} copy={historyCopy} onClose={() => setPicked(null)} />
      <TopUpSheet
        visible={toppingUp}
        address={account.address}
        purpose="top-up"
        onClose={() => setToppingUp(false)}
        onConnect={() => void account.connect()}
        connecting={account.busy === 'connect'}
      />
    </Screen>
  )
}
