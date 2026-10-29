/**
 * The words of the professional chart (CH-21) in both languages. The chart itself speaks the core's own words in the
 * app's language; these are the app's words around it — the door on the asset's page, the head, the states and the
 * buttons. «ти», neutral to gender; no advice, no «signals».
 */

import type { Copy } from '../../lib/i18n.ts'

export type ProChartCopy = Readonly<{
  /** The door under the asset page's chart, and its screen-reader words. */
  door: string
  doorA11y: (symbol: string) => string
  /** The head's line under the asset's name. */
  subtitle: string
  helpTitle: string
  help: readonly string[]
  loading: string
  noConnection: string
  notLoaded: string
  notOpened: string
  tryAgain: string
  buy: string
  sell: string
  /** Under a chart opened by a link, with no asset page beneath it: that page, with its own «Купити». */
  openAsset: string
  /** The chart engine's notices, one press deep in the «?» sheet: the licence asks them to travel with the app. */
  licences: string
}>

export const PRO_CHART_COPY: Copy<ProChartCopy> = {
  en: {
    door: 'Pro chart',
    doorA11y: (symbol) => `Open the pro chart of ${symbol}`,
    subtitle: 'Pro chart',
    helpTitle: 'Pro chart',
    help: [
      'The same chart as on ryntra.io: intervals from a minute to a day, candle types, a log or percent scale, indicators and drawings.',
      'Your drawings and indicators stay on this phone.',
      'Buy and Sell are the asset page’s own: the same purchase and sale, where you check the sum and the price, and only your wallet signs.',
    ],
    loading: 'Opening the chart',
    noConnection: 'No connection',
    notLoaded: "The chart didn't load",
    notOpened: "The chart didn't open",
    tryAgain: 'Try again',
    buy: 'Buy',
    sell: 'Sell',
    licences: 'Chart licences',
    openAsset: 'Asset page',
  },
  uk: {
    door: 'Професійний графік',
    doorA11y: (symbol) => `Відкрити професійний графік ${symbol}`,
    subtitle: 'Професійний графік',
    helpTitle: 'Професійний графік',
    help: [
      'Той самий графік, що на ryntra.io: інтервали від хвилини до дня, види свічок, логарифмічна чи відсоткова шкала, індикатори й малювання.',
      'Твої малюнки й індикатори лишаються на цьому телефоні.',
      '«Купити» і «Продати» — ті самі, що на сторінці активу: там ти перевіряєш суму й ціну, і підписує лише твій гаманець.',
    ],
    loading: 'Відкриваємо графік',
    noConnection: "Немає з'єднання",
    notLoaded: 'Графік не завантажився',
    notOpened: 'Графік не відкрився',
    tryAgain: 'Спробувати ще',
    buy: 'Купити',
    sell: 'Продати',
    licences: 'Ліцензії графіка',
    openAsset: 'Сторінка активу',
  },
}
