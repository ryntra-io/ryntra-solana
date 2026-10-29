#!/usr/bin/env node
/**
 * The swap's stopwatch on a device (ST-3): a development build writes each step a person waits on as a `[clock]` line
 * (`src/features/trade/trade-clock.ts`); React Native sends those lines only to its debugger, so this listens on Metro's
 * inspector the way the debugger does and appends them to a file — the quote, «Перевірка», the wallet asked and its
 * answer, the send, the check, «Готово».
 *
 *   node scripts/swap-clock-tap.mjs [port=8081] [out=swap-clock.log] [device name part, e.g. Seeker]
 *
 * Read only: it enables the console and nothing else. Run it beside Metro while the app is open on the device.
 */
import { appendFileSync } from 'node:fs'

import WebSocket from 'ws'

const [port = '8081', out = 'swap-clock.log', device = ''] = process.argv.slice(2)
const note = (line) => appendFileSync(out, `${line}\n`)

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.appId?.startsWith('io.ryntra.app') && String(t.deviceName ?? '').includes(device))
if (!target) {
  console.error(`No Ryntra app on Metro ${port}${device ? ` for «${device}»` : ''}.`)
  process.exit(1)
}
// Metro lets a debugger in only from its own origin.
const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'), {
  headers: { origin: `http://127.0.0.1:${port}` },
})
ws.on('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
  note(`# ${new Date().toISOString()} ${target.title}`)
  console.log(`Listening to ${target.title}; lines go to ${out}.`)
})
const seen = new Set()
ws.on('message', (data) => {
  const msg = JSON.parse(String(data))
  if (msg.method !== 'Runtime.consoleAPICalled') return
  const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
  // The bridge may hand one call over twice; a mark carries its own millisecond, so a repeat is dropped.
  if (!/\[clock\]/.test(text) || seen.has(text)) return
  seen.add(text)
  note(text)
})
ws.on('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
ws.on('close', () => process.exit(0))
