#!/usr/bin/env node
/**
 * Builds the professional chart's page (CH-21) — `chart-page/main.tsx`, the core's `RyntraChart` on the app's reads —
 * into one HTML file the app's WebView opens: `chart-page/page.generated.ts`.
 *
 * The core comes from the newest archive on `origin/master` (`scripts/core-archive.mjs`, the same one
 * `sync-tokens.mjs` reads), unpacked into `node_modules/.cache/ryntra-core/current`; its engine, KLineChart, at the
 * exact version the core names (`klinecharts` in this app's devDependencies). The page is typechecked against the
 * core's own declarations, bundled with esbuild, and written with the core's styles in their order (`tokens.css`,
 * `base.css`, `ui.css`, `chart.css`), Geist and Geist Mono, and a page policy that allows no connection.
 *
 * `--check` exits non-zero when the generated file is not what this build gives (the line naming the archive aside).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

import { newestCoreArchive, tarFiles } from './core-archive.mjs'

const app = fileURLToPath(new URL('..', import.meta.url))
const cache = join(app, 'node_modules', '.cache', 'ryntra-core', 'current')
const target = join(app, 'chart-page', 'page.generated.ts')
const check = process.argv.includes('--check')
const require = createRequire(import.meta.url)

/** The archive's `package/` into the cache, once per archive. */
function unpack({ name, tar }) {
  const marker = join(cache, 'ARCHIVE')
  if (existsSync(marker) && readFileSync(marker, 'utf8') === name) return
  rmSync(cache, { recursive: true, force: true })
  for (const [entry, body] of tarFiles(tar)) {
    const path = normalize(join(cache, entry))
    if (!entry.startsWith('package/') || !path.startsWith(cache + sep))
      throw new Error(`${name}: an entry outside package/ — ${entry}`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  writeFileSync(marker, name)
}

/** The engine must be the version the core was built and tested with. */
function engineMatches() {
  const core = JSON.parse(readFileSync(join(cache, 'package', 'package.json'), 'utf8'))
  const wanted = core.dependencies?.klinecharts
  const have = JSON.parse(readFileSync(require.resolve('klinecharts/package.json'), 'utf8')).version
  if (wanted !== have)
    throw new Error(`the core wants klinecharts ${wanted}; this app has ${have} — set it in devDependencies`)
  return core.version
}

const font = (path, family, weight) =>
  `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/ttf;base64,${readFileSync(require.resolve(path)).toString('base64')}) format("truetype")}`

/** No connection, no frame, no form: the page draws what the app puts in, and nothing else runs. */
const POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'worker-src blob:',
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/* The page: the chart fills the WebView; the app draws its own head and its buttons around it. */
const PAGE_CSS = `html,body,#root{height:100%;margin:0}body{background:var(--ryntra-bg,#0b0f14);overflow:hidden;overscroll-behavior:none;-webkit-tap-highlight-color:transparent}#root>.pro-chart{height:100%}`

/**
 * The feed against the core's own contract suite (`@ryntra/core/adapters/testing`), as the engine loads it: every
 * interval in pages, each page, bar and state checked, and the live stream after a live price. A feed that breaks the
 * contract builds no page.
 */
async function conforms() {
  const testing = await import(pathToFileURL(join(cache, 'package', 'dist', 'adapters', 'testing', 'index.js')).href)
  const { CHART_CONTRACT } = await import(
    pathToFileURL(join(cache, 'package', 'dist', 'adapters', 'contracts', 'index.js')).href
  )
  const { ProChartFeed, PRICE_BASIS, resolutionOf } = await import(
    pathToFileURL(join(app, 'chart-page', 'feed.ts')).href
  )
  const { PRO_TIMEFRAMES } = await import(pathToFileURL(join(app, 'src', 'features', 'pro-chart', 'bridge.ts')).href)
  const mint = 'So11111111111111111111111111111111111111112'
  const now = Date.UTC(2026, 9, 13, 12, 0, 0)
  const seconds = { '1m': 60, '5m': 300, '15m': 900, '1h': 3_600, '4h': 14_400, '1d': 86_400 }
  const clock = { now }
  const feed = new ProChartFeed({ mint, symbol: 'SOL', stock: false }, () => clock.now)
  for (const timeframe of PRO_TIMEFRAMES) {
    const size = seconds[timeframe]
    const end = Math.floor(now / 1000 / size) * size
    const candles = Array.from({ length: 120 }, (_, index) => {
      const open = 100 + Math.sin(index) * 3
      const close = 100 + Math.sin(index + 1) * 3
      return {
        time: end - (120 - index) * size,
        open,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
        close,
        volume: 1_000 + index,
      }
    })
    feed.put(timeframe, candles, now - 5_000, false, 'SOL / USDC', 'GeckoTerminal')
  }
  const problems = []
  if (!testing.compatibleContract(CHART_CONTRACT, feed.source.contract))
    problems.push(`the feed speaks ${feed.source.contract}; the core reads ${CHART_CONTRACT}`)
  const instrument = await feed.source.instrument(mint)
  problems.push(...testing.checkInstrument(instrument))
  const harness = { source: feed.source, instrument: mint, audience: 'customer', replay: null, truth: null }
  for (const timeframe of PRO_TIMEFRAMES) {
    const { bars, pages } = await testing.loadLikeEngine(
      harness,
      instrument,
      resolutionOf(timeframe),
      PRICE_BASIS,
      problems,
      50,
    )
    if (bars.length !== 120) problems.push(`${timeframe}: ${bars.length} of 120 bars across pages`)
    problems.push(...testing.checkStatus(pages[0].status, 'customer', timeframe))
  }
  const events = []
  const newest = (
    await feed.source.history({
      instrument: mint,
      resolution: resolutionOf('1m'),
      basis: PRICE_BASIS,
      load: 'init',
      timestamp: null,
      limit: 500,
    })
  ).bars.at(-1).t
  const stop = feed.source.subscribe(
    { instrument: mint, resolution: resolutionOf('1m'), basis: PRICE_BASIS },
    (event) => events.push(event),
  )
  clock.now = now + 10_000
  feed.live(101, clock.now)
  stop()
  feed.dispose()
  if (events.length === 0) problems.push('the live price sent no bar')
  problems.push(...testing.checkLive(instrument, events, newest, 'customer'))
  if (problems.length) throw new Error(`the feed breaks the chart contract:\n${problems.join('\n')}`)
}

const core = (path) => join(cache, 'package', path)

async function render() {
  const archive = newestCoreArchive()
  unpack(archive)
  const version = engineMatches()
  await conforms()
  const { CHART_NOTICES } = await import(pathToFileURL(core('dist/chart/licenses.js')).href)
  const notices = CHART_NOTICES.map(({ name, version, license, notice, licenseText }) => ({
    name,
    version,
    license,
    notice,
    licenseText,
  }))
  execFileSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', join(app, 'chart-page', 'tsconfig.json')],
    {
      stdio: 'inherit',
    },
  )
  const bundle = await build({
    entryPoints: [join(app, 'chart-page', 'main.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    minify: true,
    jsx: 'automatic',
    legalComments: 'eof',
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"' },
    alias: {
      '@ryntra/core/chart': core('dist/chart/index.js'),
      '@ryntra/core/adapters': core('dist/adapters/contracts/index.js'),
    },
    nodePaths: [join(app, 'node_modules')],
    logLevel: 'warning',
  })
  const script = bundle.outputFiles[0].text
  if (/<\/script/i.test(script)) throw new Error('the bundle holds «</script» — it cannot be inlined')
  const styles = ['tokens/tokens.css', 'tokens/base.css', 'ui/ui.css', 'chart/chart.css'].map((path) =>
    readFileSync(core(path), 'utf8'),
  )
  for (const css of styles) if (/<\/style/i.test(css)) throw new Error('a stylesheet holds «</style»')
  const fonts = [
    font('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf', 'Geist', 400),
    font('@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf', 'Geist', 500),
    font('@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf', 'Geist', 600),
    font('@expo-google-fonts/geist-mono/400Regular/GeistMono_400Regular.ttf', 'Geist Mono', 400),
  ].join('')
  const html = [
    '<!doctype html>',
    '<html lang="uk" data-theme="graphite">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    '<title>Ryntra</title>',
    `<style>${fonts}</style>`,
    ...styles.map((css) => `<style>${css}</style>`),
    `<style>${PAGE_CSS}</style>`,
    '</head>',
    '<body>',
    '<div id="root"></div>',
    `<script>${script}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
  return {
    source: archive.source,
    text: [
      '/* eslint-disable */',
      '/**',
      ' * GENERATED by scripts/chart-page.mjs from chart-page/ and the core archive — never edit by hand.',
      ` * Source: ${archive.source}`,
      ' */',
      `export const CHART_PAGE_CORE = ${JSON.stringify(version)}`,
      "/** The chart's third-party notices as the core ships them (`CHART_NOTICES`): shown word for word in the app. */",
      `export const CHART_PAGE_NOTICES: readonly Readonly<{ name: string; version: string; license: string; notice: string; licenseText: string }>[] = ${JSON.stringify(notices)}`,
      `export const CHART_PAGE_HTML: string = ${JSON.stringify(html)}`,
      '',
    ].join('\n'),
    bytes: Buffer.byteLength(html),
  }
}

const { source, text, bytes } = await render()
const body = (value) =>
  value
    .split('\n')
    .filter((line) => !line.startsWith(' * Source:'))
    .join('\n')
if (check) {
  const have = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : ''
  if (body(have) !== body(text)) {
    console.error(`chart-page/page.generated.ts differs from ${source} — run \`npm run chart:page\`.`)
    process.exit(1)
  }
  console.log(`the chart page matches ${source} (${Math.round(bytes / 1024)} KB)`)
} else {
  writeFileSync(target, text)
  console.log(`wrote chart-page/page.generated.ts from ${source} (${Math.round(bytes / 1024)} KB)`)
}
