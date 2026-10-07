/**
 * «Запустити токен» — what a creator fills in, held to the web's own rules
 * before anything is built: the name, the ticker and the picture go into the
 * token's mint for ever, so a typo cannot be fixed later by anyone. The server
 * checks every field again; this is the same check said as the person types.
 *
 * Pure: the screen and the tests read it.
 */

import { launchNameHits, type ModerationHit } from './moderation.ts'

export const NAME_MAX = 32
export const SYMBOL_MAX = 10
export const DESCRIPTION_MAX = 280
/** The picture after the phone has shrunk it: at most this many bytes. */
export const IMAGE_MAX_BYTES = 256 * 1024

export const LINK_KINDS = ['website', 'x', 'telegram'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

const LINK_HOSTS: Readonly<Record<LinkKind, readonly string[] | null>> = {
  website: null,
  x: ['x.com', 'twitter.com'],
  telegram: ['t.me', 'telegram.me'],
}

/** The bytes a text takes in UTF-8 — the mint's own measure of a name. */
export function utf8Length(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** Whether a link the creator typed is one the server takes: https, a host with a dot, no user part; X and Telegram on their own hosts. Empty is no link. */
export function linkProblem(kind: LinkKind, raw: string): boolean {
  const text = raw.trim()
  if (!text) return false
  const whole = /^https?:\/\//i.test(text) ? text : `https://${text}`
  const parts = /^(https?):\/\/([^/?#]*)([^?#]*)/i.exec(whole)
  if (!parts) return true
  const [, scheme = '', authority = '', path = ''] = parts
  if (scheme.toLowerCase() !== 'https' || authority.includes('@') || whole.length > 200) return true
  const host = authority.replace(/:\d+$/, '').toLowerCase()
  // Any letters — an international domain too — but no space, quote or bracket a host never holds.
  if (!host.includes('.') || /[\s<>"'`{}|\\^[\]()]/.test(host) || host.startsWith('.') || host.endsWith('.'))
    return true
  const hosts = LINK_HOSTS[kind]
  if (hosts && (!hosts.includes(host.replace(/^www\./, '')) || path.length < 2)) return true
  return false
}

export type LaunchFormFields = Readonly<{
  name: string
  symbol: string
  description: string
  website: string
  x: string
  telegram: string
}>

export const EMPTY_FORM: LaunchFormFields = { name: '', symbol: '', description: '', website: '', x: '', telegram: '' }

export type FieldProblem = 'REQUIRED' | 'TOO_LONG' | 'SYMBOL_CHARS' | 'LINK' | 'BORROWED'

export type FormCheck = Readonly<{
  problems: Readonly<Partial<Record<keyof LaunchFormFields, FieldProblem>>>
  /** The brands and people a name or ticker borrows. */
  hits: readonly ModerationHit[]
  /** The name and ticker as they go on chain: trimmed, the ticker in capitals. */
  clean: Readonly<{ name: string; symbol: string }>
}>

/** Every rule at once, so the form can mark each field. */
export function checkLaunchForm(fields: LaunchFormFields): FormCheck {
  const problems: Partial<Record<keyof LaunchFormFields, FieldProblem>> = {}
  const name = fields.name.trim().replace(/\s+/g, ' ')
  const symbol = fields.symbol.trim().replace(/^\$/, '').toUpperCase()
  const description = fields.description.trim()
  if (!name) problems.name = 'REQUIRED'
  else if (utf8Length(name) > NAME_MAX) problems.name = 'TOO_LONG'
  if (!symbol) problems.symbol = 'REQUIRED'
  else if (symbol.length > SYMBOL_MAX) problems.symbol = 'TOO_LONG'
  else if (!/^[A-Z0-9]+$/.test(symbol)) problems.symbol = 'SYMBOL_CHARS'
  if ([...description].length > DESCRIPTION_MAX) problems.description = 'TOO_LONG'
  for (const kind of LINK_KINDS) if (linkProblem(kind, fields[kind])) problems[kind] = 'LINK'
  const hits = launchNameHits({ name, symbol })
  for (const hit of hits) if (!problems[hit.field]) problems[hit.field] = 'BORROWED'
  return { problems, hits, clean: { name, symbol } }
}

/**
 * Which problem a field shows now: a borrowed name, a field too long and a
 * ticker's letters at once; a link once something is typed in it; an empty
 * required field only after the first press of «Запустити».
 */
export function shownProblem(
  check: FormCheck,
  key: keyof LaunchFormFields,
  fields: LaunchFormFields,
  attempted: boolean,
): FieldProblem | null {
  const problem = check.problems[key]
  if (!problem) return null
  if (problem === 'BORROWED' || problem === 'TOO_LONG' || problem === 'SYMBOL_CHARS') return problem
  if (problem === 'LINK' && fields[key].trim()) return problem
  return attempted ? problem : null
}
