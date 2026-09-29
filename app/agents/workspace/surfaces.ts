import type { ProductCapabilityId } from "@/lib/product/capabilities";
import type { WorkspaceLocale } from "@/app/shell/locale";

/*
 * One record per workspace route: its heading, its scope, and the exact state
 * of the thing behind it.
 *
 * Two problems this file exists to solve.
 *
 * **Scope was global and therefore wrong on most screens.** The workspace
 * carried `environment: "BNB Testnet"` in `app/shell/workspaces.ts`, so the
 * chip appeared above the Agentverse Passport — a provider-global read whose
 * evidence has nothing to do with any chain — and above a JSON verifier that
 * touches no network at all. `app/shell/workspaces.ts` had already written the
 * fix in a comment: route-aware scope belongs in the workspace kernel. Scope is
 * six independent facts, and a page states the ones that are true of it.
 *
 * **A page with no backend must say so, in its own words.** The alternative is
 * a tab that looks like a capability, which canon v5.2 §10 forbids and which is
 * how a preview becomes a promise. Every surface below either works or names
 * the exact thing that is missing — not "coming soon", the blocker.
 */

/** What kind of ground a page stands on. Never a single global label. */
export type SurfaceScope = {
  /** Whose data this reads. */
  provider?: string;
  /** The chain an *action* targets. Absent when no action is in scope. */
  actionChain?: string;
  /** The chain a wallet would sign on. Absent when nothing signs here. */
  walletChain?: string;
  /** Where value would settle. Absent when nothing settles here. */
  settlementRail?: string;
  /** What the page can do at all. */
  mode: "READ ONLY" | "PREVIEW" | "SAMPLE" | "NO DATA";
};

export type SurfaceState = "WORKING" | "READ ONLY" | "BUILDING" | "PLANNED";

export type WorkspaceSurface = {
  id: string;
  href: string;
  /** The page's `<h1>`. Unique across the workspace — asserted by a test. */
  heading: string;
  /** The browser tab title, without the brand suffix. */
  title: string;
  lede: string;
  state: SurfaceState;
  scope: SurfaceScope;
  /** Registry ids whose truth this page depends on. */
  capabilities?: readonly ProductCapabilityId[];
  /** What a person can actually do here today. Empty when the answer is nothing. */
  works: readonly string[];
  /** The precise reason this is not more than it is. */
  blocker?: string;
  /** Where to go instead, inside the workspace. */
  insteadHref?: string;
  insteadLabel?: string;
};

/**
 * The scope shared by every surface that only reads Agentverse.
 *
 * Named once because repeating it is how the Passport ended up wearing a chain
 * label in the first place.
 */
const AGENTVERSE_SCOPE: SurfaceScope = { provider: "Agentverse", mode: "READ ONLY" };

