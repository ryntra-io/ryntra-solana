/**
 * A picture's bytes judged from its base64 text: how many there are, and
 * what the first of them say it is — PNG, JPEG, GIF or WebP, the server's own
 * four. Pure: the picture module and the tests read it.
 */

/** The number of bytes a base64 text carries. */
export function base64Bytes(base64: string): number {
  const clean = base64.replace(/\s+/g, '')
  if (!clean) return 0
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - padding
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The first bytes of a base64 text, decoded. */
export function headBytes(base64: string, count = 12): number[] {
  const text = base64.replace(/\s+/g, '').slice(0, Math.ceil(count / 3) * 4)
  const bytes: number[] = []
  for (let index = 0; index < text.length && bytes.length < count; index += 4) {
    const quad = [0, 1, 2, 3].map((offset) => ALPHABET.indexOf(text[index + offset] ?? '='))
    const [a = 0, b = 0, c = -1, d = -1] = quad
    bytes.push((a << 2) | (b >> 4))
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2))
    if (d >= 0) bytes.push(((c & 3) << 6) | d)
  }
  return bytes.slice(0, count)
}

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** The picture's type from its first bytes — what the file is, not what its name says. */
export function imageTypeOfBase64(base64: string): ImageType | null {
  const bytes = headBytes(base64, 12)
  const starts = (...head: number[]) => head.every((value, index) => bytes[index] === value)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp'
  return null
}
