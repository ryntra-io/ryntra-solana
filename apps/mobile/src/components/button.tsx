import { ActivityIndicator, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native'

import { Txt } from '@/components/txt'
import { useTheme } from '@/theme'
import { cn } from '@/utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const variants: Record<ButtonVariant, { classes: string; tone: 'onBrand' | 'fg' | 'muted' }> = {
  primary: { classes: 'bg-brand active:bg-brand-pressed', tone: 'onBrand' },
  secondary: { classes: 'bg-surface border border-line active:bg-hover active:border-line-strong', tone: 'fg' },
  ghost: { classes: 'bg-transparent active:bg-hover', tone: 'muted' },
  danger: { classes: 'bg-danger active:opacity-80', tone: 'onBrand' },
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3',
  md: 'h-11 px-4',
  lg: 'h-13 px-5',
}

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  title: string
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  style?: StyleProp<ViewStyle>
}

/**
 * Orange is the primary action and nothing else. Pressed state is a real
 * colour change (no hover on touch); disabled and loading are announced.
 */
export function Button({
  title,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  style,
  className,
  ...props
}: ButtonProps) {
  const { colors } = useTheme()
  const spec = variants[variant]
  const inactive = Boolean(disabled || loading)
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      disabled={inactive}
      style={style}
      className={cn(
        'flex-row items-center justify-center rounded-btn',
        sizes[size],
        spec.classes,
        inactive && 'opacity-50',
        className,
      )}
    >
      {loading ? (
        <ActivityIndicator color={spec.tone === 'onBrand' ? colors.onBrand : colors.fg} />
      ) : (
        // One line: a button's height is fixed, and Android could wrap the last word out of its frame («Усі компанії» read «Усі»).
        <Txt variant="ui" tone={spec.tone} numberOfLines={1}>
          {title}
        </Txt>
      )}
    </Pressable>
  )
}
