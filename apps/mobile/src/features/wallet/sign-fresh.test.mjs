import assert from 'node:assert/strict'
import { test } from 'node:test'

import { signFresh } from './sign-fresh.ts'

/** A phone clock and a wallet (or a Ledger behind it) that takes as long as the script says. */
function stand(walletSeconds, signableMs = 25_000) {
  let clock = 0
  let builds = 0
  const signedBuilds = []
  const reasons = []
  const run = () =>
    signFresh({
      now: () => clock,
      build: async () => ((builds += 1), { ok: true, data: { id: builds, signableMs } }),
      signableMsOf: (b) => b.signableMs,
      sign: async (b) => {
        clock += (walletSeconds[b.id - 1] ?? 1) * 1_000
        signedBuilds.push(b.id)
        return { ok: true, value: `sig-${b.id}` }
      },
      onRebuild: (why) => reasons.push(why),
    })
  return { run, signedBuilds, reasons }
}

test('a wallet that answers inside the window: one build, those bytes go', async () => {
  const s = stand([8])
  const out = await s.run()
  assert.equal(out.ok, true)
  assert.equal(out.builds, 1)
})

for (const seconds of [25, 30, 45, 60, 90]) {
  test(`a Ledger that confirms after ${seconds} s: built again and asked once more, never sent dead`, async () => {
    const s = stand([seconds, 6])
    const out = await s.run()
    assert.equal(out.ok, true)
    assert.equal(out.built.id, 2)
    assert.deepEqual(s.reasons, ['late'])
  })
}

test('two late answers in a row stop with `late` — the screen tells the person; nothing sent', async () => {
  const s = stand([40, 40, 40])
  const out = await s.run()
  assert.deepEqual(out, { ok: false, stage: 'aged', late: true })
  assert.deepEqual(s.signedBuilds, [1, 2])
})

test('bytes too short for a wallet never open it', async () => {
  const s = stand([1], 4_000)
  const out = await s.run()
  assert.deepEqual(out, { ok: false, stage: 'aged', late: false })
  assert.deepEqual(s.signedBuilds, [])
})

test('a refused build or wallet is answered as itself', async () => {
  const refused = await signFresh({
    build: async () => ({ ok: false, failure: 'INTENT_EXPIRED' }),
    signableMsOf: () => 25_000,
    sign: async () => assert.fail('no wallet without bytes'),
  })
  assert.deepEqual(refused, { ok: false, stage: 'build', failure: 'INTENT_EXPIRED' })
  const declined = await signFresh({
    build: async () => ({ ok: true, data: 'b' }),
    signableMsOf: () => undefined,
    sign: async () => ({ ok: false, error: 'cancelled' }),
  })
  assert.deepEqual(declined, { ok: false, stage: 'sign', error: 'cancelled', built: 'b' })
})
