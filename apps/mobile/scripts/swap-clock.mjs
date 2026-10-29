#!/usr/bin/env node
/**
 * The swap's stand clocks (ST-3): how long the phone itself keeps a person waiting at each step the device cannot show
 * without money — the send's answer, «Готово» after a slow or a «still pending» answer, a press made while the Review
 * renews its bytes. The real flow (`trade-flow.ts`) and the real request (`lib/api.ts`) run against doubles of the
 * server and the chain with set latencies; nothing reaches a network, a wallet or a key.
 *
 *   node --no-warnings scripts/swap-clock.mjs
 *
 * Each line: the scenario, what the person ends on, and the time to it on the virtual clock.
 */
import { getBase64Decoder, getBase64Encoder } from '@solana/kit'

import { ApiError, executeSwap } from '../src/lib/api.ts'
import * as flow from '../src/features/trade/trade-flow.ts'
import { REQUIRED_RULES } from '../src/features/trade/trade-model.ts'
import { mayOpenWallet } from '../src/features/wallet/bytes-life.ts'

const TAKER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const session = { address: TAKER, token: 'stand-double-token-0123456789', issuedAt: 'now', expiresAt: 'later', sessionId: null }

function base58ToBytes(text) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let value = 0n
  for (const char of text) value = value * 58n + BigInt(ALPHABET.indexOf(char))
  const bytes = []
  while (value > 0n) {
    bytes.unshift(Number(value % 256n))
    value /= 256n
  }
  return new Uint8Array(bytes)
}
function unsignedWire() {
  const message = new Uint8Array([1, 0, 0, 1, ...base58ToBytes(TAKER), ...new Uint8Array(32), 0])
  const wire = new Uint8Array(1 + 64 + message.length)
  wire[0] = 1
  wire.set(message, 65)
  return getBase64Decoder().decode(wire)
}
const signed = (wire) => {
  const bytes = new Uint8Array(getBase64Encoder().encode(wire))
  bytes.fill(7, 1, 65)
  return getBase64Decoder().decode(bytes)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Real time runs this many times faster than the virtual clock the lines report. */
const SPEED = 20
const scaled = (ms) => sleep(ms / SPEED)

function prepared(receivedAtMs) {
  const wire = unsignedWire()
  return {
    receivedAtMs,
    context: {
      mode: 'swap',
      pay: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', icon: null, decimals: 9 },
      receive: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', icon: null, decimals: 6 },
      payDecimals: 9,
      receiveDecimals: 6,
      inAmountRaw: '50000000',
      outAmountRaw: '5020000',
      minReceivedRaw: '4990000',
    },
    order: {
      signableMs: 25_000,
      expiresAt: new Date(receivedAtMs + 60_000).toISOString(),
      preSign: { ready: true, code: 'READY', reason: '' },
      policy: { verdict: { decision: 'ALLOW', findings: REQUIRED_RULES.map((rule) => ({ rule, outcome: 'PASS' })) } },
      proof: { status: 'SIGNED', digest: '0xabc' },
      simulation: { status: 'OK', ownerEffects: { status: 'VERIFIED', outputAmountRaw: '5020000', inputAmountRaw: '50000000' } },
      bundle: {},
      decimals: {},
      order: { requestId: 'req-clock', transactionBase64: wire, inAmountRaw: '50000000', outAmountRaw: '5020000' },
    },
  }
}

const memory = () => {
  const held = new Map()
  return { get: (t) => held.get(t) ?? null, set: (a) => held.set(a.taker, a), clear: (t) => held.delete(t) }
}

/** The server's execute behind `lib/api.ts`'s own request: answers after `ms` (virtual) with `status` and `state`. */
function serverExecute(ms, status, state) {
  globalThis.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify({ state, signature: 'sig', observation: null, facts: null, receipt: null }), {
              status,
              headers: { 'content-type': 'application/json' },
            }),
          ),
        ms,
      )
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
    })
}

