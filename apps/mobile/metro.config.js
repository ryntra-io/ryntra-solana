const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')
const path = require('path')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// Uniwind compiles src/global.css (which imports the generated token layer) into styles.
const uniwindConfig = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
})

// Cache transforms per project; the machine-wide Metro cache can serve stale transforms from other projects.
// The stylesheet is the one transform never kept: Uniwind compiles it from every source file and marks it
// `skipCache` (its own store refuses it the same way), so a class added in any file reaches the stylesheet.
// A plain store kept it by the CSS file's content — a new class never arrived until the cache was cleared.
uniwindConfig.cacheStores = ({ FileStore }) => {
  const uncached = (value) => Boolean(value?.output?.[0]?.data?.css?.skipCache)
  class ProjectStore extends FileStore {
    async get(key) {
      const value = await super.get(key)
      return uncached(value) ? null : value
    }
    async set(key, value) {
      if (uncached(value)) return
      return super.set(key, value)
    }
  }
  // A task tree whose node_modules is a junction to the line's own keeps a cache of its own (`RYNTRA_METRO_CACHE`):
  // a shared one serves one tree's routes to another's bundle.
  const root = process.env.RYNTRA_METRO_CACHE
    ? path.resolve(process.env.RYNTRA_METRO_CACHE)
    : path.join(__dirname, 'node_modules', '.cache', 'metro')
  return [new ProjectStore({ root })]
}

module.exports = uniwindConfig
