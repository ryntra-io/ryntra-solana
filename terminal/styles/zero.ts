import localFont from 'next/font/local';

/**
 * The terminal's plain zero. Hubot Sans — the face
 * of the numbers — draws its zero with a bar across it, so a price read as «$θ,2544», and the face offers no plain one.
 * `./zero/ryntra-zero.woff2` is that same zero without the bar (`./zero/build.py`): the same advance in every form, the
 * tabular one too, and the same weight and width axes — so a column of tabular figures keeps its width. One face does
 * not kern with another: where figures are proportional, a pair with the zero loses Hubot's kerning (a pixel or two at
 * a headline's size).
 *
 * It stands first in the numbers' stack (`--display`, `./terminal.module.css`) for U+0030 alone: every other digit and
 * letter stays Hubot Sans. Only the terminal's root carries it — the city and the share cards keep their numbers.
 */
export const ZERO = localFont({
  src: './zero/ryntra-zero.woff2',
  variable: '--font-zero',
  weight: '200 900',
  display: 'swap',
  adjustFontFallback: false,
  declarations: [
    { prop: 'font-stretch', value: '75% 125%' },
    { prop: 'unicode-range', value: 'U+0030' },
  ],
});
