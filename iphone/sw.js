// 一発バーン iPhone 版 v2.11.0(Safari の「ホーム画面に追加」)。電波があるときは新しい版を取りに行き、無いときは覚えている版で開く
const CACHE = "ippatsu-ios-9ff8fe0209";
const PARTS = "ippatsu-ios-parts-1";   // DWG・PDF の部品(vendor/)。版を上げても消さない
const FILES = ["./", "index.html", "nomiso.html", "sumi.html", "kamashi.html", "kurukuru.html", "utsushi.html", "pen.html", "hisoka.html", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.indexOf("ippatsu-ios-") === 0 && k !== CACHE && k !== PARTS).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  if (new URL(e.request.url).pathname.includes("/vendor/")) {   // 部品は覚えている物を先に使う
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((r2) => { if (r2.ok) { const c = r2.clone(); caches.open(PARTS).then((ca) => ca.put(e.request, c)); } return r2; })));
    return;
  }
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html"))));
});
