import { wordsNow } from '../i18n/dict.ts';
import type { AccountKind } from './account.ts';
import { ONBOARDING } from './words.ts';

/**
 * The Exchange's one step before a first trade: a wallet without a Phoenix account opens one. Phoenix opens a trader
 * account by an access code, a referral or a builder's onboarding (`build-register-ixs` → `send-register-ixs`, the
 * audit B7a §6). Ryntra's engine has none of these routes yet — `app/api/solana/futures/**` reads an account and refuses
 * an order without one (`ACCOUNT_NEEDED`), it does not open one — so the step is said as it is: the account opens on
 * Phoenix's own site, and the window reads the account again when the person comes back. When the engine gains its
 * onboarding route, this is the one place that turns the step into a Review the wallet signs here.
 */

export type Onboarding =
  /** No wallet yet: the first step is the wallet. */
  | Readonly<{ step: 'connect' }>
  /** A wallet without a Phoenix account: one step — open it where Phoenix opens it, then read the account again. */
  | Readonly<{ step: 'open'; where: 'phoenix' }>
  /** Phoenix has the account and holds it until access is granted: nothing to do here but look again. */
  | Readonly<{ step: 'wait' }>;

/** The step a wallet is at, by Phoenix's word on its account; null once there is an account to trade from or read. */
export function onboardingOf(kind: AccountKind): Onboarding | null {
  switch (kind) {
    case 'connect':
      return { step: 'connect' };
    case 'invite':
      return { step: 'open', where: 'phoenix' };
    case 'frozen':
      return { step: 'wait' };
    default:
      return null;
  }
}

/** Phoenix's own site, where an account opens: the one place the Exchange sends a person away to. */
export const PHOENIX_URL = 'https://phoenix.trade';

type StepWords = Readonly<{ title: string; line: string; action: string; detail: string }>;

/** What the step says, in the language given (CITY-79). */
function stepWords(w: (typeof ONBOARDING)['en']): Readonly<Record<Onboarding['step'], StepWords>> {
  return {
    connect: { title: w.connectTitle, line: '', action: '', detail: '' },
    open: { title: w.openTitle, line: w.openLine, action: w.openAction, detail: w.openDetail },
    wait: { title: w.waitTitle, line: w.waitLine, action: '', detail: '' },
  };
}

/**
 * What the step says: a title, one calm line and the one action on screen; `detail` stands behind «Details» — read,
 * then closed again (the clean interface of 28.10). The English words, as the tests read them.
 */
export const ONBOARDING_WORDS: Readonly<Record<Onboarding['step'], StepWords>> = stepWords(ONBOARDING.en);

/** The step's words in the language on screen. */
export function onboardingWords(step: Onboarding['step']): StepWords {
  return stepWords(wordsNow(ONBOARDING))[step];
}
