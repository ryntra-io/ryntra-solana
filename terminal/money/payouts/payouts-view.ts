import { digits } from '../../../city/lib/i18n/dict.ts';
import type { Lang } from '../../../city/lib/i18n/langs.ts';
import { weightOf, type CheckedRow, type Issue } from '../../../lib/privacy/payouts/check.ts';
import { chargesFee, feePercent, type FeeRule } from '../../../lib/privacy/payouts/fee.ts';
import { privateNetwork } from '../../../lib/privacy/network.ts';
import type { ReportWords } from '../../../lib/privacy/ledger/ledger.ts';

/**
 * «Payouts» as data: when the tab stands, what each line of the list shows, the report's words. Pure — the
 * tests read it as it is.
 */

/** The tab stands only with the private balance open (`NEXT_PUBLIC_RYNTRA_PRIVATE`); without it «Money» is as it was. */
export function payoutsOpen(flag: string | undefined = process.env.NEXT_PUBLIC_RYNTRA_PRIVATE): boolean {
  return privateNetwork(flag) !== null;
}

type FeeWords = Readonly<{ feeLine: (fee: string, rate: string, signatures: number) => string; noFeeLine: (signatures: number) => string }>;

/**
 * The one line before the signature, once the list can be paid: Ryntra's fee — its rate and what this payout pays — and
 * the signatures; «No Ryntra fee» while the settings set none, or this payout carries none.
 */
export function feeText(w: FeeWords, rule: FeeRule, fee: bigint, signatures: number, fig: (units: bigint) => string, lang: Lang): string {
  return chargesFee(rule) && fee > 0n ? w.feeLine(fig(fee), digits(feePercent(rule.bps), lang), signatures) : w.noFeeLine(signatures);
}

/** What a line shows first: what stops it, then what to look at again, then what is only said. */
const ORDER: readonly Issue[] = ['who', 'address', 'amount', 'coin', 'self', 'small', 'duplicate', 'noPrivate', 'new'];

export function shownIssue(row: Pick<CheckedRow, 'issues'>): Issue | null {
  return ORDER.find((issue) => row.issues.includes(issue)) ?? null;
}

/** A line's tone: flare — it stops the payout; amber — look again; plain — only said. */
export function issueTone(issue: Issue): 'stop' | 'ask' | 'note' {
  return weightOf(issue);
}

/** Who a line pays, as the person reads it: the name they wrote, else the address shortened. */
export function whoText(row: Pick<CheckedRow, 'name' | 'to' | 'address'>): string {
  if (row.name) return row.name;
  const address = row.address ?? row.to;
  if (!address) return '—';
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

type Said = Readonly<Record<'rDate' | 'rName' | 'rAddress' | 'rAmount' | 'rCoin' | 'rFor' | 'rHow' | 'rState' | 'rTx' | 'howPrivate' | 'howLink' | 'howOpen' | 'statePaid' | 'stateFailed' | 'stateWaiting', string>>;

/** The report's column names and words, in the language on screen. */
export function reportWords(w: Said): ReportWords {
  return {
    head: [w.rDate, w.rName, w.rAddress, w.rAmount, w.rCoin, w.rFor, w.rHow, w.rState, w.rTx],
    how: { private: w.howPrivate, link: w.howLink, open: w.howOpen },
    state: { paid: w.statePaid, failed: w.stateFailed, waiting: w.stateWaiting },
  };
}

/** The report's file name: the payout's day. */
export function reportName(at: number): string {
  return `ryntra-payout-${new Date(at).toISOString().slice(0, 10)}.csv`;
}

/** A list file the person picks is read as text only when it is one: small, and a list's kind. */
export const LIST_FILE_MAX_BYTES = 256 * 1024;
export const LIST_FILE_ACCEPT = '.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values';
