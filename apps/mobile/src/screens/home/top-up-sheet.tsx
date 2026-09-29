import { useState } from 'react'
import { Share, ToastAndroid, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { INVEST_COPY } from '@/features/invest/copy'
import { canCopy, copyText } from '@/lib/clipboard'
import { useCopy } from '@/lib/i18n'

export type TopUpSheetProps = {
  visible: boolean
  /** The wallet's own address; null for a guest, who is offered the one step that gives it. */
  address: string | null
  onClose: () => void
  /** «Поповнити» from Home, or «Отримати» from «Ще» — the same address, said for what it is used for. */
  purpose?: 'top-up' | 'receive'
  /** A guest's one action: connect the wallet, and the address appears in the same sheet. */
  onConnect?: () => void
  connecting?: boolean
}

/**
 * «Поповнити» — the one way in that works on the phone today: USDC sent to
 * the person's own address on the Solana network, from an exchange or another
 * wallet (canon v5.1 §3, §4; «only what works»). «Отримати» in «Ще» is the
 * same address for anything sent on Solana (canon v5.3 §3). The address is the
 * wallet's own and whole; it is copied or handed to the system's share sheet,
 * never sent anywhere by the app. The network is named before anything else
 * can be done with it, because a transfer from another network is lost. A
 * guest reads one line and one action — connecting the wallet.
 */
export function TopUpSheet({
  visible,
  address,
  onClose,
  purpose = 'top-up',
  onConnect,
  connecting = false,
}: TopUpSheetProps) {
  const copy = useCopy(INVEST_COPY)
  const [copied, setCopied] = useState(false)
  const receive = purpose === 'receive'
  const close = () => {
    setCopied(false)
    onClose()
  }
  const copyAddress = () => {
    if (!address || !copyText(address)) return
    setCopied(true)
    ToastAndroid.show(copy.copied, ToastAndroid.SHORT)
  }
  return (
    <Sheet
      visible={visible}
      title={receive ? copy.receiveTitle : copy.topUpTitle}
      subtitle={copy.topUpNetwork}
      onClose={close}
      scroll
    >
      {address ? (
        <View className="gap-4 pb-2">
          <Txt variant="body">{receive ? copy.receiveLine : copy.topUpLine}</Txt>
          <Card className="gap-1.5">
            <Txt variant="labelSm" tone="faint">
              {copy.yourAddress}
            </Txt>
            {/* One line, shrunk to fit a narrow phone: an address broken with two characters on a line of their own is misread. */}
            <Txt
              variant="data"
              selectable
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              accessibilityLabel={`${copy.yourAddress}: ${address}`}
            >
              {address}
            </Txt>
          </Card>
          <View className="flex-row items-start gap-2">
            <Icon name="warning-outline" size={16} color="warningInk" style={{ marginTop: 1 }} />
            <Txt variant="ui" tone="warning" className="flex-1">
              {copy.topUpWarning}
            </Txt>
          </View>
          {receive ? null : (
            <Txt variant="ui" tone="faint">
              {copy.gasLine}
            </Txt>
          )}
          <View className="gap-2">
            {canCopy ? (
              <Button title={copied ? copy.copied : copy.copyAddress} size="lg" onPress={copyAddress} />
            ) : null}
            <Button
              title={copy.share}
              variant={canCopy ? 'secondary' : 'primary'}
              size="lg"
              onPress={() => void Share.share({ message: address }).catch(() => undefined)}
            />
          </View>
        </View>
      ) : (
        <View className="gap-4 pb-2">
          <Txt variant="body">{copy.receiveGuest}</Txt>
          {onConnect ? <Button title={copy.connectWallet} size="lg" loading={connecting} onPress={onConnect} /> : null}
        </View>
      )}
    </Sheet>
  )
}
