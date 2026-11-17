# Фікстури портфеля

Відповіді провайдерів у формі, яку вони документують, — для тестів без мережі (`../portfolio.test.mjs`).

- Власник і мінти — справжні публічні адреси: гаманець — зі сценарію касет студії пулів
  (`lib/liquidity/studio/fixtures/scenarios.mjs`), мінти — USDC, SOL, JitoSOL, Bonk.
- Рахунки стейкінгу, валідатор, зобов'язання й резерви Kamino, рахунки токенів і рядки проєкції — адреси з насіння
  `ryntra-portfolio-<назва>` (`Keypair.fromSeed(sha256(...))`), не справжні рахунки.
- Сесія, що їх писала, не мала мережі до Helius, Kamino і Jupiter: форми взято з документації провайдерів і записів
  репозиторію, не з живого запису. Перше живе читання на стенді звіряє їх; розбіжність — правка читача й фікстури разом.
- Пули Meteora DLMM і DAMM v2 тести читають не звідси, а з записаних касет mainnet студії пулів.

| Файл | Що це |
|---|---|
| `das-assets-by-owner.json` | Helius DAS `getAssetsByOwner` з `showFungible` і `showNativeBalance` |
| `token-accounts.json` | `getTokenAccountsByOwner` (`jsonParsed`) двох програм токенів |
| `stake-accounts.json` | `getProgramAccounts` програми стейкінгу (`jsonParsed`) за staker і за withdrawer, епоха й час |
| `kamino-obligations.json` | `GET /kamino-market/{market}/users/{owner}/obligations` |
| `kamino-reserves-metrics.json` | `GET /kamino-market/{market}/reserves/metrics` |
| `jupiter-portfolio-positions.json` | `GET /portfolio/v1/positions/{owner}` (бета) |
