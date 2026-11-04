import { districtFrame, type DistrictId } from '../art/frames.ts';
import type { PageId } from '../pages/pages.ts';
import { DOC_IDS, type DocId, type Localized } from './model.ts';

/**
 * The documentation's table of contents (CITY-180): one menu of sections and of the site's pages that stand in the same frame, with
 * each one's name and one line, in English and Ukrainian, and the frame of our own live city at each head. Small on purpose: the
 * city's «Docs» window lists these without loading a word of the sections themselves.
 */

export const DOC_GROUPS = ['begin', 'trade', 'launch', 'earn', 'agent', 'money', 'partners', 'developers', 'trust', 'help'] as const;
export type DocGroup = (typeof DOC_GROUPS)[number];

export const GROUP_WORDS: Localized<Readonly<Record<DocGroup, string>>> = {
  en: { begin: 'Start', trade: 'Trading', launch: 'Launch a coin', earn: 'Earn', agent: 'Agent', money: 'Money', partners: 'Partner programme', developers: 'Developers', trust: 'Security and fees', help: 'Help' },
  uk: { begin: 'Початок', trade: 'Торгівля', launch: 'Запуск монети', earn: 'Заробіток', agent: 'Агент', money: 'Гроші', partners: 'Партнерська програма', developers: 'Розробникам', trust: 'Безпека й комісії', help: 'Допомога' },
};

/** A row of the menu: a section, a page of the city, or the partner page. */
export type NavRef = DocId | Readonly<{ page: Exclude<PageId, 'docs'> }> | Readonly<{ partnerPage: true }>;

export const NAV_LAYOUT: Readonly<Record<DocGroup, readonly NavRef[]>> = {
  begin: ['start', 'city'],
  trade: ['trade', 'orders'],
  launch: ['launch'],
  earn: ['earn'],
  agent: ['agent'],
  money: ['money'],
  partners: ['partners', { partnerPage: true }],
  developers: [{ page: 'developers' }, { page: 'connector' }],
  trust: ['security', 'fees', 'guard'],
  help: ['help', { page: 'help' }, { page: 'about' }, { page: 'terms' }, { page: 'privacy' }],
};

export const DOC_GROUP: Readonly<Record<DocId, DocGroup>> = Object.fromEntries(
  DOC_GROUPS.flatMap((group) => NAV_LAYOUT[group].flatMap((ref) => (typeof ref === 'string' ? [[ref, group]] : []))),
) as Record<DocId, DocGroup>;

/** Which frame stands at a section's head: the district it is about. */
const ART: Readonly<Record<DocId, DistrictId>> = {
  start: 'market',
  city: 'market',
  trade: 'market',
  orders: 'harbor',
  launch: 'launch',
  earn: 'harbor',
  agent: 'agents',
  guard: 'vault',
  money: 'home',
  partners: 'ring',
  fees: 'home',
  security: 'vault',
  help: 'home',
};

export function docArt(id: DocId) {
  return districtFrame(ART[id]);
}

export type DocName = Readonly<{ title: string; line: string }>;

