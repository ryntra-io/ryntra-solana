/**
 * A receipt for one payment: a payout line, or a private invoice that was paid. A short text file the person hands to
 * whoever asks — the recipient, the payer, an accountant.
 *
 * What it can be, by probe 2 (`docs/research/private-payments-2026-11-19/PROBE-2.md`, points 1–2):
 * - the viewing key of one transaction opens every output of the payout and the payer's change, so it is never given;
 * - the per-output disclosure a third party could check against the chain needs the private balance's own viewing key
 *   bytes and parts of the ring's library this site does not carry yet; keys that come from the wallet do not give
 *   those bytes. So this receipt is made from the person's own record and names the transaction — the chain shows that
 *   the transfer took place, not the sum. It says exactly that, in one line, and nothing of other payments.
 *
 * Pure.
 */

import { stamp, type ReportRow } from './report.ts';

export type ReceiptWords = Readonly<{
  title: string;
  date: string;
  from: string;
  to: string;
  amount: string;
  forWhat: string;
  tx: string;
  /** One line: what the receipt shows. */
  shows: string;
  /** One line: what it does not show. */
  hides: string;
}>;

/** Only a payment that surely went, with its transaction, gets a receipt. */
export function canReceipt(row: Pick<ReportRow, 'state' | 'signature' | 'kind'>): boolean {
  return row.kind !== 'fee' && row.state === 'paid' && !!row.signature;
}

/**
 * The receipt's text. `owner` is the person's wallet: the payer of a payout; for an invoice it is the recipient, and the
 * payer is not in the person's record, so no «from» line is written. `explorer` is the transaction's page.
 */
export function receiptText(row: ReportRow, owner: string, words: ReceiptWords, explorer: string | null, offsetMinutes: number): string | null {
  if (!canReceipt(row)) return null;
  const lines: string[] = [words.title, ''];
  lines.push(`${words.date}: ${stamp(row.at, offsetMinutes)}`);
  if (row.kind === 'payout') lines.push(`${words.from}: ${owner}`);
  lines.push(`${words.to}: ${row.name ? `${row.name} · ` : ''}${row.to}`);
  lines.push(`${words.amount}: ${row.amount} ${row.coin}`);
  if (row.note) lines.push(`${words.forWhat}: ${row.note}`);
  lines.push(`${words.tx}: ${row.signature}`);
  if (explorer) lines.push(explorer);
  lines.push('', words.shows, words.hides, '');
  return lines.join('\r\n');
}

/** The receipt's file name: the day and the transaction's first characters. */
export function receiptFileName(row: Pick<ReportRow, 'at' | 'signature'>, offsetMinutes: number): string {
  return `ryntra-receipt-${stamp(row.at, offsetMinutes).slice(0, 10)}-${(row.signature ?? '').slice(0, 8)}.txt`;
}
