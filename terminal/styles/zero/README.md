# The terminal's plain zero

`ryntra-zero.woff2` is one glyph: the digit zero of Hubot Sans without the bar across it. Every form of the zero is kept — the proportional one, the tabular
one, the numerator and the denominator — with the advances and the weight and width axes of Hubot Sans, so a column of
tabular figures keeps its width. One face does not kern with another: where figures are proportional, a pair with the
zero loses Hubot's kerning — a pixel or two at a headline's size. `terminal/styles/zero.ts` loads it for U+0030 alone,
first in the numbers' stack.

## How it is built

```
python terminal/styles/zero/build.py <Hubot Sans latin .woff2> terminal/styles/zero/ryntra-zero.woff2
```

The source is Hubot Sans as the build serves it: the Latin file `next/font/google` downloads for
`Hubot_Sans({ subsets: ['latin'], axes: ['wdth'] })` (`city/styles/fonts.ts`) — after `next build`, the preloaded
`.next/static/media/*-s.p.woff2` whose family is Hubot Sans. The script needs Python with `fontTools` and `brotli`.
Build it again only if the face of the numbers changes.

## Licence

Hubot Sans — Copyright 2021 The Hubot Sans Project Authors (https://github.com/github/hubot-sans), with Reserved Font
Name "Hubot" — is licensed under the SIL Open Font License, Version 1.1 (`OFL.txt` beside this file;
https://openfontlicense.org). This derived font is distributed under the same licence and, as the licence asks, under
another name («Ryntra Zero»); the copyright notice and the licence's address also stand in the font's own name table.
