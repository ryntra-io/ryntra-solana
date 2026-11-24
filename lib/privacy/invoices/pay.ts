/**
 * The payer's side of a private invoice: what their page shows, and which of the two ways pays it.
 *
 * - **From the private balance** — a private transfer into the recipient's private balance: only the payer is seen on
 *   chain; the recipient and the sum are hidden (devnet, `PROBE.md`). Taken when the payer's private balance is open
 *   in this browser and holds the whole sum.
 * - **From the wallet** — one approval puts the sum from the payer's wallet straight into the recipient's private balance
 *   (the ring's deposit, made out to the recipient). The payer and the sum are seen, as on «Hide»; the screen says so in
 *   one line before the signature. No private balance of the payer's own is needed.
 *
 * Either way the payer pays the network fee from the wallet; Ryntra adds no fee of its own to an invoice. Pure: the balances and the clock are handed in.
 */

import type { PrivateAction } from '../exposure.ts';
import { RING_SOL } from '../network.ts';
import { isExpired, type PrivateInvoice } from './model.ts';

export type PayWay = 'private' | 'wallet';

/** The line «Others see» each way stands for (`exposure.ts`): a private transfer, or a deposit seen like «Hide». */
export const WAY_SEEN: Readonly<Record<PayWay, PrivateAction>> = Object.freeze({ private: 'send', wallet: 'hide' });

/** The payer's private balance as `usePrivate` holds it: its phase, and what it holds of the invoice's coin. */
export type PayerBalance = Readonly<{ phase: string; held: bigint | null }>;

/** Which way pays: the private balance when it holds the whole sum; the wallet otherwise; nothing while it is read. */
export function payWay(balance: PayerBalance, amount: bigint): PayWay | 'wait' {
  if (balance.phase === 'loading') return 'wait';
  if (balance.phase === 'ready' && balance.held !== null && balance.held >= amount) return 'private';
  return 'wallet';
}

/** What the payer's page stands on before any press. */
export type PayView = 'expired' | 'own' | 'paidHere' | 'connect' | 'pay';

export function payView(input: Readonly<{ invoice: PrivateInvoice; now: number; payer: string | null; paidHere: boolean }>): PayView {
  if (input.paidHere) return 'paidHere';
  if (isExpired(input.invoice, input.now)) return 'expired';
  if (!input.payer) return 'connect';
  if (input.payer === input.invoice.to) return 'own';
  return 'pay';
}

/** SOL the wallet keeps for the network fees of one payment — a margin far above a transaction's few thousand lamports. */
export const FEE_MARGIN_LAMPORTS = 100_000n;

/**
 * Whether the wallet's SOL cannot carry this payment: the network fee either way, and the sum itself when a SOL invoice
 * is paid from the wallet. Read before anything is signed, so a short wallet is told so instead of refused by the chain.
 */
export function walletShort(lamports: bigint, invoice: Pick<PrivateInvoice, 'mint' | 'amount'>, way: PayWay): boolean {
  const sum = way === 'wallet' && invoice.mint === RING_SOL ? invoice.amount : 0n;
  return lamports < sum + FEE_MARGIN_LAMPORTS;
}

/**
 * A failed payment in the words the page has: the wallet said no; the invoice takes no private payment; it failed
 * before anything was sent (nothing moved); or it is not known whether it landed — then the payer checks the wallet
 * before paying again, so an invoice is never paid twice by a retry.
 */
export type PayFailure = 'refused' | 'closed' | 'failed' | 'unconfirmed';

/** Codes that come before anything is sent: the wallet changed the message, or the payment could not be built. */
const BEFORE_SEND = /^(WALLET_CHANGED_MESSAGE|WALLET_BUILD_|WALLET_INSUFFICIENT_|WALLET_TOO_MANY_INPUTS)/;

export function failureOf(code: string | null | undefined): PayFailure {
  if (code === 'WALLET_REFUSED') return 'refused';
  if (code === 'NOT_REGISTERED' || (typeof code === 'string' && code.includes('RECIPIENT_NOT_REGISTERED'))) return 'closed';
  if (typeof code === 'string' && BEFORE_SEND.test(code)) return 'failed';
  return 'unconfirmed';
}
