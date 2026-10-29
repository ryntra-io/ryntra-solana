import { useQuery } from '@tanstack/react-query'

import { useCapabilities } from '@/features/plans/use-plans'
import { PRIVATE_QUERY_KEY } from '@/features/session/use-account'
import { ApiError, readSeekerCheck, readSkrNameOf, type Session } from '@/lib/api'

import { addressNameOf, isAddress, seekerMarkOf, UNREAD, type SeekerMark } from './seeker-model'

/** The server keeps a found mark an hour and a «none» five minutes; the phone asks no more often than that. */
const FOUND_FRESH_MS = 60 * 60_000
const NONE_FRESH_MS = 5 * 60_000
/** An address's name is a label: kept for ten minutes of the app's life, as on the web — never on the device. */
const NAME_FRESH_MS = 10 * 60_000

/** A chain that did not answer (503), a network that did not, too many asks: asked again. A route not served yet (404) waits. */
function unread(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 503 || error.status === 429
}

/**
 * Whether the server serves `.skr` names (`capabilities.research.skrName`, contract 1.65.0): `yes`, `no` — none is
 * asked — or `unread` while the capabilities are read or could not be, which is never taken for «no».
 */
export function useNames(): Readonly<{ served: 'yes' | 'no' | 'unread'; retryable: boolean; retry: () => void }> {
  const capabilities = useCapabilities()
  const served = capabilities.data
    ? capabilities.data.research?.skrName !== undefined
      ? 'yes'
      : 'no'
    : 'unread'
  // Unread and failed (not merely still reading): said as unchecked, with its retry.
  const retryable = served === 'unread' && capabilities.isError && !capabilities.isFetching
  return { served, retryable, retry: () => void capabilities.refetch() }
}

/** Names are shown only where the server serves them. */
export function useNamesServed(): boolean {
  return useNames().served === 'yes'
}

/**
 * «Перевірено Seeker» for the signed-in wallet (contract 1.66.0): asked after the sign-in with the session's bearer,
 * never with an address of the phone's own. A 503 keeps what was shown and asks again; it never reads as «no Seeker».
 * Under the private prefix, so a sign-out drops it with every other private answer.
 */
export function useSeekerMark(session: Session | null): SeekerMark {
  const address = session?.address ?? null
  const query = useQuery({
    queryKey: [PRIVATE_QUERY_KEY, 'seeker', address ?? ''],
    queryFn: ({ signal }) => readSeekerCheck(session!, signal),
    enabled: session !== null,
    staleTime: (q) => (q.state.data?.verified ? FOUND_FRESH_MS : NONE_FRESH_MS),
    retry: (count, error) => count < 2 && unread(error),
    retryDelay: 30_000,
  })
  return seekerMarkOf(address, query.data)
}

/**
 * The `.skr` name to show for an address (contract 1.65.0), or `null` while it is read, when it has none and when it
 * could not be read — the address stands where the name would, so nothing waits for it. Only the primary name, the one
 * that wallet chose; with `own` — the session of exactly that wallet — the first name it holds when it chose none.
 * A failed read is not kept: the next screen that shows the address asks again, and a name already shown stays.
 */
export function useSkrName(address: string | null | undefined, own: Session | null = null): string | null {
  const served = useNamesServed()
  const valid = served && isAddress(address)
  const self = valid && own !== null && own.address === address
  const query = useQuery({
    queryKey: self ? [PRIVATE_QUERY_KEY, 'skr-name', address] : ['skr-name', valid ? address : ''],
    queryFn: async ({ signal }) => {
      const name = addressNameOf(address as string, await readSkrNameOf(address as string, self ? own : null, signal))
      if (name === UNREAD) throw new Error('unread')
      return name
    },
    enabled: valid,
    staleTime: NAME_FRESH_MS,
    gcTime: NAME_FRESH_MS,
    retry: (count, error) => count < 1 && unread(error),
  })
  return valid ? (query.data ?? null) : null
}
