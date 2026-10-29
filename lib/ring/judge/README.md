# Суддя й квитанція матчу — лінія «Ринг» (CITY-68)

Рішення 74, реєстр §0.18. Відбір — `docs/research/ryntra-city-harvest-2026-10-28/README.md`. Ідеї взято з рушія RXN
(`duel-engine/src/replay.ts`, `hash.ts`, `schema.ts`; `docs/BLUEPRINT.md` §4.1) і переписано в стилі міста.

Чиста бібліотека: без UI, без грошей, без бази, без мережі, без годинника. Час, ключі й ігри приходять ззовні.
Запис у ланцюг тут не робиться: бібліотека лише будує рядок memo.

## Файли

| Файл | Що в ньому |
| --- | --- |
| `index.ts` | усе публічне одним імпортом |
| `rules.ts` | класи «Перевірене» і «Шоу», хто вирішує, на що грають; `checkRules`, `rulesHash` |
| `hash.ts` | канонічний JSON (ключі відсортовано; те, чого JSON не тримає, кидає помилку), SHA-256, `firstDifference` |
| `stamp.ts` | підпис часу Ed25519: обв'язка підписує «це місце цього матчу здало цей хеш у цю мить» |
| `replay.ts` | журнал матчу, `recordLog`, `verifyLog` (перша розбіжність), `logHash` |
| `judge.ts` | `judge`: вердикт за трьома рівнями доказу |
| `receipt.ts` | квитанція: `makeReceipt`, `checkReceipt`, `receiptMemo` |
| `memo.ts` | рядок memo для Solana: `memoOf`, `parseMemo` |
| `race.ts` | демо-гра «до десяти» — приклад `ReplayGame` для тестів і показу |
| `bad-agent.ts` | «поганий агент»: 23 публічні шахрайства і чесні матчі `demoKit`, з яких вони починаються |

## Класи змагань

| Клас | Хто вирішує (`decider`) | На що можна грати (`money`) |
| --- | --- | --- |
| `verified` — «Перевірене» | код: `replay` (повтор журналу) або `tests` (приховані тести в пісочниці) | `none`, `sponsored`, `small`, `stakes` |
| `show` — «Шоу» | `model` — суддя-модель | `none`, `sponsored`, `small` |

- `stakes` — справжні SOL із входів у призовий пул (програма CITY-46, гроші — CITY-52). Лише клас «Перевірене».
- Стелю `small` задає модуль пулів разом з грошима, а не суддя.
- `checkRules` повертає `MONEY_NEEDS_VERIFIED`, коли формат на гроші не «Перевірене». Повертає `CLASS_DECIDER`, коли
  клас не збігається з тим, хто вирішує.
- Конфіг гри входить у правила: `game: { id, version, config }`. Отже, і в `rulesHash`. Журнал з іншого конфігу —
  `RULES_MISMATCH`.
- Подання приймають лише між `opensAt` і `closesAt`. Стеля `maxBytes` — `MAX_SUBMISSION_BYTES` (1 МіБ), хоч би що казали
  правила.
- Формати Рингу — `RING_FORMATS`:
  - Злам на двох, Код, Ринок на повторі й Кості — код;
  - дебати й шоу персонажів — модель.

## Три рівні доказу

| Рівень | Що перевіряє | Хто дає |
| --- | --- | --- |
| L1 | тип і розмір подання, хеш байтів, підпис часу, хеш правил, ліміти (кроки, ціна моделі, час) | подання агента, підпис і вимір обв'язки |
| L2 | повтор журналу або приховані тести | рушій гри (`ReplayGame`) або пісочниця (`TestRun`) |
| L3 | оцінка судді-моделі, 0 … 1 | модель |

- У «Перевіреному» L3 лише записано поруч (`support`): вердикт вона не рухає ні вгору, ні вниз.
- У «Шоу» L3 вирішує:
  - `score ≥ passAt` — PASS;
  - `score ≤ failAt` — FAIL;
  - між ними — «неясно».

## Вердикти

| Вердикт | Коли | Виплата |
| --- | --- | --- |
| `PASS` | доказ чистий, перемога (у «тестах» — пройдено відбір) | так — єдиний оплачуваний |
| `FAIL` | доказ чистий, не перемога | ні |
| `NEEDS_REVIEW` | доказу бракує, він неясний або зламаний наш власний вхід | ні |
| `BLOCKED` | агент чи формат порушив правило | ні |

Порядок перевірок фіксований: правила → L1 → ліміти → L2 або L3 → історія. Перша невдача й дає вердикт.

**Коди причин:**

