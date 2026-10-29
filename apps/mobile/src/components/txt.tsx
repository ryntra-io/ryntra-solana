import { isValidElement, type ReactNode } from 'react'
import { Text, type TextProps } from 'react-native'

import { useLocale } from '@/lib/i18n'
import { type, type TypeVariant } from '@/theme'
import { cn } from '@/utils/cn'
import { spokenText } from '@/utils/format'

const tones = {
  fg: 'text-fg',
  muted: 'text-muted',
  faint: 'text-fg-muted',
  brand: 'text-brand-ink',
  onBrand: 'text-on-brand',
  onDanger: 'text-on-danger',
  inkLight: 'text-ink-light',
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

/** The words a text shows when its children are text all the way down (nested texts too); null when a child draws something else. */
function shownText(children: ReactNode): string | null {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (children === null || children === undefined || typeof children === 'boolean') return ''
  if (Array.isArray(children)) {
    let text = ''
    for (const child of children) {
      const part = shownText(child as ReactNode)
      if (part === null) return null
      text += part
    }
    return text
  }
  if (isValidElement(children)) {
    const inner = (children.props as { children?: ReactNode }).children
    return inner === undefined ? null : shownText(inner)
  }
  return null
}

/**
 * The one text component. Every size, face and line height comes from the
 * type ramp, so screens never touch `fontSize`; colour is a tone token.
 */
export function Txt({ variant = 'body', tone = 'fg', caps, tabular, className, style, ...props }: TxtProps) {
  const ramp = type[variant]
  const isData = variant === 'data' || variant === 'dataLg'
  const locale = useLocale()
  /* An unknown figure is drawn as a dash and said as «невідомо» / “unknown”, never «тире». The label is passed on every
     render — the visible text itself when there is nothing special to say — because Android keeps the last label a
     text was given when the prop is dropped (`BaseViewManager.updateViewContentDescription` sets nothing when the
     label is gone), so a «—» that fills in with a figure would go on being read as «невідомо». */
  const shown = props.accessibilityLabel === undefined ? shownText(props.children) : null
  /* Always a string: a label dropped to undefined leaves Android reading the last one («06:02 · 2 хв тому» in a line
     that went empty, ST-5 r5). An empty text says nothing and is not a stop for a screen reader; a text drawn from other
     parts (null) gets the empty label, which Android reads past to the text itself. */
  const empty = shown === ''
  const label = props.accessibilityLabel ?? (shown ? spokenText(shown, locale) : '')
  return (
    <Text
      {...props}
      accessibilityLabel={label}
      importantForAccessibility={empty ? 'no' : (props.importantForAccessibility ?? 'auto')}
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
