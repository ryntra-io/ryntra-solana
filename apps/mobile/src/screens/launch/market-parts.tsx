import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { Card } from '@/components/card'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Txt } from '@/components/txt'
import type { LaunchWord } from '@/features/launch/copy'
import { explorerUrl, formatBps, formatMove, formatRaw } from '@/features/launch/launch-format'
import {
  addressRows,
  budgetInRows,
  budgetRows,
  concentrationLines,
  creatorLockText,
  creatorSoldText,
  daysText,
  depthAllSame,
  depthBars,
  engineLines,
  curveFull,
  holdersFloor,
  holdersLine,
  keeperWord,
  ladderLine,
  nextLine,
  onDexNow,
  pairMoney,
  pct,
  poolAddressOf,
  poolLine,
  reserveText,
  knownState,
  ruleText,
  rulesShownInMarks,
  rulesToShow,
  sinceText,
  stateLine,
  headerSince,
  stateTone,
  type HoldersView,
  type StateTone,
} from '@/features/launch/market-view'
import { presetRules, presetRuleText, type PresetLock } from '@/features/launch/preset-view'
import { useNow } from '@/hooks/use-now'
import type {
  LaunchMarketRule as LaunchMarketRuleView,
  LaunchMarketCardResponse,
  LaunchMarketCycleState,
  LaunchMarketEnforcement,
  LaunchMarketHealthResponse,
  LaunchMarketResponse,
  LaunchPreset,
} from '@/lib/api/v1/types'
import type { Locale } from '@/lib/i18n'
import { openLink } from '@/lib/open-link'
import { cn } from '@/utils/cn'

import { ExplorerLink } from './parts'

type Health = LaunchMarketHealthResponse

const STATE_SURFACE: Readonly<Record<StateTone, string>> = {
  curve: 'border-line bg-surface',
  live: 'border-line bg-surface',
  // Ryntra's ladder at work is a state, not a verdict: drawn in the ink, never the green that reads as «healthy».
  ladder: 'border-line-strong bg-surface',
  caution: 'border-warning bg-warning-soft',
}

const STATE_DOT: Readonly<Record<StateTone, string>> = {
  curve: 'border-muted',
  live: 'border-success bg-success',
  ladder: 'border-fg bg-fg',
  caution: 'border-warning bg-warning',
}

/**
 * A chip's own stop for a screen reader, with its hint, only where it stands
 * alone: inside a card that is one link, or beside a sentence that already
 * says it, it is read in place and adds no stop.
 */
type Standalone = Readonly<{ standalone?: boolean }>

/** A market's state in its cycle: a dot and the state's word — the colour never says it alone. */
export function StateChip({
  code,
  word,
  standalone = false,
}: { code: LaunchMarketCycleState; word: LaunchWord } & Standalone) {
  const tone = stateTone(code)
  if (!knownState(code))
    return (
      <Txt variant="labelSm" tone="muted">
        {word('notRead')}
      </Txt>
    )
  return (
    <View
      accessible={standalone}
      accessibilityRole="text"
      accessibilityHint={standalone ? word(`stateHint_${code}`) : undefined}
      className={cn(
        'flex-row items-center gap-1.5 self-start rounded-pill border px-2.5 py-[3px]',
        STATE_SURFACE[tone],
      )}
    >
      <View className={cn('h-2 w-2 rounded-pill border-[1.5px]', STATE_DOT[tone])} />
      <Txt variant="labelSm" tone="fg">
        {word(`state_${code}`)}
      </Txt>
    </View>
  )
}

/** Ryntra's own launch, checking the full cycle: never presented as demand. */
export function TechChip({ word, standalone = false }: { word: LaunchWord } & Standalone) {
  return (
    <View
      accessible={standalone}
      accessibilityRole="text"
      accessibilityHint={standalone ? word('techHint') : undefined}
      className="self-start rounded-pill border border-dashed border-line-strong px-2.5 py-[3px]"
    >
      <Txt variant="labelSm" tone="muted">
        {word('techChip')}
      </Txt>
    </View>
  )
}

