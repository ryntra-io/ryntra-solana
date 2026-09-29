type ConnectionTrigger = Readonly<{
  focus: () => void;
  click: () => void;
}>;

/**
 * Move focus to the real shell control before opening its accessible menu.
 *
 * The header's control carries `solana-connection-<id>` — the id is React's,
 * unique per mount (`connection.tsx`), so it is found by its prefix inside
 * the top bar, where exactly one lives. A page's «Під'єднати гаманець» opens
 * that same panel rather than a second way to connect.
 */
export function openSolanaConnection(
  resolve: () => ConnectionTrigger | null = () =>
    document.querySelector<HTMLButtonElement>('.rs-top [id^="solana-connection-"]'),
  schedule: (task: () => void) => void = (task) => {
    window.requestAnimationFrame(task);
  },
): boolean {
  const trigger = resolve();
  if (!trigger) return false;
  trigger.focus();
  trigger.click();
  /* Opening the controlled panel re-renders the trigger. Restore focus after
     that commit so keyboard navigation starts from the menu owner, not from
     the proxy action earlier in the document. */
  schedule(() => resolve()?.focus());
  return true;
}
