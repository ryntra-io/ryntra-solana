import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'

import { Icon } from '@/components/icon'
import { Txt } from '@/components/txt'
import { useAccount } from '@/features/session/use-account'
import type { AgentContext } from '@/lib/api'
import { useCopy } from '@/lib/i18n'
import { cn } from '@/utils/cn'

import { contextParam } from './context'
import { lensPath } from './use-lens'
import { AGENT_COPY } from './copy'

/**
 * «Спитати Ryntra» for a context, with its way back: on an asset, a plan or Portfolio a signed-in wallet gets the
 * Lens — the overview, then the critic on a press (as the web's); a note, a page or a guest gets the conversation.
 */
export function useOpenRyn() {
  const router = useRouter()
  const account = useAccount()
  return (context: AgentContext) => {
    const lens = account.session ? lensPath(context) : null
    if (lens) router.push(lens as never)
    else router.push({ pathname: '/ryn', params: { context: contextParam(context) } } as never)
  }
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

/**
 * «Що зрушило ціну?» from an asset or its chart: Ryntra opened on the asset with the question asked once (`ask=1`).
 * The phone sends no `acceptCredits`, so it is free — past the day's free questions it is composed from the reads.
 */
export function useExplainMove() {
  const router = useRouter()
  const copy = useCopy(AGENT_COPY)
  return (mint: string, symbol: string | null) => {
    const context: AgentContext = symbol ? { kind: 'asset', mint, symbol: symbol.slice(0, 32) } : { kind: 'asset', mint }
    const q = symbol ? copy.explainAsk(symbol) : copy.explainAskThis
    router.push({ pathname: '/ryn', params: { context: contextParam(context), q, ask: '1' } } as never)
  }
}

/** A quiet door under the chart: an icon and its word, never orange. */
function ChartDoor({ icon, label, accessibilityLabel, onPress }: { icon: 'sparkles-outline' | 'notifications-outline' | 'document-text-outline'; label: string; accessibilityLabel?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={8}
      className="flex-row items-center gap-1.5 py-1 active:opacity-80"
    >
      <Icon name={icon} size={14} color="muted" />
      <Txt variant="ui" tone="muted">
        {label}
      </Txt>
    </Pressable>
  )
}

/**
 * The chart's own doors to Ryntra, quiet, under the line they are about: «Пояснити рух» for everyone; for a signed-in
 * wallet also «Стежити» — «Стежу» with this token chosen — and «План» — «Плани» with this token's plans first (AI-06).
 */
export function ExplainMove({ mint, symbol, className }: { mint: string; symbol: string | null; className?: string }) {
  const copy = useCopy(AGENT_COPY)
  const explain = useExplainMove()
  const router = useRouter()
  const account = useAccount()
  const context: AgentContext = symbol ? { kind: 'asset', mint, symbol: symbol.slice(0, 32) } : { kind: 'asset', mint }
  const openTab = (tab: 'watch' | 'plans') =>
    router.push({ pathname: '/ryn', params: { context: contextParam(context), tab } } as never)
  return (
    <View className={cn('flex-row flex-wrap items-center justify-end gap-x-4 gap-y-1', className)}>
      {account.session ? (
        <>
          <ChartDoor icon="notifications-outline" label={copy.watchDoor} onPress={() => openTab('watch')} />
          <ChartDoor icon="document-text-outline" label={copy.planDoor} onPress={() => openTab('plans')} />
        </>
      ) : null}
      <ChartDoor
        icon="sparkles-outline"
        label={copy.explainMove}
        accessibilityLabel={symbol ? copy.explainAsk(symbol) : copy.explainAskThis}
        onPress={() => explain(mint, symbol)}
      />
    </View>
  )
}
