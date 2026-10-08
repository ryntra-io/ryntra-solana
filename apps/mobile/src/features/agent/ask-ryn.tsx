import { useRouter } from 'expo-router'
import { Pressable } from 'react-native'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import type { AgentContext } from '@/lib/api'
import { useCopy } from '@/lib/i18n'
import { cn } from '@/utils/cn'

import { contextParam } from './context'
import { AGENT_COPY } from './copy'

/** The conversation with Ryntra for a context: the stack screen with its way back, so the person returns where they asked from. */
export function useOpenRyn() {
  const router = useRouter()
  return (context: AgentContext) =>
    router.push({ pathname: '/ryn', params: { context: contextParam(context) } } as never)
}

export type AskRynProps = {
  context: AgentContext
  /** `icon` in a header; `row` as a line of its own; `inline` beside other words. */
  variant?: 'icon' | 'row' | 'inline'
  label?: string
  className?: string
}

/**
 * The door into the conversation with Ryntra from an asset, a plan, Portfolio
 * or a note — it opens a conversation, never an action. A quiet door, never
 * the hero: orange belongs to the screen's one action.
 */
export function AskRyn({ context, variant = 'icon', label, className }: AskRynProps) {
  const copy = useCopy(AGENT_COPY)
  const open = useOpenRyn()
  const words = label ?? copy.askRyn
  if (variant === 'icon') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={words}
        onPress={() => open(context)}
        hitSlop={8}
        className={cn('h-10 w-10 items-center justify-center rounded-btn active:bg-hover', className)}
      >
        <Icon name="sparkles-outline" size={20} color="muted" />
      </Pressable>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={words}
      onPress={() => open(context)}
      hitSlop={6}
      className={cn(
        'flex-row items-center gap-2 active:opacity-80',
        variant === 'row' && 'rounded-sm border border-line bg-surface px-4 py-3 active:bg-hover',
        className,
      )}
    >
      <Icon name="sparkles-outline" size={variant === 'row' ? 18 : 16} color="muted" />
      <Txt variant="ui" className={variant === 'row' ? 'flex-1' : undefined}>
        {words}
      </Txt>
      {variant === 'row' ? <Icon name="chevron-forward" size={16} color="fgMuted" /> : null}
    </Pressable>
  )
}
