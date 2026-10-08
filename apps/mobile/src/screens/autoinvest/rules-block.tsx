import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, Switch, View } from 'react-native'

import { AssetIcon } from '@/components/asset-icon'
import { Button } from '@/components/button'
import { Icon } from '@/components/icon'
import { Sheet } from '@/components/sheet'
import { Skeleton } from '@/components/skeleton'
import { Txt } from '@/components/txt'
import { AUTOINVEST_COPY, type AutoinvestCopy } from '@/features/autoinvest/copy'
import {
  missedOf,
  purchaseSumUsd,
  ruleBuyRouteOf,
  ruleFace,
  writeFailureWords,
  zoneOfRule,
} from '@/features/autoinvest/rule-model'
import { isListedToken, tokenWriteFailure } from '@/features/autoinvest/floor'
import { useRules, useRuleWrites } from '@/features/autoinvest/use-rules'
import {
  dayWords,
  dueWords,
  gatheredShort,
  keptTail,
  priceWord,
  ruleWhenLine,
  unbroken,
  unbrokenParts,
} from '@/features/autoinvest/words'
import { BUY_COPY } from '@/features/invest/buy-copy'
import { dollarsText } from '@/features/invest/buy-model'
import { INVEST_COPY } from '@/features/invest/copy'
import { shelfCardFor, type ShelfCard } from '@/features/invest/shelf'
import { usePopularCompanies } from '@/features/invest/use-popular'
import { useCompanyShelf } from '@/features/invest/use-shelf'
import { recordJourney } from '@/features/journeys/journey-store'
import { marketsPath } from '@/features/markets/screener'
import { usePortfolio } from '@/features/portfolio/use-portfolio'
import { useAccount } from '@/features/session/use-account'
import { useNow } from '@/hooks/use-now'
import { fetchMarketsByMints, type AutoinvestRule, type RuleBudget, type RuleOccurrence, type Session } from '@/lib/api'
import { useCopy, useLocale, type Locale } from '@/lib/i18n'
import { companyItem, ShelfRow } from '@/screens/invest/shelf-ui'
import { useTheme } from '@/theme'
import { cn } from '@/utils/cn'

import { AutoinvestSheet } from './autoinvest-sheet'
import { BudgetRow } from './budget-row'
import { BudgetSheet } from './budget-sheet'

/**
 * «Автоінвест» — one block on Home and in Portfolio, for every connected
 * wallet (M16, M20). The month's budget
 * as its own line — «Бюджет не задано · Задати», or «Бюджет місяця $45 з
 * $100 · Змінити» over its bar (spent, «Бюджет вичерпано · Правила стоять до
 * 1-го числа») — once there is a rule or a ceiling for it to bound; the
 * wallet's rules as cards, each with its sum, when it reminds and what comes
 * next, and a switch that pauses it or turns it on again (a fall's rule then
 * counts from the price at that moment); a reminder that passed without a
 * signature says «Пропущено» under its line; and «+ Додати правило», which
 * asks for which company. A rule whose reminder is open says «Час твоєї
 * покупки» and one tap opens the purchase on its company; any other tap
 * opens the rule. The rules are the wallet's, read behind its session: a
 * wallet not signed in reads one line and a quiet «Увійти гаманцем». Nothing
 * here is orange but the open reminder's mark: the screen's one orange
 * action is elsewhere.
 */
export function RulesBlock({ session, place }: { session: Session | null; place: RulesPlace }) {
  const copy = useCopy(AUTOINVEST_COPY)
  return (
    <View className="gap-3">
      <Txt variant="title" accessibilityRole="header">
        {copy.autoinvest}
      </Txt>
      {session ? <SignedInRules session={session} place={place} copy={copy} /> : <SignInForRules copy={copy} />}
    </View>
  )
}

/** Where the block stands — the journey a tap on it records starts there. */
export type RulesPlace = 'home' | 'bots'

