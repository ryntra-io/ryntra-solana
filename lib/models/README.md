# Шлюз моделей OpenRouter — лінія «Моделі» (CITY-45)

Рішення 72, реєстр §0.18, звірка — `docs/research/ryntra-city-games-2026-10-27/REVIEW.md`
(«Ринг», «Гроші й випуск»). Один інтерфейс, через який у Ryntra City говорять з моделлю **охоронці Сейфа (CITY-47)** і
**агенти Рингу (CITY-50)**. Тека лінії — `lib/models/**`; двигун §11.8 і `lib/assistant/**` не змінюються.

Назви нижче — контракт. CITY-47 робить заглушку цього інтерфейсу паралельно; міняти їх — лише разом із тими, хто ними
користується.

## Файли

| Файл | Що в ньому |
| --- | --- |
| `types.ts` | інтерфейс: `ModelGateway`, `ModelCall`, `ModelResult`, журнал |
| `pin.ts` | `PinnedModel`, що таке закріплена модель і що таке псевдонім |
| `catalog.ts` | каталог (`/api/v1/models`), ендпоінти моделі (`/api/v1/models/{id}/endpoints`), провайдери (`/api/v1/providers`), кеш, оцінка ціни |
| `call.ts` | `createModelGateway` — виклик із закріпленою моделлю й бюджетом, `preflight` |
| `keys.ts` | `createKeyManager` — свій ключ з лімітом у доларах на агента чи охоронця |
| `errors.ts` | `ModelGatewayError` і його `kind` |
| `journal.ts` | рядок журналу `[models.call]` |
| `env.ts` | назви змінних середовища, читання ключів |
| `gateway.server.ts` | `modelGateway()`, `modelCatalog()`, `modelKeys()` на сервері (`import "server-only"`) |

## Інтерфейс

```ts
// відносним шляхом від свого файлу, як решта коду: з lib/vault/guard.ts — "../models/types.ts"
import type { ModelGateway, ModelCall, ModelResult } from "../models/types.ts";
import { modelGateway } from "../models/gateway.server.ts"; // лише на сервері

type ModelGateway = {
  call(request: ModelCall): Promise<ModelResult>;                    // ніколи не кидає
  preflight(model: PinnedModel, needs?: ModelNeeds): Promise<PreflightResult>; // ніколи не кидає
};

type ModelCall = {
  subject: { kind: "vault-guard" | "ring-agent"; id: string };     // id: 1–64 знаки A–Z a–z 0–9 . _ : -
  model: { id: string; providers: string[] };                       // PinnedModel
  messages: ModelMessage[];                                         // system | user | assistant (+toolCalls) | tool
  budget: { maxTokens: number; reasoningTokens: number; timeoutMs: number };
  tools?: { name: string; description?: string; parameters: object }[]; // охоронцю — жодних
  responseFormat?: { name: string; schema: object };                // строга JSON-схема
  apiKey?: string;               // свій ключ суб'єкта зі сховища секретів; без нього — OPENROUTER_API_KEY
  denyDataCollection?: boolean;  // лише провайдери, що не зберігають запити
  signal?: AbortSignal;          // своя зупинка понад бюджет часу
};

type ModelResult =
  | { ok: true; text: string | null; json: unknown; toolCalls: ModelToolCall[]; reasoning: string | null;
      finishReason: string | null; usage: ModelUsage; costMicroUsd: number | null;
      answered: AnsweredBy; generationId: string | null; latencyMs: number }
  | { ok: false; error: ModelGatewayError; usage: ModelUsage | null; costMicroUsd: number | null;
      answered: AnsweredBy | null; generationId: string | null; latencyMs: number };

type ModelUsage = { input: number; cached: number; output: number; reasoning: number; total: number };
type AnsweredBy = { model: string | null; provider: string | null; pinned: boolean | null };
```

`preflight(model, needs)` — перед тим, як гра відкриється чи турнір стартує. Модель не викликається.

- Модель закріплена, є в каталозі, її можна закріпити (`pinnable`) і вона має ціну.
- Кожен slug з `model.providers` знайдено серед ендпоінтів моделі (`GET /api/v1/models/{id}/endpoints`, поле `tag`).
- Хоч один із цих ендпоінтів уміє все з `needs`: `{ tools, structuredOutputs, reasoning, reasoningTokens }`.
  `reasoningTokens` — бюджет роздумів, з яким гра викликатиме: 0 відхиляє модель, що думає завжди; 1–1023 —
  модель Anthropic.
