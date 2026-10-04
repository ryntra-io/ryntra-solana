import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../app/gallery.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText

function render(development) {
  const loaded = []
  const exports = {}
  const Redirect = Symbol('Redirect')
  const GalleryScreen = Symbol('GalleryScreen')
  vm.runInNewContext(compiled, { exports, __DEV__: development, require(name) {
    loaded.push(name)
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) }
    if (name === 'expo-router') return { Redirect }
    if (name === '@/screens/gallery') return { GalleryScreen }
    throw new Error('Unexpected dependency')
  } })
  return { result: exports.default(), loaded, Redirect, GalleryScreen }
}

test('production gallery route redirects without loading sample screen', () => {
  const { result, loaded, Redirect } = render(false)
  assert.equal(result.type, Redirect)
  assert.equal(result.props.href, '/')
  assert.ok(!loaded.includes('@/screens/gallery'))
})

test('development gallery remains available with labelled non-broadcast samples', () => {
  const { result, loaded, GalleryScreen } = render(true)
  assert.equal(result.type, GalleryScreen)
  assert.ok(loaded.includes('@/screens/gallery'))
  const gallery = readFileSync(new URL('../screens/gallery.tsx', import.meta.url), 'utf8')
  assert.match(gallery, /label="Sample"/)
  assert.match(gallery, /sample = true/)
  const signatures = [...gallery.matchAll(/signature(?::\s*'|=")([^'"\r\n]+)/g)].map(match => match[1])
  assert.equal(signatures.length, 5)
  assert.ok(signatures.every(value => value.startsWith('sample')))
})
