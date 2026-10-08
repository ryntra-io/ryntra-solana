import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, Share, ToastAndroid, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { ChoiceChips, type Choice } from '@/components/choice-chips'
import { Field } from '@/components/field'
import { Icon } from '@/components/icon'
import { QrCode } from '@/components/qr-code'
import { Screen } from '@/components/screen'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { MONEY_COPY } from '@/features/money/copy'
import { addressPayUrl, linkAmount, linkAmountInput, linkTone, sendAssets } from '@/features/money/money-model'
import { useCreatePayLink, useMyPayLinks } from '@/features/money/use-pay-links'
import { useAccount } from '@/features/session/use-account'
import {
  ApiError,
  needsSignIn,
  PAY_LINK_EXPIRATIONS,
  USDC_MINT,
  type PayLink,
  type PayLinkExpiration,
} from '@/lib/api'
import { canCopy, copyText } from '@/lib/clipboard'
import { feel } from '@/lib/haptics'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { useHoldings } from '@/features/portfolio/use-portfolio'

import { LinkCard } from './link-card'

type Mode = 'address' | 'request'

/** What a link asks for: `USDC` and SOL always, then what the wallet holds — a request for a token never held is still valid. */
type LinkToken = Readonly<{ key: string; mint: string | null; symbol: string }>

const DESCRIPTION_MAX = 120

/**
 * «Отримати» — two jobs, as on the web: «Моя адреса» (the address, its code,
 * copy, share — one glance and one tap) and «Запит на оплату» (a payment link
 * for an exact amount: the token, the sum, what it is for, how long it holds,
 * one action). «Посилання на оплату» in «Ще» opens the second at once.
 */
export function ReceiveScreen() {
  const router = useRouter()
  const shared = useSharedCopy()
  const words = useCopy(MONEY_COPY)
  const account = useAccount()
  const params = useLocalSearchParams<{ tab?: string }>()
  const [mode, setMode] = useState<Mode>(params.tab === 'link' ? 'request' : 'address')
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))
  const modes: readonly Choice<Mode>[] = [
    { value: 'address', label: words.myAddress },
    { value: 'request', label: words.requestPayment },
  ]
  return (
    <Screen title={words.receiveTitle} onBack={back} backLabel={shared.back}>
      {account.address ? (
        <>
          <ChoiceChips choices={modes} value={mode} onChange={setMode} role="tablist" fill quiet />
          {mode === 'address' ? <AddressPanel address={account.address} /> : <RequestPanel />}
        </>
      ) : (
        <StateView
          icon="qr-code-outline"
          title={words.connectToReceive}
          action={{
            title: words.connectWallet,
            onPress: () => void account.connect(),
            loading: account.busy === 'connect',
          }}
        />
      )}
    </Screen>
  )
}

function AddressPanel({ address }: { address: string }) {
  const words = useCopy(MONEY_COPY)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () => {
    if (!copyText(address)) return
    setCopied(true)
    feel('review')
    ToastAndroid.show(words.copied, ToastAndroid.SHORT)
  }
  return (
    <View className="gap-3">
      <Card className="items-center gap-4">
        <QrCode value={addressPayUrl(address)} label={words.scanToPay} />
        <View className="w-full gap-1">
          <Txt variant="labelSm" tone="faint" caps className="text-center">
            {words.yourSolanaAddress}
          </Txt>
          {/* One line, shrunk to fit: an address broken with two characters on a line of their own is misread. */}
          <Txt
            variant="data"
            selectable
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            className="text-center"
            accessibilityLabel={`${words.yourSolanaAddress}: ${address}`}
          >
            {address}
          </Txt>
        </View>
      </Card>
      <View className="flex-row items-start gap-2">
        <Icon name="warning-outline" size={16} color="warningInk" style={{ marginTop: 1 }} />
        <Txt variant="ui" tone="warning" className="flex-1">
          {words.networkWarning}
        </Txt>
      </View>
      <View className="gap-2">
        {canCopy ? <Button title={copied ? words.copied : words.copyAddress} size="lg" onPress={copy} /> : null}
        <Button
          title={words.share}
          variant={canCopy ? 'secondary' : 'primary'}
          size="lg"
          onPress={() => void Share.share({ message: address }).catch(() => undefined)}
        />
      </View>
    </View>
  )
}

