/**
 * The app's own words around the page: the states that cover ryntra.io while it
 * cannot show. The page itself speaks the site's own words. «ти», neutral to gender.
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
    label: 'Ryntra',
    loading: 'Opening Ryntra',
    noConnection: 'No connection',
    notOpened: "Couldn't open Ryntra",
    tryAgain: 'Try again',
  },
  uk: {
    label: 'Ryntra',
    loading: 'Відкриваємо Ryntra',
    noConnection: "Немає з'єднання",
    notOpened: 'Не вдалося відкрити Ryntra',
    tryAgain: 'Спробувати ще',
  },
}
