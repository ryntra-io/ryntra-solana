import { create } from 'zustand';
import { DEFAULT_LANG, LANG_KEY, LANG_WAIT_CLASS, langOf, pickLang, type Lang } from './langs.ts';

export * from './langs.ts';

/**
 * The city's language. English and
 * Ukrainian today; a new language is one more code here and one more half in every dictionary.
 *
 * Which one: a `?lang=` link, else the person's own choice (kept on this device), else the language of the browser or
 * the phone, else English. A `?lang=` link is a choice too and is kept. The page never reloads for it: every text
 * reads the language through `useLang()`, so a switch repaints the words in place.
 */

type LangStore = { lang: Lang; ready: boolean };

export const useLangStore = create<LangStore>(() => ({ lang: DEFAULT_LANG, ready: false }));

/** The language for words outside React (a moment's line, a formatter): the same store the hooks read. */
export function langNow(): Lang {
  return useLangStore.getState().lang;
}

/**
 * The language in a component. The server paints English (the store's first state, which the store's hook gives the
 * server and the hydrating render alike); the next render has the person's language, so hydration never disagrees. The
 * boot script keeps the words hidden for that one frame.
 *
 * Through the store's own hook, never `react`'s by name: the server's routes read the city's formatters too
 * (`app/api/city/**` → `city/lib/**` → `dict.ts` → here), and a module that names a React hook cannot stand there.
 */
export function useLang(): Lang {
  return useLangStore((st) => st.lang);
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function deviceLangs(): string[] {
  try {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language];
    return list.filter((code): code is string => typeof code === 'string');
  } catch {
    return [];
  }
}

function paramLang(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('lang');
  } catch {
    return null;
  }
}

function mark(lang: Lang) {
  try {
    document.documentElement.lang = lang;
  } catch {
    // No document (a test): nothing to mark.
  }
}

/** Shows the words again once the browser has painted them in the person's language (two frames: render, paint). */
function unwait() {
  try {
    const lift = () => document.documentElement.classList.remove(LANG_WAIT_CLASS);
    requestAnimationFrame(() => requestAnimationFrame(lift));
  } catch {
    // No document (a test).
  }
}

/** Reads the language once in the browser; later calls do nothing. A `?lang=` link is kept as the person's choice. */
export function hydrateLang(): Lang {
  const st = useLangStore.getState();
  if (st.ready) return st.lang;
  const store = storage();
  let stored: string | null = null;
  try {
    stored = store?.getItem(LANG_KEY) ?? null;
  } catch {
    stored = null;
  }
  const param = langOf(paramLang());
  const lang = pickLang({ param, stored, device: deviceLangs() });
  if (param) keep(param);
  useLangStore.setState({ lang, ready: true });
  mark(lang);
  unwait();
  follow();
  return lang;
}

/** A switch in another tab of the city (a window out on the second screen) repaints this one too. */
function follow() {
  try {
    window.addEventListener('storage', (event) => {
      if (event.key !== LANG_KEY) return;
      const next = langOf(event.newValue);
      if (!next || next === useLangStore.getState().lang) return;
      useLangStore.setState({ lang: next });
      mark(next);
    });
  } catch {
    // No window (a test).
  }
}

function keep(lang: Lang) {
  try {
    storage()?.setItem(LANG_KEY, lang);
  } catch {
    // A private window keeps the choice for this visit only.
  }
}

/** The person's choice: kept on the device, the page's own `lang`, every word repainted; the address follows it. */
export function setLang(lang: Lang): void {
  keep(lang);
  useLangStore.setState({ lang, ready: true });
  mark(lang);
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', lang);
      window.history.replaceState(window.history.state, '', url);
    }
  } catch {
    // No address to follow (a test).
  }
}
