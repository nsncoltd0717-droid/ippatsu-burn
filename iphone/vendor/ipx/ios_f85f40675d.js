// 一発バーン iPhone 版(Safari の「ホーム画面に追加」で使う PWA)の手当て(2026-11-25 v2.10.0)
// make_apps.py が「iPhone版」の全画面にだけ、ippatsu_common.js より先に入れる(アプリ版・Android APK には入れない)。
// iPhone には Android アプリの橋渡し(window.KurukuruAndroid)が無いので、ここで代わりを用意する:
//   ・ファイルの保存(ZIP・CSV・SIMA・DXF・写真など):<a download> と navigator.share を見張り、iPhone では共有シート
//     (「ファイルに保存」「ドライブ」「画像を保存」など)へ回す。押してすぐでないと共有シートが出せないので、そのときは
//     「📤 保存・共有する」の小窓を出して、もう一度押してもらう。
//   ・改善要望:共有シート(LINE・メールなど)→ 使えなければメール(mailto)。window.IPPATSU_IOS_FB(ippatsu_common.js の A の代わり)
//   ・☁ クラウド共有:iPhone は Google ログインの自動同期ができないので、現場まるごと ZIP を共有シートでドライブへ/ファイルから取り込む
//   ・杭ナビとの通信(Bluetooth・Wi-Fi の中継):iPhone の Safari ではできないので、その旨を出し CSV・SIMA の書き出しへ案内
//   ・見た目:ノッチ・下のバー(safe-area)、ダブルタップ拡大を止める、入力のときの拡大を止める
// Android アプリ(橋渡しがある)では何もしない。パソコンの Chrome で iPhone の動きを試すときは URL に ?ios=1。
(function () {
  "use strict";
  if (window.IPPATSU_IOS) return;
  var ua = navigator.userAgent || "";
  var force = /[?&]ios=1\b/.test(location.search);
  try { if (force) sessionStorage.setItem("ipx.ios.force", "1"); else if (sessionStorage.getItem("ipx.ios.force") === "1") force = true; } catch (e) { /* */ }
  var isIOS = force || /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var android = !!window.KurukuruAndroid;
  var on = isIOS && !android;
  var APP = window.IPPATSU_APP || "";
  var standalone = (function () { try { return !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)); } catch (e) { return false; } })();
  var I = window.IPPATSU_IOS = { on: on, standalone: standalone, version: "2026-11-25a" };
  if (!on) return;

  var root = document.documentElement;
  root.classList.add("ipx-ios");
  if (standalone) root.classList.add("ipx-standalone");
  // ---------------------------------------------------------------- 見た目
  // 入力のときの拡大を止める(maximum-scale=1。iPhone はこれでも2本指の拡大はできる)・ノッチで切れないように(viewport-fit=cover)
  (function () {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement("meta"); m.name = "viewport"; (document.head || root).appendChild(m); }
    m.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  })();
  var FULL = { nomiso: 1, sumi: 1, kamashi: 1, kurukuru: 1, pen: 1 };   // 画面いっぱいのアプリ(下のバーの分だけ上げる)
  var css =
    "html.ipx-ios{-webkit-text-size-adjust:100%;touch-action:manipulation}" +
    "html.ipx-ios button,html.ipx-ios a,html.ipx-ios label,html.ipx-ios summary{touch-action:manipulation}" +
    "html.ipx-ios .ipx-card input:not([type=checkbox]):not([type=radio]),html.ipx-ios .ipx-card select,html.ipx-ios .ipx-card textarea,html.ipx-ios .ipx-fbd textarea,html.ipx-ios .ipx-fbbox textarea{font-size:16px}" +
    (FULL[APP] ? "html.ipx-ios body{padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}" : "") +
    ".ipx-ios-sheet{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center}" +
    ".ipx-ios-sheet>div{width:min(560px,100%);background:#fff;color:#1d2330;border-radius:16px 16px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));font:15px/1.5 -apple-system,'Hiragino Sans',sans-serif;box-shadow:0 -4px 20px rgba(0,0,0,.25)}" +
    ".ipx-ios-sheet b{font-size:17px}.ipx-ios-sheet small{display:block;color:#5d6575;margin:6px 0 12px;overflow-wrap:anywhere}" +
    ".ipx-ios-sheet .r{display:flex;gap:8px;flex-wrap:wrap}.ipx-ios-sheet button{font:inherit;font-weight:700;min-height:46px;padding:8px 16px;border-radius:12px;border:1px solid #d9dde5;background:#f4f5f7;color:inherit;flex:1}" +
    ".ipx-ios-sheet button.pri{background:#0d3f8f;color:#fff;border-color:transparent;flex:2}" +
    "@media (prefers-color-scheme:dark){.ipx-ios-sheet>div{background:#1e232b;color:#e8eaef}.ipx-ios-sheet button{background:#14171c;border-color:#333a45}.ipx-ios-sheet small{color:#9aa3b2}}" +
    ".ipx-ios-note{margin:0 0 12px;padding:10px 12px;border-radius:12px;background:rgba(13,63,143,.10);font-size:13px;line-height:1.6}";
  function addCss() { var s = document.createElement("style"); s.id = "ipx-ios-css"; s.textContent = css; (document.head || root).appendChild(s); }
  if (document.head) addCss(); else document.addEventListener("DOMContentLoaded", addCss);

  // この端末に置いた現場(IndexedDB)を、空きが少ないときも消されにくくする
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* */ }

  // ---------------------------------------------------------------- ファイルの保存 → 共有シート
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var MB = function (n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; };
  var origShare = navigator.share ? navigator.share.bind(navigator) : null;
  var origCanShare = navigator.canShare ? navigator.canShare.bind(navigator) : null;
  var blobs = {}, order = [];
  var origCreate = URL.createObjectURL;
  URL.createObjectURL = function (o) {
    var u = origCreate.apply(URL, arguments);
    try { if (o instanceof Blob) { blobs[u] = o; order.push(u); if (order.length > 30) delete blobs[order.shift()]; } } catch (e) { /* */ }
    return u;
  };
  function dataBlob(href) {
    var m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(href); if (!m) return null;
    var s = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255;
    return new Blob([u], { type: m[1] || "application/octet-stream" });
  }
  var MIME = { zip: "application/zip", json: "application/json", csv: "text/csv", txt: "text/plain", sim: "text/plain", dxf: "application/dxf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xml: "application/xml", html: "text/html" };
  function toFile(blob, name) {
    var ext = String(name || "").split(".").pop().toLowerCase();
    var type = (blob.type && blob.type !== "application/octet-stream") ? blob.type : (MIME[ext] || "application/octet-stream");
    return new File([blob], name || "download", { type: type });
  }
  function canFiles(files) { try { return !!(origShare && origCanShare && origCanShare({ files: files })); } catch (e) { return false; } }
  // 押してすぐでないと共有シートが出せない(NotAllowedError)ときの小窓
  var sheetEl = null;
  function sheet(data, note) {
    if (sheetEl) sheetEl.remove();
    var files = data.files || [];
    var title = files.length ? (files.length === 1 ? "📦 ファイルができました" : "📦 " + files.length + " 個のファイルができました") : "📤 送る";
    var sub = files.length ? files.slice(0, 4).map(function (f) { return esc(f.name) + "(" + MB(f.size) + ")"; }).join("<br>") + (files.length > 4 ? "<br>ほか " + (files.length - 4) + " 個" : "") : esc(data.title || "");
    var help = note || (files.length ? (/^image\//.test(files[0].type) ? "次の画面で「画像を保存」で写真へ、「ファイルに保存」で iPhone の中へ、「ドライブ」で Google ドライブへ。" : "次の画面で「ファイルに保存」で iPhone の中へ、「ドライブ」で Google ドライブへ。LINE・メールにも送れます。") : "");
    var o = document.createElement("div"); o.className = "ipx-ios-sheet"; o.setAttribute("role", "dialog");
    o.innerHTML = "<div><b>" + title + "<\/b><small>" + sub + (help ? "<br>" + esc(help) : "") + '<\/small><div class="r"><button type="button" class="pri" data-x="go">📤 保存・共有する<\/button><button type="button" data-x="no">やめる<\/button><\/div><\/div>';
    o.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) { if (ev.target === o) { o.remove(); sheetEl = null; } return; }
      o.remove(); sheetEl = null;
      if (b.dataset.x !== "go") return;
      if (!origShare) { if (files.length) openFile(files[0]); else if (data.text) mailto(data.title || "", data.text); return; }
      origShare(data).catch(function (e) { if (e && e.name === "AbortError") return; if (files.length) openFile(files[0]); else if (data.text) mailto(data.title || "", data.text); });
    });
    (document.body || root).appendChild(o); sheetEl = o;
  }
  function openFile(f) {   // 共有シートが使えない古い iPhone:新しい画面で開く(そこから共有で保存)
    var u = origCreate.call(URL, f); var w = window.open(u, "_blank"); if (!w) location.href = u;
    setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) { /* */ } }, 60000);
  }
  function save(blob, name) {
    var f = toFile(blob, name);
    if (!canFiles([f])) { openFile(f); return Promise.resolve(); }
    return origShare({ files: [f] }).catch(function (e) { if (e && e.name === "AbortError") return; sheet({ files: [f] }); });
  }
  I.save = save; I.sheet = sheet;
  // アプリの中の navigator.share:押してすぐでないと断られるので、そのときは小窓から出し直す(呼んだ側にはうまくいったと返す)
  if (origShare) {
    try {
      navigator.share = function (data) {
        return origShare(data).catch(function (e) {
          if (e && e.name === "NotAllowedError" && data && (data.files || data.text || data.url)) { sheet(data); return; }
          throw e;
        });
      };
    } catch (e) { /* 入れ替えられない端末はそのまま */ }
  }
  // <a download href="blob:…"> の click():iPhone のホーム画面アプリでは、そのまま開くとアプリの画面がファイルに置き換わって戻れない → 共有シートへ
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    try {
      var href = this.getAttribute("href") || "";
      if (this.hasAttribute("download") && /^(blob:|data:)/.test(href)) {
        var b = href.indexOf("blob:") === 0 ? blobs[this.href] || blobs[href] : dataBlob(href);
        if (b) { save(b, this.getAttribute("download") || "download"); return; }
      }
    } catch (e) { /* ふつうに開く */ }
    return origClick.apply(this, arguments);
  };
  // 画面の上の <a download> を指で押したとき(click() ではなく)も同じ
  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest("a[download]");
    if (!a || ev.defaultPrevented) return;
    var href = a.getAttribute("href") || "";
    if (!/^(blob:|data:)/.test(href)) return;
    var b = href.indexOf("blob:") === 0 ? blobs[a.href] || blobs[href] : dataBlob(href);
    if (!b) return;
    ev.preventDefault(); save(b, a.getAttribute("download") || "download");
  }, true);

  // ---------------------------------------------------------------- 改善要望(ippatsu_common.js の A の代わり。shareText だけ持つ)
  function mailto(subject, text) {
    var a = document.createElement("a");
    a.href = "mailto:?subject=" + encodeURIComponent(subject || "") + "&body=" + encodeURIComponent(String(text || "").slice(0, 1800));
    (document.body || root).appendChild(a); origClick.call(a); a.remove();
  }
  window.IPPATSU_IOS_FB = {
    shareText: function (subject, text) {
      if (!origShare) { mailto(subject, text); return; }
      origShare({ title: subject, text: text }).catch(function (e) {
        if (e && e.name === "AbortError") return;
        if (e && e.name === "NotAllowedError") sheet({ title: subject, text: text }, "次の画面で LINE・メールなどを選んでください。"); else mailto(subject, text);
      });
    }
  };

  // ---------------------------------------------------------------- 杭ナビとの通信(くるくる)
  function dlg(title, html) {
    var G = window.Genba;
    if (G && G.dialog) return G.dialog(title, "", null, html);
    alert(title + "\n\n" + String(html).replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, ""));
  }
  I.noKui = function () {
    dlg("📱 iPhone では杭ナビとつなげません",
      "杭ナビとの通信(Bluetooth・Wi-Fi のくるくる中継)は、iPhone の Safari では仕組み上できません(Android アプリだけ)。<br><br>" +
      "<b>iPhone でできること<\/b>:図面・座標を見る・点を選ぶ・器械点からの方向角や距離を出す(見本の動き)。<br>" +
      "<b>杭ナビへ渡すとき<\/b>:「一覧・書き出し」の <b>⬇ CSV<\/b> / <b>⬇ SIMA<\/b> で書き出し、共有シートで「ファイルに保存」やドライブへ。杭ナビ側(または Android の一発バーン)で読み込んでください。");
  };
  if (APP === "kurukuru") {
    var once = function () {
      try { if (sessionStorage.getItem("ipx.ios.kui")) return; sessionStorage.setItem("ipx.ios.kui", "1"); } catch (e) { /* */ }
      var G = window.Genba; if (G && G.toast) G.toast("📱 iPhone 版:杭ナビとの通信はできません。CSV・SIMA で書き出して渡してください");
    };
    window.addEventListener("load", function () { setTimeout(once, 4500); });
  }

  // ---------------------------------------------------------------- ☁ クラウド共有(iPhone は手で受け渡す)
  I.afterCommon = function () {
    var G = window.Genba;
    if (!G || !G.cloud) return;
    var SHARE = "一発バーン現場共有";
    G.cloud.mount = function (el) {
      el.innerHTML =
        '<div class="info">📱 <b>iPhone では自動の同期はできません<\/b>(Google ログインの自動同期は Android アプリとパソコンだけ)。かわりに <b>現場まるごと ZIP<\/b> で受け渡します。<\/div>' +
        '<div class="info"><b>送る<\/b>:「⬆ ドライブへ送る」→ 出てきた画面で <b>ドライブ<\/b> を選び、フォルダ「' + SHARE + '」に保存。<br>' +
        '<b>受け取る<\/b>:「⬇ ドライブから取り込む」→「ブラウズ」で Google ドライブの「' + SHARE + '」を開き、<code>genba_〜.zip<\/code> を選ぶ →「まとめる(おすすめ)」。Android・パソコンが自動で置いた ZIP もそのまま読めます。<\/div>' +
        '<div class="info" style="background:rgba(46,160,67,.12);border-radius:8px;padding:8px 10px">✅ 取り込んでも、この端末の現場は消えません(「まとめる」なら無いものだけ足します)。<\/div>' +
        '<div class="btns"><button type="button" class="pri" data-ic="one">⬆ この現場をドライブへ送る<\/button>' +
        '<button type="button" data-ic="all">⬆ 全部の現場を送る<\/button><button type="button" data-ic="imp">⬇ ドライブから取り込む<\/button><\/div>';
      if (!el.__ipxIos) {
        el.__ipxIos = true;
        el.addEventListener("click", function (ev) {
          var b = ev.target.closest("[data-ic]"); if (!b) return;
          var k = b.dataset.ic, q = function (s) { return document.querySelector(s); };
          if (k === "one") { var x = q('#site [data-a="exp"]'); if (x) x.click(); else dlg("先に現場を選んでください", "「いまの現場」で現場を選ぶか作ってください。"); }
          if (k === "all") { var y = q("#gExpAll"); if (y) y.click(); }
          if (k === "imp") { var z = q("#gImp"); if (z) z.click(); }
        });
      }
    };
    G.cloud.sync = function () { return Promise.reject(new Error("iPhone では自動の同期はできません。ZIP で受け渡してください")); };
  };

  // ---------------------------------------------------------------- 最初の画面:ホーム画面への追加の案内・できないことのお知らせ
  if (APP === "menu") {
    document.addEventListener("DOMContentLoaded", function () {
      var lead = document.querySelector("p.lead"); if (!lead) return;
      var n = document.createElement("div"); n.className = "ipx-ios-note";
      n.innerHTML = (standalone ? "" : "📲 <b>ホーム画面に追加<\/b>して使ってください:Safari の下の <b>共有ボタン(□↑)<\/b> →「<b>ホーム画面に追加<\/b>」。電波の無い所でも開けるようになり、現場がこの端末に残ります。<br>") +
        "📱 <b>iPhone 版<\/b>:杭ナビとの通信と、クラウドの自動同期はできません(CSV・SIMA の書き出し、現場まるごと ZIP で受け渡し)。保存は共有シート(ファイルに保存・ドライブ)から。";
      lead.parentNode.insertBefore(n, lead.nextSibling);
    });
  }
})();

    
