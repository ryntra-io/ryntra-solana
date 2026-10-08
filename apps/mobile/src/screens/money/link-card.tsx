import { Share, ToastAndroid, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Chip } from '@/components/chip'
import { FactRow } from '@/components/fact-row'
import { QrCode } from '@/components/qr-code'
import { Txt } from '@/components/txt'
import { MONEY_COPY } from '@/features/money/copy'
import { explorerUrl, linkAmount, linkCredited, linkTone } from '@/features/money/money-model'
import { usePayLink } from '@/features/money/use-pay-links'
import { useNow } from '@/hooks/use-now'
import type { PayLink } from '@/lib/api'
import { canCopy, copyText } from '@/lib/clipboard'
import { feel } from '@/lib/haptics'
import { useCopy, useLocale } from '@/lib/i18n'
import { formatAt } from '@/utils/format'
import { openLink } from '@/lib/open-link'

/**
 * A payment link once it exists: its state first — «Очікує оплати» until the
 * chain says «Оплачено» — then the code a camera opens (the page's own link,
 * as on the web: a wallet's scanner refuses a bare transfer request), the
 * link, the terms, and the system's own share sheet. What arrived, when, and
 * the transaction one tap away once it is paid.
 */
export function LinkCard({ link: initial, onNew }: { link: PayLink; onNew?: () => void }) {
  const words = useCopy(MONEY_COPY)
  const locale = useLocale()
  const now = useNow(30_000)
  const read = usePayLink(initial)
  const link = read.data ?? initial
  const amount = linkAmount(link, locale)
  const credited = linkCredited(link, locale)
  const paid = link.status === 'PAID'
  const copy = () => {
    if (!copyText(link.url)) return
    feel('review')
    ToastAndroid.show(words.copied, ToastAndroid.SHORT)
  }
  return (
    <View className="gap-3">
      <Card className="items-center gap-4">
        <View className="w-full flex-row items-center justify-between gap-3">
          <Txt variant="labelSm" tone="faint" caps>
            {words.paymentLink}
          </Txt>
          <Chip label={words.status[link.status]} tone={linkTone(link)} caps={false} />
        </View>
        <View className="items-center gap-1">
          <Txt variant="dataLg" accessibilityLabel={amount ?? words.payerChooses}>
            {amount ?? link.token.symbol}
          </Txt>
          {amount ? null : (
            <Txt variant="ui" tone="faint">
              {words.payerChooses}
            </Txt>
          )}
          {link.description ? (
            <Txt variant="ui" tone="muted" className="text-center">
              {link.description}
            </Txt>
          ) : null}
        </View>
        {paid ? null : <QrCode value={link.url} label={words.scanToOpen} />}
        <Txt
          variant="data"
          tone="muted"
          selectable
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          className="w-full text-center"
        >
          {link.url}
        </Txt>
      </Card>

      <Card padded={false} className="px-4">
        {paid && credited ? <FactRow label={words.received} value={credited} /> : null}
        {paid && link.paid?.paidAt ? (
          <FactRow label={words.paidOn} value={formatAt(link.paid.paidAt, now, locale)} mono={false} last />
        ) : null}
        {paid ? null : (
          <FactRow label={words.validUntil} value={formatAt(link.expiresAt, now, locale)} mono={false} last />
        )}
      </Card>

      {link.note ? (
        <Txt variant="ui" tone="warning">
          {words.notes[link.note]}
        </Txt>
      ) : !paid ? (
        <Txt variant="ui" tone="faint">
          {words.sendThisLink}
        </Txt>
      ) : null}

      <View className="gap-2">
        {paid && link.paid ? (
          <Button
            title={words.explorer}
            variant="secondary"
            size="lg"
            onPress={() => openLink(explorerUrl(link.paid!.signature))}
          />
        ) : (
          <>
            {canCopy ? <Button title={words.copyLink} size="lg" onPress={copy} /> : null}
            <Button
              title={words.share}
              variant={canCopy ? 'secondary' : 'primary'}
              size="lg"
              onPress={() => void Share.share({ message: link.url }).catch(() => undefined)}
            />
          </>
        )}
        {onNew ? <Button title={words.newRequest} variant="ghost" onPress={onNew} /> : null}
      </View>
    </View>
  )
}
