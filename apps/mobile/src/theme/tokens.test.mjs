import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { renderThemeCss } from './render-css.mjs'
import { brand, radius, spacing, themes, type } from './tokens.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const src = join(here, '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(tsx?|mjs|css)$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

test('tokens.css is the projection of tokens.ts', () => {
  const css = readFileSync(join(here, 'tokens.css'), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(css, renderThemeCss())
})

test('the brand values are the fixed ones', () => {
  assert.equal(brand.brand, '#FF681C')
  assert.equal(brand.brandHover, '#FF7A2F')
  assert.equal(brand.brandDeep, '#F24C0C')
  assert.equal(brand.honey, '#F5A524')
  assert.equal(themes.dark.ground, '#080D13')
  assert.equal(themes.dark.surface, '#0E1620')
  assert.equal(themes.dark.elevated, '#131E2A')
  assert.equal(themes.dark.line, '#22303E')
  assert.equal(themes.dark.fg, '#F5F7FA')
  assert.equal(themes.dark.success, '#19C77A')
  assert.equal(themes.dark.danger, '#FF4D55')
  assert.equal(themes.light.ground, '#F5F7FA')
  assert.equal(themes.light.surface, '#FFFFFF')
  assert.equal(themes.light.line, '#DDE3EA')
  assert.equal(themes.light.fg, '#111820')
  assert.equal(themes.light.success, '#169B62')
  assert.equal(themes.light.danger, '#E53E45')
  assert.deepEqual(Object.keys(themes.dark), Object.keys(themes.light))
  assert.deepEqual(Object.values(radius), [2, 4, 6, 8, 10, 12, 16, 20, 999])
  assert.deepEqual(Object.values(spacing), [4, 8, 12, 16, 24, 32, 48, 72])
})

test('the type ramp never drops below 11px and every figure face is mono', () => {
  for (const [name, style] of Object.entries(type)) {
    assert.ok(style.fontSize >= 11, `${name} is ${style.fontSize}px`)
    assert.ok(style.lineHeight >= style.fontSize, `${name} line height`)
  }
  assert.match(type.data.fontFamily, /^GeistMono/)
  assert.match(type.dataLg.fontFamily, /^GeistMono/)
  assert.match(type.body.fontFamily, /^Geist_/)
})

test('no colour escapes the token layer', () => {
  const palette =
    /\b(?:bg|text|border|from|to|via|fill|stroke|shadow|ring|outline|accent|decoration|caret)-(?:gray|neutral|slate|zinc|stone|red|green|blue|amber|yellow|orange|indigo|violet|purple|pink|rose|emerald|teal|cyan|sky|lime|fuchsia)-\d{2,3}\b/
  const hex = /#[0-9a-fA-F]{3,8}\b/
  const offenders = []
  for (const file of walk(src)) {
    if (file.startsWith(here)) continue
    const text = readFileSync(file, 'utf8')
    if (palette.test(text)) offenders.push(`${file}: default Tailwind palette`)
    if (hex.test(text)) offenders.push(`${file}: colour literal`)
  }
  assert.deepEqual(offenders, [])
})
