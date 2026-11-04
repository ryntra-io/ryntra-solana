# The notification centre (CITY-87)

`docs/research/ryntra-city-helm-2026-10-29/SPEC.md` §10. One way for the city to tell something — `notify(note)` — and
one window where the person decides where each kind goes: **City** (a banner, or the live feed for a market kind),
**Desktop** (the computer's own notification while Ryntra is open in a tab) or **Off**. Telegram is connected in its row
(`/api/v1/notifications/telegram`); what goes there is Ryntra's server's — a reached stop the engine keeps, a lit beacon
whose own Telegram switch is on — and the window marks those kinds with the Telegram glyph (only then) instead of
pretending to choose for the engine. The window is Settings →
Notifications (`city/components/settings/`), opened from the avatar (the wallet in the top bar), the menu's «Settings» or
`?open=settings`; where the banners stand, the feed's side and the flashes are Settings → Display.

**The liquidation risk is never off** (decision 88, Guard): it has no «off», a kept «off» reads as its start, `setRoute`
refuses it, and neither «Mute all» nor the quiet hours nor a cap hold it. It always stands as a banner and stays until
closed; the computer's notification too, where the person chose so.

## Saying something

```ts
import { notify } from '@/city/lib/notify/store';

notify({ kind: 'stops', title: wordsNow(NOTES).stopReached('BONK'), line: wordsNow(NOTES).stopLine, tower: mint });
```

| Field | What |
| --- | --- |
| `kind` | One of `KINDS` (`kinds.ts`). |
| `title` | One short line, in the language on screen (`wordsNow`). |
| `line` | A second, quieter line; optional. |
| `tower` | The tower it is about: a tap on the banner or the notification flies there. |
| `onScreen` | The city already shows it where the person looks (the trade window's own result): no banner over it. |

## Adding a kind

One entry in `KINDS` (`kinds.ts`): its group (`market`, `yours`, `earn`, `safety`), the places it may go, where it
starts, its cap, `locked` only for Guard's own (the liquidation risk, loan health), `telegram` where Ryntra's server
itself tells Telegram about it, `door` where something in the deployment can say it (a flag). Then its name
in `city/components/settings/words.ts` (`kind_<id>`, both languages), and a source that says it — beside the others in
`sources.ts`, or in the line's own code. The window lists it by itself.

**Earn (CITY-100)** did exactly that: `range`, `weekend`, `dividend` in the `earn` group and `loan` in `safety`
(locked; listed once Earn reads a loan — `EARN_LOANS`, E10). Their source is Earn's own (`city/lib/earn/notes-source.ts`),
and Ryntra's server tells the phone and Telegram about them through the engine's inbox (`city/lib/earn/notes-watch.ts`);
a tap on their banner or the computer's notification opens Earn on «Mine» (`openKind`). That they may come late is
said behind the section's «i», never on the screen.

## Files

| File | What |
| --- | --- |
| `kinds.ts` | The kinds, their places, their start, their cap; the liquidation risk locked. |
| `prefs.ts` | The person's centre on this device (`ryntra.city.notify`): routes, caps, banners' corner, the feed's side, the flashes' size, quiet hours, «Mute all». |
| `gate.ts` | One note at the gate: a banner, the computer, or nowhere — and why. Pure. |
| `store.ts` | The page's state and `notify()`. A market kind's on/off and the flashing on/off stay the live feed's switches (CITY-66). |
| `channels.ts` | `/api/v1/notifications/telegram` and `/api/v1/notifications/devices`, unchanged, under the wallet's proof. |
| `channels-store.ts` | Telegram connected in its row (the bot's link, then the chat once Start is pressed), the phones. |
| `desk.ts` | The browser's own notifications, on a computer only. |
| `sources.ts` | What the city already knows, said through the centre: the feed, trades, stops, beacons, Phoenix's margin (read once a minute while the page is in view and the Exchange's window is closed). Earn's notes have their own source (`city/lib/earn/notes-source.ts`). |
| `shots` | `node city/lib/settings/shots.mjs [out] [baseUrl]` with `npm run dev` running. |

## What the engine does not do yet

- Telegram per kind: the engine sends a reached stop (the account's monitoring preferences) and a lit beacon (each
  beacon's own switch) to a connected Telegram, and keeps its own quiet hours; «Mute all», the quiet hours and «Off» here
  hold the city and the computer only. A per-kind choice for Telegram is an engine change.
- The futures margin is watched by the city only while Ryntra is open: no server watcher tells Telegram about it, so
  the liquidation risk offers City and Desktop.
- A phone registers for pushes from the Ryntra app (it holds the token); the page only lists and removes phones.
