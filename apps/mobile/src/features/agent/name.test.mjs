import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { AGENT_COPY } from './copy.ts'

const APP = fileURLToPath(new URL('../../../', import.meta.url))
const SRC = join(APP, 'src')
// The contract client is the web app's pinned copy, kept byte for byte; its comments are not the app's words.
const PINNED = join(SRC, 'lib', 'api', 'v1')

/** Every file the app is built from: its source (not the tests, not the pinned contract copy) and its app config. */
function appFiles(dir = SRC) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (path !== PINNED) files.push(...appFiles(path))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

test('the assistant is Ryntra wherever the app speaks: the name Ryn is in none of its files', () => {
  const found = []
  for (const file of [...appFiles(), join(APP, 'app.json'), join(APP, 'app.config.js')]) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/\bRyn\b/.test(line)) found.push(`${relative(APP, file)}:${index + 1}`)
      })
  }
  // Internal ids may keep the old stem (`RynTurn`, `askRyn`, the route `/ryn`): none of them is a word a person reads.
  assert.deepEqual(found, [])
})

test('where Ryntra speaks it is labelled an AI, and the decision and the signature are the person’s', () => {
  assert.equal(AGENT_COPY.en.title, 'Ryntra · AI assistant')
  assert.equal(AGENT_COPY.uk.title, 'Ryntra · ШІ-помічник')
  assert.equal(AGENT_COPY.en.who, 'Ryntra')
  assert.equal(AGENT_COPY.uk.who, 'Ryntra')
  // The product's own line under the title: «Ryntra — ШІ; рішення й підпис — твої».
  assert.equal(AGENT_COPY.en.lead, 'Ryntra is an AI; the decision and the signature are yours.')
  assert.equal(AGENT_COPY.uk.lead, 'Ryntra — ШІ; рішення й підпис — твої.')
  assert.equal(AGENT_COPY.en.askRyn, 'Ask Ryntra')
  assert.equal(AGENT_COPY.uk.askRyn, 'Спитати Ryntra')
})
