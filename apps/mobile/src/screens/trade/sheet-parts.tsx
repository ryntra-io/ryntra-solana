import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button } from '@/components/button'
import { HelpDot } from '@/components/help-dot'
import { Icon, type IconName } from '@/components/icon'
import { Txt } from '@/components/txt'
import { SHEET_COPY } from '@/features/trade/sheet-copy'
import { checkSummary, formatUnits, SOL_SWAP_RESERVE_LAMPORTS, type ReviewView } from '@/features/trade/trade-model'
import { useCopy, useLocale, useSharedCopy } from '@/lib/i18n'
import { page, useTheme } from '@/theme'
import { cn } from '@/utils/cn'
import { saidFigure } from '@/utils/format'

/**
 * The sheet's scroll, for a step that grows under the keyboard (ST-5): a line that appears above the step's own main
 * button — the limit's «Більше, ніж є в гаманці.» — pushes it under the keyboard unless the sheet is scrolled to its
 * end. `revealEnd` scrolls there once the new content is laid out.
 */
export const SheetScroll = createContext<Readonly<{ revealEnd: () => void }> | null>(null)

/** How long a request to show the sheet's end waits for the content or the sheet to change size. */
const REVEAL_WINDOW_MS = 600

/** The last look at the end, once the keyboard's own animation and the sheet's padding for it have settled. */
const REVEAL_SETTLE_MS = 300

/** How long the sheet takes to rise from the screen's foot. */
const RISE_MS = 220

/**
 * The one sheet of a purchase and a sale (NEW-LOOK §1): a layer over the
 * page it was opened from, its steps replacing one another inside it — never a
 * sheet over a sheet. «Назад» in its head steps back; «✕», the scrim and the
 * system back close it. While the wallet is asked, neither closes it.
 */
export function SheetFrame({
  title,
  onBack,
  onClose,
  locked = false,
  scroll = true,
  footer,
  children,
}: {
  title: string
  /** A step back inside the sheet; none on its first step. */
  onBack?: (() => void) | null
  onClose: () => void
  /** The wallet is being asked: the sheet holds still. */
  locked?: boolean
  /** False where the step is its own list (the asset picker): one scroll, never a list inside a scroll. */
  scroll?: boolean
  footer?: ReactNode
  children: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const shared = useSharedCopy()
  const { colors } = useTheme()
  const { height: screenHeight } = useWindowDimensions()
  /*
   * The sheet rises by a transform alone (C4e). A layout animation (`entering={SlideInDown}`) kept the frame of the
   * sheet's first layout pass on Android — shorter than the window it then had — so the footer was drawn below the
   * sheet's edge, where a press never reaches it: «Перевірити» seen and pressed fell through to the scrim and closed
   * the sheet (the operator's Seeker, 1.17.0 (19): «тільки кнопка «Перевірка», і воно перекидає»).
   */
  const rise = useSharedValue(1)
  useEffect(() => {
    rise.set(withTiming(0, { duration: RISE_MS }))
  }, [rise])
  const risen = useAnimatedStyle(() => ({ transform: [{ translateY: rise.get() * screenHeight }] }))
  const scroller = useRef<ScrollView>(null)
  // Until when a size change of the content or of the sheet (the keyboard's padding) scrolls to the end.
  const revealUntil = useRef(0)
  const toEndIfAsked = useCallback(() => {
    if (Date.now() <= revealUntil.current) scroller.current?.scrollToEnd({ animated: true })
  }, [])
  /* A last look once the keyboard's padding has settled (ST-5 r7: «Перевірка» stood half under the keys while «Витратити»
     was typed): the padding can land after the frame that asked, and where it leaves the scroll's own size unchanged
     nothing else asks for the end again. */
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current)
    },
    [],
  )
  const scrollContext = useMemo(
    () => ({
      revealEnd: () => {
        revealUntil.current = Date.now() + REVEAL_WINDOW_MS
        requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }))
        if (settle.current) clearTimeout(settle.current)
        settle.current = setTimeout(() => {
          settle.current = null
          scroller.current?.scrollToEnd({ animated: true })
        }, REVEAL_SETTLE_MS)
      },
    }),
    [],
  )
  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shared.close}
        onPress={locked ? undefined : onClose}
        className="absolute inset-0"
        style={{ backgroundColor: colors.scrim }}
      />
      <Animated.View
        className="w-full self-center rounded-t-lg border-t border-line bg-elevated pt-3"
        style={[{ maxHeight: '93%', maxWidth: page.action, paddingBottom: Math.max(insets.bottom, 12) }, risen]}
      >
        <View className="mb-1 h-1 w-10 self-center rounded-pill bg-line-strong" />
        <View className={cn('min-h-14 flex-row items-center gap-1 pr-2', onBack ? 'pl-1' : 'pl-4')}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={shared.back}
              onPress={locked ? undefined : onBack}
              disabled={locked}
              className="h-12 w-12 items-center justify-center rounded-pill active:bg-hover"
            >
              <Icon name="arrow-back" size={22} color={locked ? 'fgMuted' : 'fg'} />
            </Pressable>
          ) : null}
          <Txt variant="title" accessibilityRole="header" numberOfLines={1} className="flex-1">
            {title}
          </Txt>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shared.close}
            onPress={locked ? undefined : onClose}
            disabled={locked}
            className="h-12 w-12 items-center justify-center rounded-pill active:bg-hover"
          >
            <Icon name="close" size={22} color={locked ? 'fgMuted' : 'muted'} />
          </Pressable>
        </View>
        {scroll ? (
          <ScrollView
            ref={scroller}
            className="shrink"
            contentContainerClassName="gap-3 px-4 pb-3"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={toEndIfAsked}
            onLayout={toEndIfAsked}
          >
            <SheetScroll.Provider value={scrollContext}>{children}</SheetScroll.Provider>
          </ScrollView>
        ) : (
          <View className="shrink gap-3 px-4 pb-3">{children}</View>
        )}
        {footer ? <View className="gap-2 px-4 pt-2">{footer}</View> : null}
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

