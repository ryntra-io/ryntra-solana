import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Keyboard, Pressable, TextInput, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Button } from '@/components/button'
import { type Choice } from '@/components/choice-chips'
import { Field } from '@/components/field'
import { HelpDot } from '@/components/help-dot'
import { SignInHelp } from '@/screens/invest/buy-sheet'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY, type AutoinvestCopy } from '@/features/autoinvest/copy'
import {
  defaultPercent,
  exampleOf,
  fixedOfInput,
  paymentsRequest,
  percentChoices,
  readNote,
  shownEvents,
  termsOf,
} from '@/features/autoinvest/payments'
import {
  floorHeld,
  floorLine,
  floorStanding,
  floorTerms,
  isListedToken,
  riskRows,
  tokenBlockOf,
  tokenWriteFailure,
  type TokenBlock,
} from '@/features/autoinvest/floor'
import {
  anchorNowLine,
  anchorStandingLine,
  checkPriceCondition,
  conditionChoices,
  conditionLine,
  conditionNowLine,
  conditionShort,
  deferralLine,
  limitWords,
} from '@/features/autoinvest/price-condition'
import {
  clampMonthDay,
  defaultSchedule,
  deviceTimeZone,
  dipPreview,
  dipRequest,
  firstDue,
  fitsCeiling,
  heldByBudget,
  lastSettled,
  openOccurrence,
  purchaseSumUsd,
  ruleAmountOf,
  ruleFace,
  scheduleRequest,
  timeOfInput,
  withCadence,
  writeFailureWords,
  zoneOfRule,
  RULE_DEFAULT_USD,
  RULE_DIP_PRESETS_PCT,
  RULE_MIN_USD,
} from '@/features/autoinvest/rule-model'
import { RULE_CADENCES, type RuleCadence, type RuleSchedule } from '@/features/autoinvest/schedule'
import { useConditionBounds, useConditionFacts } from '@/features/autoinvest/use-condition'
import { useRuleAsset } from '@/features/autoinvest/use-rule-asset'
import { usePaymentBounds, useRuleWrites, useTelegramChannel, type RuleWrite } from '@/features/autoinvest/use-rules'
import {
  cadenceWord,
  dayWords,
  dueWords,
  keptTail,
  paymentsLine,
  pctWord,
  priceWord,
  ruleSentence,
  ruleWhenLine,
  setAsideExample,
  unbroken,
  unbrokenParts,
  unbrokenTail,
  wholeParts,
  WEEKDAY_SHORT,
} from '@/features/autoinvest/words'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { dollarsText, parseDollars } from '@/features/invest/buy-model'
import { COMPANY_COPY } from '@/features/invest/company-copy'
import { useQuoteRoute, useRouteMinimum } from '@/features/invest/use-route-minimum'
import { useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import {
  USDC_MINT,
  type AutoinvestRule,
  type RuleBudget,
  type RuleCreateRequest,
  type RuleKind,
  type RuleOccurrence,
  type RuleAssetRead,
  type RulePaymentMode,
  type RulePayments,
  type RulePriceConditionState,
  type RulePriceReference,
} from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { type, useTheme } from '@/theme'
import { DASH } from '@/utils/format'

import { EventLine } from '@/screens/invest/event-ui'

import { BudgetRow } from './budget-row'

/** What the sheet is for: a new rule on a company, or one the wallet already has. */
export type AutoinvestMode =
  Readonly<{ kind: 'compose'; amountUsd: number | null }> | Readonly<{ kind: 'manage'; rule: AutoinvestRule }>

/** The company as the sheet names and draws it. */
export type AutoinvestCompany = Readonly<{
  mint: string
  name: string
  icon: string | null
  preIpo: boolean
  truth: string | null
  /** The issuer's event before a rule's first purchase: the token bought must be swapped by the deadline; null for none. */
  eventLine?: string | null
  /** The price the page shows now, per unit as the wallet shows it — where a new «Якщо впаде» rule would count from; null unknown. */
  priceUsd: number | null
  /**
   * 1.31.0: a token of the venue's list — a coin, a meme, a new token — rather than a company: the sheet reads what a
   * rule on it would stand on (the floor, and for a meme the facts of its risk) and its own price from the server.
   */
  token?: boolean
}>

export type AutoinvestSheetProps = Readonly<{
  visible: boolean
  mode: AutoinvestMode
  company: AutoinvestCompany
  /** The month's budget as the rules' read last said it; null before it is read. */
  budget: RuleBudget | null
  onClose: () => void
  /** An open reminder, bought now: the purchase on the rule's sum, on the company's page. */
  onBuyNow: (rule: AutoinvestRule, occurrence: RuleOccurrence) => void
  /** The budget's sheet over this one — from a new rule's budget line, or a rule the month's budget holds. */
  onChangeBudget: () => void
  /** 1.31.0: a token no rule can name — the next step beside its reason, the market purchase; absent, none is offered. */
  onMarketBuy?: () => void
}>

/** Where the flow stands: a sheet over a page, or (1.31.0) a panel inside Trade beside «Ринок» — no head, no close. */
type Variant = 'sheet' | 'panel'

/**
 * «Автоінвест» on a company, a sheet like the
 * purchase's.
 *
 * **Намір.** Two rules. «Регулярно»: a sum in dollars from $1 — one sum the
 * person types, no quick sums — every day, week or
 * month, the day and the time on the phone's own clock, and at once when the
 * first reminder comes («Перша купівля: чт, 25 вер. о 19:00») from the same
 * schedule functions the server reminds with. The sheet opens on «Щотижня ·
 * $10» — a default, not advice; from a receipt's «Купувати щотижня», weekly on
 * the sum just bought. A company whose live route starts above the sum says
 * its own minimum from the quote before the rule is turned on, and the one
 * action puts it in. «Якщо впаде»: the sum and how far the price must fall
 * below the price now — «Ryntra нагадає при $241,59 або нижче · ціна зараз
 * $254,30»; one reminder each time it falls below that line. The sum reads
 * «Кожна купівля» — it is each purchase, never the month's budget
 * (M20). **Межі.** The month's budget for
 * every rule, the person's own, as its own line — «Бюджет не задано · Задати»
 * or «Бюджет місяця $10 з $50 · Змінити» — that opens the budget's own sheet
 * over this one («Не більше на місяць»); a sum the month's rest does not
 * cover is said before the rule is written. Under it, always: «Ryntra
 * нагадає — ти підтвердиш одним дотиком. Гроші лишаються у твоєму гаманці.»
 * **Дозвіл** is not asked here: a rule only schedules a reminder.
 * «Увімкнути» writes it behind the wallet's session — a signed-in wallet,
 * never a transaction — and every purchase later is its own signature on a
 * fresh «Перевірка».
 *
 * **Умова ціни** (M25, the web's: a
 * company with a reference — PreStocks' valuation for a private one, the
 * reference per share for a listed one — offers «Не купувати, якщо дорожче за
 * орієнтир більш ніж на N %», 5 % (the server's default) unless the person
 * picks 2 %, 10 % or «Без умови», with how the price stands now: «Зараз ціна
 * на 35 % дорожча за оцінку PreStocks — купівлю буде відкладено.» A company
 * without one is offered none. A rule that has it says so, and a purchase it
 * deferred says why — the reason, the figure and the data's time — and until
 * when the rule checks again.
 *
 * **З оплат** (M26, the web's: the
 * third kind sets money aside from the wallet's own USDC — «Що відкладати»:
 * «Округлення» of every payment to $1 or $5, «$ з оплати» typed from $0,10 to
 * $100, or «% з надходжень» 5 · 10 · 20 % — with the web's example on its own
 * arithmetic («Оплата $3,40 → $0,60 в Apple»), «Нагадування від $1» (or the
 * company's own minimum where a dollar has no route) and what counts, the rest
 * behind «?». Its sheet says what it has gathered, «Що відкладати», «Рахую
 * з» and the newest payments or incoming transfers — the sum, the share, the
 * time, the Solana Pay label, «у нагадуванні» — with a quiet «Мій рахунок»
 * asked once more before it is written.
 *
 * A company that already has a rule opens it instead: what it is, when the
 * next purchase is or the line its price must fall to, what became of the
 * last one («Пропущено» without an action), and pause, turn on again or
 * delete. When its reminder is open, the one orange action buys it — «Купити
 * $20 за правилом»; when the month's budget holds it, the one action is
 * «Змінити бюджет».
 */
export function AutoinvestSheet(props: AutoinvestSheetProps) {
  if (!props.visible) return null
  return (
    <AutoinvestFlow key={props.mode.kind === 'manage' ? props.mode.rule.id : 'compose'} {...props} variant="sheet" />
  )
}

/**
 * The same rule inside Trade (1.31.0; the web's `AutoinvestPanel`):
 * «Регулярно» beside «Ринок» on every token — the flow without its sheet, its
 * head or its close; the order's own tab leaves it. In the panel the schedule's
 * kind is «Розклад», as the tab already says «Регулярно».
 */
export function AutoinvestPanel(props: Omit<AutoinvestSheetProps, 'visible'>) {
  return (
    <AutoinvestFlow
      key={props.mode.kind === 'manage' ? props.mode.rule.id : 'compose'}
      {...props}
      visible
      variant="panel"
    />
  )
}

type Busy = null | 'saving' | 'pausing' | 'resuming' | 'deleting' | 'marking'

function AutoinvestFlow({
  mode,
  company,
  budget,
  onClose,
  onBuyNow,
  onChangeBudget,
  onMarketBuy,
  variant,
}: AutoinvestSheetProps & { variant: Variant }) {
  const router = useRouter()
  const copy = useCopy(AUTOINVEST_COPY)
  const locale = useLocale()
  const account = useAccount()
  const session = account.session
  const writes = useRuleWrites(session)
  const telegram = useTelegramChannel(session, true)
  const [made, setMade] = useState<AutoinvestRule | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  // A token of the venue's list (1.31.0): known by the rule's own asset once there is one, else by the page that opened it.
  const token = mode.kind === 'manage' ? isListedToken(mode.rule.asset) : company.token === true

  const close = () => {
    if (!busy) onClose()
  }
  // The channel is changed in the app's own preferences, under the sheet: the sheet steps aside first.
  const openChannels = () => {
    onClose()
    router.push('/monitoring/preferences')
  }
  const connected = telegram.data?.telegram.connected
  // Connected, the channel needs no line; unconnected, one quiet way to connect it.
  const channel =
    connected === false ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.connectTelegram}
        onPress={openChannels}
        hitSlop={6}
        className="flex-row items-center justify-center gap-1.5 py-1 active:opacity-70"
      >
        <Icon name="paper-plane-outline" size={14} color="muted" />
        <Txt variant="ui" tone="muted">
          {copy.connectTelegram}
        </Txt>
      </Pressable>
    ) : null

  let body: ReactNode
  if (made) {
    body = (
      <Done
        rule={made}
        company={company}
        token={token}
        budget={budget}
        copy={copy}
        locale={locale}
        channel={channel}
        onDone={onClose}
      />
    )
  } else if (mode.kind === 'manage') {
    body = (
      <Manage
        initial={mode.rule}
        token={token}
        variant={variant}
        budget={budget}
        copy={copy}
        locale={locale}
        channel={channel}
        busy={busy}
        setBusy={setBusy}
        writes={writes}
        onClose={onClose}
        onBuyNow={onBuyNow}
        onChangeBudget={onChangeBudget}
      />
    )
  } else {
    body = (
      <Compose
        company={company}
        token={token}
        variant={variant}
        onMarketBuy={onMarketBuy}
        initialAmount={mode.amountUsd}
        budget={budget}
        copy={copy}
        locale={locale}
        channel={channel}
        busy={busy}
        setBusy={setBusy}
        writes={writes}
        onMade={setMade}
        onChangeBudget={onChangeBudget}
      />
    )
  }

  if (variant === 'panel') return <View>{body}</View>
  return (
    <Sheet
      visible
      title={copy.title(company.name)}
      leading={<AssetIcon symbol={company.name} icon={company.icon} size={32} />}
      onClose={close}
      scroll
    >
      {body}
    </Sheet>
  )
}

