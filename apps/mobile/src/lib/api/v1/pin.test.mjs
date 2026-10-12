import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { API_CONTRACT_VERSION, API_MAJOR } from './types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pin = JSON.parse(readFileSync(join(here, 'PIN.json'), 'utf8'))

/** The git blob id of a file's LF content — what `git show <sha>:<path> | git hash-object --stdin` answers. */
function blobId(file) {
  const content = readFileSync(join(here, file), 'utf8').replace(/\r\n/g, '\n')
  const bytes = Buffer.from(content, 'utf8')
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

test("the pinned client copies are the web line's content at the named commit, unedited", () => {
  for (const [file, expected] of Object.entries(pin.files)) {
    assert.equal(blobId(file), expected, `${file} differs from ${pin.package} at ${pin.commit}`)
  }
})

test('the pin names the contract version the copies implement', () => {
  // A package whose constant lags its own types is pinned by what it carries, the lag named with its request (request 38).
  assert.equal(API_CONTRACT_VERSION, pin.packageConstant ?? pin.contractVersion)
  if (pin.packageConstant !== undefined) {
    assert.notEqual(pin.packageConstant, pin.contractVersion, 'a lag is named only when there is one')
    assert.match(pin.lag, /Request \d+ to line A/)
  }
  assert.equal(API_MAJOR, pin.contractMajor)
})

test('the copies carry what 1.19.0 added — the third kind of rule and its reminder’s own sum', () => {
  const types = readFileSync(join(here, 'types.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(types, /export type RuleKind = "schedule" \| "dip" \| "payments";/)
  assert.match(types, /export type RulePaymentMode = "roundup" \| "fixed" \| "percent";/)
  assert.match(types, /payments: RulePayments \| null;/)
  assert.match(types, /amountUsd: number \| null;\n[^\n]*\n\s*events: number \| null;/)
  assert.match(types, /ownAccount: "\/api\/v1\/rules\/payments\/own"/)
})

test('the copies carry what 1.20.0 added — «Перевірка» counted by the server on the quote and the order', () => {
  const types = readFileSync(join(here, 'types.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(types, /export type SwapCheck = Readonly<\{/)
  assert.equal(types.match(/^ {2}check: SwapCheck \| null;$/gm)?.length, 2)
})

test('the copies carry what 1.24.0 added — a `/build` order and the fee paid whole into Ryntra’s fee wallet', () => {
  const types = readFileSync(join(here, 'types.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(types, /path: "ORDER_EXECUTE" \| "BUILD_SUBMIT";/)
  assert.match(types, /"JUPITER_REFERRAL" \| "JUPITER_PLATFORM_FEE"/)
  assert.match(types, /ryntraFeeAccount\?: Readonly<\{ owner: string; account: string \}>;/)
})

test('the copies carry what 1.36.0 added — the markets launched on Ryntra, a market’s card and its health', () => {
  const types = readFileSync(join(here, 'types.ts'), 'utf8').replace(/\r\n/g, '\n')
  const client = readFileSync(join(here, 'client.ts'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(types, /export type LaunchMarketsResponse = Readonly<\{ network: LaunchNetworkId; markets: readonly LaunchMarketRow\[\]; complete: boolean; observedAt: string \}>;/)
  assert.match(types, /state: "NOT_COUNTED" \| "IN_POOL" \| "COUNTED";/)
  assert.match(types, /export type LaunchMarketEnforcement = "rule" \| "policy";/)
  assert.match(types, /holders: Readonly<\{ count: number \| null; atLeast: boolean; minUsd: 1 \}>;/)
  assert.match(client, /markets: \(\) => call<LaunchMarketsResponse>\("GET", "\/api\/v1\/launch\/markets"\)/)
})
