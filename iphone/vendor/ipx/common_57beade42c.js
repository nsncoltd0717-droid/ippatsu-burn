// 一発バーン 共通(make_apps.py が4本のアプリと一発バーンのメニューの <head> に入れる)
//  1. Genba … 現場(図面・座標・設定・アプリごとの作業)を、この端末の IndexedDB「ippatsu-genba」にまとめて持つ。
//     現場を作る・消す・設定するのは一発バーンのメニュー。4本のアプリは「いまの現場」を読み書きしてやり取りする。
//  2. 入力の小窓 … 数字・文字の欄を押すと、画面の上に小窓を出してそこで入力する(キーボードで画面がずれないように)。
//  3. 現場のバッジ … アプリの見出しに「🏗 現場名」を出す。押すと現場を切り替えられる。
// window.IPPATSU_APP(sumi・kamashi・nomiso・kurukuru・menu)と IPPATSU_READONLY(脳みそバーン:現場へ保存しない)は make_apps.py が決める。
(function () {
  "use strict";
  if (window.Genba) return;
  var APP = window.IPPATSU_APP || "", RO = !!window.IPPATSU_READONLY;
  // 見た目(黒基調)をアプリごとに少し変えるための印。見出し(⌂ ホームへ戻る列)が作業中に上へ消えないようにする(2026-11-17 ゆきちゃん)
  try { document.documentElement.setAttribute("data-ipx", APP || "menu"); } catch (e) { /* */ }
  (function () {
    // 墨太郎の4本は画面の高さに合わせた作り(body は動かない)。入力や「その位置へ寄せる」動きで画面全体が上へずれると、
    // 見出しが上に消えたまま戻せなくなるので、入力が終わったら元の位置(一番上)に戻す。
    var fixedBody = function () { var b = document.body; if (!b) return false; var o = getComputedStyle(b).overflowY; return o === "hidden" || o === "clip"; };
    var typing = function () { var a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
    var back = function () {
      if (!fixedBody() || typing()) return;
      var se = document.scrollingElement || document.documentElement;
      if (window.scrollY || se.scrollTop || document.body.scrollTop) { window.scrollTo(0, 0); se.scrollTop = 0; document.body.scrollTop = 0; }
    };
    var later = function (ms) { clearTimeout(later.t); later.t = setTimeout(back, ms); };
    window.addEventListener("scroll", function () { later(150); }, { passive: true });
    document.addEventListener("focusout", function () { later(300); }, true);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", function () { later(350); });
    window.IPPATSU_TOP = back;
  })();
  var CUR = "ippatsu.genba", LIST = "ippatsu.genba.list";
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* */ } }
  };
  var DEF = { code: "", memo: "", unit: "", axis: "", model: "LN-1000i",
    zone: "", kMode: "none", k: 1, hOn: false, hMean: 0, geoid: 0, temp: 15, press: 1013 };
  var SI_KEYS = ["zone", "kMode", "k", "hOn", "hMean", "geoid", "temp", "press"];   // くるくるの「現場の情報」と同じ欄(kr.sinfo.現場名 にも写す)

  function open() {
    return new Promise(function (ok, ng) {
      if (!window.indexedDB) return ng(new Error("この端末では現場の保存が使えません"));
      var rq = indexedDB.open("ippatsu-genba", 1);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        ["sites", "files", "points", "apps"].forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
      };
      rq.onsuccess = function () { ok(rq.result); };
      rq.onerror = function () { ng(rq.error || new Error("現場の保存場所を開けません")); };
    });
  }
  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (ok, ng) {
        var t = db.transaction(store, mode), st = t.objectStore(store), out;
        var rq = fn(st); if (rq) rq.onsuccess = function () { out = rq.result; };
        t.oncomplete = function () { db.close(); if (store === "files" && mode === "readwrite") ls.set(FEP, String(Date.now()) + Math.random()); ok(out); };
        t.onerror = function () { db.close(); ng(t.error); };
        t.onabort = function () { db.close(); ng(t.error || new Error("保存できませんでした(容量が足りないかもしれません)")); };
      });
    });
  }
  var FK = function (site, name) { return site + "\n" + name; };
  // v2.13.0:図面の一覧(名前・大きさ・日時)を覚えておく。図面を入れる・消すたびに FEP が変わるので、そのときだけ中身を見て作り直す
  var FEP = "ippatsu.genba.fepoch", FMETA = "ippatsu.genba.fmeta.";
  var range = function (site) { return IDBKeyRange.bound(site + "\n", site + "\n￿"); };
  function bad(n) {
    n = String(n || "").trim();
    if (!n) return "現場名を入れてください。";
    if (n.length > 30) return "現場名は30文字までです。";
    if (/[\\/:*?"<>|\n]/.test(n)) return "現場名に \\ / : * ? \" < > | は使えません。";
    return "";
  }
  function mirror(rec) {   // 設定を localStorage にも写す(起動のすぐあとに同期で読めるように)
    var s = rec.settings || {}, si = {};
    SI_KEYS.forEach(function (k) { if (s[k] != null) si[k] = s[k]; });
    ls.set("kr.sinfo." + rec.name, JSON.stringify(si));
    ls.set("ippatsu.genba.set." + rec.name, JSON.stringify(s));
  }
  function emit(type, detail) { try { window.dispatchEvent(new CustomEvent("genba", { detail: Object.assign({ type: type }, detail || {}) })); } catch (e) { /* */ } }

  var G = {
    app: APP, readonly: RO, DEF: DEF,
    bad: bad,
    // v2.13.0:安全モード(ippatsu_guard.js)では、この開き方で現場を選ぶまで「現場なし」で開く(現場の図面を自動で読まない)
    current: function () { var g = window.IPPATSU_GUARD; if (window.IPPATSU_SAFE && g && g.ss.get("ipx.safe.pick") !== "1") return ""; return ls.get(CUR) || ""; },
    setCurrent: function (n) { var g = window.IPPATSU_GUARD; if (g && window.IPPATSU_SAFE) g.ss.set("ipx.safe.pick", "1"); ls.set(CUR, n || null); emit("current", { name: n || "" }); },
    names: function () { try { return JSON.parse(ls.get(LIST) || "[]") || []; } catch (e) { return []; } },
    settingsSync: function (n) { try { return Object.assign({}, DEF, JSON.parse(ls.get("ippatsu.genba.set." + (n == null ? G.current() : n)) || "{}")); } catch (e) { return Object.assign({}, DEF); } },
    list: function () {
      return tx("sites", "readonly", function (st) { return st.getAll(); }).then(function (a) {
        a = (a || []).sort(function (x, y) { return (y.at || 0) - (x.at || 0); });
        ls.set(LIST, JSON.stringify(a.map(function (r) { return r.name; })));
        return a;
      });
    },
    get: function (n) { return tx("sites", "readonly", function (st) { return st.get(n); }).then(function (r) { return r || null; }); },
    put: function (rec) {
      rec.at = Date.now(); rec.settings = Object.assign({}, DEF, rec.settings || {});
      return tx("sites", "readwrite", function (st) { return st.put(rec, rec.name); }).then(function () { mirror(rec); return G.list(); }).then(function () { emit("site", { name: rec.name }); return rec; });
    },
    create: function (n, settings) {
      n = String(n || "").trim(); var e = bad(n); if (e) return Promise.reject(new Error(e));
      return G.get(n).then(function (r) {
        if (r) throw new Error("現場「" + n + "」はもうあります。");
        return G.put({ name: n, created: Date.now(), settings: Object.assign({}, DEF, settings || {}) });
      });
    },
    touch: function (n) { return G.get(n).then(function (r) { if (r) return G.put(r); }); },
    remove: function (n) {
      return Promise.all([
        tx("sites", "readwrite", function (st) { return st.delete(n); }),
        tx("points", "readwrite", function (st) { return st.delete(n); }),
        tx("files", "readwrite", function (st) { return st.delete(range(n)); }),
        tx("apps", "readwrite", function (st) { return st.delete(range(n)); })
      ]).then(function () {
        ls.set("ippatsu.genba.set." + n, null);
        if (G.current() === n) G.setCurrent("");
        return G.list();
      });
    },
    rename: function (a, b) {
      b = String(b || "").trim(); var e = bad(b); if (e) return Promise.reject(new Error(e));
      return G.exportSites([a]).then(function (o) {
        return G.get(b).then(function (r) {
          if (r) throw new Error("現場「" + b + "」はもうあります。");
          o.sites[0].site.name = b; o.sites[0].name = b;
          return G.importSites(o, { overwrite: true }).then(function () { var c = G.current() === a; return G.remove(a).then(function () { if (c) G.setCurrent(b); }); });
        });
      });
    },
    // 図面(1つの現場に何枚でも。いちばん新しく入れたものが「現場の図面」)
    files: function (n) {
      // v2.13.0:前に作った一覧が今の図面と同じ(FEP が同じ・名前の並びが同じ)なら中身を読まずにそれを返す(メニューを開くたびに 30MB を読んでいた)
      var ep = ls.get(FEP) || "", c0 = null; try { c0 = JSON.parse(ls.get(FMETA + n) || "null"); } catch (e) { /* */ }
      return G.fileNames(n).then(function (names) {
        if (c0 && c0.ep === ep && JSON.stringify(c0.names) === JSON.stringify(names)) return c0.list.map(function (f) { return Object.assign({}, f); });
        return scan().then(function (list) { ls.set(FMETA + n, JSON.stringify({ ep: ep, names: names, list: list })); return list; });
      }, function () { return scan(); });
      function scan() {
      // v2.12.0:図面の中身(何十 MB にもなる)を全部いっしょに読まない。1 枚ずつ見て、名前・大きさだけ残す(メモリが足りず落ちるのを防ぐ)
      return new Promise(function (ok, ng) {
        open().then(function (d) {
          var out = [], t = d.transaction("files", "readonly"), rq = t.objectStore("files").openCursor(range(n));
          rq.onsuccess = function () {
            var c = rq.result; if (!c) return;
            var f = c.value; out.push({ name: f.name, size: f.bytes ? f.bytes.byteLength : 0, at: f.at, from: f.from, type: f.type }); f = null;
            c.continue();
          };
          t.oncomplete = function () { d.close(); ok(out.sort(function (x, y) { return (y.at || 0) - (x.at || 0); })); };
          t.onerror = t.onabort = function () { d.close(); ng(t.error || rq.error); };
        }, ng);
      });
      }
    },
    // v2.13.0:「現場の図面」(mainFile、無ければいちばん新しいもの)の名前・大きさだけ。中身は読まない(覚えた一覧から)。
    //   bytes.byteLength も入れて、fileGet の代わりに大きさを出すだけの所(くるくるの現場の情報)でそのまま使えるように
    fileInfo: function (n) {
      return Promise.all([G.files(n), G.get(n)]).then(function (r) {
        var a = r[0] || [], m = r[1] && r[1].mainFile, f = a.filter(function (x) { return x.name === m; })[0] || a[0];
        return f ? { name: f.name, size: f.size, at: f.at, from: f.from, type: f.type, bytes: { byteLength: f.size } } : null;
      });
    },
    // v2.13.0:図面の名前だけ(中身を 1 バイトも読まない。キーだけ)。画面の上の図面の帯に使う
    fileNames: function (n) {
      return tx("files", "readonly", function (st) { return st.getAllKeys ? st.getAllKeys(range(n)) : null; }).then(function (ks) {
        if (!ks) throw new Error("getAllKeys なし");
        return ks.map(function (k) { return String(k).slice(String(k).indexOf("\n") + 1); });
      });
    },
    fileGet: function (n, name) {
      if (name) return tx("files", "readonly", function (st) { return st.get(FK(n, name)); }).then(function (r) { return r || null; });
      return G.get(n).then(function (r) {
        var main = r && r.mainFile;
        return (main ? G.fileGet(n, main) : Promise.resolve(null)).then(function (f) {
          if (f) return f;
          // v2.12.0:いちばん新しい 1 枚だけを残す(全部を一度に読まない)
          return open().then(function (d) {
            return new Promise(function (ok, ng) {
              var best = null, t = d.transaction("files", "readonly"), rq = t.objectStore("files").openCursor(range(n));
              rq.onsuccess = function () { var c = rq.result; if (!c) return; if (!best || (c.value.at || 0) > (best.at || 0)) best = c.value; c.continue(); };
              t.oncomplete = function () { d.close(); ok(best); };
              t.onerror = t.onabort = function () { d.close(); ng(t.error || rq.error); };
            });
          });
        });
      });
    },
    filePut: function (n, f, from) {
      if (RO && !(f && f.save)) return Promise.reject(new Error("脳みそバーンは現場に保存しません"));   // 脳みそバーンの「💾 上書き保存」(f.save)だけは入れる
      var rec = { name: f.name, type: f.type || "", lastModified: f.lastModified || Date.now(), bytes: f.bytes, at: Date.now(), from: from || APP };
      if (f.base) rec.base = f.base;   // 脳みそバーンで直した図面:元の図面の名前
      return tx("files", "readwrite", function (st) { return st.put(rec, FK(n, f.name)); })
        .then(function () { return G.get(n); }).then(function (r) { if (r) { r.mainFile = f.name; return G.put(r); } })
        .then(function () { emit("file", { name: n, file: f.name }); });
    },
    fileDel: function (n, name) {
      return tx("files", "readwrite", function (st) { return st.delete(FK(n, name)); }).then(function () { return G.get(n); })
        .then(function (r) { if (r && r.mainFile === name) { r.mainFile = ""; return G.put(r); } });
    },
    // 座標(現場の座標リスト。X=北・Y=東・H、単位 m)。role: known(既知点)・design(設計の点)
    points: function (n) { return tx("points", "readonly", function (st) { return st.get(n); }).then(function (r) { return r || { points: [] }; }); },
    pointsPut: function (n, pts, from) {
      if (RO) return Promise.reject(new Error("脳みそバーンは現場に保存しません"));
      var rec = { points: pts || [], at: Date.now(), from: from || APP };
      return tx("points", "readwrite", function (st) { return st.put(rec, n); }).then(function () { return G.touch(n); }).then(function () { emit("points", { name: n }); return rec; });
    },
    pointsAdd: function (n, pts, from) {   // 名前が同じで 1 mm 以内の点は飛ばす。名前が同じで位置が違う点は置き換える
      return G.points(n).then(function (r) {
        var cur = (r.points || []).slice(), add = 0, rep = 0, skip = 0;
        (pts || []).forEach(function (q) {
          var nm = String(q.name || "").trim(); if (!nm || !isFinite(q.X) || !isFinite(q.Y)) { skip++; return; }
          var i = cur.findIndex(function (p) { return p.name === nm; });
          var p = { name: nm, X: +q.X, Y: +q.Y, H: isFinite(q.H) ? +q.H : 0, role: q.role || "", src: from || APP };
          if (i < 0) { cur.push(p); add++; }
          else if (Math.hypot(cur[i].X - p.X, cur[i].Y - p.Y) < 0.001 && Math.abs((cur[i].H || 0) - p.H) < 0.001) skip++;
          else { cur[i] = p; rep++; }
        });
        return G.pointsPut(n, cur, from).then(function () { return { add: add, rep: rep, skip: skip, total: cur.length }; });
      });
    },
    // アプリごとの作業(くるくるの器械点・打った杭 など)
    appGet: function (app, n) { return tx("apps", "readonly", function (st) { return st.get(FK(n, app)); }).then(function (r) { return r || null; }); },
    appPut: function (app, n, v) {
      if (RO) return Promise.reject(new Error("脳みそバーンは現場に保存しません"));
      return tx("apps", "readwrite", function (st) { return st.put(v, FK(n, app)); });
    },
    appDel: function (app, n) { return tx("apps", "readwrite", function (st) { return st.delete(FK(n, app)); }); },
    // 現場をまるごとファイルに(バックアップ・別の端末へ)
    exportSites: function (names) {
      var b64 = function (buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      return Promise.all(names.map(function (n) {
        return Promise.all([G.get(n), tx("files", "readonly", function (st) { return st.getAll(range(n)); }), G.points(n),
          tx("apps", "readonly", function (st) { return st.getAllKeys(range(n)); }), tx("apps", "readonly", function (st) { return st.getAll(range(n)); })])
          .then(function (r) {
            var apps = {}; (r[3] || []).forEach(function (k, i) { apps[k.slice(n.length + 1)] = r[4][i]; });
            if (apps.kurukuru && apps.kurukuru.picks) apps.kurukuru = Object.assign({}, apps.kurukuru);
            return { name: n, site: r[0], points: r[2], apps: apps,
              files: (r[1] || []).map(function (f) { return { name: f.name, type: f.type, lastModified: f.lastModified, at: f.at, from: f.from, b64: b64(f.bytes) }; }) };
          });
      })).then(function (sites) { return { kind: "ippatsu-genba", v: 1, at: new Date().toISOString(), sites: sites }; });
    },
    // ECP一撃測量で読める形(kurukuru-site)に書き出す。現場ごとに、くるくるの作業(点・器械点・打った杭)と「現場の図面」1枚
    exportEcp: function (names) {
      var b64 = function (buf) { var u = new Uint8Array(buf), s = ""; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
      return Promise.all(names.map(function (n) {
        return Promise.all([G.get(n), G.appGet("kurukuru", n), G.points(n), G.fileGet(n)]).then(function (r) {
          var set = (r[0] && r[0].settings) || {}, st = r[1] ? Object.assign({}, r[1]) : null, pl = (r[2] && r[2].points) || [], f = r[3];
          if (!st) st = { unit: "m", axis: set.axis || "northEast", dUnit: "mm", dScale: "1", dCustom: "", picks: [], inst: null, k1: null, k2: null, stk: [], target: null, drawXf: null,
            fname: set.code || "", rMax: "100", rMin: "2", hOff: 0, hSign: 1, genba: null, at: Date.now() };
          var hk = st.unit === "mm" ? 1000 : 1, picks = (st.picks || []).slice(), have = {};
          picks.forEach(function (p) { have[p.name] = 1; });
          // 現場の座標で、くるくるにまだ無い点も入れる(ほかのアプリや「📍 座標を読み込む」で入れた点)
          pl.forEach(function (p) { if (!p || have[p.name] || !isFinite(p.X) || !isFinite(p.Y)) return; have[p.name] = 1;
            picks.push({ name: p.name, x: Math.round(p.Y * 1000), y: Math.round(p.X * 1000), h: (+p.H || 0) * hk, kind: "file", role: p.role || "design", src: "一発バーン" }); });
          st.picks = picks;
          return { name: n, state: st, file: f && f.bytes ? { name: f.name, type: f.type || "", lastModified: f.lastModified || Date.now(), b64: b64(f.bytes) } : null };
        });
      })).then(function (sites) { return { kind: "kurukuru-site", v: 1, app: "一発バーン", at: new Date().toISOString(), sites: sites }; });
    },
    importSites: function (o, opt) {
      opt = opt || {};
      var bytes = function (b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
      if (o && o.kind === "kurukuru-site" && Array.isArray(o.sites)) {   // ECP一撃測量・くるくる回し太郎で保存した現場(kurukuru_〜.json)も読める
        o = { kind: "ippatsu-genba", sites: o.sites.filter(function (q) { return q && q.name; }).map(function (q) {
          var st = q.state || null, hk = st && st.unit === "mm" ? 0.001 : 1;
          // くるくるの点(図面の座標 mm)を、現場の座標(X=北・Y=東・m)にも入れて、4本のアプリで使えるようにする
          var pts = st && Array.isArray(st.picks) ? st.picks.filter(function (p) { return p && p.name && isFinite(p.x) && isFinite(p.y); })
            .map(function (p) { return { name: String(p.name), X: p.y / 1000, Y: p.x / 1000, H: (Number(p.h) || 0) * hk, role: p.role || "design", src: "ecp" }; }) : [];
          var fn = q.file && q.file.name ? String(q.file.name).replace(/^(.*?)(\.[A-Za-z0-9]{2,5})\s*(\(\d+\))$/, "$1$3$2") : "";   // 「〜.dxf (1)」→「〜(1).dxf」
          return { name: q.name, site: { name: q.name, created: Date.now(), settings: {} }, points: pts.length ? { points: pts, at: Date.now(), from: "ecp" } : null,
            apps: st ? { kurukuru: st } : {},
            files: q.file && q.file.b64 ? [{ name: fn, type: q.file.type, lastModified: q.file.lastModified, from: "ecp", b64: q.file.b64 }] : [] };
        }) };
      }
      if (!o || o.kind !== "ippatsu-genba" || !Array.isArray(o.sites)) return Promise.reject(new Error("一発バーン・ECP一撃測量・くるくる回し太郎で保存した現場のファイルではありません。"));
      var done = [];
      return o.sites.reduce(function (pr, q) {
        return pr.then(function () {
          var n = String(q.name || (q.site && q.site.name) || "").slice(0, 30); if (!n) return;
          return G.get(n).then(function (r) {
            if (r && !opt.overwrite) {
              var ans = opt.ask ? opt.ask(n) : true;
              if (!ans) { var i = 2; while (G.names().indexOf(n + "(" + i + ")") >= 0) i++; n = n + "(" + i + ")"; }
            }
            var site = Object.assign({}, q.site || {}, { name: n });
            if (!site.created) site.created = Date.now();
            return tx("files", "readwrite", function (st) { return st.delete(range(n)); })
              .then(function () { return tx("apps", "readwrite", function (st) { return st.delete(range(n)); }); })
              .then(function () { return (q.files || []).reduce(function (p2, f) { return p2.then(function () { return tx("files", "readwrite", function (st) { return st.put({ name: f.name, type: f.type || "", lastModified: f.lastModified || Date.now(), at: f.at || Date.now(), from: f.from || "", bytes: bytes(f.b64) }, FK(n, f.name)); }); }); }, Promise.resolve()); })
              .then(function () { return Object.keys(q.apps || {}).reduce(function (p2, a) { return p2.then(function () { return tx("apps", "readwrite", function (st) { return st.put(q.apps[a], FK(n, a)); }); }); }, Promise.resolve()); })
              .then(function () { return q.points ? tx("points", "readwrite", function (st) { return st.put(q.points, n); }) : null; })
              .then(function () { if (!site.mainFile && q.files && q.files[0]) site.mainFile = q.files[0].name; return G.put(site); })
              .then(function () { done.push(n); });
          });
        });
      }, Promise.resolve()).then(function () { return done; });
    }
  };
  // 前のくるくる回し太郎の現場(IndexedDB kurukuru-sites・kr.sites)を、はじめてのときに一発バーンの現場へ移す。移した現場名を返す
  G.migrate = async function () {
          let done = false; try { done = localStorage.getItem("ippatsu.genba.migrated") === "1"; } catch (e) { /* */ }
          if (done || !window.indexedDB) return [];
          try { localStorage.setItem("ippatsu.genba.migrated", "1"); } catch (e) { /* */ }   // 2つの画面で同時に移さないように先に印をつける
          let names = []; try { names = JSON.parse(localStorage.getItem("kr.sites") || "[]") || []; } catch (e) { /* */ }
          const moved = [];
          if (names.length) {
            const db = await new Promise((ok) => { const rq = indexedDB.open("kurukuru-sites", 1); rq.onupgradeneeded = () => { rq.result.createObjectStore("state"); rq.result.createObjectStore("files"); }; rq.onsuccess = () => ok(rq.result); rq.onerror = () => ok(null); });
            const get = (s, n) => new Promise((ok) => { try { const rq = db.transaction(s).objectStore(s).get(n); rq.onsuccess = () => ok(rq.result || null); rq.onerror = () => ok(null); } catch (e) { ok(null); } });
            for (const n of names) {
              if (!db || G.bad(n) || await G.get(n)) continue;
              const st = await get("state", n), fl = await get("files", n);
              let si = {}; try { si = JSON.parse(localStorage.getItem("kr.sinfo." + n) || "{}") || {}; } catch (e) { /* */ }
              await G.create(n, { ...si, code: /^[A-Za-z0-9_-]{1,20}$/.test(n) ? n : "" });
              if (st) await G.appPut("kurukuru", n, st);
              if (fl && fl.bytes) await G.filePut(n, fl, "kurukuru");
              moved.push(n);
            }
            if (db) db.close();
            let cur = ""; try { cur = localStorage.getItem("kr.site") || ""; } catch (e) { /* */ }
            if (cur && !G.current() && await G.get(cur)) G.setCurrent(cur);
          }
          try { localStorage.setItem("ippatsu.genba.migrated", "1"); } catch (e) { /* */ }
          return moved;
  };
  window.Genba = G;
  G.list().catch(function () { /* */ });   // 現場の名前の一覧を localStorage に写しておく

  // ---------------------------------------------------------------- 小窓(共通)
  var CSS = "" +
    ".ipx-ovl{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;background:rgba(15,23,42,.45);display:flex;align-items:flex-start;justify-content:center;padding:calc(env(safe-area-inset-top) + 10px) 10px 10px}" +
    ".ipx-card{width:min(520px,100%);max-height:calc(100vh - 20px);max-height:calc(100dvh - 20px);overflow:auto;background:var(--card,#fff);color:var(--ink,var(--fg,#1d2330));border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.35);padding:14px;font:inherit;font-size:16px}" +
    ".ipx-card h3{margin:0 0 8px;font-size:17px}.ipx-card .ipx-sub{color:var(--sub,#5d6575);font-size:13px;margin:2px 0 8px;line-height:1.5}" +
    ".ipx-card input,.ipx-card textarea,.ipx-card select{width:100%;box-sizing:border-box;font:inherit;font-size:20px;padding:10px 12px;border-radius:10px;border:2px solid var(--accent,#2563eb);background:var(--bg,#fff);color:inherit}" +
    ".ipx-row{display:flex;gap:8px;margin-top:12px}.ipx-row button{flex:1;font:inherit;font-size:17px;font-weight:700;min-height:48px;border-radius:10px;border:1px solid var(--line,#ccd);background:var(--bg,#f4f5f7);color:inherit}" +
    ".ipx-row button.ipx-ok{background:var(--accent,#2563eb);border-color:transparent;color:#fff}" +
    ".ipx-list{display:flex;flex-direction:column;gap:6px;margin-top:6px}.ipx-list button{text-align:left;font:inherit;font-size:16px;padding:12px;border-radius:10px;border:1px solid var(--line,#ccd);background:var(--bg,#f4f5f7);color:inherit}" +
    ".ipx-list button[aria-pressed=true]{border:2px solid var(--accent,#2563eb);font-weight:700}" +
    ".ipx-badge{display:inline-flex;align-items:center;gap:2px;max-width:46vw;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;font-weight:700;padding:4px 8px;margin-left:6px;border-radius:999px;border:1px solid var(--line,#ccd);background:var(--card,#fff);color:inherit;vertical-align:middle;cursor:pointer}" +
    ".ipx-badge.none{color:var(--sub,#5d6575);font-weight:400}" +
    ".ipx-chips{display:flex;flex:0 0 auto;gap:6px;align-items:center;padding:2px 10px 4px;margin:0;overflow-x:auto;white-space:nowrap;scrollbar-width:none}.ipx-chips::-webkit-scrollbar{display:none}.ipx-chips .ipx-badge,.ipx-chips button{margin:0!important;flex:0 0 auto;width:auto!important;min-height:0!important;min-width:0!important}" +
    ".ipx-docs{display:inline-flex;gap:4px;align-items:center}.ipx-badge.doc{max-width:none;font-weight:400}.ipx-badge.doc[aria-pressed=true]{background:var(--accent,#2563eb);color:#fff;border-color:transparent;font-weight:700}.ipx-badge.doc.add{color:var(--accent,#2563eb);border-style:dashed}" +
    ".ipx-badge.mode{max-width:none;color:#0f766e;border-color:#0f766e}" +
    "body.ipx-easy details.adv,body.ipx-easy .step-note,body.ipx-easy .help-btn{display:none!important}" +
    "body.ipx-easy button.big,body.ipx-easy .seg-toggle button,body.ipx-easy .filebtn button{font-size:17px;min-height:50px}" +
    "body.ipx-easy .status{font-size:16px}" +
    ".ipx-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0;padding:8px 10px;border-radius:10px;border:1px dashed var(--accent,#2563eb);font-size:14px}" +
    ".ipx-bar button{width:auto!important;min-height:0!important;flex:0 0 auto;margin:0!important;font:inherit;font-weight:700;padding:8px 12px;border-radius:8px;border:0;background:var(--accent,#2563eb);color:#fff}.ipx-bar .ipx-x{background:transparent;color:inherit;border:1px solid var(--line,#ccd)}";
  function addCss() { if (document.getElementById("ipx-css")) return; var s = document.createElement("style"); s.id = "ipx-css"; s.textContent = CSS; document.head.appendChild(s); }
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  G.esc = esc;
  // 小窓を出す。body は HTML、buttons は [{ label, ok?, run }]。run が false を返すと閉じない
  G.dialog = function (title, body, buttons, sub) {
    addCss();
    var o = el("div", { "class": "ipx-ovl", role: "dialog", "aria-modal": "true" });
    var c = el("div", { "class": "ipx-card" }, "<h3>" + esc(title) + "<\/h3>" + (sub ? '<div class="ipx-sub">' + sub + "<\/div>" : "") + (body || ""));
    var row = el("div", { "class": "ipx-row" });
    var close = function () { o.remove(); document.removeEventListener("keydown", key, true); };
    (buttons || [{ label: "閉じる" }]).forEach(function (b) {
      var bt = el("button", { type: "button", "class": b.ok ? "ipx-ok" : "" }); bt.textContent = b.label;
      bt.onclick = function () { var r = b.run ? b.run(c) : true; if (r !== false) close(); };
      row.appendChild(bt);
    });
    if (buttons !== null) c.appendChild(row);
    o.appendChild(c);
    o.addEventListener("click", function (e) { if (e.target === o) close(); });
    var key = function (e) { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("keydown", key, true);
    document.body.appendChild(o);
    return { el: c, close: close };
  };

  // ---------------------------------------------------------------- 入力の小窓
  // 画面の中の数字・文字の欄を押すと、上の小窓で入れる(元の欄はキーボードを出さない)。
  // 小窓の中・操作盤や点の入力のような固定の画面(.dlg・.ovl・.ipx-card)・data-noipx の欄はそのまま。
  var TEXTY = /^(text|number|search|tel|url|email|password|)$/;
  function labelOf(inp) {
    var t = "";
    if (inp.id) { var l = document.querySelector('label[for="' + inp.id + '"]'); if (l) t = l.textContent; }
    if (!t) { var p = inp.closest("label"); if (p) t = p.textContent; }
    if (!t) t = inp.getAttribute("aria-label") || inp.getAttribute("title") || inp.placeholder || "";
    if (!t) { var prev = inp.previousElementSibling; if (prev && prev.textContent.length < 40) t = prev.textContent; }
    return (t || "入力").replace(/\s+/g, " ").trim().slice(0, 60);
  }
  function wants(inp) {
    if (!inp || inp.disabled || inp.readOnly) return false;
    if (inp.tagName === "TEXTAREA") return !inp.closest(".dlg, .ovl, .ipx-card, [data-noipx]");
    if (inp.tagName !== "INPUT" || !TEXTY.test(inp.type || "")) return false;
    if (inp.hasAttribute("data-noipx") || inp.closest(".dlg, .ovl, .ipx-card, [data-noipx]")) return false;
    return true;
  }
  function editIn(inp) {
    var isNum = inp.type === "number", ta = inp.tagName === "TEXTAREA";
    var mode = inp.getAttribute("inputmode") || (isNum ? "decimal" : "");
    var f = ta ? '<textarea rows="5"><\/textarea>' : '<input type="' + (isNum ? "text" : (inp.type || "text")) + '"' + (mode ? ' inputmode="' + esc(mode) + '"' : "") + ' autocomplete="off" spellcheck="false" />';
    var hint = isNum ? [inp.min !== "" ? "最小 " + inp.min : "", inp.max !== "" ? "最大 " + inp.max : ""].filter(Boolean).join("・") : "";
    var d = G.dialog(labelOf(inp), f + (isNum ? '<div class="ipx-sub" style="margin-top:6px">数字で入れてください' + (hint ? "(" + hint + ")" : "") + "。- や . も使えます。<\/div>" : ""), [
      { label: "やめる" },
      { label: "決定", ok: true, run: function (c) {
        var v = c.querySelector("input,textarea").value;
        if (isNum) { v = v.replace(/[０-９．－]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); }).replace(/ー|−/g, "-").trim(); if (v !== "" && !isFinite(Number(v))) { c.querySelector(".ipx-sub").textContent = "数字ではありません。"; return false; } }
        if (inp.maxLength > 0 && v.length > inp.maxLength) v = v.slice(0, inp.maxLength);
        var set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), "value").set; set.call(inp, v);
        inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
      } }
    ]);
    var box = d.el.querySelector("input,textarea"); box.value = inp.value;
    box.addEventListener("keydown", function (e) { if (e.key === "Enter" && !ta) { e.preventDefault(); d.el.querySelector(".ipx-ok").click(); } });
    setTimeout(function () { box.focus(); try { box.select(); } catch (e) { /* */ } }, 30);
  }
  G.inputDialog = true;
  // 押したとき:元の欄を一時的に読むだけにして(キーボードを出さない)、指を離したら小窓を出す。指を動かした(画面を動かした)ときは何もしない
  var pend = null;
  var undo = function () { if (pend) { pend.readOnly = false; pend = null; } };
  document.addEventListener("pointerdown", function (e) {
    undo();
    var inp = e.target; if (!wants(inp) || window.IPPATSU_NO_INPUT_DIALOG) return;
    pend = inp; inp.readOnly = true;
  }, true);
  document.addEventListener("pointercancel", function () { setTimeout(undo, 0); }, true);
  document.addEventListener("click", function (e) {
    var inp = pend; if (!inp) return;
    if (e.target !== inp) { undo(); return; }
    e.preventDefault(); inp.readOnly = false; pend = null; inp.blur(); editIn(inp);
  }, true);

  // ---------------------------------------------------------------- 現場のバッジ(アプリの見出し)
  function siteBadge() {
    if (APP === "menu" || !APP) return;
    var row = chips(); if (!row) return;
    var b = el("button", { type: "button", "class": "ipx-badge", id: "ipxSite", title: "いまの現場(押すと切り替え)" });
    row.insertBefore(b, row.firstChild);
    var draw = function () { var n = G.current(); b.textContent = n ? "🏗 " + n : "🏗 現場なし"; b.classList.toggle("none", !n); };
    draw(); window.addEventListener("genba", draw);
    b.addEventListener("click", function () { G.pick(); });
  }
  // かんたん画面/くわしい画面(アプリごとに覚える)。かんたん画面は「くわしい設定」(details.adv)と説明の文を隠して、ボタンを大きくする
  var EZ = "ippatsu.easy." + APP;
  G.easy = function () { return ls.get(EZ) === "1"; };
  G.setEasy = function (on) { ls.set(EZ, on ? "1" : "0"); document.body.classList.toggle("ipx-easy", !!on); var m = document.getElementById("ipxMode"); if (m) m.textContent = on ? "かんたん" : "くわしい"; emit("easy", { on: !!on }); };
  function modeChip() {
    if (APP === "menu" || !APP) return;
    document.body.classList.toggle("ipx-easy", G.easy());
    var row = chips(); if (!row) return;
    var b = el("button", { type: "button", "class": "ipx-badge mode", id: "ipxMode", title: "かんたん画面とくわしい画面を切り替える" });
    b.textContent = G.easy() ? "かんたん" : "くわしい";
    b.addEventListener("click", function () { G.setEasy(!G.easy()); });
    row.appendChild(b);
  }
  // 見出しのすぐ下の細い行(現場・かんたん/くわしい)
  function chips() {
    var r = document.getElementById("ipxChips"); if (r) return r;
    var h = document.querySelector("header"); if (!h) return null;
    addCss();
    r = el("div", { id: "ipxChips", "class": "ipx-chips" }); h.parentNode.insertBefore(r, h.nextSibling); return r;
  }
  // 現場を選ぶ小窓。選んだら、アプリを読み直してその現場を開く
  G.pick = function (after) {
    G.list().then(function (a) {
      var cur = G.current();
      var body = '<div class="ipx-list">' + ['<button type="button" data-n="" aria-pressed="' + (!cur) + '">(現場を選ばない)<\/button>'].concat(a.map(function (r) {
        return '<button type="button" data-n="' + esc(r.name) + '" aria-pressed="' + (r.name === cur) + '">🏗 ' + esc(r.name) + (r.settings && r.settings.memo ? '<br><small>' + esc(r.settings.memo) + "<\/small>" : "") + "<\/button>";
      })).join("") + "<\/div>";
      var btns = [{ label: "閉じる" }];
      if (APP && APP !== "menu") btns.unshift({ label: G.easy() ? "くわしい画面にする" : "かんたん画面にする", run: function () { G.setEasy(!G.easy()); } });
      var d = G.dialog("現場を選ぶ", body, btns,
        "現場を作る・名前を変える・消す・設定は、一発バーンのメニュー(左上の ⌂)で行います。" + (a.length ? "" : "<br><b>まだ現場がありません。<\/b>"));
      d.el.querySelector(".ipx-list").addEventListener("click", function (e) {
        var t = e.target.closest("button[data-n]"); if (!t) return;
        var n = t.getAttribute("data-n"); d.close();
        if (n === cur) return;
        G.setCurrent(n);
        if (after) after(n); else if (APP !== "menu") location.reload();
      });
    }).catch(function (e) { G.dialog("現場", "", null, esc(e.message)); });
  };

  // ---------------------------------------------------------------- 現場の図面を開く・開いた図面を現場に入れる(どのアプリでも同じ)
  // アプリの「図面を開く」欄(#file)を使う。開いた図面は、いまの現場に入れる(脳みそバーンは入れない)
  var opening = false;
  function fileInput() { return document.getElementById("file"); }
  G.openInApp = function (f) {
    var inp = fileInput(); if (!inp || !f || !f.bytes) return false;
    try {
      var file = new File([f.bytes], f.name, { type: f.type || "", lastModified: f.lastModified || Date.now() });
      var dt = new DataTransfer(); dt.items.add(file); opening = true; docBusy = true; inp.files = dt.files; CURDOC = f.name; docAdd({ name: f.name, type: f.type || "", lastModified: f.lastModified || Date.now(), bytes: f.bytes });
      inp.dispatchEvent(new Event("change", { bubbles: true })); opening = false; docBusy = false; docStrip(); return true;
    } catch (e) { opening = false; docBusy = false; return false; }
  };
  function hookFile() {
    var inp = fileInput(); if (!inp || APP === "kurukuru") return;   // くるくるは自分で現場に入れる
    inp.addEventListener("change", function () {
      var n = G.current(), f = inp.files && inp.files[0];
      if (opening || RO || !n || !f) return;
      f.arrayBuffer().then(function (buf) { return G.filePut(n, { name: f.name, type: f.type, lastModified: f.lastModified, bytes: buf }, APP); })
        .then(function () { bar("✓ 図面「" + esc(f.name) + "」を現場「" + esc(n) + "」に入れました。", null, 5000); })
        .catch(function (e) { bar("⚠ 図面を現場に入れられません: " + esc(e.message)); });
    });
  }
  // 見出しの下に出す細い知らせ(ボタンつき)
  function bar(html, btn, ms) {
    addCss();
    var old = document.getElementById("ipxBar"); if (old) old.remove();
    var h = document.querySelector("header"); if (!h) return;
    var b = el("div", { "class": "ipx-bar", id: "ipxBar" }, "<span style=\"flex:1 1 0;min-width:0\">" + html + "<\/span>");
    if (btn) { var x = el("button", { type: "button" }); x.textContent = btn.label; x.onclick = function () { b.remove(); btn.run(); }; b.appendChild(x); }
    var c = el("button", { type: "button", "class": "ipx-x", "aria-label": "閉じる" }); c.textContent = "✕"; c.onclick = function () { b.remove(); }; b.appendChild(c);
    h.parentNode.insertBefore(b, h.nextSibling);
    if (ms) setTimeout(function () { b.remove(); }, ms);
  }
  G.bar = bar;
  function offerSiteFile() {
    var n = G.current(); if (!n || APP === "kurukuru" || !fileInput()) return;
    // v2.13.0:「現場の図面」の名前は現場の記録(mainFile)とキーから。中身は読まない(無いときだけ前のやり方でいちばん新しい図面をさがす)
    Promise.all([G.get(n), G.fileNames(n)]).then(function (r) {
      var main = r[0] && r[0].mainFile;
      if (main && r[1].indexOf(main) >= 0) return { name: main };
      return r[1].length ? G.fileGet(n) : null;
    }).then(function (f) {
      if (!f) { bar("現場「" + esc(n) + "」にはまだ図面がありません。" + (RO ? "" : "ここで図面を開くと、現場に入ります。")); return; }
      // v2.13.0:図面の中身(何十 MB)を「📂 開く」を押すまで持ち続けない。名前だけ覚えて、押したときに読み直す
      var fname = f.name; f = null;
      bar("現場「" + esc(n) + "」の図面「" + esc(fname) + "」", { label: "📂 開く", run: function () { G.fileGet(n, fname).then(function (r) { if (!r || !G.openInApp(r)) bar("⚠ 図面を開けませんでした。"); }); } });
    }).catch(function () { /* */ });
  }
  // ---------------------------------------------------------------- DWG を開く(4本とも)
  // 【ECP一撃測量 v1.18.0 から】DWG は端末の中で DXF に変えてから、いつもの DXF の読み込みに渡す。
  // 部品は GNU LibreDWG を wasm にしたもの(vendor/libredwg、@mlightcad/libredwg-web 0.8.8、GPL-3.0)。DWG を開いたときだけ読み込む
  var dwgMod = null;
  G.isDwg = function (name, u8) { return /\.dwg$/i.test(name || "") || (u8 && u8.length > 6 && /^AC10\d\d/.test(String.fromCharCode.apply(null, u8.subarray(0, 6)))); };
  G.dwgToDxf = async function (bytes) {
    if (!dwgMod) {
      // 部品(wasm)は自分で取って中身を確かめてから渡す(電波が無いと別のページが返ってきて固まるため)
      var base = new URL("vendor/libredwg/", location.href).href;
      var NG = "DWG を開く部品を読み込めませんでした。電波のある所(杭ナビの Wi-Fi を切って)で一度 DWG を開くと、あとは現場でも開けます。";
      // 2026-11-25:部品は Chrome 85 からの書き方(||= など)を使う。古い WebView(OPPO A73 の Android 10 など)では読めないので、そう知らせる
      var cv = /Chrome\/(\d+)/.exec(navigator.userAgent || ""), OLD = "この端末の Android System WebView が古い(Chrome " + (cv ? cv[1] : "?") + ")ので DWG を開けません。Play ストアで「Android System WebView」を更新するか、DWG を DXF に書き出して開いてください。";
      if (cv && +cv[1] < 85) throw new Error(OLD);
      var bin;
      try { var r = await fetch(base + "libredwg-web.wasm"); if (!r.ok) throw 0; bin = new Uint8Array(await r.arrayBuffer()); } catch (e) { throw new Error(NG); }
      if (bin.length < 1e6 || bin[0] !== 0 || bin[1] !== 0x61 || bin[2] !== 0x73 || bin[3] !== 0x6d) throw new Error(NG);
      var m; try { m = await import(base + "libredwg-web.js"); } catch (e) { throw new Error(e && e.name === "SyntaxError" ? OLD : NG); }
      dwgMod = await m.default({ locateFile: function (f) { return base + f; }, wasmBinary: bin });
    }
    var FS = dwgMod.FS, ex = function (n) { return FS.analyzePath(n, false).exists; };
    try {
      FS.writeFile("/in.dwg", new Uint8Array(bytes));
      var rc = dwgMod.dwg_write_dxf("/in.dwg", "/out.dxf");
      if (!ex("/out.dxf")) throw new Error("変換できませんでした(コード " + rc + ")");
      var out = FS.readFile("/out.dxf");
      if (out.length < 100) throw new Error("変換した中身が空でした");
      return out;
    } finally { ["/in.dwg", "/out.dxf"].forEach(function (n) { if (ex(n)) FS.unlink(n); }); }
  };
  // ---------------------------------------------------------------- 図面を何枚も(4本とも)
  // 開いた図面は、見出しの下の行に「📄 名前」で並ぶ。押すとその図面に切り替わる。「📂 ひらく」で何枚もまとめて選べる。
  // 現場を選んでいれば現場の図面(一発バーンの「図面を読み込む」で入れたものも)も並ぶ。脳みそバーンは現場に入れず、この画面の間だけ覚える。
  var DOCS = [], CURDOC = "", docBusy = false;
  var DRAW_RE = /\.(dxf|dwg|zrd|zsdx|zsdxz|sfc|ant|csv|sim|sima|txt)$/i, XML_RE = /\.(xml|landxml)$/i;
  function docAdd(rec) { DOCS = DOCS.filter(function (d) { return d.name !== rec.name; }); DOCS.push(rec); }
  function docOpen(rec) {
    if (!G.openInApp(rec)) { bar("⚠ 図面「" + esc(rec.name) + "」を開けませんでした。"); return; }
    CURDOC = rec.name; docStrip();
  }
  function docList() {
    var n = G.current();
    // v2.13.0:名前だけ読む(前は現場の図面の中身を全部読んでいた。30MB の図面なら開くたびに 30MB)。並びは名前順、現場の図面を最後に
    var site = n && APP !== "menu" ? Promise.all([G.fileNames(n), G.get(n)]).then(function (r) {
      var main = r[1] && r[1].mainFile;
      return r[0].sort(function (x, y) { return (x === main) - (y === main) || (x < y ? -1 : x > y ? 1 : 0); }).map(function (nm) { return { name: nm }; }).reverse();
    }).catch(function () { return []; }) : Promise.resolve([]);
    return site.then(function (a) {
      var names = [], seen = {};
      a.filter(function (f) { return DRAW_RE.test(f.name) || !XML_RE.test(f.name); }).slice().reverse().forEach(function (f) { if (!seen[f.name]) { seen[f.name] = 1; names.push({ name: f.name, site: true }); } });
      DOCS.forEach(function (d) { if (!seen[d.name]) { seen[d.name] = 1; names.push({ name: d.name, site: false }); } });
      return names;
    });
  }
  function docGet(name) {
    var d = DOCS.filter(function (x) { return x.name === name; })[0]; if (d) return Promise.resolve(d);
    var n = G.current(); return n ? G.fileGet(n, name) : Promise.resolve(null);
  }
  var short = function (s) { s = String(s).replace(/\.[^.]+$/, ""); return s.length > 12 ? s.slice(0, 11) + "…" : s; };
  function docStrip() {
    if (APP === "menu" || !APP || !fileInput()) return;
    var row = chips(); if (!row) return;
    var s = document.getElementById("ipxDocs");
    if (!s) {
      s = el("span", { id: "ipxDocs", "class": "ipx-docs" }); var site0 = document.getElementById("ipxSite"); row.insertBefore(s, site0 ? site0.nextSibling : row.firstChild);
      s.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        if (b.dataset.act === "add") { var inp = fileInput(); inp.setAttribute("multiple", ""); fpOpen(inp); return; }
        if (b.dataset.act === "list") { docDialog(); return; }
        var nm = b.dataset.doc; if (!nm || nm === CURDOC) return;
        docGet(nm).then(function (rec) { if (rec) docOpen(rec); else bar("⚠ 図面「" + esc(nm) + "」が見つかりません。"); });
      });
    }
    docList().then(function (a) {
      var h = a.map(function (d) { return '<button type="button" class="ipx-badge doc" data-doc="' + esc(d.name) + '" aria-pressed="' + (d.name === CURDOC) + '" title="' + esc(d.name) + '">📄 ' + esc(short(d.name)) + "<\/button>"; }).join("");
      s.innerHTML = h + '<button type="button" class="ipx-badge doc add" data-act="add" title="図面を足す(何枚でも選べます)">＋図面<\/button>' + (a.length > 1 ? '<button type="button" class="ipx-badge doc" data-act="list" title="図面の一覧">☰<\/button>' : "");
      var cur = s.querySelector('[aria-pressed="true"]'); if (cur && cur.scrollIntoView) try { cur.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* */ }
    });
  }
  G.docStrip = docStrip;
  function docDialog() {
    docList().then(function (a) {
      var body = '<div class="ipx-list">' + a.map(function (d) {
        return '<div style="display:flex;gap:6px"><button type="button" style="flex:1" data-open="' + esc(d.name) + '" aria-pressed="' + (d.name === CURDOC) + '">📄 ' + esc(d.name) + (d.site ? " <small>(現場)<\/small>" : "") + '<\/button><button type="button" style="flex:0 0 auto" data-del="' + esc(d.name) + '" aria-label="外す">✕<\/button><\/div>';
      }).join("") + "<\/div>";
      var dl = G.dialog("図面の一覧", body, [{ label: "閉じる" }], "押すとその図面に切り替わります。✕ はこの一覧から外します" + (RO || !G.current() ? "。" : "(現場からも消します)。"));
      dl.el.querySelector(".ipx-list").addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        if (b.dataset.open) { dl.close(); if (b.dataset.open !== CURDOC) docGet(b.dataset.open).then(function (r) { if (r) docOpen(r); }); return; }
        var nm = b.dataset.del; if (!nm) return;
        DOCS = DOCS.filter(function (d) { return d.name !== nm; });
        var n = G.current(); (n && !RO ? G.fileDel(n, nm).catch(function () {}) : Promise.resolve()).then(function () { b.parentNode.remove(); docStrip(); });
      });
    });
  }
  function readRec(f) { return f.arrayBuffer().then(function (buf) { return { name: f.name, type: f.type || "", lastModified: f.lastModified || Date.now(), bytes: buf }; }); }
  document.addEventListener("change", function (e) {   // 図面を開く欄で選んだ図面を覚える。何枚も選んだら、全部覚えて 1 枚目を開く
    var inp = e.target; if (!inp || inp.id !== "file" || !inp.files || !inp.files.length || APP === "menu") return;
    if (dwgBusy || docBusy) return;   // DWG を DXF に変えたあと・切り替えのときは、もう覚えている
    var fs = Array.prototype.slice.call(inp.files);
    if (fs.length === 1) {
      var f = fs[0]; if (XML_RE.test(f.name)) return;   // LandXML は 3D(🗻)へ
      CURDOC = f.name; readRec(f).then(function (r) { docAdd(r); docStrip(); });
      return;
    }
    e.stopImmediatePropagation();
    var xmls = fs.filter(function (f) { return XML_RE.test(f.name); }), drs = fs.filter(function (f) { return !XML_RE.test(f.name); });
    Promise.all(drs.map(readRec)).then(function (recs) {
      recs.forEach(docAdd);
      var n = G.current(), put = Promise.resolve();
      if (n && !RO) recs.slice(1).concat(recs.slice(0, 1)).forEach(function (r) { put = put.then(function () { return G.filePut(n, r, APP); }).catch(function () {}); });   // 1 枚目を「現場の図面」に
      return put.then(function () {
        if (recs.length) {
          var r0 = recs[0], file = new File([r0.bytes], r0.name, { type: r0.type, lastModified: r0.lastModified }), dt = new DataTransfer(); dt.items.add(file);
          CURDOC = r0.name; docBusy = true; opening = true; inp.files = dt.files;
          try { inp.dispatchEvent(new Event("change", { bubbles: true })); } finally { docBusy = false; opening = false; }
          bar("✓ 図面 " + recs.length + " 枚を読み込みました。見出しの下の「📄」で切り替えられます。", null, 6000);
        }
        docStrip();
        if (xmls.length && window.IPPATSU_XS && window.IPPATSU_XS.loadFile) xmls.reduce(function (p, f) { return p.then(function () { return window.IPPATSU_XS.loadFile(f); }); }, Promise.resolve());
      });
    });
  }, true);
  window.addEventListener("genba", function (e) { if (e.detail && (e.detail.type === "file" || e.detail.type === "current")) docStrip(); });
  // ---------------------------------------------------------------- ファイルを選ぶ前の小窓(戻る付き)(2026-11-16 ゆきちゃん)
  // 「📂 ひらく」など、ファイルを選ぶ欄を押したら、まずこの小窓を出す(端末のファイル・現場の図面・戻る)。
  // 端末のファイルの画面(ファイルマネージャー)で「戻る」操作をしたら、またこの小窓に戻る。
  var fpPass = false, fpWait = null, fpDlg = null;
  function fpClose() { if (fpDlg) { try { fpDlg.close(); } catch (e) { /* */ } fpDlg = null; } }
  function fpShow(inp) {
    fpClose();
    var isMain = inp.id === "file" && APP !== "menu", n = G.current();
    var what = isMain ? "図面・点ファイル" : "ファイル";
    var btns = [{ label: "📂 端末のファイルから選ぶ", ok: true, run: function () { fpOpen(inp); } }];
    if (isMain && n) btns.push({ label: "📄 現場「" + n + "」の図面から", run: function () { fpDlg = null; setTimeout(function () { fpSite(inp); }, 0); } });
    btns.push({ label: "戻る", run: function () { fpDlg = null; } });
    fpDlg = G.dialog("ファイルを選ぶ", "", btns, esc(what) + "を選びます。端末のファイルの画面で戻る(◀・下から上へのスワイプ)と、この画面に戻ります。");
    var row = fpDlg.el.querySelector(".ipx-row"); if (row) row.style.flexDirection = "column";
  }
  function fpOpen(inp) {
    fpDlg = null; fpWait = { inp: inp, t: Date.now(), done: false };
    fpPass = true; try { inp.click(); } finally { fpPass = false; }
  }
  function fpSite(inp) {
    var n = G.current(); if (!n) return;
    G.files(n).then(function (a) {
      a = a.filter(function (f) { return !XML_RE.test(f.name); });
      if (!a.length) { G.dialog("現場の図面", "", [{ label: "戻る", run: function () { setTimeout(function () { fpShow(inp); }, 0); } }], "現場「" + esc(n) + "」にはまだ図面がありません。"); return; }
      var body = '<div class="ipx-list">' + a.map(function (f) { return '<button type="button" data-n="' + esc(f.name) + '">📄 ' + esc(f.name) + "<\/button>"; }).join("") + "<\/div>";
      var d = G.dialog("現場「" + n + "」の図面", body, [{ label: "戻る", run: function () { setTimeout(function () { fpShow(inp); }, 0); } }]);
      d.el.querySelector(".ipx-list").addEventListener("click", function (e) {
        var b = e.target.closest("button[data-n]"); if (!b) return; d.close();
        G.fileGet(n, b.dataset.n).then(function (r) { if (r) docOpen(r); });
      });
    });
  }
  document.addEventListener("click", function (e) {
    var inp = e.target;
    if (fpPass || !inp || inp.tagName !== "INPUT" || inp.type !== "file" || inp.disabled || inp.hasAttribute("data-nofp")) return;
    e.preventDefault(); e.stopPropagation();
    fpShow(inp);
  }, true);
  document.addEventListener("change", function (e) {   // 選べたら待ちを終える
    if (e.target && e.target.type === "file" && fpWait) fpWait.done = true;
    fpClose();
  }, true);
  document.addEventListener("cancel", function (e) {   // ファイルの画面で戻った(新しい Chrome)
    if (!fpWait || e.target !== fpWait.inp) return;
    var w = fpWait; fpWait = null; setTimeout(function () { fpShow(w.inp); }, 50);
  }, true);
  var fpBack = function () {   // 古い Chrome・Android:画面に戻ってきても選ばれていなければ「戻った」とみなす
    if (!fpWait || document.hidden) return;
    var w = fpWait;
    setTimeout(function () { if (fpWait === w && !w.done && Date.now() - w.t > 600) { fpWait = null; fpShow(w.inp); } }, 1500);
  };
  window.addEventListener("focus", fpBack);
  document.addEventListener("visibilitychange", fpBack);
  var dwgBusy = false;
  // ---------------------------------------------------------------- SFC(SXF)・A納図(.ANT)を開く(2026-11-19 ゆきちゃん「A納図と SFC のデータ読み込み」)
  // どちらも端末の中で DXF(mm・Shift_JIS)に変えてから、いつもの DXF の読み込みに渡す(DWG と同じやり方。4 本とも)。
  // SFC: SXF Ver.2/3 のフィーチャコメント(公開の形式)。線・折れ線・円・円弧・だ円(弧)・文字・点。複合図形は置いた所へ動かす(用紙の図形(種類1)は縮尺だけなので動かさない)。
  //      寸法・引出線・ハッチは読まない。
  // ANT: A納図(A-NOTE)の図面。中身を読み解いて(2026-11-19、5.53 の図面と同じ図面の SFC で照合:線 75529 本すべて一致)線・折れ線・円・円弧・だ円・文字・点を読む。
  //      文字の大きさは用紙の mm で入っているので、図面の広さから縮尺(1/1000 など)を見積もってかける。寸法は読まない。うまく読めないときは A納図で SFC に書き出して開く。
  var SXF_RE = /\.(sfc|ant)$/i;
  var SJT = null;
  G.sjisBytes = function (text) {
    if (!SJT) {
      SJT = new Map(); var dec = new TextDecoder("shift_jis");
      for (var a = 0x81; a <= 0xfc; a++) { if (a > 0x9f && a < 0xe0) continue; for (var b = 0x40; b <= 0xfc; b++) { if (b === 0x7f) continue; var ch = dec.decode(new Uint8Array([a, b])); if (ch.length === 1 && ch !== "�" && !SJT.has(ch)) SJT.set(ch, [a, b]); } }
      for (var k = 0xa1; k <= 0xdf; k++) SJT.set(dec.decode(new Uint8Array([k])), [k]);
    }
    var out = new Uint8Array(text.length * 2 + 16), o = 0;   // 2026-11-25:大きい図面でも配列が長くなりすぎないように(1 文字は 2 バイトまで)
    for (var ch2 of text) { var c = ch2.codePointAt(0); if (c < 128) out[o++] = c; else if (SJT.has(ch2)) { var v = SJT.get(ch2); out[o++] = v[0]; if (v.length > 1) out[o++] = v[1]; } else out[o++] = 0x3f; }
    return out.slice(0, o);
  };
  // 図形(共通の形)→ DXF。E = { layers:[名前], ents:[{t:"line"|"poly"|"circle"|"arc"|"text"|"point", lay(番号), ...}] }
  function entsToDxf(E) {
    var L = [], f = function (v) { return Number.isFinite(v) ? (Math.round(v * 1e6) / 1e6).toString() : "0"; };
    var g = function (c, v) { L.push(String(c), typeof v === "number" ? (c >= 60 && c < 100 ? String(Math.round(v)) : f(v)) : String(v)); };
    var ln = function (i) { var s = E.layers[i]; return (s == null || s === "" ? "0" : String(s)).replace(/[\r\n]/g, " "); };
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$DWGCODEPAGE"); g(3, "ANSI_932"); g(9, "$INSUNITS"); g(70, 4); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    E.ents.forEach(function (e) {
      var y = ln(e.lay);
      if (e.t === "line") { g(0, "LINE"); g(8, y); g(10, e.x1); g(20, e.y1); g(11, e.x2); g(21, e.y2); }
      else if (e.t === "poly") { if (e.pts.length < 2) return; g(0, "POLYLINE"); g(8, y); g(66, 1); g(70, e.closed ? 1 : 0); e.pts.forEach(function (p) { g(0, "VERTEX"); g(8, y); g(10, p[0]); g(20, p[1]); }); g(0, "SEQEND"); }
      else if (e.t === "circle") { g(0, "CIRCLE"); g(8, y); g(10, e.x); g(20, e.y); g(40, e.r); }
      else if (e.t === "arc") { g(0, "ARC"); g(8, y); g(10, e.x); g(20, e.y); g(40, e.r); g(50, e.a0); g(51, e.a1); }
      else if (e.t === "point") { g(0, "POINT"); g(8, y); g(10, e.x); g(20, e.y); }
      else if (e.t === "text") {
        var s = String(e.s || "").replace(/[\r\n]+/g, " "); if (!s.trim()) return;
        g(0, "TEXT"); g(8, y); g(10, e.x); g(20, e.y); g(40, e.h > 0 ? e.h : 300); g(1, s); if (e.ang) g(50, e.ang);
        var b = e.b || 1, ha = (b - 1) % 3, va = [1, 2, 3][Math.floor((b - 1) / 3)] || 1;   // SXF の基点 1 左下 … 9 右上
        if (b > 1) { g(72, ha); g(73, va); g(11, e.x); g(21, e.y); }
      }
    });
    g(0, "ENDSEC"); g(0, "EOF");
    return L.join("\r\n") + "\r\n";
  }
  function ellPts(cx, cy, rx, ry, rot, a0, a1, full) {   // だ円(弧)を点の列に(度)
    var r = rot * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r), s = a0 * Math.PI / 180, e = a1 * Math.PI / 180, P = [];
    if (full) e = s + Math.PI * 2; else { while (e <= s) e += Math.PI * 2; }
    var n = Math.max(8, Math.ceil((e - s) / (Math.PI / 36)));
    for (var k = 0; k <= n; k++) { var t = s + (e - s) * k / n, x = rx * Math.cos(t), yy = ry * Math.sin(t); P.push([cx + x * cr - yy * sr, cy + x * sr + yy * cr]); }
    return P;
  }
  // SFC: 「/*SXF #n = 名前(引数) SXF*/」の並び
  function sfcArgs(s) {
    var out = [], i = 0, n = s.length;
    while (i < n) {
      var c = s[i];
      if (c === " " || c === "," || c === "\r" || c === "\n" || c === "\t") { i++; continue; }
      var j;
      if (c === "\\" && s[i + 1] === "'") { j = s.indexOf("\\'", i + 2); if (j < 0) j = n; out.push(s.slice(i + 2, j)); i = j + 2; }
      else if (c === "'") {
        j = s.indexOf("'", i + 1); if (j < 0) j = n; var q = s.slice(i + 1, j);
        // 2026-11-25 v2.11.1:数の並びを '(…)' と引用符でくくる SFC もある(中ノ谷川の SFC)。並びとして読む(文字のままだと 1 文字ずつ点にして固まっていた)
        out.push(/^\(\s*[-+0-9.eE,\s]*\)$/.test(q) ? q.slice(1, -1).split(",").map(Number) : q); i = j + 1;
      }
      else if (c === "(") { j = s.indexOf(")", i); if (j < 0) j = n; out.push(s.slice(i + 1, j).split(",").map(Number)); i = j + 1; }
      else { j = s.indexOf(",", i); if (j < 0) j = n; out.push(s.slice(i, j).trim()); i = j; }
    }
    return out;
  }
  var unX2 = function (s) { return String(s).replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, function (m, h) { var t = ""; for (var k = 0; k + 4 <= h.length; k += 4) t += String.fromCharCode(parseInt(h.slice(k, k + 4), 16)); return t; }); };
  G.sfcToEnts = function (text) {
    var re = /#\d+\s*=\s*([a-z_0-9]+)\(([\s\S]*?)\)\s*\r?\n?\s*SXF\*\//g, m, layers = [], ents = [], cur = [], groups = {}, N = Number;
    var add = function (e) { ents.push(e); cur.push(e); };
    while ((m = re.exec(text))) {
      var k = m[1], a;
      if (!/^(layer|line|polyline|circle|arc|ellipse|ellipse_arc|text_string|point_marker|sfig_org|sfig_locate)_feature$/.test(k)) continue;
      a = sfcArgs(m[2]);
      var lay = N(a[0]) - 1;
      switch (k) {
        case "layer_feature": layers.push(unX2(a[0])); break;
        case "line_feature": add({ t: "line", lay: lay, x1: N(a[4]), y1: N(a[5]), x2: N(a[6]), y2: N(a[7]) }); break;
        case "polyline_feature": { var xs = a[5] || [], ys = a[6] || [], P = []; for (var q = 0; q < xs.length && q < ys.length; q++) P.push([xs[q], ys[q]]); add({ t: "poly", lay: lay, pts: P }); break; }
        case "circle_feature": add({ t: "circle", lay: lay, x: N(a[4]), y: N(a[5]), r: N(a[6]) }); break;
        case "arc_feature": { var d0 = N(a[7]) === 1; add({ t: "arc", lay: lay, x: N(a[4]), y: N(a[5]), r: N(a[6]), a0: d0 ? N(a[9]) : N(a[8]), a1: d0 ? N(a[8]) : N(a[9]) }); break; }
        case "ellipse_feature": add({ t: "poly", lay: lay, closed: true, pts: ellPts(N(a[4]), N(a[5]), N(a[6]), N(a[7]), N(a[8]), 0, 360, true).slice(0, -1) }); break;
        case "ellipse_arc_feature": { var cw = N(a[8]) === 1; add({ t: "poly", lay: lay, pts: ellPts(N(a[4]), N(a[5]), N(a[6]), N(a[7]), N(a[9]), cw ? N(a[11]) : N(a[10]), cw ? N(a[10]) : N(a[11])) }); break; }
        case "text_string_feature": add({ t: "text", lay: lay, s: unX2(a[3]), x: N(a[4]), y: N(a[5]), h: N(a[6]), ang: N(a[9]) || 0, b: N(a[11]) || 1 }); break;
        case "point_marker_feature": add({ t: "point", lay: lay, x: N(a[2]), y: N(a[3]) }); break;
        case "sfig_org_feature": groups[unX2(a[0])] = { kind: a[1], ents: cur }; cur.forEach(function (e) { e.grp = 1; }); cur = []; break;
        case "sfig_locate_feature": {   // 複合図形を置く(用紙の図形は縮尺だけなので動かさない)
          var G2 = groups[unX2(a[1])]; if (!G2) break;
          var x0 = N(a[2]), y0 = N(a[3]), rot = N(a[4]) * Math.PI / 180, sx = N(a[5]) || 1, sy = N(a[6]) || 1, cr = Math.cos(rot), sr = Math.sin(rot);
          var id = G2.kind === "1" || (!x0 && !y0 && !rot && sx === 1 && sy === 1);
          var tf = function (x, y) { x *= sx; y *= sy; return [x * cr - y * sr + x0, x * sr + y * cr + y0]; };
          G2.ents.forEach(function (e) {
            e.grp = 0; if (id) return;
            var p;
            if (e.t === "line") { p = tf(e.x1, e.y1); e.x1 = p[0]; e.y1 = p[1]; p = tf(e.x2, e.y2); e.x2 = p[0]; e.y2 = p[1]; }
            else if (e.t === "poly") e.pts = e.pts.map(function (q2) { return tf(q2[0], q2[1]); });
            else { p = tf(e.x, e.y); e.x = p[0]; e.y = p[1]; if (e.r) e.r *= Math.abs(sx); if (e.h) e.h *= Math.abs(sy); if (e.t === "arc" || e.t === "text") { var dd = N(a[4]) || 0; if (e.t === "arc") { e.a0 += dd; e.a1 += dd; } else e.ang += dd; } }
          });
          break;
        }
      }
    }
    return { layers: layers, ents: ents.filter(function (e) { return !e.grp; }) };
  };
  // ANT(A納図): 先頭に画層の表(@Layer@)、そのあと zlib の塊([元の大きさ u32][縮めた大きさ u32][zlib])。塊をつないだ中に図形の記録
  // (「CKsCvRecDataEntity」+0x68 に 0x80000040、+0x6C 種類 u16(1 点・2 線・4 円/円弧・8 文字・0x10 だ円・0x20 折れ線)、+0x70 画層番号、+0x88 から座標 double)
  async function inflateZ(u8) {
    if (typeof DecompressionStream !== "function") throw new Error("この端末では A納図の図面を開けません(A納図で SFC に書き出して開いてください)");
    var s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  G.antToEnts = async function (buf) {
    var d = new Uint8Array(buf), dv = new DataView(d.buffer, d.byteOffset, d.byteLength), u32 = function (o) { return dv.getUint32(o, true); };
    if (String.fromCharCode.apply(null, d.subarray(4, 9)) !== "Mark2") throw new Error("A納図の図面ではないようです");
    var sj = new TextDecoder("shift_jis"), layers = [], first = -1, i;
    for (i = 12; i < d.length - 12; i++) {
      if (first < 0 && d[i] === 0x78 && (d[i + 1] === 0x9c || d[i + 1] === 0xda || d[i + 1] === 0x01 || d[i + 1] === 0x5e) && u32(i - 4) > 0 && u32(i - 4) <= d.length - i && u32(i - 8) > 0 && u32(i - 8) <= (1 << 24)) { first = i; break; }
      if (d[i] === 0x40 && d[i + 1] === 0x4c && d[i + 6] === 0x40 && String.fromCharCode.apply(null, d.subarray(i, i + 7)) === "@Layer@") {
        var n = dv.getUint32(i + 8, false); layers.push(n < 256 ? sj.decode(d.subarray(i + 12, i + 12 + n)) : "");
      }
    }
    if (first < 0) throw new Error("図形が見つかりません");
    var parts = [], total = 0;
    for (i = first; i < d.length - 2;) {
      if (d[i] === 0x78 && (d[i + 1] === 0x9c || d[i + 1] === 0xda || d[i + 1] === 0x01 || d[i + 1] === 0x5e) && i >= 8) {
        var cm = u32(i - 4), rw = u32(i - 8);
        if (cm > 2 && cm <= d.length - i && rw > 0 && rw <= (1 << 24)) {
          try { var x = await inflateZ(d.subarray(i, i + cm)); if (x.length === rw) { parts.push(x); total += x.length; i += cm; continue; } } catch (e) { if (/この端末/.test(e.message)) throw e; }
        }
      }
      i++;
    }
    var U = new Uint8Array(total), o = 0; parts.forEach(function (p) { U.set(p, o); o += p.length; });
    var V = new DataView(U.buffer), D = function (p) { return V.getFloat64(p, true); }, W = function (p) { return V.getUint32(p, true); }, H = function (p) { return V.getUint16(p, true); };
    var KEY = [67, 75, 115, 67, 118, 82, 101, 99, 68, 97, 116, 97, 69, 110, 116, 105, 116, 121], starts = [];   // "CKsCvRecDataEntity"
    for (i = 0; i < U.length - 200; i++) {
      if (U[i] !== 67 || U[i + 4] !== 118 || U[i + 5] !== 82) continue;
      var ok = true; for (var k = 1; k < KEY.length; k++) if (U[i + k] !== KEY[k]) { ok = false; break; }
      if (ok) starts.push(i);
    }
    var ents = [], texts = [], okf = function (v) { return Number.isFinite(v) && Math.abs(v) < 1e12; };
    for (var s = 0; s < starts.length; s++) {
      var a = starts[s], end = s + 1 < starts.length ? starts[s + 1] : U.length;
      if (a + 200 > U.length || W(a + 104) !== 0x80000040) continue;
      var t = H(a + 108), lay = W(a + 112); if (lay >= 100000) lay = 0;
      if (t === 2) { var e2 = { t: "line", lay: lay, x1: D(a + 136), y1: D(a + 144), x2: D(a + 152), y2: D(a + 160) }; if (okf(e2.x1) && okf(e2.y2)) ents.push(e2); }
      else if (t === 4) {
        var cx = D(a + 136), cy = D(a + 144), r = D(a + 152), a0 = D(a + 160), a1 = D(a + 168);
        if (!okf(cx) || !(r > 0)) continue;
        if (Math.abs(a1 - a0) >= 359.9999) ents.push({ t: "circle", lay: lay, x: cx, y: cy, r: r }); else ents.push({ t: "arc", lay: lay, x: cx, y: cy, r: r, a0: a0, a1: a1 });
      }
      else if (t === 1) { var px = D(a + 132), py = D(a + 140); if (okf(px)) ents.push({ t: "point", lay: lay, x: px, y: py }); }
      else if (t === 8) {
        var sb = U.subarray(a + 228, Math.min(a + 228 + 512, end)), z = sb.indexOf(0); var str = sj.decode(z >= 0 ? sb.subarray(0, z) : sb);
        var tx = { t: "text", lay: lay, x: D(a + 212), y: D(a + 220), h: D(a + 132), ang: D(a + 156), s: str };
        if (okf(tx.x) && str) { ents.push(tx); texts.push(tx); }
      }
      else if (t === 0x10) { var ex = D(a + 136), ey = D(a + 144), rx = D(a + 152), ry = D(a + 160), ro = D(a + 168), b0 = D(a + 176), b1 = D(a + 184); if (okf(ex) && rx > 0) { var full = Math.abs(b1 - b0) >= 359.9999 || (!b0 && !b1); ents.push({ t: "poly", lay: lay, closed: full, pts: ellPts(ex, ey, rx, ry, ro, b0, b1, full) }); } }
      else if (t === 0x20) {
        var np = W(a + 168), pts = [], q = a + 196;
        while (pts.length < np && q + 96 <= end && W(q) === 0x8000) { for (var j = 0; j < 5 && pts.length < np; j++) pts.push([D(q + 16 + 16 * j), D(q + 24 + 16 * j)]); q += 108; }
        if (pts.length >= 2 && okf(pts[0][0])) ents.push({ t: "poly", lay: lay, pts: pts });
      }
    }
    if (texts.length) {   // 文字の大きさ(用紙の mm)× 縮尺。縮尺は図面の広さ(線の 0.1〜99.9%)を A3 の横 420 mm で割って、よくある縮尺に丸める
      var xs = [], ys = []; ents.forEach(function (e) { if (e.t === "line") { xs.push(e.x1); ys.push(e.y1); } });
      xs.sort(function (p, q2) { return p - q2; }); ys.sort(function (p, q2) { return p - q2; });
      var qt = function (A, p) { return A.length ? A[Math.min(A.length - 1, Math.floor(A.length * p))] : 0; };
      var raw = Math.max((qt(xs, 0.999) - qt(xs, 0.001)) / 420, (qt(ys, 0.999) - qt(ys, 0.001)) / 297, 1), SC = [1, 2, 5, 10, 20, 50, 100, 200, 250, 300, 500, 600, 1000, 1500, 2000, 2500, 3000, 5000, 10000], sc = 1, best = 1e9;
      SC.forEach(function (c) { var dd = Math.abs(Math.log(c / raw)); if (dd < best) { best = dd; sc = c; } });
      texts.forEach(function (tx2) { tx2.h = (tx2.h > 0 ? tx2.h : 2.5) * sc; });
    }
    return { layers: layers, ents: ents };
  };
  G.sxfToDxf = async function (name, bytes) {
    var E = /\.ant$/i.test(name) ? await G.antToEnts(bytes) : G.sfcToEnts(new TextDecoder("shift_jis").decode(new Uint8Array(bytes)));
    if (!E.ents.length) throw new Error("線が見つかりません");
    return { bytes: G.sjisBytes(entsToDxf(E)), n: E.ents.length };
  };
  var sxfBusy = false;
  document.addEventListener("change", function (e) {   // 図面を開く欄(#file)で SFC・A納図(.ant)を選んだら、DXF に変えてからアプリに渡す
    var inp = e.target, f = inp && inp.id === "file" && inp.files && inp.files[0];
    if (!f || sxfBusy || !SXF_RE.test(f.name)) return;
    e.stopImmediatePropagation();
    var keepOpening = opening, kind = /\.ant$/i.test(f.name) ? "A納図" : "SFC";
    bar(kind + "「" + esc(f.name) + "」を DXF に変えています…(大きい図面は少しかかります)");
    f.arrayBuffer().then(function (b) { return G.sxfToDxf(f.name, b); }).then(function (r) {
      var nf = new File([r.bytes], f.name.replace(SXF_RE, "") + ".dxf", { type: "application/dxf", lastModified: f.lastModified });
      var dt = new DataTransfer(); dt.items.add(nf);
      sxfBusy = true; dwgBusy = true; opening = keepOpening; inp.files = dt.files;
      try { inp.dispatchEvent(new Event("change", { bubbles: true })); } finally { sxfBusy = false; dwgBusy = false; opening = false; }
      bar("✓ " + kind + "「" + esc(f.name) + "」を DXF に変えて開きました(図形 " + r.n + ")。" + (kind === "A納図" ? "文字の大きさは縮尺を見積もっています。" : ""), null, 7000);
    }).catch(function (er) { bar("⚠ " + kind + "を読めません: " + esc(er.message) + (kind === "A納図" ? "(A納図で「SFC で保存」してから開いてください)" : "")); });
  }, true);
  document.addEventListener("change", function (e) {   // 図面を開く欄(#file)で DWG(名前が .dwg)を選んだら、DXF に変えてからアプリに渡す
    var inp = e.target, f = inp && inp.id === "file" && inp.files && inp.files[0];
    if (!f || dwgBusy || !/\.dwg$/i.test(f.name)) return;
    e.stopImmediatePropagation();
    var keepOpening = opening;
    bar("DWG「" + esc(f.name) + "」を DXF に変えています…" + (dwgMod ? "" : "(はじめては部品の読み込みに少しかかります)"));
    f.arrayBuffer().then(function (b) { return G.dwgToDxf(b); }).then(function (out) {
      var nf = new File([out], f.name.replace(/\.dwg$/i, "") + ".dxf", { type: "application/dxf", lastModified: f.lastModified });
      var dt = new DataTransfer(); dt.items.add(nf);
      dwgBusy = true; opening = keepOpening; inp.files = dt.files;
      try { inp.dispatchEvent(new Event("change", { bubbles: true })); } finally { dwgBusy = false; opening = false; }
      bar("✓ DWG「" + esc(f.name) + "」を DXF に変えて開きました。", null, 6000);
    }).catch(function (er) { bar("⚠ DWG を読めません: " + esc(er.message) + "(CAD で「DXF で保存」してから開いてください)"); });
  }, true);
  document.addEventListener("DOMContentLoaded", function () { siteBadge(); modeChip(); hookFile(); setTimeout(offerSiteFile, 1200); /* v2.13.0:現場の図面さがし(大きい図面を読む)は画面が出てから */ var fi = fileInput(); if (fi && APP !== "menu") fi.setAttribute("multiple", ""); docStrip(); });
  // DWG の部品は、電波のあるときに先に取っておく(現場の電波なしでも開けるように。sw.js が覚える)
  // v2.12.0:Android のアプリは部品が中に入っているので取らない(前は開くたびに 11MB を読んでいた)。
  //   ホーム画面アプリは、画面が落ち着いてから(30 秒・さわっていないとき)、まず sw.js にアプリ 7 本を覚えさせ("warm")、そのあと DWG の部品。電波が弱い・節約モードでは取らない
  setTimeout(function idle() {
    try {
      if (window.KurukuruAndroid || window.IPPATSU_SAFE || !/^https?:/.test(location.protocol) || !navigator.onLine || !("caches" in window)) return;
      var c = navigator.connection; if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""))) return;
      if (document.hidden) { setTimeout(idle, 30000); return; }
      var sw = navigator.serviceWorker && navigator.serviceWorker.controller; if (sw) sw.postMessage("warm");
      var base = new URL("vendor/libredwg/", location.href).href;
      setTimeout(function () { ["libredwg-web.js", "libredwg-web.wasm"].forEach(function (f) { caches.match(base + f).then(function (r) { if (!r) fetch(base + f).catch(function () {}); }); }); }, 20000);
    } catch (e) { /* 次に開いたときにまた試す */ }
  }, 30000);
})();

