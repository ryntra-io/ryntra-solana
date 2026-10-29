import { View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { HelpDot } from '@/components/help-dot'
import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { PLACE_HOME_COPY } from '@/features/home/place-copy'
import { SEEKER_COPY } from '@/features/seeker/copy'
import { useSeekerMark, useSkrName } from '@/features/seeker/use-seeker'
import { keepUntil } from '@/features/session/keep-connected'
import { useKeep } from '@/features/session/keep-store'
import { useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale, useSharedCopy, type Copy } from '@/lib/i18n'
import { formatMoment, shortAddress } from '@/utils/format'

import { failureLine, signInFailureLine } from './signing-copy'

type PanelCopy = Readonly<{
  wallet: string
  connected: string
  notConnected: string
  /** The address as a screen reader says it, whole. */
  address: (address: string) => string
  connect: string
  signIn: string
  signOut: string
  switchWallet: string
  disconnect: string
}>

const COPY: Copy<PanelCopy> = {
  en: {
    wallet: 'Wallet',
    connected: 'Connected',
    notConnected: 'Not connected',
    address: (address) => `Address ${address}`,
    connect: 'Connect wallet',
    signIn: 'Sign in with your wallet',
    signOut: 'Sign out',
    switchWallet: 'Switch wallet',
    disconnect: 'Disconnect',
  },
  uk: {
    wallet: 'Гаманець',
    connected: 'Під’єднано',
    notConnected: 'Не під’єднано',
    address: (address) => `Адреса ${address}`,
    connect: 'Під’єднати гаманець',
    signIn: 'Увійти гаманцем',
    signOut: 'Вийти',
    switchWallet: 'Змінити гаманець',
    disconnect: 'Відключити',
  },
}

/**
 * The wallet row of «Налаштування»: which wallet is connected, whether it is signed
 * in, and the actions between those states. Connect shares an address;
 * sign-in proves it to the server with a signature (Sign In With Solana,
 * contract 1.3.0); sign-out, switch and disconnect end the session first.
 * What connecting means sits behind «?» beside the label, never a line (ST-4).
 * A signed-in wallet says so once, in its line, with no badge beside the label,
 * and shows one end, the one the profile sheet shows (ST-5): the
 * time the person chose in «Тримати під’єднаним», or — for «поки не вийду» —
 * no clock, since the phone renews the sign-in itself; how it renews is behind «?».
 * The wallet's `.skr` name stands where its short address was, and a signed-in
 * wallet that holds a Seeker Genesis Token reads «Перевірено Seeker» under its
 * line — the server's answer for the wallet the session proved (M41.2).
 */
export function WalletPanel() {
  const account = useAccount()
  const copy = useCopy(COPY)
  const words = useCopy(PLACE_HOME_COPY)
  const keep = useKeep()
  const until = keepUntil(keep)
  const shared = useSharedCopy()
  const locale = useLocale()
  const now = useNow(30_000)
  const seeker = useCopy(SEEKER_COPY)
  const { address, session } = account
  const name = useSkrName(address, session)
  const mark = useSeekerMark(session)
  const state = session ? 'signed-in' : address ? 'connected' : 'none'
  const failure =
    (account.signInFailure ? signInFailureLine(account.signInFailure, locale) : null) ??
    (account.failure ? failureLine(account.failure.message, locale) : null) ??
    null
  const working = account.busy !== null || account.signingIn

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1">
          <Txt variant="labelSm" tone="faint" caps>
            {copy.wallet}
          </Txt>
          {address ? (
            state === 'connected' ? (
              <HelpDot title={shared.signInWhy} body={shared.signInHelp} />
            ) : null
          ) : (
            <HelpDot title={shared.connectTitle} body={shared.connectHelp} />
          )}
        </View>
        {/* Signed in reads once — the line under the address («Вхід виконано · оновлюється сам»), never a badge too. */}
        {state === 'signed-in' ? null : (
          <Chip
            label={state === 'connected' ? copy.connected : copy.notConnected}
            tone={state === 'connected' ? 'evidence' : 'neutral'}
          />
        )}
      </View>

      {address ? (
        <View className="gap-0.5">
          {account.label ? <Txt variant="ui">{account.label}</Txt> : null}
          {/* The same short form as Home and «Профіль» — or the wallet's `.skr` name in its place. */}
          <Txt
            variant="data"
            tone={name ? 'fg' : 'muted'}
            accessibilityLabel={name ? `${seeker.name(name)}, ${copy.address(address)}` : copy.address(address)}
          >
            {name ?? shortAddress(address)}
          </Txt>
          {/* One end, never the server's day beside the chosen time: the chosen end, or «renews by itself». */}
          {session ? (
            <View className="flex-row flex-wrap items-center gap-x-1">
              <Txt variant="ui" tone="faint" tabular>
                {until !== null
                  ? words.signedInUntil(formatMoment(new Date(until).toISOString(), now, locale))
                  : words.signedInRenews}
              </Txt>
              <HelpDot
                title={words.keepConnected}
                body={until !== null ? [words.renewHelp, words.keepTimed] : words.renewHelp}
              />
            </View>
          ) : null}
          {/* A mark, not a permission: nothing opens or is paid by it; what it is sits behind «?». */}
          {session && mark === 'verified' ? (
            <View className="flex-row items-center gap-x-1">
              <Icon name="shield-checkmark" size={14} color="successInk" />
              <Txt variant="ui" tone="success">
                {seeker.verified}
              </Txt>
              <HelpDot title={seeker.verified} body={seeker.verifiedHelp} />
            </View>
          ) : null}
        </View>
      ) : null}

      {failure ? (
        <Txt variant="ui" tone="danger">
          {failure}
        </Txt>
      ) : null}

      {state === 'none' ? (
        <Button title={copy.connect} loading={account.busy === 'connect'} onPress={() => void account.connect()} />
      ) : null}

      {state === 'connected' ? (
        <Button title={copy.signIn} loading={account.signingIn} onPress={() => void account.signIn()} />
      ) : null}

      {state === 'signed-in' ? (
        <Button title={copy.signOut} variant="secondary" loading={working} onPress={() => void account.signOut()} />
      ) : null}

      {address ? (
        <View className="flex-row gap-2">
          <Button
            title={copy.switchWallet}
            variant="secondary"
            loading={account.busy === 'switch'}
            disabled={working && account.busy !== 'switch'}
            onPress={() => void account.switchWallet()}
            className="flex-1"
          />
          <Button
            title={copy.disconnect}
            variant="secondary"
            loading={account.busy === 'disconnect'}
            disabled={working && account.busy !== 'disconnect'}
            onPress={() => void account.disconnect()}
            className="flex-1"
          />
        </View>
      ) : null}
    </Card>
  )
}
