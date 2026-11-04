# Drafts for X (CITY-3)

The city drafts its own posts for X: a Ryntra launch, its move into the skyline at $75K, a big x and an agent's find.
Each draft carries its words, its link and the clip the city films. A person approves or rejects it; an approved draft
is posted by the X publisher (`../../x/`) once it is connected.

- **Event → draft.** `POST /api/moments/events` (`events.ts` reads it field by field) → a moment (`../moment.ts`) → the
  words and link (`post.ts`, at most 280 characters as X counts them) → the queue (`store.ts`, `supabase-store.ts`). The same
  happening is always one draft. A win or a find on an unverified coin is never a post, and a big x needs at least 5x.
  The trader and the transaction are never named.
- **The clip.** The desk (`Desk.tsx`, `/#drafts` in the city) films each draft with the CITY-26 director
  (`../stage.ts` → `filmMoment`, frames through `streamFrames`). The MP4 goes to `PUT /api/moments/drafts/:id/clip`. Where the
  browser cannot encode the clip, or the clip is over 4 MB, the 4:5 card goes as a JPEG instead. While open, the desk also turns
  the city's own Ryntra launches and moves into the skyline into drafts (`city-events.ts`).
- **Decide.** Approve, reject, or «Approve all» for every ready draft. Each decision records who made it.
- **Switch and sender.** The switch is off by default (one database row). An approved draft goes to a sender only with the
  switch on **and** a sender connected. The sender is `x-sender` (`../../x/`, CITY-39): connected only with
  `RYNTRA_X_SENDER=on` and the X keys set in the environment, and scheduled — approving only puts a draft in line, and
  the publisher's cron posts it in the next slot of the day (3 to 5). There are no X keys in the repo; without them it
  answers «X not connected». `NO_SENDER` (`sender.ts`) is the same refusal, for tests. Connecting it is a deliberate,
  separate step (`../../x/README.md`).
- **Door** (`door.ts`). `Authorization: Bearer $RYNTRA_MOMENTS_SECRET` opens only the machine routes, `POST /events` and
  `PUT /drafts/:id/clip`, for the engine or a cron (16+ characters; without the variable no key opens anything). Reading the
  queue and clips, approving, rejecting and the switch need an operator signed in to the admin (same origin for changes);
  the key is refused there. «Approve all» and turning the switch on also need a fresh second factor (`requireFreshMfa`),
  and every decision goes on the admin's audit trail. The desk holds no key.
- **Sending once.** A delivery claims each approved draft first (`approved` → `sending`, one atomic UPDATE that also
  checks the switch), then asks the sender, then marks it `sent` or `failed`. Two deliveries at once never post it twice.
  Approving an approved draft again answers 200 with its state.
- **Database.** `supabase/migrations/20261027150000_city_moments_drafts_v1.sql` is a file only: it is applied to production
  as a deliberate, separate step. Until then the routes answer 503. In development the queue can live in memory:
  `RYNTRA_MOMENTS_STORE=memory`.

**Studio posts** (CITY-38, `../../x/`). A fifth kind, `studio`: the studio's batch script sends a template's facts (the tower
of the hour, JUST IN, Launch Night, the week's billboard, the banner), the server writes the words from them
(`../../x/post.ts`), and the script sends the clip it filmed itself. The desk does not film these.

Producers still to wire (other lines' paths): the engine's Launch (launch, graduation), a trade's big x (with the
trader's consent) and the agents of CITY-4. Each calls `POST /api/moments/events` with the secret.

Tests: `node --test "city/lib/moments/drafts/*.test.mjs" app/api/moments/routes.test.mjs`. Add
`MOMENTS_TEST_DATABASE_URL=<local Postgres URL>` (a local server, never a project) to run the queue through the real SQL.
Shots: `shots.mjs` (see its header).
