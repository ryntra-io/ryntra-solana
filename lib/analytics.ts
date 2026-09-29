"use client";

// Fire-and-forget CTA tracking. Never blocks navigation, never throws.
export function track(name: string, placement: string, locale: string) {
  try {
    const payload = JSON.stringify({
      name,
      placement,
      locale,
      path: window.location.pathname,
      ref: document.referrer || null,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/track", {
        method: "POST",
        body: payload,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    // analytics must never break the page
  }
}
