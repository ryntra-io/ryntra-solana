/**
 * The newest core archive on `origin/master` (`vendor/ryntra-core/*.tgz`, the archive line A ships to its own apps, or
 * `vendor/ryntra-core-next/*.tgz`, a newer one waiting for its apps) and the files inside it — read through git, so
 * the phone's sparse checkout, which has no `vendor/`, reads the same archive as a full one.
 */
import { execFileSync } from 'node:child_process'
import { gunzipSync } from 'node:zlib'

const ARCHIVE_DIRS = ['vendor/ryntra-core/', 'vendor/ryntra-core-next/']

const git = (...rest) => execFileSync('git', rest, { maxBuffer: 256 * 1024 * 1024 })

const versionOf = (path) =>
  path
    .match(/ryntra-core-(\d+)\.(\d+)\.(\d+)/)
    .slice(1)
    .map(Number)

/** The newest archive's path on `origin/master` and its unpacked tar. */
export function newestCoreArchive() {
  const archives = ARCHIVE_DIRS.flatMap((dir) =>
    git('ls-tree', '--full-tree', '--name-only', 'origin/master', dir).toString('utf8').split('\n'),
  )
    .filter((path) => /ryntra-core-\d+\.\d+\.\d+-[0-9a-f]+\.tgz$/.test(path))
    .sort((a, b) => {
      const [x, y] = [versionOf(a), versionOf(b)]
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.localeCompare(b)
    })
  const archive = archives.at(-1)
  if (!archive) throw new Error('no vendor/ryntra-core*/*.tgz on origin/master — run `git fetch origin` first')
  return {
    source: `origin/master:${archive}`,
    name: archive.split('/').at(-1),
    tar: gunzipSync(git('show', `origin/master:${archive}`)),
  }
}

/** Every regular file of a tar stream as [name, body] — ustar: a 512-byte header, the body padded to 512. */
export function* tarFiles(tar) {
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512)
    if (header.every((byte) => byte === 0)) return
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '')
    const prefix = field(345, 155)
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100)
    const size = parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    const body = at + 512
    if (type === '' || type === '0') yield [name, tar.subarray(body, body + size)]
    at = body + Math.ceil(size / 512) * 512
  }
}

/** The one entry of a tar stream, or null. */
export function tarEntry(tar, wanted) {
  for (const [name, body] of tarFiles(tar)) if (name === wanted) return body
  return null
}
