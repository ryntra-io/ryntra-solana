/** What a list's read says about itself — the part of a query a screen needs to read it again quietly. */
export type QuietRead = Readonly<{
  data?: unknown
  /** When the answer on screen arrived (ms); 0 before the first. */
  dataUpdatedAt: number
  isFetching: boolean
  refetch: () => Promise<unknown>
}>

/** An answer younger than this is not asked again when its screen opens — the lists' own fresh time (`staleTime`). */
export const OPEN_FRESH_MS = 30_000

/**
 * The reads to ask again when their screen opens (a tab come back to, the app brought back): only a list already on
 * screen whose answer is older than `freshMs` and not being asked already. The age is counted from the answer's own
 * time, not from the query's `isStale`, which is not brought up to date while the app sleeps in the background. A list
 * never read is the screen's own first read, not this one's; the prices on screen stand while it answers (ST-7).
 */
export function readsToRefresh<T extends QuietRead>(reads: readonly T[], now: number, freshMs = OPEN_FRESH_MS): T[] {
  return reads.filter(
    (read) =>
      read.data !== undefined && !read.isFetching && read.dataUpdatedAt > 0 && now - read.dataUpdatedAt >= freshMs,
  )
}
