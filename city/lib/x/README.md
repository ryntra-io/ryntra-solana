# X for Ryntra City

Two parts in one folder: the studio films premium posts in the city itself (CITY-38), and the publisher posts the drafts a
person approved, 3 to 5 times a day (CITY-39). Nothing posts by itself: posting needs the X keys in the environment,
`RYNTRA_X_SENDER=on`, the desk's switch on and a person's approval of each draft (or of all ready drafts at once, with a
fresh second factor). Nothing in this repository holds an X key.

## The studio (CITY-38)

Premium posts for X, filmed in the city itself. One batch script makes five templates on a development stand. Each post
is a file, the words of the post and the source of every number. A person approves it in the drafts queue (CITY-3).

```
npm run dev
node city/lib/x/film.mjs [baseUrl] [--only hour,justin,launch,billboard,banner] [--fps 30|60] [--out out/x]
     [--mint <mint> | --journal <file> | --rehearsal <evidence.json>] [--reads <dir>] [--queue] [--quick]
```

| Template | What | Files |
| --- | --- | --- |
| `hour` — the tower of the hour | 9 s. The camera flies to the named tower that grew the most in the last hour (outside the docks), three volleys of fireworks, one big figure | `clip-4x5.mp4`, `clip-1x1.mp4`, `poster-*.png` |
| `justin` — JUST IN | One figure: the 24h volume of every tower in the city, or a named tower new in Sol Core between two reads | `card-4x5.png`, `card-1x1.png` |
| `launch` — Launch Night | 12 s. A Ryntra launch from the docks (its light column, the curve meter) to its pool (a flash, the tower moves into the skyline, fireworks) | `clip-*.mp4`, `poster-*.png` |
| `billboard` — the week's billboard | The five towers that rose the most since a read 6–8 days old. Until such a read is kept, the five busiest by 24h volume, and the card says so | `card-*.png` |
| `banner` — the X banner in action | The city mid-celebration at 1500×500, the word on the right, plus how it sits under the avatar | `banner.png`, `banner-preview.png` |

Each template's folder also has `post.txt` (the words, as the queue writes them) and `sources.json` (every number
with its source, read time and mint or transaction). `manifest.json` covers all five, with ffprobe's reading of every
clip.

### Formats

- 4:5 (1080×1350) and 1:1 (1080×1080). 1:1 is the middle of the same frame.
- 30 fps by default, 60 with `--fps 60`.
- H.264 High 4.1, about 8 Mbit/s, a key frame each second, BT.709 video range, the index first, no sound
  (`files.mjs`).
- The queue holds one file up to 4 MB, so a clip goes in as a copy at the bitrate that fits (`queue-4x5.mp4`). The
  8 Mbit/s master stays beside it.
- The brand's frame (`../moments/draw.ts`): the mark and RYNTRA top left, the source and read time top right, the
  address and the hook at the bottom.
- The hook is on screen from the first frame and settles in 0.3 s. Captions carry the story with the sound off. Every
  clip ends on the end card, under 60 s, so X loops it. `timeline.ts` holds these rules (`checkStoryboard`).

### Where the numbers come from

Only from a real read, never typed in (`facts.ts`):
- the city's market read (`/api/city`: Jupiter Tokens API v2, with its read time; on a stand without the network, the
  city's bundled read, said as such in `sources.json`);
- for Launch Night, the engine's flight log (`GET /api/v1/launch/{mint}/journal`): the `LAUNCHED` and `GRADUATED`
  transactions. The seconds between them are their two block times.

A coin Jupiter has not verified is never named. A Ryntra launch is never named either: Jupiter verifies coins, not
Ryntra. A template with nothing true to say makes no post. The script keeps every read of the city (`--reads`, by default
`out/x/reads/`) for the week's billboard.

On a stand without the engine, Launch Night takes its flight log from the evidence of the devnet rehearsal of 10.10
(`docs/research/launch-devnet-rehearsal-2026-10-10-micro/evidence.json`). That is a real launch and graduation on
devnet, 71 s apart, and the clip says DEVNET.

### Words

`post.ts`: the fact, its window, its source with the read time and one link back to the city. At most 280 characters as X
counts them. No promise, no hype word, no emoji. No handle and no hashtag: a partner is tagged only by the person who
approves the post (X rules II.B.2). The queue writes the words itself from the facts. Nothing the sender wrote reaches a
draft (`event.ts` reads every field).

### The queue

