import { isPublicLocale, type PublicLocale } from "./locale.ts";

/**
 * Typed public copy for chrome and the five-scene homepage.
 *
 * Both locales must carry the same keys. `public-copy.test.mjs` fails the
 * build if a key exists in only one language or if a placeholder set drifts.
 */

type Copy = Readonly<{
  skip: string;
  brandHome: string;
  navHome: string;
  /* The header carries the site's one menu from `HOMEPAGE_COPY` (the
     landing's five ways in and *Open Ryntra*, on every public page); the
     words here are the bar's controls and the footer. `navHome` and
     `navEcosystems` survive for the footer and for the ecosystem surfaces
     that still exist; neither is in the primary header any more. */
  navBusiness: string;
  /* The header word, which is not the product's name. `navAgents` stays
     `Agent Control` in both locales because a product name is not translated,
     and the parity guard pins it for exactly that reason. */
  navForAgents: string;
  navProductMap: string;
  /* Scene 2, which shows the product instead of the cabinet. */
  productEyebrow: string;
  productHeadline: string;
  productLead: string;
  productShotAlt: string;
  productMore: string;
  heroShotAlt: string;
  navAgents: string;
  navEcosystems: string;
  navDevelopers: string;
  navOpen: string;
  langSwitch: string;
  themeDark: string;
  themeLight: string;
  themeSwitch: string;
  menuOpen: string;
  menuClose: string;
  /* The footer's words — the five ways in, the two accounts, the legal pair
     and the year — live with the menu's in `HOMEPAGE_COPY.footer` (one footer
     on every page); nothing here names a footer link. */
  ecoOpen: string;
  ecoEnvironment: string;
  ecoMaturity: string;
  heroEyebrow: string;
  heroLine1: string;
  heroLine2: string;
  heroLine3: string;
  heroSupport: string;
  chipNonCustodial: string;
  chipHuman: string;
  chipEvidence: string;
  homeName: string;
  homeBlurb: string;
  homeCta: string;
  agentsName: string;
  agentsBlurb: string;
  agentsCta: string;
  sample: string;
  compositionAttention: string;
  compositionCoverage: string;
  compositionProposal: string;
  compositionVerdict: string;
  compositionReceipt: string;
  compositionVerdictValue: string;
  compositionReceiptValue: string;
  heroAttn1: string;
  heroAttn1Tag: string;
  heroAttn2: string;
  heroAttn2Tag: string;
  heroCoverageNote: string;
  heroProposalText: string;
  heroReceiptMeta: string;
  heroPortfolioLabel: string;
  heroAttnShort1: string;
  heroAttnShort2: string;
  heroRynAsk: string;
  heroEvidenceLabel: string;
  heroRiskLabel: string;
  heroRiskState: string;
  heroPolicyLabel: string;
  heroAgentLabel: string;
  heroAgentName: string;
  heroStepProposal: string;
  heroStepReview: string;
  heroStepAuth: string;
  heroOutcome: string;
  heroReceiptWord: string;
  heroSceneTag: string;
  heroCtaHomeNote: string;
  heroCtaAgentsNote: string;
  homeEyebrow: string;
  homeHeadline: string;
  homeLead: string;
  homePortfolio: string;
  homePortfolioBody: string;
  homeStrategies: string;
  homeStrategiesBody: string;
  homeRyn: string;
  homeRynBody: string;
  homeDemo: string;
  homeTabsLabel: string;
  homeCoverageValued: string;
  homeCoverageUnpriced: string;
  homeCoverageHidden: string;
  homeExposureLabel: string;
  homeMeterEquities: string;
  homeMeterStables: string;
  homeMeterOther: string;
  homeAttn3: string;
  homeAttn3Tag: string;
  homeAttn4: string;
  homeAttn4Tag: string;
  homeReviewCta: string;
  homeStratName: string;
  homeStratPaper: string;
  homeStratVersion: string;
  homeStratReview: string;
  homeStratRecommended: string;
  homeStratScenarioA: string;
  homeStratScenarioB: string;
  homeStratOutcome: string;
  homeStratDrawdown: string;
  homeRynYou: string;
  homeRynQuestion: string;
  homeRynFacts: string;
  homeRynFactsBody: string;
  homeRynRisk: string;
  homeRynRiskBody: string;
  homeRynNext: string;
  homeRynNextBody: string;
  homeRynDecision: string;
  homeRynDecisionBody: string;
  homeOpen: string;
  agentsEyebrow: string;
  agentsHeadline: string;
  agentsLead: string;
  agentsLaw: string;
  agentsDemo: string;
  agentsOpen: string;
  flowEyebrow: string;
  flowSteps: readonly string[];
  flowNotes: readonly string[];
  flowLabel: string;
  ctaLine1: string;
  ctaLine2: string;
  ctaLine3: string;
  ctaOpen: string;
  maturity: Readonly<Record<string, string>>;
}>;

