import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { strongGroups } from './money-model.ts'
import { PAY_COPY } from './pay-copy.ts'
import { MENU_COPY, MENU_DESTINATIONS, MONEY_ACTIONS } from '../shell/menu.ts'
import { addRecent, isNewRecipient, lookalikeOf, parseRecents, RECENT_LIMIT } from './recipients.ts'

const code = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

const A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const B = '4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n'
// The poisoning trick: A's first and last four characters around another middle.
const A_LOOKALIKE = '7xKXzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzgAsU'

test('«Нещодавні»: the newest first, once each, up to the limit', () => {
  let list = addRecent([], A, '2026-10-17T10:00:00Z')
  list = addRecent(list, B, '2026-10-17T11:00:00Z')
  list = addRecent(list, A, '2026-10-17T12:00:00Z')
  assert.deepEqual(
    list.map((entry) => entry.address),
    [A, B],
  )
  for (let index = 0; index < 20; index += 1) list = addRecent(list, `${'1'.repeat(30)}${index}AB`, 'x')
  assert.equal(list.length, RECENT_LIMIT)
})

test('a new address says so; a look-alike of a recent one is found, the recent one itself is not', () => {
  const list = addRecent([], A, '2026-10-17T10:00:00Z')
  assert.equal(isNewRecipient(list, A), false)
  assert.equal(isNewRecipient(list, B), true)
  assert.equal(lookalikeOf(list, A_LOOKALIKE)?.address, A)
  assert.equal(lookalikeOf(list, A), null)
  assert.equal(lookalikeOf(list, B), null)
  assert.equal(lookalikeOf([], A_LOOKALIKE), null)
})

test('a stored list is read leniently: only well-formed Solana addresses stay', () => {
  assert.deepEqual(parseRecents(null), [])
  assert.deepEqual(parseRecents('not json'), [])
  assert.deepEqual(parseRecents('{"a":1}'), [])
  assert.deepEqual(
    parseRecents(JSON.stringify([{ address: A, at: 'x' }, { address: 'bad', at: 'x' }, { address: B }])).map(
      (entry) => entry.address,
    ),
    [A],
  )
})

test('the send walks four steps, and a look-alike stops «Далі» until it is pasted in again', () => {
  const send = code('screens/money/send.tsx')
  assert.match(send, /const SEND_STEPS: readonly SendStep\[\] = \['to', 'amount', 'check', 'done'\]/)
  assert.match(send, /const lookalikeStops = lookalike !== null && confirmedText !== typed/)
  assert.match(send, /else if \(lookalikeStops\) action = \{ \.\.\.action, disabled: true, hint: pay\.pasteAgain \}/)
  // M31's guards come first, in their order: a request for a token not held is said as such, never a top-up.
  const guards = [
    'send.blocked',
    'send.askedTooFine',
    'send.askedMissing',
    'send.holdings.isError',
    '!asset && !send.holdings.isLoading',
  ]
  const at = guards.map((guard) => send.indexOf(guard))
  assert.ok(
    at.every((index, n) => index > 0 && (n === 0 || index > at[n - 1])),
    `guards in order: ${at}`,
  )
  // «Сума» holds the recipient chosen on «Кому»: another one, or one re-read as a problem, never goes on — its button
  // takes the person back to «Кому» to see what changed (M41.2: a name now pointing elsewhere), never a dead end.
  assert.match(send, /const recipientHolds = address !== null && address === chosenAddress/)
  assert.match(
    send,
    /else if \(!recipientHolds\) action = \{ \.\.\.action, title: words\.checkRecipient, onPress: \(\) => setStep\('to'\) \}/,
  )
  assert.match(send, /\} else if \(current === 'amount' && chosenAddress\) \{/)
  assert.match(send, /if \(text\.trim\(\) === typed\) setConfirmedText\(text\.trim\(\)\)/)
  // Only a transfer that went out joins «Нещодавні».
  assert.match(send, /const sentTo = send\.done\?\.outcome === 'sent' \? send\.done\.to : null/)
  // The server's check and the wallet's signature are M31's own.
  assert.match(send, /<SendReview\s+check=\{check\}/)
  assert.match(send, /onConfirm=\{\(\) => void send\.confirm\(\)\}/)
  assert.match(send, /\{pay\.irreversible\}/)
  // M41.2: `.skr` names are offered only where the server serves them (`capabilities.research.skrName`, SKR-4) —
  // their placeholder is the Seeker words' own; `.sol` names are offered nowhere.
  assert.doesNotMatch(JSON.stringify(PAY_COPY), /\.skr|\.sol\b/)
  assert.match(send, /placeholder=\{namesServed \? seeker\.toPlaceholder : pay\.toPlaceholder\}/)
})

