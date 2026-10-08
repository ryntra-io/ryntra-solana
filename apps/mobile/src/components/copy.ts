import type { Copy } from '../lib/i18n.ts'

/**
 * The words the shared components say themselves — a row's marks, the search
 * field, the Review's clock and notes, the receipt's columns, a tile's stale
 * mark, a session's time, the chart's description — in both languages, the
 * web's own for the same things (its Spot and stock surfaces), so a component
 * never puts an English word on a Ukrainian screen. The Ukrainian speaks «ти».
 */
export type ComponentCopy = Readonly<{
  /* a market in a list */
  halted: string
  flagged: string
  unverified: string
  rowA11y: (symbol: string, name: string, price: string, change: string, states: readonly string[]) => string
  /* the search field */
  searchPlaceholder: string
  searchMarkets: string
  clearSearch: string
  /* the Review's rows */
  quote: string
  quoteStale: string
  note: string
  /* the receipt */
  settled: string
  pending: string
  failed: string
  recovered: string
  paid: string
  received: string
  time: string
  details: string
  /* a figure's tile */
  stale: string
  /* the issuer's session */
  until: (word: string, time: string) => string
  sessionA11y: (word: string, time: string | null) => string
  /* the price line */
  priceLine: string
  priceLineA11y: (first: string, last: string, low: string, high: string) => string
}>

export const COMPONENT_COPY: Copy<ComponentCopy> = {
  en: {
    halted: 'Halted',
    flagged: 'Flagged',
    unverified: 'Unverified',
    rowA11y: (symbol, name, price, change, states) =>
      `${symbol}, ${name}, ${price}, ${change} in 24 hours${states.length ? `, ${states.join(', ')}` : ''}`,
    searchPlaceholder: 'Name, ticker or contract address',
    searchMarkets: 'Search markets',
    clearSearch: 'Clear search',
    quote: 'Quote',
    quoteStale: 'Stale · refresh to continue',
    note: 'Note',
    settled: 'Settled',
    pending: 'Pending',
    failed: 'Failed',
    recovered: 'Recovered',
    paid: 'Paid',
    received: 'Received',
    time: 'Time',
    details: 'Details',
    stale: 'Stale',
    until: (word, time) => `${word} · until ${time}`,
    sessionA11y: (word, time) => `Market session ${word}${time ? `, until ${time}` : ''}`,
    priceLine: 'Price line',
    priceLineA11y: (first, last, low, high) => `Price line from ${first} to ${last}, low ${low}, high ${high}`,
  },
  uk: {
    halted: 'Торги зупинено',
    flagged: 'Позначено',
    unverified: 'Не підтверджено',
    rowA11y: (symbol, name, price, change, states) =>
      `${symbol}, ${name}, ${price}, ${change} за 24 год${states.length ? `, ${states.join(', ')}` : ''}`,
    searchPlaceholder: 'Назва, тікер або адреса контракту',
    searchMarkets: 'Пошук на ринках',
    clearSearch: 'Очистити пошук',
    quote: 'Котирування',
    quoteStale: 'Застаріло · онови, щоб продовжити',
    note: 'Примітка',
    settled: 'Виконано',
    pending: 'Очікує',
    failed: 'Не виконано',
    recovered: 'Відновлено',
    paid: 'Сплачено',
    received: 'Отримано',
    time: 'Час',
    details: 'Деталі',
    stale: 'Застаріло',
    until: (word, time) => `${word} · до ${time}`,
    sessionA11y: (word, time) => `Біржова сесія: ${word}${time ? `, до ${time}` : ''}`,
    priceLine: 'Лінія ціни',
    priceLineA11y: (first, last, low, high) => `Лінія ціни від ${first} до ${last}, мінімум ${low}, максимум ${high}`,
  },
}