export const WORKSPACE_SURFACES: readonly WorkspaceSurface[] = [
  {
    id: "actions",
    href: "/agents/workspace/actions",
    heading: "Actions",
    title: "Actions",
    lede:
      "Every economic action an agent has proposed, with the policy verdict, the human decision and the observed outcome beside it.",
    /* Phase 2B made this a real screen. It renders its own view rather than the
       shared placeholder, so the manifest entry now describes what it does and
       where it still stops. */
    state: "BUILDING",
    scope: { actionChain: "Base Sepolia", mode: "SAMPLE" },
    works: [
      "Every artifact the Lab produces becomes an Action Case, and the list and the inspector are two views of the same one.",
      "The Golden RWA case also carries one typed sample owner policy and budget exposure: required evidence, PER_ACTION authorization and RESERVED / COMMITTED value are derived from the same case.",
    ],
    blocker:
      "The list is tab-local and the owner policy is sample data. There is no authenticated owner policy service, durable Action Case queue, shareable case record or revocable technical authority behind this surface.",
    insteadHref: "/agents/workspace/lab",
    insteadLabel: "Compose one action in the Lab",
  },
  {
    id: "reviews",
    href: "/agents/workspace/reviews",
    heading: "Reviews",
    title: "Reviews",
    lede:
      "Actions waiting on a person: what is being approved, what is not, and what invalidates the approval.",
    state: "PLANNED",
    scope: { mode: "NO DATA" },
    works: [],
    blocker:
      "There is no authenticated approval workflow and no queue to hold a pending action. The Lab records a local demo acknowledgement only, and /agents/workspace/authorize signs an artifact in your own wallet without that signature becoming a product authorization.",
    insteadHref: "/agents/workspace/authorize",
    insteadLabel: "Open the wallet signature experiment",
  },
  {
    id: "agents",
    href: "/agents/workspace/agents",
    heading: "Agent Radar",
    title: "Agent Radar",
    lede:
      "Exact-address Agent Passports kept together in this tab, with claimed and observed evidence compared per capability.",
    state: "READ ONLY",
    scope: AGENTVERSE_SCOPE,
    capabilities: ["agentverse-public-passport"],
    works: [
      "A successfully parsed exact-address Passport enters the tab-local evidence directory and can be filtered by source gaps, conflicts and unknowns.",
      "Each capability keeps provider declaration, Ryntra observation, authority, freshness and verification method separate.",
    ],
    blocker:
      "There is no discovery service, durable fleet or server record. Reload keeps this tab's bounded directory; a new tab starts empty. Every Passport remains a point-in-time public read.",
    insteadHref: "/agents/workspace/passport",
    insteadLabel: "Inspect one agent",
  },
  {
    id: "policies",
    href: "/agents/workspace/policies",
    heading: "Mandates and policies",
    title: "Mandates and policies",
    lede:
      "The versioned rules an action is judged against: scope, budgets, velocity, evidence freshness and who must approve.",
    state: "BUILDING",
    scope: { actionChain: "Base Sepolia", mode: "SAMPLE" },
    capabilities: ["agent-control-preflight"],
    works: [
      "One strict owner policy, immutable mandate, action-class evidence profile and reconciled budget ledger are projected over the selected Golden RWA Action Case.",
      "PER_ACTION is the default; BOUNDED_MANDATE fails closed without an active, exact-path, non-observe and explicitly revocable technical binding.",
      "Pending RESERVED value and escrowed COMMITTED value both reduce AVAILABLE before the next action is reviewed.",
    ],
    blocker:
      "This is a read-only sample projection. No authenticated owner store, policy editor, wallet/provider policy push or technical authority binding exists, so the sample remains PER_ACTION and OBSERVE_ONLY.",
    insteadHref: "/agents/workspace/lab",
    insteadLabel: "See the policy decide in the Lab",
  },
  {
    id: "evidence",
    href: "/agents/workspace/evidence",
    heading: "Evidence and receipts",
    title: "Evidence and receipts",
    lede:
      "Six different artifacts, kept apart on purpose: Action Passport Preview, authorization record, provider execution evidence, payment evidence, Outcome Receipt and recovery evidence.",
    state: "BUILDING",
    scope: { mode: "PREVIEW" },
    capabilities: ["agent-decision-passport-preview"],
    works: [
      "An Action Passport Preview can be recomputed and its canonical hashes checked, with the three proof axes reported separately.",
    ],
    blocker:
      "No finalized Outcome Receipt exists. A preview that states OUTCOME_NOT_OBSERVED is a preview, and calling it a receipt is the exact claim canon v5.2 forbids. A receipt needs an observed external effect, which needs execution.",
    insteadHref: "/agents/workspace/verify",
    insteadLabel: "Verify a preview",
  },
  {
    id: "integrations",
    href: "/agents/workspace/integrations",
    heading: "Adapter projections",
    title: "Adapter projections",
    lede:
      "Solana and Stellar as two bounded readings of one action identity, with capability facts kept independent.",
    state: "READ ONLY",
    scope: { mode: "READ ONLY" },
    works: [
      "One strict projection kernel gives Agent Control and each ecosystem surface the same immutable action identity object.",
      "Solana and Stellar expose their unequal current evidence with provider capability, Ryntra maturity, route capability and user eligibility kept separate.",
    ],
    blocker:
      "No current adapter has a complete shared Agent Control identity. Solana has no executed action or Receipt; Stellar receipts carry no Agent Control actionId or policyVersion.",
  },
  {
    id: "commerce",
    href: "/agents/workspace/commerce",
    heading: "Jobs and payments",
    title: "Jobs and payments",
    lede:
      "One 402 engine, four independent adapter axes, and a payment outcome kept separate from a service outcome.",
    state: "READ ONLY",
    scope: { mode: "READ ONLY" },
    works: [
      "Every method × facilitator combination for a chosen implementation, network and asset is resolved by the real engine, and each refusal names whether the provider cannot or the owner will not.",
      "Two systems that both ship as B402 on one chain produce two receipts that disagree about the operator and about what the evidence is worth.",
      "ERC-8004 and ERC-8183 are mirrored behind a pinned content digest: a reputation entry has no score, and a completed job promotes nothing.",
    ],
    blocker:
      "Nine of two hundred and eight candidate routes are declarable and none is reachable. Ryntra holds no facilitator credential, no signer and no key, no facilitator was called and no chain was read, so every sample receipt rests on a report that does not exist yet.",
    insteadHref: "/agents/workspace/integrations",
    insteadLabel: "See the adapter projections",
  },
  {
    id: "tools",
    href: "/agents/workspace/tools",
    heading: "Agent tools",
    title: "Agent tools",
    lede:
      "Twelve local MCP tools, five of which write — and one effect between all five, so a write can only ever produce a proposal.",
    state: "READ ONLY",
    scope: { mode: "READ ONLY" },
    works: [
      "Every refusal on this page is a real gate call at render time, in the order the gate makes them: an authority-shaped field is refused before the tool is even looked up.",
      "Nine A2A 1.0.0 task states each show what they become, and completed becomes a record of a completed task rather than a Receipt.",
      "What a caller proved and what the owner decided are two axes with no function between them, drawn as a grid where moving down a column changes nothing.",
    ],
    blocker:
      "The proposal ledger lives in the MCP server process, so stopping it loses every proposal and there is no durable queue behind it. Nothing here can authorize: AUTHORIZE is closed by a person elsewhere, and this surface cannot reach it. No Agent Card signature is checked and no outbound A2A call is made.",
    insteadHref: "/agents/workspace/actions",
    insteadLabel: "See Action Cases",
  },
  {
    id: "adoption",
    href: "/agents/workspace/adoption",
    heading: "External adoption",
    title: "External adoption",
    lede:
      "API keys, tenancy and durable quotas, and an OAuth-protected MCP endpoint an outside agent can reach without a person handing it anything.",
    state: "READ ONLY",
    scope: { mode: "READ ONLY" },
    works: [
      "Every cell of the scope matrix is a real gate call made while the page renders, so this surface cannot disagree with the server about who is refused.",
      "The hosted endpoint serves a strict subset of the local inventory, and the four tools it withholds are named with the reason: each would make Ryntra fetch on a stranger's behalf.",
      "A quota is counted in the configured durable store rather than per process, so two instances share one window and a cold start does not hand it back.",
    ],
    blocker:
      "No tenant or key can be created from any screen: issuing one is a deliberate act with no self-service path, and there is no billing, plan or invoice behind a quota. A proposal made through the hosted endpoint lives in the instance that accepted it; only its receipt is durable. Counters are per warm instance and no fleet total is computed.",
    insteadHref: "/agents/workspace/tools",
    insteadLabel: "See the local tool inventory",
  },
  {
    id: "operations",
    href: "/agents/workspace/operations",
    heading: "Operations",
    title: "Operations",
    lede:
      "What this instance answered and refused, beside the boundary each count stops at — and the list of what is deliberately not counted.",
    state: "READ ONLY",
    scope: { mode: "READ ONLY" },
    works: [
      "Requests, refusals and the refusal breakdown come from the same observer every Agent Control route writes to, so the page cannot disagree with the server.",
      "A measured count and a catalogue size are separate kinds with separate panels, and the helper that would total them throws when the kinds are mixed.",
      "The mainnet promotion perimeter is computed capability by capability, so no capability is promoted because another one ran.",
    ],
    blocker:
      "Every counter belongs to the warm instance that answered the request. A cold start restarts the count, two instances keep two, and no fleet total is computed. There is no availability figure, no uptime, no per-tenant attribution and no history: the numbers begin when the process woke.",
    insteadHref: "/agents/workspace/adoption",
    insteadLabel: "See what the hosted endpoint serves",
  },
  {
    id: "attention",
    href: "/agents/workspace/attention",
    heading: "Attention and recovery",
    title: "Attention and recovery",
    lede:
      "What is waiting on a person, in the order a declared table puts it, with the exact step that clears it and who can take it.",
    state: "READ ONLY",
    scope: { mode: "READ ONLY" },
    works: [
      "Rank is the index of a frozen category table and there is no importance number anywhere on a record.",
      "Every row names its recovery actor, and a row nobody can act on names the record that would change that.",
      "An empty queue lists what was checked, so a calm state cannot be mistaken for a failed load.",
    ],
    blocker:
      "Nothing on this surface acts: every recovery step is taken elsewhere, by the actor the row names. Proposals are not counted here because the ledger lives in the MCP server process and no rendering surface can read it, and there is no notification, escalation or channel — this queue is looked at, never delivered.",
    insteadHref: "/agents/workspace/operations",
    insteadLabel: "See the operations counters",
  },
  {
    id: "team",
    href: "/agents/workspace/team",
    heading: "Team",
    title: "Team",
    lede:
      "Who can reach this tenant, holding which scopes, under which window — read from the tenancy the product keeps, and issued from nowhere.",
    state: "READ ONLY",
    scope: { mode: "READ ONLY" },
    works: [
      "The scope rows are real gate calls made while the page renders, and the record fields are read off the real schemas rather than restated.",
      "Six lifecycle steps state which are self-service and which are done by hand, so the absence of a key button is a fact rather than a gap.",
      "A key's secret is never persisted — only its SHA-256 — and the field that holds it is marked as never rendered.",
    ],
    blocker:
      "No key can be created, rotated or revoked from this or any other screen. There is no per-member identity: a key names a tenant rather than a person, so this cannot show who inside a team did what. There is no billing, plan, invoice or price behind a quota.",
    insteadHref: "/agents/workspace/adoption",
    insteadLabel: "See the scope matrix",
  },
  {
    id: "settings",
    href: "/agents/workspace/settings",
    heading: "Workspace settings",
    title: "Workspace settings",
    lede: "How this workspace is configured, and where each setting actually takes effect.",
    state: "BUILDING",
    scope: { mode: "READ ONLY" },
    works: [
      /* Appearance holds exactly theme and language; density and panels are
         per-workspace in the rail's layout menu (customize.tsx says why). The
         previous sentence claimed all three lived in Appearance product-wide,
         which was false twice. */
      "Appearance — Dark / Light and language — is product-wide in Settings. Density and layout are per-workspace, in the rail's layout menu.",
    ],
    blocker:
      "Agent Control has no workspace-scoped settings of its own yet: no connections, no networks, no API keys, no webhooks. Each of those needs the thing it configures to exist first.",
  },
];

