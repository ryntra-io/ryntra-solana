import { openExternal, shareThroughApp } from '../app-bridge/page.ts';

/**
 * A card out of the city in one tap (the swap's way since #1212, the launch's cards since CITY-145): in the Ryntra app,
 * its own share sheet (CITY-6b); on a phone, the system's; on a computer — where the system's panel is closed more
 * often than it posts — the card is saved and X opens with the words and the link. Nothing is filmed and nothing is
 * sent anywhere by the city: the person picks where it goes.
 */

export type PostOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

export type PostArgs = Readonly<{
  blob: Blob | null;
  name: string;
  /** What the app's or the phone's share sheet carries beside the card. */
  text: string;
  /** The post X opens with on a computer: its words and its link, apart. */
  x: Readonly<{ text: string; url: string }>;
  /** A touch screen: the system share sheet is its way to post a card. */
  phone: boolean;
}>;

export async function postCard({ blob, name, text, x, phone }: PostArgs): Promise<PostOutcome> {
  const file = blob ? new File([blob], name, { type: blob.type || 'image/png' }) : null;
  const viaApp = file ? await shareThroughApp(file, file.name, text) : null;
  if (viaApp) return viaApp;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (file && phone && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch {
      // The person closed the share sheet.
      return 'cancelled';
    }
  }
  if (file) download(file);
  openExternal(`https://x.com/intent/post?text=${encodeURIComponent(x.text)}&url=${encodeURIComponent(x.url)}`);
  return file ? 'saved' : 'failed';
}

/** Whether this screen is touched rather than pointed at: a phone's way to post is its share sheet. */
export function touchScreen(): boolean {
  return (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) || false;
}

function download(file: File) {
  const href = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = href;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
}
