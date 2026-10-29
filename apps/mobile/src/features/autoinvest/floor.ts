/**
 * «Регулярна купівля для всього» on the phone — the pure half of a token's
 * rule.
 *
 * A rule names any token with liquidity: a company (as since 1.12.0), a coin
 * the venue verified (`crypto`), a meme or a token the venue has not verified
 * (`meme`). A token of the venue's list stands on **the floor** — $25 000 in
 * its pools and 24 hours since its first pool, read now — when the rule is
 * written, turned on again, at every reminder and at the order itself; under
 * it, or unread, the purchase waits. For a meme or a new token **the facts of
 * its risk** — its age, liquidity, the ten largest holders, who can still mint
 * or freeze it, its organic score and the venue's list — are said before the
 * button: facts as the venue states them, never a verdict.
 *
 * The words are the web line's own (`lib/autoinvest/floor.ts`,
 * `app/app/invest/invest-words.ts`), so the phone and ryntra.io say the same
 * thing of the same token. Pure: nothing here reads the network.
 */

import type { RuleAssetRead, RuleFloorCheck } from '../../lib/api/v1/types.ts'
import type { Locale } from '../../lib/i18n.ts'

/** The floor as production states it (`capabilities.rules.assets.floor`) — the words below say these figures. */
export const RULE_FLOOR_LIQUIDITY_USD = 25_000
export const RULE_FLOOR_AGE_HOURS = 24

const numberTag = (locale: Locale): string => (locale === 'uk' ? 'uk-UA' : 'en-US')

/** Whether a rule's asset is a token of the venue's list — a coin, a meme or a new token — rather than a company. */
export function isListedToken(asset: Readonly<{ kind?: string | null }>): boolean {
  return asset.kind === 'crypto' || asset.kind === 'meme'
}

const wholeUsd = (value: number, locale: Locale): string =>
  `$${new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: 0 }).format(Math.round(value))}`

