import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/*
 * The one attempt per wallet is the record that stops a duplicate (canon Part
 * A §10.3): a signature whose send could not be confirmed must reach the
 * screen at once, so its one action is the check — never a new purchase the
 * store would refuse. Seen on the Owner's Seeker on 2026-09-28 (M26's
 * acceptance): the send failed after the signature, the attempt was stored,
 * and the purchase sheet went on offering «Купити» because the React Compiler
 * had kept the first render's read of the store by the wallet alone. The hook
 * is built here by the app's own compiler, and the attempt must be parsed
 * again whenever the stored text changes.
 */

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('./trade-store.ts', import.meta.url), 'utf8')

function compiledHook() {
  const babel = require('@babel/core')
  const out = babel.transformSync(source, {
    filename: 'trade-store.ts',
    babelrc: false,
    configFile: false,
    presets: [require.resolve('@babel/preset-typescript')],
    plugins: [[require.resolve('babel-plugin-react-compiler'), {}]],
  }).code
  const start = out.indexOf('function useAttempt')
  const end = out.indexOf('\n}\n', start)
  return out.slice(start, end + 2)
}

test('the open attempt is the store’s own text, parsed again whenever that text changes — as the compiler builds it', () => {
  const hook = compiledHook()
  // The snapshot is the stored text, read on every check React makes.
  assert.match(hook, /useSyncExternalStore\(subscribe, \w+, \w+\)/)
  assert.match(source, /\(\) => storedAttempt\(taker\)/)
  // The parse is kept only while the stored text is the same — never by the wallet alone.
  const kept = /if \(\$\[\d+\] !== (\w+)\) \{\s*(\w+) = parseTradeAttempt\(\1\)/.exec(hook)
  assert.ok(kept, 'the attempt is parsed from the stored text')
  assert.match(hook, new RegExp(`const ${kept[1]} = stored \\?\\? undefined`))
  assert.doesNotMatch(hook, /getAttempt\(taker\)/, 'no read of the store the compiler could keep by the wallet')
  assert.doesNotMatch(source, /getVersion|let version/, 'no snapshot that only counts writes')
})

test('the prepare step and the screen read the same record: the store’s getter is the parse of the same text', () => {
  assert.match(
    source,
    /export function getAttempt\(taker: string\): TradeAttempt \| null \{\s*return parseTradeAttempt\(storage\.getString\(key\(taker\)\)\)/,
  )
  assert.match(source, /return taker \? \(storage\.getString\(key\(taker\)\) \?\? null\) : null/)
})
