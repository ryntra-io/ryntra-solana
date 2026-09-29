/**
 * Ryntra Brand Canon v1.0 — the token layer of the native client.
 *
 * Every value here is copied from the web repository's `DESIGN.md` frontmatter
 * (the machine projection of the shipped token layer, Owner-fixed 2026-09-11).
 * Nothing is invented here: a new value is first declared there, then copied.
 * `scripts/theme-css.mjs` projects this file into `src/theme/tokens.css` for
 * Uniwind; `tokens.test.mjs` fails when the two drift apart.
 */

/** Brand and interaction colours — identical in both themes. */
export const brand = {
  brand: '#FF681C',
  brandHover: '#FF7A2F',
  brandDeep: '#F24C0C',
  brandPressed: '#E0430A',
  brandLift: '#FF8A4A',
  brandSink: '#C24509',
  onBrand: '#FFFFFF',
  honey: '#F5A524',
  brandSoft: 'rgba(255, 104, 28, 0.12)',
  brandLine: 'rgba(255, 104, 28, 0.32)',
  brandEdge: 'rgba(255, 190, 120, 0.35)',
  brandGlow: 'rgba(255, 104, 28, 0.22)',
  brandChip: 'rgba(255, 104, 28, 0.14)',
  brandChipLine: 'rgba(255, 104, 28, 0.45)',
  focus: 'rgba(255, 104, 28, 0.35)',
  /** Solana's own light — only on and around the Solana object, never a surface, text or action. */
  solanaGreen: '#00FFA3',
  solanaPurple: '#DC1FFF',
  solanaViolet: '#9945FF',
} as const

/** Theme-dependent colours. Keys are the semantic names the UI reads. */
export const themes = {
  dark: {
    ground: '#080D13',
    groundTop: '#0C141D',
    groundEdge: '#070B10',
    sidebar: '#0B121A',
    surface: '#0E1620',
    elevated: '#131E2A',
    hover: '#172230',
    line: '#22303E',
    lineStrong: '#2F4052',
    track: '#1B2632',
    fg: '#F5F7FA',
    muted: '#91A0B2',
    fgMuted: '#7A8899',
    env: 'rgba(145, 160, 178, 0.14)',
    shadowSm: 'rgba(0, 0, 0, 0.35)',
    shadowMd: 'rgba(0, 0, 0, 0.45)',
    shadowElevated: 'rgba(0, 0, 0, 0.60)',
    success: '#19C77A',
    onSuccess: '#05331F',
    successSoft: 'rgba(25, 199, 122, 0.13)',
    successInk: '#19C77A',
    danger: '#FF4D55',
    onDanger: '#3D0A0D',
    dangerSoft: 'rgba(255, 77, 85, 0.13)',
    dangerInk: '#FF4D55',
    warning: '#F5A524',
    onWarning: '#3D2A05',
    warningSoft: 'rgba(245, 165, 36, 0.14)',
    warningInk: '#F5A524',
    info: '#5B9CF5',
    onInfo: '#0A2C5C',
    evidence: '#9DB3D1',
    evidenceSoft: 'rgba(157, 179, 209, 0.12)',
    evidenceLine: 'rgba(157, 179, 209, 0.30)',
    chart2: '#8FA6C8',
    chart5: '#6E8CA0',
    chart6: '#64748B',
  },
  light: {
    ground: '#F5F7FA',
    groundTop: '#F5F7FA',
    groundEdge: '#F1F4F8',
    sidebar: '#FFFFFF',
    surface: '#FFFFFF',
    elevated: '#FAFBFC',
    hover: '#EEF2F6',
    line: '#DDE3EA',
    lineStrong: '#C5CED9',
    track: '#E6EBF1',
    fg: '#111820',
    muted: '#667085',
    fgMuted: '#7C8798',
    env: 'rgba(102, 112, 133, 0.12)',
    shadowSm: 'rgba(17, 24, 32, 0.05)',
    shadowMd: 'rgba(17, 24, 32, 0.12)',
    shadowElevated: 'rgba(17, 24, 32, 0.18)',
    success: '#169B62',
    onSuccess: '#05331F',
    successSoft: 'rgba(22, 155, 98, 0.12)',
    successInk: '#0F7A4D',
    danger: '#E53E45',
    onDanger: '#3D0A0D',
    dangerSoft: 'rgba(229, 62, 69, 0.12)',
    dangerInk: '#D0343B',
    warning: '#E99618',
    onWarning: '#3D2A05',
    warningSoft: 'rgba(233, 150, 24, 0.14)',
    warningInk: '#A8650A',
    info: '#2F6FD6',
    onInfo: '#0A2C5C',
    evidence: '#4E6480',
    evidenceSoft: 'rgba(78, 100, 128, 0.10)',
    evidenceLine: 'rgba(78, 100, 128, 0.28)',
    chart2: '#8FA6C8',
    chart5: '#6E8CA0',
    chart6: '#64748B',
  },
} as const

export type ThemeName = keyof typeof themes
export type ThemeColors = (typeof themes)[ThemeName]
export type Colors = ThemeColors & typeof brand

/** Radii, px — the scale of DESIGN.md `rounded`. */
export const radius = {
  focusTight: 2,
  focusSm: 4,
  focusMd: 6,
  xs: 8,
  btn: 10,
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
} as const

/** Spacing, px — the 4-point scale of DESIGN.md `spacing`. */
export const spacing = {
  '2xs': 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 72,
} as const

/**
 * Font families as embedded by the expo-font config plugin (static weights, one
 * file per weight; the family name is the file name). Weight is chosen by
 * family, never by `fontWeight`.
 */
export const fonts = {
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  sansSemibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
  monoSemibold: 'GeistMono_600SemiBold',
} as const

/** The cabinet type ramp of DESIGN.md `typography`, rem × 16, mobile end of every clamp. */
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

/** Motion, ms — short and expensive. */
export const motion = {
  fast: 150,
  base: 200,
  slow: 220,
} as const

export const tokens = { brand, themes, radius, spacing, fonts, type, motion } as const
