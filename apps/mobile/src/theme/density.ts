/**
 * How tight the app sits — the web's own two densities (`ryntra-core` look:
 * «Звичайна» and «Компактна»). One look for everyone, no mode: a density is
 * only the spacing a few shared surfaces read — the screen's rhythm, a
 * card's padding, a list row's height — never what a screen shows. Touch
 * targets and type stay as they are: a row is never shorter than 48dp
 * (`min-h-12` on a door row), whatever its padding.
 */

export type Density = 'regular' | 'compact'

export const DENSITIES: readonly Density[] = ['regular', 'compact']
export const DEFAULT_DENSITY: Density = 'regular'

/** The screen's rhythm between its parts: `stack` for most, `section` and `page` for screens of fewer, larger parts. */
export type Rhythm = 'stack' | 'section' | 'page'

export type Space = Readonly<{
  /** The gap between a screen's parts, by its rhythm. */
  rhythm: Readonly<Record<Rhythm, string>>
  /** A padded card's inside. */
  card: string
  /** A list row's vertical padding (a market, a holding). */
  row: string
  /** A door row's vertical padding (a place's doors, settings). */
  door: string
}>

/** Whole class names, so the stylesheet compiler sees every one of them. */
export const SPACE: Readonly<Record<Density, Space>> = {
  regular: {
    rhythm: { stack: 'gap-3', section: 'gap-5', page: 'gap-6' },
    card: 'p-4',
    row: 'py-3',
    door: 'py-3.5',
  },
  compact: {
    rhythm: { stack: 'gap-2', section: 'gap-3', page: 'gap-4' },
    card: 'p-3',
    row: 'py-2',
    door: 'py-2.5',
  },
}

export function isDensity(value: unknown): value is Density {
  return (DENSITIES as readonly unknown[]).includes(value)
}
