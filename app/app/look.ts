/**
 * The Solana app's theme is the core's since B1: Graphite by default,
 * Porcelain on choice (`<html data-theme="graphite|porcelain">`, chosen in
 * «Налаштувати» and kept in the core's `ryntra-look` cookie). The old names
 * stay in step for what still reads them: `data-ry-theme="dark|light"` on
 * <html>, and the browser's stored «dark» / «light» that the landing and the
 * site open with (`app/app/theme.ts`).
 *
 * A person who picked a theme before the core's frame keeps it: the first
 * visit turns their stored «light» into Porcelain and remembers it the core's
 * way. The same rule as the other app product of the core (D2), so both read one cookie.
 *
 * Relative imports only: `node --test` imports this module directly.
 */

export type CoreTheme = "graphite" | "porcelain";

/** The core's two cookies: the look, and the menu's place (`@ryntra/core/ui`, `LOOK_COOKIE` and `MENU_COOKIE`). */
export const LOOK_COOKIE = "ryntra-look";
export const MENU_COOKIE = "ryntra-menu";
const PREF_KEY = "ryntra-theme-pref";
const LEGACY_KEY = "ryntra-demo-theme";

/** Light on either name: the core's Porcelain, or the old «light» a page outside the frame may still set. */
export function isLightTheme(value: string | null | undefined): boolean {
  return value === "porcelain" || value === "light";
}

/**
 * Before the first paint: the theme from the core's cookie, or — once — from the old stored choice, which is then
 * written as the core's cookie so «Налаштувати» shows what the page shows.
 */
export const LOOK_BOOT_SCRIPT = `(function(){var d=document.documentElement,t="graphite",m=/(?:^|;\\s*)${LOOK_COOKIE}=(graphite|porcelain|system)\\.(regular|compact)/.exec(document.cookie);try{if(m){t=m[1]==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"porcelain":"graphite"):m[1]}else{var s=localStorage.getItem("${PREF_KEY}")||localStorage.getItem("${LEGACY_KEY}");if(s==="system")s=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(s==="light"||s==="dark"){t=s==="light"?"porcelain":"graphite";document.cookie="${LOOK_COOKIE}="+t+".regular; path=/; max-age=31536000; samesite=lax"}}}catch(e){}d.setAttribute("data-theme",t);d.setAttribute("data-ry-theme",t==="porcelain"?"light":"dark");d.style.colorScheme=t==="porcelain"?"light":"dark"})();`;

/**
 * While the frame is on screen: whatever the core draws on <html> is mirrored to the old names, so a page outside
 * the frame (the landing, the site) opens in the same theme. Returns a function that stops.
 */
export function followLookForOldPages(root: HTMLElement = document.documentElement): () => void {
  /* The stored old name changes only when the person changes the look here, so a choice made outside the frame is not
     overwritten by a visit. */
  const mirror = (changed: boolean) => {
    const theme = root.getAttribute("data-theme");
    if (theme !== "graphite" && theme !== "porcelain") return;
    const old = theme === "porcelain" ? "light" : "dark";
    if (root.getAttribute("data-ry-theme") !== old) root.setAttribute("data-ry-theme", old);
    root.style.colorScheme = old;
    if (!changed) return;
    try {
      localStorage.setItem(PREF_KEY, old);
      localStorage.setItem(LEGACY_KEY, old);
    } catch {
      /* Without storage the pages outside the frame open in their own default. */
    }
  };
  mirror(false);
  const observer = new MutationObserver(() => mirror(true));
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
