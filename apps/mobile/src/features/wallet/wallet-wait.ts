/**
 * The wait for a wallet's signature, the same for every operation (NEW-LOOK §4, PLAN §8, M45). A wallet on a Ledger
 * shows the transaction on the device and answers only once the person pressed there, so the app waits up to
 * `WALLET_WAIT_MS` and never stops sooner; «Скасувати» ends the wait at any moment. An answer that arrives after the
 * wait ended is dropped, never sent — the next step is a fresh «Перевірка», never a repeat of the old bytes.
 */

/** How long the app waits for the wallet's answer: a review on a Ledger takes up to a minute and a half. */
export const WALLET_WAIT_MS = 90_000

export type WalletAnswer<T> =
  Readonly<{ kind: 'signed'; value: T }> | Readonly<{ kind: 'timeout' }> | Readonly<{ kind: 'cancelled' }>

/** «Скасувати» for one wait: pressed once, it ends the wait it was handed to. */
export type WalletCancel = Readonly<{ cancel: () => void; cancelled: () => boolean; promise: Promise<void> }>

export function walletCancel(): WalletCancel {
  let pressed = false
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {
    cancel: () => {
      pressed = true
      resolve()
    },
    cancelled: () => pressed,
    promise,
  }
}

/**
 * The wallet's answer, the end of the wait, or «Скасувати» — whichever comes first. A refusal the wallet gives is
 * thrown as it came. A signature that arrives after the wait ended is swallowed here: nobody holds it.
 */
export async function waitForWallet<T>(
  signing: Promise<T>,
  options: Readonly<{
    waitMs?: number
    sleep?: (ms: number) => Promise<void>
    cancel?: WalletCancel | null
  }> = {},
): Promise<WalletAnswer<T>> {
  // A late refusal after the wait ended has nobody to hear it.
  signing.catch(() => undefined)
  if (options.cancel?.cancelled()) return { kind: 'cancelled' }
  const waitMs = Math.max(WALLET_WAIT_MS, options.waitMs ?? WALLET_WAIT_MS)
  let timer: ReturnType<typeof setTimeout> | null = null
  const ended = options.sleep
    ? options.sleep(waitMs)
    : new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs)
      })
  const racers: Promise<WalletAnswer<T>>[] = [
    signing.then((value) => ({ kind: 'signed' as const, value })),
    ended.then(() => ({ kind: 'timeout' as const })),
  ]
  if (options.cancel) racers.push(options.cancel.promise.then(() => ({ kind: 'cancelled' as const })))
  try {
    return await Promise.race(racers)
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * MWA 2.0 made `signTransactions` optional: a wallet may only sign-and-send. Asked to sign, such a wallet answers that
 * the method does not exist (JSON-RPC -32601) or is not supported. Ryntra does not fall back to letting the wallet
 * send — the server submits what the person reviewed, once, and adopting a transaction a wallet sent
 * itself waits for its route on the server (AG-2's request to line A) — so the person is told plainly instead.
 */
export function walletCannotSign(error: unknown): boolean {
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  const text = error instanceof Error ? error.message : String(error ?? '')
  return (
    code === '-32601' ||
    /method not (found|supported|implemented)|unsupported method|sign_?transactions?\b.*\b(not supported|unsupported)/i.test(
      text,
    )
  )
}

/**
 * Ledger's 6808: the Solana app on the device has «Blind signing» off, so it refuses a transaction it cannot read in
 * full — a swap, most of all. The setting is reset by the Ledger app's updates. Wallets pass the device's status word
 * on in their message.
 */
export function ledgerBlindSigning(error: unknown): boolean {
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : ''
  const text = error instanceof Error ? error.message : String(error ?? '')
  // The status word as a wallet passes it on: 0x6808, or the same as a number, 26632.
  return /^(0x)?6808$|^26632$/i.test(code) || /\b(0x)?6808\b|\b26632\b|blind[\s_-]?sign/i.test(text)
}

function base64Bytes(wire: string): Uint8Array | null {
  try {
    const raw = atob(wire)
    const bytes = new Uint8Array(raw.length)
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

/**
 * The message version of a wire transaction: `legacy`, `0`, a later one, or null when the bytes cannot be read. A
 * legacy or v0 wire is the signatures' count (compact-u16), the signatures, then the message, whose first byte has its
 * high bit set for a versioned message and the version in the low seven bits. A Transaction V1 wire (SIMD-0385) opens
 * with its version byte instead, 0x81, and carries its signatures at the end. A first byte with the high bit set is
 * never a signatures' count here: 128 signatures could not fit in a transaction, so it is read as that version.
 */
export function transactionVersion(wireBase64: string): 'legacy' | number | null {
  const bytes = base64Bytes(wireBase64)
  if (!bytes || bytes.length === 0) return null
  const lead = bytes[0]!
  if (lead & 0x80) return (lead & 0x7f) === 0 ? null : lead & 0x7f
  const first = bytes[1 + lead * 64]
  if (first === undefined) return null
  return first & 0x80 ? first & 0x7f : 'legacy'
}

/**
 * Whether a Ledger behind the wallet can sign these bytes: a v0 or a legacy message. Transaction V1 is not signed
 * by a Ledger yet (LedgerHQ/app-solana, issue 248); the server stays on v0, and the phone never opens the wallet for a later
 * version it can read. Bytes it cannot read go on to the wallet, which reads them itself and refuses what it cannot.
 */
export function ledgerCanSign(wireBase64: string): boolean {
  const version = transactionVersion(wireBase64)
  return version === null || version === 'legacy' || version === 0
}
