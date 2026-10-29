/**
 * The asset page's own «Купити» and «Продати», offered to the pro chart opened over it (CH-21). The page decides — a
 * retired issuer's token, a halted stock or one not offered has no purchase; «Продати» only with a position — and runs
 * its own flow: the ticket for a coin, the company's sheet for a stock, each with its Review. The pro chart shows a
 * button only where the page offers it, with the page's own warning over «Купити», and pressing it goes back to the
 * page and runs the page's own action.
 *
 * Every open page of an asset offers for itself, by its route's key: the same asset open twice in the stack keeps both
 * offers, and the pro chart takes the one of the page right under it — never a page further down.
 */
import { useSyncExternalStore } from 'react'

export type AssetAction = 'buy' | 'sell'

export type AssetActions = Readonly<{
  buy: boolean
  sell: boolean
  /** The line the page says over its own «Купити» (a look-alike, a pool far from the share); null when none. */
  warning: string | null
  run: (action: AssetAction) => void
}>

/** Offers by the asset page's route key. */
const offered = new Map<string, AssetActions>()
const listeners = new Set<() => void>()
const tell = () => {
  for (const listener of listeners) listener()
}

/** The asset page (by its route key) offers its actions while it is mounted; the returned function takes them back. */
export function offerAssetActions(routeKey: string, actions: AssetActions): () => void {
  offered.set(routeKey, actions)
  tell()
  return () => {
    if (offered.get(routeKey) !== actions) return
    offered.delete(routeKey)
    tell()
  }
}

/** What the page with this route key offers now; null when no such page is open, or it offers nothing yet. */
export function assetActionsOf(routeKey: string | null): AssetActions | null {
  return routeKey === null ? null : (offered.get(routeKey) ?? null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The actions the page with this route key offers, live. */
export function useAssetActions(routeKey: string | null): AssetActions | null {
  return useSyncExternalStore(
    subscribe,
    () => assetActionsOf(routeKey),
    () => assetActionsOf(routeKey),
  )
}

/** The route right under the chart's own route (`own`, its key), when it is this asset's page: its key; else null. */
export function assetPageBeneath(
  state: Readonly<{ routes: readonly Readonly<{ key: string; name: string; params?: object }>[] }>,
  own: string,
  mint: string,
): string | null {
  const at = state.routes.findIndex((route) => route.key === own)
  const below = at > 0 ? state.routes[at - 1] : undefined
  if (!below || below.name !== 'asset/[mint]') return null
  const params = (below.params ?? {}) as { mint?: unknown }
  return params.mint === mint ? below.key : null
}
