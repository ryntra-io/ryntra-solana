type ConnectionTrigger = Readonly<{
  focus: () => void;
  click: () => void;
}>;

type TriggerDocument = Readonly<{
  getElementById: (id: string) => ConnectionTrigger | null;
  querySelector: (selector: string) => ConnectionTrigger | null;
}>;

/**
 * The wallet panel's own trigger in the app's frame (`app/app/product-shell.tsx`): out of sight and out of the Tab
 * order, it opens the panel for the header's wallet button. Since the app moved into the core's frame (B1) the header
 * is the core's `ryntra-header` and carries no `solana-connection-` control, so a page's «Під'єднати гаманець» that
 * looked only for the old one found nothing and did nothing (the operator's report of 2026-10-19, Home's guest door).
 */
export const SOLANA_WALLET_TRIGGER_ID = "solana-wallet-trigger";

/** The old shell's control: `solana-connection-<id>`, React's id, unique per mount, the one inside the top bar. */
const LEGACY_TRIGGER = '.rs-top [id^="solana-connection-"]';

/**
 * Which control opens the wallet's panel, and whether the caller hands the focus back to it. The frame's trigger is
 * clicked only: the frame itself moves the focus into the panel and back to the header's wallet button.
 */
export function findSolanaConnectionTrigger(doc: TriggerDocument): Readonly<{ trigger: ConnectionTrigger; refocus: boolean }> | null {
  const frame = doc.getElementById(SOLANA_WALLET_TRIGGER_ID);
  if (frame) return { trigger: frame, refocus: false };
  const legacy = doc.querySelector(LEGACY_TRIGGER);
  return legacy ? { trigger: legacy, refocus: true } : null;
}

/**
 * Open the wallet's panel from a page's own «Під'єднати гаманець» — the same panel the header opens, never a second
 * way to connect.
 *
 * On the old shell's control the focus moves to it before it is opened and again after the panel's commit, so
 * keyboard navigation starts from the menu owner, not from the proxy action earlier in the document.
 */
export function openSolanaConnection(
  resolve?: () => ConnectionTrigger | null,
  schedule: (task: () => void) => void = (task) => {
    window.requestAnimationFrame(task);
  },
): boolean {
  const found = resolve ? null : findSolanaConnectionTrigger(document as unknown as TriggerDocument);
  const lookUp = resolve ?? (() => findSolanaConnectionTrigger(document as unknown as TriggerDocument)?.trigger ?? null);
  const handBack = resolve ? true : (found?.refocus ?? true);
  const trigger = resolve ? resolve() : (found?.trigger ?? null);
  if (!trigger) return false;
  /* The trigger toggles: a panel already open stays open rather than closing on a page's «Під'єднати». */
  if ((trigger as Partial<Pick<HTMLElement, "getAttribute">>).getAttribute?.("aria-expanded") === "true") return true;
  if (handBack) trigger.focus();
  trigger.click();
  /* Opening the controlled panel re-renders the trigger. Restore focus after
     that commit so keyboard navigation starts from the menu owner, not from
     the proxy action earlier in the document. */
  if (handBack) schedule(() => lookUp()?.focus());
  return true;
}
