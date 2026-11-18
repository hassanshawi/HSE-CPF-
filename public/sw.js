// HSE - CPF service worker: fast start + read-only offline fallback
const V = "hse-cpf-v2", SHELL = ["/", "/ui.css", "/ui.js", "/manifest.webmanifest", "/assets/map.jpg", "/icons/icon-192.png", "/icons/logo.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== V).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
const put = (req, res) => { if (res && res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(req, c)); } return res; };
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname === "/api/items") { e.respondWith(fetch(r).then(res => put(r, res)).catch(() => caches.match(r))); return; } // always fresh, cached copy if offline
  if (u.pathname.startsWith("/api/")) return;
  if (u.pathname.startsWith("/photos/") || u.pathname.startsWith("/icons/") || u.pathname.startsWith("/assets/")) { e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => put(r, res)))); return; }
  e.respondWith(fetch(r).then(res => put(r, res)).catch(() => caches.match(r).then(m => m || caches.match("/")))); // pages/code: network first
});
