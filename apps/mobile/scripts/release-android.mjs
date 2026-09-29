#!/usr/bin/env node
/**
 * The release build — one command from a clean checkout to a signed
 * artifact and its certificate fingerprint:
 *
 *   node scripts/release-android.mjs [--aab] [--clean] [--skip-verify] [--abi=arm64-v8a[,…]]
 *   node scripts/release-android.mjs --unsigned [--clean] [--skip-verify] [--abi=…]
 *   node scripts/release-android.mjs --verify=dist/ryntra-<…>.apk
 *
 * 1. `npm run verify` (tokens ↔ CSS, types, lint, unit tests) unless skipped
 * 2. `npx expo prebuild -p android [--clean]` — the native project regenerated
 *    with the version of app.json and the release signing plugin applied
 * 3. `node scripts/release-check.mjs --require-key` — the release checks on
 *    the project just generated, and the Owner's keystore present in the
 *    environment (not with --unsigned)
 * 4. `gradlew :app:assembleRelease` (or `:app:bundleRelease` with --aab) —
 *    signed with the key the environment names; the Gradle guard stops a
 *    build that lacks it, never falling back to the shared debug key.
 *    `--abi` narrows the native architectures (the template builds all four;
 *    a phone-only APK is `--abi=arm64-v8a`); `expo prebuild` resets the
 *    generated gradle.properties, so the choice lives here, not there
 * 5. the artifact copied to `dist/` (ignored) under a name that carries the
 *    version, the version code and the git commit, and its signing
 *    certificate's SHA-256 printed — the fingerprint `assetlinks.json` and
 *    the wallets' identity verification need (request 5)
 *
 * `--unsigned` builds the same release with no key at all
 * (RYNTRA_RELEASE_UNSIGNED=1) as `dist/ryntra-<…>-unsigned.apk` and prints
 * the one apksigner command the Owner runs to sign it: apksigner's own
 * prompt takes the passwords, so they never pass through this script, Gradle
 * or the environment. `--verify=<apk>` then reads the signed APK — its
 * package and version against app.json, its signature, its alignment and its
 * one signer's SHA-256, refused when that is the shared debug certificate.
 *
 * Nothing here reads a password or a key: the four RYNTRA_RELEASE_* variables
 * pass through to Gradle untouched and are never printed.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const aab = args.has('--aab')
const clean = args.has('--clean')
const skipVerify = args.has('--skip-verify')
const unsigned = args.has('--unsigned')
const abi = [...args].find((arg) => arg.startsWith('--abi='))?.slice('--abi='.length) ?? null
const verifyApk = [...args].find((arg) => arg.startsWith('--verify='))?.slice('--verify='.length) ?? null
const windows = process.platform === 'win32'

// The shared Expo debug certificate (request 5): a release is never signed with it.
const DEBUG_CERT_SHA256 =
  'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'

function step(title) {
  console.log(`\n== ${title}`)
}

function fail(message) {
  console.error(`\nrelease-android: ${message}`)
  process.exit(1)
}

// A .bat or .cmd runs only through the shell on Windows; each argument is quoted for it.
const quote = (arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg)
const viaShell = (command) => windows && /\.(bat|cmd)$|^(npm|npx)$/.test(command)

function run(command, commandArgs, options = {}) {
  const shell = viaShell(command)
  const result = spawnSync(shell ? quote(command) : command, shell ? commandArgs.map(quote) : commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell,
    ...options,
  })
  if (result.status !== 0) {
    fail(`"${command} ${commandArgs.join(' ')}" failed (${result.status ?? result.error?.code ?? result.signal})`)
  }
}

function read(command, commandArgs) {
  const shell = viaShell(command)
  const result = spawnSync(shell ? quote(command) : command, shell ? commandArgs.map(quote) : commandArgs, {
    cwd: root,
    encoding: 'utf8',
    shell,
  })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/* ---- the toolchain ---- */
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
if (!sdk || !existsSync(sdk)) fail('ANDROID_HOME (or ANDROID_SDK_ROOT) must point at the Android SDK')
if (!process.env.JAVA_HOME || !existsSync(process.env.JAVA_HOME)) fail('JAVA_HOME must point at a JDK 17')
const buildTools = join(sdk, 'build-tools')
const toolsVersion = existsSync(buildTools)
  ? readdirSync(buildTools)
      .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0]
  : null