With `--queue` and the desk's machine key (`RYNTRA_MOMENTS_SECRET`), the script sends each post as a `studio` event to
`POST /api/moments/events`, then its file to `PUT /api/moments/drafts/:id/clip`. Those are the only two routes the key
opens. The studio films only on a development stand, so production's queue is filled from one:
`node --env-file=.env.local city/lib/x/film.mjs --only hour,justin --queue --queue-to https://ryntra.io`, with production's
machine key in `.env.local` (put there and in Vercel by hand; no session reads it). Facts too old for their template stay out: the tower of the hour is fresh for 2 h, JUST IN 6 h, the billboard a day,
Launch Night 3 days after its graduation. The publisher checks the same again before it posts. The desk does not film a
studio draft: its file comes from the script. Approving is a person's act.

### How it films

The city is drawn in software on a cloud machine at about one frame a second, and still films smoothly:
- **The clock.** The page lives on the studio's clock (`clock.mjs`): `performance.now`, `Date`, frames
  and timers are virtual.
- **The director.** `studio.ts` takes the clock and steps the city at exactly 60 frames a second: the camera, the
  fireworks, the city's own frame-rate watch (which then keeps the best quality).
- **The frames.** Each kept frame is drawn for both formats from the frame the scene hands over (`streamFrames`) and
  sent to ffmpeg as a JPEG.
- **While filming.** The city's own reads wait, so the skyline does not change under the camera.
- **Launch Night's tower.** A launch's tower is put in the docks, and at its graduation moved into the skyline. That
  happens only on the stand, for the take.
- **Development only.** The studio is a development hook (`window.__xstudio`, loaded by `../moments/MomentsLayer.tsx`
  outside production) and never reaches a production bundle. It never trades, signs or posts. The batch script
  (`film.mjs`), its clock and its files live here, in the line's own folder.

Samples of all five are in `docs/shots/city-38/`.

## The publisher (CITY-39)

The city's own small publisher on X API v2. It posts the drafts a person approved at the moments desk (CITY-3,
`../moments/drafts/`) to the Ryntra account, 3 to 5 times a day at set hours, with their clip or card. It never replies,
mentions on its own, likes, follows or reposts.

- **Sender** (`sender.ts`, `x-sender`). The drafts queue's real sender, wired in `../moments/drafts/server.ts`. It is
  connected only with `RYNTRA_X_SENDER=on` **and** all four keys (`config.ts`); otherwise it answers
  `X not connected: …`, builds no client and never calls X. It is a scheduled sender: approving a draft or turning the
  desk's switch on only puts the draft in line.
