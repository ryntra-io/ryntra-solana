import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, Pressable, View } from 'react-native'

import { BOTTOM_ACTION_INSET, BottomAction } from '@/components/bottom-action'
import { Card } from '@/components/card'
import { ChoiceChips } from '@/components/choice-chips'
import { Field } from '@/components/field'
import { Icon } from '@/components/icon'
import { Screen } from '@/components/screen'
import { Sheet } from '@/components/sheet'
import { StateView } from '@/components/state-view'
import { Txt } from '@/components/txt'
import { launchWords, type LaunchWord } from '@/features/launch/copy'
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  shownProblem,
  utf8Length,
  type FieldProblem,
  type LaunchFormFields,
} from '@/features/launch/form'
import { lostAfterSend } from '@/features/launch/launch-flow'
import {
  explorerUrl,
  formatBps,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRaw,
  fromRaw,
} from '@/features/launch/launch-format'
import {
  COST_ESTIMATE_SOL,
  createFailureKey,
  periodWord,
  sendTitleKey,
  supplyPct,
  SUPPLY_RAW,
} from '@/features/launch/launch-model'
import { choosePicture, takePicture } from '@/features/launch/picture'
import { useLaunchCreate, type LaunchCreate } from '@/features/launch/use-create'
import { useLaunchOpen, useLaunchPresets } from '@/features/launch/use-launch'
import { useNow } from '@/hooks/use-now'
import { TERMS_URL } from '@/lib/legal'
import type { LaunchPreset, LaunchPresetsResponse } from '@/lib/api/v1/types'
import { useLocale, useSharedCopy, type Locale } from '@/lib/i18n'

import { LaunchSuccess } from './launch-success'
import { ExplorerLink, LaunchTabs, PausedNote, Row, TokenPicture } from './parts'

/**
 * «Запустити токен» — as on the web, by the phone's hand and in a few taps: a
 * picture from the camera or the gallery, the name and the ticker, a
 * description and links if the creator wants them, «Захищений» chosen, a first
 * buy if they want one, and what the signature will do said before it. The
 * wallet signs the creation (and the lock) in one prompt; the server sends.
 */
export function LaunchNewScreen() {
  const router = useRouter()
  const shared = useSharedCopy()
  const locale = useLocale()
  const word = launchWords(locale)
  const launchOpen = useLaunchOpen()
  const open = launchOpen.open
  const presets = useLaunchPresets(open === true)
  const create = useLaunchCreate(presets.data ?? null)
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))

  if (open === false || launchOpen.failed) {
    return (
      <Screen title={word('title')} onBack={back} backLabel={shared.back}>
        {launchOpen.failed ? (
          <StateView
            icon="cloud-offline-outline"
            title={word('launchUnread')}
            action={{ title: word('readAgain'), onPress: launchOpen.retry, loading: launchOpen.reading }}
          />
        ) : (
          <StateView icon="rocket-outline" title={word('unavailable')} />
        )}
      </Screen>
    )
  }
  // A lost answer that turned out to have landed ends as any launch does: the token's own read stands for the send's.
  const landed = create.landedToken
  const result =
    create.phase === 'done' && create.result
      ? create.result
      : landed
        ? {
            ok: true as const,
            submit: {
              token: landed.token,
              signature: landed.signature,
              state: 'LAUNCHED' as const,
              lock: landed.lock,
              tokenPath: `/app/launch/${landed.token}`,
            },
            token: landed,
            symbol: landed.symbol,
            image: landed.image,
          }
        : null
  if (result) {
    return (
      <Screen title={word('title')} onBack={back} backLabel={shared.back}>
        <LaunchSuccess word={word} locale={locale} result={result} onAnother={create.reset} />
      </Screen>
    )
  }
  if (!presets.data || !create.preset) {
    return (
      <Screen title={word('title')} onBack={back} backLabel={shared.back}>
        <LaunchTabs word={word} current="new" />
        {presets.isError ? (
          <StateView
            icon="cloud-offline-outline"
            title={word('presetsUnread')}
            action={{ title: word('readAgain'), onPress: () => void presets.refetch(), loading: presets.isFetching }}
          />
        ) : (
          <StateView icon="hourglass-outline" title={shared.loading} />
        )}
      </Screen>
    )
  }

  const action = actionOf(create, word, (mint) => router.push(`/launch/${mint}` as never))
  return (
    <View className="flex-1 bg-ground">
      <Screen title={word('title')} onBack={back} backLabel={shared.back} bottomInset={BOTTOM_ACTION_INSET}>
        <LaunchTabs word={word} current="new" />
        {create.paused ? (
          <PausedNote word={word} scope="form" />
        ) : (
          <Txt variant="ui" tone="muted">
            {word('lede')}
          </Txt>
        )}
        <TokenSection create={create} word={word} />
        <LinksSection create={create} word={word} />
        <PresetSection create={create} word={word} locale={locale} presets={presets.data.presets} />
        <BuySection create={create} word={word} locale={locale} locks={presets.data.locks} />
        <ReviewSection create={create} word={word} locale={locale} />
      </Screen>
      <FailureDock create={create} word={word} />
      <BottomAction {...action} />
    </View>
  )
}