/** Liquidity as a market's header says it: «$7,2 млн» · «$7.2M». */
export function compactUsd(value: number, locale: Locale): string {
  return `$${new Intl.NumberFormat(numberTag(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
}

/** «ліквідність від $25 000 і від 24 годин на ринку» · «$25,000 of liquidity and 24 hours on the market». */
export function floorTerms(locale: Locale): string {
  return locale === 'uk'
    ? `ліквідність від ${wholeUsd(RULE_FLOOR_LIQUIDITY_USD, 'uk')} і від ${RULE_FLOOR_AGE_HOURS} годин на ринку`
    : `${wholeUsd(RULE_FLOOR_LIQUIDITY_USD, 'en')} of liquidity and ${RULE_FLOOR_AGE_HOURS} hours on the market`
}

/** An age the way a person reads it: «5 год» · «3 дн.» · «5 h» · «3 d». */
export function ageWord(hours: number, locale: Locale): string {
  if (hours < 48) return locale === 'uk' ? `${hours} год` : `${hours} h`
  const days = new Intl.NumberFormat(numberTag(locale)).format(Math.floor(hours / 24))
  return locale === 'uk' ? `${days} дн.` : `${days} d`
}

/**
 * Why a token stands below the floor, or why it cannot be judged, in one
 * sentence — after the token's name where a line needs it («BONK: ліквідність
 * $18 400 — нижче порогу $25 000»); with an empty name, where the token is
 * already on the screen, the sentence starts itself.
 */
export function floorLine(check: RuleFloorCheck, name: string, locale: Locale): string {
  const said = (sentence: string): string =>
    name ? `${name}: ${sentence}` : `${sentence.charAt(0).toLocaleUpperCase(numberTag(locale))}${sentence.slice(1)}`
  if (check.verdict === 'below') {
    const thin = check.liquidityUsd !== null && check.liquidityUsd < check.floorUsd
    if (locale === 'uk')
      return said(
        thin
          ? `ліквідність ${wholeUsd(check.liquidityUsd as number, 'uk')} — нижче порогу ${wholeUsd(check.floorUsd, 'uk')}`
          : `на ринку ${ageWord(check.ageHours ?? 0, 'uk')} — поріг ${check.minAgeHours} годин`,
      )
    return said(
      thin
        ? `liquidity ${wholeUsd(check.liquidityUsd as number, 'en')} — below the floor of ${wholeUsd(check.floorUsd, 'en')}`
        : `on the market for ${ageWord(check.ageHours ?? 0, 'en')} — the floor is ${check.minAgeHours} hours`,
    )
  }
  if (check.verdict === 'unavailable')
    return said(locale === 'uk' ? 'ліквідність зараз не прочитати' : 'liquidity cannot be read right now')
  return locale === 'uk' ? `Поріг виконано: ${floorTerms('uk')}` : `On the floor: ${floorTerms('en')}`
}

/**
 * A floor that is met, with what the token stands on, each figure with its word: «Виконано · ліквідність $7,2 млн ·
 * 1 022 дн. на ринку» · «Met · liquidity $7.2M · 1,022 d on the market».
 */
export function floorMetLine(check: RuleFloorCheck, locale: Locale): string {
  const liquidity =
    check.liquidityUsd === null
      ? null
      : `${locale === 'uk' ? 'ліквідність' : 'liquidity'} ${compactUsd(check.liquidityUsd, locale)}`
  const age =
    check.ageHours === null ? null : `${ageWord(check.ageHours, locale)} ${locale === 'uk' ? 'на ринку' : 'on the market'}`
  return [locale === 'uk' ? 'Виконано' : 'Met', liquidity, age].filter(Boolean).join(' · ')
}

/** The floor's line as a sheet says it under «Поріг регулярної купівлі»: what the token stands on, or why it does not. */
export function floorStanding(check: RuleFloorCheck, locale: Locale): string {
  return check.verdict === 'met' ? floorMetLine(check, locale) : floorLine(check, '', locale)
}

/** One fact of a token's risk, as a sheet lists it — `caution` where the venue's own figure is one a person should weigh. */
export type RiskRow = Readonly<{ key: string; label: string; value: string; caution: boolean }>

export type RiskWords = Readonly<{
  riskAge: string
  riskLiquidity: string
  riskTopHolders: string
  riskMint: string
  riskFreeze: string
  riskOrganic: string
  riskVerified: string
  riskClosed: string
  riskOpen: string
  riskVerifiedYes: string
  riskVerifiedNo: string
  riskNotStated: string
}>

/**
 * The facts of a meme's or a new token's risk, in the web's order: its age,
 * liquidity, the ten largest holders, who can still mint or freeze it, the
 * organic score and the venue's list. `compact` leaves out what a token's
 * page already states above the sheet — its age, liquidity and holders — as
 * the web's order inside Spot does. Null for a company, and for a coin the
 * venue verified (only a meme's facts are said).
 */
export function riskRows(
  read: Pick<RuleAssetRead, 'class' | 'risk'>,
  words: RiskWords,
  locale: Locale,
  compact = false,
): readonly RiskRow[] | null {
  const risk = read.risk
  if (read.class !== 'meme' || !risk) return null
  const pct = (value: number) => {
    const figure = new Intl.NumberFormat(numberTag(locale), { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)
    return locale === 'uk' ? `${figure} %` : `${figure}%`
  }
  const authority = (disabled: boolean | null) =>
    disabled === null ? words.riskNotStated : disabled ? words.riskClosed : words.riskOpen
  const rows: RiskRow[] = []
  if (!compact) {
    rows.push({
      key: 'age',
      label: words.riskAge,
      value: risk.ageHours === null ? words.riskNotStated : ageWord(risk.ageHours, locale),
      caution: false,
    })
    rows.push({
      key: 'liquidity',
      label: words.riskLiquidity,
      value: risk.liquidityUsd === null ? words.riskNotStated : compactUsd(risk.liquidityUsd, locale),
      caution: false,
    })
    rows.push({
      key: 'holders',
      label: words.riskTopHolders,
      value: risk.topHoldersPct === null ? words.riskNotStated : pct(risk.topHoldersPct),
      caution: risk.topHoldersPct !== null && risk.topHoldersPct >= 50,
    })
  }
  rows.push({
    key: 'mint',
    label: words.riskMint,
    value: authority(risk.mintAuthorityDisabled),
    caution: risk.mintAuthorityDisabled === false,
  })
  rows.push({
    key: 'freeze',
    label: words.riskFreeze,
    value: authority(risk.freezeAuthorityDisabled),
    caution: risk.freezeAuthorityDisabled === false,
  })
  rows.push({
    key: 'organic',
    label: words.riskOrganic,
    value: risk.organicScore === null ? words.riskNotStated : `${Math.round(risk.organicScore)} / 100`,
    caution: false,
  })
  rows.push({
    key: 'verified',
    label: words.riskVerified,
    value: risk.verified ? words.riskVerifiedYes : words.riskVerifiedNo,
    caution: !risk.verified,
  })
  return rows
}

/** What a rule on the token stands on, as the sheet reads it: being read, read, refused outright, or unread. */
export type RuleAssetStatus = 'idle' | 'reading' | 'ready' | 'refused' | 'failed'

/**
 * Why no rule can be turned on for a token right now — said before the
 * button, which then turns nothing on: refused outright (a mint nothing
 * knows), unread, under the floor, flagged by the venue's own audit, or the
 * floor's figures unread. Null when a rule can stand. The web's own order.
 */
export type TokenBlock = 'noRule' | 'unreadable' | 'flagged'

export function tokenBlockOf(status: RuleAssetStatus, read: RuleAssetRead | null): TokenBlock | null {
  if (status === 'refused') return 'noRule'
  if (status === 'failed') return 'unreadable'
  if (!read) return null
  if (read.refusal) return read.refusal.code === 'RULE_LIQUIDITY_LOW' ? 'noRule' : 'flagged'
  if (read.floor && read.floor.verdict !== 'met') return 'unreadable'
  return null
}

/**
 * A write refused on a token's rule, in the sheet's words — turning one on
 * (`create`) or turning it on again (`change`): under the floor, flagged by
 * the venue's audit, or the token's figures unread. Null where the refusal is
 * not the token's and the rule's own words say it.
 */
export type TokenWriteFailure = 'noRuleOnToken' | 'floorRefusesTurnOn' | 'tokenNotSupported' | 'tokenUnreadable'

export function tokenWriteFailure(
  code: string | null | undefined,
  write: 'create' | 'change',
): TokenWriteFailure | null {
  if (code === 'RULE_LIQUIDITY_LOW') return write === 'create' ? 'noRuleOnToken' : 'floorRefusesTurnOn'
  if (code === 'ASSET_UNCONFIRMED' && write === 'change') return 'tokenNotSupported'
  if (code === 'UNAVAILABLE') return 'tokenUnreadable'
  return null
}

/** The floor's own judgement that holds a deferred purchase back — said first: a thin pool is the reason whatever the price says. */
export function floorHeld(occurrence: Readonly<{ floor?: RuleFloorCheck }> | null | undefined): RuleFloorCheck | null {
  const floor = occurrence?.floor
  return floor && floor.verdict !== 'met' ? floor : null
}
