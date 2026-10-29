/**
 * Home's blocks under its head — which are on and in what order, the
 * person's own, kept on the device. The head (what the wallet holds and the
 * one action) and a signature waiting for its answer stay where they are;
 * only the blocks below them are arranged. One Home for everyone: a block a
 * person cannot see yet (the wallet's launches before a wallet) keeps its place
 * and its switch for when they can.
 */

export type HomeBlockId = 'favourites' | 'myMarkets' | 'recent'

/**
 * Every block, in the order a new Home draws them — the prototype's Обране · Мої ринки · Останнє. C2's recurring buys live in «Боти» and the popular companies in «Що купити»: a layout
 * stored with them drops them and keeps the rest of its choices.
 */
export const HOME_BLOCKS: readonly HomeBlockId[] = ['favourites', 'myMarkets', 'recent']

/** The blocks that read a wallet: its launches, its operations. */
const WALLET_BLOCKS: ReadonlySet<HomeBlockId> = new Set(['myMarkets', 'recent'])

export type HomeBlock = Readonly<{ id: HomeBlockId; on: boolean }>
export type HomeLayout = readonly HomeBlock[]

export const DEFAULT_LAYOUT: HomeLayout = HOME_BLOCKS.map((id) => ({ id, on: true }))

const OFF = '!'

function isBlockId(value: string): value is HomeBlockId {
  return (HOME_BLOCKS as readonly string[]).includes(value)
}

/** `recent,!myMarkets,favourites` — the order, a block switched off marked `!`. */
export function serializeLayout(layout: HomeLayout): string {
  return layout.map((block) => `${block.on ? '' : OFF}${block.id}`).join(',')
}

/**
 * A stored layout, read leniently: a name this version does not know is
 * dropped, a repeat counts once, and a block the stored layout never named (a
 * new one) joins on, after the blocks that precede it in the default order.
 */
export function parseLayout(raw: string | null | undefined): HomeLayout {
  if (!raw) return DEFAULT_LAYOUT
  const seen = new Set<HomeBlockId>()
  const read: HomeBlock[] = []
  for (const part of raw.split(',')) {
    const token = part.trim()
    const on = !token.startsWith(OFF)
    const id = on ? token : token.slice(OFF.length)
    if (!isBlockId(id) || seen.has(id)) continue
    seen.add(id)
    read.push({ id, on })
  }
  HOME_BLOCKS.forEach((id, index) => {
    if (seen.has(id)) return
    const before = new Set(HOME_BLOCKS.slice(0, index))
    let at = 0
    read.forEach((block, position) => {
      if (before.has(block.id)) at = position + 1
    })
    read.splice(at, 0, { id, on: true })
    seen.add(id)
  })
  return read
}

/** The blocks a person can see now: a wallet's own need a wallet; the favourites are everyone's. */
export function availableBlocks(wallet: boolean): ReadonlySet<HomeBlockId> {
  return new Set(HOME_BLOCKS.filter((id) => wallet || !WALLET_BLOCKS.has(id)))
}

/** Whether the blocks the person can see stand as a new Home draws them — a hidden block's place is not theirs to see. */
export function isDefaultLayout(
  layout: HomeLayout,
  available: ReadonlySet<HomeBlockId> = new Set(HOME_BLOCKS),
): boolean {
  return serializeLayout(arrangeable(layout, available)) === serializeLayout(arrangeable(DEFAULT_LAYOUT, available))
}

export function toggleBlock(layout: HomeLayout, id: HomeBlockId, on: boolean): HomeLayout {
  return layout.map((block) => (block.id === id ? { id, on } : block))
}

/** The blocks the person can see now, in their order — on or off (the arranging sheet's rows). */
export function arrangeable(layout: HomeLayout, available: ReadonlySet<HomeBlockId>): HomeLayout {
  return layout.filter((block) => available.has(block.id))
}

/** What Home draws under its head: the blocks the person can see now and has on, in their order. */
export function shownBlocks(layout: HomeLayout, available: ReadonlySet<HomeBlockId>): readonly HomeBlockId[] {
  return arrangeable(layout, available)
    .filter((block) => block.on)
    .map((block) => block.id)
}

/**
 * One step up (-1) or down (+1) among the blocks the person can see: the
 * block trades places with its visible neighbour; one hidden between them
 * keeps its own place. At either end nothing moves.
 */
export function moveBlock(
  layout: HomeLayout,
  id: HomeBlockId,
  step: -1 | 1,
  available: ReadonlySet<HomeBlockId> = new Set(HOME_BLOCKS),
): HomeLayout {
  const visible = arrangeable(layout, available).map((block) => block.id)
  const from = visible.indexOf(id)
  const neighbour = visible[from + step]
  if (from < 0 || neighbour === undefined) return layout
  const a = layout.findIndex((block) => block.id === id)
  const b = layout.findIndex((block) => block.id === neighbour)
  const next = [...layout]
  next[a] = layout[b]
  next[b] = layout[a]
  return next
}