// ---------------------------------------------------------------- 改善要望ボックス・エラー記録(2026-11-16)
// どのアプリにも、一番下に「💡 改善要望」を出す。書いた要望と、自動で集めたエラー(画面の不具合)は、
// Android のアプリでは「送り先フォルダ」(共有ドライブの 改善要望 フォルダなど)へ自動で書き込む。PC の画面ではコピー・ダウンロードで渡す。
(function () {
  "use strict";
  if (window.IpxFeedback) return;
  var APP = window.IPPATSU_APP || "", A = window.KurukuruAndroid || window.IPPATSU_IOS_FB || null;
  var NAMES = { menu: "一発バーン", nomiso: "脳みそバーン無敵CAD", sumi: "ECP一撃逃墨太郎", kamashi: "一発かまし太郎", kurukuru: "くるくる回し太郎", utsushi: "こっそり写し太郎", pen: "写真ペン太郎", hisoka: "ひそかに調べ太郎" };
  var BANNED = ["中谷行寿", "松本光市", "今村正人"];
  var ERR = "ipx.err", QUE = "ipx.fbq", DEV = "ipx.dev", MQ = "ipx.mailq", MLAST = "ipx.mailErrAt";
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } }
  };
  var jget = function (k) { try { return JSON.parse(ls.get(k) || "[]"); } catch (e) { return []; } };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var stamp = function (d) { d = d || new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); };
  var dev = ls.get(DEV); if (!dev) { dev = Math.random().toString(36).slice(2, 6); ls.set(DEV, dev); }
  var call = function (f) { try { return A && A[f] ? A[f].apply(A, [].slice.call(arguments, 1)) : ""; } catch (e) { return ""; } };
  function ver() { var s = document.querySelector("h1 small, header small"); return s ? s.textContent.trim() : ""; }
  function info() {
    var site = ""; try { site = (window.Genba && window.Genba.current && window.Genba.current()) || ""; } catch (e) { /* */ }
    return { app: APP, name: NAMES[APP] || document.title, ver: ver(), apk: call("version"), device: call("device") || navigator.userAgent, site: site, dev: dev, at: new Date().toISOString() };
  }
  // ---- エラーを集める(同じものが続いたら回数だけ増やす)
  var busy = false, burst = { t: 0, n: 0, skip: 0 };
  function rec(kind, msg, where, stack) {
    if (busy) return;
    // v2.12.0:エラーが続けて出るとき(描くたびに出るなど)、毎回 localStorage を読み書きすると重くなって固まるので、1 分に 20 件まで
    var now0 = Date.now(); if (now0 - burst.t > 60000) { if (burst.skip) { var s = burst.skip; burst.skip = 0; burst = { t: now0, n: 0, skip: 0 }; rec("note", "同じころのエラー " + s + " 件は記録を省きました", ""); } burst.t = now0; burst.n = 0; }
    if (++burst.n > 20) { burst.skip++; return; }
    busy = true;
    try {
      msg = String(msg || "").slice(0, 500); var list = jget(ERR), now = Date.now(), last = list[list.length - 1];
      if (last && last.msg === msg && last.where === where && now - last.t < 60000) { last.n = (last.n || 1) + 1; last.t = now; }
      else list.push({ t: now, kind: kind, msg: msg, where: where || "", stack: String(stack || "").slice(0, 1500), app: APP, ver: ver(), n: 1 });
      ls.set(ERR, JSON.stringify(list.slice(-150)));
      queue({ type: "エラー", item: list[list.length - 1] }, true);
      badge();
    } catch (e) { /* */ } finally { busy = false; }
  }
  window.addEventListener("error", function (e) {
    if (e.target && e.target !== window && e.target.tagName) { var s = e.target.src || e.target.href || ""; if (s) rec("load", "読み込めません: " + e.target.tagName.toLowerCase() + " " + s.slice(-120), ""); return; }
    rec("error", e.message, (e.filename || "").split("/").pop() + ":" + e.lineno + ":" + e.colno, e.error && e.error.stack);
  }, true);
  window.addEventListener("unhandledrejection", function (e) { var r = e.reason; rec("promise", r && r.message ? r.message : String(r), "", r && r.stack); });
  var ce = console.error; console.error = function () { try { rec("console", [].map.call(arguments, function (a) { return a && a.message ? a.message : typeof a === "string" ? a : (function () { try { return JSON.stringify(a); } catch (x) { return String(a); } })(); }).join(" "), ""); } catch (e) { /* */ } return ce.apply(console, arguments); };
  // ---- 送る(送り先フォルダへ書く。書けなければ貯めておいて次に送る)
  function queue(x, later) { var q = jget(QUE); x.info = x.info || info(); x.id = x.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6); q.push(x); ls.set(QUE, JSON.stringify(q.slice(-300))); if (later) { clearTimeout(queue.t); queue.t = setTimeout(flush, 4000); } else flush(); }
  function dirName() { return call("fbDirName"); }
  // ふだんは送り先フォルダへ書く。書けなかったもの(フォルダが無い・書けない)だけ、メールの設定があればメールへ回す(メールは任意)
  function toMail(items) {
    if (!items.length || !mailReady()) return items;
    var mq = jget(MQ); ls.set(MQ, JSON.stringify(mq.concat(items).slice(-300))); setTimeout(mailFlush, 50); return [];
  }
  function flush() {
    var q = jget(QUE); if (!q.length) return 0;
    if (!dirName()) { var keep = toMail(q); ls.set(QUE, JSON.stringify(keep)); badge(); return keep.length; }
    var errs = q.filter(function (x) { return x.type === "エラー"; }), reqs = q.filter(function (x) { return x.type !== "エラー"; }), left = [], st = stamp();
    reqs.forEach(function (x, i) {
      var r = call("fbSave", "要望/" + st + (i ? "_" + i : "") + "_" + (x.info.app || "app") + "_" + dev + ".json", JSON.stringify(x, null, 1), false);
      if (r !== "ok") left.push(x);
    });
    if (errs.length) {
      var r = call("fbSave", "エラー/" + st + "_" + (APP || "app") + "_" + dev + ".json", JSON.stringify({ type: "エラー", info: info(), items: errs.map(function (x) { return x.item; }) }, null, 1), false);
      if (r !== "ok") left = left.concat(errs);
    }
    left = toMail(left); ls.set(QUE, JSON.stringify(left)); badge(); return left.length;
  }
  // ---- メールで送る(Android アプリの中から SMTP。要望はすぐ、エラーは10分に1通までまとめて)
  function mcfg() { try { return JSON.parse(call("mailConfigGet") || "{}"); } catch (e) { return {}; } }
  function mailReady() { if (!A || !A.mailSend) return false; var c = mcfg(); return !!(c.on !== false && c.hasPass && c.user && c.to); }
  var mailWait = {}, mailCb = {};
  function mailFlush(force) {
    if (!mailReady()) return;
    var mq = jget(MQ), busyIds = {}; Object.keys(mailWait).forEach(function (k) { mailWait[k].forEach(function (i) { busyIds[i] = 1; }); });
    mq = mq.filter(function (x) { return !busyIds[x.id]; });
    mq.filter(function (x) { return x.type !== "エラー"; }).forEach(function (x) {
      var k = "r" + x.id; mailWait[k] = [x.id];
      A.mailSend(k, "【改善要望】" + (x.info.name || "") + " " + (x.info.ver || "") + " " + String(x.text || "").split("\n")[0].slice(0, 30), report(x.text, x.info, x.recentErrors));
    });
    var errs = mq.filter(function (x) { return x.type === "エラー"; }), last = Number(ls.get(MLAST) || 0);
    if (errs.length && (force || Date.now() - last > 10 * 60000 || errs.length >= 30)) {
      var k = "e" + Date.now().toString(36); mailWait[k] = errs.map(function (x) { return x.id; }); ls.set(MLAST, String(Date.now()));
      var i0 = errs[0].info || info(), apps = {}; errs.forEach(function (x) { apps[(x.info && x.info.name) || ""] = 1; });
      A.mailSend(k, "【エラー記録】" + Object.keys(apps).join("・") + " " + errs.length + " 件", "一発バーンのアプリで起きたエラーを自動で送ります。\n\n" +
        errs.map(function (x) { var e = x.item || {}; return new Date(e.t).toLocaleString() + " [" + (e.app || "") + " " + (e.ver || "") + "] " + e.msg + (e.where ? " @" + e.where : "") + (e.n > 1 ? " ×" + e.n : "") + (e.stack ? "\n    " + e.stack.split("\n").slice(0, 4).join("\n    ") : ""); }).join("\n\n") +
        "\n\n端末：" + i0.device + (i0.apk ? "（APK " + i0.apk + "）" : "") + (i0.site ? "\n現場：" + i0.site : ""));
    }
  }
  window.__mailDone = function (k, r) {
    var ids = mailWait[k] || []; delete mailWait[k];
    if (r === "ok") { var set = {}; ids.forEach(function (i) { set[i] = 1; }); ls.set(MQ, JSON.stringify(jget(MQ).filter(function (x) { return !set[x.id]; }))); }
    if (mailCb[k]) { mailCb[k](r); delete mailCb[k]; }
    else if (k.charAt(0) === "r") toast(r === "ok" ? "✉ 要望をメールで送りました" : "✉ メールを送れませんでした（あとでもう一度送ります）：" + r);
    badge();
  };
  setInterval(function () { if (jget(MQ).length) mailFlush(); }, 60000);
  function mailDialog() {
    var G = window.Genba, esc = G.esc, c = mcfg();
    var d = G.dialog("✉ メールの設定",
      '<div class="ipx-fbd"><div class="m">（入れなくてもかまいません）ふだんは送り先フォルダへ自動で送ります。フォルダに送れないとき（フォルダを選んでいない・書けない）だけ、ここで決めたアドレスへこの端末からメールします。送るのに使うアカウントは、Gmail なら「アプリ パスワード」（Google アカウント › セキュリティ › 2 段階認証 › アプリ パスワード）を入れてください。ふだんのパスワードは使えません。設定はこの端末の中だけに置きます。<\/div>' +
      '<label class="m">送り先（, で何人でも）<\/label><input id="ipxMto" type="email" data-noipx style="width:100%;box-sizing:border-box;padding:8px" value="' + esc(c.to || "") + '">' +
      '<label class="m">送るのに使うアドレス<\/label><input id="ipxMuser" type="email" data-noipx style="width:100%;box-sizing:border-box;padding:8px" value="' + esc(c.user || "") + '" placeholder="例: genba.report@gmail.com">' +
      '<label class="m">アプリ パスワード' + (c.hasPass ? "（入れてあります。変えるときだけ入れる）" : "") + '<\/label><input id="ipxMpass" type="password" data-noipx autocomplete="off" style="width:100%;box-sizing:border-box;padding:8px">' +
      '<div style="display:flex;gap:8px"><div style="flex:1"><label class="m">サーバー<\/label><input id="ipxMhost" type="text" data-noipx style="width:100%;box-sizing:border-box;padding:8px" value="' + esc(c.host || "smtp.gmail.com") + '"><\/div>' +
      '<div style="width:90px"><label class="m">ポート<\/label><select id="ipxMport" style="width:100%;padding:8px"><option' + (c.port == 587 ? "" : " selected") + '>465<\/option><option' + (c.port == 587 ? " selected" : "") + '>587<\/option><\/select><\/div><\/div>' +
      '<label class="m" style="display:block;margin-top:8px"><input type="checkbox" id="ipxMon" style="width:auto;display:inline;vertical-align:middle"' + (c.on === false ? "" : " checked") + '> 送れないときにメールする<\/label>' +
      '<div class="m" id="ipxMres"><\/div><\/div>',
      [{ label: "保存", ok: true, run: function (el) { save(el); toast("✉ メールの設定を保存しました"); flush(); mailFlush(); } },
       { label: "テスト送信", run: function (el) { save(el); var r = el.querySelector("#ipxMres"); if (!mailReady()) { r.textContent = "送り先・アドレス・アプリ パスワードを入れてください。"; return false; } r.textContent = "送っています…"; var k = "t" + Date.now(); mailCb[k] = function (x) { r.textContent = x === "ok" ? "✓ 送れました。受信箱を見てください。" : "✗ " + x; }; A.mailSend(k, "【テスト】一発バーンの改善要望メール", "これはテストです。\n" + report("（テスト）", info(), [])); return false; } },
       { label: "閉じる" }]);
    function save(el) { A.mailConfigSet(JSON.stringify({ to: el.querySelector("#ipxMto").value.trim(), user: el.querySelector("#ipxMuser").value.trim(), pass: el.querySelector("#ipxMpass").value, host: el.querySelector("#ipxMhost").value.trim() || "smtp.gmail.com", port: Number(el.querySelector("#ipxMport").value), on: el.querySelector("#ipxMon").checked })); el.querySelector("#ipxMpass").value = ""; }
    return d;
  }
  window.__fbDir = function (name) { if (name) { var n = jget(QUE).length, l = flush(); toast(name ? "送り先：" + name + (n ? "（" + (n - l) + " 件送りました）" : "") : ""); } if (dlg) open(); };
  // ---- 画面
  var CSS = ".ipx-fb{position:fixed;right:8px;z-index:60;display:flex;align-items:center;justify-content:center;gap:2px;width:34px;height:34px;border:1px solid rgba(0,0,0,.12);border-radius:999px;background:rgba(255,255,255,.7);color:#333;font:16px/1 system-ui,sans-serif;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.15);cursor:pointer;opacity:.55}.ipx-fb:active{opacity:1}" +
    ".ipx-fb em{position:absolute;top:-4px;right:-4px}.ipx-fbslot{display:flex;align-items:center;gap:6px;width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(0,0,0,.15);background:transparent;font:600 14px/1.2 system-ui,sans-serif;color:inherit;cursor:pointer}" +
    ".ipx-fb em{font-style:normal;background:#c2255c;color:#fff;border-radius:999px;padding:2px 6px;font-size:11px}" +
    ".ipx-fbbox{margin:18px 12px 24px;padding:12px;border:1px dashed #999;border-radius:12px;font:14px/1.5 system-ui,sans-serif;color:inherit}" +
    ".ipx-fbbox h4{margin:0 0 6px;font-size:15px}.ipx-fbbox textarea,.ipx-fbd textarea{width:100%;box-sizing:border-box;min-height:84px;font:inherit;padding:8px;border-radius:8px;border:1px solid #bbb}" +
    ".ipx-fbbox .r{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center}.ipx-fbbox button{font:inherit;font-weight:700;padding:8px 12px;border-radius:8px;border:0;background:#c2255c;color:#fff;cursor:pointer}.ipx-fbbox button.s{background:transparent;color:inherit;border:1px solid #999}" +
    ".ipx-fbd .m{font-size:12px;color:#666;margin:4px 0}.ipx-fbd pre{max-height:180px;overflow:auto;font-size:11px;background:#f4f4f4;color:#333;padding:6px;border-radius:6px;white-space:pre-wrap}";
  var pill = null, box = null, dlg = null;
  function toast(t) { var G = window.Genba; if (t && G && G.toast) G.toast(t); else if (t) { var e = document.createElement("div"); e.textContent = t; e.style.cssText = "position:fixed;left:50%;bottom:70px;transform:translateX(-50%);background:#222;color:#fff;padding:8px 14px;border-radius:10px;z-index:99;font:13px system-ui"; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2600); } }
  function errCount() { return jget(ERR).length; }
  function unsent() { return jget(QUE).length; }
  function badge() {
    var n = unsent(), t = n ? "<em>" + n + "<\/em>" : "";
    if (pill) pill.innerHTML = (pill.classList.contains("ipx-fbslot") ? "💡 改善要望・エラーの記録" : "💡") + t;
    if (box) { var m = box.querySelector(".ipx-fbm"); if (m) m.innerHTML = state(); }
  }
  function state() {
    var d = dirName(), n = unsent(), e = errCount();
    var mc = mcfg(), ml = mailReady() ? "✉ 送り先フォルダに送れないときは " + window.Genba.esc(mc.to) + " へメールします<br>" : "";
    return ml + (d ? "送り先：📁 " + window.Genba.esc(d) : A && A.fbDirPick ? "送り先フォルダがまだありません（下の「送り先」で共有ドライブの 改善要望 フォルダを選んでください）" : "iPhone からは自動で送れません。「送る」か「LINE などで送る」で、LINE・メールなどに送ってください。") +
      "<br>エラーの記録 " + e + " 件" + (n ? "・まだ送っていないもの " + n + " 件" : "");
  }
  function send(text) {
    text = String(text || "").trim(); if (!text) { toast("要望を書いてください"); return false; }
    var bad = BANNED.filter(function (b) { return text.indexOf(b) >= 0; })[0];
    if (bad) { toast("「" + bad + "」は書類に入れない名前です。消してから送ってください"); return false; }
    var errs = jget(ERR).slice(-20);
    queue({ type: "要望", text: text, recentErrors: errs });
    if (dirName()) toast(unsent() ? "送れなかったので、あとでもう一度送ります" : "💡 送りました。ありがとうございます");
    else if (mailReady()) toast("✉ メールで送っています…");
    else if (A && A.shareText) { A.shareText("【改善要望】" + (NAMES[APP] || ""), report(text)); }
    else { copy(report(text)); }
    return true;
  }
  function report(text, i, errs) {
    i = i || info(); errs = errs ? errs.slice(-10) : jget(ERR).slice(-10);
    return "【改善要望】" + i.name + " " + i.ver + (i.apk ? "（APK " + i.apk + "）" : "") + (i.site ? "・現場 " + i.site : "") + "\n" + (text || "") + "\n\n" +
      (errs.length ? "― 最近のエラー ―\n" + errs.map(function (x) { return new Date(x.t).toLocaleString() + " [" + x.app + " " + x.ver + "] " + x.msg + (x.where ? " @" + x.where : "") + (x.n > 1 ? " ×" + x.n : ""); }).join("\n") + "\n" : "") + "端末：" + i.device;
  }
  function copy(t) {
    var ok = function () { toast("コピーしました。チャットに貼り付けて送ってください"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { prompt("コピーしてください", t); });
    else { var a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); ok(); } catch (e) { /* */ } a.remove(); }
  }
  function open(pre) {
    var G = window.Genba; if (!G || !G.dialog) return;
    if (dlg) { try { dlg.close(); } catch (e) { /* */ } }
    var errs = jget(ERR).slice(-30).reverse(), esc = G.esc;
    dlg = G.dialog("💡 改善要望・エラーの記録",
      '<div class="ipx-fbd"><div class="m">' + esc((NAMES[APP] || "") + " " + ver()) + "<\/div>" +
      '<textarea id="ipxFbT" placeholder="こうしてほしい・ここが使いにくい・ここで止まった など（書いた内容と最近のエラーが送られます）">' + esc(pre || "") + "<\/textarea>" +
      '<div class="m ipx-fbm2">' + state() + "<\/div>" +
      (errs.length ? "<details><summary>エラーの記録（新しい順 " + errs.length + " 件）<\/summary><pre>" + esc(errs.map(function (x) { return new Date(x.t).toLocaleString() + " [" + x.app + " " + x.ver + "] " + x.msg + (x.where ? " @" + x.where : "") + (x.n > 1 ? " ×" + x.n : ""); }).join("\n")) + "<\/pre><\/details>" : "") + "<\/div>",
      [{ label: "送る", ok: true, run: function (c) { return send(c.querySelector("#ipxFbT").value); } }]
        .concat(A && A.mailSend ? [{ label: "メールの設定", run: function () { setTimeout(mailDialog, 0); return true; } }] : [])
        .concat(A && A.fbDirPick ? [{ label: dirName() ? "送り先を変える" : "送り先を選ぶ", run: function () { A.fbDirPick(); return false; } }] : [])
        .concat(A && A.shareText ? [{ label: "LINE などで送る", run: function (c) { A.shareText("【改善要望】" + (NAMES[APP] || ""), report(c.querySelector("#ipxFbT").value)); return false; } }] : [{ label: "コピー", run: function (c) { copy(report(c.querySelector("#ipxFbT").value)); return false; } }])
        .concat([{ label: "閉じる" }]));
    var cl = dlg.close; dlg.close = function () { dlg = null; cl(); };
  }
  function place() {
    var sty = document.createElement("style"); sty.textContent = CSS; document.head.appendChild(sty);
    var b = document.body, cs = getComputedStyle(b);
    var flow = APP === "menu" || (cs.overflow !== "hidden" && cs.overflowY !== "hidden" && !document.querySelector("nav.tabs"));
    if (flow) {   // ふつうの長い画面:一番下に箱を置く
      box = document.createElement("section"); box.className = "ipx-fbbox"; box.setAttribute("aria-label", "改善要望");
      box.innerHTML = "<h4>💡 改善要望<\/h4><textarea placeholder=\"こうしてほしい・使いにくいところ・止まったところなど\"><\/textarea><div class=\"r\"><button type=\"button\" class=\"go\">送る<\/button><button type=\"button\" class=\"s more\">送り先・エラーの記録<\/button>" + (A && A.mailSend ? "<button type=\"button\" class=\"s mail\">✉ メールの設定<\/button>" : "") + "<\/div><div class=\"ipx-fbm\" style=\"font-size:12px;color:#666;margin-top:6px\"><\/div>";
      b.appendChild(box);
      box.querySelector(".go").onclick = function () { var t = box.querySelector("textarea"); if (send(t.value)) t.value = ""; };
      box.querySelector(".more").onclick = function () { open(box.querySelector("textarea").value); };
      if (box.querySelector(".mail")) box.querySelector(".mail").onclick = function () { mailDialog(); };
    } else if (document.getElementById("ipxFbSlot")) {   // アプリが置き場所を用意しているとき(設定の中など):浮かべない
      pill = document.createElement("button"); pill.type = "button"; pill.className = "ipx-fbslot"; pill.setAttribute("aria-label", "改善要望");
      pill.onclick = function () { open(); }; document.getElementById("ipxFbSlot").appendChild(pill);
    } else {   // 画面いっぱいのアプリ:右下の小さな 💡 だけ(下にタブがあればその上。じゃまにならないよう薄く)
      pill = document.createElement("button"); pill.type = "button"; pill.className = "ipx-fb"; pill.setAttribute("aria-label", "改善要望");
      var nav = document.querySelector("nav.tabs"), h = nav ? nav.getBoundingClientRect().height : 0;
      pill.style.bottom = "calc(" + (h + 6) + "px + env(safe-area-inset-bottom, 0px))";
      pill.onclick = function () { open(); }; b.appendChild(pill);
    }
    badge(); flush(); mailFlush();
  }
  window.IpxFeedback = { open: open, flush: flush, mail: function () { return mailDialog(); }, mailFlush: mailFlush, errors: function () { return jget(ERR); }, record: rec };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(place, 300); }); else setTimeout(place, 300);
})();

