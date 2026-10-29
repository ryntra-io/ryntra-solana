import type { WorkspaceLocale } from "@/app/shell/locale";
import type { TeamGrant, TeamJournalAction, TeamKind, TeamPermission, TeamRefusal, TeamRole } from "@/lib/core/team/roles";

/**
 * «Команда» (TEAM-1) — the team's words, in both languages: the roles, the rights and what each grant means. A right
 * the multisig holds is said as one: never «you can pay out».
 */
const bi = (en: string, uk: string) => ({ en, uk }) as const;

export const TEAM_WORDS = {
  title: bi("Team", "Команда"),
  help: bi(
    "A team of wallets with roles. Every right is checked by Ryntra's server on every request. Moving money, deploying, signing for the team and changing the treasury's rules happen only as a proposal on the team's Squads treasury, approved by its members on chain.",
    "Команда гаманців із ролями. Кожне право перевіряє сервер Ryntra на кожному запиті. Рух коштів, розгортання, підпис від команди й зміна правил казни — лише пропозицією в казні Squads команди, яку схвалюють її учасники в ланцюгу.",
  ),
  connectLine: bi("Connect a Solana wallet to see your teams.", "Підключи гаманець Solana, щоб побачити свої команди."),
  proveLine: bi("Sign in with the wallet once: the team list is read for the wallet that proves itself.", "Увійди гаманцем один раз: склад команд читається для гаманця, який себе підтвердив."),
  prove: bi("Sign in with wallet", "Увійти гаманцем"),
  mine: bi("My teams", "Мої команди"),
  mineEmpty: bi("No team yet. One wallet may be in several teams, with a role in each.", "Команд ще немає. Один гаманець може бути в кількох командах, у кожній — своя роль."),
  create: bi("Create a team", "Створити команду"),
  createTitle: bi("New team", "Нова команда"),
  name: bi("Name", "Назва"),
  kind: bi("Kind", "Тип"),
  role: bi("Role", "Роль"),
  status: bi("Status", "Стан"),
  members: bi("Members", "Учасники"),
  wallet: bi("Wallet", "Гаманець"),
  label: bi("Name in the team (optional)", "Ім'я в команді (необов'язково)"),
  actions: bi("Actions", "Дії"),
  open: bi("Open", "Відкрити"),
  accept: bi("Join", "Приєднатися"),
  decline: bi("Decline", "Відмовитися"),
  leave: bi("Leave the team", "Вийти з команди"),
  remove: bi("Remove", "Прибрати"),
  save: bi("Save", "Зберегти"),
  cancel: bi("Cancel", "Скасувати"),
  back: bi("All teams", "Усі команди"),
  invite: bi("Invite", "Запросити"),
  inviteTitle: bi("Invite a wallet", "Запросити гаманець"),
  inviteHint: bi("The role is held only after that wallet says yes with its own signature.", "Роль діє лише після того, як цей гаманець скаже «так» власним підписом."),
  invited: bi("Invited", "Запрошено"),
  active: bi("Active", "Активний"),
  you: bi("you", "ти"),
  yourRights: bi("Your rights", "Твої права"),
  right: bi("Right", "Право"),
  devnet: bi("Devnet: test money only.", "Devnet: лише тестові кошти."),
  treasury: bi("Treasury", "Казна"),
  treasuryNone: bi("No treasury linked. High-risk rights stay closed until an Owner links a Squads multisig their wallet is on.", "Казну не прив'язано. Високоризикові права закриті, доки Власник не прив'яже мультипідпис Squads, у якому є його гаманець."),
  treasuryLink: bi("Link", "Прив'язати"),
  treasuryFixed: bi("Linked once: a change of the treasury is a proposal of that multisig.", "Прив'язано один раз: змінити казну можна лише пропозицією цього мультипідпису."),
  treasuryPlaceholder: bi("Squads multisig address", "Адреса мультипідпису Squads"),
  treasuryOpen: bi("Open the treasury", "Відкрити казну"),
  signers: bi("Signers on chain", "Підписанти в ланцюгу"),
  signersUnread: bi("The treasury's members could not be read now.", "Учасників казни зараз не прочитано."),
  signerOutside: bi("not in the team — remove by a proposal in the treasury", "не в команді — прибрати пропозицією в казні"),
  journal: bi("Journal", "Журнал"),
  journalEmpty: bi("Nothing yet.", "Поки нічого."),
  failed: bi("Not done: {why}", "Не зроблено: {why}"),
  unavailable: bi("Teams could not be read now. Try again in a moment.", "Команди зараз не прочитано. Спробуй за хвилину."),
} as const;

