import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { MAX_SIGNABLE_MS, MIN_WALLET_WINDOW_MS } from './bytes-life.ts'
import { WALLET_WAIT_MS } from './wallet-wait.ts'

/**
 * AG-2 (2026-10-17): Solana's slots are 200 ms and bytes live ~150 blocks ≈ 30 s. Two promises, held here:
 * 1. every place the phone hands a wallet bytes keeps them inside their life — a late signature is never sent, the
 *    operation is built again (once), and a wallet is never opened on bytes too short for it;
 * 2. no "may still land" clock gets shorter — "will not land" is the chain's word; shortening one could let live bytes
 *    be called dead and sent twice.
 */

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const read = (path) => readFileSync(join(SRC, path), 'utf8')

test('the window fits inside the bytes and leaves a wallet its time; the Ledger wait stays ninety seconds (M45)', () => {
  assert.ok(MAX_SIGNABLE_MS <= 30_000)
  assert.ok(MIN_WALLET_WINDOW_MS < MAX_SIGNABLE_MS)
  assert.equal(WALLET_WAIT_MS, 90_000)
})

/** Every flow that asks a wallet to sign transaction bytes, and the guard of their life it must hold. */
const GUARDED = {
  'features/trade/trade-flow.ts': [/mayOpenWallet\(/, /signableWindowClosed\(/],
  'features/money/send-flow.ts': [/signFresh</],
  'features/limits/limits-flow.ts': [/signFresh</, /freshUntil/],
  'features/launch/launch-flow.ts': [/signFresh</],
  'features/futures/orders-flow.ts': [/mayOpenWallet\(/, /signableWindowClosed\(/],
  'features/futures/collateral-api.ts': [/mayOpenWallet\(/, /signableWindowClosed\(/],
}

/**
 * The city's bridge (CITY-6c) hands the wallet bytes the page built and sends nothing: the page asked the engine for
 * them, signs through the app and sends them itself, so it — like the web (AG-1) — keeps their life. The app only relays
 * and must never send or build them.
 */
const RELAYED = ['features/city/city-host.ts', 'features/city/use-city-host.ts']

test('every flow that opens a wallet on transaction bytes guards their life — a new one joins this list or fails', () => {
  const found = []
  for (const entry of readdirSync(join(SRC, 'features'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) continue
    const path = relative(SRC, join(entry.parentPath ?? entry.path, entry.name)).replaceAll('\\', '/')
    if (path === 'features/wallet/use-wallet.ts') continue
    if (/\bwallet\.signTransactions?\(/.test(read(path))) found.push(path)
  }
  assert.deepEqual(found.sort(), [...Object.keys(GUARDED), ...RELAYED].sort())
  for (const path of RELAYED) {
    assert.doesNotMatch(
      read(path),
      /\bfetch\(|lib\/api|\/execute|sendTransaction/,
      `${path} relays bytes, never sends them`,
    )
  }
  for (const [path, rules] of Object.entries(GUARDED)) {
    for (const rule of rules) assert.match(read(path), rule, `${path} no longer guards its bytes' life (${rule})`)
  }
  // Every launch flow — create, trade, claim — goes through `signFresh`, and a placed limit is never relayed past its window.
  assert.equal(read('features/launch/launch-flow.ts').match(/signFresh</g)?.length, 3)
  assert.match(read('features/limits/limits-flow.ts'), /wait\.freshUntil != null && now\(\) > wait\.freshUntil/)
  assert.match(read('screens/trade/limit-panel.tsx'), /mayOpenWallet\(/)
  // AG-2b: one press. A Review whose bytes aged is renewed and the wallet opens on the fresh bytes by itself — never a
  // second Review the person has to press again (each read past ~15 s would age it once more).
  const useTrade = read('features/trade/use-trade.ts')
  assert.match(useTrade, /fresh = await \(renewal\.current \?\? renew\(current\)\)/)
  assert.match(useTrade, /freshOrderNoWorse\(current\.order\.order, fresh\.order\.order\)/)
  assert.match(useTrade, /prepared: current,\s+cancel,/)
  const limitPanel = read('screens/trade/limit-panel.tsx')
  assert.match(limitPanel, /return sign\(fresh, freshAt, true\)/)
  // A rebuild that comes back after the person left the Review opens nothing.
  assert.match(limitPanel, /if \(leaveSeq\.current !== seq\) return/)
  // A surface that goes ends its renewal: no wallet over another screen.
  assert.match(useTrade, /\(\) => \(\) => \{\s+ticket\.current \+= 1/)
  assert.doesNotMatch(limitPanel, /onPress=\{onRebuild\}/)
  // The limit's Review counts its window from the server's `signableMs`, not a fixed minute.
  assert.doesNotMatch(read('screens/trade/limit-panel.tsx'), /REVIEW_TTL_SECONDS = 60/)
  assert.match(read('screens/trade/limit-panel.tsx'), /reviewSignableMs\(/)
})

/** "May still land": the clocks that must never shrink below their 2026-10-17 values. */
const MAY_STILL_LAND = [
  ['features/money/money-model.ts', /export const BLOCKHASH_WINDOW_MS = (\d[\d_]*)/, 120_000],
  ['features/launch/use-create.ts', /const LANDING_WINDOW_MS = (\d[\d_]*)/, 180_000],
  ['features/trade/trade-flow.ts', /export const RECOVERY_DEADLINE_MS = (\d[\d_]*)/, 150_000],
  ['features/money/send-flow.ts', /const RESUME_DEADLINE_MS = (\d[\d_]*)/, 150_000],
  ['features/money/use-pay-links.ts', /const PAY_UNCONFIRMED_HOLD_MS = (\d[\d_]*)/, 180_000],
]

test("no 'may still land' clock is shortened", () => {
  for (const [path, pattern, floor] of MAY_STILL_LAND) {
    const match = read(path).match(pattern)
    assert.ok(match, `${path}: the clock is gone`)
    assert.ok(Number(match[1].replaceAll('_', '')) >= floor, `${path}: shorter than ${floor} ms`)
  }
})
