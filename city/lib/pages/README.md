# The city's pages (CITY-157)

Docs, Developers, Help, About, the Terms of Use and the Privacy Policy — the six pages the menu (☰) used to open as
tabs of the old site. In the city each one is a window over the live city (the frame of CITY-65: a window on a
computer, the bottom sheet on a phone), and the same contents stand as a page of their own at the address the site
always had, for a store, a search engine or a post.

| Page | Window from ☰ | Address |
| --- | --- | --- |
| Docs | «Docs» | `/docs` |
| Developers | «Developers» | `/developers` |
| Help — Support and Feedback in one form | «Help» | `/support`, `/feedback` (canonical `/support`, out of the index) |
| About | «About» | `/about` |
| Terms of Use | «Terms» | `/legal/terms` (`#launch` opens the section on launched tokens) |
| Privacy Policy | «Privacy» | `/legal/privacy` (`#android` opens the section the store links to) |

## How it is made

- **Written once.** A page's contents (`city/components/pages/PageBody.tsx`) stand in the window and on the page;
  `WhereProvider` tells them which. A link to another page opens its window in the city, or goes to its address on a
  page (`PageDoor`).
- **The legal texts are the published ones.** `lib/legal/texts/terms.ts` and `privacy.ts` hold the words exactly as
  published on 7 October 2026, as data; `lib/legal/texts/published/*.txt` is the text the old pages rendered, and
  `legal.test.mjs` holds the two equal, in English and with a Ukrainian reader's sections. The fees and the Rewards
  split are read from the policy the product charges with (`figures.ts`). A change to the wording is a legal change:
  its own reviewed task.
- **Help is the engine's inbox.** `help.ts` sends `POST /api/feedback` with a topic — question, problem, idea, security
  (read first) — and shows the inbox's reference. The engine is not changed.
- **Developers** lists only what the engine serves today (`developers.ts`: the API, Sign In With Solana, the public
  capabilities, `llms.txt`, `security.txt`); project keys (DEV-2, behind its migration and switch), MCP and
  pay-per-call (CITY-154) say «soon».
- **Words** — `city/components/pages/words.ts`, English and Ukrainian. **Stills** — district frames filmed from the
  live scene (`PAGE_ART`), never the intro or a generated city.
- **A window of the city**: `PagesLayer` (mounted in `CityApp`), the store `store.ts` (`openPage(id, hash)`), known to
  «Back» and to «a window is open» (`city/lib/city/windows.ts`).

Beside them: `public/llms.txt` (the site for language models) and `public/.well-known/security.txt` (RFC 9116; its
contact is a stand-in until the owner names the security inbox).

## Screens

`node city/lib/pages/shots.mjs docs/shots/city-157 http://localhost:3000` with `npm run dev` running (a cloud session:
`CHROME=/opt/pw-browsers/chromium`): the menu, every window over the city, Help sent against a stubbed inbox, every
page at its address — desk 1440 and phone 390, English and Ukrainian.

## Not here

`city/lib/open/old-addresses.ts` (short addresses, the old docs' chapters `/docs/…`, `/company`, `/contact` — CITY-159),
the share cards and the manifest (CITY-158), `/legal/licenses` and `/legal/review/*` (still in the old legal shell,
`app/legal/(frozen)/`, until their own step).