const BY_ID = new Map(WORKSPACE_SURFACES.map((surface) => [surface.id, surface]));

/**
 * Ukrainian overlay for the registry above.
 *
 * English stays canonical — the uniqueness and truth tests read it — and the
 * overlay carries the same sentences in the workspace's second language. A
 * field absent here falls back to English rather than to silence, so a new
 * surface is never blank in one locale while the translation catches up.
 */
type SurfaceOverlay = Partial<
  Pick<WorkspaceSurface, "heading" | "title" | "lede" | "works" | "blocker" | "insteadLabel">
>;

const SURFACE_UK: Readonly<Record<string, SurfaceOverlay>> = {
  actions: {
    heading: "Дії",
    title: "Дії",
    lede:
      "Кожна економічна дія, яку запропонував агент, а поруч — вердикт політики, рішення людини і спостережений результат.",
    works: [
      "Кожен артефакт, створений у Лабораторії, стає Action Case, а список та інспектор — два подання того самого кейса.",
      "Кейс Golden RWA також несе одну типізовану зразкову політику власника і бюджетну експозицію: необхідні докази, авторизація PER_ACTION і вартість RESERVED / COMMITTED виводяться з того самого кейса.",
    ],
    blocker:
      "Список локальний для вкладки, а політика власника — зразкові дані. За цією поверхнею немає автентифікованого сервісу політик власника, стійкої черги Action Case, кейс-запису, яким можна поділитися, чи відкличних технічних повноважень.",
    insteadLabel: "Зібрати одну дію в Лабораторії",
  },
  reviews: {
    heading: "Перегляди",
    title: "Перегляди",
    lede:
      "Дії, що чекають на людину: що саме схвалюється, що ні, і що робить схвалення недійсним.",
    blocker:
      "Немає автентифікованого процесу схвалення і черги, яка тримала б дію в очікуванні. Лабораторія фіксує лише локальне демо-підтвердження, а /agents/workspace/authorize підписує артефакт у вашому власному гаманці, і цей підпис не стає продуктовою авторизацією.",
    insteadLabel: "Відкрити експеримент із підписом у гаманці",
  },
  agents: {
    heading: "Радар агентів",
    title: "Радар агентів",
    lede:
      "Agent Passport за точними адресами, зібрані разом у цій вкладці, з порівнянням заявлених і спостережених доказів за кожною можливістю.",
    works: [
      "Успішно розібраний Passport за точною адресою потрапляє в локальний для вкладки каталог доказів, який можна фільтрувати за прогалинами джерел, конфліктами і невідомими.",
      "Кожна можливість тримає окремо декларацію провайдера, спостереження Ryntra, повноваження, свіжість і метод перевірки.",
    ],
    blocker:
      "Немає сервісу виявлення, стійкого парку агентів чи серверного запису. Перезавантаження зберігає обмежений каталог цієї вкладки; нова вкладка починає порожньою. Кожен Passport лишається публічним читанням на момент часу.",
    insteadLabel: "Оглянути одного агента",
  },
  policies: {
    heading: "Мандати і політики",
    title: "Мандати і політики",
    lede:
      "Версіоновані правила, за якими оцінюється дія: обсяг, бюджети, швидкість витрат, свіжість доказів і хто має схвалити.",
    works: [
      "Одна строга політика власника, незмінний мандат, профіль доказів для класу дій і звірений бюджетний леджер спроєктовані на обраний Action Case Golden RWA.",
      "PER_ACTION — типовий режим; без активної технічної привʼязки — з точним шляхом, не лише спостережної та явно відкличної — BOUNDED_MANDATE зачиняється відмовою.",
      "Вартість RESERVED в очікуванні та вартість COMMITTED в ескроу обидві зменшують AVAILABLE ще до перегляду наступної дії.",
    ],
    blocker:
      "Це зразкова проєкція лише для читання. Не існує автентифікованого сховища власника, редактора політик, доставлення політики в гаманець чи провайдеру або привʼязки технічних повноважень, тому зразок лишається PER_ACTION і OBSERVE_ONLY.",
    insteadLabel: "Побачити рішення політики в Лабораторії",
  },
  evidence: {
    heading: "Докази і квитанції",
    title: "Докази і квитанції",
    lede:
      "Шість різних артефактів, навмисно розділених: превʼю Action Passport, запис авторизації, докази виконання від провайдера, докази платежу, квитанція результату (Outcome Receipt) і докази відновлення.",
    works: [
      "Превʼю Action Passport можна переобчислити й перевірити його канонічні хеші; три осі доказу звітуються окремо.",
    ],
    blocker:
      "Фіналізованої квитанції результату не існує. Превʼю зі статусом OUTCOME_NOT_OBSERVED — це превʼю, і назвати його квитанцією — саме те твердження, яке забороняє канон v5.2. Квитанції потрібен спостережений зовнішній ефект, а для нього — виконання.",
    insteadLabel: "Перевірити превʼю",
  },
  integrations: {
    heading: "Проєкції адаптерів",
    title: "Проєкції адаптерів",
    lede:
      "Solana і Stellar як два обмежені прочитання однієї ідентичності дії, з незалежними фактами можливостей.",
    works: [
      "Одне строге ядро проєкції дає Agent Control і кожній екосистемній поверхні той самий незмінний обʼєкт ідентичності дії.",
      "Solana і Stellar показують свої нерівні поточні докази, тримаючи окремо можливість провайдера, зрілість Ryntra, можливість маршруту і придатність користувача.",
    ],
    blocker:
      "Жоден поточний адаптер не має повної спільної ідентичності Agent Control. У Solana немає виконаної дії чи квитанції; квитанції Stellar не несуть actionId чи policyVersion Agent Control.",
  },
  commerce: {
    heading: "Завдання і платежі",
    title: "Завдання і платежі",
    lede:
      "Один рушій 402, чотири незалежні осі адаптерів, і результат платежу окремо від результату послуги.",
    works: [
      "Кожну комбінацію метод × фасилітатор для обраної реалізації, мережі й активу розвʼязує справжній рушій, і кожна відмова називає, чи то провайдер не може, чи власник не дозволяє.",
      "Дві системи, які обидві постачаються як B402 в одному ланцюзі, видають дві квитанції, що розходяться щодо оператора і щодо цінності доказів.",
      "ERC-8004 і ERC-8183 віддзеркалені за закріпленим дайджестом вмісту: запис репутації не має балу, а завершене завдання нічого не підвищує.",
    ],
    blocker:
      "Девʼять із двохсот восьми маршрутів-кандидатів можна задекларувати, і жоден не досяжний. Ryntra не тримає облікових даних фасилітатора, підписанта чи ключа, жодного фасилітатора не викликано і жоден ланцюг не читано, тож кожна зразкова квитанція спирається на звіт, якого ще не існує.",
    insteadLabel: "Переглянути проєкції адаптерів",
  },
  tools: {
    heading: "Інструменти агента",
    title: "Інструменти агента",
    lede:
      "Дванадцять локальних інструментів MCP, пʼять із яких пишуть — і один ефект на всі пʼять, тож запис може створити лише пропозицію.",
    works: [
      "Кожна відмова на цій сторінці — справжній виклик гейта під час рендеру, в тому порядку, в якому гейт їх робить: поле, схоже на повноваження, відхиляється ще до пошуку інструмента.",
      "Девʼять станів задач A2A 1.0.0 показують, чим кожен стає, і completed стає записом про завершену задачу, а не квитанцією.",
      "Що довів викликач і що вирішив власник — дві осі без функції між ними, намальовані як сітка, де рух униз колонкою нічого не змінює.",
    ],
    blocker:
      "Леджер пропозицій живе в процесі сервера MCP, тож його зупинка втрачає всі пропозиції, і стійкої черги за ним немає. Ніщо тут не може авторизувати: AUTHORIZE закриває людина в іншому місці, і ця поверхня туди не дістає. Підпис Agent Card не перевіряється, і жоден вихідний виклик A2A не робиться.",
    insteadLabel: "Переглянути Action Case",
  },
  adoption: {
    heading: "Зовнішнє впровадження",
    title: "Зовнішнє впровадження",
    lede:
      "API-ключі, тенантність і стійкі квоти, а також захищений OAuth ендпоїнт MCP, до якого зовнішній агент дістається без того, щоб людина щось йому передавала.",
    works: [
      "Кожна клітинка матриці скоупів — справжній виклик гейта під час рендеру сторінки, тож ця поверхня не може розійтися з сервером у тому, кому відмовлено.",
      "Хостований ендпоїнт віддає строгу підмножину локального інвентаря, а чотири інструменти, які він не віддає, названі разом із причиною: кожен змушував би Ryntra робити запити від імені незнайомця.",
      "Квота рахується в налаштованому стійкому сховищі, а не в кожному процесі, тож два інстанси ділять одне вікно, і холодний старт її не повертає.",
    ],
    blocker:
      "Жодного тенанта чи ключа не можна створити з жодного екрана: видача — свідомий акт без шляху самообслуговування, і за квотою немає білінгу, плану чи рахунка. Пропозиція, зроблена через хостований ендпоїнт, живе в інстансі, який її прийняв; стійкою є лише її квитанція. Лічильники — на кожен прогрітий інстанс, і сумарний показник по всіх не обчислюється.",
    insteadLabel: "Переглянути локальний інвентар інструментів",
  },
  operations: {
    heading: "Операції",
    title: "Операції",
    lede:
      "Що цей інстанс відповів і в чому відмовив, поруч із межею, на якій зупиняється кожен лічильник, — і список того, що навмисно не рахується.",
    works: [
      "Запити, відмови і розбивка відмов ідуть від того самого спостерігача, в який пише кожен маршрут Agent Control, тож сторінка не може розійтися з сервером.",
      "Виміряний лічильник і розмір каталогу — окремі типи з окремими панелями, а хелпер, який мав би їх додати, кидає помилку, коли типи змішано.",
      "Периметр промоції в mainnet обчислюється можливість за можливістю, тож жодна можливість не підвищується через те, що спрацювала інша.",
    ],
    blocker:
      "Кожен лічильник належить прогрітому інстансу, який відповів на запит. Холодний старт починає лік заново, два інстанси тримають два, і сумарний показник по всіх не обчислюється. Немає показника доступності, немає uptime, немає атрибуції за тенантами і немає історії: числа починаються з моменту, коли процес прокинувся.",
    insteadLabel: "Переглянути, що віддає хостований ендпоїнт",
  },
  attention: {
    heading: "Увага і відновлення",
    title: "Увага і відновлення",
    lede:
      "Що чекає на людину, в порядку, який задає оголошена таблиця, з точним кроком, який це знімає, і тим, хто може цей крок зробити.",
    works: [
      "Ранг — це індекс у замороженій таблиці категорій, і на записі ніде немає числа важливості.",
      "Кожен рядок називає свого виконавця відновлення, а рядок, з яким ніхто не може діяти, називає запис, який би це змінив.",
      "Порожня черга перелічує, що було перевірено, тож спокійний стан не сплутати з невдалим завантаженням.",
    ],
    blocker:
      "Ніщо на цій поверхні не діє: кожен крок відновлення робиться в іншому місці, тим виконавцем, якого називає рядок. Пропозиції тут не рахуються, бо леджер живе в процесі сервера MCP і жодна поверхня рендеру не може його прочитати, і немає сповіщень, ескалації чи каналу — на цю чергу дивляться, її ніколи не доставляють.",
    insteadLabel: "Переглянути операційні лічильники",
  },
  team: {
    heading: "Команда",
    title: "Команда",
    lede:
      "Хто може дістатися цього тенанта, з якими скоупами і в якому вікні — прочитано з тенантності, яку веде продукт, і не видано з жодного екрана.",
    works: [
      "Рядки скоупів — справжні виклики гейта під час рендеру сторінки, а поля записів прочитані зі справжніх схем, а не переказані.",
      "Шість кроків життєвого циклу вказують, які з них самообслуговування, а які робляться вручну, тож відсутність кнопки ключа — це факт, а не прогалина.",
      "Секрет ключа ніколи не зберігається — лише його SHA-256 — а поле, що його тримає, позначене як таке, що ніколи не рендериться.",
    ],
    blocker:
      "Жоден ключ не можна створити, ротувати чи відкликати з цього або будь-якого іншого екрана. Немає ідентичності окремого учасника: ключ називає тенанта, а не людину, тож тут не видно, хто саме в команді що зробив. За квотою немає білінгу, плану, рахунка чи ціни.",
    insteadLabel: "Переглянути матрицю скоупів",
  },
  settings: {
    heading: "Налаштування робочого простору",
    title: "Налаштування робочого простору",
    lede: "Як налаштований цей робочий простір і де кожне налаштування насправді діє.",
    works: [
      "Вигляд — Темна / Світла і мова — спільний для всього продукту в Налаштуваннях. Щільність і макет — на кожен робочий простір, у меню макета в рейці.",
    ],
    blocker:
      "В Agent Control ще немає власних налаштувань рівня робочого простору: ні підключень, ні мереж, ні API-ключів, ні вебхуків. Для кожного з них спершу має існувати те, що воно налаштовує.",
  },
};