/** A trade in the last 24 hours. */
export function LiveChip({ word, standalone = false }: { word: LaunchWord } & Standalone) {
  return (
    <View
      accessible={standalone}
      accessibilityRole="text"
      accessibilityHint={standalone ? word('liveHint') : undefined}
      className="flex-row items-center gap-1.5 self-start rounded-pill border border-line bg-surface px-2.5 py-[3px]"
    >
      {/* A fact, not a verdict: a trade in the last day — the creator's own counts too — so never the green of «healthy». */}
      <View className="h-1.5 w-1.5 rounded-pill bg-fg" />
      <Txt variant="labelSm" tone="fg">
        {word('live')}
      </Txt>
    </View>
  )
}

/**
 * A rule a program enforces, or a policy Ryntra's server runs — said in
 * words, never by colour alone; in the flight log also what the log only
 * observes, which neither governs.
 */
export function EnforceChip({
  enforcement,
  word,
  label,
  hint,
  standalone = false,
}: {
  enforcement: LaunchMarketEnforcement | 'observed'
  word: LaunchWord
  /** Its own words where it marks a group — «Правила програм» over «Чесний лаунч». */
  label?: string
  hint?: string
} & Standalone) {
  return (
    <View
      accessible={standalone}
      accessibilityRole="text"
      accessibilityHint={standalone ? (hint ?? word(`enforceHint_${enforcement}`)) : undefined}
      className={cn(
        'flex-row items-center justify-center gap-1 self-start rounded-pill border px-2.5 py-[3px]',
        enforcement === 'rule'
          ? 'border-transparent bg-success-soft'
          : enforcement === 'policy'
            ? 'border-line-strong bg-surface'
            : 'border-line bg-transparent',
      )}
      style={{ minWidth: 76 }}
    >
      {/* What the log only observes: its own shape — an eye and the muted ink — never a texture alone. */}
      {enforcement === 'observed' ? <Icon name="eye-outline" size={11} color="muted" /> : null}
      <Txt variant="labelSm" tone={enforcement === 'rule' ? 'success' : enforcement === 'policy' ? 'fg' : 'muted'}>
        {label ?? word(`enforce_${enforcement}`)}
      </Txt>
    </View>
  )
}

/** Holders over $1 in a cell: the count, a floor with «+», «Не пораховано», or «Не прочитано» — never a zero for none read. */
export function holdersCell(view: HoldersView, word: LaunchWord, locale: Locale): string {
  if (view.kind === 'count') return holdersFloor(view.count, view.atLeast, locale)
  return view.kind === 'uncounted' ? word('holdersUncounted') : word('notRead')
}

/** The way to the DEX: the curve's share, or «На DEX» with its days. */
export function WayBar({ bps, label }: { bps: number; label: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(bps / 100) }}
      className="h-1.5 overflow-hidden rounded-pill bg-track"
    >
      <View className="h-full rounded-pill bg-brand" style={{ width: `${Math.max(bps / 100, 1)}%` }} />
    </View>
  )
}

/**
 * «Ринок» on a token's page: the state in words and what comes next, the
 * way to the threshold on the curve, the DAMM v2 pool locked for ever after
 * it, and Ryntra's ladder in one line. The market's figures are the chain's;
 * a health not read leaves the way to the DEX as the market reads it.
 */
