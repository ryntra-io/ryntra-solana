/**
 * The app's words around the city (CITY-6c): the states that cover the page while it cannot show. The city itself
 * speaks the site's own words. «ти», neutral to gender.
 */

import type { Copy } from '../../lib/i18n.ts'

export type CityCopy = Readonly<{
  /** The WebView's screen-reader name. */
  label: string
  loading: string
  noConnection: string
  notOpened: string
  tryAgain: string
}>

export const CITY_COPY: Copy<CityCopy> = {
  en: {
    label: 'Ryntra City',
    loading: 'Opening the city',
    noConnection: 'No connection',
    notOpened: 'The city did not open',
    tryAgain: 'Try again',
  },
  uk: {
    label: 'Ryntra City',
    loading: 'Відкриваємо місто',
    noConnection: "Немає з'єднання",
    notOpened: 'Місто не відкрилося',
    tryAgain: 'Спробувати ще',
  },
}
