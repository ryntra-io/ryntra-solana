/**
 * «On the computer» (CITY-87): the browser's own notification, shown by the open page while the city is open in a tab —
 * in front or behind. Only on a computer: a phone's browser shows a page's notifications through a service worker,
 * and inside the Ryntra app the engine pushes to the phone itself. The browser asks the person once; a «no» there is
 * the browser's and stays so until the person changes it in the browser.
 */

export type DeskState = 'unsupported' | 'default' | 'granted' | 'denied';

type NotificationLike = {
  permission: string;
  requestPermission: () => Promise<string>;
  new (title: string, options?: { body?: string; tag?: string; icon?: string; silent?: boolean }): { onclick: (() => void) | null; close: () => void };
};

function api(): NotificationLike | null {
  if (typeof window === 'undefined') return null;
  const n = (window as unknown as { Notification?: NotificationLike }).Notification;
  if (!n) return null;
  // A touch screen without a mouse: a phone or a tablet, where a page's own notifications do not work this way.
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(hover: hover)').matches) return null;
  } catch {
    // No media queries: take it as a computer.
  }
  return n;
}

export function deskState(): DeskState {
  const n = api();
  if (!n) return 'unsupported';
  return n.permission === 'granted' || n.permission === 'denied' ? n.permission : 'default';
}

/** The browser's one question. Must run from the person's tap. */
export async function askDesk(): Promise<DeskState> {
  const n = api();
  if (!n) return 'unsupported';
  try {
    const answer = await n.requestPermission();
    return answer === 'granted' || answer === 'denied' ? answer : 'default';
  } catch {
    return deskState();
  }
}

/** One notification on the computer; a click brings the city to the front and opens what it is about. */
export function showDesk(title: string, body: string | null, tag: string, onOpen?: () => void): boolean {
  const n = api();
  if (!n || n.permission !== 'granted') return false;
  try {
    const shown = new n(title, { body: body ?? undefined, tag, icon: '/brand/city/icon-192.png' });
    shown.onclick = () => {
      try {
        window.focus();
      } catch {
        // The browser keeps the focus where it is.
      }
      onOpen?.();
      shown.close();
    };
    return true;
  } catch {
    return false;
  }
}