export const DOC_NAMES: Localized<Readonly<Record<DocId, DocName>>> = {
  en: {
    start: { title: 'Getting started', line: 'What Ryntra is, the wallet you need, and your first trade in a few minutes.' },
    city: { title: 'The city', line: 'Every coin is a tower. What height and light tell you, and how to find any coin.' },
    trade: { title: 'Buy and sell from a tower', line: 'Tap a tower, choose an amount, sign once. The cost shows before you sign.' },
    orders: { title: 'Limits, stops and regular buys', line: 'Buy or sell at your price, watch a fall, buy a little every week.' },
    launch: { title: 'How to launch a coin', line: 'A name, a ticker, a picture and one signature. The curve, the move to a pool, what you earn.' },
    earn: { title: 'Pools and staking', line: 'Put coins to work in pools and SOL staking. The position stays in your wallet.' },
    agent: { title: 'Your agent', line: 'What it does today, what comes next, its budget, its limits and how you stop it.' },
    money: { title: 'Top up, send, receive', line: 'Top up, send, ask for a payment, move between networks, see your history.' },
    partners: { title: 'How the programme works', line: 'Your link, your share of Ryntra’s fee, what your friend gets, and how payouts work.' },
    security: { title: 'Security', line: 'Your keys, what Ryntra cannot do, the risks, and how to keep your money safe.' },
    fees: { title: 'All fees', line: 'Every fee in one place: trades, launches, pools and transfers.' },
    guard: { title: 'Guard', line: 'Paste a transaction or a link and read what it does before you sign it.' },
    help: { title: 'Questions and answers', line: 'A trade did not go through, a balance looks wrong, a coin is missing: what to do.' },
  },
  uk: {
    start: { title: 'Перші кроки', line: 'Що таке Ryntra, який потрібен гаманець і твоя перша угода за кілька хвилин.' },
    city: { title: 'Місто', line: 'Кожна монета — вежа. Що означають висота й світло і як знайти будь-яку монету.' },
    trade: { title: 'Купити й продати з вежі', line: 'Торкнися вежі, обери суму, підпиши раз. Вартість видно до підпису.' },
    orders: { title: 'Лімітки, стопи й регулярні покупки', line: 'Купуй чи продавай за своєю ціною, стеж за падінням, докупуй щотижня потроху.' },
    launch: { title: 'Як запустити монету', line: 'Назва, тікер, картинка й один підпис. Крива, вихід у пул і що отримує творець.' },
    earn: { title: 'Пули й стейкінг', line: 'Поклади монети працювати в пули й стейкінг SOL. Позиція лишається у твоєму гаманці.' },
    agent: { title: 'Твій агент', line: 'Що він уміє сьогодні, що буде далі, його бюджет, межі й як його зупинити.' },
    money: { title: 'Поповнити, надіслати, отримати', line: 'Поповнити, надіслати, попросити оплату, перевести між мережами, подивитись історію.' },
    partners: { title: 'Як працює програма', line: 'Твоє посилання, частка комісії Ryntra, що отримує друг і як ідуть виплати.' },
    security: { title: 'Безпека', line: 'Твої ключі, чого Ryntra не може зробити, ризики й як берегти гроші.' },
    fees: { title: 'Усі комісії', line: 'Кожна комісія в одному місці: угоди, запуски, пули й перекази.' },
    guard: { title: 'Охорона', line: 'Встав транзакцію чи посилання й прочитай, що вони роблять, перш ніж підписати.' },
    help: { title: 'Питання й відповіді', line: 'Угода не пройшла, баланс дивний, монети не видно: що робити.' },
  },
};

/** The rows of the menu that are pages of the site rather than sections. */
export const PAGE_NAMES: Localized<Readonly<Record<Exclude<PageId, 'docs'> | 'partnerPage', DocName>>> = {
  en: {
    developers: { title: 'Connect your agent', line: 'Sign in with Solana, read what is open, prepare and sign.' },
    connector: { title: 'Ryntra in AI chats', line: 'Add Ryntra to your AI chat: it reads the market and never signs.' },
    help: { title: 'Write to us', line: 'A question, a problem, an idea or a security report.' },
    about: { title: 'About Ryntra', line: 'Who we are and how to reach us.' },
    terms: { title: 'Terms of Use', line: 'The terms you agree to when you use Ryntra.' },
    privacy: { title: 'Privacy Policy', line: 'What Ryntra keeps, and what it never sees.' },
    partnerPage: { title: 'Get my link', line: 'The partner page: copy your link and estimate what it can bring.' },
  },
  uk: {
    developers: { title: 'Підключити агента', line: 'Увійти через Solana, прочитати, що відкрито, підготувати й підписати.' },
    connector: { title: 'Ryntra в AI-чатах', line: 'Додай Ryntra у свій AI-чат: він читає ринок і ніколи не підписує.' },
    help: { title: 'Написати нам', line: 'Питання, проблема, ідея чи повідомлення про безпеку.' },
    about: { title: 'Про Ryntra', line: 'Хто ми і як нас знайти.' },
    terms: { title: 'Умови використання', line: 'Умови, з якими ти погоджуєшся, користуючись Ryntra.' },
    privacy: { title: 'Приватність', line: 'Що Ryntra зберігає і чого ніколи не бачить.' },
    partnerPage: { title: 'Отримати моє посилання', line: 'Сторінка партнера: скопіюй посилання й прикинь, що воно може принести.' },
  },
};

/** The section before and after one, in reading order. */
export function neighbours(id: DocId): Readonly<{ previous: DocId | null; next: DocId | null }> {
  const at = DOC_IDS.indexOf(id);
  return { previous: DOC_IDS[at - 1] ?? null, next: DOC_IDS[at + 1] ?? null };
}
