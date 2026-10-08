import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'

import { Card } from '@/components/card'
import { DoorRow } from '@/components/door-row'
import type { IconName } from '@/components/icon'
import { Screen } from '@/components/screen'
import { TAB_TITLES } from '@/features/shell/shell'
import { DOOR_DESTINATIONS, MORE_ROWS, PLACES_COPY, type MoreRow } from '@/features/shell/places'
import { useCopy } from '@/lib/i18n'

/** The icon of each row — the web's own glyph for the section, in Ionicons. */
const ROW_ICONS: Readonly<Record<MoreRow, IconName>> = {
  trade: 'swap-horizontal-outline',
  bots: 'git-branch-outline',
  money: 'wallet-outline',
  rewards: 'gift-outline',
  ryntra: 'sparkles-outline',
  settings: 'settings-outline',
}

/** The sections first, then the assistant and the settings — as the web's menu keeps its foot apart. */
const GROUPS: readonly (readonly MoreRow[])[] = [
  MORE_ROWS.filter((row) => row !== 'ryntra' && row !== 'settings'),
  ['ryntra', 'settings'],
]

/**
 * «Ще» — the menu v6.2 on a phone: the sections the bar does not
 * hold, each with the web's caption — Торгувати · Боти · Гроші · Винагороди —
 * then Ryntra, the assistant, and Налаштування. One version for everyone,
 * guests included; a row opens the phone's own screen. `receive=1` — an older
 * link to the address — opens «Отримати».
 */
export function MoreScreen() {
  const router = useRouter()
  const titles = useCopy(TAB_TITLES)
  const places = useCopy(PLACES_COPY)
  const { receive } = useLocalSearchParams<{ receive?: string }>()
  useEffect(() => {
    if (receive !== '1') return
    router.setParams({ receive: '' })
    router.push('/money/receive' as never)
  }, [receive, router])
  const open = (row: MoreRow) => {
    const destination = DOOR_DESTINATIONS[row]
    if (destination.kind === 'screen') router.push(destination.path as never)
  }
  return (
    <Screen title={titles.more}>
      {GROUPS.map((group) => (
        <Card key={group[0]} padded={false}>
          {group.map((row, index) => (
            <DoorRow
              key={row}
              icon={ROW_ICONS[row]}
              label={places.rows[row].label}
              line={places.rows[row].caption ?? undefined}
              onPress={() => open(row)}
              last={index === group.length - 1}
            />
          ))}
        </Card>
      ))}
    </Screen>
  )
}
