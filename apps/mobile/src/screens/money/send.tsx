import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { BOTTOM_ACTION_INSET, BottomAction } from '@/components/bottom-action'
import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { MONEY_COPY, type MoneyCopy } from '@/features/money/copy'
import { decimalText, evidenceSummary, shortAddress, type SendAsset } from '@/features/money/money-model'
import { useSend } from '@/features/money/use-send'
import { formatUnits, unitsForField } from '@/features/trade/trade-model'
import { pasteText } from '@/lib/clipboard'
import { useCopy, useLocale, useSharedCopy, type Locale } from '@/lib/i18n'
import { type, useTheme } from '@/theme'
import { formatUsdCompact } from '@/utils/format'

import { TopUpSheet } from '@/screens/home/top-up-sheet'

import { PayLinkPanel } from './pay-link-panel'
import { SendDoneCard, SendPendingCard, SendReview } from './send-parts'
import { Scanner } from './scanner'

/**
 * «Надіслати» — as on the web, by the phone's hand: who to (typed, pasted or
 * scanned — an address, a Solana Pay code or a Ryntra link, and the server
 * says which), how much of what, «Перевірка» counted by the server, the
 * wallet's signature, and what happened. A scanned Ryntra link is paid as the
 * link it is. A transfer this phone signed and never saw the end of is said
 * first, and holds back a second signature until the network answers.
 */
