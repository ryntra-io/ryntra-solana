# The city's windows (CITY-65)

One frame for every window over the city — the swap and the spot (CITY-62), the chart (CITY-5a), the futures (CITY-5d),
the money (CITY-63). The frame brings the head with «Full screen», «Pop out» and «Close», the dragging, the sticking and
the stretching; a window brings only what is inside it. Macets: `docs/city/design/2026-10-28/M2-workspace-snapped.webp`
(stuck together) and `M3-swap-fullscreen.webp` (the whole screen).

## Plugging a window in

```tsx
import { closeWindow, openWindow } from '@/city/lib/window/store';

openWindow({ id: 'swap', title: 'Swap', icon: <SwapGlyph />, render: () => <SwapPanel />, min: { width: 360, height: 420 } });
closeWindow('swap');
```

| Field | What |
| --- | --- |
| `id` | One per window. Opening it again brings the open one to the front with the new title and contents. |
| `title` | English words in the head: «Swap», «Chart · BONK/USDC». |
| `icon` | A 24 px glyph (`stroke="currentColor"`), drawn in the frame's orange. |
| `render` | What is inside. Called when the window opens or its `render` changes, never while the frame moves. |
| `min` | The least the window shrinks to by hand; 280 × 180 when not given. |
| `size` | Its size the first time it opens on this device; 560 × 440 when not given. |
| `held` | While true, «Close» in the frame waits (a signature in the wallet, a transaction on its way). Open again with `held: false` to let go. |
| `onClose` | Called after the person closes the window from its frame. Not called on `closeWindow`. |
| `detach` | The window can go onto another screen (CITY-75): what its own page needs to show the same thing — `{ tower }` for the chart, `{ symbol }` for the Exchange. Without it the frame has no «Open in a new window». A layout of the person's keeps it too (CITY-84), so the window opens on the same thing again. |
| `figure` | Its chip in the tray while folded (CITY-84): `(title, params) => <OwnFigure />`, a small component of the window's own reading its own store — a price, a balance. Without it the frame's own figures (`figures.tsx`: the chart, the trade card, the Exchange, Money) or the title. |

A window whose own store says whether it is open plugs in with one hook instead —
`useCityWindow(shown, spec)` (`city/components/window/useCityWindow.ts`): the frame opens it while `shown` and closes it
when not, and a new `spec` (memoised by the caller: a title, contents or `held` that changed) reaches the open window
where it stands, never bringing it to the front (`updateWindow`). In the frame now: the chart (`ChartLayer`), the
Exchange (`ExchangeLayer`, held while a signature is out), Money (`MoneyLayer`, held while money is mid-way) and, since
30.10, Swap and Spot (`TradeLayer`, two windows — `swap` narrow, `spot` wide with the chart beside the ticket — held while
a trade is mid-way). Since 31.10, «Мій причал» (`BerthLayer`, CITY-141 — two columns from 700 px wide, held while a claim
is mid-way). Still on its own: the Oracle's sheet.

Escape: the whole screen is given back first — the frame hears Escape before anything else and marks it
(`preventDefault`); a window's own Escape, the chart's and the HUD's read `defaultPrevented`, so one press does one thing.

`layout()` reports where the open windows stand, bottom to top; `layout('grid')` first sticks them all into one grid in
the order they were opened (four make macet M2). `useWindows((s) => s.layout.windows.some((w) => w.id === 'swap'))` tells
a button whether its window is open.

What goes inside fills the window: the frame's body is `position: relative`, `overflow: auto`, and as tall as the window
minus its 44 px head. The body is a size container named `window`, so the contents lay out for the window's own width —
`@container window (min-width: 900px) { … }` puts the form beside a large chart on the whole screen (macet M3). On a phone the same `render` stands in the bottom sheet, so a window's contents are written once for
both.

## How it behaves

- **Computer** (900 px of width and more): windows float over the city in the workspace — under the top bar, above the
  dock. Dragged by the head near another window or the workspace's edge, a window sticks to it: an 8 px seam between two
  windows, edges in line so the corners meet; orange guides show what it sticks to. Every edge and corner stretches; the
  seam between windows that stick moves them all, none below its least. «Snap together» (beside the dock) sticks every
  open window into one grid.
- **Full screen**: the window takes the screen with a 12 px frame of the city around it and covers the top bar and the
  dock; the other windows step out of sight. «Exit full screen» or Escape brings it back where it stood; the keyboard
  stays inside it. A double click on the head also opens it on the whole screen.