export function MarketStateCard({
  market,
  health,
  card,
  healthFailed,
  healthStale = false,
  onRetry,
  word,
  locale,
}: {
  market: LaunchMarketResponse
  health: Health | null
  card: LaunchMarketCardResponse | null
  healthFailed: boolean
  /** The last read again failed: the card's facts are the earlier read, and say so. */
  healthStale?: boolean
  onRetry: () => void
  word: LaunchWord
  locale: Locale
}) {
  const now = useNow(30_000)
  const left = BigInt(market.progress.thresholdRaw) - BigInt(market.progress.reserveRaw)
  // On the DEX as soon as either read says so: the market's own read moves first after a graduating trade.
  const dex = onDexNow(market, health)
  const next = health ? nextLine(health, word) : null
  const ladder = health ? ladderLine(health, word, locale, 'card') : null
  const pool = health ? poolLine(health, card, word, locale, now) : null
  const poolAddress = poolAddressOf(card, market)
  const full = health ? curveFull(health.venue, health.state.code, market.progress) : false
  const line = health ? stateLine(health.state, word, locale, now, full) : null
  const since = health ? headerSince(health, word, locale, now) : null
  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <Txt variant="labelSm" tone="faint" caps>
          {word('marketTitle')}
        </Txt>
        {health ? (
          <View className="flex-row items-center gap-2">
            {since ? (
              <Txt variant="labelSm" tone="muted">
                {since}
              </Txt>
            ) : null}
            <StateChip code={health.state.code} word={word} />
          </View>
        ) : null}
      </View>
      {health ? (
        <View className="gap-1">
          {line ? (
            <Txt variant="ui" tone={stateTone(health.state.code) === 'caution' ? 'warning' : 'fg'}>
              {line}
            </Txt>
          ) : null}
          {/* The state, the pool and the ladder are the health's read: said with its time, stale when reading again failed. */}
          <Txt variant="labelSm" tone={healthStale ? 'warning' : 'muted'}>
            {word(healthStale ? 'marketStale' : 'marksChecked', {
              ago: sinceText(health.observedAt, word, locale, now),
            })}
          </Txt>
        </View>
      ) : healthFailed ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          hitSlop={8}
          className="min-h-11 flex-row flex-wrap items-center gap-x-2"
        >
          <Txt variant="ui" tone="muted">
            {word('healthUnread')}
          </Txt>
          <Txt variant="ui" tone="brand">
            {word('readAgain')}
          </Txt>
        </Pressable>
      ) : (
        <Txt variant="ui" tone="muted">
          {word('healthReading')}
        </Txt>
      )}

      {dex ? (
        <View className="gap-2 border-t border-line pt-3">
          {pool ? (
            <View className="flex-row items-center gap-2">
              <Icon
                name={pool.locked ? 'lock-closed' : 'water-outline'}
                size={16}
                color={pool.locked ? 'brand' : 'muted'}
              />
              <Txt variant="ui" className="flex-1">
                {pool.text}
              </Txt>
            </View>
          ) : null}
          {poolAddress ? (
            <ExplorerLink label={word('pool')} url={explorerUrl(market.network, 'account', poolAddress)} />
          ) : null}
          {ladder ? (
            <View className="flex-row items-start gap-2">
              <Icon name="git-commit-outline" size={16} color="muted" style={{ marginTop: 1 }} />
              <Txt variant="ui" tone="muted" className="flex-1">
                {ladder}
              </Txt>
            </View>
          ) : null}
        </View>
      ) : (
        <View className="gap-2 border-t border-line pt-3">
          <View className="flex-row items-center justify-between">
            <Txt variant="ui" tone="muted">
              {word('colWay')}
            </Txt>
            <Txt variant="data">{formatBps(market.progress.bps, locale)}</Txt>
          </View>
          <WayBar bps={market.progress.bps} label={word('colWay')} />
          {/* What is left is what comes next on the curve; a full curve has nothing left to say. */}
          <Txt variant="labelSm" tone="muted">
            {`${word('progressOf', {
              amount: reserveText(market.progress.reserveRaw, market.pair.decimals, locale),
              threshold: formatRaw(market.progress.thresholdRaw, market.pair.decimals, locale, 0),
              symbol: market.pair.symbol,
            })}${
              left > 0n
                ? ` · ${word('progressLeft', {
                    amount: reserveText(left.toString(), market.pair.decimals, locale),
                    symbol: market.pair.symbol,
                  })}`
                : ''
            }`}
          </Txt>
        </View>
      )}
      {next ? (
        <Txt variant="ui" tone="muted">
          {next}
        </Txt>
      ) : null}
    </Card>
  )
}

/**
 * «Що тримає цей ринок»: what keeps the market now, each marked a rule (a
 * program enforces it) or a policy (Ryntra's server runs it), with the
 * difference said once; the token's own rules and the pool's locks stand in
 * «Чесний лаунч» below and are not said twice.
 */