/**
 * «?» beside «Можна використати» when it is SOL (ST-5): why a ticket's figure is less than Portfolio's «Доступно до
 * витрати» — the deposits its token accounts may need (`SOL_SWAP_RESERVE_LAMPORTS`), the network fee already set aside.
 */
export function SolKeptHelp() {
  const words = useCopy(SHEET_COPY)
  const locale = useLocale()
  const amount = `${formatUnits(SOL_SWAP_RESERVE_LAMPORTS.toString(), 9, 9, locale)} SOL`
  return <HelpDot title={words.canUseTitle} body={words.solKept(amount)} size={16} />
}

/** One row of the ticket that opens a step: «Тип: Ринок ›», «Платиш з: USDC $1 240,00 ›». */
export function OptionRow({
  label,
  value,
  detail = null,
  onPress,
  disabled = false,
}: {
  label: string
  value: string
  detail?: string | null
  onPress: () => void
  disabled?: boolean
}) {
  const locale = useLocale()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, saidFigure(value, locale), detail].filter(Boolean).join(', ')}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      className="min-h-14 flex-row items-center gap-3 rounded-md border border-line bg-ground px-4 active:bg-hover"
    >
      <Txt variant="ui" tone="muted">
        {label}
      </Txt>
      <View className="flex-1 flex-row items-center justify-end gap-1.5">
        <Txt variant="ui" numberOfLines={1}>
          {value}
        </Txt>
        {detail ? (
          <Txt variant="data" tone="muted" numberOfLines={1} className="shrink">
            {detail}
          </Txt>
        ) : null}
      </View>
      {disabled ? null : <Icon name="chevron-forward" size={16} color="fgMuted" />}
    </Pressable>
  )
}