- **Client** (`client.ts`, `oauth.ts`). OAuth 1.0a user context (the key pair that does not expire, so the cron needs no
  refresh token). The keys sign each request and go nowhere else: not into a log, an answer or the browser. Media
  upload v2 in chunks of 1 MB: `POST /2/media/upload/initialize` → `/{id}/append` (multipart, `segment_index` +
  `media`) → `/{id}/finalize` → `GET /2/media/upload?command=STATUS` until `succeeded` (a video; a card needs no
  STATUS). Then `POST /2/tweets` with `media.media_ids`. Retries: 429 waits for X's reset when it is at most 20 s off,
  5xx and a dropped connection back off 1 s, 2 s, 4 s; anything else is final. One post has 40 s, upload and all (the
  cron's function has 60 s): no wait or retry runs past that.
- **Schedule** (`schedule.ts`). `RYNTRA_X_SLOTS` (3 to 5 `HH:MM`, an hour apart at least) in `RYNTRA_X_TZ`. Each
  time opens a 45-minute window; the cron runs every 10 minutes (`vercel.json` → `GET /api/x/cron`, `CRON_SECRET`).
  With the sender off a pass reads nothing and answers at once. A missed window is not made up later: posts never bunch.
- **One pass** (`run.ts`). Sender connected, desk switch on, a window open and not yet taken → the oldest approved
  draft is claimed (`approved` → `sending`, atomic in the queue) → the slot is taken in the ledger with the hashes of
  the words, their shape and the clip → the clip goes up, the post goes out → the draft is `sent` (`posted <id>`) or
  `failed` with X's reason. One post per pass, one per slot. A studio draft whose facts are no longer fresh for their
  template (`facts.ts`, `isFresh`) is `failed` as stale, never posted: «in the last hour» read yesterday is not news.
- **Never twice, never near-twice** (`ledger.ts`, `supabase/migrations/20261027180000_city_x_posts_v1.sql`). The queue's
  claim; one ledger row per slot; no live post (`sending`, `sent`, `unsure`) with the same words (spacing and case
  ignored) or the same clip; no live post in the last 20 hours with the same shape — the same words once numbers and
  links are taken out, so a template never goes out twice in a day with only its figures changed; and X's own duplicate
  refusal. A repeat is `failed` as a duplicate. A post whose answer was lost (a 5xx, then «duplicate» on the retry) is
  `failed` in the queue and `unsure` in the ledger: it is never sent again and its cost counts. A pass killed half way
  leaves its draft `sending` and its slot taken: it never goes out twice, and the report shows it for a person.
- **Cost** (`pricing.ts`). $0.015 a post, $0.20 a post with a link (a URL or a bare domain), from X's pricing page as
  read on 27.10 (`docs/research/x-marketing-2026-10-27/RESEARCH.md`, §3.1); to check against the Developer Console.
  Every city draft carries a link to its tower, so 4 posts a day ≈ $0.80, a month ≈ $24. `RYNTRA_X_DAILY_USD`
  (default $1.00) caps a day: a post that would go over it waits.
- **Day's report** (`report.ts`). Each slot (`ahead`, `open`, `missed`, `sent`, `failed`, `unsure`), posts, cost
  against the budget, approved drafts waiting, and the same in lines. The cron returns it on each pass; an operator
  signed in to the admin reads `GET /api/x/report?day=YYYY-MM-DD`.

### Як увімкнути: база, ключі, вимикач, перший пост

Кожен крок — окреме рішення. До кроку 5 нічого не публікується.

1. **База.** Застосувати через MCP Supabase три міграції по черзі: `20261027150000_city_moments_drafts_v1.sql`
   (черга CITY-3), `20261027160000_city_moments_drafts_studio_v1.sql` (вид `studio`, CITY-38), потім
   `20261027180000_city_x_posts_v1.sql` (журнал постів). До того `/api/moments` і `/api/x` відповідають 503.
2. **Ключі X.** У Developer Console (console.x.com) — застосунок на оплаті за дію:
   - User authentication settings → App permissions: **Read and write**;
   - Keys and tokens → **API Key and Secret** (consumer keys);
   - Keys and tokens → **Access Token and Secret** для акаунта Ryntra (згенерувати *після* зміни прав, інакше токен
     лишиться лише на читання);
   - Billing → звірити ціни: $0,015 за пост і $0,20 за пост із посиланням. Інша ціна — один рядок у `pricing.ts`.
3. **Змінні у Vercel (Production)**, значення — лише там, ніколи в репо:
   `RYNTRA_X_API_KEY`, `RYNTRA_X_API_SECRET`, `RYNTRA_X_ACCESS_TOKEN`, `RYNTRA_X_ACCESS_SECRET`; за бажанням
   `RYNTRA_X_SLOTS` (типово `11:00,15:00,18:00,21:00`), `RYNTRA_X_TZ` (типово `Europe/Kyiv`), `RYNTRA_X_DAILY_USD`
   (типово `1.00`; на перший день — `0.20`, тобто не більше одного поста). `RYNTRA_X_SENDER` поки `off`. `CRON_SECRET`
   уже є. Деплой. Перевірка: `/api/x/report` (увійти в адмінку) каже «X not connected: the sender is off».
4. **Вимикач.** `RYNTRA_X_SENDER=on`, деплой. Стіл `/#drafts` замість «No sender is connected…» пише «Autopost is
   off: approved drafts wait.» — вимикач столу ще вимкнений, нічого не йде.
5. **Перший пост.** На столі схвалити одну чернетку, увімкнути вимикач (свіжий другий фактор). У найближчому вікні
   розкладу (до 10 хв після його початку) крон опублікує її. Звірити: пост на X з кліпом, чернетка `sent` з номером
   поста, `/api/x/report` — один пост і $0,20; у Developer Console — витрата за день. Потім повернути
   `RYNTRA_X_DAILY_USD` на денну стелю (5 постів із посиланням — $1,00).
6. **Зупинити.** Миттєво — вимикач на столі (одним тапом, без другого фактора). Повністю — `RYNTRA_X_SENDER=off` і
   деплой, або відкликати токени в Developer Console.

Правила автоматизації X (`docs/research/x-marketing-2026-10-27/RESEARCH.md`, розділ 2): публікує лише власний акаунт
Ryntra, кожен пост схвалює людина, без автовідповідей, згадок, лайків і повторів; майже однакові пости відсікає журнал.

## Tests

`node --test "city/lib/x/*.test.mjs" app/api/x/routes.test.mjs` — nothing reaches X: a fake X on 127.0.0.1
(`fake-x.mjs`) checks every OAuth signature. They cover the studio's facts, words, storyboards and queue, the encoder's
arguments and a real encode checked with ffprobe, the rehearsal's flight log, the clock, and the publisher's client,
schedule, pass, ledger and routes. Add `MOMENTS_TEST_DATABASE_URL=postgres://…` (a local server, never a project) to run
the queue, the ledger and a whole pass through the real SQL, two connections at once.

Samples of all five are in `docs/shots/city-38/`: cards, posters, post text and sources. The clips (MP4) are not kept in
git — the studio renders them again from the same sources.