function actionOf(
  create: LaunchCreate,
  word: LaunchWord,
  openToken: (mint: string) => void,
): { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; hint?: string } {
  if (create.paused) return { title: word('pausedAction'), onPress: () => undefined, disabled: true }
  // An answer lost after the send: the launch may have landed. No second launch until the chain says it did not.
  if (create.lostToken && !create.notLanded) {
    const mint = create.lostToken
    return {
      title: word('openToken'),
      onPress: () => openToken(mint),
      hint: create.landed ? undefined : word('launchSettling'),
    }
  }
  // While it runs, the one line above the action says where it stands: prepared · in the wallet · on the network.
  if (create.phase === 'prepare')
    return { title: word('stepPrepare'), onPress: () => undefined, loading: true, hint: word('stepPrepare') }
  if (create.phase === 'sign') {
    const step = word(create.transactions > 1 ? 'stepSignMany' : 'stepSign')
    return { title: step, onPress: () => undefined, loading: true, hint: step }
  }
  if (create.phase === 'send')
    return { title: word('stepSend'), onPress: () => undefined, loading: true, hint: word('stepSend') }
  if (!create.account.address)
    return {
      title: word('connect'),
      onPress: () => void create.account.connect(),
      loading: create.account.busy === 'connect',
    }
  return {
    title: word('launch'),
    onPress: () => void create.launch(),
    // Pressed with something still to fill: the fields above say what, and this line says to look there.
    hint: create.attempted && !create.valid ? word('fixAbove') : undefined,
  }
}

function problemText(word: LaunchWord, create: LaunchCreate, key: keyof LaunchFormFields, problem: FieldProblem) {
  if (problem === 'BORROWED')
    return word('errBorrowed', { label: create.check.hits.find((hit) => hit.field === key)?.label ?? '' })
  if (problem === 'REQUIRED') return word('errRequired')
  if (problem === 'TOO_LONG') return word('errTooLong')
  if (problem === 'SYMBOL_CHARS') return word('errSymbolChars')
  return word(key === 'x' ? 'errLinkX' : key === 'telegram' ? 'errLinkTelegram' : 'errLink')
}

function useProblem(create: LaunchCreate, word: LaunchWord) {
  return (key: keyof LaunchFormFields) => {
    const problem = shownProblem(create.check, key, create.fields, create.attempted)
    return problem ? problemText(word, create, key, problem) : null
  }
}

function SectionTitle({ title, optional }: { title: string; optional?: string }) {
  return (
    <Txt variant="labelSm" tone="faint" caps>
      {title}
      {optional ? (
        <Txt variant="labelSm" tone="faint">
          {' '}
          · {optional}
        </Txt>
      ) : null}
    </Txt>
  )
}

/** How long the sheet takes to slide away before the picker opens. */
const SHEET_CLOSE_MS = 350

