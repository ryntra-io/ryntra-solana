import type { SwapSettlement } from '../../lib/api.ts'
import { settledView, tradeFailureKey } from './trade-model.ts'

/**
 * What the hand feels at the two moments of an operation that matter:
 * «Перевірка» standing ready, and the signature's answer. Pure, so a test can
 * hold it; `lib/haptics` turns a cue into the phone's own pattern.
 *
 * - `review`   — the Review is on screen: one light tap.
 * - `done`     — the network filled it: the phone's success pattern.
 * - `sent`     — signed and sent, the network has not answered yet: one firm tap.
 * - `declined` — the wallet's own «no»: the phone's warning pattern.
 * - `failed`   — refused or not filled: the phone's error pattern.
 */
export type TradeCue = 'review' | 'done' | 'sent' | 'declined' | 'failed'

/** The cue of a settlement the server returned — the same reading the screen draws from it. */
export function settlementCue(settlement: SwapSettlement): TradeCue {
  const status = settledView(settlement, null).status
  if (status === 'settled' || status === 'recovered') return 'done'
  if (status === 'pending') return 'sent'
  return 'failed'
}

/** The cue of a signature that did not end in a settlement: the wallet's refusal, or anything else. */
export function failureCue(code: string): TradeCue {
  return tradeFailureKey(code) === 'walletCancelled' ? 'declined' : 'failed'
}