export type TeamWordKey = keyof typeof TEAM_WORDS;

export function teamWords(locale: WorkspaceLocale) {
  return (key: TeamWordKey, values: Readonly<Record<string, string | number>> = {}) =>
    TEAM_WORDS[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

export const ROLE_WORDS: Readonly<Record<TeamRole, Readonly<{ en: string; uk: string }>>> = {
  OWNER: bi("Owner", "Власник"),
  ADMIN: bi("Admin", "Адміністратор"),
  FINANCE: bi("Finance", "Фінанси"),
  LAUNCH_OPERATOR: bi("Launch Operator", "Оператор запуску"),
  MARKET_OPERATOR: bi("Market Operator", "Оператор ринку"),
  DEVELOPER: bi("Developer", "Розробник"),
  ANALYST: bi("Analyst", "Аналітик"),
  VIEWER: bi("Viewer", "Глядач"),
  AGENT: bi("Agent", "Агент"),
};

export const PERMISSION_WORDS: Readonly<Record<TeamPermission, Readonly<{ en: string; uk: string }>>> = {
  view: bi("View", "Перегляд"),
  draft: bi("Draft", "Чернетка"),
  submit: bi("Submit for approval", "Подача на погодження"),
  sign: bi("Sign for the team", "Підпис від команди"),
  deploy: bi("Deploy", "Розгортання"),
  payout: bi("Payouts", "Виплати"),
  withdraw: bi("Withdraw", "Виведення"),
  policy: bi("Change rules", "Зміна правил"),
  receipts: bi("Receipts", "Квитанції"),
  members: bi("Members and roles", "Склад і ролі"),
};

export const GRANT_WORDS: Readonly<Record<TeamGrant, Readonly<{ en: string; uk: string }>>> = {
  ALLOW: bi("Yes", "Так"),
  MULTISIG: bi("Only by the treasury's multisig", "Лише мультипідписом казни"),
  DENY: bi("No", "Ні"),
};

export const KIND_WORDS: Readonly<Record<TeamKind, Readonly<{ en: string; uk: string }>>> = {
  SOLO_CREATOR: bi("Solo creator", "Творець сам"),
  PROJECT_TEAM: bi("Project team", "Команда проєкту"),
  DAO_COMMUNITY: bi("DAO or community", "DAO чи спільнота"),
  AGENCY: bi("Agency or launch partner", "Агенція чи партнер запуску"),
  ENTERPRISE: bi("Company or integrator", "Компанія чи інтегратор"),
};

export const JOURNAL_WORDS: Readonly<Record<TeamJournalAction, Readonly<{ en: string; uk: string }>>> = {
  TEAM_CREATED: bi("Team created", "Команду створено"),
  TEAM_RENAMED: bi("Renamed", "Перейменовано"),
  MEMBER_INVITED: bi("Invited", "Запрошено"),
  MEMBER_JOINED: bi("Joined", "Приєднався"),
  ROLE_CHANGED: bi("Role changed", "Роль змінено"),
  MEMBER_REMOVED: bi("Removed", "Прибрано"),
  MEMBER_LEFT: bi("Left", "Вийшов"),
  TREASURY_LINKED: bi("Treasury linked", "Казну прив'язано"),
  TREASURY_UNLINKED: bi("Treasury unlinked", "Казну відв'язано"),
};

/** Why a check said no — for a client that shows the server's decision. */
export const REFUSAL_WORDS: Readonly<Record<TeamRefusal, Readonly<{ en: string; uk: string }>>> = {
  NOT_A_MEMBER: bi("Not in this team.", "Не в цій команді."),
  NOT_JOINED: bi("Invited, not joined yet.", "Запрошено, ще не приєднався."),
  ROLE_DENIES: bi("The role does not hold this right.", "Роль не має цього права."),
  NO_TREASURY: bi("No treasury linked.", "Казну не прив'язано."),
  NO_MULTISIG_PATH: bi("No multisig path for this action yet.", "Для цієї дії ще немає шляху через мультипідпис."),
  AUTHORITY_CLOSED: bi("Closed on this deployment.", "Закрито на цьому розгортанні."),
  NOT_A_SIGNER: bi("The wallet does not hold this permission on the treasury.", "Гаманець не має цього дозволу в казні."),
  SIGNERS_UNREAD: bi("The treasury could not be read now.", "Казну зараз не прочитано."),
};
