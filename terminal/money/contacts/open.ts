/**
 * Whether «Contacts» stands: its tab and its menu item come once the book is in the database —
 * `NEXT_PUBLIC_RYNTRA_CONTACTS=1`, the release's switch. Its own file, so the menu reads it without the screen.
 */
export function contactsOpen(flag: string | undefined = process.env.NEXT_PUBLIC_RYNTRA_CONTACTS): boolean {
  const value = flag?.trim().toLowerCase();
  return value === '1' || value === 'on' || value === 'true';
}
