/**
 * The tokens a person hid on this phone: the picture, the description and the
 * links of a token launched on Ryntra are not drawn for them until they show
 * it again. Kept on the phone only, for whoever uses it — never sent, and not
 * a judgement on the token for anyone else. Pure: stored text in, a list out.
 */

/** Enough for anyone; the oldest hidden falls off past it. */
export const HIDDEN_LIMIT = 500

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/** The stored list, or an empty one when it is missing or not a list of addresses. */
export function parseHidden(stored: string | undefined | null): readonly string[] {
  if (!stored) return []
  try {
    const value: unknown = JSON.parse(stored)
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((mint): mint is string => typeof mint === 'string' && MINT.test(mint)))]
  } catch {
    return []
  }
}

/** The list with the token hidden or shown again; the newest last. */
export function toggleHidden(list: readonly string[], mint: string): readonly string[] {
  if (list.includes(mint)) return list.filter((entry) => entry !== mint)
  if (!MINT.test(mint)) return list
  return [...list, mint].slice(-HIDDEN_LIMIT)
}

/** The picture a place draws for a token: none once the person hid it on this phone — on its page and on every list. */
export function shownPicture(image: string | null, hidden: boolean): string | null {
  return hidden ? null : image
}