/** One send on the real clock (the execute's own timeout is real): from the wallet's answer to what the person sees. */
async function send(label, executeMs, status, state, chain) {
  serverExecute(executeMs, status, state)
  const attempts = memory()
  const started = Date.now()
  let recovered = 0
  const api = {
    execute: (s, input) => executeSwap(s, input),
    recover: async () => {
      recovered += 1
      return chain(Date.now() - started)
    },
  }
  const outcome = await flow.signAndSend({
    api,
    wallet: { signTransaction: async (wire) => signed(wire) },
    session,
    attempts,
    prepared: prepared(Date.now()),
  })
  let end
  const unresolved = outcome.ok ? outcome.attempt.state !== 'SETTLED' : outcome.phase === 'recovery'
  if (!unresolved) end = outcome.ok ? `«Готово» (${outcome.settlement.state})` : `refused ${outcome.failure.code}`
  else if (typeof flow.checkAfterSend === 'function' && flow.checkAfterSend(outcome)) {
    const check = await flow.recoverAttempt({
      api,
      session,
      attempts,
      attempt: flow.checkAfterSend(outcome),
    })
    end = check.ok && check.final ? `«Готово» (${check.settlement.state}), checked by itself` : 'unresolved after the check'
  } else {
    end = `«Підписана транзакція» — waits for a press of «Перевірити»${outcome.ok ? '' : ` (said: ${outcome.failure.key})`}`
  }
  console.log(`${label.padEnd(44)} ${end.padEnd(64)} ${((Date.now() - started) / 1000).toFixed(1)} s${recovered ? ` · ${recovered} check(s)` : ''}`)
}

/** A press made `pressAt` ms into a Review's life: when may the wallet open? Virtual clock, scaled. */
async function pressInRenewal(pressAt, cancelMs, orderMs, rpcLagMs) {
  const t0 = Date.now()
  const virtual = () => (Date.now() - t0) * SPEED
  const review = prepared(0)
  // The bytes truly die at arrival + window + margin − the answer's own trip (~0.8 s); the RPC sees it rpcLagMs later.
  const deadAt = 25_000 + 5_000 - 800 + rpcLagMs
  await scaled(pressAt)
  if (mayOpenWallet({ receivedAtMs: 0, signableMs: 25_000, nowMs: pressAt })) {
    console.log(`${`press at ${pressAt / 1000} s of «Перевірка»`.padEnd(44)} ${'the wallet opens'.padEnd(64)} 0.0 s`)
    return
  }
  let asks = 0
  const released = await flow.releaseAgedReview({
    api: {
      cancel: async () => {
        asks += 1
        await scaled(cancelMs)
        if (virtual() < deadAt) throw new ApiError('BLOCKHASH_STILL_VALID', 'still valid', 409, null, {})
        return { state: 'EXPIRED_BEFORE_SUBMIT' }
      },
    },
    session,
    prepared: review,
    now: virtual,
    sleep: scaled,
  })
  if (released.ok) await scaled(orderMs)
  const waited = virtual() - pressAt
  console.log(
    `${`press at ${pressAt / 1000} s of «Перевірка»`.padEnd(44)} ${(released.ok ? `fresh bytes, the wallet opens (${asks} ask(s))` : `refused ${released.failure.code}`).padEnd(64)} ${(waited / 1000).toFixed(1)} s`,
  )
}

console.log('— the send: the wallet signed, the server submits (real clock) —')
await send('execute answers in 3 s (landed)', 3_000, 200, 'MATCHED', () => ({ state: 'MATCHED', signature: 'sig' }))
await send('execute answers in 14 s (landed)', 14_000, 200, 'MATCHED', () => ({ state: 'MATCHED', signature: 'sig' }))
await send('execute answers 202 «pending» in 4 s; lands at 7 s', 4_000, 202, 'PENDING', (ms) =>
  ms < 7_000 ? { state: 'PENDING', signature: 'sig' } : { state: 'MATCHED', signature: 'sig' },
)
// A send whose answer never comes in time (a stalled network): landed at 20 s, the answer lost.
await send('execute never answers; landed at 20 s', 120_000, 200, 'MATCHED', (ms) =>
  ms < 20_000 ? { state: 'PENDING', signature: 'sig' } : { state: 'MATCHED', signature: 'sig' },
)
console.log('— a press while the Review renews its bytes (virtual clock; cancel 0.4 s, order 1.5 s, RPC lag 0.5 s) —')
for (const at of [8_000, 16_000, 22_000, 28_000]) await pressInRenewal(at, 400, 1_500, 500)