- **Pop out**: a window that sticks — or is on the whole screen — floats free again, a step away, in front.
- **Phone**: the front window is a bottom sheet that can take the whole screen; tabs under its head switch between open
  windows, each keeping what was typed in it. Nothing floats or sticks.
- **Memory**: every window's last place is remembered on the device (`localStorage`, key `ryntra.city.windows.v2`), open
  or closed, so the swap opens again where it stood and four windows stuck together come back stuck. A smaller screen
  carries the layout onto it with the seams kept; storage that is missing or refuses means the first places again.

## Bays, tabs, the tray and layouts (CITY-84)

Helm §4 (`docs/research/ryntra-city-helm-2026-10-29/SPEC.md`): the windows stand beside the city, never over all of it.

- **Two bays.** The workspace's left and right side, the whole height, 432 px each on a 1440 screen (`bayCap`: at most
  520, and never more than the city leaves them — the bays together cover at most 60 % of the screen's width, so at
  least 40 % of the city is always in view under them). From 1200 px both; on a narrower computer screen the right one
  alone. A window opens the first time in a free bay, the right one first; with both taken it becomes a tab of the bay
  in front. A bay holds one frame; it stretches by its inner edge only, between 360 px and its cap.
- **Dragging.** By the head a frame lifts out of its bay and floats under the pointer; near the screen's side
  (`BAY_REACH`) the bay lights up and the frame docks there; over another frame's head that head lights up and the
  frame becomes its tab (every tab it had with it). Floating frames stick and stretch as before.
- **Tabs.** Windows sharing a frame show their glyph and title in its head; a tap shows one. «Pop out» takes a tab out of
  its frame (and a window out of its bay) to float.