const tool = (name) =>
  toolsVersion
    ? join(buildTools, toolsVersion, windows ? `${name}${name === 'apksigner' ? '.bat' : '.exe'}` : name)
    : null
const apksigner = tool('apksigner')
const zipalign = tool('zipalign')
const aapt2 = tool('aapt2')
const keytool = join(process.env.JAVA_HOME, 'bin', windows ? 'keytool.exe' : 'keytool')

const app = JSON.parse(
  execFileSync('node', ['-e', "process.stdout.write(JSON.stringify(require('./app.json').expo))"], {
    cwd: root,
    encoding: 'utf8',
  }),
)

// Uncompressed native libraries on 16 KB pages, everything else on 4 bytes — what Android 15+ phones load.
const aligned = (file) => read(zipalign, ['-c', '-P', '16', '4', file]).ok

/* ---- --verify: the signed APK before it goes anywhere ---- */
if (verifyApk) {
  const file = resolve(verifyApk)
  if (!existsSync(file)) fail(`${file} does not exist`)
  if (!apksigner || !zipalign || !aapt2)
    fail('the build-tools (apksigner, zipalign, aapt2) were not found under ANDROID_HOME')
  step('the APK')
  const badging = read(aapt2, ['dump', 'badging', file])
  const identity = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging.out)
  if (!identity) fail('aapt2 could not read the package line')
  const [, pkg, code, name] = identity
  console.log(`${pkg} · version ${name} · versionCode ${code} · ${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`)
  if (pkg !== app.android.package) fail(`the package is ${pkg}, app.json says ${app.android.package}`)
  if (name !== app.version || code !== String(app.android.versionCode)) {
    fail(`the version is ${name} (${code}), app.json says ${app.version} (${app.android.versionCode})`)
  }
  step('the signature')
  const signature = read(apksigner, ['verify', '--verbose', '--print-certs', file])
  if (!signature.ok) fail(`apksigner does not verify it:\n${signature.out}`)
  for (const line of signature.out.split(/\r?\n/)) {
    if (/^Verified using v\d(\.\d)? scheme/.test(line) || /^Number of signers/.test(line)) console.log(line)
  }
  const signers = /Number of signers: (\d+)/.exec(signature.out)?.[1]
  if (signers !== '1') fail(`${signers ?? 'no'} signers; a release has exactly one`)
  const hex = /Signer #1 certificate SHA-256 digest: ([0-9a-f]{64})/i.exec(signature.out)?.[1]
  if (!hex) fail('apksigner printed no certificate SHA-256')
  const sha256 = hex.toUpperCase().match(/../g).join(':')
  if (sha256 === DEBUG_CERT_SHA256) fail('signed with the shared Expo debug certificate — never a release')
  const key = /Signer #1 key algorithm: (\S+)/.exec(signature.out)?.[1]
  const bits = /Signer #1 key size \(bits\): (\d+)/.exec(signature.out)?.[1]
  console.log(`key ${key ?? '—'} ${bits ?? '—'} bits`)
  step('alignment')
  if (!aligned(file)) fail('not aligned (zipalign -c -P 16 4); align before signing, never after')
  console.log('aligned: 4 bytes, native libraries on 16 KB pages')
  step('the certificate for assetlinks.json (request 5)')
  console.log(sha256)
  console.log(
    `\nrelease-android: ${file} is the release. Compare the SHA-256 above with the Owner's own record of the key before it goes anywhere.`,
  )
  process.exit(0)
}

