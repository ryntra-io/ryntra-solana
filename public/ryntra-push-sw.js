/*
 * Ryntra's push on a computer (AI-19). An empty Web Push wakes this worker; it
 * reads the wallet's newest note from Ryntra itself (the wallet's cookie, the
 * same origin) and shows it. No words travel through the push service. A
 * click opens the note in Ryntra — the tab already open, or a new one. The
 * icon and the badge are the city's mark (CITY-158); a push without a note
 * opens the city's assistant.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function latest() {
  try {
    const response = await fetch("/api/v1/assistant/push/latest", { credentials: "include", cache: "no-store", headers: { "X-Ryntra-API": "1" } });
    if (!response.ok) return null;
    const body = await response.json();
    return body && body.note ? body.note : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const note = await latest();
      /* A browser must show something for every push it receives: the note, or a plain line that opens the inbox. */
      const lang = (self.navigator && self.navigator.language) || "en";
      const uk = /^uk/i.test(lang);
      const title = note ? note.title : "Ryntra";
      const body = note ? note.body : uk ? "Нове сповіщення в Ryntra." : "A new note in Ryntra.";
      const href = note ? note.href : "/?open=assistant";
      await self.registration.showNotification(title, {
        body,
        tag: note ? note.id : "ryntra",
        icon: "/brand/city/icon-192.png",
        badge: "/brand/city/badge-96.png",
        data: { href },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/?open=assistant";
  const target = new URL(href, self.location.origin).href;
  event.waitUntil(
    (async () => {
      /* A tab of its own: a page open in Ryntra (a Review halfway, a form) is never navigated away from. */
      await self.clients.openWindow(target);
    })(),
  );
});
