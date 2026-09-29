import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createMMKV } from 'react-native-mmkv'

import { useMarkets } from '@/hooks/use-markets'
import { fetchMarketsByMints, fetchStockUniverseFull } from '@/lib/api'

import type { IssuerEvent } from './conversion-watch'
import {
  coinShelf,
  companyShelf,
  DOLLAR_MINTS,
  parseShelf,
  serializeShelf,
  shelfCardFor,
  type CompanyShelf,
} from './shelf'

/**
 * The companies' shelf as the phone reads it: the live universe folded into
 * cards on arrival (only the cards are kept, not the universe), shared by Home
 * and Markets under one key, read again every two minutes while either is
 * open. The route builds the universe in about twenty seconds when its cache
 * is cold, so the device keeps the last shelf it read and shows it at once —
 * with its own time, never as fresh — until the new one answers (canon §2,
 * rule 14: a copy and a skeleton, not an empty screen).
 */
const storage = createMMKV({ id: 'ryntra.shelf' })
const KEPT = 'companies'

export const SHELF_QUERY_KEY = ['stocks', 'shelf'] as const

async function readShelf({ signal }: { signal: AbortSignal }): Promise<CompanyShelf> {
  return companyShelf(await fetchStockUniverseFull(signal))
}

function readKept(): CompanyShelf | null {
  return parseShelf(storage.getString(KEPT))
}

export function useCompanyShelf() {
  const query = useQuery({
    queryKey: SHELF_QUERY_KEY,
    queryFn: readShelf,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  })
  // The device's last shelf, read once: what the screen shows while the first live read is on its way.
  const [kept] = useState(readKept)
  useEffect(() => {
    if (query.data) storage.set(KEPT, serializeShelf(query.data))
  }, [query.data])
  const shelf = query.data ?? kept
  return {
    query,
    shelf,
    /** The shelf on screen is the device's copy of an earlier read, not this session's. */
    fromDevice: query.data === undefined && kept !== null,
  }
}

/**
 * The issuer's event on a token — its swap window before a cut-off — where the shelf names it: this session's read,
 * else the device's last one. A company's page says it before the issuer's own read of the token answers, so a
 * private token's deadline stands before its price from the first frame (M27). Asks nothing of its own.
 */
export function useShelfEvents(): Readonly<{
  eventOf: (mint: string) => IssuerEvent | null
  /** A shelf was read — this session or before — so a token it names no event for has none. */
  known: boolean
}> {
  const { data } = useQuery({ queryKey: SHELF_QUERY_KEY, queryFn: readShelf, enabled: false })
  const [kept] = useState(readKept)
  const shelf = data ?? kept
  const eventOf = useCallback((mint: string) => shelf?.events.find((event) => event.mint === mint) ?? null, [shelf])
  return { eventOf, known: shelf !== null && shelf !== undefined }
}

/**
 * The company a token stands for, where the shelf this session read names it
 * — the words of a door on another screen. Asks nothing of its own: a shelf
 * not read yet leaves the caller its own words.
 */
export function useShelfNames(): (mint: string) => string | null {
  const { data } = useQuery({ queryKey: SHELF_QUERY_KEY, queryFn: readShelf, enabled: false })
  return useCallback((mint: string) => shelfCardFor(data, mint)?.name ?? null, [data])
}

/**
 * The dollars and the crypto of Markets on the beginner's path: the venue's
 * crypto list (the same read the Crypto list of «Для досвідчених» makes) and the two dollar tokens by
 * their addresses, since a ranked list is not where a stable coin is looked for.
 */
export function useCoinShelf() {
  const crypto = useMarkets('crypto')
  const dollars = useQuery({
    queryKey: ['markets', 'mints', DOLLAR_MINTS.join(',')],
    queryFn: ({ signal }) => fetchMarketsByMints(DOLLAR_MINTS, signal),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  })
  const shelf = useMemo(() => {
    const rows = [...(crypto.data?.rows ?? []), ...(dollars.data?.rows ?? [])]
    return rows.length > 0 ? coinShelf(rows) : null
  }, [crypto.data, dollars.data])
  const observed = [crypto.data?.observedAt, dollars.data?.observedAt].filter(
    (at): at is string => typeof at === 'string' && Number.isFinite(Date.parse(at)),
  )
  return {
    crypto,
    dollars,
    shelf,
    /** The older of the two reads — the time every coin on screen is at least as fresh as. */
    observedAt: observed.length > 0 ? observed.sort()[0]! : null,
    stale: Boolean(crypto.data?.stale || dollars.data?.stale),
    pending: crypto.isPending && dollars.isPending,
    failed: crypto.isError && dollars.isError && shelf === null,
    refetch: () => Promise.all([crypto.refetch(), dollars.refetch()]),
  }
}
