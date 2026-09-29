import { useUniwind } from 'uniwind'

import { brand, themes, type Colors, type ThemeName } from './tokens'

export * from './tokens'
export * from './theme-mode'

/**
 * The resolved theme for code that needs a colour value in JavaScript (tab bars,
 * status bar, indicators, icons). Everything drawn with `className` reads the
 * same tokens through Uniwind; this hook is the one bridge for the rest.
 */
export function useTheme(): { name: ThemeName; isDark: boolean; colors: Colors } {
  const { theme } = useUniwind()
  const name: ThemeName = theme === 'light' ? 'light' : 'dark'
  return { name, isDark: name === 'dark', colors: { ...brand, ...themes[name] } }
}
