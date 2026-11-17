# «Усе в Solana» — двигун портфеля

Портфель показує все, що гаманець тримає в Solana, зокрема поза Ryntra: модуль читає це й дає одну модель позиції.
Екран портфеля і «Вийти з усього» стоять на ній. Тут нічого не будується, не підписується й не надсилається.

Маршрут: `GET /api/v1/portfolio?owner=` (контракт 1.98.0, `docs/api/CONTRACT-v1.md` §3cm).

## Файли

| Файл | Що робить |
|---|---|
| `model.ts` | одна модель позиції, коди виходу, помічники вартості; чистий |
| `wallet.ts` | монети й LST: Helius DAS і запасне читання рахунків токенів; чистий |
| `stake.ts` | stake-рахунки й правило виходу програми стейкінгу; чистий |
| `meteora.ts` | DLMM, DAMM v2 (читач пулів двигуна) і DLMM Pro (двері `lib/earn-pro`); чистий |
| `lend.ts` | Jupiter Lend (адаптер Earn) і Kamino (публічний API); чистий |
| `projection.ts` | Jupiter Portfolio (бета) — лише проєкція; чистий |
| `service.ts` | усі джерела разом: бюджет часу, кеш, stale і «не прочитано», ціни, суми, злиття з проєкцією |
| `readers.server.ts` | справжні читачі: вузол, ключі сервера, мережа; єдиний файл, що читає `process.env` |
| `service.server.ts` | відповідь маршруту |

## Для «Вийти з усього»

Кожна позиція несе все для виходу:

- `exit.how` — крок двигуна: `swap` (монета, LST — обмін двигуна), `pool-withdraw` (DLMM, DAMM v2 — зняти, зібрати,
  закрити в `lib/liquidity/studio`; DLMM Pro — `leave` і `close` у `lib/earn-pro`), `lend-withdraw` (Jupiter Lend —
  withdraw у `lib/earn`), `repay`, `stake-withdraw`, `stake-deactivate`;
- `exit.oneStep` і `exit.reason` — чи бере один крок усе, і що заважає (`LOCKED`, `LIQUIDITY` з `partBps`, `DEBT`,
  `REPAY`, `STAKE_ACTIVE`/`STAKE_COOLING` з `untilEpoch`, `STAKE_LOCKUP`, `NOT_WITHDRAWER`, `NO_ROUTE`, `PROJECTION`,
  `NOT_READ`);
- `refs` — програма, пул, рахунок позиції (позиція пулу, stake-рахунок, зобов'язання Kamino), NFT позиції, ринок
  (мінт активу Jupiter Lend, ринок Kamino, валідатор стейку), рахунок токена монети;
- `tokens[]` — мінти й сирі суми. Перед побудовою виходу двигун перечитує рахунок сам: сума портфеля — для показу.
- Після виходу: `forgetPortfolio(owner)` (`service.ts`) і `forgetWalletPositions(owner)`
  (`lib/liquidity/catalog/chain.server.ts`) — наступне читання питає всі джерела знову.

Kamino: виходу двигун ще не будує (`NO_ROUTE`). Активний стейк виходить або деактивацією з очікуванням епохи, або
внеском stake-рахунку в пул LST і обміном — це вибір самого виходу.

## Чого бракує

- Форми відповідей Helius DAS, Kamino і Jupiter Portfolio взято з документації й записів репо: сесія, що писала
  модуль, не мала мережі до цих хостів. Перше живе читання на стенді звіряє їх (`fixtures/README.md`).
- Kamino — лише головний ринок; решта ринків — через проєкцію, доки читач не візьме список ринків.
- DLMM Pro — лише через двері заробітку, лише mainnet і лише позиції на його причалах: до рішення D-M4 —
  `off`.
- Jupiter Lend Borrow — лише через проєкцію.
