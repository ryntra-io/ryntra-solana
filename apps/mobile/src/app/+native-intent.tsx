import { cityRouteOfLink } from '@/features/city/city-page'

/**
 * Expo Router hands every URL the OS opens the app with through here — the app's scheme, the site's links — before it
 * becomes a route. The app is the city (decision 75): a coin's tower opens the city on it, the city's own link with what
 * it asks (`/?open=agent`, `/?early=<mint>`), everything else the city.
 */
export function redirectSystemPath(input: Readonly<{ path: string; initial: boolean }>): string {
  return cityRouteOfLink(input.path)
}
