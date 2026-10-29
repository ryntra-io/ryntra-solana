import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('..', import.meta.url))

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

const code = (path) => readFileSync(join(SRC, path), 'utf8')

test('one app for everyone: no screen branches on a «simple / pro» mode (C2)', () => {
  const mode = /\b(isPro|proMode|simpleMode|uiMode|viewMode|isSimple|isBeginner|isAdvanced)\b|\bsimple\s*[?=:]|<\w+[^>]*\ssimple(?=\s*\/?>|\s+\w)|mode\s*===?\s*['"](simple|pro|beginner|advanced|expert)['"]/
  const offenders = sources(SRC).filter((path) => mode.test(readFileSync(path, 'utf8')))
  assert.deepEqual(offenders, [])
})

test('the density is only spacing, read by the shared surfaces; a door never under 48dp', () => {
  assert.match(code('components/screen.tsx'), /space\.rhythm\[rhythm\]/)
  assert.match(code('components/card.tsx'), /padded && space\.card/)
  assert.match(code('components/door-row.tsx'), /min-h-12 [^`]*\$\{space\.door\}/)
  assert.match(code('components/asset-row.tsx'), /\$\{space\.row\}/)
  // A screen sets its rhythm, never a fixed gap the density cannot reach.
  const fixed = sources(SRC).filter((path) => /contentClassName="gap-/.test(readFileSync(path, 'utf8')))
  assert.deepEqual(fixed, [])
})

test('Home’s blocks are the person’s: held anywhere, arranged in one sheet, also from Settings', () => {
  const home = code('screens/home/investor.tsx')
  assert.match(home, /shownBlocks\(layout, available\)\.map/)
  assert.match(home, /<Holdable onHold=\{arrange\}>\{head\}<\/Holdable>/)
  assert.match(code('screens/settings/index.tsx'), /<ArrangeSheet visible=\{arranging\}/)
  assert.match(code('screens/settings/index.tsx'), /<DensityPicker labels=\{copy\.densities\} \/>/)
})