/** The picture, the name and the ticker side by side; the description under them. */
function TokenSection({ create, word }: { create: LaunchCreate; word: LaunchWord }) {
  const problem = useProblem(create, word)
  const [choosing, setChoosing] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const missing = (create.attempted && !create.picture) || create.pictureBad
  const pick = async (from: 'camera' | 'gallery') => {
    setChoosing(false)
    setCameraOff(false)
    // The sheet closes first: the camera or the gallery opens over the form, never over a closing sheet.
    await new Promise((resolve) => setTimeout(resolve, SHEET_CLOSE_MS))
    const result = from === 'camera' ? await takePicture() : await choosePicture()
    if (result.kind === 'picked') create.setPicture(result.picture)
    else if (result.kind === 'bad') create.setPictureBad(true)
    else if (result.kind === 'camera-off') setCameraOff(true)
  }
  const locked = create.busy || create.paused
  return (
    <Card className="gap-3">
      <SectionTitle title={word('sectionToken')} />
      <View className="flex-row gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={create.picture ? `${word('picture')}: ${word('pictureChange')}` : word('pictureAdd')}
          disabled={locked}
          onPress={() => setChoosing(true)}
          className="w-24 items-center gap-1"
        >
          <View className={missing ? 'rounded-sm border border-danger' : undefined}>
            <TokenPicture uri={create.picture?.uri ?? null} size={88} />
          </View>
          <Txt
            variant="labelSm"
            tone={missing && !create.pictureBad ? 'danger' : create.picture ? 'brand' : 'muted'}
            className="text-center"
          >
            {missing && !create.pictureBad
              ? word('pictureMissing')
              : create.picture
                ? word('pictureChange')
                : word('pictureAdd')}
          </Txt>
        </Pressable>
        <View className="flex-1 gap-3">
          <Field
            label={word('name')}
            value={create.fields.name}
            onChangeText={(value) => create.setField('name', value)}
            placeholder={word('namePlaceholder')}
            mono={false}
            editable={!locked}
            autoCorrect={false}
            maxLength={64}
            error={problem('name')}
            hint={`${utf8Length(create.check.clean.name)}/${NAME_MAX}`}
          />
        </View>
      </View>
      <Field
        label={word('ticker')}
        value={create.fields.symbol}
        onChangeText={(value) => create.setField('symbol', value)}
        placeholder={word('tickerPlaceholder')}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!locked}
        maxLength={10}
        error={problem('symbol')}
      />
      {create.pictureBad ? (
        <Txt variant="labelSm" tone="danger">
          {word('pictureBad')}
        </Txt>
      ) : null}
      {cameraOff ? (
        <Txt variant="labelSm" tone="warning">
          {word('pictureCameraOff')}
        </Txt>
      ) : null}
      <Field
        label={`${word('description')} · ${word('optional')}`}
        value={create.fields.description}
        onChangeText={(value) => create.setField('description', value)}
        placeholder={word('descriptionPlaceholder')}
        mono={false}
        multiline
        editable={!locked}
        error={problem('description')}
        hint={`${[...create.fields.description].length}/${DESCRIPTION_MAX}`}
      />
      <Sheet
        visible={choosing}
        title={word('pictureAdd')}
        subtitle={word('pictureHint')}
        onClose={() => setChoosing(false)}
      >
        <View className="gap-1 px-4 pb-2">
          <SheetChoice icon="camera-outline" label={word('pictureCamera')} onPress={() => void pick('camera')} />
          <SheetChoice icon="images-outline" label={word('pictureGallery')} onPress={() => void pick('gallery')} />
        </View>
      </Sheet>
    </Card>
  )
}

function SheetChoice({
  icon,
  label,
  onPress,
}: {
  icon: 'camera-outline' | 'images-outline'
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="h-13 flex-row items-center gap-3 rounded-btn px-2 active:bg-hover"
    >
      <Icon name={icon} size={22} color="fg" />
      <Txt variant="body">{label}</Txt>
    </Pressable>
  )
}

/** The creator's links — optional, one tap to open, so the first screen stays the token itself. */
function LinksSection({ create, word }: { create: LaunchCreate; word: LaunchWord }) {
  const problem = useProblem(create, word)
  const filled = Boolean(create.fields.website || create.fields.x || create.fields.telegram)
  const wrong = Boolean(create.check.problems.website || create.check.problems.x || create.check.problems.telegram)
  const [open, setOpen] = useState(false)
  const shown = open || filled || wrong
  const locked = create.busy || create.paused
  return (
    <Card className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
        onPress={() => setOpen(!shown)}
        disabled={filled || wrong}
        className="flex-row items-center justify-between"
        hitSlop={8}
      >
        <SectionTitle title={word('sectionLinks')} optional={word('optional')} />
        {filled || wrong ? null : <Icon name={shown ? 'chevron-up' : 'chevron-down'} size={16} color="muted" />}
      </Pressable>
      {shown
        ? (['website', 'x', 'telegram'] as const).map((key) => (
            <Field
              key={key}
              label={word(key)}
              value={create.fields[key]}
              onChangeText={(value) => create.setField(key, value)}
              placeholder={key === 'website' ? 'example.com' : key === 'x' ? 'x.com/…' : 't.me/…'}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!locked}
              error={problem(key)}
            />
          ))
        : null}
    </Card>
  )
}