export function RulesCard({
  health,
  marks,
  word,
  locale,
}: {
  health: Health
  marks: readonly string[]
  word: LaunchWord
  locale: Locale
}) {
  const now = useNow(60_000)
  const [all, setAll] = useState(false)
  const every = rulesToShow(health, marks)
  // Three rules in words on the first screen (PLAN §7); the rest one press away.
  // One more is shown, never hidden behind «Ще 1».
  const rules = all || every.length <= RULES_AT_ONCE + 1 ? every : every.slice(0, RULES_AT_ONCE)
  const inMarks = rulesShownInMarks(marks)
  return (
    <Card className="gap-3">
      <Txt variant="labelSm" tone="faint" caps>
        {word('hRules')}
      </Txt>
      {rules.map((rule, index) => {
        const text = ruleText(rule, health.pair, word, locale, now)
        const source = rule.source
        return (
          <RuleRow
            key={`${rule.code}:${source?.id ?? index}`}
            rule={rule}
            text={text}
            network={health.network}
            word={word}
          />
        )
      })}
      {rules.length < every.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAll(true)}
          hitSlop={8}
          className="min-h-11 justify-center self-start"
        >
          <Txt variant="ui" tone="brand">
            {word('rulesMore', { n: every.length - rules.length })}
          </Txt>
        </Pressable>
      ) : null}
      {!health.rulesComplete ? (
        <Txt variant="ui" tone="warning">
          {word('hRulesIncomplete')}
        </Txt>
      ) : null}
      {inMarks.size ? (
        <Txt variant="labelSm" tone="muted" style={{ lineHeight: 16 }}>
          {word('hRulesInMarks')}
        </Txt>
      ) : null}
      {/* What a rule and a policy are, one press deep: the chips say which, the words say why it matters. */}
      <More label={word('rulesLegendOpen')} quiet>
        <Txt variant="labelSm" tone="muted" style={{ lineHeight: 17 }}>
          {word('hRulesLegend')}
        </Txt>
      </More>
    </Card>
  )
}

/**
 * One rule: its mark (a program's rule or Ryntra's policy) and its sentence;
 * who keeps it is said to a screen reader and on Solscan one press away —
 * never as a program's name on the screen. A rule without a source is not a
 * button.
 */
export function RuleRow({
  rule,
  text,
  network,
  word,
}: {
  rule: LaunchMarketRuleView
  text: string
  network: string
  word: LaunchWord
}) {
  const source = rule.source
  const label = `${word(`enforce_${rule.enforcement}`)}: ${text}. ${keeperWord(rule.by, word)}`
  const body = (
    <>
      <View className="flex-row items-center justify-between gap-2">
        <EnforceChip enforcement={rule.enforcement} word={word} />
        {source ? <Icon name="open-outline" size={14} color="fgMuted" /> : null}
      </View>
      <Txt variant="ui">{text}</Txt>
    </>
  )
  return source ? (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={word('ruleSource')}
      onPress={() => openLink(explorerUrl(network, source.kind, source.id))}
      className="gap-1.5 active:opacity-80"
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label} className="gap-1.5">
      {body}
    </View>
  )
}

/** How many rules «Що тримає цей ринок» shows before «Ще N». */
const RULES_AT_ONCE = 3

/**
 * «Що триматиме цей ринок» — before the signature, from the chosen preset and
 * lock: three rules in words, the rest one press away, and Ryntra's policy
 * always in sight — the one promise that rests on a server, not a program.
 * Nothing to open on Solscan yet: the accounts exist only once the wallet
 * signs, and the market's page shows them.
 */
