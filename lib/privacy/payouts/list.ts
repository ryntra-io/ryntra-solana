/**
 * A payout list as a person brings it: typed, pasted from a sheet or a chat, or a CSV file. One line — one payment:
 * who (a name, a `.sol`/`.skr` name or a Solana address), how much, which coin, and what it is for. Any order, any of
 * tab, «;» or «,» between the parts, or plain spaces; a header row of a sheet is read by its words. The coin may be
 * left out (the list's coin is taken); «for» is everything said after the amount.
 *
 * Pure: no clock, no network, no store. Whether an address is whole, a name known, a recipient ready — `check.ts`.
 */

import { RING_SOL } from '../network.ts';

/** A coin a payout can pay in privately today: SOL on the ring. */
export type PayCoin = Readonly<{ symbol: string; mint: string; decimals: number }>;

export const PAY_COINS: readonly PayCoin[] = [{ symbol: 'SOL', mint: RING_SOL, decimals: 9 }];

/** The coin a list pays in when a line names none. */
export const DEFAULT_COIN = 'SOL';

/** Coins people name in a list — read as coins, so a line «900 USDC» is not taken for a name; only PAY_COINS pay. */
const COIN_WORDS = new Set(['SOL', 'USDC', 'USDT', 'EURC', 'PYUSD', 'USDG', 'JUP', 'MET', 'BONK', 'WSOL']);

export type PayRow = Readonly<{
  /** The line of the text it came from, from 1. */
  line: number;
  /** A person's name or a `.sol`/`.skr` name, as written; null when the line has only an address. */
  name: string | null;
  /** The Solana address as written; null when the line names the person only. */
  to: string | null;
  /** The amount as a plain decimal («1200.5»); null when the line has none. */
  amount: string | null;
  /** The coin's symbol, upper case. */
  coin: string;
  /** What it is for; never sent anywhere — kept in the person's own record. */
  note: string | null;
}>;

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HANDLE = /^@?[\p{L}\p{N}_-]+\.(sol|skr)$/iu;
const AMOUNT = /^\d+(?:[.,]\d+)?$/;