test('«Гроші»: «Можна надіслати», the core’s four large actions two by two, one orange, «Нещодавні», «Останні платежі»', () => {
  const hub = code('screens/money/hub.tsx')
  assert.deepEqual(MONEY_ACTIONS, ['deposit', 'send', 'receive', 'bridge'])
  assert.deepEqual(
    MONEY_ACTIONS.map((id) => MENU_COPY.uk.items[id]),
    ['Поповнити', 'Надіслати', 'Отримати', 'Між мережами'],
  )
  assert.deepEqual(
    MONEY_ACTIONS.map((id) => MENU_COPY.en.items[id]),
    ['Add funds', 'Send', 'Receive', 'Between networks'],
  )
  // Two by two, each as wide as half the column and tall enough to read as a door, not a chip.
  assert.match(hub, /\[actions\.slice\(0, 2\), actions\.slice\(2, 4\)\]/)
  assert.match(hub, /'min-h-\[96px\] flex-1 /)
  // One orange: Надіслати, Поповнити while the wallet holds nothing to send; a guest's is «Під’єднати гаманець».
  assert.match(
    hub,
    /const primary: NavItemId \| null =\s*account\.address && \(data !== null \|\| holdings\.isError\) \? \(empty \? 'deposit' : 'send'\) : null/,
  )
  assert.match(hub, /orange \? 'bg-brand'/)
  // «Поповнити» is the phone's own sheet, Надіслати and Отримати its screens, «Між мережами» the web's page.
  assert.deepEqual(MENU_DESTINATIONS.deposit, { kind: 'sheet', sheet: 'top-up' })
  assert.deepEqual(MENU_DESTINATIONS.send, { kind: 'screen', path: '/money/send' })
  assert.deepEqual(MENU_DESTINATIONS.receive, { kind: 'screen', path: '/money/receive' })
  assert.deepEqual(MENU_DESTINATIONS.bridge, { kind: 'web', path: '/app/bridge' })
  // The payment link lives under Отримати and in the awaiting row, not as a fifth action.
  assert.match(hub, /const openPayLinks = \(\) => router\.push\('\/money\/receive\?tab=link' as never\)/)
  // No network named on the balance: the phone is Solana alone.
  assert.doesNotMatch(hub, /pay\.network/)
  assert.match(hub, /row\.kind === 'send' \|\| row\.kind === 'receive'/)
  assert.deepEqual(Object.values(PAY_COPY.uk.steps), ['Кому', 'Сума', 'Перевірка', 'Готово'])
  assert.deepEqual(Object.keys(PAY_COPY.uk), Object.keys(PAY_COPY.en))
  assert.doesNotMatch(JSON.stringify(PAY_COPY.uk), /готовий|готова/)
})

test('a look-alike’s «Перевірка» never advises matching the edges: it says what it is and marks where it differs', () => {
  const send = code('screens/money/send.tsx')
  assert.match(send, /\{lookalikeOf \? pay\.lookalike : pay\.newAddressCheck\}/)
  assert.match(send, /lookalikeOf=\{lookalike\?\.address \?\? null\}/)
  // A plain new address: its first and last groups, what a person compares.
  assert.deepEqual(strongGroups('AAAABBBBCCCCDDDD'), [true, false, false, true])
  // A look-alike: the matching edges stay quiet, the differing middle is drawn strongest.
  assert.deepEqual(strongGroups('AAAAXXXXCCCCDDDD', 'AAAABBBBCCCCDDDD'), [false, true, false, false])
  // Longer or shorter than the recent address: the matching edges stay quiet, only the differing span is drawn.
  const recent = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' // 44
  const shorter = '7xKXzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzgAsU' // 43
  const longer = '7xKXzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzgAsU' // 45
  for (const poisoned of [shorter, longer]) {
    const strong = strongGroups(poisoned, recent)
    assert.equal(strong[0], false, `first group quiet: ${poisoned}`)
    assert.equal(strong.at(-1), false, `last group quiet: ${poisoned}`)
    assert.ok(strong.slice(1, -1).some(Boolean), 'the middle is drawn')
  }
  assert.match(code('screens/money/send-parts.tsx'), /const strong = strongGroups\(check\.to\.address, lookalikeOf\)/)
  assert.doesNotMatch(PAY_COPY.uk.lookalike, /перші й останні/)
})

test('an empty «Платежі» says one quiet line, never an empty space', () => {
  assert.equal(PAY_COPY.uk.empty, 'Платежів ще немає')
  assert.equal(PAY_COPY.en.empty, 'No payments yet')
  const hub = code('screens/money/hub.tsx')
  // Never for a guest, never before both reads answered, never on a failed read.
  assert.match(
    hub,
    /\{account\.address &&\s*recents\.length === 0 &&\s*payments\.length === 0 &&\s*awaiting === 0 &&\s*history\.activity\.isSuccess &&\s*\(account\.session === null \|\| links\.isSuccess\) \? \(/,
  )
})

test('ST-5: «Кому» shows the whole address on two lines, suggests nothing, and its «×» says «Очистити»', () => {
  const send = code('screens/money/send.tsx')
  assert.equal(PAY_COPY.uk.clear, 'Очистити')
  assert.equal(PAY_COPY.en.clear, 'Clear')
  assert.match(send, /icon="close-circle" label=\{pay\.clear\}/)
  assert.doesNotMatch(send, /label=\{shared\.close\}/)
  for (const prop of [
    /\bmultiline\b/,
    /autoCorrect=\{false\}/,
    /autoComplete="off"/,
    /spellCheck=\{false\}/,
    /importantForAutofill="no"/,
    /submitBehavior="blurAndSubmit"/,
    /onBlur=\{send\.finishRecipient\}/,
  ])
    assert.match(send, prop)
  assert.doesNotMatch(send, /numberOfLines=\{1\}\s*className="h-12 flex-1 text-fg"/)
  // Pasted, scanned, picked from «Нещодавні» or brought from «Гроші»: the text is complete, judged at once.
  assert.match(send, /send\.setRecipientText\(text, true\)/)
  assert.match(send, /send\.setRecipientText\(picked, true\)/)
  assert.match(send, /setRecipient\(prefilled, true\)/)
})

test('ST-5: the amount’s dollar line keeps its cents under $100 000; only a large sum is said short', () => {
  const send = code('screens/money/send.tsx')
  assert.match(send, /Math\.abs\(usd\) < 100_000 \? formatUsd\(usd, locale\) : formatUsdCompact\(usd, locale\)/)
})
