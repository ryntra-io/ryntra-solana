// Shared theme preference: "dark" | "light".
// No "use client": client components import the helpers (window is only touched inside
// function bodies), while the server layout imports the plain THEME_BOOT_SCRIPT string.
// Stored in ryntra-theme-pref; the RESOLVED value is mirrored to the legacy
// ryntra-demo-theme key so the terminal and older code keep working unchanged.
//
// A stored "system" value is a leftover. The founder closed that option on
// 2026-08-25: the product is Dark or Light, never "follow the machine".
// getThemePref and the boot script resolve it once and write the result back.

export type ThemePref = "dark" | "light";

const PREF_KEY = "ryntra-theme-pref";
const LEGACY_KEY = "ryntra-demo-theme";

function resolveStored(raw: string | null): ThemePref {
  if (raw === "dark" || raw === "light") return raw;
  if (raw === "system") {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

export function getThemePref(): ThemePref {
  try {
    const stored = window.localStorage.getItem(PREF_KEY);
    if (stored === "dark" || stored === "light") return stored;
    if (stored === "system") {
      const resolved = resolveStored(stored);
      try { window.localStorage.setItem(PREF_KEY, resolved); } catch { /* Appearance still works when saving is unavailable. */ }
      return resolved;
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy === "dark" || legacy === "light") return legacy;
  } catch {
    // A denied preference store must not disable the visible control.
  }
  return readResolvedTheme();
}

export function resolveTheme(pref: ThemePref): "dark" | "light" {
  return pref;
}

export function applyThemePref(pref: ThemePref): "dark" | "light" {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-ry-theme", resolved);
  document.documentElement.style.colorScheme = resolved;
  try {
    window.localStorage.setItem(PREF_KEY, pref);
    window.localStorage.setItem(LEGACY_KEY, resolved);
  } catch { /* Theme changes immediately even if this browser cannot retain it. */ }
  return resolved;
}

/** Read the resolved theme straight off <html data-theme> (the cabinet/boot script keeps it current). */
export function readResolvedTheme(): "dark" | "light" {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Watch <html data-theme> for changes. Returns an unsubscribe. Calls cb immediately with the current value. */
export function watchResolvedTheme(cb: (t: "dark" | "light") => void): () => void {
  cb(readResolvedTheme());
  const mo = new MutationObserver(() => cb(readResolvedTheme()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** Inline no-flash snippet for server layouts: applies the resolved theme before first paint. */
export const THEME_BOOT_SCRIPT = `(function(){var p=document.documentElement.getAttribute("data-theme")==="light"?"light":"dark";try{var s=localStorage.getItem("${PREF_KEY}");if(s==="dark"||s==="light"){p=s}else if(s==="system"){p=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";try{localStorage.setItem("${PREF_KEY}",p)}catch(e){}}else{var l=localStorage.getItem("${LEGACY_KEY}");if(l==="light"||l==="dark")p=l}}catch(e){}document.documentElement.setAttribute("data-theme",p);document.documentElement.setAttribute("data-ry-theme",p);document.documentElement.style.colorScheme=p})();`;

/** Marks <html> as the cabinet so portal-mounted surfaces share its tokens (app/design/tokens.css). */
export const CABINET_BOOT_SCRIPT = `document.documentElement.setAttribute("data-ry-app","cabinet");`
  /* A browser that remembers a wallet is about to reconnect it silently, so
     «Простий»'s Home draws a balance's shape rather than the guest's promise
     for the moment that takes (RYN-INVEST-SIMPLE-001). The hint is only the
     wallet's name (`connection.tsx`), never an address. */
  + `try{if(localStorage.getItem("ryntra.solana.wallet-hint.v1"))document.documentElement.setAttribute("data-wallet-hint","1")}catch(e){}`;
