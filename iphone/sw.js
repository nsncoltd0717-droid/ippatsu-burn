// 一発バーン iPhone 版 v2.12.0(Safari の「ホーム画面に追加」)。電波があるときは新しい版を取りに行き、無いとき・遅いときは覚えている版で開く
const CACHE = "ippatsu-ios-83ba348cb1";
const PARTS = "ippatsu-ios-parts-1";   // DWG・PDF の部品・オープニングの絵(vendor/)。版を上げても消さない
const FIRST = ["./", "index.html", "manifest.webmanifest", "icon-192.png"];   // はじめに覚える(最初の画面)
const LATER = ["nomiso.html", "sumi.html", "kamashi.html", "kurukuru.html", "utsushi.html", "pen.html", "hisoka.html", "icon-180.png", "icon-512.png", "vendor/opening/hisoka_opening_cfd53982.jpg", "vendor/opening/opening_girl_479cca19.webp", "vendor/opening/opening_logo_efcc8fdb.webp", "vendor/opening/opening_movie_28987426.mp4", "vendor/opening/opening_movie_c1e8b858.webp"];   // 落ち着いてから 1 本ずつ覚える(電波なしの現場でも開けるように)
const NC = { cache: "no-cache" };
const IOS = CACHE.indexOf("ippatsu-ios-") === 0;
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FIRST)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== PARTS && (IOS ? k.indexOf("ippatsu-ios-") === 0 : k.indexOf("ippatsu-ios-") !== 0)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const put = (store, req, r) => { if (r && r.ok) { const c = r.clone(); caches.open(store).then((ca) => ca.put(req, c)); } return r; };
let warming = null;
function warm() {   // まだ覚えていないものを 1 本ずつ(一度に取りに行くと、遅い回線で画面が開くのが遅れる)
  if (warming) return warming;
  warming = (async () => {
    for (const f of LATER) {
      const store = f.indexOf("vendor/") === 0 ? PARTS : CACHE;
      if (await caches.match(f, { ignoreSearch: true })) continue;
      try { const r = await fetch(f, NC); if (r.ok) await (await caches.open(store)).put(f, r); } catch (e) { break; }   // 電波が切れたらやめる(次にまた)
    }
  })().finally(() => { warming = null; });
  return warming;
}
self.addEventListener("message", (e) => { if (e.data === "warm") e.waitUntil(warm()); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  if (new URL(e.request.url).pathname.includes("/vendor/")) {   // 部品は覚えている物を先に使う
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((r2) => put(PARTS, e.request, r2))));
    return;
  }
  const net = fetch(e.request, NC).then((r) => put(CACHE, e.request, r));
  e.respondWith(new Promise((ok, ng) => {
    let done = false;
    const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then((r) => r || (e.request.mode === "navigate" ? caches.match("index.html") : null));
    const t = setTimeout(() => fromCache().then((r) => { if (r && !done) { done = true; ok(r); } }), 4000);   // 電波が弱い:覚えている版で先に開く
    net.then((r) => { if (!done) { done = true; clearTimeout(t); ok(r); } }, () => fromCache().then((r) => { if (!done) { done = true; clearTimeout(t); r ? ok(r) : ng(new Error("offline")); } }));
  }));
  e.waitUntil(net.catch(() => {}));
});