;// 一発バーン 現場まるごと受け渡し(2026-11-25 ゆきちゃん「Google ドライブ等のクラウドで現場データを共有。座標・図面・工事写真・アルバム すべてぬけ無く」)
//   1つの現場(または全部)を1つの ZIP(genba_〜.zip)にする。中身:
//     genba.json … 現場の設定・座標・アプリごとの作業(くるくる等)・図面の一覧・写し太郎の写真の情報・ツリー・黒板のひな形・測点・
//                  ペン太郎の写真帳(現場ごと)・3D(LandXML)。写真・図面などの中身は ZIP の中の別ファイルにして、json には置き場所だけ書く。
//     b/0001 …    写真(JPEG)・図面・LandXML などの中身(圧縮しない)
//   読み込みは「まとめる」(足りないものを足す。同じ写真・同じ点は重ねない)か「置き換える」。genba_〜.json(前の形)・ECP の kurukuru_〜.json も読める。
//   Genba.exportZip(names) → Blob、Genba.importFile(file, {mode, ask}) → 入れた現場名の配列。make_apps.py が ippatsu_common.js のあとに入れる。
(function () {
  "use strict";
  var G = window.Genba; if (!G || G.exportZip) return;

  // ---------------------------------------------------------------- IndexedDB(アプリと同じ作りで開く)
  var DBS = {
    genba: { name: "ippatsu-genba", up: function (d) { ["sites", "files", "points", "apps"].forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); }); } },
    uts: { name: "utsushi", up: function (d) {
      if (!d.objectStoreNames.contains("photos")) { var p = d.createObjectStore("photos", { keyPath: "id" }); p.createIndex("site", "site"); }
      if (!d.objectStoreNames.contains("trees")) d.createObjectStore("trees");
      if (!d.objectStoreNames.contains("boards")) { var b = d.createObjectStore("boards", { keyPath: "id" }); b.createIndex("site", "site"); }
    } },
    pen: { name: "sp-album", up: function (d) { if (!d.objectStoreNames.contains("items")) d.createObjectStore("items", { keyPath: "id" }); if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); } },
    pens: { name: "pen-sites", up: function (d) { if (!d.objectStoreNames.contains("albums")) d.createObjectStore("albums"); } },
    xs: { name: "ippatsu-3d", up: function (d) { if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); } }
  };
  function odb(k) {
    var D = DBS[k];
    return new Promise(function (ok, ng) {
      var rq = indexedDB.open(D.name, 1);
      rq.onupgradeneeded = function () { D.up(rq.result); };
      rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { ng(rq.error); };
    });
  }
  function run(k, store, mode, fn) {
    return odb(k).then(function (db) {
      return new Promise(function (ok, ng) {
        var t = db.transaction(store, mode), st = t.objectStore(store), out; var rq = fn(st);
        if (rq) rq.onsuccess = function () { out = rq.result; };
        t.oncomplete = function () { db.close(); if (k === "genba" && store === "files" && mode === "readwrite") lsSet("ippatsu.genba.fepoch", String(Date.now()) + Math.random()); ok(out); };   // v2.13.0:図面の一覧の覚え(ippatsu_common.js の files)を使い直さないように
        t.onerror = function () { db.close(); ng(t.error); };
        t.onabort = function () { db.close(); ng(t.error || new Error("保存できませんでした(容量が足りないかもしれません)")); };
      });
    });
  }
  var FK = function (s, n) { return s + "\n" + n; };
  var range = function (s) { return IDBKeyRange.bound(s + "\n", s + "\n￿"); };
  var allIn = function (k, store, s) { return run(k, store, "readonly", function (st) { return st.getAll(range(s)); }); };
  var keysIn = function (k, store, s) { return run(k, store, "readonly", function (st) { return st.getAllKeys(range(s)); }); };
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* */ } };

  // ---------------------------------------------------------------- 中身(Blob・ArrayBuffer)を ZIP の別ファイルへ
  function Packer() { this.files = []; this.n = 0; }
  Packer.prototype.add = function (data, type) {
    var p = "b/" + String(++this.n).padStart(5, "0");
    this.files.push({ name: p, data: data });
    return { $bin: p, type: type || (data && data.type) || "", kind: data instanceof Blob ? "blob" : "buf" };
  };
  Packer.prototype.pack = function (o, depth) {   // Blob・ArrayBuffer を探して置き場所に替える(写真の記録は浅いので 3 段まで)
    if (o == null || typeof o !== "object") return o;
    if (o instanceof Blob || o instanceof ArrayBuffer) return this.add(o);
    if (ArrayBuffer.isView(o)) return this.add(o.buffer.slice(o.byteOffset, o.byteOffset + o.byteLength));
    if ((depth || 0) > 3) return o;
    var out = Array.isArray(o) ? [] : {}, self = this;
    Object.keys(o).forEach(function (k) { out[k] = self.pack(o[k], (depth || 0) + 1); });
    return out;
  };
  function unpack(o, get, depth) {   // 置き場所を Blob・ArrayBuffer に戻す
    if (o == null || typeof o !== "object") return Promise.resolve(o);
    if (o.$bin) return get(o.$bin).then(function (b) { return o.kind === "blob" ? new Blob([b], { type: o.type || "" }) : b; });
    if ((depth || 0) > 3) return Promise.resolve(o);
    var out = Array.isArray(o) ? [] : {}, ks = Object.keys(o);
    return ks.reduce(function (p, k) { return p.then(function () { return unpack(o[k], get, (depth || 0) + 1).then(function (v) { out[k] = v; }); }); }, Promise.resolve()).then(function () { return out; });
  }

  // ---------------------------------------------------------------- ZIP(書き:圧縮なし / 読み:圧縮なし・deflate)
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u, c) { c = c == null ? 0xffffffff : c; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return c; }
  function toU8(d) { return d instanceof Blob ? d.arrayBuffer().then(function (b) { return new Uint8Array(b); }) : Promise.resolve(d instanceof Uint8Array ? d : new Uint8Array(d)); }
  function zipBlob(files, progress) {
    var parts = [], cen = [], off = 0, i = 0;
    var step = function () {
      if (i >= files.length) {
        var cs = cen.reduce(function (a, b) { return a + b.length; }, 0), e = new DataView(new ArrayBuffer(22));
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
        return Promise.resolve(new Blob(parts.concat(cen, [new Uint8Array(e.buffer)]), { type: "application/zip" }));
      }
      var f = files[i++];
      return toU8(f.data).then(function (d) {
        var nm = new TextEncoder().encode(f.name), c = (crc32(d) ^ 0xffffffff) >>> 0, h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, c, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nm.length, true);
        parts.push(new Uint8Array(h.buffer), nm, d);
        var ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, c, true); ch.setUint32(20, d.length, true); ch.setUint32(24, d.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
        cen.push(new Uint8Array(ch.buffer), nm); off += 30 + nm.length + d.length;
        if (progress) progress(i, files.length);
        return step();
      });
    };
    return step();
  }
  function zipReader(file) {   // 中央ディレクトリだけ読んで、中身は要るときに file.slice で取る(大きな ZIP でも端末が重くならない)
    var tail = Math.min(file.size, 65557);
    return file.slice(file.size - tail).arrayBuffer().then(function (b) {
      var u = new DataView(b), e = -1;
      for (var i = b.byteLength - 22; i >= 0; i--) if (u.getUint32(i, true) === 0x06054b50) { e = i; break; }
      if (e < 0) throw new Error("ZIP として読めません");
      var n = u.getUint16(e + 10, true), cs = u.getUint32(e + 12, true), co = u.getUint32(e + 16, true);
      return file.slice(co, co + cs).arrayBuffer().then(function (cb) {
        var c = new DataView(cb), p = 0, map = {};
        for (var k = 0; k < n; k++) {
          var meth = c.getUint16(p + 10, true), csz = c.getUint32(p + 20, true), nl = c.getUint16(p + 28, true), xl = c.getUint16(p + 30, true), cl = c.getUint16(p + 32, true), lo = c.getUint32(p + 42, true);
          var name = new TextDecoder().decode(new Uint8Array(cb, p + 46, nl));
          map[name] = { meth: meth, csz: csz, lo: lo }; p += 46 + nl + xl + cl;
        }
        return {
          has: function (nm) { return !!map[nm]; },
          get: function (nm) {
            var m = map[nm]; if (!m) return Promise.reject(new Error("ZIP の中に " + nm + " がありません"));
            return file.slice(m.lo, m.lo + 30).arrayBuffer().then(function (hb) {
              var h = new DataView(hb), st = m.lo + 30 + h.getUint16(26, true) + h.getUint16(28, true);
              var raw = file.slice(st, st + m.csz);
              if (m.meth === 0) return raw.arrayBuffer();
              if (m.meth === 8 && window.DecompressionStream) {
                var ds; try { ds = new DecompressionStream("deflate-raw"); } catch (e) { throw new Error("この端末は WebView が古い(deflate-raw は Chrome 103 から)ので、この ZIP(圧縮あり)を読めません。Android System WebView を更新してください"); }   // 2026-11-25 OPPO A73 など
                return new Response(raw.stream().pipeThrough(ds)).arrayBuffer();
              }
              throw new Error("この ZIP の形(圧縮 " + m.meth + ")は読めません");
            });
          }
        };
      });
    });
  }

  // ---------------------------------------------------------------- 1つの現場を集める
  function penAlbum(n) {   // ペン太郎の写真帳:いまペン太郎に出ている現場なら sp-album、ほかは pen-sites に預けてある
    var shown = lsGet("pen.win.albumSite");
    if (shown === n || (shown == null && G.current() === n)) {
      return run("pen", "items", "readonly", function (st) { return st.getAll(); }).then(function (items) { return { items: items || [], cfg: lsGet("sp.cfg"), live: true }; });
    }
    return run("pens", "albums", "readonly", function (st) { return st.get(n); }).then(function (r) { return r ? { items: r.items || [], cfg: r.cfg || null } : null; });
  }
  function collect(n, P) {
    return Promise.all([
      G.get(n), G.points(n), allIn("genba", "files", n), keysIn("genba", "apps", n), allIn("genba", "apps", n),
      run("uts", "photos", "readonly", function (st) { return st.index("site").getAll(n); }).catch(function () { return []; }),
      run("uts", "trees", "readonly", function (st) { return st.get(n); }).catch(function () { return null; }),
      run("uts", "boards", "readonly", function (st) { return st.index("site").getAll(n); }).catch(function () { return []; }),
      penAlbum(n).catch(function () { return null; }),
      run("xs", "kv", "readonly", function (st) { return st.get("g:" + n); }).catch(function () { return null; })
    ]).then(function (r) {
      var apps = {}; (r[3] || []).forEach(function (k, i) { apps[k.slice(n.length + 1)] = r[4][i]; });
      var spots = lsGet("ut.spots." + n), pages = lsGet("pen.win.pages." + n);
      return {
        name: n, site: r[0], points: r[1], apps: P.pack(apps),
        files: (r[2] || []).map(function (f) { return { name: f.name, type: f.type, lastModified: f.lastModified, at: f.at, from: f.from, base: f.base, bytes: P.add(f.bytes, f.type) }; }),
        utsushi: { photos: (r[5] || []).map(function (p) { return P.pack(p); }), tree: r[6] || null, boards: r[7] || [], spots: spots ? JSON.parse(spots) : null },
        pen: r[8] ? { cfg: r[8].cfg, items: r[8].items.map(function (it) { return P.pack(it); }), pages: pages ? JSON.parse(pages) : null } : null,
        xs: r[9] ? P.pack(r[9]) : null
      };
    });
  }
  function count(s) {
    return { pts: ((s.points && s.points.points) || []).length, files: (s.files || []).length,
      photos: ((s.utsushi && s.utsushi.photos) || []).length, album: ((s.pen && s.pen.items) || []).length, xs: s.xs ? 1 : 0 };
  }
  G.exportZip = function (names, progress) {
    var P = new Packer(), sites = [];
    return names.reduce(function (p, n) { return p.then(function () { return collect(n, P).then(function (s) { sites.push(s); }); }); }, Promise.resolve()).then(function () {
      var meta = { kind: "ippatsu-genba-zip", v: 1, app: "一発バーン", at: new Date().toISOString(), sites: sites };
      var files = [{ name: "genba.json", data: new TextEncoder().encode(JSON.stringify(meta)) }].concat(P.files);
      return zipBlob(files, progress).then(function (blob) { blob.summary = sites.map(function (s) { return Object.assign({ name: s.name }, count(s)); }); return blob; });
    });
  };

  // 現場の中身のしるし(クラウド共有で「変わったか」を見る)。写真や図面の中身は読まず、記録と大きさで見る
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); }
  function fnv(t) { var h1 = 0x811c9dc5, h2 = 0x01000193 ^ t.length; for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); } return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + t.length.toString(16)); }
  G.siteSig = function (n) {
    var P = new Packer();
    return collect(n, P).then(function (s) {
      var t = JSON.stringify(s) + "|" + P.files.map(function (f) { var d = f.data; return d ? d.size != null ? d.size : d.byteLength : 0; }).join(",");
      var sum = window.crypto && crypto.subtle && window.TextEncoder ? crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)).then(function (b) { return hex(b).slice(0, 32); }) : Promise.reject();
      return sum.catch(function () { return fnv(t); }).then(function (h) { return { sig: h, count: count(s) }; });
    });
  };
  G.siteCount = count;

  // ---------------------------------------------------------------- 読み込む(まとめる / 置き換える)
  function newer(a, b) { return (a && a.at || 0) >= (b && b.at || 0); }
  function putSite(q, n, mode, get) {
    var rep = mode === "replace";
    return G.get(n).then(function (old) {
      var site = Object.assign({}, rep || !old ? q.site || {} : old, { name: n });
      if (!rep && old && q.site) { site.settings = Object.assign({}, (q.site || {}).settings || {}, old.settings || {}); if (!site.mainFile) site.mainFile = q.site.mainFile; }
      if (!site.created) site.created = Date.now();
      var steps = [];
      if (rep) steps.push(function () { return Promise.all(["files", "apps"].map(function (s) { return run("genba", s, "readwrite", function (st) { return st.delete(range(n)); }); })); });
      // 図面
      (q.files || []).forEach(function (f) { steps.push(function () {
        return (rep ? Promise.resolve(null) : run("genba", "files", "readonly", function (st) { return st.get(FK(n, f.name)); })).then(function (cur) {
          if (cur && (cur.at || 0) > (f.at || 0)) return;   // まとめる:この端末の方が新しければそのまま
          return unpack(f.bytes, get).then(function (b) { var rec = { name: f.name, type: f.type || "", lastModified: f.lastModified || Date.now(), at: f.at || Date.now(), from: f.from || "", bytes: b }; if (f.base) rec.base = f.base; return run("genba", "files", "readwrite", function (st) { return st.put(rec, FK(n, f.name)); }); });
        });
      }); });
      // アプリごとの作業(新しい方を残す)
      steps.push(function () {
        return unpack(q.apps || {}, get).then(function (apps) {
          return Object.keys(apps).reduce(function (p, a) { return p.then(function () {
            return run("genba", "apps", "readonly", function (st) { return st.get(FK(n, a)); }).then(function (cur) {
              if (!rep && cur && !newer(apps[a], cur)) return;
              return run("genba", "apps", "readwrite", function (st) { return st.put(apps[a], FK(n, a)); });
            });
          }); }, Promise.resolve());
        });
      });
      // 座標(まとめる:名前で足す・置き換える)
      steps.push(function () {
        var pts = (q.points && q.points.points) || [];
        if (rep) return run("genba", "points", "readwrite", function (st) { return st.put(q.points || { points: [] }, n); });
        if (!pts.length) return;
        return run("genba", "points", "readonly", function (st) { return st.get(n); }).then(function (cur) {
          var a = ((cur && cur.points) || []).slice();
          pts.forEach(function (p) { var i = a.findIndex(function (x) { return x.name === p.name; }); if (i < 0) a.push(p); else if ((q.points.at || 0) > ((cur && cur.at) || 0)) a[i] = p; });
          return run("genba", "points", "readwrite", function (st) { return st.put({ points: a, at: Math.max((cur && cur.at) || 0, q.points.at || 0) || Date.now(), from: (q.points && q.points.from) || "sync" }, n); });
        });
      });
      // 写し太郎(写真は id で重ねない。ツリーは無ければ入れる。黒板のひな形・測点は足す)
      var U = q.utsushi;
      if (U) {
        if (rep) steps.push(function () { return run("uts", "photos", "readonly", function (st) { return st.index("site").getAllKeys(n); }).then(function (ks) { return run("uts", "photos", "readwrite", function (st) { (ks || []).forEach(function (k) { st.delete(k); }); }); }); });
        (U.photos || []).forEach(function (ph) { steps.push(function () {
          return (rep ? Promise.resolve(null) : run("uts", "photos", "readonly", function (st) { return st.get(ph.id); })).then(function (cur) {
            if (cur && (cur.mt || cur.at || 0) >= (ph.mt || ph.at || 0)) return;   // まとめる:同じ写真で、直したのがこの端末の方が新しければそのまま
            return unpack(ph, get).then(function (p) { p.site = n; return run("uts", "photos", "readwrite", function (st) { return st.put(p); }); });
          });
        }); });
        if (U.tree) steps.push(function () { return run("uts", "trees", "readonly", function (st) { return st.get(n); }).then(function (cur) { if (!rep && cur && cur.length) return; return run("uts", "trees", "readwrite", function (st) { return st.put(U.tree, n); }); }); });
        (U.boards || []).forEach(function (b) { steps.push(function () { b.site = n; return run("uts", "boards", "readwrite", function (st) { return st.put(b); }); }); });
        if (U.spots) steps.push(function () { var cur = []; try { cur = JSON.parse(lsGet("ut.spots." + n) || "[]") || []; } catch (e) { /* */ } var a = rep ? [] : cur.slice(); U.spots.forEach(function (s) { if (a.indexOf(s) < 0) a.push(s); }); lsSet("ut.spots." + n, JSON.stringify(a)); });
      }
      // ペン太郎の写真帳(写真は id で重ねない。今の並びの後ろに足す)
      if (q.pen) steps.push(function () {
        return Promise.all((q.pen.items || []).map(function (it) { return unpack(it, get); })).then(function (inc) {
          var shown = lsGet("pen.win.albumSite"), live = shown === n || (shown == null && G.current() === n);
          var curP = live ? run("pen", "items", "readonly", function (st) { return st.getAll(); }).then(function (a) { return { items: a || [], cfg: lsGet("sp.cfg") }; })
            : run("pens", "albums", "readonly", function (st) { return st.get(n); }).then(function (r) { return r || { items: [], cfg: null }; });
          return curP.then(function (cur) {
            var items = rep ? [] : (cur.items || []).slice().sort(function (a, b) { return a.order - b.order; }), have = {};
            items.forEach(function (it) { have[it.id] = 1; });
            inc.sort(function (a, b) { return a.order - b.order; }).forEach(function (it) { if (!have[it.id]) { items.push(it); have[it.id] = 1; } });
            items.forEach(function (it, i) { it.order = i; });
            var cfg = rep || !cur.cfg ? q.pen.cfg : cur.cfg;
            if (q.pen.pages && (rep || !lsGet("pen.win.pages." + n))) lsSet("pen.win.pages." + n, JSON.stringify(q.pen.pages));
            if (live) return run("pen", "items", "readwrite", function (st) { if (rep) st.clear(); items.forEach(function (it) { st.put(it); }); }).then(function () { if (cfg) lsSet("sp.cfg", cfg); });
            return run("pens", "albums", "readwrite", function (st) { return st.put({ items: items, cfg: cfg, at: Date.now() }, n); });
          });
        });
      });
      // 3D(LandXML)
      if (q.xs) steps.push(function () { return run("xs", "kv", "readonly", function (st) { return st.get("g:" + n); }).then(function (cur) { if (!rep && cur && !newer(q.xs, cur)) return; return unpack(q.xs, get).then(function (v) { return run("xs", "kv", "readwrite", function (st) { return st.put(v, "g:" + n); }); }); }); });
      steps.push(function () { if (!site.mainFile && q.files && q.files[0]) site.mainFile = q.files[0].name; return G.put(site); });
      return steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () { return Object.assign({ name: n }, count(q)); });
    });
  }
  // file:File(.zip / .json)。opt.mode "merge"(既定)/"replace"。opt.ask(n) が false を返したら別の名前で入れる(置き換えのときだけ聞く)
  G.importFile = function (file, opt) {
    opt = opt || {};
    var mode = opt.mode || "merge";
    var isZip = file.slice(0, 4).arrayBuffer().then(function (b) { var u = new Uint8Array(b); return u[0] === 0x50 && u[1] === 0x4b; });
    return isZip.then(function (z) {
      if (!z) return file.text().then(function (t) { return G.importSites(JSON.parse(t), mode === "replace" ? { ask: opt.ask } : { overwrite: true }); }).then(function (a) { return (a || []).map(function (n) { return { name: n }; }); });
      return zipReader(file).then(function (zr) {
        return zr.get("genba.json").then(function (b) {
          var meta = JSON.parse(new TextDecoder().decode(b));
          if (!meta || meta.kind !== "ippatsu-genba-zip" || !Array.isArray(meta.sites)) throw new Error("一発バーンで保存した現場の ZIP ではありません");
          var done = [];
          return meta.sites.reduce(function (p, q) { return p.then(function () {
            var n = String(q.name || "").slice(0, 30); if (!n) return;
            return G.get(n).then(function (old) {
              if (old && mode === "replace" && opt.ask && !opt.ask(n)) { var i = 2; while (G.names().indexOf(n + "(" + i + ")") >= 0) i++; n = n + "(" + i + ")"; }
              return putSite(q, n, mode, zr.get).then(function (r) { done.push(r); });
            });
          }); }, Promise.resolve()).then(function () { return G.list().then(function () { try { window.dispatchEvent(new CustomEvent("genba", { detail: { type: "import", names: done.map(function (d) { return d.name; }), from: opt.from || "file" } })); } catch (e) { /* */ } return done; }); });
        });
      });
    });
  };
})();