export function SendScreen() {
  const router = useRouter()
  const shared = useSharedCopy()
  const words = useCopy(MONEY_COPY)
  const locale = useLocale()
  const { colors } = useTheme()
  const send = useSend()
  const [scanning, setScanning] = useState(false)
  const [picking, setPicking] = useState(false)
  const [toppingUp, setToppingUp] = useState(false)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))
  const account = send.account

  if (!account.address) {
    return (
      <Screen title={words.sendTitle} onBack={back} backLabel={shared.back}>
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
  const busy =
    send.phase === 'reviewing' || send.phase === 'preparing' || send.phase === 'signing' || send.phase === 'sending'
  const usd =
    asset && asset.usdPrice !== null && send.amountRaw
      ? (Number(send.amountRaw) / 10 ** asset.decimals) * asset.usdPrice
      : null

  const paste = async () => {
    const text = await pasteText()
    if (text) send.setRecipientText(text)
  }

  let action: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; hint?: string } = {
    title: words.reviewTransfer,
    onPress: () => void send.requestReview(),
  }
  if (send.blocked) action = { title: words.waitingEarlier, onPress: () => undefined, disabled: true }
  else if (send.phase === 'reviewing') action = { title: words.preparing, onPress: () => undefined, loading: true }
  else if (send.askedTooFine)
    action = { ...action, title: words.cannotBeSent, disabled: true, hint: words.askedTooFine }
  else if (send.askedMissing)
    action = { ...action, title: words.cannotBeSent, disabled: true, hint: words.askedNotHeld }
  else if (send.holdings.isError && !send.holdings.data)
    action = { title: words.tryAgain, onPress: () => void send.holdings.refetch(), hint: words.holdingsFailed }
  else if (!asset)
    action = send.holdings.isLoading
      ? { title: words.chooseAsset, onPress: () => undefined, disabled: true }
      : { title: words.pages.topUp, onPress: () => setToppingUp(true), hint: words.noAssets }
  else if (send.recipientText.trim() === '') action = { ...action, title: words.enterRecipient, disabled: true }
  else if (send.checkingRecipient) action = { ...action, title: words.checkingRecipient, disabled: true }
  else if (send.view?.kind !== 'transfer') action = { ...action, title: words.checkRecipient, disabled: true }
  else if (!send.amountRaw) action = { ...action, title: words.enterAmount, disabled: true }
  else if (send.over) action = { ...action, title: words.notEnough(asset.symbol), disabled: true }

  return (
    <View className="flex-1 bg-ground">
      <View className="flex-1">
        <Screen
          title={words.sendTitle}
          onBack={back}
          backLabel={shared.back}
          bottomInset={send.done || payingLink ? 0 : BOTTOM_ACTION_INSET}
        >
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

          {send.done ? (
            <SendDoneCard done={send.done} onAgain={send.reset} />
          ) : (
            <>
              <Card className="gap-2">
                <Txt variant="labelSm" tone="faint" caps>
                  {words.to}
                </Txt>
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={send.recipientText}
                    onChangeText={send.setRecipientText}
                    placeholder={words.recipientPlaceholder}
                    placeholderTextColor={colors.fgMuted}
                    selectionColor={colors.brand}
                    cursorColor={colors.brand}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!busy}
                    accessibilityLabel={words.to}
                    numberOfLines={1}
                    className="h-11 flex-1 text-fg"
                    style={[type.data, { paddingVertical: 0, fontSize: 15 }]}
                  />
                  {send.recipientText.length > 0 ? (
                    <IconButton icon="close-circle" label={shared.close} onPress={() => send.setRecipientText('')} />
                  ) : (
                    <IconButton icon="clipboard-outline" label={words.paste} onPress={() => void paste()} />
                  )}
                  <IconButton icon="qr-code-outline" label={words.scan} onPress={() => setScanning(true)} />
                </View>
                <RecipientLine send={send} words={words} />
              </Card>

              {payingLink ? (
                <PayLinkPanel link={payingLink} />
              ) : (
                <>
                  <Card className="gap-2">
                    <View className="flex-row items-center justify-between gap-3">
                      <Txt variant="labelSm" tone="faint" caps>
                        {words.amount}
                      </Txt>
                      {asset ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${words.max}: ${formatUnits(asset.spendableRaw, asset.decimals, 6, locale)} ${asset.symbol}`}
                          onPress={() => send.setAmountText(unitsForField(asset.spendableRaw, asset.decimals, locale))}
                          disabled={busy}
                          hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
                          className="min-h-9 flex-row items-center gap-2"
                        >
                          <Txt variant="labelSm" tone={send.over ? 'danger' : 'muted'}>
                            {words.available(
                              `${formatUnits(asset.spendableRaw, asset.decimals, 6, locale)} ${asset.symbol}`,
                            )}
                          </Txt>
                          <View className="rounded-pill border border-brand-chip-line bg-brand-chip px-2.5 py-1">
                            <Txt variant="labelSm" tone="brand">
                              {words.max}
                            </Txt>
                          </View>
                        </Pressable>
                      ) : null}
                    </View>
                    <View className="flex-row items-center gap-3">
                      <TextInput
                        value={send.amountText}
                        onChangeText={send.setAmountText}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.fgMuted}
                        selectionColor={colors.brand}
                        cursorColor={colors.brand}
                        editable={!busy && asset !== null}
                        accessibilityLabel={words.amount}
                        className="flex-1 text-fg"
                        style={[type.dataLg, { paddingVertical: 0 }]}
                      />
                      <AssetButton
                        asset={asset}
                        words={words}
                        onPress={() => setPicking(true)}
                        disabled={busy || send.asked !== null}
                      />
                    </View>
                    {usd !== null && Number.isFinite(usd) ? (
                      <Txt variant="ui" tone="faint">
                        ≈ {formatUsdCompact(usd, locale)}
                      </Txt>
                    ) : null}
                  </Card>

                  {send.asked && asset ? (
                    <Txt variant="ui" tone="muted">
                      {[
                        send.asked.amount
                          ? `${words.asked}: ${decimalText(send.asked.amount, locale)} ${asset.symbol}`
                          : null,
                        send.asked.label,
                        send.asked.message,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Txt>
                  ) : null}

                  {send.opensAccount && send.view?.kind === 'transfer' ? (
                    <Txt variant="ui" tone="muted">
                      {words.opensAccount}
                    </Txt>
                  ) : null}

                  {send.failure && send.phase === 'idle' ? (
                    <Txt variant="ui" tone="danger">
                      {words.failures[send.failure.key]}
                    </Txt>
                  ) : null}
                </>
              )}
            </>
          )}
        </Screen>
      </View>

      {send.done || payingLink ? null : (
        <BottomAction
          title={action.title}
          onPress={action.onPress}
          disabled={action.disabled}
          loading={action.loading}
          hint={action.hint}
        />
      )}

      <TopUpSheet visible={toppingUp} address={account.address} purpose="top-up" onClose={() => setToppingUp(false)} />

      <Scanner visible={scanning} onClose={() => setScanning(false)} onScan={send.setRecipientText} />

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

      <Sheet
        visible={
          send.review !== null &&
          (send.phase === 'review' ||
            send.phase === 'preparing' ||
            send.phase === 'signing' ||
            send.phase === 'sending')
        }
        title={send.review && !send.review.check.signable ? words.cannotBeSent : words.reviewTitle}
        onClose={send.closeReview}
        scroll
      >
        {send.review && asset ? (
          <SendReview
            check={send.review.check}
            symbol={asset.symbol}
            phase={send.phase}
            failure={send.failure}
            blocked={send.blocked}
            onConfirm={() => void send.confirm()}
            onCancel={send.closeReview}
          />
        ) : null}
      </Sheet>
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

/** Under «Кому»: the check running, the problem in a sentence, or the address the money goes to and what the security source says. */
function RecipientLine({ send, words }: { send: ReturnType<typeof useSend>; words: MoneyCopy }) {
  if (send.recipientText.trim() === '') return null
  if (send.checkingRecipient)
    return (
      <Txt variant="ui" tone="faint">
        {words.checkingRecipient}
      </Txt>
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
        <Txt variant="data" tone="muted">
          {shortAddress(view.address)}
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
                {formatUnits(asset.spendableRaw, asset.decimals, 6, locale)}
              </Txt>
              {asset.key === chosen ? <Icon name="checkmark" size={18} color="brand" /> : null}
            </Pressable>
          ))
        )}
      </View>
    </Sheet>
  )
}
