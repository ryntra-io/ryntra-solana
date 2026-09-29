#!/usr/bin/env node
/**
 * The release checks — what must be true before an APK or a bundle is
 * handed to anyone. Static, fast, no network: the identity and the version,
 * the signing plugin and its guard, nothing secret tracked, the development
 * doors gated, the API pointed at production, the pinned contract present.
 * `--require-key` also demands the Owner's keystore in the environment (the
 * release build script passes it); without the flag the key is reported,
 * not required, so the checks run on any machine.
 *
 *   node scripts/release-check.mjs [--require-key]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const requireKey = process.argv.includes('--require-key')
const PACKAGE = 'io.ryntra.app'
const SCHEME = 'ryntra'
const API = 'https://ryntra.io'
const PLUGIN = './plugins/with-release-signing.js'
const MARK = 'ryntra: release signing from the environment'
const KEY_VARS = [
  'RYNTRA_RELEASE_KEYSTORE',
  'RYNTRA_RELEASE_KEYSTORE_PASSWORD',
  'RYNTRA_RELEASE_KEY_ALIAS',
  'RYNTRA_RELEASE_KEY_PASSWORD',
]

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })
const info = (name, detail) => results.push({ name, ok: null, detail })
const read = (path) => readFileSync(join(root, path), 'utf8')
const json = (path) => JSON.parse(read(path))

/* ---- identity and version ---- */
const app = json('app.json').expo
const pkg = json('package.json')
check('package id', app.android?.package === PACKAGE, app.android?.package)
check('scheme', app.scheme === SCHEME, app.scheme)
check('version is semver', /^\d+\.\d+\.\d+$/.test(app.version ?? ''), app.version)
check('package.json version matches app.json', pkg.version === app.version, `${pkg.version} / ${app.version}`)
check(
  'versionCode is an integer of at least 2 (1 was the development shell)',
  Number.isInteger(app.android?.versionCode) && app.android.versionCode >= 2,
  String(app.android?.versionCode),
)
check('interface style follows the system', app.userInterfaceStyle === 'automatic', app.userInterfaceStyle)

/* ---- the links the phone owns ---- */
const filters = app.android?.intentFilters ?? []
const paths = filters.flatMap((filter) =>
  (filter.data ?? []).map((d) => `${d.scheme}://${d.host}${d.pathPrefix ?? ''}`),
)
const wanted = ['https://ryntra.io/app/alerts', 'https://ryntra.io/app/strategies']
check(
  'App Links intent filters for the monitoring and plan pages, auto-verified',
  wanted.every((w) => paths.includes(w)) && filters.every((f) => f.autoVerify === true),
  paths.join(', '),
)

/* ---- signing ---- */
check('release signing plugin registered', (app.plugins ?? []).includes(PLUGIN), PLUGIN)
check('release signing plugin present with its guard', existsSync(join(root, PLUGIN)) && read(PLUGIN).includes(MARK))
const gradle = join(root, 'android/app/build.gradle')
if (existsSync(gradle)) {
  const src = readFileSync(gradle, 'utf8')
  check(
    'generated build.gradle carries the release signing and its guard',
    src.includes(MARK) && !/release \{[^}]*signingConfig signingConfigs\.debug/.test(src),
  )
  const applicationId = /applicationId '([^']+)'/.exec(src)?.[1]
  check(
    "generated build.gradle is the release's package, not the development build's (RYNTRA_VARIANT unset)",
    applicationId === PACKAGE,
    applicationId,
  )
  const code = /versionCode (\d+)/.exec(src)?.[1]
  const name = /versionName "([^"]+)"/.exec(src)?.[1]
  check(
    'generated build.gradle carries the version of app.json (run expo prebuild after a bump)',
    code === String(app.android.versionCode) && name === app.version,
    `${name} (${code})`,
  )
} else {
  info('android/ not generated here', 'expo prebuild -p android writes it; the build script does')
}
const keySet = KEY_VARS.filter((name) => process.env[name])
if (requireKey) {
  check(
    "the Owner's keystore in the environment",
    keySet.length === KEY_VARS.length,
    `${keySet.length} of ${KEY_VARS.length} variables set`,
  )
  if (process.env.RYNTRA_RELEASE_KEYSTORE) {
    check('RYNTRA_RELEASE_KEYSTORE points at a file', existsSync(process.env.RYNTRA_RELEASE_KEYSTORE))
  }
} else {
  info(
    "the Owner's keystore in the environment",
    keySet.length === KEY_VARS.length
      ? 'set'
      : `${keySet.length} of ${KEY_VARS.length} variables set — a build signed from the environment needs all four; an unsigned one for the Owner's apksigner (--unsigned) none`,
  )
}

/* ---- nothing secret tracked ---- */
let tracked = []
try {
  tracked = execFileSync('git', ['ls-files', '--', '.'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
} catch {
  info('git ls-files', 'not a git checkout here; the tracked-secrets check was skipped')
}
const secretLike = tracked.filter((file) =>
  /(\.jks|\.keystore|\.p12|\.pem)$|(^|\/)google-services\.json$|(^|\/)\.env(\.|$)|keystore\.properties$/.test(file),
)
check('no keystore, Firebase client file or .env tracked', secretLike.length === 0, secretLike.join(', '))
const ignore = read('.gitignore')
check(
  '.gitignore covers keystores, Firebase client files, .env and builds',
  ['*.keystore', '*.jks', 'google-services.json', '.env', '*.apk', '*.aab', '/android'].every((rule) =>
    ignore.includes(rule),
  ),
)

/* ---- the code as shipped ---- */
const more = read('src/screens/more/index.tsx')
check('the design gallery door is development-only', /__DEV__\s*\?/.test(more) && more.includes("'/gallery'"))
const api = read('src/lib/api.ts')
check('the API base is production', api.includes(`API_BASE_URL = '${API}'`))
const srcFiles = tracked.filter((file) => file.startsWith('src/') && /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))
const debugLines = srcFiles.filter((file) => /console\.log\(['"`]DEBUG/.test(read(file)))
check('no debug logging left in the source', debugLines.length === 0, debugLines.join(', '))
const localhost = srcFiles.filter((file) => /localhost|127\.0\.0\.1/.test(read(file)))
check('no localhost address in the source', localhost.length === 0, localhost.join(', '))
const pin = json('src/lib/api/v1/PIN.json')
check(
  'the API client is pinned to a contract version',
  /^\d+\.\d+\.\d+$/.test(pin.contractVersion ?? '') && /^[0-9a-f]{8,}$/.test(pin.commit ?? ''),
  `${pin.contractVersion} @ ${pin.commit}`,
)
check(
  'the Firebase client file is not required by the build',
  !read('app.config.js').includes('throw'),
  'the build runs without it; push waits',
)

/* ---- report ---- */
let failed = 0
for (const result of results) {
  const mark = result.ok === null ? 'INFO' : result.ok ? 'PASS' : 'FAIL'
  if (result.ok === false) failed += 1
  console.log(`${mark}  ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
}
console.log(failed === 0 ? '\nrelease-check: every check passed' : `\nrelease-check: ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