export function workspaceSurface(id: string, locale: WorkspaceLocale = "en"): WorkspaceSurface {
  const surface = BY_ID.get(id);
  if (!surface) throw new Error(`Unknown workspace surface: ${id}`);
  if (locale === "uk") {
    const overlay = SURFACE_UK[id];
    if (overlay) return { ...surface, ...overlay };
  }
  return surface;
}

/**
 * The scope chip for a pathname, or `null` when the page should show none.
 *
 * `null` is a real answer and the reason this function exists. The verifier
 * touches no network; a chip there would be decoration that reads as a fact.
 */
export function scopeForPath(pathname: string, locale: WorkspaceLocale = "en"): string | null {
  const surface = WORKSPACE_SURFACES.find((item) => pathname === item.href);
  if (surface) return formatScope(surface.scope, locale);

  if (pathname === "/agents/workspace") {
    return locale === "uk" ? "ПРЕВʼЮ ДЖЕРЕЛА · БЕЗ ВИКОНАННЯ" : "SOURCE PREVIEW · NO EXECUTION";
  }
  if (pathname.startsWith("/agents/workspace/passport")) return formatScope(AGENTVERSE_SCOPE, locale);
  if (pathname.startsWith("/agents/workspace/actions/")) {
    return locale === "uk" ? "BASE SEPOLIA · ЗРАЗОК" : "BASE SEPOLIA · SAMPLE";
  }
  if (pathname.startsWith("/agents/workspace/lab")) {
    return formatScope({ provider: locale === "uk" ? "Локально" : "Local", actionChain: "BNB Testnet", mode: "SAMPLE" }, locale);
  }
  if (pathname.startsWith("/agents/workspace/authorize")) {
    return formatScope({ walletChain: "BNB Testnet", mode: "PREVIEW" }, locale);
  }
  /* The verifier recomputes hashes over pasted JSON. No provider, no chain,
     no rail — so no chip, rather than a chip that has to be explained. */
  if (pathname.startsWith("/agents/workspace/verify")) return null;
  return null;
}

/*
 * The mode words the chip prints. Chain and provider names stay as they are —
 * `Base Sepolia` is a proper name — but READ ONLY is a sentence about the
 * page, and a sentence follows the workspace language.
 */
const SCOPE_MODE_UK: Readonly<Record<SurfaceScope["mode"], string>> = {
  "READ ONLY": "ЛИШЕ ЧИТАННЯ",
  PREVIEW: "ПРЕВʼЮ",
  SAMPLE: "ЗРАЗОК",
  "NO DATA": "НЕМАЄ ДАНИХ",
};

function formatScope(scope: SurfaceScope, locale: WorkspaceLocale = "en"): string {
  const mode = locale === "uk" ? SCOPE_MODE_UK[scope.mode] : scope.mode;
  return [scope.provider, scope.actionChain, scope.walletChain, scope.settlementRail, mode]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();
}
