import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { core } from './core-tokens.ts'
import { renderCoreTokensTs } from './render-core.mjs'
import { renderThemeCss } from './render-css.mjs'
import { contrast, motion, radius, spacing, themes, tint, type } from './tokens.ts'

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

test('core-tokens.ts is the projection of the core JSON copied from A2', () => {
  const json = JSON.parse(readFileSync(join(here, 'core-tokens.json'), 'utf8'))
  const ts = readFileSync(join(here, 'core-tokens.ts'), 'utf8').replace(/\r\n/g, '\n')
  const source = ts.match(/^ \* Source: (.+)$/m)?.[1]
  assert.ok(source, 'core-tokens.ts names its source')
  assert.equal(ts, renderCoreTokensTs(json, source))
  assert.deepEqual(JSON.parse(JSON.stringify(core)), json)
  assert.equal(core.default, 'graphite')
})

test("every colour of both themes is the core's own, or its tint", () => {
  const pairs = [
    ['dark', core.themes.graphite],
    ['light', core.themes.porcelain],
  ]
  for (const [name, { color: palette, effect }] of pairs) {
    const own = new Set([...Object.values(palette), effect.scrim])
    const tints = new Set(Object.values(palette).flatMap((hex) => [0.12, 0.13, 0.14, 0.22, 0.3, 0.32, 0.45].map((a) => tint(hex, a))))
    for (const [key, value] of Object.entries(themes[name])) {
      assert.ok(own.has(value) || tints.has(value), `${name}.${key} = ${value} is not a core colour`)
    }
  }
  assert.deepEqual(Object.keys(themes.dark), Object.keys(themes.light))
})

test("Graphite is the dark theme: the web's ground, surface, border, text and orange", () => {
  assert.equal(themes.dark.ground, '#080D13')
  assert.equal(themes.dark.surface, '#0E1620')
  assert.equal(themes.dark.line, '#1C2A3A')
  assert.equal(themes.dark.fg, '#F5F7FA')
  assert.equal(themes.dark.brand, '#FF681C')
  assert.equal(themes.light.ground, '#F5F7FA')
  assert.equal(themes.light.surface, '#FFFFFF')
  assert.equal(themes.light.brand, '#E85A12')
  assert.equal(themes.light.brandInk, '#C04A0F')
})

test('words hold 4.5:1 where they stand: text, captions, orange words, words on orange and on red', () => {
  for (const name of ['dark', 'light']) {
    const c = themes[name]
    for (const ground of [c.ground, c.surface, c.elevated]) {
      for (const word of [c.fg, c.muted, c.brandInk, c.successInk, c.dangerInk, c.warningInk]) {
        assert.ok(contrast(word, ground) >= 4.5, `${name}: ${word} on ${ground} is ${contrast(word, ground).toFixed(2)}`)
      }
    }
    assert.ok(contrast(c.onBrand, c.brand) >= 4.5, `${name}: on brand`)
    assert.ok(contrast(c.onDanger, c.danger) >= 4.5, `${name}: on danger`)
    // Text on orange is dark.
    assert.ok(contrast(c.onBrand, '#000000') < contrast(c.onBrand, '#FFFFFF'), `${name}: on-brand is dark`)
  }
})

test("radii, spacing and motion are the core's", () => {
  assert.deepEqual(Object.values(radius), [2, 4, 6, 8, 10, 12, 16, 20, 999])
  assert.deepEqual(Object.values(spacing), [4, 8, 12, 16, 24, 32, 48, 72])
  assert.deepEqual([radius.xs, radius.btn, radius.sm, radius.md, radius.pill], Object.values(core.radius))
  assert.deepEqual(motion, { fast: core.motion.fast, base: core.motion.base })
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
    // The city's own look (decision 75, brand CITY-11) is its one palette: the night, the flare, the pearl.
    if (file.endsWith(join('features', 'city', 'city-look.ts'))) continue
    const text = readFileSync(file, 'utf8')
    if (palette.test(text)) offenders.push(`${file}: default Tailwind palette`)
    if (hex.test(text)) offenders.push(`${file}: colour literal`)
  }
  assert.deepEqual(offenders, [])
})
