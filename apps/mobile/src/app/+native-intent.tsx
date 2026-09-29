/**
 * Expo Router hands every URL the OS opens the app with through here — the
 * app's scheme, the site's links, a push's link — before it becomes a route.
 * The one mapper decides; see `features/monitoring/deep-link.ts`.
 */
export { redirectSystemPath } from '@/features/monitoring/deep-link'
