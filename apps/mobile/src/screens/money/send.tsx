import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler, Pressable, TextInput, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { BOTTOM_ACTION_INSET, BottomAction } from '@/components/bottom-action'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Keypad } from '@/components/keypad'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { HISTORY_COPY } from '@/features/history/copy'
import { unitsText } from '@/features/history/history-model'
import { MONEY_COPY, type MoneyCopy } from '@/features/money/copy'
import { decimalText, evidenceSummary, shortAddress, type SendAsset } from '@/features/money/money-model'
import { PAY_COPY, type SendStep } from '@/features/money/pay-copy'
import { isNewRecipient, lookalikeOf, type RecentRecipient } from '@/features/money/recipients'
import { rememberRecipient, useRecentRecipients } from '@/features/money/recipients-store'
import type { SendFailure } from '@/features/money/send-flow'
import { useSend, type SendDone, type SendPhase } from '@/features/money/use-send'
import { SEEKER_COPY } from '@/features/seeker/copy'
import { skrNameOf } from '@/features/seeker/seeker-model'
import { docFromSend } from '@/features/receipts/receipt-doc'
import { useOpenPlace, usePlaceHold } from '@/features/shell/open-place'
import { PAYMENTS_PATH, PORTFOLIO_HISTORY_PATH } from '@/features/shell/shell'
import { pressKey } from '@/features/trade/keypad-model'
import { SHEET_COPY } from '@/features/trade/sheet-copy'
import { unitsForField } from '@/features/trade/trade-model'
import type { TransferCheck } from '@/lib/api'
import { pasteText } from '@/lib/clipboard'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { type, useTheme } from '@/theme'
import { formatUsd, formatUsdCompact } from '@/utils/format'

import { TopUpSheet } from '@/screens/home/top-up-sheet'

import { ShareReceiptButton } from '@/screens/receipts/share-receipt'
import { DoneBody } from '@/screens/trade/sheet-parts'

import { PayLinkPanel } from './pay-link-panel'
import { RecentCircle } from './recent-circle'
import { SendPendingCard, SendReview } from './send-parts'
import { Scanner } from './scanner'

/**
 * «Надіслати» — four steps under a strip (NEW-LOOK §3 «Платежі»): Кому → Сума
 * → Перевірка → Готово. Кому: an address typed, pasted or scanned (an address,
 * a Solana Pay code or a Ryntra link — the server says which, M31), or one of
 * «Нещодавні»; a new address says so, and one that imitates a recent address
 * stops «Далі» until it is pasted in again. Сума: the recipient as a pill, the
 * sum large with its token, the keypad. Перевірка: the server's own check, a
 * new address's caution and «Переказ у блокчейні не скасувати.», then the
 * wallet. Готово: what happened, the receipt kept. A `.skr` name in «Кому»
 * (M41.2) is read on the server every time and again before the Review, before
 * the wallet and after it; the Review shows the name and the whole address it
 * points to now. A scanned Ryntra link is paid as the link it is; a
 * transfer this phone signed and never saw the end of is said first, and holds
 * back a second signature until the network answers.
 */
