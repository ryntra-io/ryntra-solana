/**
 * Ryntra Brand — the token layer of the native client.
 *
 * Every colour is the core's own (`core-tokens.ts`, the JSON tokens of task A2
 * copied by `scripts/sync-tokens.mjs`): Graphite is the dark theme and the
 * default, Porcelain the light one — the web draws the same two from the same
 * file, so a surface of the phone and of ryntra.io is the same pixel. The keys
 * are the semantic names the UI reads; a key the core has no word for is made
 * of one of its colours — a tint is its colour at an alpha, never a new hue.
 * `scripts/theme-css.mjs` projects this file into `src/theme/tokens.css` for
 * Uniwind; `tokens.test.mjs` fails when the two drift apart or a value leaves
 * the core's.
 */
import { core } from './core-tokens.ts'

type CoreTheme = (typeof core.themes)[keyof typeof core.themes]

/** `#RRGGBB` at an alpha — a tint of a core colour, `rgba(…)` as Uniwind and React Native both read it. */
export function tint(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

/** WCAG contrast of two `#RRGGBB` colours. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16)
    const [r, g, bl] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
      const c = channel / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** One theme's semantic colours, from the core's palette of that theme. */
function themeOf({ color: c, effect }: CoreTheme) {
  return {
    /** The page. */
    ground: c.bg,
    /** Blocks, panels. */
    surface: c.surface,
    /** Sheets, menus, the raised block. */
    elevated: c.elevated,
    /** A row under the finger. */
    hover: c['surface-hover'],
    /** Borders and rules. */
    line: c.border,
    /** A border that asks for attention: a field, a handle. */
    lineStrong: c['border-hover'],
    /** The empty part of a bar or a switch. */
    track: c.border,
    fg: c.text,
    muted: c.muted,
    /** The quietest words — the core's one muted, which already holds 4.5:1. */
    fgMuted: c.muted,
    /** The one orange action, the current place, focus. */
    brand: c.brand,
    /** The orange word in small text — the core's `brand-text`. */
    brandInk: c['brand-text'],
    brandPressed: c['brand-pressed'],
    /** Text on orange is dark. */
    onBrand: c['on-brand'],
    brandLine: tint(c.brand, 0.32),
    brandGlow: tint(c.brand, 0.22),
    brandChip: tint(c.brand, 0.14),
    brandChipLine: tint(c.brand, 0.45),
    success: c.up,
    successInk: c['up-text'],
    successSoft: tint(c.up, 0.13),
    danger: c.down,
    /** Words on a red button: the core's dark ink, or its white surface where the ink falls under 4.5:1. */
    onDanger: contrast(c['on-brand'], c.down) >= 4.5 ? c['on-brand'] : c.surface,
    /** Graphite's text in both themes — words over the camera, a switch's thumb: what stays light on any picture. */
    inkLight: core.themes.graphite.color.text,
    dangerInk: c['down-text'],
    dangerSoft: tint(c.down, 0.13),
    warning: c.warn,
    warningInk: c['warn-text'],
    warningSoft: tint(c.warn, 0.14),
    info: c.info,
    infoInk: c['info-text'],
    /** What a figure stands on — its source and its time: the core's quiet word, never a hue of its own. */
    evidence: c.muted,
    evidenceSoft: tint(c.muted, 0.12),
    evidenceLine: tint(c.muted, 0.3),
    /** What dims the screen under a sheet or over the camera — the core's scrim. */
    scrim: effect.scrim,
    /** A price line: quieter than the figure beside it. */
    chart2: c.muted,
  } as const
}

/** Theme-dependent colours: `dark` is the core's Graphite, `light` its Porcelain. */
export const themes = {
  dark: themeOf(core.themes.graphite),
  light: themeOf(core.themes.porcelain),
} as const

export type ThemeName = keyof typeof themes
export type Colors = { readonly [K in keyof (typeof themes)['dark']]: string }

/** Radii, px — the core's `radius` (field 8, button 10, block 12, card 16, pill) and the phone's focus rings. */
export const radius = {
  focusTight: 2,
  focusSm: 4,
  focusMd: 6,
  xs: core.radius.field,
  btn: core.radius.button,
  sm: core.radius.block,
  md: core.radius.card,
  lg: 20,
  pill: core.radius.pill,
} as const

/** Spacing, px — the core's 4-point `space`, and the phone's two wide steps above it. */
export const spacing = {
  '2xs': core.space['1'],
  xs: core.space['2'],
  sm: core.space['3'],
  md: core.space['4'],
  lg: core.space['6'],
  xl: core.space['8'],
  '2xl': 48,
  '3xl': 72,
} as const

/**
 * Font families as embedded by the expo-font config plugin (static weights, one
 * file per weight; the family name is the file name) — the core's Geist and
 * Geist Mono. Weight is chosen by family, never by `fontWeight`.
 */
export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
  monoSemibold: 'GeistMono_600SemiBold',
} as const

/** The phone's type ramp — Geist and Geist Mono at the mobile end of the web's sizes. */
export const type = {
  display: { fontFamily: fonts.sansSemibold, fontSize: 32, lineHeight: 34, letterSpacing: -0.8 },
  headline: { fontFamily: fonts.sansSemibold, fontSize: 24, lineHeight: 28, letterSpacing: -0.48 },
  title: { fontFamily: fonts.sansSemibold, fontSize: 18, lineHeight: 24, letterSpacing: -0.18 },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 23, letterSpacing: 0 },
  ui: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 17, letterSpacing: 0 },
  label: { fontFamily: fonts.sansSemibold, fontSize: 12, lineHeight: 14, letterSpacing: 0.72 },
  labelSm: { fontFamily: fonts.sansSemibold, fontSize: 11, lineHeight: 13, letterSpacing: 0.66 },
  data: { fontFamily: fonts.monoMedium, fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  dataLg: { fontFamily: fonts.monoSemibold, fontSize: 24, lineHeight: 28, letterSpacing: 0 },
} as const

export type TypeVariant = keyof typeof type

/** Motion, ms — the core's `motion`: short and expensive. */
export const motion = {
  fast: core.motion.fast,
  base: core.motion.base,
} as const

/**
 * The page's widths — the core's `page`: on a window wider than a phone, a screen stands as one column in the
 * middle, never pressed to an edge. An overview (Home, Portfolio, a list) is the web's main column beside its aside
 * at the wide break — `wide − aside.max − gap`; the phone draws no aside, so the column stands alone. An action (a
 * form, a Review, the settings) is the core's `action` column.
 */
export const page = {
  overview: core.page.wide - core.page.aside.max - core.page.gap,
  action: core.page.action,
} as const

export type PageKind = keyof typeof page

export const tokens = { themes, radius, spacing, fonts, type, motion, page } as const