/** A wallet not signed in: its rules are read behind its session — one line, one quiet way in. */
function SignInForRules({ copy }: { copy: AutoinvestCopy }) {
  const account = useAccount()
  const buyWords = useCopy(BUY_COPY)
  const failure = account.signInFailure
    ? account.signInFailure.kind === 'network'
      ? buyWords.signInOffline
      : account.signInFailure.kind === 'outdated'
        ? buyWords.signInOutdated
        : buyWords.signInFailed
    : null
  return (
    <View className="gap-2 rounded-sm border border-line bg-surface px-4 py-3">
      <Txt variant="ui" tone="muted">
        {copy.signInForRules}
      </Txt>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={buyWords.signIn}
        accessibilityState={{ busy: account.signingIn }}
        disabled={account.signingIn}
        onPress={() => void account.signIn()}
        hitSlop={8}
        className={cn('self-start py-1 active:opacity-70', account.signingIn && 'opacity-50')}
      >
        <Txt variant="ui" tone="fg" style={{ textDecorationLine: 'underline' }}>
          {buyWords.signIn}
        </Txt>
      </Pressable>
      {failure ? (
        <Txt variant="ui" tone="danger">
          {failure}
        </Txt>
      ) : null}
    </View>
  )
}

function SignedInRules({ session, place, copy }: { session: Session; place: RulesPlace; copy: AutoinvestCopy }) {
  const router = useRouter()
  const locale = useLocale()
  const now = useNow(30_000)
  const rules = useRules(session)
  const writes = useRuleWrites(session)
  const shelf = useCompanyShelf()
  const [managing, setManaging] = useState<AutoinvestRule | null>(null)
  const [picking, setPicking] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const list = rules.data?.rules ?? null
  const budget = rules.data?.budget ?? null
  // A token's logo from its market row (1.31.0): the shelf knows the companies only.
  const tokenMints = (list ?? []).filter((rule) => isListedToken(rule.asset)).map((rule) => rule.asset.mint)
  const tokenRows = useQuery({
    queryKey: ['rules', 'icons', tokenMints.join(',')],
    queryFn: ({ signal }) => fetchMarketsByMints(tokenMints, signal),
    enabled: tokenMints.length > 0,
    staleTime: 10 * 60_000,
    retry: 1,
  })
  const iconOf = (mint: string) =>
    shelfCardFor(shelf.shelf, mint)?.icon ?? tokenRows.data?.rows.find((row) => row.mint === mint)?.icon ?? null

  const buyNow = (rule: AutoinvestRule, occurrence: RuleOccurrence) => {
    recordJourney('home_go', { from: place, to: 'rule-buy' })
    setManaging(null)
    // A company's purchase on its page; a token's (1.31.0) in Trade, the ticket as the rule's purchase.
    router.push(ruleBuyRouteOf(rule, occurrence.dueAt) as never)
  }
  const open = (rule: AutoinvestRule) => {
    // The face the card draws is the one a tap acts on.
    const face = ruleFace(rule, budget, now)
    if (face.kind === 'due') buyNow(rule, face.occurrence)
    // A token's card opens its trade (1.31.0, the web's own): «Регулярно» there, the rule managed beside «Ринок».
    else if (isListedToken(rule.asset))
      router.push({
        pathname: '/trade',
        params: { mint: rule.asset.mint, symbol: rule.asset.symbol, side: 'buy', order: 'recurring' },
      })
    else setManaging(rule)
  }
  const toggle = async (rule: AutoinvestRule, on: boolean) => {
    setFailure(null)
    setSwitching(rule.id)
    const result = await writes.setStatus(rule.id, on ? 'active' : 'paused')
    setSwitching(null)
    if (!result.ok) {
      // A token turned on again stands on the floor again (1.31.0): its refusal in its own words.
      const tokenFailure = isListedToken(rule.asset) ? tokenWriteFailure(result.code, 'change') : null
      setFailure(
        tokenFailure ? copy[tokenFailure] : writeFailureWords(result.code, copy, { write: 'change', dip: rule.dip !== null }),
      )
    }
  }
  const addRule = () => setPicking(true)

  let body
  if (list === null) {
    body = rules.isError ? (
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-line bg-surface px-4 py-3">
        <Txt variant="ui" tone="muted" className="flex-1">
          {copy.rulesDown}
        </Txt>
        <Pressable accessibilityRole="button" onPress={() => void rules.refetch()} hitSlop={6}>
          <Txt variant="ui" tone="fg">
            {copy.tryAgain}
          </Txt>
        </Pressable>
      </View>
    ) : (
      <Skeleton className="h-16 rounded-sm" accessibilityRole="progressbar" />
    )
  } else {
    // The budget's line once there is something for it to bound: a rule, or a ceiling the person set.
    const showBudget = budget !== null && (list.length > 0 || budget.capUsd !== null)
    body = (
      <View className="gap-2">
        {showBudget ? (
          <BudgetRow budget={budget} copy={copy} locale={locale} onEdit={() => setBudgetOpen(true)} />
        ) : null}
        {list.length === 0 ? (
          <Txt variant="ui" tone="muted" className="px-1 py-1">
            {copy.noRulesYet}
          </Txt>
        ) : (
          list.map((rule) => (
            <HomeRuleCard
              key={rule.id}
              rule={rule}
              budget={budget}
              icon={iconOf(rule.asset.mint)}
              copy={copy}
              locale={locale}
              now={now}
              switching={switching === rule.id}
              onPress={() => open(rule)}
              onToggle={(on) => void toggle(rule, on)}
            />
          ))
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.addRule}
          onPress={addRule}
          className="h-11 flex-row items-center gap-2 self-start rounded-btn border border-dashed border-line-strong px-3 active:bg-hover"
        >
          <Icon name="add" size={18} color="muted" />
          <Txt variant="ui" tone="fg">
            {copy.addRule}
          </Txt>
        </Pressable>
      </View>
    )
  }

  const card = managing ? shelfCardFor(shelf.shelf, managing.asset.mint) : null
  return (
    <>
      {body}
      {failure ? (
        <Txt variant="ui" tone="danger">
          {failure}
        </Txt>
      ) : null}
      {managing ? (
        <AutoinvestSheet
          visible
          // The rule as the list holds it now: a pause, a gathered payment or «Мій рахунок» shows in the open sheet at once.
          mode={{ kind: 'manage', rule: list?.find((row) => row.id === managing.id) ?? managing }}
          company={{
            mint: managing.asset.mint,
            name: managing.name,
            icon: card?.icon ?? null,
            preIpo: false,
            truth: null,
            priceUsd: null,
            token: isListedToken(managing.asset),
          }}
          budget={budget}
          onClose={() => setManaging(null)}
          onBuyNow={buyNow}
          onChangeBudget={() => setBudgetOpen(true)}
        />
      ) : null}
      <CompanyPicker
        visible={picking}
        address={session.address}
        copy={copy}
        onClose={() => setPicking(false)}
        onPick={(company) => {
          recordJourney('home_go', { from: place, to: 'rule-new' })
          setPicking(false)
          // The token's own page with its rule's sheet: a company's, a coin's or a meme's (1.31.0).
          router.push({
            pathname: '/asset/[mint]',
            params: {
              mint: company.mint,
              symbol: company.ticker,
              ...(company.category ? { category: company.category } : {}),
              autoinvest: '1',
            },
          })
        }}
      />
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />
    </>
  )
}

/**
 * One rule as a card: the company, the sum and when it reminds — a «З оплат»
 * rule by its terms alone — what comes next — the next purchase, the line a
 * fall's price must reach, what payments have gathered of the sum it reminds
 * from («Накопичено $0,60 з $1», the web's line for a narrow column), the pause,
 * a purchase the price condition holds back («Купівлю відкладено», why one
 * tap deeper, as the web's card says it), the budget holding it, or, open,
 * «Час твоєї покупки» — «Пропущено» under it when the last reminder passed
 * without a signature; and the switch.
 */
export function HomeRuleCard({
  rule,
  budget,
  icon,
  copy,
  locale,
  now,
  switching,
  onPress,
  onToggle,
}: {
  rule: AutoinvestRule
  budget: RuleBudget | null
  icon: string | null
  copy: AutoinvestCopy
  locale: Locale
  now: number
  switching: boolean
  onPress: () => void
  onToggle: (on: boolean) => void
}) {
  const { colors } = useTheme()
  const face = ruleFace(rule, budget, now)
  const missed = missedOf(rule, face)
  const on = rule.status === 'active'
  const due = face.kind === 'due'
  const usd = dollarsText(rule.amountUsd, locale)
  const zone = zoneOfRule(rule)
  // A «З оплат» rule is said by its terms alone — its sum is only the least a reminder opens at (1.19.0).
  const terms = rule.payments ? ruleWhenLine(rule, locale) : `${usd} · ${ruleWhenLine(rule, locale)}`
  const line =
    face.kind === 'due'
      ? `${copy.timeToBuy} · ${dollarsText(purchaseSumUsd(rule, face.occurrence), locale)}`
      : face.kind === 'paused'
        ? copy.onPause
        : face.kind === 'deferred'
          ? copy.purchaseDeferred
          : face.kind === 'held'
            ? unbrokenParts(copy.heldShort)
            : face.kind === 'next'
              ? `${copy.nextPurchase}: ${unbroken(dueWords(face.atMs, face.timeZone, locale))}`
              : face.kind === 'dip'
                ? `${copy.remindAtLine} ${priceWord(face.triggerUsd, locale)}`
                : face.kind === 'payments'
                  ? gatheredShort(face.gatheredUsd, face.minimumUsd, locale)
                  : null
  const missedLine = missed
    ? `${copy.lastMissed} · ${unbroken(rule.dip ? dayWords(Date.parse(missed.dueAt), zone, locale) : dueWords(Date.parse(missed.dueAt), zone, locale))}`
    : null
  return (
    <View
      className={cn(
        'flex-row items-center gap-2 overflow-hidden rounded-sm border bg-surface py-3 pl-4 pr-2',
        due ? 'border-brand-line' : 'border-line',
      )}
    >
      {due ? (
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.brand }} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[`${copy.ruleOf(rule.name)}: ${terms}`, line, missedLine].filter(Boolean).join('. ')}
        onPress={onPress}
        className="flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <AssetIcon symbol={rule.name} icon={icon} size={36} />
        <View className="flex-1 gap-0.5">
          <Txt variant="ui" tone={on ? 'fg' : 'muted'} numberOfLines={1}>
            {rule.name}
          </Txt>
          <Txt variant="ui" tone="muted" numberOfLines={2} tabular>
            {rule.payments ? keptTail(terms) : unbrokenParts(terms)}
          </Txt>
          {line ? (
            <View className="flex-row items-center gap-1.5">
              {due ? <Icon name="time-outline" size={14} color="brand" /> : null}
              <Txt
                variant="ui"
                tone={due ? 'fg' : face.kind === 'held' || face.kind === 'deferred' ? 'warning' : 'faint'}
                numberOfLines={2}
                tabular
                className="shrink"
              >
                {line}
              </Txt>
            </View>
          ) : null}
          {missedLine ? (
            <Txt variant="ui" tone="faint" numberOfLines={2} tabular>
              {missedLine}
            </Txt>
          ) : null}
        </View>
      </Pressable>
      <Switch
        value={on}
        disabled={switching}
        onValueChange={onToggle}
        accessibilityLabel={`${copy.ruleOf(rule.name)} · ${on ? copy.ruleOn : copy.onPause}`}
        trackColor={{ false: colors.lineStrong, true: colors.success }}
        thumbColor={colors.onBrand}
        ios_backgroundColor={colors.lineStrong}
      />
    </View>
  )
}