export function SendScreen() {
  const router = useRouter()
  const openPlace = useOpenPlace()
  const shared = useSharedCopy()
  const words = useCopy(MONEY_COPY)
  const pay = useCopy(PAY_COPY)
  const seeker = useCopy(SEEKER_COPY)
  const historyWords = useCopy(HISTORY_COPY)
  const sheet = useCopy(SHEET_COPY)
  const locale = useLocale()
  const { colors } = useTheme()
  const send = useSend()
  const [scanning, setScanning] = useState(false)
  const [picking, setPicking] = useState(false)
  const [toppingUp, setToppingUp] = useState(false)
  const [step, setStep] = useState<'to' | 'amount'>('to')
  // The address «Далі» left «Кому» with: what «Сума», «Перевірка» and the wallet are for.
  const [chosenAddress, setChosenAddress] = useState<string | null>(null)
  // A look-alike address the person pasted in again on purpose — «Далі» opens for exactly that text.
  const [confirmedText, setConfirmedText] = useState<string | null>(null)
  const account = send.account
  const recents = useRecentRecipients(account.address)
  const { to: prefilled } = useLocalSearchParams<{ to?: string }>()
  // A recipient chosen in «Гроші» arrives once and fills «Кому»; the ask is then spent.
  const setRecipient = send.setRecipientText
  useEffect(() => {
    if (!prefilled) return
    router.setParams({ to: undefined })
    setRecipient(prefilled, true)
  }, [prefilled, router, setRecipient])

  // A transfer that went out joins «Нещодавні» on this phone.
  const sentTo = send.done?.outcome === 'sent' ? send.done.to : null
  const sentAt = send.done?.at ?? null
  const wallet = account.address
  useEffect(() => {
    if (wallet && sentTo && sentAt) rememberRecipient(wallet, sentTo, sentAt)
  }, [wallet, sentTo, sentAt])

  const close = () => (router.canGoBack() ? router.back() : router.replace(PAYMENTS_PATH as never))
  const reviewOpen =
    send.review !== null &&
    (send.phase === 'review' || send.phase === 'preparing' || send.phase === 'signing' || send.phase === 'sending')
  const working = send.phase === 'preparing' || send.phase === 'signing' || send.phase === 'sending'
  // While it is prepared, signed, sent or checked, a note's tap or a quick action waits for it (`place-hold.ts`).
  usePlaceHold(working)
  const current: SendStep = send.done ? 'done' : reviewOpen ? 'check' : step
  const stepBack = (): boolean => {
    if (working) return true
    // Back while «Готую…» voids it: the Review it was preparing never opens over «Кому».
    if (send.phase === 'reviewing') send.closeReview()
    if (current === 'check') {
      send.closeReview()
      return true
    }
    if (current === 'amount') {
      setStep('to')
      return true
    }
    return false
  }
  const stepBackRef = useRef(stepBack)
  useEffect(() => {
    stepBackRef.current = stepBack
  })
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => stepBackRef.current())
      return () => sub.remove()
    }, []),
  )

  if (!account.address) {
    return (
      <Screen title={words.sendTitle} onBack={close} backLabel={shared.back}>
        <StateView
          icon="arrow-up-outline"
          title={words.connectToSend}
          action={{
            title: words.connectWallet,
            onPress: () => void account.connect(),
            loading: account.busy === 'connect',
          }}
        />
      </Screen>
    )
  }

  const asset = send.asset
  const payingLink = send.view?.kind === 'pay-link' ? send.view.link : null
  const busy = send.phase === 'reviewing' || working
  const usd =
    asset && asset.usdPrice !== null && send.amountRaw
      ? (Number(send.amountRaw) / 10 ** asset.decimals) * asset.usdPrice
      : null
  const address = send.view?.kind === 'transfer' ? send.view.address : null
  const fresh = address !== null && isNewRecipient(recents, address)
  const lookalike = address !== null ? lookalikeOf(recents, address) : null
  const typed = send.recipientText.trim()
  const lookalikeStops = lookalike !== null && confirmedText !== typed
  const namesServed = send.namesServed
  const typedName = skrNameOf(typed) !== null

  const paste = async () => {
    const text = await pasteText()
    if (!text) return
    // The same text put in again is the person's own decision about a look-alike.
    if (text.trim() === typed) setConfirmedText(text.trim())
    send.setRecipientText(text, true)
  }

  /* ---- the step's one action — M31's own guards first, in their order, then the step's ---- */
  // «Сума» belongs to the recipient chosen on «Кому»: a re-read of it (another asset picked) never opens «Кому» again.
  const onAmount = current === 'amount' && chosenAddress !== null
  const recipientHolds = address !== null && address === chosenAddress
  let action: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; hint?: string } = {
    title: pay.next,
    onPress: () => {
      send.clearFailure()
      setChosenAddress(address)
      setStep('amount')
    },
  }
  if (send.blocked) action = { title: words.waitingEarlier, onPress: () => undefined, disabled: true }
  else if (onAmount && send.phase === 'reviewing')
    action = { title: words.preparing, onPress: () => undefined, loading: true }
  else if (send.askedTooFine)
    action = { ...action, title: words.cannotBeSent, disabled: true, hint: words.askedTooFine }
  else if (send.askedMissing)
    action = { ...action, title: words.cannotBeSent, disabled: true, hint: words.askedNotHeld }
  else if (send.holdings.isError && !send.holdings.data)
    action = { title: words.tryAgain, onPress: () => void send.holdings.refetch(), hint: words.holdingsFailed }
  else if (!onAmount) {
    if (typed === '') action = { ...action, title: words.enterRecipient, disabled: true }
    else if (send.checkingRecipient) action = { ...action, title: words.checkingRecipient, disabled: true }
    // A short address still being typed is judged on the tap (ST-5 r8): the wrong length is said, never a dead button.
    else if (send.view?.kind !== 'transfer')
      action = send.recipientTyping
        ? { ...action, title: words.checkRecipient, onPress: send.finishRecipient }
        : {
            ...action,
            title: typedName && (send.nameUnread || send.nameMissing) ? seeker.checkName : words.checkRecipient,
            disabled: true,
          }
    else if (lookalikeStops) action = { ...action, disabled: true, hint: pay.pasteAgain }
  } else {
    action = { title: pay.next, onPress: () => void send.requestReview() }
    if (!asset && !send.holdings.isLoading)
      // Nothing to send: «Кому» is walked all the same; the top-up is the amount's one way on.
      action = { title: words.pages.topUp, onPress: () => setToppingUp(true), hint: words.noAssets }
    else if (!asset) action = { ...action, title: words.chooseAsset, disabled: true }
    else if (send.checkingRecipient) action = { ...action, title: words.checkingRecipient, disabled: true }
    // The recipient is read again for each asset: only the address chosen on «Кому», still a transfer, goes on —
    // one that changed (a name now pointing elsewhere, M41.2) takes the person back to «Кому» to see it.
    else if (!recipientHolds) action = { ...action, title: words.checkRecipient, onPress: () => setStep('to') }
    else if (!send.amountRaw) action = { ...action, title: words.enterAmount, disabled: true }
    else if (send.over) action = { ...action, title: words.notEnough(asset.symbol), disabled: true }
  }

  /* ---- what the step shows ---- */
  const index = SEND_STEPS.indexOf(current)
  let body: ReactNode
  let footer: ReactNode = (
    <BottomAction
      title={action.title}
      onPress={action.onPress}
      disabled={action.disabled}
      loading={action.loading}
      hint={action.hint}
    />
  )
  if (current === 'done' && send.done) {
    const done = send.done
    body = <SendDoneStep done={done} onReceipt={() => openPlace(PORTFOLIO_HISTORY_PATH)} />
    footer = (
      <View className="flex-row gap-2 px-4 pb-3 pt-2">
        {done.outcome === 'not-sent' ? null : (
          <View className="flex-1">
            <ShareReceiptButton
              variant="button"
              doc={docFromSend(
                {
                  ...done,
                  title:
                    done.outcome === 'sent'
                      ? historyWords.words.sent(done.symbol)
                      : `${words.notConfirmed} · ${done.symbol}`,
                },
                locale,
              )}
            />
          </View>
        )}
        <View className="flex-1">
          <Button title={sheet.finish} size="lg" onPress={close} />
        </View>
      </View>
    )
  } else if (current === 'check' && send.review && asset) {
    body = (
      <SendCheckStep
        check={send.review.check}
        symbol={asset.symbol}
        name={send.reviewName}
        fresh={fresh}
        lookalikeOf={lookalike?.address ?? null}
        phase={send.phase}
        failure={send.failure}
        blocked={send.blocked}
        onConfirm={() => void send.confirm()}
        onCancel={send.closeReview}
        onCancelWait={send.cancelSigning}
      />
    )
    footer = null
  } else if (current === 'amount' && chosenAddress) {
    body = (
      <View className="gap-3">
        <View className="flex-row items-center gap-2 self-center rounded-pill border border-line bg-surface py-1.5 pl-1.5 pr-3">
          <View className="h-7 w-7 items-center justify-center rounded-pill bg-elevated">
            <Icon name="person-outline" size={14} color="fg" />
          </View>
          {/* The `.skr` name the address came from (or that address's own), else its short form. */}
          <Txt variant="data">
            {(recipientHolds ? (send.recipientName ?? send.addressName) : null) ?? shortAddress(chosenAddress)}
          </Txt>
        </View>
        {/* Read again for another asset: the problem, if any, said here — «Кому» is a step back. */}
        {!send.checkingRecipient && !recipientHolds ? <RecipientLine send={send} words={words} /> : null}
        <View className="items-center gap-1" accessibilityLiveRegion="polite">
          <Txt variant="display" tabular numberOfLines={1} adjustsFontSizeToFit>
            {`${send.amountText || '0'} ${asset?.symbol ?? ''}`}
          </Txt>
          <Txt variant="data" tone="muted">
            {/* To the cent under $100 000 («≈ $12,34»); only a large sum is said short. */}
            {usd !== null && Number.isFinite(usd)
              ? `≈ ${Math.abs(usd) < 100_000 ? formatUsd(usd, locale) : formatUsdCompact(usd, locale)}`
              : '—'}
          </Txt>
          {send.over && asset ? (
            <Txt variant="ui" tone="danger">
              {words.notEnough(asset.symbol)}
            </Txt>
          ) : null}
        </View>
        {/* With a token chosen: the token and what is available, edge to edge; before one, «Актив ▾» under the sum. */}
        <View className={`flex-row items-center gap-3 ${asset ? 'justify-between' : 'justify-center'}`}>
          <AssetButton
            asset={asset}
            words={words}
            onPress={() => setPicking(true)}
            disabled={busy || send.asked !== null}
          />
          {asset ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${words.max}: ${unitsText(asset.spendableRaw, asset.decimals, 6, locale)} ${asset.symbol}`}
              onPress={() => send.setAmountText(unitsForField(asset.spendableRaw, asset.decimals, locale))}
              disabled={busy}
              className="min-h-12 flex-row items-center gap-2"
            >
              <Txt variant="data" tone={send.over ? 'danger' : 'muted'}>
                {words.available(unitsText(asset.spendableRaw, asset.decimals, 6, locale))}
              </Txt>
              <View className="rounded-pill border border-brand-chip-line bg-brand-chip px-2.5 py-1">
                <Txt variant="labelSm" tone="brand">
                  {words.max}
                </Txt>
              </View>
            </Pressable>
          ) : null}
        </View>
        {send.asked && asset ? (
          <Txt variant="ui" tone="muted">
            {[
              send.asked.amount ? `${words.asked}: ${decimalText(send.asked.amount, locale)} ${asset.symbol}` : null,
              send.asked.label,
              send.asked.message,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Txt>
        ) : null}
        {/* Said for the token chosen, never before one is (M44.6). */}
        {send.opensAccount && asset ? (
          <Txt variant="ui" tone="muted">
            {words.opensAccount}
          </Txt>
        ) : null}
        {send.failure && send.phase === 'idle' ? (
          <Txt variant="ui" tone="danger">
            {words.failures[send.failure.key]}
          </Txt>
        ) : null}
        <Keypad
          mark={locale === 'uk' ? ',' : '.'}
          onKey={(key) =>
            send.setAmountText(pressKey(send.amountText, key, locale === 'uk' ? ',' : '.', asset?.decimals ?? null))
          }
          deleteLabel={sheet.keypadDelete}
          disabled={busy || asset === null}
        />
      </View>
    )
  } else {
    body = (
      <View className="gap-3">
        <Card className="gap-2">
          <Txt variant="labelSm" tone="faint" caps>
            {words.to}
          </Txt>
          <View className="flex-row items-center gap-2">
            {/* The whole address, wrapped onto a second line rather than cut to its tail; nothing suggested or filled. */}
            <TextInput
              value={send.recipientText}
              onChangeText={(text) => send.setRecipientText(text)}
              placeholder={namesServed ? seeker.toPlaceholder : pay.toPlaceholder}
              placeholderTextColor={colors.fgMuted}
              selectionColor={colors.brand}
              cursorColor={colors.brand}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              spellCheck={false}
              editable={!busy}
              accessibilityLabel={words.to}
              multiline
              // The keyboard's own key takes the step on, exactly as «Далі» does — only when «Далі» is open; never a new line.
              submitBehavior="blurAndSubmit"
              returnKeyType="next"
              onBlur={send.finishRecipient}
              onSubmitEditing={() => {
                send.finishRecipient()
                if (!action.disabled && !action.loading) action.onPress()
              }}
              className="min-h-12 flex-1 text-fg"
              // A line tall enough for 15-pt type's descenders (ST-5): «у» of «…на оплату» and "y" of "pay" are never cut.
              style={[type.data, { paddingVertical: 10, fontSize: 15, lineHeight: 21, textAlignVertical: 'center' }]}
            />
            {send.recipientText.length > 0 ? (
              <IconButton icon="close-circle" label={pay.clear} onPress={() => send.setRecipientText('')} />
            ) : null}
            <IconButton icon="clipboard-outline" label={words.paste} onPress={() => void paste()} />
            <IconButton icon="qr-code-outline" label={words.scan} onPress={() => setScanning(true)} />
          </View>
          <RecipientLine send={send} words={words} />
          {address && lookalike ? (
            <View className="flex-row items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5">
              <Icon name="warning-outline" size={18} color="warningInk" />
              <Txt variant="ui" className="flex-1">
                {lookalikeStops ? `${pay.lookalike} ${pay.pasteAgain}` : pay.lookalike}
              </Txt>
            </View>
          ) : address && fresh ? (
            <Txt variant="ui" tone="warning">
              {pay.newAddress}
            </Txt>
          ) : null}
        </Card>
        {payingLink ? <PayLinkPanel link={payingLink} /> : null}
        {typed === '' && recents.length > 0 ? (
          <RecentRow recents={recents} title={pay.recent} onPick={(picked) => send.setRecipientText(picked, true)} />
        ) : null}
      </View>
    )
    if (payingLink) footer = null
  }

  return (
    <View className="flex-1 bg-ground">
      <View className="flex-1">
        <Screen
          title={words.sendTitle}
          onBack={current === 'done' ? undefined : working ? undefined : () => (stepBack() ? undefined : close())}
          backLabel={shared.back}
          bottomInset={footer ? BOTTOM_ACTION_INSET : 0}
        >
          <StepStrip index={index} labels={SEND_STEPS.map((value) => pay.steps[value])} />
          {send.resumed ? (
            <SendPendingCard
              pending={send.resumed.record}
              show={send.resumed.show}
              signedIn={account.session !== null}
              signingIn={account.signingIn}
              onSignIn={() => void account.signIn()}
              onRecheck={send.canRecheck ? send.recheck : null}
            />
          ) : null}
          {body}
        </Screen>
      </View>
      {footer}

      <TopUpSheet visible={toppingUp} address={account.address} purpose="top-up" onClose={() => setToppingUp(false)} />

      <Scanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScan={(text) => {
          if (text.trim() === typed) setConfirmedText(text.trim())
          send.setRecipientText(text, true)
        }}
      />

      <AssetSheet
        visible={picking}
        assets={send.assets}
        loading={send.holdings.isLoading}
        chosen={asset?.key ?? null}
        locale={locale}
        words={words}
        onClose={() => setPicking(false)}
        onPick={(key) => {
          send.chooseAsset(key)
          setPicking(false)
        }}
      />
    </View>
  )
}

/** «Перевірка» of a transfer: «Надсилаєш …», a new address's caution, the server's check (M31), and the one sentence. */
export function SendCheckStep({
  check,
  symbol,
  name = null,
  fresh,
  lookalikeOf = null,
  phase,
  failure,
  blocked,
  onConfirm,
  onCancel,
  onCancelWait = null,
}: {
  check: TransferCheck
  symbol: string
  /** The `.skr` name of the whole address below it — only when read again to exactly that address (M41.2). */
  name?: string | null
  fresh: boolean
  /** A recent address this one imitates — said as such, never with the advice to match the edges. */
  lookalikeOf?: string | null
  phase: SendPhase
  failure: SendFailure | null
  blocked: boolean
  onConfirm: () => void
  onCancel: () => void
  /** «Скасувати» while the wallet is asked (M45). */
  onCancelWait?: (() => void) | null
}) {
  const pay = useCopy(PAY_COPY)
  const words = useCopy(MONEY_COPY)
  const locale = useLocale()
  return (
    <View className="gap-3">
      <Txt variant="title" tabular>
        {check.signable ? pay.youSend(`${decimalText(check.send.amount, locale)} ${symbol}`) : words.cannotBeSent}
      </Txt>
      {/* Said before the wallet is asked, never after; nothing to say when it will not be asked. */}
      {check.signable ? (
        <Txt variant="ui" tone="muted">
          {pay.irreversible}
        </Txt>
      ) : null}
      {/* A look-alike is always new too: its edges match a recent address, so the advice to match edges would mislead. */}
      {lookalikeOf || fresh ? (
        <View className="flex-row items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5">
          <Icon name={lookalikeOf ? 'warning-outline' : 'alert-circle-outline'} size={18} color="warningInk" />
          <Txt variant="ui" className="flex-1">
            {lookalikeOf ? pay.lookalike : pay.newAddressCheck}
          </Txt>
        </View>
      ) : null}
      <SendReview
        check={check}
        symbol={symbol}
        name={name}
        phase={phase}
        failure={failure}
        blocked={blocked}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onCancelWait={onCancelWait}
        lookalikeOf={lookalikeOf}
      />
    </View>
  )
}

/** «Готово» of a transfer: sent, not sent or not confirmed yet, the sum, to whom, the receipt kept. */
export function SendDoneStep({ done, onReceipt }: { done: SendDone; onReceipt: () => void }) {
  const words = useCopy(MONEY_COPY)
  const locale = useLocale()
  const tone = done.outcome === 'sent' ? 'done' : done.outcome === 'not-sent' ? 'failed' : 'pending'
  return (
    <DoneBody
      tone={tone}
      title={done.outcome === 'sent' ? words.sent : done.outcome === 'not-sent' ? words.notSent : words.notConfirmed}
      big={`${decimalText(done.amount, locale)} ${done.symbol}`}
      line={`${words.to} ${done.toName ? `${done.toName} · ${shortAddress(done.to)}` : shortAddress(done.to)}`}
      note={
        done.outcome === 'sent'
          ? null
          : done.result?.state === 'EXPIRED'
            ? words.neverReached
            : done.outcome === 'not-sent'
              ? words.rejected
              : words.notConfirmedYet
      }
      onReceipt={tone === 'failed' ? null : onReceipt}
    />
  )
}

const SEND_STEPS: readonly SendStep[] = ['to', 'amount', 'check', 'done']

/** The strip of four steps under the head: those walked and the current one drawn, the rest quiet. */
function StepStrip({ index, labels }: { index: number; labels: readonly string[] }) {
  return (
    <View className="flex-row gap-1" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {labels.map((label, at) => (
        <View key={label} className={`h-[3px] flex-1 rounded-pill ${at <= index ? 'bg-fg' : 'bg-line'}`} />
      ))}
    </View>
  )
}

/** «Нещодавні»: the addresses this phone sent to, as circles with their `.skr` names — a tap fills «Кому». */
function RecentRow({
  recents,
  title,
  onPick,
}: {
  recents: readonly RecentRecipient[]
  title: string
  onPick: (address: string) => void
}) {
  return (
    <View className="gap-2">
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      <View className="flex-row flex-wrap gap-3">
        {recents.map((entry) => (
          <RecentCircle key={entry.address} address={entry.address} onPress={() => onPick(entry.address)} />
        ))}
      </View>
    </View>
  )
}

function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: 'clipboard-outline' | 'qr-code-outline' | 'close-circle'
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      className="h-11 w-11 items-center justify-center rounded-btn border border-line bg-elevated active:bg-hover"
    >
      <Icon name={icon} size={20} color={icon === 'close-circle' ? 'muted' : 'fg'} />
    </Pressable>
  )
}

function AssetButton({
  asset,
  words,
  onPress,
  disabled,
}: {
  asset: SendAsset | null
  words: MoneyCopy
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={asset ? `${words.asset}: ${asset.symbol}. ${words.chooseAsset}` : words.chooseAsset}
      onPress={onPress}
      disabled={disabled}
      className="h-11 flex-row items-center gap-2 rounded-pill border border-line bg-elevated pl-1.5 pr-3 active:bg-hover"
    >
      {asset ? <AssetIcon symbol={asset.symbol} icon={asset.icon} size={28} /> : null}
      <Txt variant="ui" tone={asset ? 'fg' : 'muted'}>
        {asset ? asset.symbol : words.asset}
      </Txt>
      <Icon name="chevron-down" size={16} color="muted" />
    </Pressable>
  )
}

/**
 * Under «Кому»: the check running, the problem in a sentence, or the address the money goes to and what the security
 * source says. A `.skr` name says where it points now («→ 7xKX…gAsU»); a name the chain did not answer for is said as
 * unchecked with its retry, never as «no such name»; a plain address shows its own primary name beside it.
 */
function RecipientLine({ send, words }: { send: ReturnType<typeof useSend>; words: MoneyCopy }) {
  const seeker = useCopy(SEEKER_COPY)
  const typed = send.recipientText.trim()
  if (typed === '') return null
  if (send.checkingRecipient)
    return (
      <Txt variant="ui" tone="faint">
        {send.namesState !== 'no' && skrNameOf(typed) ? seeker.findingName : words.checkingRecipient}
      </Txt>
    )
  if (send.nameUnread)
    return (
      <View className="flex-row items-center gap-2">
        <Txt variant="ui" tone="danger" className="flex-1">
          {seeker.nameUnchecked}
        </Txt>
        <Button title={words.tryAgain} variant="secondary" size="sm" onPress={send.retryName} />
      </View>
    )
  if (send.recipientFailed)
    return (
      <View className="flex-row items-center gap-2">
        <Txt variant="ui" tone="danger" className="flex-1">
          {words.recipientProblems.RECIPIENT_UNREADABLE}
        </Txt>
        <Button title={words.tryAgain} variant="secondary" size="sm" onPress={send.retryRecipient} />
      </View>
    )
  const view = send.view
  if (!view) return null
  if (view.kind === 'problem')
    return (
      <Txt variant="ui" tone="danger">
        {view.line}
      </Txt>
    )
  if (view.kind === 'pay-link') return null
  // The security source speaks only when it has something to say: risk found, or a sanctions list.
  const summary = send.evidence ? evidenceSummary(send.evidence) : null
  const risky = summary === 'sanctioned' || summary === 'evidence-found'
  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-1.5">
        <Icon
          name={risky ? 'alert-circle' : 'checkmark-circle'}
          size={16}
          color={summary === 'sanctioned' ? 'dangerInk' : risky ? 'warningInk' : 'successInk'}
        />
        <Txt variant="data" tone="muted" className="flex-1" numberOfLines={1}>
          {send.recipientName
            ? `→ ${shortAddress(view.address)}`
            : send.addressName
              ? `${send.addressName} · ${shortAddress(view.address)}`
              : shortAddress(view.address)}
        </Txt>
      </View>
      {risky ? (
        <Txt variant="ui" tone={summary === 'sanctioned' ? 'danger' : 'warning'}>
          {words.evidenceTitle}: {words.evidence[summary]}
        </Txt>
      ) : null}
    </View>
  )
}

function AssetSheet({
  visible,
  assets,
  loading,
  chosen,
  locale,
  words,
  onClose,
  onPick,
}: {
  visible: boolean
  assets: readonly SendAsset[]
  loading: boolean
  chosen: string | null
  locale: Locale
  words: MoneyCopy
  onClose: () => void
  onPick: (key: string) => void
}) {
  return (
    <Sheet visible={visible} title={words.yourAssets} onClose={onClose} scroll>
      <View className="pb-2">
        {assets.length === 0 ? (
          loading ? (
            <View accessibilityRole="progressbar" className="gap-3 py-3">
              {[0, 1, 2].map((row) => (
                <View key={row} className="flex-row items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-pill" />
                  <Skeleton className="h-3.5 flex-1" />
                </View>
              ))}
            </View>
          ) : (
            <Txt variant="ui" tone="faint" className="py-6 text-center">
              {words.noAssets}
            </Txt>
          )
        ) : (
          assets.map((asset, index) => (
            <Pressable
              key={asset.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: asset.key === chosen }}
              onPress={() => onPick(asset.key)}
              className={`flex-row items-center gap-3 py-3 active:bg-hover ${index < assets.length - 1 ? 'border-b border-line' : ''}`}
            >
              <AssetIcon symbol={asset.symbol} icon={asset.icon} size={36} />
              <View className="flex-1 gap-0.5">
                <Txt variant="ui">{asset.symbol}</Txt>
                {asset.name ? (
                  <Txt variant="labelSm" tone="faint" numberOfLines={1}>
                    {asset.name}
                  </Txt>
                ) : null}
              </View>
              <Txt variant="data" tone="muted">
                {unitsText(asset.spendableRaw, asset.decimals, 6, locale)}
              </Txt>
              {asset.key === chosen ? <Icon name="checkmark" size={18} color="brand" /> : null}
            </Pressable>
          ))
        )}
      </View>
    </Sheet>
  )
}