/* ---- a new rule: «Регулярно», «Якщо впаде» or «З оплат», each purchase's sum, the month's budget as its own line → «Увімкнути» ---- */

const KINDS: readonly RuleKind[] = ['schedule', 'dip', 'payments']

function Compose({
  company,
  token,
  variant,
  onMarketBuy,
  initialAmount,
  budget,
  copy,
  locale,
  channel,
  busy,
  setBusy,
  writes,
  onMade,
  onChangeBudget,
}: {
  company: AutoinvestCompany
  token: boolean
  variant: Variant
  onMarketBuy?: () => void
  initialAmount: number | null
  budget: RuleBudget | null
  copy: AutoinvestCopy
  locale: Locale
  channel: ReactNode
  busy: Busy
  setBusy: (busy: Busy) => void
  writes: ReturnType<typeof useRuleWrites>
  onMade: (rule: AutoinvestRule) => void
  /** The budget's own line: its sheet over this one — the ceiling is never chosen beside the rule's sum. */
  onChangeBudget: () => void
}) {
  const { colors } = useTheme()
  const buyWords = useCopy(BUY_COPY)
  const account = useAccount()
  // «Перша купівля» is counted from now, not from when the sheet opened: a time an hour ahead stays honest while the person reads.
  const now = useNow(20_000)
  const [timeZone] = useState(() => deviceTimeZone())
  const [kind, setKind] = useState<RuleKind>('schedule')
  const [dropPct, setDropPct] = useState<number>(RULE_DIP_PRESETS_PCT[0])
  /* «З оплат»: the mode and its one figure — the round-up to $1 unless the person picks another, a
     default and never advice; the modes, the steps and the bounds as the server's capabilities state them. */
  const payBounds = usePaymentBounds()
  const [pickedMode, setPickedMode] = useState<RulePaymentMode>('roundup')
  const [pickedStep, setPickedStep] = useState<number | null>(null)
  const [fixedText, setFixedText] = useState(String(RULE_MIN_USD))
  const [pickedPercent, setPickedPercent] = useState<number | null>(null)
  const paying = kind === 'payments'
  const payMode = payBounds.modes.includes(pickedMode) ? pickedMode : (payBounds.modes[0] ?? 'roundup')
  const roundTo =
    pickedStep !== null && payBounds.roundToUsd.includes(pickedStep) ? pickedStep : (payBounds.roundToUsd[0] ?? 1)
  const percent =
    pickedPercent !== null && percentChoices(payBounds).includes(pickedPercent)
      ? pickedPercent
      : defaultPercent(payBounds)
  const fixed = fixedOfInput(fixedText, locale, payBounds)
  const terms = termsOf(payMode, { roundToUsd: roundTo, fixedUsd: fixed, percent })
  // What the rule would set aside from an example — the same arithmetic the server's tick counts with.
  const example = exampleOf(terms)
  // «Щотижня · $10» unless a receipt's «Купувати щотижня» brought its own sum — a default, never advice (chosen 2026-09-25).
  const [amountText, setAmountText] = useState(() =>
    String(initialAmount !== null ? Math.max(RULE_MIN_USD, Math.round(initialAmount * 100) / 100) : RULE_DEFAULT_USD),
  )
  const [schedule, setSchedule] = useState<RuleSchedule>(() => defaultSchedule(Date.now(), deviceTimeZone()))
  const [timeText, setTimeText] = useState(schedule.time)
  // The month's ceiling as the rules' read says it — set, changed or removed only in the budget's own sheet.
  const cap = budget?.capUsd ?? null
  const [failure, setFailure] = useState<string | null>(null)
  /* «Умова ціни»: the server's default unless the person picks another limit or «Без умови» (null) —
     offered only where the company has a reference, read with the company's row; nothing is turned on before it is known. */
  const bounds = useConditionBounds()
  const condition = useConditionFacts(company.mint, !token)
  /* A token (1.31.0): what a rule on it would stand on, read from the server — the floor, the facts of a meme's risk and
     its price now, the point a fall counts from and a condition stands against («ціна при ввімкненні»). */
  const tokenRead = useRuleAsset(company.mint, token)
  const tokenFacts = tokenRead.read
  const tokenPrice = tokenFacts?.priceUsd ?? null
  const tokenBlock = token ? tokenBlockOf(tokenRead.status, tokenFacts) : null
  const reference: RulePriceReference | null = token ? (tokenPrice !== null ? 'enabled' : null) : condition.reference
  const referencePending = token
    ? tokenRead.status === 'idle' || tokenRead.status === 'reading'
    : condition.status === 'reading'
  const [pickedLimit, setPickedLimit] = useState<number | null | undefined>(undefined)
  // A token opens on «Без умови»: its reference is a fixed point, so a limit is a ceiling the person sets on purpose.
  const limitPct =
    reference === null ? null : pickedLimit === undefined ? (token ? null : bounds.defaultPct) : pickedLimit
  // How the price stands against the reference now, at the limit chosen — the judgement the rule's tick makes.
  const conditionNow =
    !token && reference !== null && limitPct !== null
      ? checkPriceCondition(limitPct, condition.facts, now, bounds.maxAgeMinutes)
      : null
  const limits: readonly Choice<string>[] = conditionChoices(bounds).map((pct) => ({
    value: pct === null ? 'none' : String(pct),
    label: pct === null ? copy.noCondition : pctWord(pct, locale),
  }))

  const typed = parseDollars(amountText, locale)
  const amount = ruleAmountOf(amountText, locale)
  /* Whether the rule's sum routes into the company now, and if not, the company's own minimum from the same quote — asked before the rule is turned on, never after. A rule's purchase is paid in USDC. A «З оплат»
     rule's purchases are its reminders' sums, from its minimum up: a dollar must route, or the company's own minimum is
     the least its reminder opens at. */
  const routedSum = paying ? RULE_MIN_USD : amount
  const route = useQuoteRoute(USDC_MINT, company.mint, routedSum, true)
  const noRoute = routedSum !== null && route === 'no-route'
  const routeMinimum = useRouteMinimum(USDC_MINT, company.mint, routedSum, noRoute)
  const minimumLine =
    paying || !noRoute || amount === null
      ? null
      : routeMinimum.state === 'found'
        ? buyWords.routeMinimum(dollarsText(amount, locale), company.name, dollarsText(routeMinimum.minimumUsd, locale))
        : routeMinimum.state === 'finding'
          ? buyWords.findingMinimum
          : buyWords.unavailable
  // The least a «З оплат» reminder opens at: a dollar, or the company's own minimum once found; unknown while it is sought.
  const thresholdUsd = !noRoute ? RULE_MIN_USD : routeMinimum.state === 'found' ? routeMinimum.minimumUsd : null
  const remindFromLine =
    thresholdUsd === null
      ? routeMinimum.state === 'none'
        ? buyWords.unavailable
        : buyWords.findingMinimum
      : thresholdUsd > RULE_MIN_USD
        ? `${copy.remindFrom} ${dollarsText(thresholdUsd, locale)} · ${buyWords.routeMinimum(dollarsText(RULE_MIN_USD, locale), company.name, dollarsText(thresholdUsd, locale))}`
        : `${copy.remindFrom} ${dollarsText(thresholdUsd, locale)}`
  // A sum typed for «$ з оплати» outside its bounds says the bounds in place of the example.
  const exampleLine =
    payMode === 'fixed' && fixed === null
      ? copy.fixedBounds(dollarsText(payBounds.fixedMinUsd, locale), dollarsText(payBounds.fixedMaxUsd, locale))
      : setAsideExample(example.direction, example.amountUsd, example.addUsd, company.name, locale)
  const typedTime = timeOfInput(timeText)
  const first = kind === 'schedule' ? firstDue(schedule, now) : null
  // A fall counts from the price now: the token's own from the server's read, the company's from its page.
  const preview = kind === 'dip' ? dipPreview(token ? tokenPrice : company.priceUsd, dropPct) : null
  // Under the ceiling shown: a purchase the month's rest does not cover is never promised a first day — for «З оплат», its least.
  const fits = paying
    ? thresholdUsd === null || fitsCeiling(thresholdUsd, cap, budget)
    : amount === null || fitsCeiling(amount, cap, budget)
  const saving = busy === 'saving'
  const kinds: readonly Choice<RuleKind>[] = KINDS.map((value) => ({
    value,
    // Inside Trade the tab already says «Регулярно»: the schedule's segment names what it is (the web's own).
    label:
      value === 'dip'
        ? copy.ifFalls
        : value === 'payments'
          ? copy.fromPayments
          : variant === 'panel'
            ? copy.scheduleShort
            : copy.regularly,
  }))
  const modes: readonly Choice<RulePaymentMode>[] = payBounds.modes.map((value) => ({
    value,
    label: value === 'roundup' ? copy.modeRoundup : value === 'fixed' ? copy.modeFixed : copy.modePercent,
  }))
  const steps: readonly Choice<string>[] = payBounds.roundToUsd.map((usd) => ({
    value: String(usd),
    label: dollarsText(usd, locale),
  }))
  const percents: readonly Choice<string>[] = percentChoices(payBounds).map((pct) => ({
    value: String(pct),
    label: pctWord(pct, locale),
  }))
  const cadences: readonly Choice<RuleCadence>[] = RULE_CADENCES.map((cadence) => ({
    value: cadence,
    label: cadenceWord(cadence, locale),
  }))
  const weekdays: readonly Choice<string>[] = WEEKDAY_SHORT[locale].map((day, index) => ({
    value: String(index + 1),
    label: day,
  }))
  const falls: readonly Choice<string>[] = RULE_DIP_PRESETS_PCT.map((pct) => ({
    value: String(pct),
    label: copy.fallBy(pctWord(pct, locale)),
  }))

  const pickTime = (text: string) => {
    setTimeText(text)
    const time = timeOfInput(text)
    if (time) setSchedule((current) => ({ ...current, time }))
  }

  /* The rule as the server takes it, or null while something it needs is missing. */
  const requestNow = (): RuleCreateRequest | null => {
    if (paying) {
      if (thresholdUsd === null || (payMode === 'fixed' && fixed === null)) return null
      return paymentsRequest({ mint: company.mint, minimumUsd: thresholdUsd, terms, timeZone, locale, limitPct })
    }
    if (amount === null) return null
    if (kind === 'dip')
      return dipRequest({ mint: company.mint, amountUsd: amount, dropPct, timeZone, locale, limitPct })
    if (!typedTime) return null
    return scheduleRequest({
      mint: company.mint,
      amountUsd: amount,
      schedule: { ...schedule, time: typedTime },
      locale,
      limitPct,
    })
  }

  const enable = async () => {
    const request = requestNow()
    if (!request) return
    Keyboard.dismiss()
    setFailure(null)
    setBusy('saving')
    const result = await writes.create(request)
    setBusy(null)
    if (result.ok && result.rule) {
      onMade(result.rule)
      return
    }
    // A token's refusal in its own words — under the floor, or its figures unread (1.31.0); the rule's words otherwise.
    const tokenFailure = token && !result.ok ? tokenWriteFailure(result.code, 'create') : null
    setFailure(
      result.ok
        ? copy.failed
        : tokenFailure
          ? copy[tokenFailure]
          : writeFailureWords(result.code, copy, { write: 'create', dip: kind === 'dip' }),
    )
  }

  /* The one button, by what stands in the way: the wallet, the sum, the time or the price, the session. */
  let button: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }
  if (!account.address)
    button = { title: buyWords.connect, onPress: () => void account.connect(), loading: account.busy === 'connect' }
  // A token's standing is read first: nothing is turned on before the floor and its facts are known.
  else if (token && referencePending) button = { title: copy.reading, disabled: true }
  // «З оплат»: a sum per payment within its bounds, and the least its reminders open at routing into the company.
  else if (paying && payMode === 'fixed' && fixed === null) button = { title: copy.turnOn, disabled: true }
  else if (paying && thresholdUsd === null)
    button = {
      title: routeMinimum.state === 'none' ? buyWords.unavailable : buyWords.findingMinimum,
      disabled: true,
    }
  else if (paying) {
    if (!account.session)
      button = { title: buyWords.signIn, onPress: () => void account.signIn(), loading: account.signingIn }
    else if (saving) button = { title: copy.turningOn, loading: true }
    else if (referencePending) button = { title: copy.reading, disabled: true }
    else button = { title: copy.turnOn, onPress: () => void enable() }
  } else if (typed !== null && typed < RULE_MIN_USD) button = { title: buyWords.minimum, disabled: true }
  else if (amount === null || (kind === 'schedule' ? !typedTime || first === null : preview === null))
    button = { title: copy.turnOn, disabled: true }
  // A sum with no route would only ever remind of a purchase that cannot happen: the one action puts the company's own minimum in.
  else if (noRoute && routeMinimum.state === 'found') {
    const least = routeMinimum.minimumUsd
    button = { title: buyWords.setMinimum(dollarsText(least, locale)), onPress: () => setAmountText(String(least)) }
  } else if (noRoute) button = { title: copy.turnOn, disabled: true }
  else if (!account.session)
    button = { title: buyWords.signIn, onPress: () => void account.signIn(), loading: account.signingIn }
  else if (saving) button = { title: copy.turningOn, loading: true }
  // Whether the company has a reference to offer the condition against is read first — never turned on past it unknown.
  else if (referencePending) button = { title: copy.reading, disabled: true }
  else button = { title: copy.turnOn, onPress: () => void enable() }

  const signInLine = account.signInFailure
    ? account.signInFailure.kind === 'network'
      ? buyWords.signInOffline
      : account.signInFailure.kind === 'outdated'
        ? buyWords.signInOutdated
        : buyWords.signInFailed
    : null

  /* A token no rule can name now — under the floor, flagged, or unread: what it stands on and why, and nothing to fill
     in for a rule that cannot be turned on; beside the reason, the next step where there is one — the market purchase. */
  if (tokenBlock) {
    return (
      <View className="gap-4 pb-2">
        <TokenStanding read={tokenFacts} copy={copy} locale={locale} compact={variant === 'panel'} />
        <BlockNote block={tokenBlock} copy={copy} />
        {tokenBlock === 'unreadable' ? (
          <Button
            title={copy.tryAgain}
            variant="secondary"
            size="sm"
            loading={tokenRead.refetching}
            onPress={tokenRead.refetch}
            className="self-start"
          />
        ) : null}
        {onMarketBuy ? <Button title={copy.buyAtMarket} variant="secondary" size="lg" onPress={onMarketBuy} /> : null}
      </View>
    )
  }

  return (
    <View className="gap-4 pb-2">
      {/* A token's standing before anything else: for a meme or a new token the facts of its risk, then the floor. */}
      {token && referencePending ? (
        // Its place held while the server reads it: the facts land where they stand, the form never jumps under them.
        <View className="gap-2" accessibilityRole="progressbar" accessibilityLabel={copy.reading}>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-20 rounded-sm" />
        </View>
      ) : token ? (
        <TokenStanding read={tokenFacts} copy={copy} locale={locale} compact={variant === 'panel'} />
      ) : null}
      {company.preIpo && company.truth ? (
        <View className="flex-row items-start gap-2">
          <Icon name="warning-outline" size={16} color="warningInk" style={{ marginTop: 1 }} />
          <Txt variant="ui" tone="warning" className="flex-1">
            {company.truth}
          </Txt>
        </View>
      ) : null}
      {company.preIpo && company.eventLine ? <EventLine line={company.eventLine} /> : null}

      <Segments label={copy.ruleKind} choices={kinds} value={kind} onChange={setKind} disabled={saving} />

      {paying ? (
        /* «З оплат»: what to set aside from the wallet's own USDC, an example on the arithmetic the tick
           counts with, the least a reminder opens at, and what counts — the rest behind «?». */
        <>
          <View className="gap-2">
            <Txt variant="labelSm" tone="faint" caps>
              {copy.whatToSetAside}
            </Txt>
            <Segments
              label={copy.whatToSetAside}
              choices={modes}
              value={payMode}
              onChange={setPickedMode}
              disabled={saving}
            />
          </View>
          {payMode === 'roundup' ? (
            <View className="gap-2">
              <Txt variant="labelSm" tone="faint" caps>
                {copy.roundUpTo}
              </Txt>
              <Segments
                label={copy.roundUpTo}
                choices={steps}
                value={String(roundTo)}
                onChange={(value) => setPickedStep(Number(value))}
                disabled={saving}
              />
            </View>
          ) : payMode === 'fixed' ? (
            <View className="gap-0.5">
              <Txt variant="labelSm" tone="faint" caps className="text-center" importantForAccessibility="no">
                {copy.fromEveryPayment}
              </Txt>
              <TextInput
                value={fixedText.length > 0 ? `$${fixedText}` : ''}
                onChangeText={(text) => setFixedText(text.replace(/[^\d.,]/g, '').slice(0, 8))}
                keyboardType="decimal-pad"
                placeholder="$0"
                placeholderTextColor={colors.fgMuted}
                selectionColor={colors.brand}
                cursorColor={colors.brand}
                accessibilityLabel={copy.fromEveryPayment}
                editable={!saving}
                textAlign="center"
                className="text-fg"
                style={[type.display, { fontSize: 44, lineHeight: 52, paddingVertical: 4 }]}
              />
            </View>
          ) : (
            <View className="gap-2">
              <Txt variant="labelSm" tone="faint" caps>
                {copy.ofEveryIncoming}
              </Txt>
              <Segments
                label={copy.ofEveryIncoming}
                choices={percents}
                value={String(percent)}
                onChange={(value) => setPickedPercent(Number(value))}
                disabled={saving}
              />
            </View>
          )}
          <Txt
            variant="ui"
            tone={payMode === 'fixed' && fixed === null ? 'warning' : 'muted'}
            className="text-center"
            accessibilityLiveRegion="polite"
            tabular
          >
            {exampleLine}
          </Txt>
          <Txt
            variant="ui"
            tone={thresholdUsd === null && routeMinimum.state === 'none' ? 'warning' : 'faint'}
            className="text-center"
            accessibilityLiveRegion="polite"
            tabular
          >
            {remindFromLine}
          </Txt>
          <CountsLine text={payMode === 'percent' ? copy.incomingCount : copy.paymentsCount} help={copy.paymentsHelp} />
        </>
      ) : (
        <>
          {/* The rule's sum is each purchase — never the month's budget, which is its own line below. */}
          <View className="gap-0.5">
            <Txt variant="labelSm" tone="faint" caps className="text-center" importantForAccessibility="no">
              {copy.eachPurchase}
            </Txt>
            <TextInput
              value={amountText.length > 0 ? `$${amountText}` : ''}
              onChangeText={(text) => setAmountText(text.replace(/[^\d.,]/g, '').slice(0, 12))}
              keyboardType="decimal-pad"
              placeholder="$0"
              placeholderTextColor={colors.fgMuted}
              selectionColor={colors.brand}
              cursorColor={colors.brand}
              accessibilityLabel={copy.eachPurchase}
              editable={!saving}
              textAlign="center"
              className="text-fg"
              style={[type.display, { fontSize: 44, lineHeight: 52, paddingVertical: 4 }]}
            />
          </View>
          {/* No quick sums: a rule's sum is the person's own, typed (chosen 2026-09-25: «на авто — певну суму, довільну»). */}
          {minimumLine ? (
            <Txt variant="ui" tone="muted" className="text-center" accessibilityLiveRegion="polite" tabular>
              {minimumLine}
            </Txt>
          ) : null}
        </>
      )}

      {kind === 'schedule' ? (
        <>
          <View className="gap-2">
            <Txt variant="labelSm" tone="faint" caps>
              {copy.howOften}
            </Txt>
            <Segments
              label={copy.howOften}
              choices={cadences}
              value={schedule.cadence}
              onChange={(cadence) => setSchedule((current) => withCadence(current, cadence, now))}
              disabled={saving}
            />
          </View>

          <View className="gap-2">
            <Txt variant="labelSm" tone="faint" caps>
              {copy.when}
            </Txt>
            {schedule.cadence === 'weekly' ? (
              <Segments
                label={copy.when}
                choices={weekdays}
                value={String(schedule.weekday ?? '')}
                onChange={(value) => setSchedule((current) => ({ ...current, weekday: Number(value) }))}
                disabled={saving}
              />
            ) : null}
            <View className="flex-row items-start gap-3">
              {schedule.cadence === 'monthly' ? (
                <DayStepper
                  label={copy.dayOfMonth}
                  value={schedule.monthDay ?? 1}
                  earlier={copy.dayEarlier}
                  later={copy.dayLater}
                  disabled={saving}
                  onChange={(day) => setSchedule((current) => ({ ...current, monthDay: clampMonthDay(day) }))}
                />
              ) : null}
              <Field
                label={copy.timeOfDay}
                value={timeText}
                onChangeText={pickTime}
                onBlur={() => {
                  if (typedTime) setTimeText(typedTime)
                }}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                editable={!saving}
                placeholder={copy.timeHint}
                error={typedTime || timeText.length === 0 ? null : copy.timeFormat}
                className="flex-1"
              />
            </View>
          </View>

          <Txt variant="ui" tone="muted" className="text-center" accessibilityLiveRegion="polite" tabular>
            {first !== null && fits ? `${copy.firstPurchase}: ${dueWords(first, timeZone, locale)}` : ' '}
          </Txt>
        </>
      ) : kind === 'dip' ? (
        <>
          <View className="gap-2">
            <Txt variant="labelSm" tone="faint" caps>
              {copy.howFar}
            </Txt>
            <Segments
              label={copy.howFar}
              choices={falls}
              value={String(dropPct)}
              onChange={(value) => setDropPct(Number(value))}
              disabled={saving}
            />
          </View>
          <Txt
            variant="ui"
            tone={preview ? 'muted' : 'warning'}
            className="text-center"
            accessibilityLiveRegion="polite"
            tabular
          >
            {preview
              ? unbrokenParts(
                  `${copy.remindAt} ${priceWord(preview.triggerUsd, locale)} ${copy.orLower} · ${copy.priceNow} ${priceWord(preview.priceUsd, locale)}`,
                )
              : copy.priceUnknownNow}
          </Txt>
        </>
      ) : null}

      {/* «Умова ціни»: the most the price may stand above the company's reference, and how it stands now. */}
      {reference !== null ? (
        <View className="gap-2">
          <Txt variant="labelSm" tone="faint" caps>
            {copy.priceCondition}
          </Txt>
          <Segments
            label={copy.priceCondition}
            choices={limits}
            value={limitPct === null ? 'none' : String(limitPct)}
            onChange={(value) => setPickedLimit(value === 'none' ? null : Number(value))}
            disabled={saving}
          />
          {limitPct !== null ? (
            <Txt variant="ui" tone="muted" className="text-center">
              {keptTail(conditionLine(limitPct, reference, locale))}
            </Txt>
          ) : null}
          {token && limitPct !== null && tokenPrice !== null ? (
            // A token's reference is the price now, kept when the rule is turned on: the line says the ceiling it makes.
            <Txt variant="ui" tone="faint" className="text-center" accessibilityLiveRegion="polite" tabular>
              {keptTail(anchorNowLine(tokenPrice, limitPct, locale))}
            </Txt>
          ) : conditionNow && conditionNow.verdict !== 'met' ? (
            // Said only when the price stands outside the condition or its data is old — within it, the line above is
            // enough. Its last word never alone on a line on the Seeker's width («… чекатиме на них.»).
            <Txt variant="ui" tone="faint" className="text-center" accessibilityLiveRegion="polite" tabular>
              {keptTail(conditionNowLine(conditionNow, locale))}
            </Txt>
          ) : null}
        </View>
      ) : null}

      {/* The month's budget for every rule — its own line, its own sheet over this one. */}
      {budget ? (
        <View className="gap-2">
          <BudgetRow budget={budget} copy={copy} locale={locale} onEdit={onChangeBudget} />
          {fits ? null : (
            // Written all the same — the person's own choice — and said before it is: the rule stands until the 1st.
            <Txt variant="ui" tone="warning" accessibilityLiveRegion="polite">
              {`${copy.budgetBlocks} ${copy.rulesStand}.`}
            </Txt>
          )}
        </View>
      ) : null}

      {channel}

      {failure ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {failure}
        </Txt>
      ) : signInLine ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {signInLine}
        </Txt>
      ) : null}

      {/* How a rule buys — Ryntra reminds, the wallet signs, the money stays in it — once, one tap deep beside the action. */}
      <Button
        title={button.title}
        size="lg"
        onPress={button.onPress}
        disabled={button.disabled}
        loading={button.loading}
      />
      {account.address && !account.session ? (
        <SignInHelp />
      ) : (
        <HelpDot title={copy.autoinvest} body={copy.promise} label={copy.howItWorks} />
      )}
    </View>
  )
}

