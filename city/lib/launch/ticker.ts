/**
 * A ticker from the coin's name (CITY-200): the launch sheet showed «$KITE», its placeholder, over a coin named «QA Moon»
 * and then refused «Give it a ticker.» A name typed is a ticker offered — its letters and digits, Latin, up to the
 * engine's ten (`SYMBOL_MAX`, lib/launch/form.ts) — and the person's own ticker is never written over.
 */

const MAX = 10;

/** Ukrainian and Russian letters the way a ticker spells them. */
const LATIN: Readonly<Record<string, string>> = {
  а: 'A', б: 'B', в: 'V', г: 'H', ґ: 'G', д: 'D', е: 'E', є: 'YE', ж: 'ZH', з: 'Z', и: 'Y', і: 'I', ї: 'YI', й: 'Y',
  к: 'K', л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ф: 'F', х: 'KH', ц: 'TS', ч: 'CH',
  ш: 'SH', щ: 'SHCH', ь: '', ю: 'YU', я: 'YA', ы: 'Y', э: 'E', ё: 'YO', ъ: '',
};

export function tickerFromName(name: string): string {
  const latin = [...name.normalize('NFKD').toLowerCase()].map((ch) => LATIN[ch] ?? ch).join('');
  return latin.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX);
}

/**
 * The ticker after the name changes: the name's own while the ticker is empty or still the one the old name gave;
 * whatever the person typed stays.
 */
export function tickerAfterName(previousName: string, nextName: string, ticker: string): string {
  const offered = ticker === '' || ticker === tickerFromName(previousName);
  return offered ? tickerFromName(nextName) : ticker;
}