/** A choice per row — the order types of «Тип»; what each does sits behind «?» beside «Тип» (ST-4). */
export function ChoiceList<T extends string>({
  choices,
  value,
  onChange,
}: {
  choices: readonly Readonly<{ value: T; label: string }>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <View className="gap-2" accessibilityRole="radiogroup">
      {choices.map((choice) => {
        const on = choice.value === value
        return (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={choice.label}
            onPress={() => onChange(choice.value)}
            className={cn(
              'min-h-14 flex-row items-center gap-3 rounded-md border px-4 py-3.5',
              on ? 'border-brand' : 'border-line active:bg-hover',
            )}
          >
            <View
              className={cn(
                'h-[22px] w-[22px] items-center justify-center rounded-pill border-2',
                on ? 'border-brand' : 'border-line-strong',
              )}
            >
              {on ? <View className="h-2.5 w-2.5 rounded-pill bg-brand" /> : null}
            </View>
            <Txt variant="ui" className="flex-1">
              {choice.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * «Перевірка» (NEW-LOOK §3): Спишеться · Отримаєш with the chain's minimum · Усі витрати, each as the server stated
 * it · Що це; the price, the impact and the price move allowed a tap deeper, under «Деталі». Every figure is the
 * Review's own.
 */
export function CheckRows({ view, what }: { view: ReviewView; what: string }) {
  const words = useCopy(SHEET_COPY)
  const summary = checkSummary(view)
  const [open, setOpen] = useState(false)
  return (
    <View className="gap-2">
      <View className="rounded-md border border-line bg-ground px-4">
        <Line label={words.spend} value={summary.spend} />
        <Line
          label={words.receive}
          value={summary.receive}
          detail={summary.minimum ? words.minimum(summary.minimum) : null}
        />
        {summary.costs.length > 0 ? (
          <View className="flex-row items-start justify-between gap-4 border-b border-line py-3">
            <Txt variant="ui" tone="muted">
              {words.allCosts}
            </Txt>
            <View className="shrink items-end gap-2">
              {summary.costs.map((cost) => (
                <View key={cost.key} className="items-end">
                  <Txt variant="labelSm" tone="faint" className="text-right">
                    {cost.label}
                  </Txt>
                  <Txt variant="data" className="text-right">
                    {cost.value}
                  </Txt>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        <Line label={words.whatIs} value={what} sans last />
      </View>
      {summary.details.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? words.hideDetails : words.details}
          onPress={() => setOpen((was) => !was)}
          className="min-h-12 flex-row items-center justify-between active:opacity-80"
        >
          <Txt variant="ui" tone="muted">
            {open ? words.hideDetails : words.details}
          </Txt>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color="fgMuted" />
        </Pressable>
      ) : null}
      {open ? (
        <View className="rounded-md border border-line bg-ground px-4">
          {summary.details.map((row, index) => (
            <Line
              key={row.key ?? row.label}
              label={row.label}
              value={row.value}
              tone={row.tone === 'danger' ? 'danger' : row.tone === 'warning' ? 'warning' : 'fg'}
              last={index === summary.details.length - 1}
            />
          ))}
        </View>
      ) : null}
      {view.warnings.map((warning) => (
        <View key={warning} className="flex-row items-start gap-2 rounded-md bg-warning-soft px-3 py-2.5">
          <Icon name="alert-circle-outline" size={18} color="warningInk" />
          <Txt variant="ui" className="flex-1">
            {warning}
          </Txt>
        </View>
      ))}
    </View>
  )
}

function Line({
  label,
  value,
  detail = null,
  sans = false,
  tone = 'fg',
  last = false,
}: {
  label: string
  value: string
  detail?: string | null
  sans?: boolean
  tone?: 'fg' | 'danger' | 'warning'
  last?: boolean
}) {
  return (
    <View className={cn('flex-row items-start justify-between gap-4 py-3', last ? '' : 'border-b border-line')}>
      <Txt variant="ui" tone="muted">
        {label}
      </Txt>
      <View className="shrink items-end gap-0.5">
        <Txt variant={sans ? 'ui' : 'data'} tone={tone} className="text-right">
          {value}
        </Txt>
        {detail ? (
          <Txt variant="labelSm" tone="faint" className="text-right">
            {detail}
          </Txt>
        ) : null}
      </View>
    </View>
  )
}

/**
 * The wait for the wallet, inside the same sheet (NEW-LOOK §4): «Підтверди в гаманці», then «Надсилаємо…». The Ledger's
 * 20 seconds sit behind «?» beside the line (ST-4), not under it.
 */
export function WaitBody({ sending, onCancel = null }: { sending: boolean; onCancel?: (() => void) | null }) {
  const words = useCopy(SHEET_COPY)
  const { colors } = useTheme()
  return (
    <View className="items-center gap-3 py-6" accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.brand} />
      {sending ? (
        <Txt variant="title" className="text-center">
          {words.sending}
        </Txt>
      ) : (
        <View className="flex-row items-center justify-center gap-1">
          <Txt variant="title" className="shrink text-center">
            {words.confirmInYourWallet}
          </Txt>
          <HelpDot title={words.confirmInYourWallet} body={words.ledgerWait} />
        </View>
      )}
      {/* «Скасувати» is there for the whole wait (M45); once the wallet answered, the one send is under way. */}
      {!sending && onCancel ? (
        <Button
          title={words.cancelWait}
          variant="secondary"
          size="lg"
          onPress={onCancel}
          className="mt-2 self-stretch"
        />
      ) : null}
    </View>
  )
}

/**
 * «Готово» (NEW-LOOK §5): the mark, what happened, the sum large, the other side and the time; «Квитанцію збережено»
 * opens it in Портфель → Історія. A refusal or an answer still on its way reads as itself, never as done.
 */
export function DoneBody({
  tone,
  title,
  big,
  line,
  note,
  onReceipt,
}: {
  tone: 'done' | 'pending' | 'failed'
  title: string
  big: string | null
  line: string | null
  note: string | null
  onReceipt: (() => void) | null
}) {
  const words = useCopy(SHEET_COPY)
  const icon: IconName = tone === 'done' ? 'checkmark' : tone === 'pending' ? 'time-outline' : 'close'
  return (
    <View className="items-center gap-2 pb-2 pt-4">
      <View
        className={cn(
          'mb-2 h-[76px] w-[76px] items-center justify-center rounded-pill',
          tone === 'done' ? 'bg-success-soft' : tone === 'pending' ? 'bg-warning-soft' : 'bg-danger-soft',
        )}
      >
        <Icon
          name={icon}
          size={38}
          color={tone === 'done' ? 'successInk' : tone === 'pending' ? 'warningInk' : 'dangerInk'}
        />
      </View>
      <Txt variant="ui" tone="muted" accessibilityRole="header" className="text-center">
        {title}
      </Txt>
      {big ? (
        <Txt variant="display" tabular className="text-center">
          {big}
        </Txt>
      ) : null}
      {line ? (
        <Txt variant="ui" tone="muted" tabular className="text-center">
          {line}
        </Txt>
      ) : null}
      {note ? (
        <Txt variant="ui" tone="muted" className="text-center">
          {note}
        </Txt>
      ) : null}
      {onReceipt ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={words.receiptSaved}
          onPress={onReceipt}
          className="mt-4 min-h-14 w-full flex-row items-center gap-3 rounded-md border border-line bg-ground px-4 py-3 active:bg-hover"
        >
          <Icon name="receipt-outline" size={20} color="fg" />
          <Txt variant="ui" className="flex-1">
            {words.receiptSaved}
          </Txt>
          <Icon name="chevron-forward" size={16} color="fgMuted" />
        </Pressable>
      ) : null}
    </View>
  )
}

/** «Ціна дійсна ще 0:30» under «Перевірка»; «Ціна застаріла» once the window is over. */
export function ValidFor({ text, stale }: { text: string; stale: boolean }) {
  return (
    <View className="flex-row items-center justify-center gap-1.5">
      <Icon name="time-outline" size={14} color={stale ? 'warningInk' : 'fgMuted'} />
      <Txt variant="labelSm" tone={stale ? 'warning' : 'faint'} tabular>
        {text}
      </Txt>
    </View>
  )
}

/** The sheet's one orange action, full width — the screen's only one. */
export function SheetAction(props: Parameters<typeof Button>[0]) {
  return <Button size="lg" {...props} />
}

/**
 * A stock token's pool that cannot stand for the share, said inside the ticket over its action (ST-5 r9) — the asset
 * page's own line, in the same box one cannot read past.
 */
export function PoolLine({ text }: { text: string }) {
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-start gap-2 rounded-sm border border-warning-soft bg-warning-soft px-4 py-3"
    >
      <Icon name="warning-outline" size={18} color="warningInk" style={{ marginTop: 1 }} />
      <Txt variant="ui" tone="warning" className="flex-1">
        {text}
      </Txt>
    </View>
  )
}
