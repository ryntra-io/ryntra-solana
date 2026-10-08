import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import type { IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { MONEY_COPY } from '@/features/money/copy'
import { webHrefOf } from '@/features/monitoring/deep-link'
import { useAccount } from '@/features/session/use-account'
import { DOOR_DESTINATIONS, MONEY_PAGES, PLACES_COPY, type MoneyPage } from '@/features/shell/places'
import { useCopy, useSharedCopy } from '@/lib/i18n'
import { TopUpSheet } from '@/screens/home/top-up-sheet'
import { openLink } from '@/lib/open-link'

const ICONS: Readonly<Record<MoneyPage, IconName>> = {
  topUp: 'add-circle-outline',
  send: 'arrow-up-outline',
  receive: 'arrow-down-outline',
  link: 'link-outline',
  bridge: 'git-compare-outline',
}

/**
 * «Гроші» — a row of «Ще», the web's one page with the tabs
 * Поповнити · Надіслати · Отримати · Між мережами: the top-up the phone's own
 * sheet, Send and Receive the phone's screens, the payment link beside
 * Receive, between networks the web's page, marked ↗. `?open=top-up` — the
 * web's `/app/top-up` — opens the top-up at once.
 */
export function MoneyHubScreen() {
  const router = useRouter()
  const money = useCopy(MONEY_COPY)
  const places = useCopy(PLACES_COPY)
  const shared = useSharedCopy()
  const account = useAccount()
  const { open: opened } = useLocalSearchParams<{ open?: string }>()
  const [toppingUp, setToppingUp] = useState(opened === 'top-up')
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
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/more'))
  const go = (page: MoneyPage) => {
    const destination = DOOR_DESTINATIONS[page]
    if (destination.kind === 'sheet') setToppingUp(true)
    else if (destination.kind === 'screen') router.push(destination.path as never)
    else {
      const web = webHrefOf(destination.path)
      if (web) openLink(web)
    }
  }
  return (
    <Screen title={money.money} onBack={back} backLabel={shared.back}>
      <Card padded={false}>
        {MONEY_PAGES.map((page, index) => {
          const web = DOOR_DESTINATIONS[page].kind === 'web'
          return (
            <DoorRow
              key={page}
              icon={ICONS[page]}
              label={page === 'bridge' ? places.bridge : money.pages[page]}
              external={web ? places.onWeb : null}
              onPress={() => go(page)}
              last={index === MONEY_PAGES.length - 1}
            />
          )
        })}
      </Card>
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
