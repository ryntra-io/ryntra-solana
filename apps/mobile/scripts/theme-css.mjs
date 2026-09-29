#!/usr/bin/env node
/**
 * Projects src/theme/tokens.ts into src/theme/tokens.css — the Uniwind theme
 * layer. Run `npm run theme:css` after changing tokens; `--check` exits
 * non-zero when the committed CSS is not what the tokens would produce.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderThemeCss } from '../src/theme/render-css.mjs'

const target = fileURLToPath(new URL('../src/theme/tokens.css', import.meta.url))
const expected = renderThemeCss()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    current = ''
  }
  if (current !== expected) {
    console.error('src/theme/tokens.css is out of date — run `npm run theme:css`.')
    process.exit(1)
  }
  console.log('tokens.css matches tokens.ts')
} else {
  writeFileSync(target, expected)
  console.log(`wrote ${target}`)
}