- `PASS` — `WON`, `TESTS_PASSED`, `MODEL_PASS`.
- `FAIL` — `NOT_WON`, `TESTS_FAILED`, `MODEL_FAIL`.
- `BLOCKED`:
  - формат — `CLASS_DECIDER`, `MONEY_NEEDS_VERIFIED`, `RULES_MISMATCH`, `WRONG_MATCH`, `BAD_FORMAT`, `TOO_LARGE`;
  - підробка — `HASH_MISMATCH`, `BAD_STAMP`, `EARLY`, `LATE`, `REPLAY_DIVERGES`, `LOG_NOT_HARNESS`, `TESTS_TAMPERED`;
  - правила гри — `LIMIT_EXCEEDED`, `TEST_SKIPPED`, `FALSE_CLAIM`.
- `NEEDS_REVIEW`:
  - неясно — `UNDECIDED`, `INFRA`, `UNCLEAR`;
  - до людини — `AMBIGUOUS_TWICE`, `PASS_AFTER_UNCLEAR`, `PASS_AFTER_VERDICT`, `IN_REVIEW`;
  - бракує доказу — `NO_EVIDENCE`, `NO_GAME`;
  - зламаний вхід — `BAD_RULES`, `BAD_INPUT`, `JUDGE_ERROR`.

**Ні «неясно», ні остаточний вердикт не стають перемогою через повтор.** Попередні вердикти того самого матчу й місця
передаються в `prior`.

- Перше «неясно» дозволяє перепрохід: `rerun: true`.
- Друге «неясно» — ручний розгляд: `AMBIGUOUS_TWICE`.
- PASS після «неясно» теж чекає людину: `PASS_AFTER_UNCLEAR`.
- PASS після PASS, FAIL чи BLOCKED — теж до людини: `PASS_AFTER_VERDICT`.
- Коли матч уже в людини, кожен наступний прохід лишається там: `IN_REVIEW`.
- FAIL і BLOCKED історія не пом'якшує.

**«Тести» — це відбір, а не переможець.** PASS у форматі `tests` означає «пройшов щонайменше `minPassed`». PASS можуть
отримати кілька місць. Як ділити приз між ними, вирішує модуль пулів, а не суддя.

**`detail` короткий.** Не довший за `DETAIL_MAX` (120 символів), хоч що туди написали агент, гра чи помилка.

**Fail-closed.** Будь-який виняток усередині (баг гри, збій перевірки підпису) дає `NEEDS_REVIEW` / `JUDGE_ERROR`.
`judge` ніколи не кидає помилку.

## Журнал і повтор

```ts
type MatchLog = {
  format: "ryntra-ring-log/1";
  matchId: string; // 1–64 символи A-Z a-z 0-9 . _ : -
  game: { id: string; version: string };
  config: unknown;
  entries: { seq: number; at: number; input: unknown; derived: unknown }[];
  result: { winner: number | null; [k: string]: unknown } | null;
};
```

Журнал зберігає два види значень:

- `input` — ходи, маяки й такти. Їх беруть як дані.
- `derived` і `result` — те, що рушій вивів. Їх рахують заново.

Повтор може зробити будь-хто: `verifyLog(game, log)` повертає `{ ok, result, steps }` або першу розбіжність
`{ index, path, expected, found, message }`. Тут `index` — номер запису, `"log"` або `"result"`.

- Подання для повтору — журнал у канонічному JSON з типом `ryntra-ring-log/1`. Тому журнал має рівно один хеш.
- `logHash` — SHA-256 цих байтів.
- Журнал, що обривається до кінця, дає «неясно», а не перемогу.

**Суддя судить журнал обв'язки, а не агента.** Обв'язка сама пише журнал під час матчу й передає його хеш у
`harness.logHash`. Подання агента має збігтися з ним байт у байт.

- Інший журнал, навіть законний, — `LOG_NOT_HARNESS`. Сюди потрапляють вигадана перемога й обрізаний журнал.
- Без `harness.logHash` вердикту немає: `NEEDS_REVIEW` / `NO_EVIDENCE`.
- Тому PASS отримує лише справжній переможець, а не кожне місце, що здало свій журнал.
- Ліміт кроків перевіряють до повтору: довгий журнал не програють.

Гра для повтору:

```ts
type ReplayGame<S> = {
  id: string;
  version: string;
  start(config, matchId): S; // MoveRejected — конфіг не за правилами
  step(state, input, at): S; // MoveRejected — хід не за правилами
  derive(state): unknown; // що журнал пише після запису (лише JSON)
  result(state): { winner: number | null } | null; // null — ще не вирішено
};
```

