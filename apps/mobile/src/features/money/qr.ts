/**
 * A QR code as one SVG path — pure. The encoder is `qrcode`'s core (the same
 * library the web draws its codes with), without its canvas and file
 * renderers; each dark run of a row becomes one rectangle, so a code is a
 * single path the phone draws at any size, crisp, in the theme's ink.
 */

import qrcode from 'qrcode/lib/core/qrcode.js'

export type QrPath = Readonly<{ size: number; path: string }>

/** The code for `text` at error correction M (as the web's), as a path on a `size × size` grid. */
export function qrPath(text: string): QrPath {
  const { modules } = qrcode.create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = modules
  let path = ''
  for (let y = 0; y < size; y += 1) {
    let x = 0
    while (x < size) {
      if (!data[y * size + x]) {
        x += 1
        continue
      }
      let end = x
      while (end < size && data[y * size + end]) end += 1
      path += `M${x} ${y}h${end - x}v1h${x - end}z`
      x = end
    }
  }
  return { size, path }
}