export function PresetRulesCard({
  preset,
  lock,
  network,
  word,
  locale,
}: {
  preset: LaunchPreset
  lock: PresetLock | null
  network: string
  word: LaunchWord
  locale: Locale
}) {
  const now = useNow(60_000)
  const [all, setAll] = useState(false)
  const every = presetRules(preset, lock, now)
  const programs = every.filter((rule) => rule.enforcement === 'rule')
  const policies = every.filter((rule) => rule.enforcement !== 'rule')
  const rules = all || programs.length <= RULES_AT_ONCE + 1 ? programs : programs.slice(0, RULES_AT_ONCE)
  const row = (rule: LaunchMarketRuleView) => (
    <RuleRow
      key={rule.code}
      rule={rule}
      text={presetRuleText(rule, preset, word, locale, now)}
      network={network}
      word={word}
    />
  )
  return (
    <Card className="gap-3">
      <Txt variant="labelSm" tone="faint" caps>
        {word('hRulesBefore')}
      </Txt>
      {rules.map(row)}
      {rules.length < programs.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAll(true)}
          hitSlop={8}
          className="min-h-11 justify-center self-start"
        >
          <Txt variant="ui" tone="brand">
            {word('rulesMore', { n: programs.length - rules.length })}
          </Txt>
        </Pressable>
      ) : null}
      {policies.map(row)}
      <Txt variant="labelSm" tone="muted" style={{ lineHeight: 16 }}>
        {word('rulesBeforeLine')}
      </Txt>
      <More label={word('rulesLegendOpen')} quiet>
        <Txt variant="labelSm" tone="muted" style={{ lineHeight: 17 }}>
          {word('hRulesLegend')}
        </Txt>
      </More>
    </Card>
  )
}

/** One block of the health: its label, then its lines. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1.5 border-b border-line py-3">
      <Txt variant="labelSm" tone="faint" caps>
        {label}
      </Txt>
      {children}
    </View>
  )
}

/** A label and its value on one line; a value not read or not counted in the muted ink, never as a zero. */
function Line({ label, value, quiet = false }: { label: string; value: string; quiet?: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Txt variant="ui" tone="muted" className="shrink">
        {label}
      </Txt>
      <Txt variant={quiet ? 'ui' : 'data'} tone={quiet ? 'muted' : 'fg'} className="shrink text-right">
        {value}
      </Txt>
    </View>
  )
}

/** A disclosure: closed until pressed. `quiet` — inside a card, in the muted ink, without a line under it. */
function More({ label, children, quiet = false }: { label: string; children: React.ReactNode; quiet?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <View className={quiet ? '' : 'border-b border-line'}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        className={cn('min-h-11 flex-row items-center justify-between gap-3', quiet ? 'py-1' : 'py-3')}
      >
        <Txt variant={quiet ? 'labelSm' : 'ui'} tone={quiet ? 'muted' : 'fg'}>
          {label}
        </Txt>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color="fgMuted" />
      </Pressable>
      {open ? <View className="gap-2 pb-3">{children}</View> : null}
    </View>
  )
}

/**
 * «Здоров'я ринку», one tap deep: executable depth at −2, −5 and −10 %,
 * holders over $1 («щонайменше» where the network listed only some),
 * concentration, the creator's lock and sales, Ryntra's executor and its
 * pause, the budget («Ще не рахуємо», never zero) and survival — by fixed
 * definitions, said one press further; the market's addresses; and the line
 * that no price is guaranteed.
 */