function PresetSection({
  create,
  word,
  locale,
  presets,
}: {
  create: LaunchCreate
  word: LaunchWord
  locale: Locale
  presets: readonly LaunchPreset[]
}) {
  const [details, setDetails] = useState(false)
  const preset = create.preset!
  const locked = create.busy || create.paused
  return (
    <Card className="gap-3">
      <SectionTitle title={word('sectionPreset')} />
      <View accessibilityRole="radiogroup" className="gap-2">
        {presets.map((entry) => {
          const selected = entry.id === preset.id
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: locked }}
              disabled={locked}
              onPress={() => create.setPresetId(entry.id)}
              className={`gap-1 rounded-sm border px-3 py-3 ${selected ? 'border-brand bg-brand-chip' : 'border-line bg-surface active:bg-hover'}`}
            >
              <View className="flex-row items-center justify-between">
                <Txt variant="title">{entry.name[locale]}</Txt>
                <Icon
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={selected ? 'brand' : 'fgMuted'}
                />
              </View>
              <Txt variant="ui" tone="muted">
                {word('presetSniper', {
                  start: formatBps(entry.sniperFee.startBps, locale),
                  end: formatBps(entry.sniperFee.endBps, locale),
                  time: formatDuration(entry.sniperFee.seconds, locale),
                })}
              </Txt>
              <Txt variant="ui" tone="muted">
                {word('presetCreator', { pct: formatPercent(entry.creatorTradingFeePct, locale, 0) })}
              </Txt>
              <Txt variant="ui" tone="muted">
                {word('presetCap', { pct: formatBps(entry.firstBuyCapBps, locale) })}
              </Txt>
              {entry.pair.symbol !== 'USDC' ? (
                <Txt variant="ui" tone="muted">
                  {word('presetPair', { symbol: entry.pair.symbol })}
                </Txt>
              ) : null}
            </Pressable>
          )
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setDetails(true)}
        hitSlop={8}
        className="min-h-11 justify-center self-start"
      >
        <Txt variant="ui" tone="brand">
          {word('presetDetails')}
        </Txt>
      </Pressable>
      <Sheet
        visible={details}
        title={preset.name[locale]}
        subtitle={word('presetDetails')}
        onClose={() => setDetails(false)}
      >
        <View className="px-4 pb-2">
          <Row
            label={word('presetCurve')}
            value={`$${formatNumber(preset.startMarketCapUsd, locale)} → $${formatNumber(preset.graduationMarketCapUsd, locale)}`}
          />
          <Row
            label={word('presetGraduation')}
            value={word('presetGraduationValue', {
              pct: formatPercent(preset.graduationFee.pct, locale, 0),
              creator: formatPercent(preset.graduationFee.creatorPct, locale, 0),
            })}
          />
          <Row label={word('presetLp')} value={word('presetLpValue')} mono={false} />
          <Row label={word('presetToken')} value={word('presetTokenValue')} mono={false} />
        </View>
      </Sheet>
    </Card>
  )
}

