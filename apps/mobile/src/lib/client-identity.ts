import Constants from 'expo-constants'

import type { ApiClientIdentity } from '@/lib/api'

/**
 * Who is asking, as the contract's `client` on the challenge and the verify:
 * the platform, the app's version and its package — read from the build's
 * own config, never typed by hand, so the server's minimum-version check
 * judges the version that is actually running.
 */
export const CLIENT_IDENTITY: ApiClientIdentity = {
  platform: 'android',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
  package: Constants.expoConfig?.android?.package ?? 'io.ryntra.app',
}
