import type { PaletteKey } from '../lib/palette.ts';

/**
 * The rules of Ryntra City's look that are not a colour value: which light means what and how much of a frame it may
 * take, the two faces and the type scale, the chrome. The brandbook (docs/city/brand/BRANDBOOK.md and its specimen,
 * built by scripts/city/brandbook.mjs) prints these; city/styles/city.module.css carries the same values as CSS
 * variables, and scripts/city/brand-tokens.test.mjs keeps the two equal. Nothing here draws: safe anywhere.
 */

export type Role = Readonly<{
  key: PaletteKey;
  /** The CSS variable on the city's root. */
  token: `--${string}`;
  /** What it means in the city, as the brandbook prints it (Ukrainian, like the repo's docs). */
  role: string;
  /** About how much of a frame it may take (AFTERGLOW, city/lib/palette.ts). */
  share: string;
}>;

/** Four lights on one ink, and the grounds they stand on. */
export const ROLES: readonly Role[] = [
  { key: 'ink', token: '--ink', role: 'нічне тло, диск знака, текст на amber', share: 'тло' },
  { key: 'inkDeep', token: '--ink-deep', role: 'сторінка за містом, тіні під словами', share: 'тло' },
  { key: 'zenith', token: '--zenith', role: 'небо над містом', share: 'тло' },
  { key: 'graphite', token: '--graphite', role: 'об’єми: вежі, поверхи, панелі', share: 'тло' },
  { key: 'violetHaze', token: '--violet-haze', role: 'серпанок між вежами, заливки панелей', share: '~20% разом з violet' },
  { key: 'violet', token: '--violet', role: 'післясвітіння: обводи, ребра скла, корона знака', share: '~20% разом із серпанком' },
  { key: 'amber', token: '--amber', role: 'збережене сонце: вікна, одна дія на екран, одиниці', share: '~8%' },
  { key: 'warmWhite', token: '--warm', role: 'гарячий край amber: серця ліхтарів, відблиск кнопки', share: 'разом з amber' },
  { key: 'mint', token: '--mint', role: 'вартість росте, запуски в доках — ніколи не прикраса', share: '~2%' },
  { key: 'flare', token: '--flare', role: 'лише небезпека: падіння ціни, невдала угода, ризик', share: 'лише коли правда' },
  { key: 'ice', token: '--ice', role: 'текст', share: 'текст' },
  { key: 'pearl', token: '--pearl', role: 'світлий камінь у 3D (садові поверхи)', share: 'матеріал' },
];

export type Face = Readonly<{ family: string; token: `--${string}`; use: string; weights: string; width: string; case: string; tracking: string }>;

/** The two faces, loaded by next/font on the city's pages (app/(home)/page.tsx) into these variables. */
export const FACES: readonly Face[] = [
  { family: 'Hubot Sans', token: '--font-display', use: 'слово RYNTRA, заголовки, суми, кікери, кнопки', weights: '800–900', width: '125% (wdth 125)', case: 'ВЕЛИКИМИ', tracking: '0,01em; слово-знак 0,06em' },
  { family: 'Mona Sans', token: '--font-ui', use: 'усе, що читають реченнями: підписи, рядки, примітки', weights: '400–800', width: '100%', case: 'як у реченні', tracking: '0' },
];

export type Step = Readonly<{ token: `--${string}`; px: number; use: string }>;

/**
 * The UI scale: the sizes the city's sheets already use most (scripts/city/brandbook.mjs counts them), named. A new
 * screen takes its sizes from here; a size off the scale is moved onto it the next time its sheet is edited.
 */
export const TYPE: readonly Step[] = [
  { token: '--type-micro', px: 11, use: 'мітки й кікери великими з трекінгом' },
  { token: '--type-caption', px: 12, use: 'підписи, одиниці під сумами' },
  { token: '--type-small', px: 13, use: 'другорядні рядки, примітки' },
  { token: '--type-body', px: 14, use: 'рядки аркуша: You pay, Network fee' },
  { token: '--type-base', px: 15, use: 'основний текст' },
  { token: '--type-lead', px: 17, use: 'вступний рядок панелі' },
  { token: '--type-action', px: 18, use: 'amber-дія' },
  { token: '--type-title', px: 20, use: 'заголовки панелей' },
  { token: '--type-title-l', px: 22, use: 'заголовки аркушів' },
  { token: '--type-headline', px: 24, use: 'символ вежі на панелі' },
  { token: '--type-figure', px: 30, use: 'сума на аркуші' },
];

/** Display words grow with the screen: clamp(min, vw, max), always the display face, line height 1 or less. */
export const DISPLAY = { face: 'Hubot Sans', lineHeight: '0.9–1', rule: 'clamp(min, vw, max) на кожному екрані; в один рядок' } as const;

/** Chrome: chamfered dark glass with an inner violet edge, no hairline grids, no blur over the live canvas. */
export const CHROME = {
  cut: 14,
  gutter: 16,
  glass: 'rgba(11, 10, 20, 0.78)',
  glassEdge: 'rgba(153, 69, 255, 0.55)',
  textDim: 'rgba(238, 241, 255, 0.62)',
} as const;