export const PUBLIC_COPY: Readonly<Record<PublicLocale, Copy>> = {
  en: {
    skip: "Skip to content",
    brandHome: "Ryntra home",
    navHome: "Ryntra Home",
    navBusiness: "For business",
    navForAgents: "For agents",
    navProductMap: "Product Map",
    productEyebrow: "THE PRODUCT",
    productHeadline: "Eleven pages, one wallet, one network.",
    productLead:
      "Trade, Strategies, Money and Manage — on Solana Mainnet, with your own wallet and no account to create.",
    productShotAlt: "Ryntra Markets: what each issuer can still do to your balance, beside today's price",
    productMore: "See what opens with no wallet",
    heroShotAlt: "Ryntra Swap: a live SOL to USDC quote with its route, price impact and the minimum received",
    navAgents: "Agent Control",
    navEcosystems: "Ecosystems",
    navDevelopers: "Developers",
    navOpen: "Open Ryntra",
    langSwitch: "Language",
    themeDark: "Dark",
    themeLight: "Light",
    themeSwitch: "Theme",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    ecoOpen: "Open workspace",
    ecoEnvironment: "Environment",
    ecoMaturity: "Maturity",
    heroEyebrow: "ONE PRODUCT ON SOLANA",
    heroLine1: "Your money, markets",
    heroLine2: "and AI agents.",
    heroLine3: "One product on Solana.",
    heroSupport:
      "Hold, swap, send, receive and move between networks from your own wallet. AI can prepare an action; you keep control.",
    chipNonCustodial: "Non-custodial",
    chipHuman: "Human-authorized",
    chipEvidence: "Evidence-backed",
    homeName: "RYNTRA HOME",
    homeBlurb: "Portfolio, research, strategies and your AI financial assistant.",
    homeCta: "Open Home",
    agentsName: "AGENT CONTROL",
    agentsBlurb: "Agents, mandates, approvals, limits and outcome receipts.",
    agentsCta: "Open Agent Control",
    sample: "Illustrative",
    compositionAttention: "Needs attention",
    compositionCoverage: "Portfolio coverage",
    compositionProposal: "Agent proposal",
    compositionVerdict: "Risk / policy verdict",
    compositionReceipt: "Verified receipt",
    compositionVerdictValue: "Review",
    compositionReceiptValue: "Verified",
    heroAttn1: "Concentration above policy in one asset",
    heroAttn1Tag: "RISK",
    heroAttn2: "Stablecoin peg deviation on watch",
    heroAttn2Tag: "MARKET",
    heroCoverageNote: "4 assets unpriced",
    heroProposalText: "Rebalance 5% into stablecoins",
    heroReceiptMeta: "Expected vs actual · matched",
    heroPortfolioLabel: "Portfolio",
    heroAttnShort1: "Concentration risk",
    heroAttnShort2: "Liquidity watch",
    heroRynAsk: "Reduce exposure by 5%?",
    heroEvidenceLabel: "Evidence",
    heroRiskLabel: "Risk",
    heroRiskState: "Elevated",
    heroPolicyLabel: "Policy",
    heroAgentLabel: "Agent",
    heroAgentName: "Treasury Agent",
    heroStepProposal: "Proposal",
    heroStepReview: "Human review",
    heroStepAuth: "Authorization",
    heroOutcome: "Verified outcome",
    heroReceiptWord: "Receipt",
    heroSceneTag: "Product overview",
    heroCtaHomeNote: "No account. Your own wallet.",
    heroCtaAgentsNote: "Approvals, policies, outcomes",
    homeEyebrow: "RYNTRA HOME",
    homeHeadline: "What changed. What you control. What needs a decision.",
    homeLead: "One workspace to see what changed, what matters and what needs your decision.",
    homePortfolio: "Portfolio & Risk",
    homePortfolioBody: "Balances, exposure, concentration, liquidity, commitments and unknown data.",
    homeStrategies: "Strategies",
    homeStrategiesBody: "Formalize a strategy, compare scenarios, test it on paper and preserve its version.",
    homeRyn: "Ryntra assistant",
    homeRynBody: "Facts and sources, scenarios, a deterministic risk result, a suggested next step, then your decision.",
    homeDemo: "Interactive demo",
    homeTabsLabel: "Ryntra Home areas",
    homeCoverageValued: "96% valued",
    homeCoverageUnpriced: "4 unpriced",
    homeCoverageHidden: "2 private hidden",
    homeExposureLabel: "EXPOSURE",
    homeMeterEquities: "Tokenized equities",
    homeMeterStables: "Stablecoins",
    homeMeterOther: "Other assets",
    homeAttn3: "Agent mandate budget 80% used",
    homeAttn3Tag: "AGENT",
    homeAttn4: "2 assets with unknown data",
    homeAttn4Tag: "DATA",
    homeReviewCta: "Review in Home",
    homeStratName: "Stablecoin ladder — v3",
    homeStratPaper: "Paper-tested",
    homeStratVersion: "Version preserved",
    homeStratReview: "Review required",
    homeStratRecommended: "Recommended path",
    homeStratScenarioA: "Base case · steady rates",
    homeStratScenarioB: "Stress case · rate cut",
    homeStratOutcome: "Outcome",
    homeStratDrawdown: "Max drawdown",
    homeRynYou: "YOU",
    homeRynQuestion: "Should I extend the ladder by 5%?",
    homeRynFacts: "Facts & sources",
    homeRynFactsBody: "3 sources · reserve reports, rate curve, venue depth",
    homeRynRisk: "Deterministic risk result",
    homeRynRiskBody: "Within policy · concentration unchanged",
    homeRynNext: "Suggested next step",
    homeRynNextBody: "Extend on paper first, review in 7 days",
    homeRynDecision: "Your decision",
    homeRynDecisionBody: "Explicit approval — nothing executes on its own",
    homeOpen: "Open Ryntra Home",
    agentsEyebrow: "AGENT CONTROL",
    agentsHeadline: "Agent proposes. You authorize. Ryntra proves the outcome.",
    agentsLead: "Change one parameter and watch evidence, risk, policy, verdict and required approval move together.",
    agentsLaw: "Agent proposes. Ryntra verifies and governs. You authorize. The provider executes. Ryntra proves the outcome.",
    agentsDemo: "Interactive demo · Illustrative · No funds move",
    agentsOpen: "Open Agent Control",
    flowEyebrow: "HOW RYNTRA WORKS",
    flowSteps: [
      "Human or agent",
      "Evidence",
      "Strategy & risk",
      "Policy",
      "Authorization",
      "Connected rail",
      "Verified outcome",
    ],
    flowNotes: [
      "A person or a bounded agent starts an action.",
      "Facts and sources are collected first.",
      "The action is weighed against strategy and risk.",
      "Limits, mandates and allowed actions are checked before authorization.",
      "A human or a bounded mandate authorizes these exact bytes.",
      "Execution stays with the connected wallet, venue or provider.",
      "The actual result is observed and reconciled.",
    ],
    flowLabel: "The Ryntra decision loop",
    ctaLine1: "Understand what changed.",
    ctaLine2: "Control what can happen.",
    ctaLine3: "Verify what actually happened.",
    ctaOpen: "Open Ryntra",
    maturity: {
      live: "Available",
      testnet_verified: "Testnet verified",
      read_only: "Read-only",
      research: "Research",
    },
  },
  uk: {
    skip: "Перейти до змісту",
    brandHome: "Ryntra, головна",
    navHome: "Ryntra Home",
    navBusiness: "Для бізнесу",
    navForAgents: "Для агентів",
    navProductMap: "Карта продукту",
    productEyebrow: "ПРОДУКТ",
    productHeadline: "Одинадцять сторінок, один гаманець, одна мережа.",
    productLead:
      "Торгівля, Стратегії, Кошти й Керування — на Solana Mainnet, з твоїм власним гаманцем і без акаунта, який треба створювати.",
    productShotAlt: "Ринки Ryntra: що емітент ще може зробити з твоїм балансом, поруч із сьогоднішньою ціною",
    productMore: "Що відкривається без гаманця",
    heroShotAlt: "Обмін Ryntra: жива котировка SOL на USDC із маршрутом, впливом на ціну й мінімумом до отримання",
    navAgents: "Agent Control",
    navEcosystems: "Екосистеми",
    navDevelopers: "Розробникам",
    navOpen: "Відкрити Ryntra",
    langSwitch: "Мова",
    themeDark: "Темна",
    themeLight: "Світла",
    themeSwitch: "Тема",
    menuOpen: "Відкрити меню",
    menuClose: "Закрити меню",
    ecoOpen: "Відкрити workspace",
    ecoEnvironment: "Середовище",
    ecoMaturity: "Зрілість",
    heroEyebrow: "ОДИН ПРОДУКТ НА SOLANA",
    heroLine1: "Твої кошти, ринки",
    heroLine2: "й AI-агенти.",
    heroLine3: "Один продукт на Solana.",
    heroSupport:
      "Керуй активами, обмінюй, надсилай, отримуй і переноси кошти зі свого гаманця. AI може підготувати дію; ти зберігаєш контроль.",
    chipNonCustodial: "Без зберігання коштів Ryntra",
    chipHuman: "Авторизація людиною",
    chipEvidence: "Результати, підтверджені доказами",
    homeName: "RYNTRA HOME",
    homeBlurb: "Портфель, дослідження, стратегії та твій помічник Ryntra для фінансових рішень.",
    homeCta: "Відкрити Home",
    agentsName: "AGENT CONTROL",
    agentsBlurb: "Агенти, мандати, погодження, ліміти та квитанції результатів.",
    agentsCta: "Відкрити Agent Control",
    sample: "Ілюстративно",
    compositionAttention: "Потребує уваги",
    compositionCoverage: "Покриття портфеля",
    compositionProposal: "Пропозиція агента",
    compositionVerdict: "Вердикт ризику / політики",
    compositionReceipt: "Підтверджена квитанція",
    compositionVerdictValue: "Перегляд",
    compositionReceiptValue: "Підтверджено",
    heroAttn1: "Концентрація в одному активі понад політику",
    heroAttn1Tag: "РИЗИК",
    heroAttn2: "Відхилення прив’язки стейблкоїна на контролі",
    heroAttn2Tag: "РИНОК",
    heroCoverageNote: "4 активи без ціни",
    heroProposalText: "Ребаланс 5% у стейблкоїни",
    heroReceiptMeta: "Очікуване й фактичне · збігаються",
    heroPortfolioLabel: "Портфель",
    heroAttnShort1: "Ризик концентрації",
    heroAttnShort2: "Контроль ліквідності",
    heroRynAsk: "Зменшити експозицію на 5%?",
    heroEvidenceLabel: "Докази",
    heroRiskLabel: "Ризик",
    heroRiskState: "Підвищений",
    heroPolicyLabel: "Політика",
    heroAgentLabel: "Агент",
    heroAgentName: "Treasury-агент",
    heroStepProposal: "Пропозиція",
    heroStepReview: "Перегляд людиною",
    heroStepAuth: "Авторизація",
    heroOutcome: "Перевірений результат",
    heroReceiptWord: "Квитанція",
    heroSceneTag: "Огляд продукту",
    heroCtaHomeNote: "Без акаунта. Твій власний гаманець.",
    heroCtaAgentsNote: "Погодження, політики, результати",
    homeEyebrow: "RYNTRA HOME",
    homeHeadline: "Що змінилось. Що ти контролюєш. Яке рішення чекає.",
    homeLead: "Один робочий простір: бачити, що змінилося, що важливо і що потребує твого рішення.",
    homePortfolio: "Portfolio & Risk",
    homePortfolioBody: "Баланси, експозиція, концентрація, ліквідність, зобов’язання та невідомі дані.",
    homeStrategies: "Strategies",
    homeStrategiesBody: "Формалізуй стратегію, порівнюй сценарії, тестуй її в симуляції і зберігай версії.",
    homeRyn: "Помічник Ryntra",
    homeRynBody: "Факти й джерела, сценарії, детермінований ризик-результат, запропонований наступний крок, потім твоє рішення.",
    homeDemo: "Інтерактивна демонстрація",
    homeTabsLabel: "Розділи Ryntra Home",
    homeCoverageValued: "96% оцінено",
    homeCoverageUnpriced: "4 без ціни",
    homeCoverageHidden: "2 приватні приховано",
    homeExposureLabel: "ЕКСПОЗИЦІЯ",
    homeMeterEquities: "Токенізовані акції",
    homeMeterStables: "Стейблкоїни",
    homeMeterOther: "Інші активи",
    homeAttn3: "Бюджет мандата агента використано на 80%",
    homeAttn3Tag: "АГЕНТ",
    homeAttn4: "2 активи з невідомими даними",
    homeAttn4Tag: "ДАНІ",
    homeReviewCta: "Переглянути в Home",
    homeStratName: "Драбина стейблкоїнів — v3",
    homeStratPaper: "Перевірено в симуляції",
    homeStratVersion: "Версію збережено",
    homeStratReview: "Потрібен перегляд",
    homeStratRecommended: "Рекомендований шлях",
    homeStratScenarioA: "Базовий сценарій · стабільні ставки",
    homeStratScenarioB: "Стрес-сценарій · зниження ставки",
    homeStratOutcome: "Результат",
    homeStratDrawdown: "Макс. просадка",
    homeRynYou: "ВИ",
    homeRynQuestion: "Чи варто розширити драбину на 5%?",
    homeRynFacts: "Факти й джерела",
    homeRynFactsBody: "3 джерела · звіти резервів, крива ставок, глибина венью",
    homeRynRisk: "Детермінований ризик-результат",
    homeRynRiskBody: "У межах політики · концентрація незмінна",
    homeRynNext: "Запропонований наступний крок",
    homeRynNextBody: "Спершу розширення в симуляції, перегляд за 7 днів",
    homeRynDecision: "Твоє рішення",
    homeRynDecisionBody: "Явне погодження — нічого не виконується самостійно",
    homeOpen: "Відкрити Ryntra Home",
    agentsEyebrow: "AGENT CONTROL",
    agentsHeadline: "Агент пропонує. Ти авторизуєш. Ryntra підтверджує результат.",
    agentsLead: "Зміни один параметр і побач, як разом змінюються докази, ризик, політика, вердикт і потрібне погодження.",
    agentsLaw: "Агент пропонує. Ryntra перевіряє та встановлює межі. Ти авторизуєш. Провайдер виконує. Ryntra підтверджує результат.",
    agentsDemo: "Інтерактивна демонстрація · Ілюстративно · Кошти не рухаються",
    agentsOpen: "Відкрити Agent Control",
    flowEyebrow: "ЯК ПРАЦЮЄ RYNTRA",
    flowSteps: [
      "Людина або агент",
      "Докази",
      "Стратегія та ризик",
      "Політика",
      "Авторизація",
      "Підключений провайдер",
      "Перевірений результат",
    ],
    flowNotes: [
      "Дію починає людина або обмежений агент.",
      "Спершу збираються факти та джерела.",
      "Дія зважується проти стратегії та ризику.",
      "Перед авторизацією перевіряються ліміти, мандати й дозволені дії.",
      "Авторизує людина або обмежений мандат — саме ці байти.",
      "Виконання лишається у підключеного гаманця, венью чи провайдера.",
      "Фактичний результат спостерігається та звіряється.",
    ],
    flowLabel: "Цикл рішень Ryntra",
    ctaLine1: "Розумій, що змінилося.",
    ctaLine2: "Контролюй, що може статися.",
    ctaLine3: "Перевіряй, що відбулося насправді.",
    ctaOpen: "Відкрити Ryntra",
    maturity: {
      live: "Доступно",
      testnet_verified: "Перевірено на testnet",
      read_only: "Лише читання",
      research: "Дослідження",
    },
  },
};

export type PublicCopy = (typeof PUBLIC_COPY)["en"];

export function publicCopy(locale: PublicLocale | string | null | undefined): PublicCopy {
  return PUBLIC_COPY[isPublicLocale(locale) ? locale : "en"];
}
