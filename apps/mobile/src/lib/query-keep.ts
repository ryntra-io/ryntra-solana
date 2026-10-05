import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'
import Constants from 'expo-constants'
import { createMMKV } from 'react-native-mmkv'

import PIN from './api/v1/PIN.json'
import { freshEnough, KEPT_MAX_AGE_MS, KEPT_QUERY_PREFIXES, keepsQuery } from './offline-model'

/**
 * The reads a person looks back at, kept on the device (`offline-model`), so
 * a start without a network opens on the last answers — each with the time
 * the server gave it — instead of an empty screen. Written a moment after the
 * cache changes. A new version of the app, a new pin of the API's
 * contract or a new shape of what is kept starts from nothing kept: an
 * answer's shape may have changed.
 */
const storage = createMMKV({ id: 'ryntra.cache' })
const KEY = 'queries'
/** Raised by hand whenever a kept answer's shape changes inside the app without a new contract pin. */
const KEPT_SHAPE = 1
const VERSION = `${KEPT_SHAPE}:${Constants.expoConfig?.version ?? '0'}:${PIN.contractVersion}:${PIN.commit}`
const WRITE_AFTER_MS = 1500
/** A market's own read is kept for the most recent ones only; a browsed list of markets does not fill the device. */
const MARKETS_KEPT = 30

type Kept = Readonly<{ version: string; state: DehydratedState }>

/** Brings the kept answers back into the cache — before the first screen, so it opens on them. */
export function restoreKeptQueries(client: QueryClient) {
  // A kept answer outlives its screens for as long as it may come back, so it is never let go while the person is away.
  for (const prefix of KEPT_QUERY_PREFIXES) client.setQueryDefaults(prefix, { gcTime: KEPT_MAX_AGE_MS })
  // A search under a kept prefix is never kept: it leaves memory as any other answer does.
  client.setQueryDefaults(['markets', 'search'], { gcTime: 5 * 60_000 })
  const raw = storage.getString(KEY)
  if (!raw) return
  try {
    const kept = JSON.parse(raw) as Kept
    if (kept.version !== VERSION) {
      storage.remove(KEY)
      return
    }
    const now = Date.now()
    hydrate(client, {
      mutations: [],
      queries: kept.state.queries.filter(
        (query) => keepsQuery(query.queryKey) && freshEnough(query.state.dataUpdatedAt, now),
      ),
    })
  } catch {
    storage.remove(KEY)
  }
}

function write(client: QueryClient) {
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) => query.state.data !== undefined && keepsQuery(query.queryKey),
  })
  const markets = state.queries
    .filter((query) => query.queryKey[0] === 'market')
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .slice(MARKETS_KEPT)
  const dropped = new Set(markets.map((query) => query.queryHash))
  // A refresh that failed keeps its last answer; what is kept is that answer, not the failure.
  const queries = state.queries
    .filter((query) => !dropped.has(query.queryHash))
    .map((query) => ({
      ...query,
      state: {
        ...query.state,
        status: 'success' as const,
        fetchStatus: 'idle' as const,
        error: null,
        fetchFailureCount: 0,
        fetchFailureReason: null,
      },
    }))
  storage.set(KEY, JSON.stringify({ version: VERSION, state: { mutations: [], queries } } satisfies Kept))
}

/** Keeps the cache's kept answers on the device as they change. Returns the way to stop. */
export function keepQueries(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    try {
      write(client)
    } catch {
      // A full or unreadable store leaves the last good copy; the screens run on the live cache either way.
    }
  }
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (!keepsQuery(event.query.queryKey)) return
    // A new answer, or one let go, is worth a write; a fetch starting or failing changes nothing kept.
    const changed = event.type === 'removed' || (event.type === 'updated' && event.action.type === 'success')
    if (!changed || timer) return
    timer = setTimeout(flush, WRITE_AFTER_MS)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