- **The tray.** «Minimise» (a bar, beside «Close») folds a window into the tray over the Deck: it closes as its own
  «Close» closes it — its owner knows, nothing of it stays over the city or hears Escape — and its chip keeps what it
  showed (the tower, the market, Money's tab; `openers.ts` `showing`). The chip shows the live figure — the tower's
  price on the chart and the trade card (the city's own read), the market's mark on the Exchange, the wallet's worth on
  Money — green or red by the day's move. A tap opens the window again through its owner, on the same thing, where it
  stood; the chip also goes when the window opens any other way (the Deck, a tower). Only a window the city can open
  by itself folds (`canOpen`); a signature holds it. The trade card comes back on its own coin, and a launch's coin
  through the Launch engine. What was typed in it is not kept. A chip whose figure is old (the Exchange and Money read
  only while open) or another wallet's shows the title. The tray keeps to the city
  between the bays, stands over the sheet on a phone, and steps aside on the whole screen and while the Deck's doors
  are open.
- **Layouts.** One quiet glyph low on the left (computer only). Ryntra's four — «Trader» (the trade card with its chart,
  the wallet beside it), «Futures» (the Exchange beside the chart), «Predictions» (beside the futures where they are
  open), «Money» — each offered only where the windows it cannot do without are open here (`presetReady`). And the
  person's four: an empty place keeps the windows as they stand; a kept one puts them back; the one in use in this visit
  keeps every change by itself. Kept on the device per wallet (`localStorage`, key `ryntra.city.layouts.v1`, the
  connected wallet's address or «guest»; at most 8 wallets, never more than a read accepts). It follows the screen
  (`mergeShot`): windows not on the screen now — folded, closed by their owner for a run or a clip — stay in it; only a
  window the person closes with the frame's «Close» leaves it. A layout closes the windows it does not have,
  as their own «Close» would (a held one stays; a trade card held behind the chart goes too), and opens the rest
  through their owners (`openers.ts`) — nothing signs.
- **The city's share.** What the system arranges never covers more than 60 % of the screen (`coverIn`, the union of
  the frames): the bays, a first place (with both bays taken a new window joins the bay in front — never one a
  signature holds, not even by a remembered place — or floats small), the layouts, «Snap together» (the floating frames, in the room between the bays
  that the city can spare; no room, no button's work), a pop out (smaller if it must) and a frame stretched by hand
  (it stops there). Only the person's own drag and the whole screen may cover more.
- **The city behind.** With both bays taken the city dims (a shade under the top bar and the Deck) and, like with a
  window on the whole screen, is drawn lean: a pixel ratio of 1 and about 30 frames a second (`CityCanvas`, `Pacer` —
  the city's traffic and lights keep moving, so «frames on demand» is a steady half rate); the frame rate it then shows
  moves no quality rung, and a fresh monitor judges it after. Moves glide (260 ms) and nothing dims or sharpens while
  a frame is dragged.
- **Memory.** Every window's place now includes its bay: `ryntra.city.windows.v2` (from v1, so everyone's windows open
  in the bays once).

## On another screen (CITY-75)

«A chart onto the second monitor». A window with `detach` has one more quiet button in its
head — «Open in a new window» (a screen with an arrow leaving it, no words) — on a computer's browser only: never on a
phone, never inside the Ryntra app. In the frame now: the chart and the Exchange. The trade card (CITY-74) and
Predictions (CITY-67) get it with one field once they stand in the frame.

- **Chrome, Edge — Document Picture-in-Picture.** The same React contents move into a window that floats over
  everything: the page's styles are written into it as text at once (nothing to fetch, never unstyled), and every
  style the page adds later follows. One React tree, so the wallet, the stores and the reads are the city's own. One
  Picture-in-Picture per page: a second window goes the other way.
- **Firefox, Safari — a page of its own.** `window.open` on `/window?id=chart&tower=<mint>` (`app/window/page.tsx`,
  `OutPage.tsx`): the one window, no 3D city, the same wallet through the same adapter (a wallet this site was granted
  comes back by itself), its own reads. The two pages speak over `BroadcastChannel('ryntra.city.windows.v1')`:
  `here`, `gone` (with its size), `return`, `follow` (another tower picked in the city), `hello` (the city reloaded).
  One page per window (`ryntra-window-<id>`): opening it again reuses it.
- **Back in one tap.** «Back to the city» in the window out there, or the window's glass button low on the right in
  the city; closing the window out there does the same. The window comes back where it stood.
- **Remembered** on the device (`localStorage`, key `ryntra.city.windows.out.v1`, every read and write in try/catch):
  which windows were out and each one's size out there. A window that was out goes out again the next time it opens,
  while the tap that opened it still counts (a browser opens neither window without one); otherwise it opens in the
  city.
- **The owner leads.** A window its owner closes (a run, its tower gone) closes out there too and stays remembered as
  out. Out there the chart stays when the tower card closes (only another tower changes it); home leaves the Exchange
  out there. Reads that pause in a hidden tab keep running while a window out in Picture-in-Picture is seen
  (`cityInView`).
- **Signatures.** In Picture-in-Picture the code that asks the wallet runs in the city's page, so the wallet is the
  city's: Phantom and Solflare inject into the tab, not into the Picture-in-Picture document, and their approval opens
  as the extension's own window over the browser, usually on the main screen. While a signature is out the window out
  there says so in one line, «Confirm in your wallet», and its frame cannot be closed. On a page of its own the wallet
  is that page's, as in any tab: the extension asks over it.

## Files

| File | What |
| --- | --- |
| `geometry.ts` | The rules as geometry: the workspace, the bays, sticking, seams, stretching, the grid, carrying onto another screen. |
| `layout.ts` | The open windows as one value and every change to it: bays, tabs (stacks), the tray, where a drag lands. |
| `memory.ts` | The places remembered on the device, bays included. |
| `desks.ts` | The layouts (CITY-84): Ryntra's four presets, the person's four kept per wallet, what a layout opens where. |
| `detach.ts` | Another screen (CITY-75), the rules alone: which way out, the route, the messages, what is remembered. |
| `out.ts` | Another screen in the browser: Picture-in-Picture and its styles, the page of its own, the channel. |
| `store.ts` | The store and the API above. |
| `demo.ts` | The stand: `?windows=demo` (development builds only) opens the city's own windows — the chart of the first named tower, the Exchange (where its switch is open) and Money — through their own stores, stuck into M2; `&full=exchange` opens one on the whole screen. |
| `out-shots.mjs` | Another screen, both ways, for review (`docs/shots/city-75/`): `xvfb-run -a node city/lib/window/out-shots.mjs` with `npm run dev` running; a full Chromium (the headless shell has no Picture-in-Picture). |
| `shots.mjs` | The stand's screens (`shots/`) and the city's frame rate with and without the windows: `node city/lib/window/shots.mjs [out] [baseUrl]` with `npm run dev` running. |
| `bays-shots.mjs` | The bays, the tray, the tabs and the layouts for review (`docs/shots/city-84/`), desk 1440 and phone 390, against a running build. |

The frames are `city/components/window/` (`WindowLayer` is mounted once in `CityApp`, between the HUD and the trade card):
`WindowFrame`, `WindowSheet`, `Tray`, `Layouts`, `figures.tsx`, `openers.ts`. Review shots of CITY-84 —
`docs/shots/city-84/`.
