/**
 * The sheet's own keypad (NEW-LOOK §3): digits, the language's decimal mark
 * and a delete — pure. The field holds what a person typed, in their own shape
 * («5,50» in Ukrainian, «5.50» in English); the trade reads either mark.
 */

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'mark' | 'delete'

/** The keys in the pad's order, three to a row: 1 2 3 · 4 5 6 · 7 8 9 · mark 0 delete. */
export const PAD_KEYS: readonly PadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'mark', '0', 'delete']

/** A sum said in dollars takes cents only (ST-5 r9): «$5,22», never «$5,222». */
export const DOLLAR_PLACES = 2

/** The longest figure a person types: nine whole digits and the places the asset holds. */
const MAX_WHOLE = 9

/**
 * The field after one key. A second mark, a digit past the asset's places or past nine whole digits, and a zero
 * before a whole number are not taken; the mark first writes «0,»; delete takes the last character.
 */
export function pressKey(text: string, key: PadKey, mark: ',' | '.', places: number | null): string {
  if (key === 'delete') return text.slice(0, -1)
  const at = text.search(/[.,]/)
  if (key === 'mark') {
    if (places === 0 || at !== -1) return text
    return text.length === 0 ? `0${mark}` : `${text}${mark}`
  }
  if (at !== -1) {
    const fraction = text.length - at - 1
    if (places !== null && fraction >= places) return text
    return `${text}${key}`
  }
  if (text === '0') return key
  if (text.length >= MAX_WHOLE) return text
  return `${text}${key}`
}

/**
 * A field typed with the system keyboard under the keypad's own rules (ST-5 r10: the Limit's spend kept «007» and lost
 * its grouping): the grouping it was drawn with taken off — a space in Ukrainian; in English every comma but one just
 * typed at the end of a field with no «.», which a keyboard with a decimal comma means as the mark — either decimal
 * mark read as the language's one, then every character as a key of `pressKey`: no zero before a whole number, one
 * mark, no digit past the asset's places or nine whole digits.
 */
export function typedField(text: string, mark: ',' | '.', places: number | null): string {
  let plain = text.replace(/[\s  ]/g, '')
  if (mark === '.') {
    const markLast = plain.endsWith(',') && !plain.includes('.')
    plain = plain.replace(/,/g, '') + (markLast ? '.' : '')
  }
  let field = ''
  for (const char of plain) {
    if (char >= '0' && char <= '9') field = pressKey(field, char as PadKey, mark, places)
    else if (char === ',' || char === '.') field = pressKey(field, 'mark', mark, places)
  }
  return field
}

/**
 * The field in the language's shape after the language changes (ST-5 r8): its one decimal mark is the new language's,
 * every digit stays — «0,00001» typed in Ukrainian reads «0.00001» in English, the same amount, and the keypad's own
 * mark is the field's again.
 */
export function withMark(text: string, mark: ',' | '.'): string {
  return text.replace(/[.,]/, mark)
}
