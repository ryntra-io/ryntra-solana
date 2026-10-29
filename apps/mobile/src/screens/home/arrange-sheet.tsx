import { Pressable, Switch, View } from 'react-native'

import { Button } from '@/components/button'
import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import { PLACE_HOME_COPY } from '@/features/home/place-copy'
import { BLOCKS_COPY } from '@/features/home/blocks-copy'
import {
  arrangeable,
  DEFAULT_LAYOUT,
  isDefaultLayout,
  moveBlock,
  toggleBlock,
  type HomeBlockId,
} from '@/features/home/home-blocks'
import { setHomeLayout, useHomeLayout } from '@/features/home/use-home-layout'
import { useCopy } from '@/lib/i18n'
import { useSpace, useTheme } from '@/theme'

/** A block's name on Home — the same words its own header says there. */
export function useBlockNames(): Readonly<Record<HomeBlockId, string>> {
  const home = useCopy(PLACE_HOME_COPY)
  return {
    favourites: home.favourites,
    myMarkets: home.myMarkets,
    recent: home.recent,
  }
}

function MoveButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'chevron-up' | 'chevron-down'
  label: string
  disabled: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      className={`h-10 w-10 items-center justify-center rounded-btn ${disabled ? 'opacity-30' : 'active:bg-hover'}`}
    >
      <Icon name={icon} size={20} color="muted" />
    </Pressable>
  )
}

/**
 * «Блоки Головної»: every block the person can see now, in Home's order —
 * a switch to draw it or not, and two steps to move it among the others.
 * Opened by holding a block on Home, or from Settings; every change lands
 * on Home at once, so closing the sheet is all «Готово» does.
 */
export function ArrangeSheet({
  visible,
  available,
  onClose,
}: {
  visible: boolean
  available: ReadonlySet<HomeBlockId>
  onClose: () => void
}) {
  const copy = useCopy(BLOCKS_COPY)
  const names = useBlockNames()
  const { colors } = useTheme()
  const space = useSpace()
  const layout = useHomeLayout()
  const rows = arrangeable(layout, available)
  const on = rows.filter((block) => block.on).length
  return (
    <Sheet visible={visible} title={copy.title} subtitle={copy.shown(on, rows.length)} onClose={onClose} scroll>
      <View className="gap-3 pb-1">
        <Card padded={false}>
          {rows.map((block, index) => {
            const name = names[block.id]
            const last = index === rows.length - 1
            return (
              <View
                key={block.id}
                className={`flex-row items-center gap-2 pl-4 pr-3 ${space.row} ${last ? '' : 'border-b border-line'}`}
              >
                <Txt variant="ui" tone={block.on ? 'fg' : 'muted'} className="flex-1">
                  {name}
                </Txt>
                <MoveButton
                  icon="chevron-up"
                  label={copy.moveUp(name)}
                  disabled={index === 0}
                  onPress={() => setHomeLayout(moveBlock(layout, block.id, -1, available))}
                />
                <MoveButton
                  icon="chevron-down"
                  label={copy.moveDown(name)}
                  disabled={last}
                  onPress={() => setHomeLayout(moveBlock(layout, block.id, 1, available))}
                />
                <Switch
                  value={block.on}
                  onValueChange={(next) => setHomeLayout(toggleBlock(layout, block.id, next))}
                  accessibilityLabel={name}
                  trackColor={{ false: colors.lineStrong, true: colors.success }}
                  thumbColor={colors.onBrand}
                  ios_backgroundColor={colors.lineStrong}
                />
              </View>
            )
          })}
        </Card>
        <View className="flex-row gap-2">
          {isDefaultLayout(layout, available) ? null : (
            <Button
              title={copy.reset}
              variant="secondary"
              className="flex-1"
              onPress={() => setHomeLayout(DEFAULT_LAYOUT)}
            />
          )}
          <Button title={copy.done} variant="secondary" className="flex-1" onPress={onClose} />
        </View>
      </View>
    </Sheet>
  )
}