export function HealthSheet({
  visible,
  onClose,
  health,
  card,
  progress = null,
  stale = false,
  word,
  locale,
}: {
  visible: boolean
  onClose: () => void
  health: Health
  card: LaunchMarketCardResponse | null
  /** The market's own read of its curve: a full curve under a pause is still full. */
  progress?: Readonly<{ bps: number; migrated: boolean }> | null
  /** The last read again failed: the figures are the earlier read, and the title line says so. */
  stale?: boolean
  word: LaunchWord
  locale: Locale
}) {
  const now = useNow(30_000)
  const money = (raw: string) => pairMoney(raw, health.pair, locale)
  const notRead = word('notRead')
  const full = curveFull(health.venue, health.state.code, progress)
  const deepest = Math.max(1, ...health.depth.map((level) => (level.pairRaw === null ? 0 : Number(level.pairRaw))))
  const allSame = depthAllSame(health)
  const bars = depthBars(health)
  const sheetLadder = ladderLine(health, word, locale)
  const holders = holdersLine(health, word, locale)
  const concentration = concentrationLines(health, word, locale)
  const lock = creatorLockText(health.creator.lock, true, word, locale, now)
  const engine = engineLines(health, word)
  const addresses = card ? addressRows(card) : []
  return (
    <Sheet
      visible={visible}
      title={word('healthTitle')}
      subtitle={word(stale ? 'marketStale' : 'marksChecked', { ago: sinceText(health.observedAt, word, locale, now) })}
      onClose={onClose}
      scroll
    >
      <View className="px-4 pb-2">
        <Block label={word('hDepth')}>
          {full ? (
            <Txt variant="ui" tone="muted">
              {word('hDepthClosed')}
            </Txt>
          ) : (
            <>
              <Txt variant="labelSm" tone="muted">
                {word('hDepthSub')}
              </Txt>
              {health.depth.map((level) => {
                const label = word('dropLabel', { pct: pct(level.dropBps, locale) })
                return (
                  <View
                    key={level.dropBps}
                    accessible
                    accessibilityLabel={`${label}: ${level.pairRaw === null ? notRead : money(level.pairRaw)}`}
                    className="flex-row items-center gap-3"
                  >
                    <Txt variant="data" tone="muted" style={{ width: 64 }}>
                      {label}
                    </Txt>
                    {level.pairRaw === null ? (
                      <Txt variant="ui" tone="muted" className="flex-1">
                        {notRead}
                      </Txt>
                    ) : !bars ? (
                      <Txt variant="data" className="flex-1 text-right">
                        {money(level.pairRaw)}
                      </Txt>
                    ) : (
                      <>
                        <View className="h-1.5 flex-1 overflow-hidden rounded-pill bg-track">
                          <View
                            className="h-full rounded-pill bg-chart-2"
                            style={{
                              width: `${Math.max((Number(level.pairRaw) / deepest) * 100, Number(level.pairRaw) > 0 ? 2 : 0)}%`,
                            }}
                          />
                        </View>
                        <Txt variant="data" className="text-right" style={{ minWidth: 72 }}>
                          {money(level.pairRaw)}
                        </Txt>
                      </>
                    )}
                  </View>
                )
              })}
              {allSame ? (
                <Txt variant="labelSm" tone="muted">
                  {word('hDepthAll', { amount: money(allSame) })}
                </Txt>
              ) : null}
              {sheetLadder ? (
                <Txt variant="labelSm" tone="muted">
                  {sheetLadder}
                </Txt>
              ) : null}
            </>
          )}
        </Block>

        <Block label={word('hHolders')}>
          <Txt variant={holders.counted ? 'data' : 'ui'} tone={holders.counted ? 'fg' : 'muted'}>
            {holders.text}
          </Txt>
          <Txt variant="labelSm" tone="muted">
            {word('hHoldersSub')}
          </Txt>
          {health.holders.atLeast ? (
            <Txt variant="labelSm" tone="muted" style={{ lineHeight: 16 }}>
              {word(health.holders.count === null ? 'hHoldersNoneFound' : 'hAtLeastHint')}
            </Txt>
          ) : null}
        </Block>

        <Block label={word('hConcentration')}>
          {concentration.share ? (
            <>
              <Txt variant="ui">{concentration.share}</Txt>
              {concentration.mark ? (
                <Txt variant="ui" tone={concentration.mark.marked ? 'warning' : 'muted'}>
                  {concentration.mark.text}
                </Txt>
              ) : null}
              {health.concentration.atLeast ? (
                <Txt variant="labelSm" tone="muted" style={{ lineHeight: 16 }}>
                  {word('hTop10Hint')}
                </Txt>
              ) : null}
            </>
          ) : (
            <Txt variant="ui" tone="muted">
              {notRead}
            </Txt>
          )}
        </Block>

        <Block label={word('hCreator')}>
          <View className="flex-row items-center gap-2">
            <Icon
              name={lock.locked ? 'lock-closed' : 'lock-open-outline'}
              size={15}
              color={lock.locked ? 'brand' : 'muted'}
            />
            <Txt variant="ui" className="flex-1">
              {lock.text}
            </Txt>
          </View>
          <View className="flex-row items-center gap-2">
            {health.creator.sold === true ? (
              <Icon name="trending-down" size={15} color="dangerInk" />
            ) : (
              <View style={{ width: 15 }} />
            )}
            <Txt
              variant="ui"
              tone={health.creator.sold === true ? 'danger' : health.creator.sold === null ? 'muted' : 'fg'}
              className="flex-1"
            >
              {creatorSoldText(health.creator, word, locale)}
            </Txt>
          </View>
        </Block>

        <Block label={word('hEngine')}>
          {engine.map((line, index) => (
            <View key={index} className="gap-0.5">
              <Txt variant="ui" tone={line.mark ? 'warning' : line.quiet ? 'muted' : 'fg'}>
                {line.text}
              </Txt>
              {line.tx ? (
                <View className="flex-row flex-wrap items-center gap-x-2">
                  {line.at ? (
                    <Txt variant="labelSm" tone="muted">
                      {sinceText(line.at, word, locale, now)}
                    </Txt>
                  ) : null}
                  <ExplorerLink label={word('logTx')} url={explorerUrl(health.network, 'tx', line.tx)} />
                </View>
              ) : null}
            </View>
          ))}
        </Block>

        <Block label={word('hBudget')}>
          {budgetInRows(health) ? (
            budgetRows(health, word, locale).map((row) => (
              <Line key={row.label} label={row.label} value={row.value} quiet={!row.counted} />
            ))
          ) : (
            <Txt variant="ui" tone="muted">
              {word('notCounted')}
            </Txt>
          )}
        </Block>

        <Block label={word('hSurvival')}>
          <Txt variant="ui">
            {health.survival.daysSinceDex !== null
              ? word('hDaysOnDex', { n: daysText(health.survival.daysSinceDex, word) })
              : health.venue === 'curve'
                ? word('hOnCurve')
                : notRead}
          </Txt>
          {health.survival.priceVsDexBps !== null ? (
            <View className="flex-row items-baseline gap-2">
              <Txt variant="ui" tone="muted">
                {word('hVsDex')}
              </Txt>
              <Txt
                variant="data"
                tone={
                  health.survival.priceVsDexBps > 0 ? 'success' : health.survival.priceVsDexBps < 0 ? 'danger' : 'fg'
                }
              >
                {formatMove(health.survival.priceVsDexBps, locale)}
              </Txt>
            </View>
          ) : null}
          <Txt variant="ui" tone={health.survival.traded24h === null ? 'muted' : 'fg'}>
            {health.survival.traded24h === true
              ? `${word('hTraded')}${health.survival.lastTradeAt ? ` · ${sinceText(health.survival.lastTradeAt, word, locale, now)}` : ''}`
              : health.survival.traded24h === false
                ? word('hNotTraded')
                : word('hTradedUnread')}
          </Txt>
        </Block>

        <More label={word('hHow')}>
          {(
            [
              'def_state',
              'def_depth',
              'def_budget',
              'def_survival',
              'def_holders',
              'def_creator',
              'def_concentration',
              'def_engine',
            ] as const
          ).map((key) => (
            <Txt key={key} variant="labelSm" tone="muted" style={{ lineHeight: 17 }}>
              {word(key)}
            </Txt>
          ))}
        </More>
        {addresses.length ? (
          <More label={word('addresses')}>
            {addresses.map((row) => (
              <View key={`${row.key}:${row.address}`} className="flex-row items-center justify-between gap-3">
                <Txt variant="ui" tone="muted" className="shrink">
                  {word(row.key)}
                </Txt>
                <ExplorerLink
                  accessibilityLabel={`${word(row.key)}: ${row.address.slice(0, 4)}…${row.address.slice(-4)}`}
                  label={`${row.address.slice(0, 4)}…${row.address.slice(-4)}`}
                  url={explorerUrl(health.network, 'account', row.address)}
                />
              </View>
            ))}
          </More>
        ) : null}
        <Txt variant="ui" tone="muted" className="pt-3">
          {word('noGuarantee')}
        </Txt>
      </View>
    </Sheet>
  )
}
