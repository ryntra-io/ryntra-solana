# The command line and Ryntra in every window (CITY-85)

Helm SPEC §1, §8–9 (`docs/research/ryntra-city-helm-2026-10-29/SPEC.md`): Ryntra lives in the command line and in every
window. The line **only opens a filled window and never signs**; Ryntra **only advises**.

## What a person does

- **⌘K** on a Mac, **Ctrl+K** elsewhere — or the spark «Ask Ryntra» in the top bar, which is the phone's way in. Never
  while the keyboard is in another field (an amount being typed is never taken for a command).
- One field: «buy SOL for 50», «купити SOL на 50», «стоп на JUP», «my portfolio». Under it, what will open, filled in;
  Enter or a tap opens it. Nothing typed yet: ready picks — buy the coin on screen (or SOL), the portfolio, a launch,
  and Ryntra's questions.
- The window opens with its fields written. The person reads them, presses the window's own button, and signs in their
  own wallet. Anything that is not a window to open goes to Ryntra as a question.
- In every window of the frame, a quiet spark beside «Full screen» and «Close» opens Ryntra's panel about what the
  window shows — the trade window's coin, the chart's tower — or about the market.

## What it understands (English and Ukrainian)

| Said | Opens |
| --- | --- |
| `buy SOL for 50`, `купити SOL на 50`, `buy $50 of JUP` | the coin's Spot window on buying, 50 USDC in the field |
| `buy JUP for 0.5 SOL`, `купи BONK на 0,25 SOL` | the same, paying 0.5 SOL |
| `sell all JUP`, `продати половину WIF`, `sell 25% BONK`, `sell JUP 100` | the Spot window on selling, the share or the count |
| `stop on JUP at 0.8`, `стоп на JUP`, `limit buy BONK 0.00002` | Spot on Stop or Limit, the price in dollars when said |
| `swap 1 SOL to JUP`, `обміняти 100 JUP на USDC` | the plain Swap window, filled |
| `my portfolio`, `history`, `top up`, `pay link`, `bridge` | Money on that tab |
| `send 0.5 SOL to <address>`, `надіслати 10 USDC на name.skr` | Money → Send with the recipient and amount |
| `earn`, `пули` | Earn (the Harbor where Earn's switch is shut) |
| `launch $MOON`, `запусти мені токен` | the launch sheet, ticker and name filled when said |
| `chart BONK`, `JUP`, a pasted address | the chart, the coin's window |
| anything else, and every question (`why…`, `чи варто…`, a trailing `?`) | Ryntra's panel, asking it |

Over an open window «buy 50», «sell all» and «stop 0.8» mean that window's coin.

## The rules it keeps

- **Never a signature.** A command reaches the city only through `Doors` (`run.ts`): each door opens a window or writes
  a field through the setter the person's own typing uses. None presses a button, asks for an order, opens the wallet or
  sends. (With a wallet connected, the trade window itself still prepares the unsigned order for what is on screen while
  the person reads it, as it does for a tap on a tower; the wallet opens only from the window's own button.) The tests
  hold every sentence up to the doors, allow the command code only reviewed calls (an allowlist, plus a list of every
  call that moves money), and run every sentence through the city's real stores with the wallet, the engines and
  `fetch` as spies (`command.test.mjs`).
- **A signature out holds its window.** A trade card, a transfer or a launch under way is never replaced or written into.
- **No word is guessed into money.** A bare number is dollars — read the smaller way, a word never spends more than was
  meant. A count of the coin bought cannot stand in the field that says what is paid, so it is left for the person. A
  sale is said in the coin sold: «sell SOL for 50» says what it brings in, so the amount is left out. A price beside
  «buy» or «sell» («buy JUP at 0.5») opens a limit at that price. `1,000`, `1 000`, `1.000`, `.5`, `50k`, `-5`, «50
  гривень» and «50 eur» are left out, never rounded into a number or read as dollars. A ticker or an address the city
  has no tower for is never replaced by the coin on screen, and the sentence's own words («me», «send») name a coin only
  written as one («$ME», «ME»). A price said aloud is dollars: the window is put on USDC first, and the price is
  written once, into exactly the field it was said for — another side, way or command, and it is let go.
- **Not an order.** A condition («buy JUP if it drops»), a refusal («не купуй JUP») or an agent («запусти бота») goes to
  Ryntra as a question — unless the agent's one-sentence instructions are open (CITY-176,
  `NEXT_PUBLIC_RYNTRA_CITY_ONE_SENTENCE`): then «buy $20 of SOL every week», «buy JUP if it drops to 0.7» or «stop on JUP
  at 0.8» put the agent's row first, which opens its card (`city/lib/instruct/`) — the card shows what will be set, and
  the person signs there. The line itself still opens only; it signs nothing.
- **Only open windows.** A window whose switch is shut here is not offered (`fit`); a limit where Spot is shut opens
  the coin's own window, never a pretend order.
- **Ryntra only advises.** Its panel answers with towers and words; a tower opens its own card, where the person decides.
  The coin on screen is the question's subject only when the question is about it.
- **Escape closes what is on top** — the line, else Ryntra's panel — heard before every other panel's keys.

## Files

| File | What |
| --- | --- |
| `parse.ts` | Pure: the sentence → a `Command`; `fit` to the deployment's switches; `suggest` — the rows under the field; `bookOf` — the coins a command can name (verified towers, SOL, USDC). |
| `run.ts` | Pure: a `Command` → calls on `Doors`, and the list of doors (open, fill, ask — nothing else; since CITY-176 `openInstruction` and `openInstructions` open the agent's card and «My instructions»). |
| `doors.ts` | The city's doors on its own stores; what is on screen (`contextNow`, `towerForWindow`) and the switches (`gatesNow`). |
| `store.ts` | Whether the line is open. Dev hook: `window.__openCommand()`. |
| `keys.ts` | ⌘K / Ctrl+K and Escape, installed once before any panel's own keys. |
| `shots.mjs` | The line on a desk (1440) and a phone (390): `node city/lib/command/shots.mjs [out] [baseUrl]` with `npm run dev` running. |

The faces are `city/components/command/` — `CommandLayer` (mounted once in `CityApp`) and `AskInWindow` (in the frame's
head, `city/components/window/WindowFrame.tsx`, and the phone's sheet, `WindowSheet.tsx`).
