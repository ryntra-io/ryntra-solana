import { createMMKV } from 'react-native-mmkv'
import { Uniwind } from 'uniwind'

export type ThemeMode = 'dark' | 'light' | 'system'

export const THEME_MODES: readonly { mode: ThemeMode; label: string }[] = [
  { mode: 'dark', label: 'Dark' },
  { mode: 'light', label: 'Light' },
  { mode: 'system', label: 'System' },
]

/** Dark is the presentation theme (Brand Canon v1.0); the choice persists on the device. */
const DEFAULT_MODE: ThemeMode = 'dark'
const STORAGE_KEY = 'theme.mode'

const storage = createMMKV({ id: 'ryntra.preferences' })

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'dark' || value === 'light' || value === 'system'
}

export function getThemeMode(): ThemeMode {
  const stored = storage.getString(STORAGE_KEY)
  return isThemeMode(stored) ? stored : DEFAULT_MODE
}

export function setThemeMode(mode: ThemeMode) {
  storage.set(STORAGE_KEY, mode)
  Uniwind.setTheme(mode)
}

/** Called once at startup, before the first frame, so the app never flashes the other theme. */
export function applyStoredThemeMode() {
  Uniwind.setTheme(getThemeMode())
}
