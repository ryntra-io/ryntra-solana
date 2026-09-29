import Ionicons from '@expo/vector-icons/Ionicons'
import type { ComponentProps } from 'react'

import { useTheme, type Colors } from '@/theme'

export type IconName = ComponentProps<typeof Ionicons>['name']

type IconProps = {
  name: IconName
  size?: number
  /** A colour token name; defaults to the muted text colour. */
  color?: keyof Colors
  style?: ComponentProps<typeof Ionicons>['style']
}

/** Line icons from the Ionicons set, coloured by token — never by literal. */
export function Icon({ name, size = 20, color = 'muted', style }: IconProps) {
  const { colors } = useTheme()
  return <Ionicons name={name} size={size} color={colors[color]} style={style} />
}