/** A row of a sheet whose cells name its columns. */
const HEADER: Readonly<Record<keyof Omit<PayRow, 'line'>, RegExp>> = {
  name: /^(name|who|recipient|payee|person|ім['’]?я|хто|отримувач|одержувач|працівник)$/iu,
  to: /^(address|wallet|адреса|гаманець)$/iu,
  amount: /^(amount|sum|сума|кількість)$/iu,
  coin: /^(coin|token|currency|asset|монета|валюта|токен)$/iu,
  note: /^(for|for what|memo|note|notes|comment|description|reference|за що|призначення|коментар|примітка|опис)$/iu,
};

type Column = keyof typeof HEADER;

/**
 * Spaces inside a number («1 200», «1 200,50» with a narrow space) go; the rest of the line stays as it was. Only a
 * number standing on its own is joined — never the digits an address ends with.
 */
function tidy(line: string): string {
  return line
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/(^|[\s;,])(\d{1,3}(?: \d{3})+)(?=[.,]\d|[\s;]|,\D|,$|$)/g, (_m, lead: string, digits: string) => `${lead}${digits.replace(/ /g, '')}`)
    .trim();
}

/** Cells of a delimited line: quotes are honoured («"Oleh, team"»), the quotes themselves dropped. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

/** Cells of a line divided by «,», with a decimal comma («Oleh,100,50,SOL» is 100.50) joined back into its number. */
function commaCells(line: string): string[] {
  const out: string[] = [];
  for (const cell of cells(line, ',')) {
    const last = out.at(-1);
    if (last !== undefined && /^\d+$/.test(last) && /^\d+$/.test(cell) && !out.some((p, i) => i < out.length - 1 && AMOUNT.test(p))) out[out.length - 1] = `${last}.${cell}`;
    else out.push(cell);
  }
  return out;
}

/** Words divided by spaces. */
function spaced(line: string): string[] {
  return line.split(/\s+/);
}

/**
 * The ways a line may be divided. Tabs and «;» divide a sheet's cells, and that is the one way. «,» may divide cells
 * («Oleh, 0.4, SOL») or sit inside what is said («Oleh 0.4 SOL design, October»): both are tried, and the reading that
 * finds more of the payment wins (`rowOf`). With none of them, spaces divide.
 */
function readings(line: string): string[][] {
  if (line.includes('\t')) return [cells(line, '\t')];
  if (line.includes(';')) return [cells(line, ';')];
  if (line.includes(',') && !/^[^,]*\d,\d[^,]*$/.test(line)) return [commaCells(line), spaced(line)];
  return [spaced(line)];
}

/** The parts of a line by its first reading — for a sheet's header row. */
function parts(line: string): string[] {
  return readings(line)[0];
}

/** «900SOL», «0.5sol» — an amount and a coin glued together. */
function unglue(part: string): string[] {
  const m = /^(\d+(?:[.,]\d+)?)([A-Za-z]{3,6})$/.exec(part);
  return m && COIN_WORDS.has(m[2].toUpperCase()) ? [m[1], m[2]] : [part];
}

const plainAmount = (text: string) => text.replace(',', '.');

type Kind = 'address' | 'handle' | 'amount' | 'coin' | 'word';

function kindOf(part: string): Kind {
  if (ADDRESS.test(part)) return 'address';
  if (HANDLE.test(part)) return 'handle';
  if (AMOUNT.test(part)) return 'amount';
  if (COIN_WORDS.has(part.toUpperCase())) return 'coin';
  return 'word';
}

/** One line without a header: each part read by what it looks like; words before the first known part name the person, words after it say what for. */
function rowOf(line: number, list: readonly string[]): PayRow | null {
  // A comma that only ends a word («0.4,», «Oleh,») is not part of what the word is; said words keep it.
  const split = list.flatMap((p) => (p === '' ? [] : unglue(p.replace(/,+$/, '')).map((bare, i, all) => ({ bare, said: i === all.length - 1 ? `${bare}${/,+$/.exec(p)?.[0] ?? ''}` : bare }))));
  if (!split.length) return null;
  let name: string[] = [];
  const note: string[] = [];
  let to: string | null = null;
  let amount: string | null = null;
  let coin: string | null = null;
  let seen = false;
  for (const { bare: part, said } of split) {
    const kind = kindOf(part);
    if (kind === 'address' && to === null) {
      to = part;
      seen = true;
    } else if (kind === 'amount' && amount === null) {
      amount = plainAmount(part);
      seen = true;
    } else if (kind === 'coin' && coin === null && amount !== null) {
      coin = part.toUpperCase();
    } else if (kind === 'handle' && name.length === 0 && !seen) {
      name = [part.replace(/^@/, '')];
      seen = true;
    } else if (!seen) {
      name.push(said);
    } else {
      note.push(said);
    }
  }
  const joined = (words: string[]) => (words.length ? words.join(' ').replace(/,+$/, '').trim() || null : null);
  return { line, name: joined(name), to, amount, coin: coin ?? DEFAULT_COIN, note: joined(note) };
}

/** How much of a payment a reading found: the amount counts most, then who it goes to. */
function score(row: PayRow | null): number {
  if (!row) return -1;
  return (row.amount ? 4 : 0) + (row.to ? 2 : 0) + (row.name && !/\s\S*\d/.test(row.name) ? 1 : 0);
}

/** The reading of a line that finds the most; the first one when they find as much. */
function bestRow(line: number, ways: readonly string[][]): PayRow | null {
  let best: PayRow | null = null;
  for (const way of ways) {
    const row = rowOf(line, way);
    if (score(row) > score(best)) best = row;
  }
  return best;
}

/** The columns a header row names, or null when the line is not a header. */
function headerOf(list: readonly string[]): Partial<Record<Column, number>> | null {
  const found: Partial<Record<Column, number>> = {};
  let named = 0;
  list.forEach((cell, i) => {
    const clean = cell.replace(/[:*]+$/, '').trim();
    for (const column of Object.keys(HEADER) as Column[]) {
      if (found[column] === undefined && HEADER[column].test(clean)) {
        found[column] = i;
        named += 1;
        return;
      }
    }
  });
  return named >= 2 && (found.amount !== undefined || found.to !== undefined) ? found : null;
}

function byHeader(line: number, list: readonly string[], columns: Partial<Record<Column, number>>): PayRow | null {
  const at = (column: Column) => {
    const i = columns[column];
    const value = i === undefined ? '' : (list[i] ?? '').trim();
    return value === '' ? null : value;
  };
  const name = at('name');
  const to = at('to');
  const amountText = at('amount');
  const coin = at('coin');
  const note = at('note');
  if (!name && !to && !amountText) return null;
  const glued = amountText ? unglue(amountText.replace(/\s+/g, '')) : [];
  const amount = glued[0] && AMOUNT.test(glued[0]) ? plainAmount(glued[0]) : null;
  return {
    line,
    name: name ? name.replace(/^@/, '') : null,
    to,
    amount: amount ?? (amountText ? amountText : null),
    coin: (coin ?? glued[1] ?? DEFAULT_COIN).toUpperCase(),
    note,
  };
}

/**
 * Every payment line of a text. Blank lines are skipped; a first line that is a sheet's header names the columns of the
 * lines after it. A line that says nothing usable still comes back (with what it has), so the screen can show it and
 * the person can mend it — no line is dropped in silence.
 */
export function parseList(text: string): PayRow[] {
  const lines = text.split(/\r?\n/);
  const rows: PayRow[] = [];
  let columns: Partial<Record<Column, number>> | null = null;
  let first = true;
  lines.forEach((raw, i) => {
    const line = tidy(raw);
    if (line === '') return;
    const list = parts(line);
    if (first) {
      first = false;
      columns = headerOf(list);
      if (columns) return;
    }
    const row = columns ? byHeader(i + 1, list, columns) : bestRow(i + 1, readings(line));
    if (row) rows.push(row);
  });
  return rows;
}

/** A row back as one line of text — the template «as last time» and the file the report writes come from the same rows. */
export function lineOf(row: Pick<PayRow, 'name' | 'to' | 'amount' | 'coin' | 'note'>): string {
  const quoted = (part: string) => (/[;"]/.test(part) ? `"${part.replace(/"/g, '""')}"` : part);
  return [row.name, row.to, row.amount, row.coin, row.note]
    .filter((part): part is string => Boolean(part))
    .map(quoted)
    .join(' ; ');
}
