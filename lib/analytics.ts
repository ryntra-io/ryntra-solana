"use client";

// Fire-and-forget CTA tracking. Never blocks navigation, never throws.
export function track(name: string, placement: string, locale: string) {
  try {
    sendEvent({
      name,
      placement,
      locale,
      path: window.location.pathname,
      ref: document.referrer || null,
    });
  } catch {
    // analytics must never break the page
  }
}

/* The one way an event reaches `/api/track`, for the CTA clicks above and for
   rows a caller has already shaped itself (Seeker Connect's count, SKR-1). */
export function sendEvent(event: Readonly<Record<string, string | null>>) {
  try {
    const payload = JSON.stringify(event);
    if (navigator.sendBeacon?.("/api/track", new Blob([payload], { type: "application/json" }))) return;
    void fetch("/api/track", {
      method: "POST",
      body: payload,
      keepalive: true,
      headers: { "Content-Type": "application/json" },
    }).catch(() => undefined);
  } catch {
    // analytics must never break the page
  }
}