- Відповідь — `{ ok: true, model, endpoints, stale }` або `{ ok: false, error }`. `model` — модель як закріплена: ціни,
  ліміти й уміння з тих ендпоінтів (`endpoints`), а не загальні цифри моделі.

### Охоронець Сейфа (CITY-47)

```ts
const result = await modelGateway().call({
  subject: { kind: "vault-guard", id: vault.id },
  model: { id: "anthropic/claude-haiku-5.5", providers: ["anthropic"] },
  messages: [{ role: "system", content: guardPrompt }, { role: "user", content: attempt }], // нова розмова на кожну спробу
  budget: { maxTokens: 400, reasoningTokens: 0, timeoutMs: 30_000 }, // 30 с — межа «збою моделі»
  apiKey: vaultKeySecret,
  denyDataCollection: true,
});
if (!result.ok) { /* result.error.kind — див. таблицю нижче */ }
```

Охоронцю інструментів не дають: без `tools` у запиті їх немає зовсім. `reasoning` може містити слова фрази — його не
показують без фільтра фрази, як і саму відповідь.

### Агент Рингу (CITY-50)

Той самий виклик з `subject: { kind: "ring-agent", id: agent.id }`, моделлю агента, його ключем і бюджетом формату;
для Коду — `tools`, для ходу за схемою — `responseFormat` (тоді в результаті `json`). Хід думок (`reasoning`) Ринг
показує лише після фіксації обох ходів.

### Заглушка (для паралельної роботи)

Будь-який об'єкт з `call` і `preflight` тих самих типів — `ModelGateway`. Заглушка повертає
`{ ok: true, text, json: null, toolCalls: [], reasoning: null, finishReason: "stop", usage, costMicroUsd, answered,
generationId: null, latencyMs }` або `{ ok: false, error: new ModelGatewayError(kind, message), usage: null,
costMicroUsd: null, answered: null, generationId: null, latencyMs }`.

## Закріплена модель

- `model.id` — точний id з каталогу (`anthropic/claude-haiku-5.5`, `meta/llama-5-8b:free`).
- Не приймаються (`invalid_request`, нічого не відправлено): `latest` у будь-якому місці, `~vendor/…`, `openrouter/*`
  (роутери й приховані моделі), варіанти-скорочення маршруту `:nitro`, `:floor`, `:online`, `:exacto`, поле `models`.
- Кожен виклик спершу звіряє модель з каталогом (кеш 10 хвилин): немає в каталозі — `not_found`; не можна закріпити
  чи без ціни — `invalid_request`. Нічого не відправлено.
- Не можна закріпити (`pinnable: false`) і те, що OpenRouter оцінює нижче нуля (`"-1"`, роутери на кшталт
  `nvidia/switchyard`), і псевдонім з `alias_target`.
- `model.providers` — 1–4 slug-и провайдерів для `provider.only`; для поєдинку Рингу — рівно один.
  - Slug — це `tag` ендпоінта.
  - Повний tag (`amazon-bedrock/us-east-1`) — лише цей ендпоінт.
  - Базовий slug (`amazon-bedrock`) — усі ендпоінти провайдера з регіонами й варіантами, крім рівня обслуговування
    (`google-ai-studio/flex` — лише повним tag).
- Запит іде з `provider: { only, allow_fallbacks: false, require_parameters: true }` і `transforms: []` (OpenRouter не
  стискає підказку непомітно). Без `HTTP-Referer` і `X-Title`: вони додають застосунок у публічні рейтинги
  OpenRouter — це публікація, лише словом власника.
