const { withAppBuildGradle } = require('expo/config-plugins')

/**
 * Release signing with the publisher's release keystore, which lives outside the
 * repository. A release reaches it one of two ways:
 *
 * - signed by the build, from the environment:
 *     RYNTRA_RELEASE_KEYSTORE           absolute path to the .jks / .keystore
 *     RYNTRA_RELEASE_KEYSTORE_PASSWORD  the store password
 *     RYNTRA_RELEASE_KEY_ALIAS          the key alias
 *     RYNTRA_RELEASE_KEY_PASSWORD       the key password
 * - built unsigned when RYNTRA_RELEASE_UNSIGNED=1 asks for it
 *   (`app-release-unsigned.apk`), then signed by the publisher with apksigner,
 *   whose own prompt takes the passwords — they never pass through the build.
 *
 * The generated `android/app/build.gradle` signs release builds with the
 * shared Expo debug key by default — a key every Expo project ships, so a
 * release signed with it would let any app pass as Ryntra. This plugin
 * replaces that: the release build type signs with the publisher's release key when the
 * variables are set, and a release task with neither the variables nor the
 * unsigned request stops before it builds. Nothing here reads, copies or
 * prints a key.
 */
const MARK = '// ryntra: release signing from the environment (plugins/with-release-signing.js)'

const SIGNING_CONFIG = (indent) =>
  [
    `${indent}${MARK}`,
    `${indent}release {`,
    `${indent}    def ryntraKeystore = System.getenv('RYNTRA_RELEASE_KEYSTORE')`,
    `${indent}    if (ryntraKeystore) {`,
    `${indent}        storeFile file(ryntraKeystore)`,
    `${indent}        storePassword System.getenv('RYNTRA_RELEASE_KEYSTORE_PASSWORD')`,
    `${indent}        keyAlias System.getenv('RYNTRA_RELEASE_KEY_ALIAS')`,
    `${indent}        keyPassword System.getenv('RYNTRA_RELEASE_KEY_PASSWORD')`,
    `${indent}    }`,
    `${indent}}`,
  ].join('\n')

const GUARD = `
${MARK}
// A release task signs with the publisher's release keystore from the environment, or builds unsigned for the publisher's apksigner when RYNTRA_RELEASE_UNSIGNED=1; it is never signed with the shared debug key.
gradle.taskGraph.whenReady { graph ->
    def wantsRelease = graph.allTasks.any { task ->
        task.project == project && (task.name.startsWith('assembleRelease') || task.name.startsWith('bundleRelease') || task.name.startsWith('packageRelease'))
    }
    if (!wantsRelease) return
    if (System.getenv('RYNTRA_RELEASE_UNSIGNED') == '1') {
        if (System.getenv('RYNTRA_RELEASE_KEYSTORE')) {
            throw new GradleException("Ryntra release: RYNTRA_RELEASE_UNSIGNED and RYNTRA_RELEASE_KEYSTORE are both set. Build unsigned for the publisher's apksigner, or signed from the environment, not both.")
        }
        return
    }
    def missing = ['RYNTRA_RELEASE_KEYSTORE', 'RYNTRA_RELEASE_KEYSTORE_PASSWORD', 'RYNTRA_RELEASE_KEY_ALIAS', 'RYNTRA_RELEASE_KEY_PASSWORD'].findAll { !System.getenv(it) }
    if (!missing.isEmpty()) {
        throw new GradleException("Ryntra release: " + missing.join(', ') + " not set. The publisher's release keystore stays outside the repository and reaches the build through these variables only, or RYNTRA_RELEASE_UNSIGNED=1 builds an unsigned APK for the publisher to sign with apksigner (docs/release/RELEASE.md).")
    }
    def keystore = new File(System.getenv('RYNTRA_RELEASE_KEYSTORE'))
    if (!keystore.isFile()) {
        throw new GradleException("Ryntra release: RYNTRA_RELEASE_KEYSTORE does not point at a file.")
    }
}
`

// Where an earlier prebuild left the guard: the unindented mark followed by the guard's own comment.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const GUARD_AT = new RegExp(`\\r?\\n${escape(MARK)}\\r?\\n// A release task`)

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('with-release-signing: android/app/build.gradle is not Groovy; the plugin needs updating')
    }
    let src = mod.modResults.contents
    if (src.includes(MARK)) {
      // Applied by an earlier prebuild: the signing config stays, the guard is brought up to date.
      const at = src.search(GUARD_AT)
      if (at === -1) throw new Error('with-release-signing: build.gradle carries the release signing but not its guard')
      mod.modResults.contents = `${src.slice(0, at).trimEnd()}\n${GUARD}`
      return mod
    }

    // 1. The release build type signs with the publisher's release key — the debug key is never its fallback.
    const debugFallback = /(buildTypes \{[\s\S]*?release \{[^}]*?)signingConfig signingConfigs\.debug/
    if (!debugFallback.test(src)) {
      throw new Error(
        'with-release-signing: the release build type of build.gradle does not look like the Expo template',
      )
    }
    src = src.replace(
      debugFallback,
      `$1signingConfig System.getenv('RYNTRA_RELEASE_KEYSTORE') ? signingConfigs.release : null`,
    )

    // 2. The signing config itself, beside the template's debug one.
    const signing = /signingConfigs \{\n(\s*)debug \{/
    const match = signing.exec(src)
    if (!match) throw new Error('with-release-signing: signingConfigs block not found in build.gradle')
    src = src.replace(signing, `signingConfigs {\n${SIGNING_CONFIG(match[1])}\n${match[1]}debug {`)

    // 3. The guard.
    src = `${src.trimEnd()}\n${GUARD}`
    mod.modResults.contents = src
    return mod
  })
}

module.exports = withReleaseSigning
