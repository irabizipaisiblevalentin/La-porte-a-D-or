/*
 * Chorale La Porte d'Or — service worker.
 *
 * It exists for one reason: showing a notification the server pushed while the
 * app is closed. The browser's push service wakes this worker even with no tab
 * open, which is what lets the group's administrator hear about a new
 * application on a phone that has the site closed.
 *
 * Deliberately tiny — no caching, no offline behaviour — so it can never serve a
 * stale page or interfere with the app.
 */

self.addEventListener("install", () => {
  // Take over immediately: a waiting worker would hold back a repaired handler.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : "" }
  }

  const title = payload.title || "Chorale La Porte d'Or"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/logo.png",
      badge: "/logo.png",
      data: { url: payload.url || "/app/notifications" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/app/notifications"

  // Land on the page the notification is about: focus the tab already open, or
  // open a new one. Without this the tap would just dismiss the notification.
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const client of windows) {
        if ("focus" in client) {
          try {
            await client.navigate(url)
          } catch {
            // Navigation can be refused while the tab is closing; focusing is enough.
          }
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
