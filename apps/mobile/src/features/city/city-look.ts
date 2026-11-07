/**
 * The city's own look around the page (decision 75, the city's brandbook `docs/city/brand/BRANDBOOK.md`): the night ink,
 * amber with ink text on it, ice text. The app draws only what the page cannot — its launch, «no connection», «did not
 * open» — and draws it as the launch screen does: the night and the Ryntra mark, one line, one button. No picture stands
 * in for the live city.
 */

/** The night behind the city and its launch: the brand's ink, the launch screen's own. */
export const CITY_GROUND = '#0B0A14'
/** Saved amber — the one action on a screen; text on it is ink. */
export const CITY_AMBER = '#FFB23F'
export const CITY_ON_AMBER = '#0B0A14'
/** Ice — text on the night. */
export const CITY_ICE = '#EEF1FF'

export const CITY_FONT = 'Geist_500Medium'
export const CITY_FONT_STRONG = 'Geist_600SemiBold'

/** The Ryntra mark — the spire through the eclipse, the launch screen's own image, at the launch screen's own width. */
export const CITY_MARK = require('../../../assets/images/splash-icon.png') as number
export const CITY_MARK_SIZE = 112