function BuySection({
  create,
  word,
  locale,
  locks,
}: {
  create: LaunchCreate
  word: LaunchWord
  locale: Locale
  locks: LaunchPresetsResponse['locks']
}) {
  const now = useNow(60_000)
  const preset = create.preset!
  const decimals = preset.pair.decimals
  const quote = create.quoteData
  const maxIn = quote ? fromRaw(quote.maxAmountInRaw, decimals, 2) : null
  const tokens = quote && BigInt(quote.tokensOutRaw) > 0n ? quote.tokensOutRaw : null
  const invalid = create.buyRaw === null
  const locked = create.busy || create.paused
  const hint = invalid
    ? null
    : create.aboveCap && maxIn
      ? null
      : create.quoteLoading && create.buyText.trim()
        ? word('buyQuoting')
        : tokens
          ? word('buyGets', {
              tokens: formatRaw(tokens, 6, locale, 0),
              pct: formatPercent(supplyPct(tokens, SUPPLY_RAW), locale, 2),
            })
          : maxIn
            ? word('buyCap', {
                amount: formatNumber(Number(maxIn), locale, 2),
                symbol: preset.pair.symbol,
                pct: formatBps(preset.firstBuyCapBps, locale),
              })
            : null
  const error = invalid
    ? word('errAmount')
    : create.aboveCap && maxIn
      ? word('buyAboveCap', { amount: formatNumber(Number(maxIn), locale, 2), symbol: preset.pair.symbol })
      : null
  const lock = create.lock
  return (
    <Card className="gap-3">
      <SectionTitle title={word('sectionBuy')} optional={word('optional')} />
      <Txt variant="ui" tone="muted">
        {word('buyHint')}
      </Txt>
      <View className="flex-row items-end gap-2">
        <Field
          className="flex-1"
          label={word('buyAmount')}
          value={create.buyText}
          onChangeText={create.setBuyText}
          placeholder="0"
          keyboardType="decimal-pad"
          editable={!locked}
          suffix={preset.pair.symbol}
          error={error}
          hint={hint}
        />
      </View>
      {maxIn ? (
        <View className="flex-row">
          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => create.setBuyText(maxIn)}
            className="h-11 justify-center rounded-pill border border-line px-4 active:bg-hover"
          >
            <Txt variant="ui">{`${word('buyMax')} · ${formatNumber(Number(maxIn), locale, 2)} ${preset.pair.symbol}`}</Txt>
          </Pressable>
        </View>
      ) : null}
      {create.buying ? (
        <View className="gap-2 rounded-sm border border-line px-3 py-3">
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: create.lockId !== null, disabled: locked }}
            disabled={locked}
            onPress={() => create.setLockId(create.lockId ? null : (locks[0]?.id ?? null))}
            className="flex-row items-start gap-3"
          >
            <Icon
              name={create.lockId ? 'lock-closed' : 'lock-open-outline'}
              size={18}
              color={create.lockId ? 'brand' : 'muted'}
              style={{ marginTop: 2 }}
            />
            <View className="flex-1 gap-1">
              <Txt variant="ui">{word('lockTitle')}</Txt>
              <Txt variant="labelSm" tone="faint" style={{ lineHeight: 16 }}>
                {word('lockHint')}
              </Txt>
            </View>
            <Icon
              name={create.lockId ? 'checkbox' : 'square-outline'}
              size={22}
              color={create.lockId ? 'brand' : 'fgMuted'}
            />
          </Pressable>
          {create.lockId ? (
            <>
              <ChoiceChips
                role="radiogroup"
                scroll
                disabled={locked}
                choices={locks.map((entry) => ({
                  value: entry.id,
                  label: word('lockSchedule', {
                    cliff: periodWord(entry.cliffDays, word),
                    vest: periodWord(entry.vestDays, word),
                  }),
                }))}
                value={create.lockId}
                onChange={create.setLockId}
              />
              {lock ? (
                <Txt variant="labelSm" tone="faint">
                  {word('lockUntil', {
                    date: formatDate(now + lock.cliffDays * 86_400_000, locale),
                    end: formatDate(now + (lock.cliffDays + lock.vestDays) * 86_400_000, locale),
                  })}
                </Txt>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  )
}

/** «Перед підписом»: the network, the preset, the first buy, the lock and what the creator pays — then the hard fact. */
function ReviewSection({ create, word, locale }: { create: LaunchCreate; word: LaunchWord; locale: Locale }) {
  const preset = create.preset!
  const lock = create.lock
  return (
    <Card className="gap-2">
      <SectionTitle title={word('review')} />
      <View>
        <Row label={word('reviewNetwork')} value="Solana" mono={false} />
        <Row label={word('reviewPreset')} value={preset.name[locale]} mono={false} />
        <Row
          label={word('reviewBuy')}
          value={
            create.buying && create.buyRaw !== null
              ? `${formatRaw(create.buyRaw, preset.pair.decimals, locale, preset.pair.decimals)} ${preset.pair.symbol}`
              : word('buyNone')
          }
          mono={create.buying}
        />
        {create.buying ? (
          <Row
            label={word('reviewLock')}
            value={
              lock
                ? word('lockSchedule', {
                    cliff: periodWord(lock.cliffDays, word),
                    vest: periodWord(lock.vestDays, word),
                  })
                : word('reviewNoLock')
            }
            mono={false}
          />
        ) : null}
        <Row
          label={word('reviewRent')}
          value={
            create.cost
              ? word('reviewRentExact', { sol: formatNumber(Number(fromRaw(create.cost, 9, 6)), locale, 6) })
              : word('reviewRentValue', {
                  sol: formatNumber(Number(lock ? COST_ESTIMATE_SOL.locked : COST_ESTIMATE_SOL.plain), locale, 3),
                })
          }
          mono={false}
        />
      </View>
      <View className="flex-row items-start gap-2 pt-1">
        <Icon name="warning-outline" size={16} color="warningInk" style={{ marginTop: 1 }} />
        <Txt variant="ui" tone="muted" className="flex-1">
          {word('reviewFixed')}
        </Txt>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(TERMS_URL).catch(() => undefined)}
        hitSlop={8}
        className="min-h-11 justify-center"
      >
        <Txt variant="ui" tone="muted">
          {word('termsLead')}{' '}
          <Txt variant="ui" tone="brand">
            {word('terms')}
          </Txt>
        </Txt>
      </Pressable>
    </Card>
  )
}

/**
 * What happened to the last press, docked above the action so it is seen
 * where the press was made: the wallet's own cancel said plainly, a refusal
 * said with what it means, the server's words one tap deeper.
 */
function FailureDock({ create, word }: { create: LaunchCreate; word: LaunchWord }) {
  const failure = create.failure
  const [detail, setDetail] = useState(false)
  if (create.phase !== 'error' || !failure) return null
  // The stop said by the form itself when the quote says it too; a build's own pause, said here, in the calm tone.
  if (failure.failure.code === 'LAUNCH_PAUSED')
    return create.paused ? null : (
      <View className="bg-ground px-4 pt-3">
        <Txt variant="ui" tone="muted" accessibilityLiveRegion="polite">
          {word('errLaunchingPaused')}
        </Txt>
      </View>
    )
  const lost = lostAfterSend(failure.failure)
  // A lost answer is settled by the token's read: landed — its own end screen; not found past the landing window — nothing landed.
  const text = lost && create.notLanded ? word('errSubmit') : word(createFailureKey(failure.failure))
  return (
    <View className="bg-ground px-4 pt-3">
      {failure.failure.code === 'WALLET_REFUSED' ? (
        // The person's own «cancel» in the wallet is not a failure: said plainly, in no warning colour.
        <Txt variant="ui" tone="muted" accessibilityLiveRegion="polite">
          {word('walletCancelled')}
        </Txt>
      ) : (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          className={`gap-2 rounded-sm border border-line px-3 py-3 ${lost && !create.notLanded ? 'bg-elevated' : 'bg-danger-soft'}`}
        >
          <View className="flex-row items-center gap-2">
            <Icon
              name={lost && !create.notLanded ? 'time-outline' : 'alert-circle'}
              size={18}
              color={lost && !create.notLanded ? 'muted' : 'dangerInk'}
            />
            <Txt variant="ui" tone={lost && !create.notLanded ? 'fg' : 'danger'}>
              {create.notLanded ? word('errTitle') : word(sendTitleKey(failure.failure, 'errTitle'))}
            </Txt>
          </View>
          <Txt variant="ui" tone="fg">
            {text}
          </Txt>
          {/* What may have landed is on the chain for anyone to see, whatever Ryntra's own read says. */}
          {lost && failure.token && !create.notLanded ? (
            <ExplorerLink label={word('view')} url={explorerUrl('solana:mainnet', 'account', failure.token)} />
          ) : null}
          {failure.failure.detail ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setDetail(!detail)}
              hitSlop={8}
              className="min-h-11 justify-center self-start"
            >
              <Txt variant="labelSm" tone="faint">
                {word('errDetails')} {detail ? '▴' : '▾'}
              </Txt>
            </Pressable>
          ) : null}
          {detail && failure.failure.detail ? (
            <Txt variant="data" tone="muted" selectable>
              {failure.failure.detail}
            </Txt>
          ) : null}
        </View>
      )}
    </View>
  )
}