Рядки, де є одинокий сурогат UTF-16, не хешуються: `BAD_FORMAT`. Такий рядок не має одного вигляду в UTF-8.

`recordLog(game, matchId, config, inputs)` пише журнал так, як його пише рушій.

## Квитанція

```ts
type Receipt = {
  format: "ryntra-ring-receipt/1";
  matchId: string;
  seat: number;
  contest: string; // формат Рингу
  class: "verified" | "show";
  money: Money;
  rulesHash: string;
  judge: string; // JUDGE_VERSION
  logHash: string | null;
  verdict: Verdict;
  reason: ReasonCode;
  level: Level;
  detail: string;
  result: GameResult | null; // результат повтору, разом з переможцем
  seal: "verified" | null; // печатка «перевірено»: «Перевірене», вердикт PASS чи FAIL
  at: string; // ISO 8601, UTC
  hash: string; // SHA-256 канонічного JSON решти полів
};
```

- `checkReceipt(receipt, { rules, log, game })` повертає список того, що не сходиться: `FORMAT`, `HASH`, `JUDGE`, `SEAL`,
  `RULES`, `LOG`, `MATCH`, `VERDICT`. Порожній список — квитанція сходиться.
  - З `log` — хеш і матч журналу мають бути квитанції.
  - З `rules`, `log` і `game` повтору — PASS чи FAIL грають знову. Вердикт, причина й результат для цього місця мають
    збігтися.
  - `WON` і `NOT_WON` мають збігатися з `result` самої квитанції навіть без нічого іншого.
- Чого перевірка не доводить: що саме цей журнал записала обв'язка. Це доводить memo — хеш квитанції в ланцюгу поруч
  із хешем журналу. Без гри перевірено лише хеші. Вердикт «тестів» і «шоу» заново не рахується: прогону тестів і оцінки
  моделі в квитанції немає.
- `receiptMemo(receipt)` дає рядок `ryntra-ring/1|<matchId>|<logHash>|<receiptHash>`: ASCII, не більше 256 байтів.
  Цей рядок готовий для програми Memo.
- Запис у ланцюг робить модуль пулів. У mainnet — лише словом власника.

## Як цим користуватися (для CITY-69 і CITY-51)

```ts
import { judge, makeReceipt, receiptMemo, rulesHash, stampVerifier, type Rules } from "@/lib/ring/judge";

const verdict = judge(
  { matchId, seat, rules, rulesHash: rulesHash(rules), submission, usage, claim, prior, harness: { logHash } },
  { verifyStamp: stampVerifier([harnessSigner]), games: [dice] },
);
const receipt = makeReceipt({ matchId, seat, rules, judgement: verdict, at: Date.now() });
const memo = receiptMemo(receipt);
```

- Кості (CITY-69) реалізують `ReplayGame` поверх рушія RXN. У правилах: `decider: "replay"`,
  `game: { id, version }`. Подання — журнал матчу.
- Ключ підпису часу тримає обв'язка в середовищі сервера, у репо його немає. Тести щоразу роблять новий ключ.
- Обв'язка штампує подання кожного місця для цього матчу й цього місця: `stamp({ matchId, seat, hash }, at)`.
- `harness.logHash` — хеш журналу, який записала сама обв'язка. Для обох місць він однаковий.
- `usage` міряє обв'язка, а не агент: ціну моделі, час ходів, кроки.

## «Поганий агент»

`BAD_AGENTS` — 23 сценарії.

- Кожен бере чесний матч з `demoKit` і робить одне шахрайство:
  - заявляє перемогу після поразки;
  - переписує результат чи хід і просить підпис;
  - здає вигаданий законний журнал зі своєю перемогою;
  - обрізає журнал перед ходом, що програв;
  - ходить двічі;
  - підмінює хеш чи байти після підпису;
  - підписує своїм ключем;
  - бере підпис з іншого матчу;
  - приходить зарано чи запізнюється;
  - перевищує розмір, ціну, час чи кроки;
  - грає за іншими правилами;
  - ховає чи пропускає тест;
  - дописує фальшивий тест;
  - бреше про кількість пройдених;
  - підсовує тести іншого коду.
- Суддя повертає `BLOCKED` з точним кодом: квитанція без печатки, виплати немає.
- Fight Night (CITY-60) може показувати ці сценарії наживо.

## Перевірка

```bash
node --test "lib/ring/judge/**/*.test.mjs"
```

76 тестів: суддя, повтор, квитанція, класи, підпис часу, memo і всі сценарії «поганого агента».
