/**
 * The professional chart's page (CH-21): the core's own chart (`RyntraChart` of `@ryntra/core/chart`, unforked) on the
 * candles the app puts in through the bridge (`src/features/pro-chart/bridge.ts`). It runs in the app's WebView from
 * the app's own bundle (`scripts/chart-page.mjs` builds it from the core's archive on `master`): it loads nothing from
 * the network — its page policy allows no connection at all — and it sends nothing but the bridge's three messages.
 *
 * The theme and the language are the app's: the first message carries them, and a change in the app's settings comes
 * as the same message again. The Ryntra mark in the corner is the core's own (CH-Р9): the chart draws it itself.
 *
 * No trading layer: the chart draws no order lines and drafts no order — the app's Buy and Sell under the chart open
 * its ticket and its Review, and the wallet signs there.
 */
import { Component, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import { RyntraChart } from '@ryntra/core/chart'

import {
  BRIDGE_VERSION,
  PAGE_RECEIVER,
  parseAppMessage,
  type AppMessage,
  type MarketMessage,
  type PageMessage,
} from '../src/features/pro-chart/bridge.ts'
import { ProChartFeed, resolutionOf, timeframeOf } from './feed.ts'

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void }
    [PAGE_RECEIVER]?: (raw: unknown) => void
  }
}

function say(message: PageMessage): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message))
}

let failed = false
function fail(): void {
  if (failed) return
  failed = true
  say({ v: BRIDGE_VERSION, type: 'failed' })
}

/** What the app said before React listened: the newest market, then every read and price in order. */
const early: AppMessage[] = []
let deliver: ((message: AppMessage) => void) | null = null
window[PAGE_RECEIVER] = (raw) => {
  const message = parseAppMessage(raw)
  if (!message) return
  if (message.type === 'market') {
    // The look first, before React draws: the page never flashes the other theme.
    document.documentElement.dataset.theme = message.theme
    document.documentElement.lang = message.lang
  }
  if (deliver) deliver(message)
  else early.push(message)
}

class Guard extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false }
  static getDerivedStateFromError() {
    return { broken: true }
  }
  componentDidCatch() {
    fail()
  }
  render() {
    return this.state.broken ? null : this.props.children
  }
}

type Held = Readonly<{ market: MarketMessage; feed: ProChartFeed }>

function Page() {
  const [held, setHeld] = useState<Held | null>(null)
  /* The chart loads an interval again when the feed says so: candles came for one it could not draw (a read after its
     wait ran out, or after an empty one), or the newest bar on screen left the data (a withdrawn live price) — never a
     stale «no candles», nor a price the app no longer stands behind. */
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let current: Held | null = null
    const take = (message: AppMessage) => {
      if (message.type === 'market') {
        if (!current || current.market.mint !== message.mint) {
          current?.feed.dispose()
          current = { market: message, feed: new ProChartFeed(message) }
        } else {
          current.feed.describe({ symbol: message.symbol, stock: message.stock })
          current = { market: message, feed: current.feed }
        }
        setHeld(current)
        return
      }
      if (!current) return
      if (message.type === 'candles') {
        const reload = current.feed.put(
          message.timeframe,
          message.candles,
          message.observedAt,
          message.stale,
          message.pool,
          message.source,
        )
        if (reload) setRevision((count) => count + 1)
      } else if (current.feed.live(message.price, message.at)) setRevision((count) => count + 1)
    }
    deliver = take
    for (const message of early.splice(0)) take(message)
    say({ v: BRIDGE_VERSION, type: 'ready' })
    return () => {
      deliver = null
      current?.feed.dispose()
    }
  }, [])

  if (!held) return null
  const { market, feed } = held
  return (
    <Guard>
      <RyntraChart
        key={`${market.mint}:${revision}`}
        className="pro-chart"
        source={feed.source}
        instrument={market.mint}
        resolution={resolutionOf(market.timeframe)}
        onResolutionChange={(next) => {
          const timeframe = timeframeOf(next)
          if (timeframe) say({ v: BRIDGE_VERSION, type: 'timeframe', timeframe })
        }}
        lang={market.lang}
        label={market.symbol}
        drawings={{ profile: null }}
      />
    </Guard>
  )
}

/* A script that never starts says nothing at all: the app waits for «ready» and, without it, says the chart did not
   open. A stray error of the page (a resize loop's notice) is not a failure of the chart. */
const root = document.getElementById('root')
if (root) createRoot(root).render(<Page />)
else fail()
