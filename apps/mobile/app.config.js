const { existsSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')

/**
 * The development build's own identity (`RYNTRA_VARIANT=dev`): a package of its
 * own, `io.ryntra.app.dev`, so it installs beside the operator's signed release
 * instead of over it (the debug key cannot replace the release, and replacing
 * it would lose the sign-in); its own name on the launcher, «Ryntra Dev»; its
 * own scheme, `ryntra-dev`, so a `ryntra://` link never asks which app to open;
 * and no claim on ryntra.io's links, which verify only for the release's
 * certificate. Everything else — the code, the API, the look — is the release's.
 * The release build refuses to run with the variant set.
 */
const DEV_PACKAGE = 'io.ryntra.app.dev'
const DEV_SCHEME = 'ryntra-dev'
const DEV_NAME = 'Ryntra Dev'

/**
 * The static config (`app.json`) plus what only the operator's machine holds:
 * the Firebase client configuration for push tokens. The file is never in
 * the repository (`google-services.json` is ignored); when it stands beside
 * this file, or where `RYNTRA_GOOGLE_SERVICES_FILE` points, the Android
 * build takes it and the phone can hold a device token. Without it the app
 * builds and runs the same, and says on the notification settings that this
 * build cannot receive push yet.
 */
module.exports = ({ config }) => {
  const named = process.env.RYNTRA_GOOGLE_SERVICES_FILE
  const candidate = named
    ? isAbsolute(named)
      ? named
      : join(__dirname, named)
    : join(__dirname, 'google-services.json')
  const android = { ...config.android }
  if (existsSync(candidate)) android.googleServicesFile = candidate
  if (process.env.RYNTRA_VARIANT === 'dev') {
    android.package = DEV_PACKAGE
    delete android.intentFilters
    // The Firebase client file names the release's package; the development build waits for push without it.
    delete android.googleServicesFile
    return { ...config, name: DEV_NAME, scheme: DEV_SCHEME, android }
  }
  return { ...config, android }
}