function RequestPanel() {
  const words = useCopy(MONEY_COPY)
  const locale = useLocale()
  const account = useAccount()
  const session = account.session
  const [opened, setOpened] = useState<PayLink | null>(null)
  const [tokenKey, setTokenKey] = useState<string>(USDC_MINT)
  const [amountText, setAmountText] = useState('')
  const [description, setDescription] = useState('')
  const [expiration, setExpiration] = useState<PayLinkExpiration>('7d')
  const create = useCreatePayLink(session)
  const links = useMyPayLinks(session)

  const holdings = useHoldings(account.address)
  const tokens = useMemo<readonly LinkToken[]>(() => {
    const held = sendAssets(holdings.data?.data.holdings ?? [])
      .filter((asset) => asset.mint !== null && asset.mint !== USDC_MINT)
      .slice(0, 4)
      .map((asset) => ({ key: asset.key, mint: asset.mint, symbol: asset.symbol }))
    return [{ key: USDC_MINT, mint: USDC_MINT, symbol: 'USDC' }, { key: 'SOL', mint: null, symbol: 'SOL' }, ...held]
  }, [holdings.data])
  const token = tokens.find((entry) => entry.key === tokenKey) ?? tokens[0]!

  const amount = linkAmountInput(amountText)
  const amountWrong = amount === 'invalid'

  if (opened)
    return (
      <LinkCard
        link={opened}
        onNew={() => {
          setOpened(null)
          setAmountText('')
          setDescription('')
          create.reset()
        }}
      />
    )

  const submit = () => {
    if (amountWrong || create.isPending) return
    create.mutate(
      {
        mint: token.mint,
        amount: amount === null ? null : amount,
        description: description.trim() === '' ? null : description.trim(),
        expiration,
      },
      { onSuccess: (link) => setOpened(link) },
    )
  }

  const recent = (links.data?.links ?? []).slice(0, 5)
  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <Txt variant="labelSm" tone="faint" caps>
          {words.token}
        </Txt>
        <ChoiceChips
          choices={tokens.map((entry) => ({ value: entry.key, label: entry.symbol }))}
          value={token.key}
          onChange={setTokenKey}
          scroll
          quiet
        />
      </View>
      <Field
        label={`${words.amount} · ${words.optional}`}
        value={amountText}
        onChangeText={(text) => setAmountText(text.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        placeholder={locale === 'uk' ? '0,00' : '0.00'}
        suffix={token.symbol}
        error={amountWrong ? words.amountFormat : null}
      />
      <Field
        label={`${words.whatFor} · ${words.optional}`}
        value={description}
        onChangeText={(text) => setDescription(text.slice(0, DESCRIPTION_MAX))}
        maxLength={DESCRIPTION_MAX}
        mono={false}
        autoCapitalize="sentences"
      />
      <View className="gap-1.5">
        <Txt variant="labelSm" tone="faint" caps>
          {words.expiresIn}
        </Txt>
        <ChoiceChips
          choices={PAY_LINK_EXPIRATIONS.map((value) => ({ value, label: words.expirations[value] }))}
          value={expiration}
          onChange={setExpiration}
          fill
          size="sm"
          quiet
        />
      </View>
      <Txt variant="ui" tone="faint">
        {amount === null ? `${words.payerChooses} ${words.sendThisLink}` : words.sendThisLink}
      </Txt>
      {session && !(create.isError && needsSignIn(create.error)) ? (
        <View className="gap-2">
          {create.isError ? (
            <Txt variant="ui" tone="danger">
              {create.error instanceof ApiError && create.error.code === 'AMOUNT_INVALID'
                ? words.failures.amount
                : words.createFailed}
            </Txt>
          ) : null}
          <Button
            title={create.isPending ? words.creating : words.createLink}
            size="lg"
            loading={create.isPending}
            disabled={amountWrong}
            onPress={submit}
          />
        </View>
      ) : (
        <View className="gap-2">
          <Txt variant="ui" tone="muted">
            {words.signInToCreate}
          </Txt>
          {account.signInFailure ? (
            <Txt variant="ui" tone="danger">
              {account.signInFailure.message}
            </Txt>
          ) : null}
          <Button
            title={account.signingIn ? words.checkWallet : words.signIn}
            size="lg"
            loading={account.signingIn}
            onPress={() => void account.signIn().then((ok) => ok && create.reset())}
          />
        </View>
      )}

      {recent.length > 0 ? (
        <View className="gap-2 pt-2">
          <Txt variant="labelSm" tone="faint" caps className="px-1">
            {words.yourLinks}
          </Txt>
          <Card padded={false}>
            {recent.map((link, index) => (
              <Pressable
                key={link.id}
                accessibilityRole="button"
                onPress={() => setOpened(link)}
                className={`flex-row items-center gap-3 px-4 py-3 active:bg-hover ${index < recent.length - 1 ? 'border-b border-line' : ''}`}
              >
                <View className="flex-1 gap-0.5">
                  <Txt variant="data">{linkAmount(link, locale) ?? link.token.symbol}</Txt>
                  {link.description ? (
                    <Txt variant="ui" tone="faint" numberOfLines={1}>
                      {link.description}
                    </Txt>
                  ) : null}
                </View>
                <Chip label={words.status[link.status]} tone={linkTone(link)} caps={false} />
                <Icon name="chevron-forward" size={16} color="muted" />
              </Pressable>
            ))}
          </Card>
        </View>
      ) : null}
    </View>
  )
}
