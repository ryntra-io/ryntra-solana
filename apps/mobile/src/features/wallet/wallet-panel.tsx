import { View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { Txt } from '@/components/txt'
import { useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import { useCopy, useLocale, type Copy } from '@/lib/i18n'
import { formatMoment, shortAddress } from '@/utils/format'

type PanelCopy = Readonly<{
  wallet: string
  signedIn: string
  connected: string
  notConnected: string
  sessionUntil: (until: string) => string
  connectPrompt: string
  connect: string
  signIn: string
  signOut: string
  switchWallet: string
  disconnect: string
}>

const COPY: Copy<PanelCopy> = {
  en: {
    wallet: 'Wallet',
    signedIn: 'Signed in',
    connected: 'Connected',
    notConnected: 'Not connected',
    sessionUntil: (until) => `Session until ${until}`,
    connectPrompt: 'Your wallet is your account. Keys never leave it.',
    connect: 'Connect wallet',
    signIn: 'Sign in with your wallet',
    signOut: 'Sign out',
    switchWallet: 'Switch wallet',
    disconnect: 'Disconnect',
  },
  uk: {
    wallet: 'Гаманець',
    signedIn: 'Увійшли',
    connected: 'Підключено',
    notConnected: 'Не підключено',
    sessionUntil: (until) => `Сесія до ${until}`,
    connectPrompt: 'Гаманець — твій акаунт. Ключі не покидають його.',
    connect: 'Підключити гаманець',
    signIn: 'Увійти гаманцем',
    signOut: 'Вийти',
    switchWallet: 'Змінити гаманець',
    disconnect: 'Відключити',
  },
}

/**
 * The wallet row of More: which wallet is connected, whether it is signed
 * in, and the actions between those states. Connect shares an address;
 * sign-in proves it to the server with a signature (Sign In With Solana,
 * contract 1.3.0); sign-out, switch and disconnect end the session first.
 */
export function WalletPanel() {
  const account = useAccount()
  const copy = useCopy(COPY)
  const locale = useLocale()
  const now = useNow(30_000)
  const { address, session } = account
  const state = session ? 'signed-in' : address ? 'connected' : 'none'
  const failure = account.signInFailure?.message ?? account.failure?.message ?? null
  const working = account.busy !== null || account.signingIn

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between">
        <Txt variant="labelSm" tone="faint" caps>
          {copy.wallet}
        </Txt>
        <Chip
          label={state === 'signed-in' ? copy.signedIn : state === 'connected' ? copy.connected : copy.notConnected}
          tone={state === 'signed-in' ? 'success' : state === 'connected' ? 'evidence' : 'neutral'}
        />
      </View>

      {address ? (
        <View className="gap-0.5">
          {account.label ? <Txt variant="ui">{account.label}</Txt> : null}
          <Txt variant="data" tone="muted" accessibilityLabel={`Address ${address}`}>
            {shortAddress(address, 6)}
          </Txt>
          {/* The chip above says connected or signed in; the line says only when the session ends (M27). */}
          {session ? (
            <Txt variant="ui" tone="faint">
              {copy.sessionUntil(formatMoment(session.expiresAt, now, locale))}
            </Txt>
          ) : null}
        </View>
      ) : (
        <Txt variant="body" tone="muted">
          {copy.connectPrompt}
        </Txt>
      )}

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
