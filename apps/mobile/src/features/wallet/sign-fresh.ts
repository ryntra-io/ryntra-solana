/**
 * Build, then sign — and when the wallet answered after the bytes could still land, build once more and sign the
 * fresh bytes instead of sending dead ones (AG-2; the web's `lib/solana/sign-fresh.ts`).
 *
 * For the operations the phone builds at the press and signs at once: a send, a payment link, a limit's
 * cancellation, a launch, a trade on a launch's curve, a creator's claim. Bytes live ~30 s (`bytes-life.ts`); a Ledger
 * behind the wallet may take longer. A late answer is never sent — it dies with its blockhash, held by nobody — and
 * the operation is built again and asked once more; a second late answer stops with `late` so the screen can tell the
 * person the device has to confirm within ~20 s. Bounded at two builds: a slow device cannot loop the prompts.
 */

import { MAX_SIGNABLE_MS, mayOpenWallet, signableWindowClosed } from './bytes-life.ts'

export type FreshSign<S, E> = Readonly<{ ok: true; value: S }> | Readonly<{ ok: false; error: E }>

export type FreshSigned<B, S, F, E> =
  | Readonly<{ ok: true; built: B; signed: S; builds: number }>
  | Readonly<{ ok: false; stage: 'build'; failure: F }>
  | Readonly<{ ok: false; stage: 'sign'; error: E; built: B }>
  /** Every build aged out before or while the wallet answered; nothing was sent. `late`: the wallet did answer, late. */
  | Readonly<{ ok: false; stage: 'aged'; late: boolean }>

export async function signFresh<B, S, F, E>(
  args: Readonly<{
    build: () => Promise<Readonly<{ ok: true; data: B }> | Readonly<{ ok: false; failure: F }>>
    /** How long from arriving the build may still be signed; null when the server sent none — one ~25 s window. */
    signableMsOf: (built: B) => number | null | undefined
    sign: (built: B) => Promise<FreshSign<S, E>>
    /** Told before the second build: `late` — the wallet will be asked again; `short` — it was not asked yet. */
    onRebuild?: (why: 'late' | 'short') => void
    builds?: number
    now?: () => number
  }>,
): Promise<FreshSigned<B, S, F, E>> {
  const now = args.now ?? Date.now
  const limit = Math.max(1, Math.floor(args.builds ?? 2))
  let why: 'late' | 'short' | null = null
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    if (why) args.onRebuild?.(why)
    const built = await args.build()
    if (!built.ok) return { ok: false, stage: 'build', failure: built.failure }
    // The server measured the window at the end of its build: it counts from the answer's arrival.
    const receivedAtMs = now()
    const given = args.signableMsOf(built.data)
    const signableMs = typeof given === 'number' && Number.isFinite(given) && given >= 0 ? given : MAX_SIGNABLE_MS
    if (!mayOpenWallet({ receivedAtMs, signableMs, nowMs: now() })) {
      why = 'short'
      continue
    }
    const signed = await args.sign(built.data)
    if (!signed.ok) return { ok: false, stage: 'sign', error: signed.error, built: built.data }
    if (signableWindowClosed({ receivedAtMs, signableMs, nowMs: now() })) {
      why = 'late'
      continue
    }
    return { ok: true, built: built.data, signed: signed.value, builds: attempt }
  }
  return { ok: false, stage: 'aged', late: why === 'late' }
}
