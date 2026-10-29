import { useRouter } from 'expo-router'
import { View } from 'react-native'

import { Card } from '@/components/card'
import { HelpDot } from '@/components/help-dot'
import { Icon, type IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Txt } from '@/components/txt'
import { SIGNING_COPY } from '@/features/wallet/signing-copy'
import { useCopy, useSharedCopy } from '@/lib/i18n'

const ICONS: readonly IconName[] = ['key-outline', 'hardware-chip-outline', 'swap-horizontal-outline', 'time-outline']

/**
 * «Підпис і Ledger» (NEW-LOOK §4, M45): four items — the wallet signs, a Ledger confirms on the device and Ryntra
 * waits up to 90 s, a swap reads as a hash on a Ledger so every sum is in «Перевірка», an outdated price means a new
 * «Перевірка». Each is one short line; its detail sits behind «?» (ST-5). Nothing to switch: the Ledger is reached
 * through the wallet.
 */
export function SigningScreen() {
  const router = useRouter()
  const copy = useCopy(SIGNING_COPY)
  const shared = useSharedCopy()
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'))
  return (
    <Screen title={copy.title} onBack={back} backLabel={shared.back}>
      <Card className="gap-4">
        {copy.lines.map((line, index) => (
          <View key={line.title} className="flex-row items-start gap-3">
            <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-pill bg-elevated">
              <Icon name={ICONS[index]!} size={16} color="fgMuted" />
            </View>
            <View className="flex-1 gap-1" accessible>
              <Txt variant="ui">{line.title}</Txt>
              <Txt variant="ui" tone="muted">
                {line.line}
              </Txt>
            </View>
            <HelpDot title={line.title} body={line.body} />
          </View>
        ))}
      </Card>
    </Screen>
  )
}
