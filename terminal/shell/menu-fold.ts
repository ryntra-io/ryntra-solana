import { create } from 'zustand';
import { MENU_GROUP_IDS, type MenuGroupId } from './menu.ts';

/**
 * The menu's groups stand folded, all but the one the person is in. A press on a group's
 * name opens or folds it, and the browser remembers the person's own choice (`MENU_KEY`): the groups they opened
 * (`open`) and the group of the place they were in that they folded (`shut`). The others close by themselves never.
 *
 * The rail reads two attributes on the page's root element — `data-menu-open` and `data-menu-shut`, the ids apart by
 * spaces. A small script (`MENU_BOOT_SCRIPT`) sets them there before the first paint, so no group opens and shuts again
 * as the page loads; the store follows right after hydration.
 */

export const MENU_KEY = 'ryntra.terminal.menu.v2';
export const MENU_OPEN_ATTR = 'data-menu-open';
export const MENU_SHUT_ATTR = 'data-menu-shut';
export const MENU_READY_ATTR = 'data-menu-ready';

export type MenuChoice = Readonly<{ open: readonly MenuGroupId[]; shut: readonly MenuGroupId[] }>;
export const NO_CHOICE: MenuChoice = { open: [], shut: [] };

const known = (list: unknown): MenuGroupId[] => (Array.isArray(list) ? MENU_GROUP_IDS.filter((id) => list.includes(id)) : []);

/** The person's choice as the browser keeps it: known ids only, each once, in the menu's order, never both ways. */
export function parseChoice(raw: string | null | undefined): MenuChoice {
  if (!raw) return NO_CHOICE;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return NO_CHOICE;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return NO_CHOICE;
  const open = known((value as { open?: unknown }).open);
  const shut = known((value as { shut?: unknown }).shut).filter((id) => !open.includes(id));
  return { open, shut };
}

/** Whether a group stands open: the person opened it, or it holds the place they are in and they did not fold it. */
export function groupOpen(id: MenuGroupId, lit: boolean, choice: MenuChoice): boolean {
  return choice.open.includes(id) || (lit && !choice.shut.includes(id));
}

/** The choice after a press on a group's name: it turns the other way, and only what differs from the default is kept. */
export function toggledChoice(choice: MenuChoice, id: MenuGroupId, lit: boolean): MenuChoice {
  const opening = !groupOpen(id, lit, choice);
  const open = choice.open.filter((one) => one !== id);
  const shut = choice.shut.filter((one) => one !== id);
  if (opening && !lit) open.push(id);
  if (!opening && lit) shut.push(id);
  return { open: MENU_GROUP_IDS.filter((one) => open.includes(one)), shut: MENU_GROUP_IDS.filter((one) => shut.includes(one)) };
}

/** Runs as the page is parsed, before the first paint: the browser's memory to the root element. */
export const MENU_BOOT_SCRIPT = `try{var c=JSON.parse(localStorage.getItem('${MENU_KEY}')||'{}'),k=${JSON.stringify(MENU_GROUP_IDS)},f=function(l){return Array.isArray(l)?k.filter(function(i){return l.indexOf(i)>=0}):[]},o=f(c&&c.open),s=f(c&&c.shut).filter(function(i){return o.indexOf(i)<0}),r=document.documentElement;if(o.length)r.setAttribute('${MENU_OPEN_ATTR}',o.join(' '));if(s.length)r.setAttribute('${MENU_SHUT_ATTR}',s.join(' '))}catch(e){}`;

export const menuStore = create<{ choice: MenuChoice }>(() => ({ choice: NO_CHOICE }));

function mark(choice: MenuChoice): void {
  const root = document.documentElement;
  if (choice.open.length) root.setAttribute(MENU_OPEN_ATTR, choice.open.join(' '));
  else root.removeAttribute(MENU_OPEN_ATTR);
  if (choice.shut.length) root.setAttribute(MENU_SHUT_ATTR, choice.shut.join(' '));
  else root.removeAttribute(MENU_SHUT_ATTR);
}

/** The person's own choice of open and folded groups. */
export function useMenuChoice(): MenuChoice {
  return menuStore((st) => st.choice);
}

/** Reads the browser's memory; a private window or blocked storage leaves the default: the person's group open. */
export function hydrateMenu(): void {
  let choice = NO_CHOICE;
  try {
    choice = parseChoice(window.localStorage.getItem(MENU_KEY));
  } catch {
    choice = NO_CHOICE;
  }
  mark(choice);
  menuStore.setState({ choice });
  // After the paints that follow hydration, the menu may move: a press opens and folds a group with a slide.
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.setAttribute(MENU_READY_ATTR, '')));
}

/** The terminal's frame leaves the page: the root forgets the groups. */
export function forgetMenu(): void {
  document.documentElement.removeAttribute(MENU_OPEN_ATTR);
  document.documentElement.removeAttribute(MENU_SHUT_ATTR);
  document.documentElement.removeAttribute(MENU_READY_ATTR);
}

export function toggleGroup(id: MenuGroupId, lit: boolean): void {
  const choice = toggledChoice(menuStore.getState().choice, id, lit);
  mark(choice);
  menuStore.setState({ choice });
  try {
    window.localStorage.setItem(MENU_KEY, JSON.stringify(choice));
  } catch {
    /* Storage blocked: the choice holds for this visit. */
  }
}