/**
 * «Додати правило» → «Для якого токена?» (1.31.0): what the wallet holds — a
 * company, a coin, a meme; never the dollars a rule pays with — then the
 * popular companies, the server's list, the web's own (1.20.0), without what
 * the wallet holds; «Усі токени — на Ринках» opens Markets, where «Регулярно»
 * stands on every token. A tap opens the token with its rule's sheet; the
 * server judges the floor.
 */
type PickedCompany = Pick<ShelfCard, 'mint' | 'ticker' | 'name' | 'icon' | 'price' | 'change24h'> &
  Readonly<{ category?: 'stock' | 'crypto' | 'meme' }>

function CompanyPicker({
  visible,
  address,
  copy,
  onClose,
  onPick,
}: {
  visible: boolean
  address: string
  copy: AutoinvestCopy
  onClose: () => void
  onPick: (company: PickedCompany) => void
}) {
  const router = useRouter()
  const locale = useLocale()
  const invest = useCopy(INVEST_COPY)
  const shelf = useCompanyShelf()
  const listed = usePopularCompanies()
  const holdings = usePortfolio(address)
  if (!visible) return null
  const cards = shelf.shelf
  const held = new Set(
    (holdings.view?.rows ?? []).filter((row) => row.amount > 0 && !row.native).map((row) => row.mint),
  )
  const ownedCompanies: PickedCompany[] = cards
    ? [...cards.companies, ...cards.privateCompanies]
        .filter((card) => held.has(card.mint))
        .map((card) => ({ ...card, category: 'stock' as const }))
    : []
  // The coins and memes the wallet holds that the venue prices — SOL among them; a rule on one is named by its symbol.
  const ownedTokens: PickedCompany[] = (holdings.view?.rows ?? [])
    .filter((row) => row.amount > 0 && (row.group === 'crypto' || row.group === 'meme') && row.price !== null && row.listed)
    .map((row) => ({
      mint: row.mint,
      ticker: row.symbol,
      name: row.symbol,
      icon: row.icon,
      price: row.price as number,
      change24h: row.dayChangePct,
      category: row.group === 'meme' ? ('meme' as const) : ('crypto' as const),
    }))
  const owned = [...ownedCompanies, ...ownedTokens]
  const popular = (listed.data?.companies ?? []).filter((company) => !held.has(company.mint))
  const today = invest.today
  const section = (title: string, list: readonly PickedCompany[]) =>
    list.length > 0 ? (
      <View className="gap-1">
        <Txt variant="labelSm" tone="faint" caps>
          {title}
        </Txt>
        <View>
          {list.map((card, index) => (
            <ShelfRow
              key={card.mint}
              item={companyItem(card)}
              locale={locale}
              today={today}
              onPress={() => onPick(card)}
              last={index === list.length - 1}
            />
          ))}
        </View>
      </View>
    ) : null
  return (
    <Sheet visible title={copy.pickToken} onClose={onClose} scroll>
      <View className="gap-4 pb-2">
        {cards || listed.data ? (
          <>
            {section(copy.youOwn, owned)}
            {listed.data ? (
              section(copy.popular, popular)
            ) : listed.isError ? (
              // The server's list did not answer: said, with the one way to ask again — never a section that silently vanished.
              <View className="items-start gap-3 rounded-sm border border-line bg-surface p-4">
                <Txt variant="ui" tone="muted">
                  {invest.shelfDown}
                </Txt>
                <Button
                  title={invest.reload}
                  variant="secondary"
                  size="sm"
                  loading={listed.isFetching}
                  onPress={() => void listed.refetch()}
                />
              </View>
            ) : (
              <Skeleton className="h-40 rounded-sm" accessibilityRole="progressbar" />
            )}
          </>
        ) : listed.isError ? (
          <View className="items-start gap-3 rounded-sm border border-line bg-surface p-4">
            <Txt variant="ui" tone="muted">
              {invest.shelfDown}
            </Txt>
            <Button
              title={invest.reload}
              variant="secondary"
              size="sm"
              loading={listed.isFetching}
              onPress={() => void listed.refetch()}
            />
          </View>
        ) : (
          <Skeleton className="h-40 rounded-sm" accessibilityRole="progressbar" />
        )}
        <Button
          title={copy.allTokens}
          variant="secondary"
          onPress={() => {
            onClose()
            router.navigate(marketsPath('all') as never)
          }}
        />
      </View>
    </Sheet>
  )
}
