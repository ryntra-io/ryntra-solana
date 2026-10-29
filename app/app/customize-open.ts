/**
 * The look and the language have one home since B1: the core's «Налаштування» at the foot of the menu — the theme, the
 * density, the menu's place and the language (UX-013, SOL-C2). This opens it from anywhere — the account's page and the
 * search: the menu's own row, in the rail on a desk and in the bottom sheet on a phone. A menu put away (`[`) or a
 * phone's closed sheet is opened first, then its row is pressed.
 */
export function openCustomize(): void {
  const visible = (element: HTMLElement | null | undefined) => (element && element.offsetParent !== null ? element : null);
  const row = () => [...document.querySelectorAll<HTMLElement>(".ryntra-menu__settings")].find((button) => visible(button));
  const now = row();
  if (now) {
    /* The core's row toggles the panel: pressed while the panel is open, it would shut it. */
    if (now.getAttribute("aria-expanded") !== "true") now.click();
    return;
  }
  (visible(document.querySelector<HTMLElement>(".ryntra-header__menu--phone")) ?? visible(document.querySelector<HTMLElement>(".ryntra-header__menu--desk")))?.click();
  requestAnimationFrame(() => row()?.click());
}
