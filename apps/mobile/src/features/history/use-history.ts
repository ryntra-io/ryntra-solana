import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useHoldings } from '@/features/portfolio/use-portfolio'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { useWatchlistMarkets } from '@/hooks/use-markets'
import { fetchActivity, type Session } from '@/lib/api'
import { useLocale } from '@/lib/i18n'

import {
  BUILT_IN_MINTS,
  historyRows,
  unresolvedMints,
  type HistoryRow,
  type KnownMints,
  type MintFacts,
} from './history-model'

/**
 * The wallet's operations from the server's ledger — public by address, the
 * wallet's reward rows added over its bearer. Kept under the private key so
 * a sign-out, a switch and a disconnect drop it with the rest.
 */
export function useActivity(address: string | null, session: Session | null) {
  return useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'activity', address ?? '', session ? 'proven' : 'public'],
    queryFn: ({ signal }) => fetchActivity(address!, session, signal),
    enabled: address !== null,
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  })
}

/**
 * The statement: the ledger's rows with the legs the record left without
 * decimals or a name resolved from the holdings already read and, for
 * anything else, one batched market read — never a guessed scale.
 */
export function useHistory(address: string | null, session: Session | null) {
  const locale = useLocale()
  const activity = useActivity(address, session)
  const holdings = useHoldings(address)
  const actions = useMemo(() => activity.data?.data.actions ?? [], [activity.data])

  const fromHoldings = useMemo((): KnownMints => {
    const known = new Map<string, MintFacts>(BUILT_IN_MINTS)
    for (const holding of holdings.data?.data.holdings ?? []) {
      if (!holding.mint) continue
      known.set(holding.mint, { decimals: holding.decimals, symbol: holding.catalog?.symbol ?? holding.symbol ?? null })
    }
    return known
  }, [holdings.data])

  const missing = useMemo(() => unresolvedMints(actions, fromHoldings), [actions, fromHoldings])
  const markets = useWatchlistMarkets(missing)

  const known = useMemo((): KnownMints => {
    const merged = new Map<string, MintFacts>(fromHoldings)
    for (const row of markets.data?.rows ?? [])
      merged.set(row.mint, { decimals: row.decimals, symbol: row.symbol || null })
    return merged
  }, [fromHoldings, markets.data])

  const rows = useMemo((): HistoryRow[] => historyRows(actions, locale, known), [actions, locale, known])
  return {
    activity,
    rows,
    /** False when a row existed and could not be read: the list may be incomplete. */
    complete: activity.data?.data.complete ?? true,
    /** The wallet's reward rows travel with a proven read only. */
    proven: activity.data?.data.rewards !== null && activity.data?.data.rewards !== undefined,
  }
}
