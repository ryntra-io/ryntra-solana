import { Text, type TextProps } from 'react-native'

import { type, type TypeVariant } from '@/theme'
import { cn } from '@/utils/cn'

const tones = {
  fg: 'text-fg',
  muted: 'text-muted',
  faint: 'text-fg-muted',
  brand: 'text-brand',
  onBrand: 'text-on-brand',
  success: 'text-success-ink',
  danger: 'text-danger-ink',
  warning: 'text-warning-ink',
  evidence: 'text-evidence',
} as const

export type Tone = keyof typeof tones

export type TxtProps = TextProps & {
  variant?: TypeVariant
  tone?: Tone
  /** Short category labels only — never running text. */
  caps?: boolean
  /** Tabular figures; on by default for the data faces so columns line up. */
  tabular?: boolean
}

/**
 * The one text component. Every size, face and line height comes from the
 * type ramp, so screens never touch `fontSize`; colour is a tone token.
 */
export function Txt({ variant = 'body', tone = 'fg', caps, tabular, className, style, ...props }: TxtProps) {
  const ramp = type[variant]
  const isData = variant === 'data' || variant === 'dataLg'
  return (
    <Text
      {...props}
      className={cn(tones[tone], className)}
      style={[
        ramp,
        (tabular ?? isData) ? { fontVariant: ['tabular-nums'] } : null,
        caps ? { textTransform: 'uppercase' } : null,
        style,
      ]}
    />
  )
}
