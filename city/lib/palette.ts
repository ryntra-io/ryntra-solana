/**
 * AFTERGLOW — a city that spends at night the sun it stored by day.
 * Four lights on one ink: violet haze (~20%), stored-sun amber (~8%), mint for value (~2%), red only for danger.
 * The same values are CSS variables in city/styles/city.module.css; 3D materials and the page's theme colour read them
 * from here.
 */
export const PALETTE = {
  ink: '#0B0A14',
  inkDeep: '#06050C',
  graphite: '#23222D',
  pearl: '#E9E4DA',
  violet: '#9945FF',
  violetHaze: '#2A1640',
  zenith: '#120B2A',
  amber: '#FFB23F',
  warmWhite: '#FFE7C2',
  mint: '#14F195',
  flare: '#FF4B3A',
  ice: '#EEF1FF',
} as const;

export type PaletteKey = keyof typeof PALETTE;