- `answered.pinned`:
  - `true` — відповіли модель (її id або датований `canonical_slug` з каталогу) і провайдер зі списку;
  - `false` — щось із них інше;
  - `null` — відповідь цього не сказала, або назву провайдера нема з чим звірити.
  - Відповідь називає провайдера іменем (`Google`), а запит — slug-ом (`google-vertex`). Звіряє лише список
    OpenRouter `GET /api/v1/providers` (ім'я → slug, кеш разом з каталогом), ніколи не «складене вручну» ім'я.
    Регіон чи варіант відповідь не називає — звіряється базовий slug.

## Бюджет одного виклику

| Поле | Межі | Що робить |
| --- | --- | --- |
| `maxTokens` | 1 … 64 000 | `max_tokens` — усе, що модель напише, з роздумами |
| `reasoningTokens` | 0 або менше за `maxTokens` | > 0 — `reasoning.max_tokens`; 0 — роздуми вимкнено: `reasoning: { effort: "none" }`, коли `none` є серед `reasoning.supported_efforts` моделі |
| `timeoutMs` | 1 000 … 300 000 | один `AbortSignal` на відправку й читання відповіді |

Ще до відправки: до 200 повідомлень, до 400 000 знаків, до 32 інструментів. Відхиляються (`invalid_request`) до
виклику:

- бюджет роздумів для моделі, якій каталог не дає `reasoning`;
- 0 для моделі, що думає завжди (`reasoning.mandatory`): вимкнути нема як, `effort: "none"` вона відкидає;
- 1–1023 для моделі Anthropic: OpenRouter піднімає такий бюджет до 1024, і він може перейти `maxTokens`.

Моделі без `none` і без `mandatory` 0 нічого не надсилає: як вона думає за замовчуванням — так і думатиме.

## Ціна

- **Факт** — `usage.cost` цього виклику від OpenRouter, у мікродоларах (1e-6 USD) цілим числом, округлено вгору,
  щоб сума ніколи не занижувала. Та сама одиниця й правило, що в помічника (`lib/assistant/models.ts`). Немає
  `usage.cost` — `costMicroUsd: null`, ніколи 0. Безплатна модель — відомий 0.
- **Оцінка наперед** — `estimateCostMicroUsd(preflight.model, { input, output })` (вагові категорії Рингу, ціна на
  картці). Невідома ціна — `null`.
  - Ціни — з ендпоінтів закріплених провайдерів, а не загальні цифри моделі: регіон Bedrock чи Vertex буває дорожчим.
  - Якщо відповісти може кілька ендпоінтів — на кожному розмірі підказки береться найвища ціна, щоб оцінка не
    занижувала.
  - Вище певного розміру підказки ендпоінт може брати інакше (`pricing.overrides` з `min_prompt_tokens`). Оцінка бере
    ціну того рівня, до якого дійшла підказка, на весь виклик.
- Каталог: ціна за 1M токенів входу й виходу (`prices.inputPerMillionUsd`, `outputPerMillionUsd`, роздуми, кеш і
  `overrides`), контекст, `maxOutputTokens`, `tools`, `structuredOutputs`, `reasoning`, `reasoningMandatory`,
  `reasoningEfforts`, `pinnable`.
- Ендпоінти моделі (`catalog.endpoints(id)`) і провайдери (`catalog.providers()`) — ті самі правила кешу.
- Читається без ключа, свіжий 10 хвилин; коли OpenRouter недоступний — остання копія молодша за добу з `stale: true`.
  Модель, якої OpenRouter не знає (404), — `not_found`, без старої копії.

## Ключі

- Лише зі змінних середовища сервера: `OPENROUTER_API_KEY` (виклики) і `OPENROUTER_MANAGEMENT_KEY` (керування
  ключами). У коді й репо — лише назви. Без ключа — `no_key` з назвою змінної; нічого не відправляється.
- Свій ключ на кожного агента й охоронця — `modelKeys()`:
  - `create({ subject, limitUsd, limitReset? })` → `{ info, secret }`. Назва в OpenRouter — `ryntra:<kind>:<id>`.
    Ліміт — понад 0 і не більше `KEY_LIMIT_MAX_USD` ($100). `limitReset`: `daily` | `weekly` | `monthly` | `null`
    (на все життя ключа).
  - `secret` OpenRouter показує один раз: викликач одразу кладе його в серверне сховище секретів і далі передає як
    `ModelCall.apiKey`. Шлюз його не зберігає, не пише в журнал і не повертає вдруге.
  - `disable(hash)` — `PATCH { disabled: true }`, коли матч, сейф чи агент завершився. `read(hash)` — ліміт,
    залишок, витрати.
  - Помилки керування кидаються як `ModelGatewayError` (на відміну від `call`).
- Вичерпаний ліміт ключа — `budget_exhausted`, зупиняє лише цього суб'єкта.

## Помилки (`ModelGatewayError.kind`)

| kind | Коли | Чия причина | `retryable` |
| --- | --- | --- | --- |
| `no_key` | немає ключа в середовищі або переданий ключ порожній | налаштування сервера | ні |
| `invalid_request` | псевдонім, без провайдера, бюджет поза межами, 400 | код, що викликає | ні |
| `unauthorized` | 401 | ключ | ні |
| `key_disabled` | 401 чи 403, де сказано, що ключ вимкнено | ключ вимкнено | ні |
| `budget_exhausted` | 402/403 з `limit_source: "openrouter_key_limit"` або «Key limit exceeded» | ліміт цього агента чи охоронця | ні |
| `account_budget_exhausted` | 402/403 з `limit_source` `openrouter_workspace_budget` чи `openrouter_guardrail_budget` | бюджет робочого простору чи guardrail над ключем — стоять усі його ключі | ні |
| `out_of_credits` | 402 без ознаки ліміту | баланс акаунта OpenRouter (Ryntra) | ні |
| `moderated` | 403 з причинами модерації | вхідний текст | ні |
| `forbidden` | будь-який інший 403: блок guardrail, ключ без потрібних прав (звичайний ключ там, де треба ключ керування) | налаштування акаунта чи ключа | ні |
| `rate_limited` | 429; 402 з `limit_source: "openrouter_in_flight_budget"` (бюджет запитів, що ще йдуть, — звільниться) | OpenRouter | так |
| `timeout` | вийшов `budget.timeoutMs`, 408 | модель чи мережа | так |
| `aborted` | спрацював `signal` викликача | викликач | ні |
| `provider_unavailable` | 5xx, помилка всередині відповіді, каталог не прочитано | провайдер | так |
| `network` | запит не дійшов | мережа | так |
| `invalid_response` | не JSON, без повідомлення, порожня відповідь (весь `maxTokens` пішов на роздуми), структурна відповідь не розбирається | модель чи провайдер | ні |
| `not_found` | немає моделі в каталозі; 404 — жоден ендпоінт закріплених провайдерів не бере таких параметрів; закріплений slug не має ендпоінта моделі; немає ключа з таким hash | закріплення | ні |

- `error.retryAfterMs` — скільки чекати за заголовком `Retry-After` (429, 503, 402 бюджету запитів у дорозі); `null`,
  коли OpenRouter не сказав.
- Ліміт ключа OpenRouter описує по-різному: живий 403 «Key limit exceeded (total limit)» (07.09.2026) і новіший формат з
  `error.metadata.limit_source`. Шлюз читає обидва; рішення — за `limit_source`, а не за текстом.
- Якщо відповідь викликали й оплатили, а користі з неї немає (`invalid_response`, помилка всередині 200), у
  `ModelFailure` лишаються `usage`, `costMicroUsd`, `answered` і `generationId`.
- **Перерваний виклик** (`timeout`, `aborted`) — `costMicroUsd: null` і `generationId: null`. Провайдер міг уже
  щось згенерувати й OpenRouter може це списати, але відповіді з `usage.cost` немає: ціну такого виклику шлюз не знає.
  Її видно лише у витратах ключа (`modelKeys().read(hash).usageUsd`) чи в журналі активності OpenRouter.

## Журнал

Кожен виклик, і вдалий, і відхилений, пише один запис `ModelCallRecord` (`schema: "ryntra.model-call"`):

- суб'єкт;
- запитана модель і провайдери, модель і провайдер, що відповіли, `pinned`;
- `generationId` — і в невдалого виклику, коли відповідь його несла;
- чий ключ (`own` / `shared`);
- бюджет, токени, `costMicroUsd`, затримка, `outcome`, `finishReason`.

Ні тексту запиту, ні відповіді, ні роздумів, ні ключа в записі немає. За замовчуванням це рядок `[models.call] {…}` у
журналі середовища. Гра передає свій `journal` у `createModelGateway`, щоб тримати записи у своєму сховищі. Збій
журналу не валить виклик: він пишеться в `console.error`.

## Чого тут немає

- Сховища секретів для створених ключів: його веде гра (CITY-47, CITY-50).
- Потокових відповідей (`stream: true`).
- Вагових категорій і правил Рингу (CITY-51) — лише оцінка ціни, з якої їх рахують.
- Реальних викликів у тестах: лише підроблений `fetch`; тест, що дійде до мережі, падає.

Тести: `node --test lib/models/*.test.mjs`.