;// 一発バーン クラウド共有(2026-11-25)
// クラウドの「共有フォルダ」に、現場ごと genba_〈現場名〉.zip(中身は ippatsu_sync.js の ZIP)と、そのしるし genba_〈現場名〉.zip.json を置く。
// 同じフォルダを選んだ端末どうしで、現場(座標・図面・工事写真・ツリー・測点・写真帳・3D)を自動で受け渡す。
//   携帯(Android アプリ):Google でログイン → Google ドライブの共有フォルダ(名前「一発バーン現場共有」は自動で見つける)
//   パソコン:Google ドライブ(パソコン版)で見えている同じフォルダを「📁 共有フォルダを選ぶ」で選ぶ(ログイン不要)
// どちらも同じ中身なので、携帯⇔パソコンでも受け渡せる。
// 変わったかどうかは、前に受け渡したときのしるし(この端末の記録)とくらべて決める:
//   こちらだけ変わった → 送る/クラウドだけ変わった → 受け取って置き換える/両方変わった → まとめて(足し合わせ・新しい方)送る
(function () {
  "use strict";
  var G = window.Genba; if (!G || G.cloud || !G.exportZip) return;
  var A = window.KurukuruAndroid;
  var SHARE = "一発バーン現場共有";
  var CK = "ipx.cloud";
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* */ } };
  var esc = G.esc;
  function cfg() { try { return JSON.parse(lsGet(CK) || "null") || {}; } catch (e) { return {}; } }
  function setCfg(c) { lsSet(CK, JSON.stringify(c)); }
  function baseKey(c) { return "ipx.cloud.base." + (c.type || "") + ":" + (c.id || ""); }
  function bases(c) { try { return JSON.parse(lsGet(baseKey(c)) || "{}") || {}; } catch (e) { return {}; } }
  function setBases(c, b) { lsSet(baseKey(c), JSON.stringify(b)); }
  function devName() { try { return A && A.device ? A.device() : (navigator.platform || "PC"); } catch (e) { return "?"; } }
  function safe(n) { var s = String(n).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim(); return s === n ? s : s + "_" + hash4(n); }
  function hash4(t) { var h = 0x811c9dc5; for (var i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0).toString(16).slice(0, 4); }
  function zipName(n) { return "genba_" + safe(n) + ".zip"; }
  var isAndroid = !!(A && A.driveStatus);
  var hasFolderApi = typeof window.showDirectoryPicker === "function";

  // ================================================================ Google ドライブ(Android アプリ)
  var waiters = { tok: [], login: [] };
  window.__driveToken = function (r) { var w = waiters.tok; waiters.tok = []; w.forEach(function (f) { f(r); }); };
  window.__driveLogin = function (r) { var w = waiters.login; waiters.login = []; w.forEach(function (f) { f(r); }); };
  function dStatus() { try { return JSON.parse(A.driveStatus()); } catch (e) { return {}; } }
  function token() {
    return new Promise(function (ok, ng) {
      waiters.tok.push(function (r) { if (r && r.token) ok(r.token); else ng(new Error(r && r.error === "nologin" ? "Google のログインが切れました。もう一度ログインしてください" : "鍵をもらえません: " + (r && r.error))); });
      if (waiters.tok.length === 1) A.driveToken();
    });
  }
  function login() {
    return new Promise(function (ok, ng) {
      waiters.login.push(function (r) { if (r && r.ok) ok(r); else ng(new Error(r && r.error === "noclient" ? "noclient" : (r && r.error) || "ログインできませんでした")); });
      if (waiters.login.length === 1) A.driveLogin();
    });
  }
  var API = "https://www.googleapis.com/drive/v3/", UP = "https://www.googleapis.com/upload/drive/v3/files";
  var ALL = "supportsAllDrives=true&includeItemsFromAllDrives=true";
  function api(path, opt) {
    opt = opt || {};
    return token().then(function (t) {
      var h = Object.assign({ Authorization: "Bearer " + t }, opt.headers || {});
      return fetch(path.indexOf("https:") === 0 ? path : API + path, { method: opt.method || "GET", headers: h, body: opt.body });
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { var m = t; try { m = JSON.parse(t).error.message; } catch (e) { /* */ } throw new Error("ドライブ: " + r.status + " " + m); });
      return opt.raw ? r : r.status === 204 ? null : opt.blob ? r.blob() : r.json();
    });
  }
  function q(s) { return encodeURIComponent(s); }
  function qs(s) { return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; }
  var FOLDER = "application/vnd.google-apps.folder";
  function dList(query, fields) {
    var out = [];
    var page = function (tok) {
      return api("files?q=" + q(query) + "&corpora=allDrives&" + ALL + "&pageSize=1000&fields=" + q("nextPageToken,files(" + (fields || "id,name,mimeType,size,modifiedTime,driveId,parents") + ")") + (tok ? "&pageToken=" + q(tok) : "")).then(function (r) {
        out = out.concat(r.files || []);
        return r.nextPageToken ? page(r.nextPageToken) : out;
      });
    };
    return page(null);
  }
  function dUpload(parent, name, blob, id, mime) {
    var meta = id ? {} : { name: name, parents: [parent] };
    return api(UP + (id ? "/" + id : "") + "?uploadType=resumable&supportsAllDrives=true", {
      method: id ? "PATCH" : "POST", raw: true, body: JSON.stringify(meta),
      headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(blob.size) }
    }).then(function (r) {
      var loc = r.headers.get("Location");
      if (!loc) {   // 送り先(Location)が読めないとき:中身といっしょに1回で送る
        var bd = "ipx" + Date.now().toString(36);
        var body = new Blob(["--" + bd + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + bd + "\r\nContent-Type: " + mime + "\r\n\r\n", blob, "\r\n--" + bd + "--"]);
        return api(UP + (id ? "/" + id : "") + "?uploadType=multipart&supportsAllDrives=true", { method: id ? "PATCH" : "POST", body: body, headers: { "Content-Type": "multipart/related; boundary=" + bd } });
      }
      return fetch(loc, { method: "PUT", body: blob }).then(function (r2) { if (!r2.ok) throw new Error("ドライブ: 送れません " + r2.status); return r2.json(); });
    });
  }
  var Drive = {
    kind: "drive",
    list: function (c) {
      return dList(qs(c.id) + " in parents and trashed=false and name contains 'genba_'").then(function (fs) {
        var by = {}; fs.forEach(function (f) { by[f.name] = f; });
        var sides = fs.filter(function (f) { return /^genba_.*\.zip\.json$/.test(f.name); });
        return Promise.all(sides.map(function (s) {
          return api("files/" + s.id + "?alt=media&supportsAllDrives=true", { blob: true }).then(function (b) { return b.text(); }).then(function (t) {
            var side = JSON.parse(t), z = by[s.name.replace(/\.json$/, "")];
            return { site: side.site, side: side, side_ref: s.id, ref: z && z.id, size: z ? +z.size : -1, name: s.name.replace(/\.json$/, "") };
          }).catch(function () { return null; });
        })).then(function (a) { return a.filter(Boolean); });
      });
    },
    get: function (c, e) { return api("files/" + e.ref + "?alt=media&supportsAllDrives=true", { blob: true }); },
    put: function (c, n, blob, side, e) {
      var zn = zipName(n);
      return dUpload(c.id, zn, blob, e && e.ref, "application/zip").then(function () {
        return dUpload(c.id, zn + ".json", new Blob([JSON.stringify(side)], { type: "application/json" }), e && e.side_ref, "application/json");
      });
    }
  };

  // ================================================================ パソコンのフォルダ(Google ドライブ パソコン版で同期しているフォルダ)
  function kv(mode, fn) {
    return new Promise(function (ok, ng) {
      var rq = indexedDB.open("ippatsu-cloud", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
      rq.onerror = function () { ng(rq.error); };
      rq.onsuccess = function () {
        var db = rq.result, t = db.transaction("kv", mode), r = fn(t.objectStore("kv")), out;
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { db.close(); ok(out); }; t.onerror = function () { db.close(); ng(t.error); };
      };
    });
  }
  function dirHandle(ask) {
    return kv("readonly", function (s) { return s.get("dir"); }).then(function (h) {
      if (!h) throw new Error("共有フォルダがまだ選ばれていません");
      var o = { mode: "readwrite" };
      return h.queryPermission(o).then(function (p) {
        if (p === "granted") return h;
        if (!ask) { var e = new Error("perm"); e.perm = true; throw e; }
        return h.requestPermission(o).then(function (p2) { if (p2 !== "granted") throw new Error("フォルダを使う許可がありません"); return h; });
      });
    });
  }
  var Folder = {
    kind: "folder",
    list: function (c, ask) {
      return dirHandle(ask).then(function (d) {
        var ents = {}, it = d.entries();
        var step = function () {
          return it.next().then(function (r) { if (r.done) return; ents[r.value[0]] = r.value[1]; return step(); });
        };
        return step().then(function () {
          var names = Object.keys(ents).filter(function (k) { return /^genba_.*\.zip\.json$/.test(k) && ents[k].kind === "file"; });
          return Promise.all(names.map(function (k) {
            return ents[k].getFile().then(function (f) { return f.text(); }).then(function (t) {
              var side = JSON.parse(t), zn = k.replace(/\.json$/, ""), zh = ents[zn];
              return (zh ? zh.getFile().then(function (f) { return f.size; }) : Promise.resolve(-1)).then(function (sz) { return { site: side.site, side: side, ref: zn, size: sz, name: zn }; });
            }).catch(function () { return null; });
          })).then(function (a) { return a.filter(Boolean); });
        });
      });
    },
    get: function (c, e) { return dirHandle(false).then(function (d) { return d.getFileHandle(e.ref); }).then(function (h) { return h.getFile(); }); },
    put: function (c, n, blob, side) {
      var zn = zipName(n);
      return dirHandle(false).then(function (d) {
        var w = function (name, b) { return d.getFileHandle(name, { create: true }).then(function (h) { return h.createWritable(); }).then(function (s) { return s.write(b).then(function () { return s.close(); }); }); };
        return w(zn, blob).then(function () { return w(zn + ".json", new Blob([JSON.stringify(side)], { type: "application/json" })); });
      });
    }
  };
  var TS = { drive: Drive, folder: Folder };
  function T(c) { return TS[c.type] || null; }

  // ================================================================ 受け渡し
  var busy = null;
  function sync(opt) {
    opt = opt || {};
    if (busy) return busy;
    var c = cfg(), t = T(c);
    if (!t || !c.id) return Promise.reject(new Error("クラウドの共有フォルダがまだ決まっていません"));
    var rep = { pulled: [], pushed: [], merged: [], waiting: [], gone: [], errors: [] };
    var note = opt.progress || function () {};
    if (c.type === "drive" && A && A.netInternet) try { A.netInternet(true); } catch (e) { /* */ }
    busy = t.list(c, opt.ask).then(function (remote) {
      var R = {}; remote.forEach(function (e) { if (e.site) R[e.site] = e; });
      return G.list().then(function (recs) {
        var B = bases(c), local = recs.map(function (r) { return r.name; });
        var all = local.concat(Object.keys(R).filter(function (n) { return local.indexOf(n) < 0; }));
        var i = 0;
        return all.reduce(function (p, n) { return p.then(function () {
          note("☁ " + n + "(" + (++i) + " / " + all.length + ")");
          return one(c, t, n, local.indexOf(n) >= 0, R[n], B, rep).then(function () { setBases(c, B); }, function (e) { rep.errors.push(n + ": " + e.message); });
        }); }, Promise.resolve());
      });
    }).then(function () {
      c = cfg(); c.last = { at: Date.now(), pulled: rep.pulled.length, pushed: rep.pushed.length, merged: rep.merged.length, err: rep.errors[0] || "" }; setCfg(c);
      if (rep.pulled.length || rep.merged.length) try { window.dispatchEvent(new CustomEvent("genba", { detail: { type: "import", names: rep.pulled.concat(rep.merged), from: "cloud" } })); } catch (e) { /* */ }
      return rep;
    }, function (e) {
      c = cfg(); c.last = { at: Date.now(), err: e.message, perm: !!e.perm }; setCfg(c); throw e;
    });
    var done = function () { busy = null; if (c.type === "drive" && A && A.netInternet) try { A.netInternet(false); } catch (e) { /* */ } };
    busy.then(done, done);
    return busy;
  }
  function ready(e) { return e && e.ref && e.side && e.size === e.side.size; }   // ZIP としるしの大きさがそろっていなければ、まだ届いている途中
  function sideOf(n, sig, blob) { return { kind: "ippatsu-genba-side", v: 1, site: n, sig: sig, size: blob.size, at: Date.now(), by: devName(), count: blob.summary && blob.summary[0] }; }
  function push(c, t, n, e) {
    return G.siteSig(n).then(function (s) {
      return G.exportZip([n]).then(function (blob) { return t.put(c, n, blob, sideOf(n, s.sig, blob), e).then(function () { return s.sig; }); });
    });
  }
  function pull(c, t, n, e, mode) {
    return t.get(c, e).then(function (blob) {
      if (blob.size !== e.side.size) throw new Error("クラウドの ZIP がまだ届いている途中です");
      return G.importFile(blob, { mode: mode, from: "cloud" });
    }).then(function () { return G.siteSig(n); }).then(function (s) { return s.sig; });
  }
  function one(c, t, n, isLocal, e, B, rep) {
    var b = B[n] || {};
    if (!isLocal) {
      if (b.l) { rep.gone.push(n); return Promise.resolve(); }   // この端末で消した現場は、勝手に戻さない(「受け取る」で戻せる)
      if (!ready(e)) { rep.waiting.push(n); return Promise.resolve(); }
      return pull(c, t, n, e, "replace").then(function (L2) { B[n] = { l: L2, r: e.side.sig }; rep.pulled.push(n); });
    }
    return G.siteSig(n).then(function (s) {
      var L = s.sig;
      if (!e) return push(c, t, n, null).then(function (sig) { B[n] = { l: L, r: sig }; rep.pushed.push(n); });
      if (!ready(e)) { rep.waiting.push(n); return; }
      var R = e.side.sig, lc = L !== b.l, rc = R !== b.r;
      if (R === L) { B[n] = { l: L, r: R }; return; }
      if (!b.l && !b.r) { lc = rc = true; }
      if (!lc && !rc) return;
      if (!lc && rc) return pull(c, t, n, e, "replace").then(function (L2) { B[n] = { l: L2, r: R }; rep.pulled.push(n); });
      if (lc && !rc) return push(c, t, n, e).then(function (sig) { B[n] = { l: L, r: sig }; rep.pushed.push(n); });
      return pull(c, t, n, e, "merge").then(function () { return push(c, t, n, e); }).then(function (sig) { B[n] = { l: sig, r: sig }; rep.merged.push(n); });
    });
  }
  // この端末で消した現場をクラウドから戻す
  function restore(n) {
    var c = cfg(), t = T(c), B = bases(c);
    return t.list(c, true).then(function (remote) {
      var e = remote.filter(function (x) { return x.site === n; })[0];
      if (!ready(e)) throw new Error("クラウドに「" + n + "」がありません");
      return pull(c, t, n, e, "replace").then(function (L2) { B[n] = { l: L2, r: e.side.sig }; setBases(c, B); });
    });
  }

  // ================================================================ 画面(一発バーンのメニューの「☁ クラウド共有」)
  var p2 = function (v) { return String(v).padStart(2, "0"); };
  var when = function (t) { if (!t) return ""; var d = new Date(t); return (d.getMonth() + 1) + "/" + d.getDate() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()); };
  var box = null;
  function render() {
    if (!box) return;
    var c = cfg(), h = "";
    var st = isAndroid ? dStatus() : {};
    if (c.type && c.id) {
      var L = c.last || {};
      h += '<div class="nm" style="font-size:17px">☁ ' + esc(c.name || SHARE) + "<\/div>";
      h += '<div class="info">' + (c.type === "drive" ? "Google ドライブ" + (st.email ? "(" + esc(st.email) + ")" : "") + (c.path ? "・" + esc(c.path) : "") : "パソコンのフォルダ(Google ドライブで同期)") + "<br>";
      h += L.at ? "最後の同期 " + when(L.at) + (L.err ? ' <b style="color:var(--ng)">⚠ ' + esc(L.perm ? "「☁ いますぐ同期」を押してフォルダの使用を許可してください" : L.err) + "<\/b>" : "(受け取り " + (L.pulled || 0) + "・送り " + (L.pushed || 0) + (L.merged ? "・まとめ " + L.merged : "") + ")") : "まだ同期していません";
      h += '<\/div><div class="btns"><button type="button" class="pri" data-c="sync">☁ いますぐ同期<\/button><button type="button" data-c="change">接続するフォルダを変える<\/button>' + (c.type === "drive" ? '<button type="button" data-c="logout">接続を切る<\/button>' : '<button type="button" data-c="stop">接続を切る<\/button>') + "<\/div>";
      h += '<label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:14px"><input type="checkbox" data-c="auto" ' + (c.auto !== false ? "checked" : "") + ' style="width:22px;height:22px" /> 一発バーンを開いたとき自動で同期する<\/label>';
      h += '<div id="ipxCloudMsg" class="info" style="margin-bottom:0"><\/div>';
    } else if (isAndroid) {
      h += '<div class="info">Google ドライブの共有フォルダ「' + SHARE + '」に接続して、ほかの携帯・パソコンと現場(座標・図面・工事写真・写真帳・3D)を自動で受け渡します。どの端末でも、同じ Google のアカウント(またはフォルダを共有した人)でログインすれば、同じフォルダを自動で見つけて接続します。<\/div>' + '<div class="info" style="background:rgba(46,160,67,.12);border-radius:8px;padding:8px 10px">✅ <b>この端末の現場は消えません。<\/b>接続すると、この端末の現場はそのままフォルダにも置かれ、フォルダにあるほかの端末の現場がこの端末に足されます。<\/div>';
      if (!st.client) h += '<div class="info"><b>⚠ Google の登録ファイルがまだアプリに入っていません。<\/b>手順書のとおりに作った <code>google_client.json<\/code>(client_secret_〜.json)を「🔑 登録ファイルを読む」で選んでください。<\/div>';
      h += '<div class="btns">' + (st.client ? '<button type="button" class="pri" data-c="login">' + (st.login ? "🔗 クラウドのフォルダに接続" : "🔗 クラウドのフォルダに接続(Google でログイン)") + "<\/button>" : "") + '<button type="button" data-c="client">🔑 登録ファイルを読む<\/button><\/div><input type="file" id="ipxCloudCli" accept=".json,application/json,*/*" hidden />';
      h += '<div id="ipxCloudMsg" class="info" style="margin-bottom:0"><\/div>';
    } else if (hasFolderApi) {
      h += '<div class="info">パソコンでは、Google ドライブ(パソコン版)で見えている共有フォルダ「' + SHARE + '」を選んで接続するだけです(ログイン不要)。携帯は同じフォルダに Google ドライブとして接続します。<\/div>' + '<div class="info" style="background:rgba(46,160,67,.12);border-radius:8px;padding:8px 10px">✅ <b>この端末の現場は消えません。<\/b>接続すると、この端末の現場はそのままフォルダにも置かれ、フォルダにあるほかの端末の現場がこの端末に足されます。<\/div>';
      h += '<div class="btns"><button type="button" class="pri" data-c="dir">🔗 クラウドのフォルダに接続<\/button><\/div><div id="ipxCloudMsg" class="info" style="margin-bottom:0"><\/div>';
    } else {
      h += '<div class="info">このブラウザではフォルダを選べません。Chrome か Edge で開くか、「⬇ 保存」「⬆ 取り込む」の ZIP で受け渡してください。<\/div>';
    }
    box.innerHTML = h;
  }
  function msg(t) { var m = document.getElementById("ipxCloudMsg"); if (m) m.innerHTML = t; }
  function report(r) {
    var a = [];
    if (r.pulled.length) a.push("受け取り:" + r.pulled.map(esc).join("、"));
    if (r.pushed.length) a.push("送り:" + r.pushed.map(esc).join("、"));
    if (r.merged.length) a.push("まとめ:" + r.merged.map(esc).join("、"));
    if (r.waiting.length) a.push("届いている途中(あとでもう一度):" + r.waiting.map(esc).join("、"));
    if (r.gone.length) a.push('この端末で消した現場(クラウドにはあります):' + r.gone.map(function (n) { return esc(n) + ' <button type="button" data-c="restore" data-n="' + esc(n) + '">戻す<\/button>'; }).join(" "));
    if (r.errors.length) a.push('<b style="color:var(--ng)">⚠ ' + r.errors.map(esc).join("<br>") + "<\/b>");
    return a.length ? a.join("<br>") : "変わったところはありません。";
  }
  function runSync(ask) {
    msg("☁ 同期しています…");
    return sync({ ask: ask, progress: function (t) { msg(esc(t)); } }).then(function (r) { render(); msg(report(r)); return r; }, function (e) { render(); if (!e.perm) msg('<b style="color:var(--ng)">⚠ ' + esc(e.message) + "<\/b>"); });
  }
  // ---- Google ドライブのフォルダを選ぶ
  function driveSetup() {
    msg("☁ 接続するフォルダ「" + SHARE + "」をさがしています…");
    if (A.netInternet) try { A.netInternet(true); } catch (e) { /* */ }
    return dList("name=" + qs(SHARE) + " and mimeType='" + FOLDER + "' and trashed=false").then(function (fs) {
      if (fs.length === 1) return useDrive(fs[0]);
      return browse(fs);
    }).catch(function (e) { msg('<b style="color:var(--ng)">⚠ ' + esc(e.message) + "<\/b>"); });
  }
  function driveNames() { return api("drives?pageSize=100").then(function (r) { var m = {}; (r.drives || []).forEach(function (d) { m[d.id] = d.name; }); return m; }).catch(function () { return {}; }); }
  function useDrive(f, path) {
    return (path ? Promise.resolve(path) : driveNames().then(function (m) { return f.driveId ? "共有ドライブ「" + (m[f.driveId] || "?") + "」" : "マイドライブ / 共有アイテム"; })).then(function (pth) {
      setCfg({ type: "drive", id: f.id, name: f.name, path: pth, auto: true });
      render(); return runSync(false);
    });
  }
  // 見つからない・いくつもあるとき:フォルダをたどって選ぶ
  function browse(found) {
    var stack = [], d = null;
    var show = function (title, items, here) {
      var body = '<div style="max-height:50vh;overflow:auto">' + (items.length ? items.map(function (f, i) { return '<button type="button" data-i="' + i + '" style="display:block;width:100%;text-align:left;margin:4px 0;padding:10px;border-radius:8px;border:1px solid var(--line,#ccd);background:transparent;color:inherit;font:inherit">📁 ' + esc(f.name) + (f.note ? '<br><small style="opacity:.7">' + esc(f.note) + "<\/small>" : "") + "<\/button>"; }).join("") : '<div class="ipx-sub">フォルダがありません<\/div>') + "<\/div>";
      var btns = [];
      if (here) btns.push({ label: "このフォルダに接続する", ok: true, run: function () { useDrive(here, stack.map(function (s) { return s.name; }).join(" / ")); } });
      if (here) btns.push({ label: "＋ここに「" + SHARE + "」を作る", run: function () {
        api("files?supportsAllDrives=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: SHARE, mimeType: FOLDER, parents: [here.id] }) }).then(function (f) { stack.push(here); useDrive({ id: f.id, name: SHARE }, stack.map(function (s) { return s.name; }).join(" / ")); }).catch(function (e) { msg(esc(e.message)); });
      } });
      if (stack.length) btns.push({ label: "← もどる", run: function () { var p = stack.pop(); p.open(); } });
      btns.push({ label: "やめる" });
      if (d) d.close();
      d = G.dialog(title, body, btns, here ? "いまの場所:" + esc(stack.map(function (s) { return s.name; }).concat(here.name).join(" / ")) : "");
      d.el.querySelectorAll("[data-i]").forEach(function (b) { b.onclick = function () { var f = items[+b.dataset.i]; if (here) stack.push(here); f.open(); }; });
    };
    var folder = function (f) {
      f.open = function () {
        dList(qs(f.id) + " in parents and mimeType='" + FOLDER + "' and trashed=false").then(function (fs) {
          fs.sort(function (a, b) { return a.name.localeCompare(b.name, "ja"); });
          show(f.name, fs.map(folder), f);
        }).catch(function (e) { msg(esc(e.message)); });
      };
      return f;
    };
    var top = { name: "Google ドライブ", open: function () {
      stack = [];
      driveNames().then(function (m) {
        var items = (found || []).map(function (f) { f.note = "見つかった「" + SHARE + "」" + (f.driveId ? "(共有ドライブ「" + (m[f.driveId] || "?") + "」)" : ""); f.open = function () { useDrive(f); if (d) d.close(); }; return f; });
        items.push(folder({ id: "root", name: "マイドライブ" }));
        Object.keys(m).forEach(function (id) { items.push(folder({ id: id, name: m[id], note: "共有ドライブ" })); });
        show(found && found.length ? "「" + SHARE + "」がいくつかあります。どれを使いますか" : "接続するフォルダを選んでください", items, null);
        msg(found && found.length ? "" : "「" + SHARE + "」が見つかりませんでした。フォルダを作る場所を選んで「作る」か、接続するフォルダを選んでください。");
      });
    } };
    top.open();
  }
  function onClick(ev) {
    var b = ev.target.closest("[data-c]"); if (!b || !box.contains(b)) return;
    var a = b.dataset.c, c = cfg();
    if (a === "auto") { c.auto = b.checked; setCfg(c); return; }
    if (a === "sync") return runSync(true);
    if (a === "restore") { msg("☁ 戻しています…"); return restore(b.dataset.n).then(function () { msg("「" + esc(b.dataset.n) + "」を戻しました。"); try { window.dispatchEvent(new CustomEvent("genba", { detail: { type: "import", names: [b.dataset.n], from: "cloud" } })); } catch (e) { /* */ } }, function (e) { msg(esc(e.message)); }); }
    if (a === "client") { var fi = document.getElementById("ipxCloudCli"); fi.onchange = function () { var f = fi.files[0]; fi.value = ""; if (!f) return; f.text().then(function (t) { var r = A.driveSetClient(t); if (r !== "ok") msg(esc(r)); else { render(); msg("登録ファイルを読みました。「Google でログイン」を押してください。"); } }); }; fi.click(); return; }
    if (a === "login") {
      if (dStatus().login) return driveSetup();
      msg("ブラウザで Google にログインして、「許可」を押してください。終わるとここに戻ります。");
      return login().then(function () { render(); return driveSetup(); }, function (e) { msg('<b style="color:var(--ng)">⚠ ' + esc(e.message === "noclient" ? "Google の登録ファイルがありません" : e.message) + "<\/b>"); });
    }
    if (a === "dir") {
      return window.showDirectoryPicker({ id: "ippatsu-cloud", mode: "readwrite" }).then(function (h) {
        return kv("readwrite", function (s) { return s.put(h, "dir"); }).then(function () {
          setCfg({ type: "folder", id: "dir:" + h.name, name: h.name, auto: true });
          if (h.name !== SHARE) G.dialog("フォルダに接続しました", "", null, "「" + esc(h.name) + "」に接続しました。この端末の現場はそのまま残ります。携帯からも同じフォルダ(Google ドライブ上の同じ場所)を選んでください。名前を「" + SHARE + "」にしておくと、携帯は自動で見つけます。");
          render(); return runSync(true);
        });
      }).catch(function (e) { if (e && e.name !== "AbortError") msg(esc(e.message)); });
    }
    if (a === "change") { if (c.type === "drive") { setCfg({}); render(); return driveSetup(); } setCfg({}); render(); return; }
    if (a === "logout") { if (!confirm("クラウドのフォルダとの接続を切りますか?\n(この端末の現場も、フォルダの中身も、そのまま残ります)")) return; A.driveLogout(); setCfg({}); render(); return; }
    if (a === "stop") { if (!confirm("クラウドのフォルダとの接続を切りますか?\n(この端末の現場も、フォルダの中身も、そのまま残ります)")) return; setCfg({}); kv("readwrite", function (s) { return s.delete("dir"); }).catch(function () {}); render(); return; }
  }
  G.cloud = {
    sync: sync, config: cfg, setConfig: setCfg, restore: restore, transports: TS,
    mount: function (el) {
      box = el; el.addEventListener("click", onClick); el.addEventListener("change", function (ev) { if (ev.target.dataset && ev.target.dataset.c === "auto") onClick(ev); });
      render();
      var c = cfg();
      // 開いたとき自動で。v2.12.0:開いてすぐは画面を出すのを先にして、8 秒後(見えているとき)に始める
      if (c.type && c.id && c.auto !== false && !window.IPPATSU_SAFE && navigator.onLine !== false) setTimeout(function go() { if (document.hidden) { setTimeout(go, 8000); return; } runSync(false); }, 8000);
    }
  };
})();

    