/**
 * A token's standing, before the rule (1.31.0, the web's `RiskFacts` and
 * floor line): for a meme or a new token the facts of its risk as the venue
 * states them — a caution where its own figure is one to weigh, never a
 * verdict — then one short line on the floor of a recurring buy: «Підходить
 * для регулярної купівлі», or why it does not, the figures and the terms behind «?». Inside Trade (`compact`) what the token's page already says
 * — its age, liquidity and holders — is left out. Nothing while it is read.
 */
export function TokenStanding({
  read,
  copy,
  locale,
  compact,
}: {
  read: RuleAssetRead | null
  copy: AutoinvestCopy
  locale: Locale
  compact: boolean
}) {
  if (!read) return null
  const rows = riskRows(read, copy, locale, compact)
  const floor = read.floor
  if (!rows && !floor) return null
  // One short line: a met floor in plain words, a floor not met as its reason. The figures and the floor's terms sit
  // behind «?» — under the full facts the token's liquidity and age are said once, so «?» then holds the terms alone.
  const met = floor?.verdict === 'met'
  const floorText = floor ? (met ? copy.floorMet : floorStanding(floor, locale)) : ''
  const floorDetail = floor
    ? [...(met && !(rows && !compact) ? [floorStanding(floor, locale)] : []), copy.floorWhat(floorTerms(locale))]
    : []
  return (
    <View className="gap-3">
      {rows ? (
        <View className="gap-2" accessibilityLabel={copy.riskFacts}>
          <View className="flex-row items-center gap-1">
            <Txt variant="labelSm" tone="faint" caps>
              {copy.riskFacts}
            </Txt>
            <HelpDot title={copy.riskFacts} body={copy.riskSource} />
          </View>
          {/* Two facts a row, each its label over its figure — the web's grid, never a long column of lines. */}
          <View className="flex-row flex-wrap rounded-sm border border-line bg-surface px-4 py-1.5">
            {rows.map((row) => (
              <View
                key={row.key}
                accessible
                accessibilityLabel={`${row.label}: ${row.value}`}
                className="gap-0.5 py-1.5 pr-2"
                style={{ width: '50%' }}
              >
                <Txt variant="labelSm" tone="faint" numberOfLines={1}>
                  {row.label}
                </Txt>
                <Txt variant="ui" tone={row.caution ? 'warning' : 'fg'} tabular numberOfLines={1}>
                  {row.value}
                </Txt>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {floor ? (
        <View className="flex-row items-center gap-1">
          <Txt variant="ui" tone={met ? 'muted' : 'warning'} tabular className="shrink">
            {floorText}
          </Txt>
          <HelpDot title={copy.floorTitle} body={floorDetail} />
        </View>
      ) : null}
    </View>
  )
}

/** Why no rule can be turned on for a token now, in one line and one tone with the floor's line above it. */
export function BlockNote({ block, copy }: { block: TokenBlock; copy: AutoinvestCopy }) {
  const text =
    block === 'noRule' ? copy.noRuleOnToken : block === 'flagged' ? copy.flaggedSuspicious : copy.tokenUnreadable
  return (
    <View className="flex-row items-start gap-2" accessibilityRole="text" accessibilityLiveRegion="polite">
      <Icon name="information-circle-outline" size={18} color="warningInk" style={{ marginTop: 1 }} />
      <Txt variant="ui" tone="warning" className="flex-1">
        {text}
      </Txt>
    </View>
  )
}

/**
 * One choice among a few, as equal segments of one row — how often, and the
 * weekday. Quiet like the sums (the sheet's one orange action is its button);
 * a word that would not fit its segment is set a size smaller, never cut.
 */
function Segments<T extends string>({
  label,
  choices,
  value,
  onChange,
  disabled,
}: {
  label: string
  choices: readonly Choice<T>[]
  value: T
  onChange: (value: T) => void
  disabled: boolean
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row gap-1 rounded-pill border border-line bg-surface p-1"
    >
      {choices.map((choice) => {
        const selected = choice.value === value
        return (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(choice.value)}
            className={
              selected
                ? 'h-9 flex-1 items-center justify-center rounded-pill border border-line-strong bg-hover px-1'
                : 'h-9 flex-1 items-center justify-center rounded-pill border border-transparent px-1 active:bg-hover'
            }
          >
            <Txt
              variant="ui"
              tone={selected ? 'fg' : 'muted'}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {choice.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/** What a «З оплат» rule counts — one or two short sentences — and the web's «?» beside them: the rest one tap deep. */
function CountsLine({ text, help }: { text: string; help: AutoinvestCopy['paymentsHelp'] }) {
  const words = useCopy(COMPANY_COPY)
  const copy = useCopy(AUTOINVEST_COPY)
  const [open, setOpen] = useState(false)
  return (
    // At rest a quiet door — «Що рахується ⓘ»; what counts and what never does is one tap deeper.
    <View className="items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${copy.whatCounts} · ${words.whatIsThis}`}
        accessibilityHint={text}
        onPress={() => setOpen(true)}
        hitSlop={10}
        className="min-h-8 flex-row items-center gap-1.5 rounded-pill px-2 active:bg-hover"
      >
        <Txt variant="ui" tone="muted">
          {copy.whatCounts}
        </Txt>
        <Icon name="help-circle-outline" size={16} color="muted" />
      </Pressable>
      <Sheet visible={open} title={help.title} onClose={() => setOpen(false)} scroll>
        <View className="gap-4 pb-2">
          <Txt variant="body">{help.what}</Txt>
          <View className="gap-1">
            <Txt variant="label" tone="faint" caps>
              {words.example}
            </Txt>
            {help.example.map((line) => (
              <Txt key={line} variant="body">
                {line}
              </Txt>
            ))}
          </View>
          <View className="gap-1">
            <Txt variant="label" tone="warning" caps>
              {words.important}
            </Txt>
            <Txt variant="body">{help.important}</Txt>
          </View>
        </View>
      </Sheet>
    </View>
  )
}

/** The day of a monthly rule, one step at a time — the 31st falls on a shorter month's last day. */
function DayStepper({
  label,
  value,
  earlier,
  later,
  disabled,
  onChange,
}: {
  label: string
  value: number
  earlier: string
  later: string
  disabled: boolean
  onChange: (day: number) => void
}) {
  const step = (by: number) => onChange(value + by)
  return (
    <View className="gap-1.5">
      <Txt variant="labelSm" tone="faint" caps>
        {label}
      </Txt>
      <View className="h-11 flex-row items-center rounded-btn border border-line bg-surface">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={earlier}
          disabled={disabled || value <= 1}
          onPress={() => step(-1)}
          className="h-11 w-11 items-center justify-center active:bg-hover"
        >
          <Icon name="remove" size={18} color={value <= 1 ? 'fgMuted' : 'fg'} />
        </Pressable>
        <Txt variant="data" className="text-center" style={{ minWidth: 28 }} accessibilityLiveRegion="polite">
          {String(value)}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={later}
          disabled={disabled || value >= 31}
          onPress={() => step(1)}
          className="h-11 w-11 items-center justify-center active:bg-hover"
        >
          <Icon name="add" size={18} color={value >= 31 ? 'fgMuted' : 'fg'} />
        </Pressable>
      </View>
    </View>
  )
}

/* ---- the rule is on ---- */

function Done({
  rule,
  company,
  token,
  budget,
  copy,
  locale,
  channel,
  onDone,
}: {
  rule: AutoinvestRule
  company: AutoinvestCompany
  token: boolean
  budget: RuleBudget | null
  copy: AutoinvestCopy
  locale: Locale
  channel: ReactNode
  onDone: () => void
}) {
  // The month's budget as read after the rule was written: a rule it does not cover stands until the 1st — never a first day.
  const held = heldByBudget(rule, budget)
  const next = rule.nextDueAt ? dueWords(Date.parse(rule.nextDueAt), zoneOfRule(rule), locale) : null
  const condition = useConditionFacts(company.mint, rule.priceCondition !== null && !token)
  return (
    <View className="gap-4 pb-2">
      <View className="items-center gap-2 py-2" accessibilityRole="summary">
        <Icon name="checkmark-circle" size={56} color="successInk" />
        <Txt variant="title" className="text-center">
          {copy.on}
        </Txt>
        <Txt variant="ui" tone="muted" className="text-center">
          {ruleSentence(rule, company.name, locale)}
        </Txt>
        {held ? (
          <Txt variant="ui" tone="warning" className="text-center">
            {copy.heldShort}
          </Txt>
        ) : next ? (
          <Txt variant="ui" tone="faint" className="text-center" tabular>
            {`${copy.firstPurchase}: ${next}`}
          </Txt>
        ) : null}
        {rule.dip ? (
          // The line as the server drew it from the price it read when it wrote the rule.
          <Txt variant="ui" tone="faint" className="text-center" tabular>
            {`${copy.remindAt} ${priceWord(rule.dip.triggerUsd, locale)} ${copy.orLower}`}
          </Txt>
        ) : null}
        {rule.payments ? (
          // The least its reminder opens at, and the instant it counts from — as the server wrote the rule.
          <Txt variant="ui" tone="faint" className="text-center" tabular>
            {wholeParts(
              `${copy.remindFrom} ${dollarsText(rule.amountUsd, locale)} · ${copy.countingSince} ${dueWords(Date.parse(rule.payments.since), zoneOfRule(rule), locale)}`,
            )}
          </Txt>
        ) : null}
        {rule.priceCondition ? (
          <Txt variant="ui" tone="faint" className="text-center" tabular>
            {`${copy.priceCondition}: ${conditionFact(rule.priceCondition, condition.reference, locale)}`}
          </Txt>
        ) : null}
      </View>
      {channel}
      <Button title={copy.done} size="lg" onPress={onDone} />
    </View>
  )
}

/**
 * A rule's condition as a short fact — «не дорожче за оцінку PreStocks більш ніж на 5 %» once whose figure is known, the
 * limit alone until then; on a token (1.31.0) the price it was turned on at and the ceiling it makes — «$150,00 · купує
 * до $157,50».
 */
function conditionFact(
  condition: RulePriceConditionState,
  reference: RulePriceReference | null,
  locale: Locale,
): string {
  if (typeof condition.referenceUsd === 'number')
    return anchorStandingLine(condition.referenceUsd, condition.limitPct, locale)
  return reference ? conditionShort(condition.limitPct, reference, locale) : limitWords(condition.limitPct, locale)
}

/* ---- a rule the wallet has ---- */

function Manage({
  initial,
  token,
  variant,
  budget,
  copy,
  locale,
  channel,
  busy,
  setBusy,
  writes,
  onClose,
  onBuyNow,
  onChangeBudget,
}: {
  initial: AutoinvestRule
  token: boolean
  variant: Variant
  budget: RuleBudget | null
  copy: AutoinvestCopy
  locale: Locale
  channel: ReactNode
  busy: Busy
  setBusy: (busy: Busy) => void
  writes: ReturnType<typeof useRuleWrites>
  onClose: () => void
  onBuyNow: (rule: AutoinvestRule, occurrence: RuleOccurrence) => void
  onChangeBudget: () => void
}) {
  const now = useNow(30_000)
  /* The rule as the wallet holds it now: the list the sheet was opened from, read again every minute — a gathered
     payment shows while the sheet is open — or the answer of the last write here, whichever is newer. */
  const [written, setWritten] = useState<AutoinvestRule | null>(null)
  const rule = written && Date.parse(written.updatedAt) >= Date.parse(initial.updatedAt) ? written : initial
  const [confirmDelete, setConfirmDelete] = useState(false)
  // «Мій рахунок» asked once more before it is written: the event whose other side is being named the person's own.
  const [asking, setAsking] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const paused = rule.status === 'paused'
  const zone = zoneOfRule(rule, deviceTimeZone())
  const face = ruleFace(rule, budget, now)
  const due = face.kind === 'due' ? openOccurrence(rule, now) : null
  const held = face.kind === 'held'
  // A purchase the price condition holds back (1.18.0): why, and until when the rule judges it again — nothing offered.
  const deferred = face.kind === 'deferred' ? face.occurrence : null
  const last = lastSettled(rule)
  // Whose figure the rule's condition is set against: the company's row, else the rule's own last judgement; a token's
  // is the price it was turned on at (1.31.0), which the rule itself carries.
  const condition = useConditionFacts(rule.asset.mint, rule.priceCondition !== null && !token)
  const reference = token
    ? 'enabled'
    : (condition.reference ?? rule.occurrences.find((occurrence) => occurrence.condition)?.condition?.reference ?? null)
  // A token's purchase held back by its floor says so first: a thin pool is the reason whatever the price says.
  const floor = floorHeld(deferred)
  const when = (iso: string) =>
    rule.dip ? dayWords(Date.parse(iso), zone, locale) : dueWords(Date.parse(iso), zone, locale)

  const change = async (kind: Exclude<Busy, null | 'saving'>, run: () => Promise<RuleWrite>, after?: () => void) => {
    setFailure(null)
    setBusy(kind)
    const result = await run()
    setBusy(null)
    if (!result.ok) {
      // A token turned on again stands on the floor again, and its figures must be read (1.31.0): said in its words.
      const tokenFailure = token ? tokenWriteFailure(result.code, 'change') : null
      // Turning a fall's rule on again counts from the price then: a price the server could not read is said as such.
      setFailure(
        tokenFailure
          ? copy[tokenFailure]
          : writeFailureWords(result.code, copy, { write: 'change', dip: rule.dip !== null }),
      )
      return
    }
    if (kind === 'deleting') {
      onClose()
      return
    }
    if (result.rule) setWritten(result.rule)
    after?.()
  }

  const payments = rule.payments
  const rows: { key: string; label: string; value: string; sub?: string | null; warning?: boolean }[] = []
  if (payments) {
    // «З оплат» (1.19.0): what it sets aside, and the instant it counts from — a pause counts nothing.
    rows.push({ key: 'what', label: copy.whatToSetAside, value: paymentsLine(payments, locale) })
    rows.push({
      key: 'since',
      label: paused ? copy.onPause : copy.countingSince,
      value: paused ? DASH : dueWords(Date.parse(payments.since), zone, locale),
    })
  } else if (rule.dip) {
    rows.push({
      key: 'point',
      label: copy.referencePoint,
      value: priceWord(rule.dip.anchorUsd, locale),
      sub: `${rule.dip.anchorFrom === 'purchase' ? copy.fromPurchase : copy.fromEnabled} · ${dayWords(Date.parse(rule.dip.anchorAt), zone, locale)}`,
    })
    rows.push({
      key: 'trigger',
      label: paused ? copy.onPause : copy.remindAt,
      value: paused ? DASH : priceWord(rule.dip.triggerUsd, locale),
      sub: paused ? null : copy.orLower,
    })
  } else {
    rows.push({
      key: 'next',
      label: paused ? copy.onPause : copy.nextPurchase,
      value: paused || !rule.nextDueAt ? DASH : dueWords(Date.parse(rule.nextDueAt), zone, locale),
    })
  }
  if (rule.priceCondition)
    rows.push({
      key: 'condition',
      // A token's condition stands against the price it was turned on at — named so, with the ceiling it makes.
      label: typeof rule.priceCondition.referenceUsd === 'number' ? copy.priceWhenOn : copy.priceCondition,
      value: conditionFact(rule.priceCondition, reference, locale),
    })
  // The reminder's own sum (1.19.0): what a «З оплат» rule gathered; the rule's sum for the other kinds.
  if (due) rows.push({ key: 'due', label: copy.timeToBuy, value: dollarsText(purchaseSumUsd(rule, due), locale) })
  else if (deferred && floor)
    rows.push({
      key: 'deferred',
      label: copy.purchaseDeferred,
      value: keptTail(floorLine(floor, '', locale)),
      sub: `${copy.checksAgainUntil} ${unbroken(dueWords(Date.parse(deferred.openUntil), zone, locale))}`,
      warning: true,
    })
  else if (deferred)
    rows.push({
      key: 'deferred',
      label: copy.purchaseDeferred,
      value: deferred.condition
        ? unbrokenTail(deferralLine(deferred.condition, rule.name, now, zone, locale))
        : copy.ruleChecksAgain,
      sub: `${copy.checksAgainUntil} ${unbroken(dueWords(Date.parse(deferred.openUntil), zone, locale))}`,
      warning: true,
    })
  else if (held) rows.push({ key: 'held', label: copy.budgetSpent, value: copy.rulesStand })
  else if (last)
    rows.push({
      key: 'last',
      label:
        last.state === 'bought'
          ? copy.lastBought
          : last.state === 'pending'
            ? copy.lastPending
            : last.state === 'held'
              ? copy.budgetSpent
              : copy.lastMissed,
      value: when(last.dueAt),
      sub: last.state === 'bought' && last.spentUsd !== null ? dollarsText(last.spentUsd, locale) : null,
    })

  return (
    <View className="gap-4 pb-2">
      <View className="items-center gap-1 py-1">
        {/* A «З оплат» rule's figure is what it has gathered; the least its reminder opens at is the line under it. */}
        <Txt variant="display" tabular>
          {dollarsText(payments ? payments.gatheredUsd : rule.amountUsd, locale)}
        </Txt>
        <Txt variant="ui" tone="muted" tabular>
          {payments
            ? `${copy.gathered} · ${copy.remindFrom.toLowerCase()} ${dollarsText(rule.amountUsd, locale)}`
            : ruleWhenLine(rule, locale)}
        </Txt>
      </View>

      <View className="rounded-sm border border-line bg-surface">
        {rows.map((row, index) => (
          <View
            key={row.key}
            className={index === 0 ? 'flex-row gap-3 px-4 py-3' : 'flex-row gap-3 border-t border-line px-4 py-3'}
          >
            <Txt variant="ui" tone={row.warning ? 'warning' : 'faint'} style={{ width: 128 }}>
              {row.label}
            </Txt>
            <View className="flex-1 gap-0.5">
              <Txt variant="ui" tabular>
                {row.value}
              </Txt>
              {row.sub ? (
                <Txt variant="ui" tone="faint" tabular>
                  {row.sub}
                </Txt>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {payments ? (
        <PaymentEvents
          payments={payments}
          zone={zone}
          copy={copy}
          locale={locale}
          asking={asking}
          busy={busy !== null}
          marking={busy === 'marking'}
          onAsk={setAsking}
          onConfirm={(signature) =>
            void change(
              'marking',
              () => writes.markOwn(rule.id, signature),
              () => setAsking(null),
            )
          }
        />
      ) : null}
      {channel}
      {failure ? (
        <Txt variant="ui" tone="danger" className="text-center">
          {failure}
        </Txt>
      ) : null}

      {confirmDelete ? (
        <View className="gap-2">
          <Txt variant="ui" className="text-center">
            {copy.deleteConfirm}
          </Txt>
          <Button
            title={busy === 'deleting' ? copy.deleting : copy.deleteYes}
            variant="secondary"
            size="lg"
            loading={busy === 'deleting'}
            onPress={() => void change('deleting', () => writes.remove(rule.id))}
          />
          <Button
            title={copy.cancel}
            variant="ghost"
            disabled={busy !== null}
            onPress={() => setConfirmDelete(false)}
          />
        </View>
      ) : (
        <View className="gap-2">
          {due ? (
            <Button
              title={copy.buyByRule(dollarsText(purchaseSumUsd(rule, due), locale))}
              size="lg"
              disabled={busy !== null}
              onPress={() => onBuyNow(rule, due)}
            />
          ) : held ? (
            // The month's budget holds it: the one action is the person's own ceiling, never a purchase.
            <Button title={copy.changeBudget} size="lg" disabled={busy !== null} onPress={onChangeBudget} />
          ) : paused ? (
            <Button
              title={busy === 'resuming' ? copy.turningOnAgain : copy.turnOnAgain}
              size="lg"
              loading={busy === 'resuming'}
              disabled={busy !== null}
              onPress={() => void change('resuming', () => writes.setStatus(rule.id, 'active'))}
            />
          ) : variant === 'panel' ? null : (
            // Inside Trade the rule simply stands: nothing to close, and the screen's one action stays the order's.
            <Button title={copy.done} size="lg" disabled={busy !== null} onPress={onClose} />
          )}
          {paused ? null : (
            <Button
              title={busy === 'pausing' ? copy.pausing : copy.pause}
              variant="secondary"
              size="lg"
              loading={busy === 'pausing'}
              disabled={busy !== null}
              onPress={() => void change('pausing', () => writes.setStatus(rule.id, 'paused'))}
            />
          )}
          <Button
            title={copy.deleteRule}
            variant="ghost"
            disabled={busy !== null}
            onPress={() => setConfirmDelete(true)}
          />
        </View>
      )}
    </View>
  )
}

/**
 * The newest counted events of a «З оплат» rule: the sum and
 * the rule's share on one line, the time — and «у нагадуванні» once a reminder
 * took it — under it, and where the transfer carried one, its Solana Pay label;
 * never the other side's name, which never reaches the phone. An event still
 * waiting can be named the person's own account — «Мій рахунок», asked once
 * more before it is written. When the wallet's last read did not prove itself,
 * one line says so. The web's own list.
 */
export function PaymentEvents({
  payments,
  zone,
  copy,
  locale,
  asking,
  busy,
  marking,
  onAsk,
  onConfirm,
}: {
  payments: RulePayments
  zone: string
  copy: AutoinvestCopy
  locale: Locale
  asking: string | null
  busy: boolean
  marking: boolean
  onAsk: (signature: string | null) => void
  onConfirm: (signature: string) => void
}) {
  const incoming = payments.mode === 'percent'
  const title = incoming ? copy.recentIncoming : copy.recentPayments
  const events = shownEvents(payments)
  const note = readNote(payments)
  return (
    <View className="gap-2" accessibilityLabel={title}>
      <Txt variant="labelSm" tone="faint" caps>
        {title}
      </Txt>
      {events.length === 0 ? (
        <Txt variant="ui" tone="muted">
          {incoming ? copy.noIncomingYet : copy.noPaymentsYet}
        </Txt>
      ) : (
        <View className="rounded-sm border border-line bg-surface">
          {events.map((event, index) => (
            <View
              key={event.signature}
              className={index === 0 ? 'gap-0.5 px-4 py-3' : 'gap-0.5 border-t border-line px-4 py-3'}
            >
              <View className="flex-row items-baseline justify-between gap-3">
                <Txt variant="ui" tabular className="shrink">
                  {`${event.direction === 'out' ? copy.paymentWord : copy.incomingWord} ${dollarsText(event.amountUsd, locale)}`}
                </Txt>
                {/* Taken by a reminder, the share is said quieter: it waits no more. */}
                <Txt variant="ui" tone={event.waiting ? 'fg' : 'faint'} tabular>
                  {`+${dollarsText(event.addUsd, locale)}`}
                </Txt>
              </View>
              <Txt variant="ui" tone="faint" tabular>
                {[unbroken(dueWords(Date.parse(event.at), zone, locale)), event.waiting ? null : copy.inReminder]
                  .filter(Boolean)
                  .join(' · ')}
              </Txt>
              {event.label ? (
                <Txt variant="ui" tone="faint">
                  {`${copy.solanaPayLabel}: ${event.label}`}
                </Txt>
              ) : null}
              {event.waiting ? (
                asking === event.signature ? (
                  <View className="gap-2 pt-1">
                    <Txt variant="ui">{copy.myAccountConfirm}</Txt>
                    <View className="flex-row flex-wrap items-center gap-3">
                      <Button
                        title={copy.myAccountYes}
                        variant="secondary"
                        loading={marking}
                        disabled={busy}
                        onPress={() => onConfirm(event.signature)}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={copy.cancel}
                        disabled={busy}
                        onPress={() => onAsk(null)}
                        hitSlop={8}
                        className="py-1 active:opacity-70"
                      >
                        <Txt variant="ui" tone="muted">
                          {copy.cancel}
                        </Txt>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copy.myAccount}
                    disabled={busy}
                    onPress={() => onAsk(event.signature)}
                    hitSlop={8}
                    className="min-h-8 justify-center self-start active:opacity-70"
                  >
                    <Txt variant="ui" tone="muted" style={{ textDecorationLine: 'underline' }}>
                      {copy.myAccount}
                    </Txt>
                  </Pressable>
                )
              ) : null}
            </View>
          ))}
        </View>
      )}
      {note ? (
        <Txt variant="ui" tone="warning">
          {note === 'partial' ? copy.readPartial : copy.readUnavailable}
        </Txt>
      ) : null}
    </View>
  )
}