if (process.env.RYNTRA_VARIANT) {
  fail(
    `RYNTRA_VARIANT=${process.env.RYNTRA_VARIANT} is set in this shell — that is the development build (io.ryntra.app.dev); a release is built without it`,
  )
}
if (unsigned && aab) fail('--unsigned builds an APK for apksigner; an app bundle is signed from the environment')
if (unsigned && process.env.RYNTRA_RELEASE_KEYSTORE) {
  fail('--unsigned builds without a key; RYNTRA_RELEASE_KEYSTORE is set in this shell — one of them')
}

/* ---- 1. verify ---- */
if (!skipVerify) {
  step('verify')
  run('npm', ['run', 'verify'])
}

/* ---- 2. the native project ---- */
step(`expo prebuild${clean ? ' --clean' : ''}`)
run('npx', ['expo', 'prebuild', '-p', 'android', '--no-install', ...(clean ? ['--clean'] : [])])

/* ---- 3. the release checks, on the project just generated ---- */
step('release checks')
run('node', [
  '--no-warnings=MODULE_TYPELESS_PACKAGE_JSON',
  'scripts/release-check.mjs',
  ...(unsigned ? [] : ['--require-key']),
])

/* ---- 4. gradle ---- */
const task = aab ? ':app:bundleRelease' : ':app:assembleRelease'
step(`gradle ${task}${unsigned ? ' (unsigned, for the Owner to sign)' : ''}`)
run(
  join(root, 'android', windows ? 'gradlew.bat' : 'gradlew'),
  [task, '--console=plain', ...(abi ? [`-PreactNativeArchitectures=${abi}`] : [])],
  {
    cwd: join(root, 'android'),
    env: unsigned ? { ...process.env, RYNTRA_RELEASE_UNSIGNED: '1' } : process.env,
  },
)

/* ---- 5. the artifact and its fingerprint ---- */
step('artifact')
const built = aab
  ? join(root, 'android/app/build/outputs/bundle/release/app-release.aab')
  : join(root, `android/app/build/outputs/apk/release/app-release${unsigned ? '-unsigned' : ''}.apk`)
if (!existsSync(built)) fail(`the build finished but ${built} is missing`)
let commit = 'nogit'
try {
  commit = execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
} catch {}
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })
const base = `ryntra-${app.version}-vc${app.android.versionCode}-${commit}`
const target = join(dist, `${base}${unsigned ? '-unsigned' : ''}.${aab ? 'aab' : 'apk'}`)
if (unsigned && zipalign && !aligned(built)) {
  // apksigner signs what it is given; the alignment has to be right before the signature.
  run(zipalign, ['-f', '-P', '16', '4', built, target])
} else {
  copyFileSync(built, target)
}
const size = statSync(target).size
console.log(
  `${target}\n${(size / 1024 / 1024).toFixed(1)} MB · version ${app.version} · versionCode ${app.android.versionCode} · ${commit}`,
)

if (unsigned) {
  const signed = join(dist, `${base}.apk`)
  step("the Owner's signature")
  console.log(
    [
      'The Owner signs it on this machine, in a PowerShell window of their own; apksigner asks for the',
      "keystore's password (and the key's, when it differs) at its own prompt, and nothing is shown or kept:",
      '',
      `  & "${apksigner}" sign --ks "PATH_TO_THE_OWNERS_KEYSTORE" --v4-signing-enabled false --out "${signed}" "${target}"`,
      '',
      '(--ks-key-alias <alias> is needed only when the keystore holds more than one key.) Then:',
      '',
      `  npm run release:android -- --verify="${signed}"`,
    ].join('\n'),
  )
  process.exit(0)
}

step('signing certificate')
if (!aab && apksigner) {
  // The certificate the APK is signed with — its SHA-256 goes into assetlinks.json; the key itself never leaves the Owner.
  run(apksigner, ['verify', '--print-certs', target])
} else {
  run(keytool, ['-printcert', '-jarfile', target])
}
console.log(
  "\nrelease-android: done. Compare the SHA-256 above with the Owner's own record of the key before it goes anywhere.",
)
