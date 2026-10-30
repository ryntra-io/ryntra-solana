/**
 * The languages of the city and the one rule that picks among them, with nothing of React in it: the route entry's
 * boot script, the server page and the tests read it as it is (CITY-79). The store and the hooks are `./lang.ts`.
 */

export const LANGS = ['en', 'uk'] as const;
export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = 'en';
export const LANG_KEY = 'ryntra.city.lang';
/** The class the boot script puts on <html> while the words wait for a language other than the server's English. */
export const LANG_WAIT_CLASS = 'city-lang-wait';

/** The two letters on the switch. */
export const LANG_LABEL: Readonly<Record<Lang, string>> = { en: 'EN', uk: 'UA' };
/** The tag `Intl` formats numbers and dates with. */
export const LANG_LOCALE: Readonly<Record<Lang, string>> = { en: 'en-US', uk: 'uk-UA' };

/** A language code as a link, a browser or the storage writes it («uk», «uk-UA», «UA», «ua»), or null. */
export function langOf(code: string | null | undefined): Lang | null {
  if (typeof code !== 'string') return null;
  const head = code.trim().toLowerCase().split(/[-_]/)[0];
  if (head === 'ua') return 'uk';
  return (LANGS as readonly string[]).includes(head) ? (head as Lang) : null;
}

/**
 * The one rule: a `?lang=` link (it names the language on purpose and becomes the new choice), the kept choice, the
 * device's languages in its order, English.
 */
export function pickLang(input: Readonly<{ stored?: string | null; param?: string | null; device?: readonly string[] }>): Lang {
  const param = langOf(input.param);
  if (param) return param;
  const stored = langOf(input.stored);
  if (stored) return stored;
  for (const code of input.device ?? []) {
    const lang = langOf(code);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}

/**
 * The boot script for the route entry, run before the first paint: it picks the language with the same rule and, when
 * it is not English, keeps the city's words hidden until the browser has painted them in it (no flash of English).
 * `hydrateLang()` lifts the class; a page whose script never runs lifts it after a second and a half anyway.
 */
export const LANG_BOOT_SCRIPT = `(function(){try{var L=${JSON.stringify(LANGS)};function o(c){if(typeof c!=="string")return null;var h=c.trim().toLowerCase().split(/[-_]/)[0];if(h==="ua")h="uk";return L.indexOf(h)>=0?h:null}var p=null;try{p=o(new URLSearchParams(location.search).get("lang"))}catch(e){}var s=null;try{s=o(localStorage.getItem(${JSON.stringify(LANG_KEY)}))}catch(e){}var l=p||s;if(!l){var d=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var i=0;i<d.length&&!l;i++)l=o(d[i])}l=l||"en";var r=document.documentElement;r.lang=l;r.dir="ltr";if(l!=="en"){r.classList.add(${JSON.stringify(LANG_WAIT_CLASS)});setTimeout(function(){r.classList.remove(${JSON.stringify(LANG_WAIT_CLASS)})},1500)}}catch(e){}})();`;
