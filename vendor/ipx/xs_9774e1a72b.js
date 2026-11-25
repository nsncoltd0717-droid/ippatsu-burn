// 一発バーン 3D 断面(make_apps.py が4本のアプリの <head> に入れる。ippatsu_common.js のあと)
// 【ECP一撃測量 v1.18.0 から】設計の面(LandXML の TIN・図面の 3D 線・点の高さ)と中心線(LandXML の線形・図面の線)から、
//   横断図・3D・切り盛りを出す。くるくる回し太郎ではプリズムの位置で、ほかのアプリは図面をタップした所(図面で測る)で切る。
// アプリは window.IPPATSU_HOST に次を入れる(無ければ何もしない):
//   svg(図面の <svg>)・toScreen(p)(図面 mm → 画面)・lines()・picks()・hM()(点の h を m にする係数)・drawingK()・setStatus(msg, warn)・redraw()
//   addPicks(list)?(名前つきの点を足す)・target()?(くるくる:{ P:{x,y}, zTip })・inst()?(杭ナビの位置)・aim(x, y)?(その方へ杭ナビを向ける)
// 図面の draw() の最後で IPPATSU_XS.plan() を呼ぶと、図面に設計の面・線形・横断の線を重ねる。
(function () {
  "use strict";
  if (window.IPPATSU_XS) return;
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* */ } } };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var H = function () { return window.IPPATSU_HOST || null; };
  var TL = function () { return window.TopLayout; };
  var say = function (m, w) { var h = H(); if (h && h.setStatus) h.setStatus(m, w); };
  var XS = { open: false, surf: null, gl: null, src: "", al: null, alName: "", als: [], alAuto: false, alPick: false, tapOn: true, tap: null,
    w: Number(ls.get("ipx.xsw")) || 10, tab: "xs", yaw: -0.7, pitch: 0.75, zoom3: 1.6, ex3: 2, pitch20: Number(ls.get("ipx.xspitch")) || 20, tol: 20 };

  // ---------------------------------------------------------------- 面(三角網)
  function surfMake(px, py, pz, T, src) {
    var n = px.length, m = T.length / 3, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < n; i++) { if (px[i] < x0) x0 = px[i]; if (px[i] > x1) x1 = px[i]; if (py[i] < y0) y0 = py[i]; if (py[i] > y1) y1 = py[i]; }
    var area = Math.max(1, (x1 - x0) * (y1 - y0)), cs = Math.max(500, Math.sqrt(area / Math.max(1, m)) * 2);
    var gw = Math.max(1, Math.ceil((x1 - x0) / cs) + 1), gh = Math.max(1, Math.ceil((y1 - y0) / cs) + 1), cells = new Map();
    for (var t = 0; t < m; t++) {
      var a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      var ix0 = Math.floor((Math.min(px[a], px[b], px[c]) - x0) / cs), ix1 = Math.floor((Math.max(px[a], px[b], px[c]) - x0) / cs);
      var iy0 = Math.floor((Math.min(py[a], py[b], py[c]) - y0) / cs), iy1 = Math.floor((Math.max(py[a], py[b], py[c]) - y0) / cs);
      for (var iy = iy0; iy <= iy1; iy++) for (var ix = ix0; ix <= ix1; ix++) { var k = iy * gw + ix, L = cells.get(k); if (!L) cells.set(k, (L = [])); L.push(t); }
    }
    return { px: px, py: py, pz: pz, T: T, n: n, m: m, x0: x0, y0: y0, x1: x1, y1: y1, cs: cs, gw: gw, gh: gh, cells: cells, src: src };
  }
  function surfZ(S, x, y) {   // 設計の高さ(m)。面の外なら null
    if (!S || x < S.x0 || x > S.x1 || y < S.y0 || y > S.y1) return null;
    var L = S.cells.get(Math.floor((y - S.y0) / S.cs) * S.gw + Math.floor((x - S.x0) / S.cs)); if (!L) return null;
    for (var i = 0; i < L.length; i++) {
      var t = L[i], a = S.T[3 * t], b = S.T[3 * t + 1], c = S.T[3 * t + 2];
      var ax = S.px[a], ay = S.py[a], bx = S.px[b], by = S.py[b], cx = S.px[c], cy = S.py[c];
      var d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (!d) continue;
      var w0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, w1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w2 = 1 - w0 - w1;
      if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) return w0 * S.pz[a] + w1 * S.pz[b] + w2 * S.pz[c];
    }
    return null;
  }
  function pts3dOfLines(Ls) {   // 3D 線の頂点に、5 m ごとの途中の点を足す
    var P = [];
    (Ls || []).forEach(function (l) {
      if (!l.zs || !l.points) return;
      var q = l.points, z = l.zs, n = q.length + (l.closed ? 1 : 0);
      for (var i = 0; i < n; i++) {
        var a = q[i % q.length], za = z[i % q.length];
        if (za) P.push({ x: a[0], y: a[1], h: za / 1000 });
        if (i + 1 < n) {
          var b = q[(i + 1) % q.length], zb = z[(i + 1) % q.length], L2 = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.floor(L2 / 5000);
          if (za && zb) for (var j = 1; j <= k; j++) { var t = j / (k + 1); P.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, h: (za + (zb - za) * t) / 1000 }); }
        }
      }
    });
    return P;
  }
  function surfFromPoints(P, src) {   // P: [{x, y, h(m)}] → 三角網(点が多いときは間引く)
    var Q = P.filter(function (p) { return isFinite(p.x) && isFinite(p.y) && isFinite(p.h); });
    var MAX = 4000; if (Q.length > MAX) { var k = Math.ceil(Q.length / MAX); Q = Q.filter(function (_, i) { return i % k === 0; }); }
    if (Q.length < 3) throw new Error("高さのある点が 3 点より少ないので、面を作れません");
    var tin = TL().buildTin(Q);
    if (!tin.tris.length) throw new Error("三角形を作れませんでした(点が一直線に並んでいるかもしれません)");
    var px = new Float64Array(tin.pts.length), py = new Float64Array(tin.pts.length), pz = new Float64Array(tin.pts.length);
    tin.pts.forEach(function (p, i) { px[i] = p.x; py[i] = p.y; pz[i] = p.h; });
    var T = new Int32Array(tin.tris.length * 3); tin.tris.forEach(function (t, i) { T[3 * i] = t[0]; T[3 * i + 1] = t[1]; T[3 * i + 2] = t[2]; });
    return surfMake(px, py, pz, T, src);
  }
  // LandXML: <Surface> の <Pnts>(P = 北 東 高さ)と <Faces>、<Alignment> の <CoordGeom>(Line・Curve。Spiral は始点と終点を結ぶ)、<CgPoint>
  function parseLandXml(text) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("LandXML として読めません");
    var u0 = doc.querySelector("Units > *"), lu = u0 ? (u0.getAttribute("linearUnit") || "meter") : "meter";
    var f = /milli/i.test(lu) ? 1 : /centi/i.test(lu) ? 10 : /foot|feet/i.test(lu) ? 304.8 : 1000, fz = f / 1000;
    var nums = function (s) { return String(s || "").trim().split(/[\s,]+/).map(Number); };
    var best = null, bestGl = null;
    Array.prototype.forEach.call(doc.getElementsByTagName("Surface"), function (sf) {
      var grp = sf.parentElement && sf.parentElement.getAttribute ? (sf.parentElement.getAttribute("name") || "") : "";
      var isGl = /existing|現況|現地盤|地盤面|original/i.test(grp + " " + (sf.getAttribute("desc") || "") + " " + (sf.getAttribute("name") || ""));
      var ids = new Map(), X = [], Y = [], Z = [], T = [];
      Array.prototype.forEach.call(sf.getElementsByTagName("P"), function (p) { var v = nums(p.textContent); if (v.length < 3 || !v.every(isFinite)) return; ids.set(p.getAttribute("id"), X.length); Y.push(v[0] * f); X.push(v[1] * f); Z.push(v[2] * fz); });
      Array.prototype.forEach.call(sf.getElementsByTagName("F"), function (F) {
        if (F.getAttribute("i") === "1") return;
        var v = String(F.textContent).trim().split(/\s+/); if (v.length < 3) return;
        var a = ids.get(v[0]), b = ids.get(v[1]), c = ids.get(v[2]); if (a == null || b == null || c == null) return; T.push(a, b, c);
      });
      var cand = { name: sf.getAttribute("name") || "面", X: X, Y: Y, Z: Z, T: T.length ? T : null };
      if (isGl) { if (!bestGl || (T.length || 0) > (bestGl.T ? bestGl.T.length : 0)) bestGl = cand; }
      else if (T.length && (!best || !best.T || T.length > best.T.length)) best = cand;
      else if (!T.length && X.length >= 3 && !best) best = cand;
    });
    var mk = function (b, what) { return b.T ? surfMake(Float64Array.from(b.X), Float64Array.from(b.Y), Float64Array.from(b.Z), Int32Array.from(b.T), "LandXML の" + what + "「" + b.name + "」")
      : surfFromPoints(b.X.map(function (x, i) { return { x: x, y: b.Y[i], h: b.Z[i] }; }), "LandXML の" + what + "「" + b.name + "」"); };
    var gl = bestGl ? mk(bestGl, "現況の面") : null, surf = best ? mk(best, best.T ? "面" : "点") : null, als = [];
    Array.prototype.forEach.call(doc.getElementsByTagName("Alignment"), function (al) {
      var cg = al.getElementsByTagName("CoordGeom")[0]; if (!cg) return;
      var pts = [], add = function (p) { var l = pts[pts.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1) pts.push(p); };
      var ne = function (el) { var v = nums(el && el.textContent); return [v[1] * f, v[0] * f]; }, spiral = false;
      Array.prototype.forEach.call(cg.children, function (g) {
        var S = ne(g.getElementsByTagName("Start")[0]), E = ne(g.getElementsByTagName("End")[0]);
        if (!S.every(isFinite) || !E.every(isFinite)) return;
        if (g.tagName === "Curve") {
          var C = ne(g.getElementsByTagName("Center")[0]), cw = (g.getAttribute("rot") || "").toLowerCase() === "cw";
          var r = Math.hypot(S[0] - C[0], S[1] - C[1]), a0 = Math.atan2(S[1] - C[1], S[0] - C[0]), a1 = Math.atan2(E[1] - C[1], E[0] - C[0]), da = a1 - a0;
          if (cw) { while (da > 0) da -= 2 * Math.PI; } else { while (da < 0) da += 2 * Math.PI; }
          var n = Math.max(4, Math.ceil(Math.abs(da) * r / 1000));
          for (var i = 0; i <= n; i++) { var a = a0 + da * i / n; add([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
        } else { if (g.tagName === "Spiral") spiral = true; add(S); add(E); }
      });
      var prof = Array.prototype.map.call(al.getElementsByTagName("PVI"), function (e) { return nums(e.textContent); })
        .filter(function (v) { return v.length >= 2 && v.every(isFinite); }).map(function (v) { return [v[0] * f, v[1] * fz]; }).sort(function (a, b) { return a[0] - b[0]; });
      if (pts.length >= 2) als.push({ name: al.getAttribute("name") || "線形", pts: pts, sta0: (Number(al.getAttribute("staStart")) || 0) * f, spiral: spiral, prof: prof.length >= 2 ? prof : null });
    });
    var cgp = [];
    Array.prototype.forEach.call(doc.getElementsByTagName("CgPoint"), function (c) { var v = nums(c.textContent); if (v.length >= 2 && isFinite(v[0]) && isFinite(v[1])) cgp.push({ name: (c.getAttribute("name") || c.getAttribute("pntRef") || "").trim(), x: v[1] * f, y: v[0] * f, z: isFinite(v[2]) ? v[2] * fz : null }); });
    return { surf: surf, gl: gl, als: als, cg: cgp };
  }
  function alRel(al, x, y) {   // 中心線(折れ線)に対する 追加距離・離れ(右が +)・向き
    var P = al.pts, best = null, cum = 0;
    for (var i = 0; i + 1 < P.length; i++) {
      var a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (!L) continue;
      var t = ((x - a[0]) * dx + (y - a[1]) * dy) / (L * L), tc = Math.max(0, Math.min(1, t));
      var qx = a[0] + dx * tc, qy = a[1] + dy * tc, d = Math.hypot(x - qx, y - qy);
      if (!best || d < best.d) best = { d: d, sta: al.sta0 + cum + tc * L, off: ((x - a[0]) * dy - (y - a[1]) * dx) / L, ux: dx / L, uy: dy / L, cx: qx, cy: qy };
      cum += L;
    }
    return best;
  }
  function profZ(al, sta) {
    var P = al && al.prof; if (!P || sta < P[0][0] - 1 || sta > P[P.length - 1][0] + 1) return null;
    for (var i = 0; i + 1 < P.length; i++) if (sta <= P[i + 1][0] || i + 2 === P.length) { var t = (sta - P[i][0]) / ((P[i + 1][0] - P[i][0]) || 1); return P[i][1] + (P[i + 1][1] - P[i][1]) * Math.max(0, Math.min(1, t)); }
    return null;
  }
  var fmtSta = function (mm) { var m = mm / 1000, p = XS.pitch20 || 20, n = Math.floor(m / p + 1e-9); return "No." + n + " + " + (m - n * p).toFixed(3); };

  // ---------------------------------------------------------------- いまの状態(プリズム、またはタップした所)
  function xsNow() {
    var h = H(), tg = h && h.target ? h.target() : null, r = { P: null, zTip: null, from: "" };
    if (tg && tg.P) { r.P = tg.P; r.zTip = tg.zTip != null ? tg.zTip : null; r.from = "prism"; }
    else if (XS.tap) { r.P = { x: XS.tap.x, y: XS.tap.y }; r.zTip = XS.tap.z; r.from = "tap"; r.name = XS.tap.name; }
    if (!r.P) return r;
    var P = r.P;
    if (XS.alAuto && XS.als.length > 1) { var bd = Infinity; XS.als.forEach(function (al) { var a = alRel(al, P.x, P.y); if (a && a.d < bd) { bd = a.d; XS.al = al; } }); XS.alName = XS.al.name; }
    var inst = h && h.inst ? h.inst() : null;
    if (XS.al) { var a = alRel(XS.al, P.x, P.y); r.rel = a; r.cx = a.cx; r.cy = a.cy; r.rx = a.uy; r.ry = -a.ux; r.u = a.off / 1000; }
    else if (inst && (inst.x !== P.x || inst.y !== P.y)) { var dx = P.x - inst.x, dy = P.y - inst.y, L = Math.hypot(dx, dy) || 1; r.cx = P.x; r.cy = P.y; r.rx = dy / L; r.ry = -dx / L; r.u = 0; }
    else { r.cx = P.x; r.cy = P.y; r.rx = 1; r.ry = 0; r.u = 0; }   // 中心線も杭ナビも無いときは東西に切る
    r.zD = surfZ(XS.surf, P.x, P.y);
    if (r.rel && XS.al && XS.al.prof) r.zProf = profZ(XS.al, r.rel.sta);
    if (r.zD == null && r.zProf != null) { r.zD = r.zProf; r.zFrom = "縦断"; }
    r.zG = surfZ(XS.gl, P.x, P.y);
    if (r.zD == null && !XS.surf && !(XS.al && XS.al.prof) && r.zG != null) { r.zD = r.zG; r.zFrom = "現況"; }
    if (r.zD != null && r.zTip != null) r.dz = r.zTip - r.zD;   // + なら いまの高さが高い → 切り
    return r;
  }

  // ---------------------------------------------------------------- 画面(下に出す札)
  var CSS = "" +
    ".ipx-xsbtn{position:fixed;right:6px;top:46%;z-index:360;width:46px;height:46px;border-radius:23px;border:2px solid #0f766e;background:var(--card,#fff);color:#0f766e;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.25);padding:0}" +
    "body.ipx-xs-on .ipx-xsbtn{display:none}" +
    ".ipx-3dbtn{top:calc(46% + 54px);border-color:#7c3aed;color:#7c3aed;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}.ipx-3dbtn small{font-size:9px;font-weight:700}.ipx-3dbtn.on{background:#7c3aed;color:#fff}" +
    ".xs-panel{position:fixed;left:0;right:0;bottom:0;z-index:370;background:var(--card,#fff);color:var(--ink,var(--fg,#1d2330));border-top:3px solid #0f766e;box-shadow:0 -4px 16px rgba(0,0,0,.18);max-height:56vh;overflow:auto;padding:8px 10px calc(env(safe-area-inset-bottom) + 12px);font-size:14px}" +
    ".xs-panel button{font:inherit;width:auto;min-height:38px;padding:2px 10px;font-size:13.5px;border-radius:8px;border:1px solid var(--line,#ccd);background:var(--bg,#f4f5f7);color:inherit}" +
    ".xs-panel button.pri{background:#0f766e;color:#fff;border-color:transparent}" +
    ".xs-head{display:flex;align-items:center;gap:6px;margin-bottom:4px}.xs-head b{font-size:16px;flex:1}" +
    ".xs-tabs{display:flex;gap:4px}.xs-tabs button[aria-pressed=true],.xs-panel button[aria-pressed=true]{background:#0f766e;color:#fff}" +
    ".xs-nums{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin:4px 0}" +
    ".xs-nums div{background:var(--bg,#f4f5f7);border:1px solid var(--line,#ccd);border-radius:8px;padding:3px 4px;text-align:center;min-width:0}" +
    ".xs-nums small{display:block;font-size:10.5px;color:var(--sub,#5d6575)}.xs-nums b{font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap}" +
    ".xs-nums .xs-cf{grid-column:1/-1;display:flex;align-items:baseline;justify-content:center;gap:10px;padding:4px 8px}.xs-nums .xs-cf small{display:inline;font-size:13px}.xs-nums .xs-cf b{font-size:24px}" +
    ".xs-cf.cut{border-color:#dc2626}.xs-cf.cut b{color:#dc2626}.xs-cf.fill{border-color:#2563eb}.xs-cf.fill b{color:#2563eb}.xs-cf.ok{border-color:#16a34a;background:#f0fdf4}.xs-cf.ok b{color:#15803d}" +
    ".xs-why{grid-column:1/-1;margin:0;font-size:12.5px;color:#b45309}" +
    ".xs-svg{display:block;background:#f8fafc;border-radius:8px}.xs-grid{stroke:#e2e8f0;stroke-width:1}.xs-t{font-size:10px;fill:#64748b}" +
    ".xs-cl{stroke:#7c3aed;stroke-width:1.2;stroke-dasharray:5 4}.xs-gl{fill:none;stroke:#a16207;stroke-width:2;stroke-dasharray:6 3}.xs-prof{fill:#7c3aed;stroke:#fff;stroke-width:1.5}" +
    ".xs-design{fill:none;stroke:#0f766e;stroke-width:2.5}.xs-prism{fill:#dc2626;stroke:#fff;stroke-width:1.5}.xs-dz{stroke:#dc2626;stroke-width:2;stroke-dasharray:4 3}.xs-dz.ok{stroke:#16a34a}" +
    ".xs-empty{padding:26px 10px;text-align:center;color:var(--sub,#5d6575);font-size:14px}" +
    ".xs-3d{width:100%;height:280px;display:block;background:#e0f2fe;border-radius:8px;touch-action:none}" +
    ".xs-row{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:12.5px;margin-top:4px}.xs-row span{color:var(--sub,#5d6575)}" +
    ".xs-work{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:6px}.xs-work>span{display:flex;gap:4px;align-items:center}.xs-work [hidden]{display:none}.xs-work b{min-width:4.2em;text-align:center}" +
    ".xs-setup{margin-top:6px;border:1px solid var(--line,#ccd);border-radius:8px;background:var(--bg,#f4f5f7)}.xs-setup summary{padding:6px 8px;font-size:13px;font-weight:700;color:#0f766e;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.xs-setup .xs-row{padding:0 8px 6px}" +
    ".xs-panel [hidden]{display:none!important}" +
    ".xs-tin{fill:rgba(15,118,110,0.06);stroke:#0f766e;stroke-width:0.6;opacity:0.7}.xs-tin.gl{fill:rgba(161,98,7,0.05);stroke:#a16207;stroke-width:0.5;opacity:0.5}" +
    ".xs-alp{fill:none;stroke:#7c3aed;stroke-width:2.5;stroke-dasharray:10 4 2 4}.xs-alp.off{opacity:0.45}.xs-all{fill:#6d28d9;font-size:11px;font-weight:700}" +
    ".xs-secp{stroke:#f97316;stroke-width:3;stroke-dasharray:8 4}.xs-tapm{fill:#dc2626;stroke:#fff;stroke-width:2}";
  var $p = null;   // 札
  var q = function (sel) { return $p ? $p.querySelector(sel) : null; };
  function build() {
    if ($p) return;
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var btn = document.createElement("button"); btn.type = "button"; btn.className = "ipx-xsbtn"; btn.title = "3D 断面・図面で測る"; btn.setAttribute("aria-label", "3D 断面"); btn.textContent = "🏔";
    btn.addEventListener("click", function () { open(true); });
    document.body.appendChild(btn);
    var b3 = document.createElement("button"); b3.type = "button"; b3.className = "ipx-xsbtn ipx-3dbtn"; b3.title = "3D データを図面に重ねる・3D 画面"; b3.setAttribute("aria-label", "3D データを重ねる"); b3.innerHTML = "🗻<small>3D<\/small>";
    b3.addEventListener("click", menu3d);
    document.body.appendChild(b3);
    $p = document.createElement("div"); $p.className = "xs-panel"; $p.hidden = true; $p.setAttribute("data-noipx", "");
    $p.innerHTML =
      '<div class="xs-head"><b>🏔 3D 断面<\/b><span class="xs-tabs"><button type="button" data-t="xs" aria-pressed="true">横断<\/button><button type="button" data-t="3d" aria-pressed="false">3D<\/button><\/span><button type="button" data-xs="close">閉じる<\/button><\/div>' +
      '<div class="xs-nums" data-r="nums"><\/div><div data-r="view"><\/div><canvas class="xs-3d" data-r="c3" hidden><\/canvas>' +
      '<div class="xs-work"><button type="button" data-xs="tap" aria-pressed="true">👆 図面で測る<\/button><span data-r="xsctl"><button type="button" data-xs="wMinus">幅 −<\/button><b data-r="w">±10 m<\/b><button type="button" data-xs="wPlus">幅 ＋<\/button><\/span>' +
      '<span data-r="c3ctl" hidden><button type="button" data-xs="v3all">3D 全体<\/button><button type="button" data-xs="ex3">高さ ×2<\/button><button type="button" data-xs="z3in">寄る<\/button><button type="button" data-xs="z3out">引く<\/button><\/span>' +
      '<button type="button" data-xs="alNext" data-r="alsel" hidden>線形 ▶<\/button><button type="button" data-xs="aim" data-r="aim" hidden>🎯 杭ナビを向ける<\/button><\/div>' +
      '<details class="xs-setup" data-r="setup"><summary data-r="sum">⚙ 設計データ・中心線<\/summary>' +
      '<div class="xs-row"><span data-r="src">設計:まだ読み込んでいません<\/span><\/div>' +
      '<div class="xs-row"><button type="button" class="pri" data-xs="file">📂 設計データ(LandXML・DXF・DWG・点)<\/button><button type="button" data-xs="dwg">図面の 3D 線から<\/button><button type="button" data-xs="pts">点の高さから<\/button><\/div>' +
      '<div class="xs-row"><span data-r="al">中心線:なし<\/span><button type="button" data-xs="al">図面の線を中心線に<\/button><button type="button" data-xs="alNone">中心線なし<\/button><\/div>' +
      '<div class="xs-row"><span>測点の間隔<\/span><button type="button" data-xs="pitch">20 m<\/button><span>許容<\/span><button type="button" data-xs="tol">±20 mm<\/button><\/div>' +
      '<\/details><input type="file" accept="*/*" data-r="file" hidden />';
    document.body.appendChild($p);
    $p.addEventListener("click", onClick);
    q('[data-r="file"]').addEventListener("change", onFile);
    q(".xs-tabs").addEventListener("click", function (e) { var t = e.target.closest("[data-t]"); if (!t) return; XS.tab = t.dataset.t; if (XS.tab === "3d" && XS.v3all == null) XS.v3all = !(XS.last && XS.last.P); render(true); });
    rot3d(q('[data-r="c3"]'));
    setInterval(function () { if (XS.open) render(); }, 300);
  }
  function open(on) {
    build(); XS.open = on; $p.hidden = !on; document.body.classList.toggle("ipx-xs-on", on);
    if (on) { render(true); if (!XS.surf && !XS.gl) say("🏔 3D 断面:まず「⚙ 設計データ」から LandXML・DXF(3D 線)・点ファイルを読み込むか、「図面の 3D 線から」「点の高さから」を押してください。"); }
    redraw();
  }
  function redraw() { var h = H(); if (h && h.redraw) h.redraw(); else plan(); }

  // ---------------------------------------------------------------- 横断図(SVG)
  function section(r, S0) { var W = XS.w, N = 120, prof = [], S = S0 || XS.surf; for (var i = 0; i <= N; i++) { var u = -W + 2 * W * i / N; prof.push([u, surfZ(S, r.cx + r.rx * u * 1000, r.cy + r.ry * u * 1000)]); } return prof; }
  function svgXs(r) {
    var box = q('[data-r="view"]'), w = box.clientWidth || 340, h = 210, W = XS.w, hh = H();
    if (!r.P) return '<div class="xs-empty">' + (hh && hh.target ? "プリズムを追尾するか、" : "") + "図面をタップすると、そこで横断を切ります(図面で測る)。<\/div>";
    var prof = section(r), zs = prof.map(function (q) { return q[1]; }).filter(function (z) { return z != null; });
    var gprof = XS.gl ? section(r, XS.gl) : []; gprof.forEach(function (q) { if (q[1] != null) zs.push(q[1]); });
    if (r.zTip != null && Math.abs(r.u) <= W) zs.push(r.zTip);
    if (r.zProf != null) zs.push(r.zProf);
    if (!zs.length) return '<div class="xs-empty">ここ(まわり ±' + W + " m)には設計の面がありません。<\/div>";
    var z0 = Math.min.apply(null, zs), z1 = Math.max.apply(null, zs), span = Math.max(1, (z1 - z0) * 1.3), zc = (z0 + z1) / 2; z0 = zc - span / 2; z1 = zc + span / 2;
    var X = function (u) { return 36 + (u + W) / (2 * W) * (w - 46); }, Y = function (z) { return 10 + (z1 - z) / (z1 - z0) * (h - 34); };
    var s = '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" class="xs-svg">', z, u;
    var stp = span > 8 ? 2 : span > 4 ? 1 : span > 2 ? 0.5 : 0.2;
    for (z = Math.ceil(z0 / stp) * stp; z <= z1; z += stp) s += '<line x1="36" x2="' + (w - 10) + '" y1="' + Y(z) + '" y2="' + Y(z) + '" class="xs-grid"/><text x="2" y="' + (Y(z) + 4) + '" class="xs-t">' + z.toFixed(stp < 1 ? 1 : 0) + "<\/text>";
    for (u = -W; u <= W + 1e-9; u += W / 2) s += '<line y1="10" y2="' + (h - 24) + '" x1="' + X(u) + '" x2="' + X(u) + '" class="xs-grid"/><text x="' + (X(u) - 8) + '" y="' + (h - 8) + '" class="xs-t">' + (u > 0 ? "右" : u < 0 ? "左" : "") + Math.abs(u) + "<\/text>";
    if (XS.al) s += '<line y1="10" y2="' + (h - 24) + '" x1="' + X(0) + '" x2="' + X(0) + '" class="xs-cl"/><text x="' + (X(0) + 3) + '" y="20" class="xs-t">中心<\/text>';
    var path = function (pr) { var d = "", on = false; pr.forEach(function (q) { if (q[1] == null) { on = false; return; } d += (on ? "L" : "M") + X(q[0]).toFixed(1) + "," + Y(q[1]).toFixed(1); on = true; }); return d; };
    if (gprof.length) s += '<path d="' + path(gprof) + '" class="xs-gl"/><text x="' + (w - 50) + '" y="22" class="xs-t" style="fill:#92400e">現況<\/text>';
    s += '<path d="' + path(prof) + '" class="xs-design"/>';
    if (r.zProf != null) s += '<circle cx="' + X(0) + '" cy="' + Y(r.zProf) + '" r="5" class="xs-prof"/><text x="' + (X(0) + 7) + '" y="' + (Y(r.zProf) + 4) + '" class="xs-t">縦断 ' + r.zProf.toFixed(3) + "<\/text>";
    if (r.zTip != null && Math.abs(r.u) <= W) {
      var px = X(r.u), py = Y(r.zTip);
      if (r.zD != null) { var ok = Math.abs(r.dz) * 1000 <= XS.tol; s += '<line x1="' + px + '" x2="' + px + '" y1="' + py + '" y2="' + Y(r.zD) + '" class="xs-dz' + (ok ? " ok" : "") + '"/>'; }
      s += '<polygon points="' + px + "," + (py - 9) + " " + (px + 9) + "," + py + " " + px + "," + (py + 9) + " " + (px - 9) + "," + py + '" class="xs-prism"/>';
    } else if (Math.abs(r.u) <= W && r.zD != null) s += '<circle cx="' + X(r.u) + '" cy="' + Y(r.zD) + '" r="6" class="xs-prism"/>';
    return s + "<\/svg>";
  }
  // ---------------------------------------------------------------- 3D(キャンバス)
  function col3(t, lit) {
    var C = [[37, 99, 235], [16, 185, 129], [234, 179, 8], [180, 83, 9]];
    var k = Math.max(0, Math.min(0.9999, t)) * (C.length - 1), i = Math.floor(k), f = k - i, a = C[i], b = C[i + 1], m = 0.55 + 0.45 * lit;
    return "rgb(" + Math.round((a[0] + (b[0] - a[0]) * f) * m) + "," + Math.round((a[1] + (b[1] - a[1]) * f) * m) + "," + Math.round((a[2] + (b[2] - a[2]) * f) * m) + ")";
  }
  function draw3d(r) {
    var cv = q('[data-r="c3"]'); if (!cv) return;
    var S = XS.surf && XS.surf.m >= 20 ? XS.surf : XS.gl || XS.surf, hh = H();
    var w = cv.clientWidth || 340, h = cv.clientHeight || 280, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    if (!S) { g.fillStyle = "#64748b"; g.font = "14px sans-serif"; g.fillText("設計データを読み込んでください", 12, 24); return; }
    var all = XS.v3all || !r.P, c = all ? { x: (S.x0 + S.x1) / 2, y: (S.y0 + S.y1) / 2 } : r.P;
    var R = all ? Math.hypot(S.x1 - S.x0, S.y1 - S.y0) / 2 : Math.max(2 * XS.w, 20) * 1000, i;
    var zmin = Infinity, zmax = -Infinity; for (i = 0; i < S.n; i++) { if (S.pz[i] < zmin) zmin = S.pz[i]; if (S.pz[i] > zmax) zmax = S.pz[i]; }
    var zc0 = surfZ(S, c.x, c.y), zc = all ? (zmin + zmax) / 2 : (r.zD != null ? r.zD : zc0 != null ? zc0 : (zmin + zmax) / 2), zr = Math.max(0.5, zmax - zmin);
    var cy = Math.cos(XS.yaw), sy = Math.sin(XS.yaw), cp = Math.cos(XS.pitch), sp = Math.sin(XS.pitch), ex = XS.ex3;
    var sc = Math.min(w, (h - 30) / Math.max(0.35, Math.sin(XS.pitch))) / (2 * R / 1000) * 0.92 * XS.zoom3;
    var prj = function (x, y, z) { var X = (x - c.x) / 1000, Y = (y - c.y) / 1000, Z = (z - zc) * ex, xr = X * cy - Y * sy, yr = X * sy + Y * cy; return [w / 2 + xr * sc, h * 0.5 - (yr * sp + Z * cp) * sc, yr * cp - Z * sp]; };
    var F = [], seen = new Set(), LIM = 15000;
    var tri = function (Sx, t, design) {
      var a = Sx.T[3 * t], b = Sx.T[3 * t + 1], q3 = Sx.T[3 * t + 2], up = design ? 0.02 : 0;
      var A = prj(Sx.px[a], Sx.py[a], Sx.pz[a] + up), B = prj(Sx.px[b], Sx.py[b], Sx.pz[b] + up), C = prj(Sx.px[q3], Sx.py[q3], Sx.pz[q3] + up);
      var ux = (Sx.px[b] - Sx.px[a]) / 1000, uy = (Sx.py[b] - Sx.py[a]) / 1000, uz = (Sx.pz[b] - Sx.pz[a]) * ex, vx = (Sx.px[q3] - Sx.px[a]) / 1000, vy = (Sx.py[q3] - Sx.py[a]) / 1000, vz = (Sx.pz[q3] - Sx.pz[a]) * ex;
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1; if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      var lit = Math.max(0, (nx * -0.45 + ny * 0.45 + nz * 0.77) / nl);
      F.push([A, B, C, (A[2] + B[2] + C[2]) / 3, design ? "rgba(124,58,237," + (0.55 + 0.4 * lit) + ")" : col3(((Sx.pz[a] + Sx.pz[b] + Sx.pz[q3]) / 3 - zmin) / zr, lit)]);
    };
    if (all) { var step = Math.max(1, Math.ceil(S.m / LIM)); for (var t = 0; t < S.m; t += step) tri(S, t, false); }
    else {
      var ix0 = Math.floor((c.x - R - S.x0) / S.cs), ix1 = Math.floor((c.x + R - S.x0) / S.cs), iy0 = Math.floor((c.y - R - S.y0) / S.cs), iy1 = Math.floor((c.y + R - S.y0) / S.cs);
      for (var iy = Math.max(0, iy0); iy <= Math.min(S.gh, iy1); iy++) for (var ix = Math.max(0, ix0); ix <= Math.min(S.gw, ix1); ix++) {
        var L = S.cells.get(iy * S.gw + ix); if (!L) continue;
        L.forEach(function (t2) { if (seen.has(t2) || seen.size > LIM) return; seen.add(t2); tri(S, t2, false); });
      }
    }
    if (XS.surf && S !== XS.surf) for (var t3 = 0; t3 < XS.surf.m && t3 < 5000; t3++) tri(XS.surf, t3, true);
    F.sort(function (p, q2) { return q2[3] - p[3]; });
    g.lineWidth = 0.5;
    F.forEach(function (f) { g.fillStyle = f[4]; g.strokeStyle = "rgba(15,23,42,0.12)"; g.beginPath(); g.moveTo(f[0][0], f[0][1]); g.lineTo(f[1][0], f[1][1]); g.lineTo(f[2][0], f[2][1]); g.closePath(); g.fill(); g.stroke(); });
    (XS.als.length ? XS.als : XS.al ? [XS.al] : []).forEach(function (al) {
      g.strokeStyle = al === XS.al ? "#6d28d9" : "rgba(109,40,217,0.5)"; g.lineWidth = al === XS.al ? 4 : 2.5; g.beginPath();
      var cum = 0, on = false;
      al.pts.forEach(function (p2, k) {
        if (k) cum += Math.hypot(p2[0] - al.pts[k - 1][0], p2[1] - al.pts[k - 1][1]);
        var z = al.prof ? profZ(al, al.sta0 + cum) : null; if (z == null) z = surfZ(S, p2[0], p2[1]); if (z == null) { on = false; return; }
        var pp = prj(p2[0], p2[1], z); if (on) g.lineTo(pp[0], pp[1]); else g.moveTo(pp[0], pp[1]); on = true;
      });
      g.stroke();
    });
    g.lineWidth = 1; g.font = "bold 11px sans-serif";
    var hm = hh && hh.hM ? hh.hM() : 1;
    ((hh && hh.picks && hh.picks()) || []).forEach(function (p) {
      if (p.role === "known") return;
      var z = p.h ? p.h * hm : surfZ(S, p.x, p.y); if (z == null) return;
      if ((p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) > R * R * 1.2) return;
      var pp = prj(p.x, p.y, z); g.fillStyle = "#ea580c"; g.beginPath(); g.arc(pp[0], pp[1], 4, 0, 2 * Math.PI); g.fill(); g.fillStyle = "#7c2d12"; g.fillText(p.name, pp[0] + 6, pp[1] - 4);
    });
    if (r.P && r.cx != null) {
      g.strokeStyle = "#f97316"; g.lineWidth = 3; g.beginPath(); var on2 = false;
      section(r, S).forEach(function (q4) { if (q4[1] == null) { on2 = false; return; } var pp = prj(r.cx + r.rx * q4[0] * 1000, r.cy + r.ry * q4[0] * 1000, q4[1] + 0.03); if (on2) g.lineTo(pp[0], pp[1]); else g.moveTo(pp[0], pp[1]); on2 = true; });
      g.stroke(); g.lineWidth = 1;
    }
    if (r.P) {
      var zt = r.zTip != null ? r.zTip : (r.zG != null ? r.zG : r.zD != null ? r.zD : zc), top = prj(r.P.x, r.P.y, zt), base = prj(r.P.x, r.P.y, r.zD != null ? r.zD : zt);
      g.strokeStyle = "#dc2626"; g.lineWidth = 3; g.beginPath(); g.moveTo(base[0], base[1]); g.lineTo(top[0], top[1] - 26); g.stroke(); g.lineWidth = 1;
      g.fillStyle = "#dc2626"; g.beginPath(); g.arc(top[0], top[1], 7, 0, 2 * Math.PI); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
    }
    var inst = hh && hh.inst ? hh.inst() : null;
    if (inst) { var zi = surfZ(S, inst.x, inst.y), pI = prj(inst.x, inst.y, zi != null ? zi : zc); g.fillStyle = "#7c3aed"; g.fillRect(pI[0] - 6, pI[1] - 6, 12, 12); g.fillStyle = "#4c1d95"; g.font = "bold 12px sans-serif"; g.fillText("杭ナビ", pI[0] + 8, pI[1] + 4); }
    var ax = w - 26, ay = 26, d0 = -sy, d1 = -cy * sp, Ln = Math.hypot(d0, d1) || 1;
    g.strokeStyle = "#0f172a"; g.lineWidth = 2; g.beginPath(); g.moveTo(ax - d0 / Ln * 12, ay + d1 / Ln * 12); g.lineTo(ax + d0 / Ln * 12, ay - d1 / Ln * 12); g.stroke();
    g.fillStyle = "#0f172a"; g.font = "bold 12px sans-serif"; g.fillText("N", ax + d0 / Ln * 16 - 4, ay - d1 / Ln * 16 + 4); g.lineWidth = 1;
    for (i = 0; i < 40; i++) { g.fillStyle = col3(i / 39, 1); g.fillRect(8 + i * 2, 8, 2, 8); }
    g.fillStyle = "#334155"; g.font = "11px sans-serif"; g.fillText(zmin.toFixed(1), 8, 28); g.fillText(zmax.toFixed(1) + " m", 70, 28);
    g.fillText((all ? "全体" : "±" + Math.round(R / 1000) + " m") + "・高さ ×" + ex + "・1 本指で回す・2 本指で拡大縮小", 8, h - 8);
  }
  function rot3d(cv) {   // 指 1 本で回す・2 本で拡大縮小(PC はホイール)
    var pts = new Map(), d0 = null, pz = null;
    var re = function () { if (!XS.raf3) XS.raf3 = requestAnimationFrame(function () { XS.raf3 = 0; draw3d(XS.last || xsNow()); }); };
    var gap = function () { var v = Array.from(pts.values()); return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1; };
    cv.addEventListener("pointerdown", function (e) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ }
      if (pts.size === 2) { d0 = null; pz = { d: gap(), z: XS.zoom3 }; } else if (pts.size === 1) d0 = { x: e.clientX, y: e.clientY, yaw: XS.yaw, pitch: XS.pitch };
    });
    cv.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pz && pts.size >= 2) { XS.zoom3 = Math.max(0.3, Math.min(8, pz.z * gap() / pz.d)); re(); return; }
      if (!d0) return; XS.yaw = d0.yaw + (e.clientX - d0.x) * 0.01; XS.pitch = Math.max(0.05, Math.min(1.5, d0.pitch + (e.clientY - d0.y) * 0.01)); re();
    });
    var up = function (e) { pts.delete(e.pointerId); if (pts.size < 2) pz = null; if (pts.size === 1) { var v = Array.from(pts.values())[0]; d0 = { x: v.x, y: v.y, yaw: XS.yaw, pitch: XS.pitch }; } if (!pts.size) d0 = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) { e.preventDefault(); XS.zoom3 = Math.max(0.3, Math.min(8, XS.zoom3 * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); re(); }, { passive: false });
  }
  // ---------------------------------------------------------------- 数字と全体
  function render(force) {
    if (!XS.open || !$p) return;
    var r = xsNow(), hh = H(); XS.last = r;
    q('[data-r="src"]').textContent = (XS.surf ? "設計:" + XS.src + "(三角形 " + XS.surf.m.toLocaleString() + ")" : "設計:まだ読み込んでいません") + (XS.gl ? "/現況:" + XS.gl.src.replace(/^LandXML の現況の面/, "") : "");
    q('[data-r="al"]').textContent = XS.al ? "中心線" + (XS.alAuto ? "(自動・近い線形)" : "") + ":" + XS.alName + (XS.al.prof ? "・縦断あり" : "") : "中心線:なし";
    q('[data-r="alsel"]').hidden = XS.als.length < 2;
    q('[data-r="aim"]').hidden = !(hh && hh.aim && r.from === "tap");
    q('[data-xs="tap"]').setAttribute("aria-pressed", String(XS.tapOn));
    q('[data-xs="pitch"]').textContent = XS.pitch20 + " m"; q('[data-xs="tol"]').textContent = "±" + XS.tol + " mm";
    var tol = XS.tol / 1000, f3 = function (v) { return v == null ? "---" : v.toFixed(3); }, cf = "---", cls = "";
    if (r.dz != null) { var ok = Math.abs(r.dz) <= tol; cf = ok ? "◎ OK " + (Math.abs(r.dz) * 1000).toFixed(0) + " mm" : (r.dz > 0 ? "切り" : "盛り") + " " + Math.abs(r.dz).toFixed(3) + " m"; cls = ok ? "ok" : r.dz > 0 ? "cut" : "fill"; }
    var why = !XS.surf && !XS.gl && !(XS.al && XS.al.prof) ? "設計データを読み込んでください(⚙ 設計データ・中心線)" : !r.P ? (hh && hh.target ? "プリズムを追尾するか、図面をタップしてください" : "図面をタップしてください(図面で測る)") : r.zD == null ? "ここは設計の面の外です" : r.zTip == null ? (r.from === "tap" ? "高さのある点(点の一覧)をタップすると、切り・盛りが出ます" : "器械の高さが決まっていません") : "";
    q('[data-r="nums"]').innerHTML =
      '<div class="xs-cf ' + cls + '"><small>切り・盛り' + (r.name ? "(" + esc(r.name) + ")" : "") + "<\/small><b>" + cf + "<\/b><\/div>" +
      "<div><small>" + (XS.al ? "追加距離" : "位置") + "<\/small><b>" + (r.rel ? fmtSta(r.rel.sta) : r.P ? "図面の上" : "---") + "<\/b><\/div>" +
      "<div><small>中心から<\/small><b>" + (r.rel ? (r.rel.off >= 0 ? "右 " : "左 ") + Math.abs(r.rel.off / 1000).toFixed(3) : "---") + "<\/b><\/div>" +
      "<div><small>設計の高さ" + (r.zFrom ? "(" + r.zFrom + ")" : "") + "<\/small><b>" + f3(r.zD) + "<\/b><\/div><div><small>" + (r.from === "prism" ? "いまの高さ" : "点の高さ") + "<\/small><b>" + f3(r.zTip) + "<\/b><\/div>" +
      (r.zG != null && r.zFrom !== "現況" ? '<p class="xs-why" style="color:#92400e">現況の地盤 ' + r.zG.toFixed(3) + (r.zD != null ? "・設計まで " + (r.zG - r.zD).toFixed(3) + " m(土かぶり・掘る深さの目安)" : "") + "<\/p>" : "") + (why ? '<p class="xs-why">' + why + "<\/p>" : "");
    var has = !!(XS.surf || XS.gl || (XS.al && XS.al.prof));
    if (XS.hadData !== has) { XS.hadData = has; q('[data-r="setup"]').open = !has; }
    q('[data-r="sum"]').textContent = has ? "⚙ 設計:" + (XS.src || "読み込み済み") + (XS.al ? "・中心線 " + XS.alName : "") : "⚙ 設計データを読み込む(ここを開く)";
    var tabs = q(".xs-tabs").children; for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-pressed", String(tabs[i].dataset.t === XS.tab));
    q('[data-r="view"]').hidden = XS.tab !== "xs"; q('[data-r="c3"]').hidden = XS.tab !== "3d";
    q('[data-r="xsctl"]').hidden = XS.tab !== "xs"; q('[data-r="c3ctl"]').hidden = XS.tab !== "3d";
    if (XS.tab === "xs") { var html = svgXs(r), v = q('[data-r="view"]'); if (force || v.dataset.h !== html) { v.innerHTML = html; v.dataset.h = html; } }
    else { var key = r.P ? Math.round(r.P.x / 50) + "," + Math.round(r.P.y / 50) : "-"; if (force || XS.k3 !== key) { XS.k3 = key; draw3d(r); } }
    q('[data-r="w"]').textContent = "±" + XS.w + " m";
    q('[data-xs="v3all"]').textContent = XS.v3all ? "3D まわり" : "3D 全体"; q('[data-xs="ex3"]').textContent = "高さ ×" + XS.ex3;
    if (r.from === "prism" && XS.lastPlanKey !== Math.round(r.P.x / 100) + "," + Math.round(r.P.y / 100)) { XS.lastPlanKey = Math.round(r.P.x / 100) + "," + Math.round(r.P.y / 100); redraw(); }
  }
  // ---------------------------------------------------------------- 読み込み
  function decodeText(buf) { try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("shift_jis").decode(buf); } }
  function load(res, msg, quiet) {
    if (res.surf) { XS.surf = res.surf; XS.src = res.surf.src; }
    if (res.gl) XS.gl = res.gl;
    var hh = H();
    if (!quiet && res.cg && res.cg.length && hh && hh.addPicks) {   // 名前つきの点(マンホール・桝など)
      var n = hh.addPicks(res.cg.filter(function (c) { return c.name; }).map(function (c) { return { name: c.name.replace(/\s+/g, ""), x: c.x, y: c.y, hM: c.z }; }));
      if (n) msg += " 名前つきの点 " + n + " 点を点の一覧に足しました。";
    }
    if (res.als && res.als.length) { XS.als = res.als; XS.al = res.als[0]; XS.alAuto = res.als.length > 1; XS.alName = res.als[0].name + (res.als[0].spiral ? "(緩和曲線は直線で近似)" : ""); }
    XS.hide = false;
    // 図面をまだ開いていないアプリ(くるくる)では、3D データだけで図面を出す(そのままタップで杭打ちできる)
    if (hh && hh.fit) {   // fit は図面を開いていなければ true
      var S0 = XS.surf || XS.gl, bb = S0 ? { minx: S0.x0, miny: S0.y0, maxx: S0.x1, maxy: S0.y1 } : null;
      if (!bb && XS.als.length) { bb = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity }; XS.als.forEach(function (al) { al.pts.forEach(function (p) { bb.minx = Math.min(bb.minx, p[0]); bb.maxx = Math.max(bb.maxx, p[0]); bb.miny = Math.min(bb.miny, p[1]); bb.maxy = Math.max(bb.maxy, p[1]); }); }); }
      if (bb && hh.fit(bb)) msg += " 図面が無いので、3D データだけを出しました。";
    }
    say(msg + overlapNote()); render(true); redraw();
  }
  // 中身の頭で種類を見る(Android でファイル名に拡張子が付いてこないときのため)
  function headText(buf) { var n = Math.min(buf.length, 4096), s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(buf[i]); return s; }
  function looksLandXml(name, head) { return /\.(xml|landxml)$/i.test(name || "") || /<LandXML[\s>]/.test(head || ""); }
  async function onFile(ev) {
    var f = ev.target.files && ev.target.files[0]; if (!f) return;
    await loadFile(f);
    ev.target.value = "";
  }
  async function loadFile(f) {
    try {
      var buf = new Uint8Array(await f.arrayBuffer()), name = f.name.toLowerCase(), hh = H(), k = hh && hh.drawingK ? (hh.drawingK() || 1) : 1, head = headText(buf);
      if (looksLandXml(name, head)) {
        var r = parseLandXml(decodeText(buf));
        if (!r.surf && !r.gl && !r.als.length) throw new Error("面も線形も見つかりません");
        load(r, "🏔 LandXML を読みました:" + (r.surf ? "設計の面 " + r.surf.m.toLocaleString() + " 三角形・" : "") + (r.gl ? "現況の面 " + r.gl.m.toLocaleString() + " 三角形・" : "") + "線形 " + r.als.length + " 本。ほかのアプリでも開くとすぐ重なります。");
        keepSave(f.name, buf);
      } else if (/\.(dxf|dwg)$/.test(name) || /^\s*0\s*[\r\n]+\s*SECTION/.test(head) || /^AC10\d\d/.test(head)) {
        if (/^AC10\d\d/.test(head)) name = name + ".dwg";
        if (/\.dwg$/.test(name)) { say("DWG を DXF に変えています…"); buf = await window.Genba.dwgToDxf(buf); }
        var P = pts3dOfLines(TL().linesFromDxf(buf, k));
        if (P.length < 3) throw new Error("高さ(Z)の入った線がありません");
        load({ surf: surfFromPoints(P, "3D 線「" + f.name + "」") }, "🏔 3D 線から面を作りました(点 " + P.length.toLocaleString() + ")。");
      } else {
        var text = decodeText(buf), sima = TL().isSimaText(f.name, text), rows = sima ? TL().parseSima(text) : TL().parsePointCsv(text);
        var hp = TL().rowsToHeightPoints(rows, { axis: "northEast", unit: "m", hScale: 1 });
        load({ surf: surfFromPoints(hp, "点の高さ「" + f.name + "」") }, "🏔 点の高さから面を作りました(点 " + hp.length + "。CSV は X=北・Y=東・m で読みます)。");
      }
    } catch (e) { say("⚠ 設計データを読めません: " + e.message, true); }
  }
  // 図面を開く欄(#file、📂 ひらく)で LandXML を選んだときも、3D 断面に読み込む(図面ではないので、アプリには渡さない)
  var xmlPass = false;
  document.addEventListener("change", function (e) {
    var inp = e.target, f = inp && inp.id === "file" && inp.files && inp.files[0];
    if (!f || xmlPass || !window.IPPATSU_HOST) return;
    var nm = f.name || "";
    if (/\.(dxf|dwg|zrd|zsdx|zsdxz|csv|sim|sima|txt)$/i.test(nm)) return;   // いつもの図面・点ファイル
    e.stopImmediatePropagation();
    f.slice(0, 4096).arrayBuffer().then(function (b) {
      if (looksLandXml(nm, headText(new Uint8Array(b)))) { return loadFile(f).then(function () { inp.value = ""; }); }
      xmlPass = true; try { inp.dispatchEvent(new Event("change", { bubbles: true })); } finally { xmlPass = false; }
    });
  }, true);
  function onClick(e) {
    var b = e.target.closest("[data-xs]"); if (!b) return;
    var k = b.dataset.xs, hh = H();
    if (k === "close") { open(false); return; }
    if (k === "file") { q('[data-r="file"]').click(); return; }
    if (k === "dwg") { try { var P = pts3dOfLines(hh.lines()); load({ surf: surfFromPoints(P, "図面の 3D 線") }, "🏔 図面の 3D 線から面を作りました(点 " + P.length.toLocaleString() + ")。"); } catch (er) { say("⚠ " + er.message + "(図面の線に高さ Z が入っていません)", true); } return; }
    if (k === "pts") { try { var hm = hh.hM ? hh.hM() : 1, Q = hh.picks().filter(function (p) { return p.h; }).map(function (p) { return { x: p.x, y: p.y, h: p.h * hm }; }); load({ surf: surfFromPoints(Q, "点の一覧の高さ") }, "🏔 点の高さから面を作りました(点 " + Q.length + ")。"); } catch (er) { say("⚠ " + er.message, true); } return; }
    if (k === "al") { XS.alPick = true; say("中心線にする線を、図面でタップしてください。"); return; }
    if (k === "alNone") { XS.al = null; XS.alAuto = false; XS.alName = ""; say("中心線なし:杭ナビからの向き(杭ナビが無いときは東西)に直角で横断を切ります。"); }
    else if (k === "alNext") { if (XS.alAuto) { XS.alAuto = false; XS.al = XS.als[0]; } else { var i = XS.als.indexOf(XS.al); if (i + 1 >= XS.als.length) XS.alAuto = true; else XS.al = XS.als[i + 1]; } XS.alName = XS.al.name; }
    else if (k === "wPlus") { XS.w = Math.min(100, XS.w * 2); ls.set("ipx.xsw", String(XS.w)); }
    else if (k === "wMinus") { XS.w = Math.max(2.5, XS.w / 2); ls.set("ipx.xsw", String(XS.w)); }
    else if (k === "v3all") { XS.v3all = !XS.v3all; XS.zoom3 = 1; }
    else if (k === "ex3") XS.ex3 = XS.ex3 === 1 ? 2 : XS.ex3 === 2 ? 5 : 1;
    else if (k === "z3in") XS.zoom3 = Math.min(8, XS.zoom3 * 1.5);
    else if (k === "z3out") XS.zoom3 = Math.max(0.3, XS.zoom3 / 1.5);
    else if (k === "tap") { XS.tapOn = !XS.tapOn; say(XS.tapOn ? "👆 図面で測る:図面をタップすると、そこで横断を切ります。" : "図面で測るをやめました(図面のタップはアプリのふだんの動きに戻ります)。"); }
    else if (k === "pitch") { XS.pitch20 = XS.pitch20 === 20 ? 10 : XS.pitch20 === 10 ? 50 : XS.pitch20 === 50 ? 100 : 20; ls.set("ipx.xspitch", String(XS.pitch20)); }
    else if (k === "tol") { XS.tol = XS.tol === 20 ? 10 : XS.tol === 10 ? 50 : XS.tol === 50 ? 100 : 20; }
    else if (k === "aim" && hh.aim && XS.tap) { hh.aim(XS.tap.x, XS.tap.y); }
    render(true); redraw();
  }
  // ---------------------------------------------------------------- 図面のタップ(図面で測る・中心線を選ぶ)
  // 札を開いているあいだ、図面を指で軽くたたいたら、アプリの「タップ」(点を拾う・線を選ぶ)の代わりにここで使う。
  // アプリには pointercancel を送るので、指の動き(動かす・拡大)はそのまま。
  function inv(sx, sy) {   // 画面 → 図面(mm)。toScreen は 1 次の変換なので 3 点から逆に解く
    var h = H(), o = h.toScreen([0, 0]), ex = h.toScreen([1000, 0]), ey = h.toScreen([0, 1000]);
    var a = (ex[0] - o[0]) / 1000, b = (ey[0] - o[0]) / 1000, c = (ex[1] - o[1]) / 1000, d = (ey[1] - o[1]) / 1000, det = a * d - b * c;
    var X = sx - o[0], Y = sy - o[1];
    return [(d * X - b * Y) / det, (-c * X + a * Y) / det];
  }
  function svgPos(e) { var h = H(), r = h.svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  var down = null;
  document.addEventListener("pointerdown", function (e) { var h = H(); if (!XS.open || !h || !h.svg || !h.svg.contains(e.target)) { down = null; return; } down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), n: (down && down.n || 0) + 1 }; }, true);
  document.addEventListener("pointerup", function (e) {
    var h = H(), d = down; if (!XS.open || !h || !h.svg || !d || d.id !== e.pointerId || !(XS.tapOn || XS.alPick)) return;
    down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || Date.now() - d.t > 600) return;
    e.stopImmediatePropagation();
    try { h.svg.dispatchEvent(new PointerEvent("pointercancel", { pointerId: e.pointerId, bubbles: true })); } catch (er) { /* */ }
    var s = svgPos(e);
    if (XS.alPick) { pickAl(s); return; }
    // 近くの点(10 mm の円の中)なら、その点の高さで切り盛り
    var best = null, bd = 24, hm = h.hM ? h.hM() : 1;
    (h.picks() || []).forEach(function (p) { var q5 = h.toScreen([p.x, p.y]), dd = Math.hypot(q5[0] - s[0], q5[1] - s[1]); if (dd < bd) { bd = dd; best = p; } });
    if (best) XS.tap = { x: best.x, y: best.y, z: best.h ? best.h * hm : null, name: best.name };
    else { var w = inv(s[0], s[1]); XS.tap = { x: w[0], y: w[1], z: null, name: "" }; }
    render(true); redraw();
  }, true);
  function pickAl(s) {   // そばの線(折れ線)を中心線に
    var h = H(), best = null, bd = 30;
    (h.lines() || []).forEach(function (l) {
      var P = l.draw || l.points; if (!P || P.length < 2) return;
      for (var i = 0; i + 1 < P.length; i++) {
        var a = h.toScreen(P[i]), b = h.toScreen(P[i + 1]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((s[0] - a[0]) * dx + (s[1] - a[1]) * dy) / L2)), dd = Math.hypot(a[0] + dx * t - s[0], a[1] + dy * t - s[1]);
        if (dd < bd) { bd = dd; best = l; }
      }
    });
    XS.alPick = false;
    if (!best) { say("そばに線がありません。拡大して、中心線にする線をタップしてください(「図面の線を中心線に」をもう一度)。", true); return; }
    var pts = (best.draw || best.points).map(function (p) { return [p[0], p[1]]; }); if (best.closed) pts.push(pts[0]);
    XS.al = { name: "図面の線" + (best.layer ? "(" + best.layer + ")" : ""), pts: pts, sta0: 0 }; XS.alName = XS.al.name; XS.alAuto = false;
    var len = 0; for (var i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    say("中心線を " + XS.alName + " にしました(長さ " + (len / 1000).toFixed(2) + " m)。線のはじめが No.0 です。");
    render(true); redraw();
  }
  // ---------------------------------------------------------------- 図面に重ねる(アプリの draw() の最後で呼ぶ)
  var NS = "http://www.w3.org/2000/svg";
  function plan() {
    var h = H(); if (!h || !h.svg) return;
    try { var t0 = h.toScreen([0, 0]); if (!t0 || !isFinite(t0[0])) return; } catch (e) { return; }   // 図面をまだ開いていない
    var g = h.svg.querySelector("g.ipx-xs");
    if (!XS.surf && !XS.gl && !XS.al && !XS.als.length && !(XS.open && XS.tap)) { if (g) g.remove(); var b0 = document.querySelector(".ipx-3dbtn"); if (b0) b0.classList.remove("on"); return; }
    if (!g) { g = document.createElementNS(NS, "g"); g.setAttribute("class", "ipx-xs"); g.style.pointerEvents = "none"; }
    h.svg.appendChild(g);   // いちばん上に
    while (g.firstChild) g.removeChild(g.firstChild);
    var el = function (tag, at, cls) { var e = document.createElementNS(NS, tag); for (var k in at) e.setAttribute(k, at[k]); if (cls) e.setAttribute("class", cls); g.appendChild(e); return e; };
    var T = function (p) { return h.toScreen(p); };
    var b3 = document.querySelector(".ipx-3dbtn"); if (b3) b3.classList.toggle("on", !!(XS.surf || XS.gl || XS.als.length) && !XS.hide);
    if (XS.hide && !XS.open) { while (g.firstChild) g.removeChild(g.firstChild); return; }
    [XS.gl, XS.surf].forEach(function (S) {
      if (!S) return;
      if (S.m <= 30000) {
        var d = "";
        for (var t = 0; t < S.m; t++) { var a = T([S.px[S.T[3 * t]], S.py[S.T[3 * t]]]), b = T([S.px[S.T[3 * t + 1]], S.py[S.T[3 * t + 1]]]), c = T([S.px[S.T[3 * t + 2]], S.py[S.T[3 * t + 2]]]); d += "M" + a[0].toFixed(1) + "," + a[1].toFixed(1) + "L" + b[0].toFixed(1) + "," + b[1].toFixed(1) + "L" + c[0].toFixed(1) + "," + c[1].toFixed(1) + "Z"; }
        el("path", { d: d }, S === XS.gl ? "xs-tin gl" : "xs-tin");
      } else { var a2 = T([S.x0, S.y0]), b2 = T([S.x1, S.y1]); el("rect", { x: Math.min(a2[0], b2[0]), y: Math.min(a2[1], b2[1]), width: Math.abs(b2[0] - a2[0]), height: Math.abs(b2[1] - a2[1]) }, "xs-tin"); }
    });
    var alsAll = XS.als.slice(); if (XS.al && alsAll.indexOf(XS.al) < 0) alsAll.push(XS.al);
    alsAll.forEach(function (al) {
      var pts = al.pts.map(T);
      el("polyline", { points: pts.map(function (q6) { return q6[0].toFixed(1) + "," + q6[1].toFixed(1); }).join(" ") }, "xs-alp" + (al === XS.al ? "" : " off"));
      if (XS.als.length > 1) { var tx = el("text", { x: pts[0][0] + 4, y: pts[0][1] - 4 }, "xs-all"); tx.textContent = al.name; }
    });
    var r = XS.last; if (!XS.open || !r || !r.P || r.cx == null) return;
    var A = T([r.cx - r.rx * XS.w * 1000, r.cy - r.ry * XS.w * 1000]), B = T([r.cx + r.rx * XS.w * 1000, r.cy + r.ry * XS.w * 1000]);
    el("line", { x1: A[0], y1: A[1], x2: B[0], y2: B[1] }, "xs-secp");
    if (r.from === "tap") { var p = T([r.P.x, r.P.y]); el("circle", { cx: p[0], cy: p[1], r: 7 }, "xs-tapm"); }
  }
  // ---------------------------------------------------------------- 🗻 3D データを図面に重ねる(別ボタン)
  function overlapNote() {
    var h = H(), S = XS.surf || XS.gl; if (!h || !S || !h.lines) return "";
    var L = h.lines() || [], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
    for (var i = 0; i < L.length && n < 200000; i++) { var P = L[i].draw || L[i].points || []; for (var j = 0; j < P.length; j++, n++) { var p = P[j]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } }
    if (!n) return "";
    var ov = !(S.x1 < x0 || S.x0 > x1 || S.y1 < y0 || S.y0 > y1);
    return ov ? "" : " ⚠ 図面と 3D データの場所が重なりません(図面が現場の座標・3D が公共座標、など)。図面の座標を確かめてください。";
  }
  function pick3dFile() { build(); q('[data-r="file"]').click(); }
  function menu3d() {
    var G = window.Genba, has = !!(XS.surf || XS.gl || XS.als.length);
    if (!has) { pick3dFile(); return; }
    if (!G || !G.dialog) { XS.hide = !XS.hide; redraw(); return; }
    var info = [XS.kept ? "覚えている LandXML:" + esc3(XS.kept) : "", XS.surf ? "設計の面:" + esc3(XS.surf.src) : "", XS.gl ? "現況の面:" + esc3(XS.gl.src) : "", XS.als.length ? "線形 " + XS.als.length + " 本" : ""].filter(Boolean).join("<br>");
    G.dialog("🗻 3D データ", "", [
      { label: "🧊 3D 画面", ok: true, run: function () { v3open(); } },
      { label: XS.hide ? "👁 重ねる" : "🙈 隠す", run: function () { XS.hide = !XS.hide; redraw(); say(XS.hide ? "3D データを図面から隠しました。" : "3D データを図面に重ねました。"); } },
      { label: "📂 読み込む", run: function () { pick3dFile(); } },
      { label: "✕ 外す", run: function () { XS.surf = null; XS.gl = null; XS.als = []; XS.al = null; XS.alName = ""; XS.hide = false; XS.kept = ""; keepDel(); render(true); redraw(); say("3D データを外しました(ほかのアプリでも外れます)。"); } }
    ], info + overlapNote());
  }
  var esc3 = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  // ---------------------------------------------------------------- 🧊 3D 画面(別画面)：回す・拡大・動かす・点の XYZ を取る
  var V3 = { yaw: -0.7, pitch: 0.8, zoom: 1, ex: 1, cx: null, cy: null, el: null, taken: [], sel: null, lines: true, pickOn: true };
  function v3surf() { return XS.surf && XS.surf.m >= 3 ? XS.surf : XS.gl; }
  function v3open() {
    var S = v3surf(); if (!S) { say("先に 🗻 で 3D データ(LandXML など)を読み込んでください。", true); return; }
    if (!V3.el) {
      var st = document.createElement("style");
      st.textContent = ".ipx-v3{position:fixed;inset:0;z-index:2147482000;background:#e0f2fe;display:flex;flex-direction:column;color:#0f172a;font-size:14px}.ipx-v3[hidden]{display:none!important}" +
        ".ipx-v3 header,.ipx-v3 .v3-bot{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:calc(env(safe-area-inset-top) + 6px) 8px 6px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}" +
        ".ipx-v3 .v3-bot{padding:6px 8px calc(env(safe-area-inset-bottom) + 8px);box-shadow:0 -1px 4px rgba(0,0,0,.15)}" +
        ".ipx-v3 header b{flex:1;font-size:16px}.ipx-v3 button{font:inherit;width:auto;min-height:40px;padding:2px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc;color:inherit}" +
        ".ipx-v3 button.pri{background:#0f766e;color:#fff;border-color:transparent}.ipx-v3 button[aria-pressed=true]{background:#0f766e;color:#fff}" +
        ".ipx-v3 canvas{flex:1;min-height:0;width:100%;display:block;touch-action:none}" +
        ".v3-card{display:grid;grid-template-columns:auto 1fr auto 1fr auto 1fr;gap:2px 6px;align-items:baseline;width:100%;font-variant-numeric:tabular-nums}.v3-card b{font-size:15px}.v3-card span{color:#64748b;font-size:12px}" +
        ".v3-list{width:100%;max-height:18vh;overflow:auto;font-size:12.5px;font-variant-numeric:tabular-nums}.v3-list div{display:flex;gap:8px;border-bottom:1px solid #e2e8f0;padding:2px 0}";
      document.head.appendChild(st);
      var d = document.createElement("div"); d.className = "ipx-v3"; d.hidden = true; d.setAttribute("data-noipx", "");
      d.innerHTML = '<header><b>🧊 3D 画面<\/b><button type="button" data-v="ex">高さ ×1<\/button><button type="button" data-v="all">全体<\/button><button type="button" data-v="ln" aria-pressed="true">図面の線<\/button><button type="button" class="pri" data-v="close">閉じる<\/button><\/header>' +
        '<canvas><\/canvas><div class="v3-bot"><div class="v3-card" data-v3="card"><span>1 本指で回す・2 本指で拡大と移動(PC はホイールと右ドラッグ)。<b>軽くタップ<\/b>すると、そこの X・Y・Z が出ます。<\/span><\/div>' +
        '<button type="button" class="pri" data-v="stake" hidden disabled>📍 ここを打つ<\/button><button type="button" class="pri" data-v="take" disabled>＋ この点を取り込む<\/button><button type="button" data-v="give" disabled>📥 アプリに入れる<\/button><button type="button" data-v="kuru" hidden disabled>📤 くるくるへ<\/button><button type="button" data-v="copy" disabled>📋 コピー<\/button><button type="button" data-v="clear" disabled>消す<\/button><div class="v3-list" data-v3="list"><\/div><\/div>';
      document.body.appendChild(d); V3.el = d;
      d.addEventListener("click", v3click); v3touch(d.querySelector("canvas"));
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !V3.el.hidden) { V3.el.hidden = true; redraw(); } });
      window.addEventListener("resize", function () { if (!V3.el.hidden) v3draw(); });
    }
    V3.el.hidden = false; if (V3.cx == null) v3all(); v3draw(); v3ui();
  }
  function v3all() { var S = v3surf(); V3.cx = (S.x0 + S.x1) / 2; V3.cy = (S.y0 + S.y1) / 2; V3.zoom = 1; }
  function v3click(e) {
    var b = e.target.closest("[data-v]"); if (!b) return; var k = b.dataset.v, h = H();
    if (k === "close") { V3.el.hidden = true; redraw(); return; }
    if (k === "ex") V3.ex = V3.ex === 1 ? 2 : V3.ex === 2 ? 5 : V3.ex === 5 ? 10 : 1;
    else if (k === "all") v3all();
    else if (k === "ln") V3.lines = !V3.lines;
    else if (k === "take" && V3.sel) {
      var used = {}; ((h && h.picks && h.picks()) || []).forEach(function (p) { used[p.name] = 1; }); V3.taken.forEach(function (p) { used[p.name] = 1; });
      var nn = V3.taken.length + 1; while (used["3D" + nn]) nn++;
      V3.taken.push({ name: "3D" + nn, x: V3.sel.x, y: V3.sel.y, z: V3.sel.z });
    }
    else if (k === "clear") { V3.taken = []; }
    else if (k === "copy") {
      var t = V3.taken.map(function (p) { return [p.name, (p.y / 1000).toFixed(3), (p.x / 1000).toFixed(3), p.z.toFixed(3)].join(","); }).join("\n");
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { v3msg("📋 " + V3.taken.length + " 点を「点名,X(北),Y(東),Z」でコピーしました。"); }, function () { v3msg("コピーできませんでした。"); }); return;
    }
    else if (k === "give") { v3give(); return; }
    else if (k === "kuru") { v3kuru(); return; }
    else if (k === "stake" && V3.sel && h && h.stakeAt) { V3.el.hidden = true; h.stakeAt({ x: V3.sel.x, y: V3.sel.y, z: V3.sel.z }); return; }
    v3draw(); v3ui();
  }
  function v3msg(m) { var c = V3.el.querySelector('[data-v3="card"]'); c.innerHTML = "<span style=\"grid-column:1/-1\">" + esc3(m) + "<\/span>"; }
  function v3give() {
    var h = H(), G = window.Genba, list = V3.taken.map(function (p) { return { name: p.name, x: p.x, y: p.y, hM: p.z }; });
    if (!list.length) return;
    if (h && h.addPicks) { var n = h.addPicks(list); v3msg("📥 " + n + " 点をアプリの点の一覧に入れました(同じ名前の点は飛ばしました)。"); redraw(); return; }
    if (G && !window.IPPATSU_READONLY && G.current() && G.pointsAdd) {
      G.pointsAdd(G.current(), V3.taken.map(function (p) { return { name: p.name, X: p.y / 1000, Y: p.x / 1000, H: p.z, role: "design" }; }), window.IPPATSU_APP)
        .then(function () { v3msg("📥 " + list.length + " 点を現場「" + G.current() + "」の座標に入れました(くるくる回し太郎の「📥 受け取る」で使えます)。"); }, function (er) { v3msg("⚠ 入れられません: " + er.message); });
      return;
    }
    v3msg(window.IPPATSU_READONLY ? "脳みそバーンは保存しません。「📋 コピー」で写してください。" : "現場を選ぶと、現場の座標に入れられます。今は「📋 コピー」で写してください。");
  }
  // 📤 くるくるへ(2026-11-19):3D 画面で取った点(無ければ今出ている点)を くるくる回し太郎 へ渡す。
  // 現場を選んでいれば現場の座標へ(くるくるの「📥 受け取る」)、選んでいなければ「ippatsu-share」の受け渡しへ。
  function v3kuru() {
    var src = V3.taken.length ? V3.taken : V3.sel ? [{ name: "3D1", x: V3.sel.x, y: V3.sel.y, z: V3.sel.z }] : [];
    if (!src.length) return;
    var G = window.Genba, pts = src.map(function (p) { return { name: p.name, X: +(p.y / 1000).toFixed(4), Y: +(p.x / 1000).toFixed(4), H: +p.z.toFixed(4), role: "design" }; });
    var APPN = { sumi: "ECP一撃逃墨太郎", kamashi: "一発かまし太郎", nomiso: "脳みそバーン無敵CAD" }, me = APPN[window.IPPATSU_APP] || "一発バーン";
    var done = function (m) {
      v3msg(m);
      if (/\/(nomiso|kamashi|sumitaro)\.html$/.test(location.pathname) && confirm(m + "\n\nくるくる回し太郎を開きますか?")) location.href = "kurukuru.html";
    };
    if (G && !window.IPPATSU_READONLY && G.current() && G.pointsAdd) {
      // 現場にもう同じ名前で別の場所の点があれば、名前をずらす(上書きしない)
      (G.points ? G.points(G.current()).catch(function () { return null; }) : Promise.resolve(null)).then(function (r) {
        var old = {}; ((r && r.points) || []).forEach(function (q) { old[q.name] = q; });
        pts.forEach(function (p) { var o = old[p.name]; if (!o || (Math.abs(o.X - p.X) < 0.001 && Math.abs(o.Y - p.Y) < 0.001)) return; var n = 1; while (old["3D" + n]) n++; p.name = "3D" + n; old[p.name] = p; });
        return G.pointsAdd(G.current(), pts, window.IPPATSU_APP);
      }).then(function () { done("📤 " + pts.length + " 点(X・Y・Z)を現場「" + G.current() + "」に入れました。くるくる回し太郎の「📥 受け取る」で杭打ちに使えます。"); }, function (er) { v3msg("⚠ 渡せません: " + er.message); });
      return;
    }
    if (!window.indexedDB) { v3msg("この端末では渡せません。「📋 コピー」で写してください。"); return; }
    var rq = indexedDB.open("ippatsu-share", 1);
    rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
    rq.onerror = function () { v3msg("⚠ 渡せません。「📋 コピー」で写してください。"); };
    rq.onsuccess = function () {
      var db = rq.result, tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ from: me + "(3D データ)", at: Date.now(), axis: "northEast", file: null, points: pts }, "toKurukuru");
      tx.oncomplete = function () { db.close(); try { localStorage.setItem("share.toKurukuru", JSON.stringify({ from: me, at: Date.now(), n: pts.length, file: null })); } catch (e) { /* */ } done("📤 " + pts.length + " 点(X・Y・Z)を くるくる回し太郎 に渡しました。くるくるの「メニュー → 受け取る」で杭打ちに使えます。"); };
      tx.onerror = function () { db.close(); v3msg("⚠ 渡せません。「📋 コピー」で写してください。"); };
    };
  }
  function v3ui() {
    var d = V3.el, hh = H(), kk = !!(hh && hh.stakeAt);
    d.querySelector('[data-v="stake"]').hidden = !kk; d.querySelector('[data-v="stake"]').disabled = !V3.sel;
    d.querySelector('[data-v="kuru"]').hidden = kk; d.querySelector('[data-v="kuru"]').disabled = !V3.taken.length && !V3.sel; d.querySelector('[data-v="ex"]').textContent = "高さ ×" + V3.ex; d.querySelector('[data-v="ln"]').setAttribute("aria-pressed", String(V3.lines));
    d.querySelector('[data-v="take"]').disabled = !V3.sel;
    ["give", "copy", "clear"].forEach(function (k) { d.querySelector('[data-v="' + k + '"]').disabled = !V3.taken.length; });
    d.querySelector('[data-v3="list"]').innerHTML = V3.taken.map(function (p) { return "<div><b>" + esc3(p.name) + "<\/b><span>X " + (p.y / 1000).toFixed(3) + "<\/span><span>Y " + (p.x / 1000).toFixed(3) + "<\/span><span>Z " + p.z.toFixed(3) + "<\/span><\/div>"; }).join("");
    if (V3.sel) d.querySelector('[data-v3="card"]').innerHTML = "<span>X(北)<\/span><b>" + (V3.sel.y / 1000).toFixed(3) + "<\/b><span>Y(東)<\/span><b>" + (V3.sel.x / 1000).toFixed(3) + "<\/b><span>Z<\/span><b>" + V3.sel.z.toFixed(3) + " m<\/b>" + (V3.sel.what ? '<span style="grid-column:1/-1">' + esc3(V3.sel.what) + "<\/span>" : "");
  }
  var V3P = null;   // 最後に描いたときの写し方(タップの逆算に使う)
  function v3draw() {
    var S = v3surf(), cv = V3.el.querySelector("canvas"); if (!S || !cv) return;
    var w = cv.clientWidth || 360, h = cv.clientHeight || 400, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    var zmin = Infinity, zmax = -Infinity, i; for (i = 0; i < S.n; i++) { if (S.pz[i] < zmin) zmin = S.pz[i]; if (S.pz[i] > zmax) zmax = S.pz[i]; }
    var zr = Math.max(0.5, zmax - zmin), zc = (zmin + zmax) / 2, R = Math.hypot(S.x1 - S.x0, S.y1 - S.y0) / 2 || 1000;
    var cy = Math.cos(V3.yaw), sy = Math.sin(V3.yaw), cp = Math.cos(V3.pitch), sp = Math.sin(V3.pitch), ex = V3.ex;
    var sc = Math.min(w, h) / (2 * R / 1000) * 0.9 * V3.zoom;
    var prj = function (x, y, z) { var X = (x - V3.cx) / 1000, Y = (y - V3.cy) / 1000, Z = (z - zc) * ex, xr = X * cy - Y * sy, yr = X * sy + Y * cy; return [w / 2 + xr * sc, h * 0.5 - (yr * sp + Z * cp) * sc, yr * cp - Z * sp]; };
    V3P = { prj: prj, w: w, h: h };
    var F = [], LIM = 30000;
    var add = function (Sx, design) {
      var step = Math.max(1, Math.ceil(Sx.m / LIM));
      for (var t = 0; t < Sx.m; t += step) {
        var a = Sx.T[3 * t], b = Sx.T[3 * t + 1], c = Sx.T[3 * t + 2], up = design ? 0.01 : 0;
        var A = prj(Sx.px[a], Sx.py[a], Sx.pz[a] + up), B = prj(Sx.px[b], Sx.py[b], Sx.pz[b] + up), C = prj(Sx.px[c], Sx.py[c], Sx.pz[c] + up);
        var ux = (Sx.px[b] - Sx.px[a]) / 1000, uy = (Sx.py[b] - Sx.py[a]) / 1000, uz = (Sx.pz[b] - Sx.pz[a]) * ex, vx = (Sx.px[c] - Sx.px[a]) / 1000, vy = (Sx.py[c] - Sx.py[a]) / 1000, vz = (Sx.pz[c] - Sx.pz[a]) * ex;
        var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz) || 1; if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        var lit = Math.max(0, (nx * -0.45 + ny * 0.45 + nz * 0.77) / nl);
        F.push([A, B, C, (A[2] + B[2] + C[2]) / 3, design ? "rgba(124,58,237," + (0.5 + 0.4 * lit) + ")" : col3(((Sx.pz[a] + Sx.pz[b] + Sx.pz[c]) / 3 - zmin) / zr, lit)]);
      }
    };
    if (XS.gl) add(XS.gl, false);
    if (XS.surf && XS.surf !== XS.gl) add(XS.surf, !!XS.gl);
    F.sort(function (p, q2) { return q2[3] - p[3]; });
    g.lineWidth = 0.5;
    F.forEach(function (f) { g.fillStyle = f[4]; g.strokeStyle = "rgba(15,23,42,0.15)"; g.beginPath(); g.moveTo(f[0][0], f[0][1]); g.lineTo(f[1][0], f[1][1]); g.lineTo(f[2][0], f[2][1]); g.closePath(); g.fill(); g.stroke(); });
    var hh = H();
    if (V3.lines && hh && hh.lines) {   // 図面の線を面の上にのせて描く(面の外は描かない)
      g.strokeStyle = "rgba(15,23,42,0.75)"; g.lineWidth = 1; g.beginPath(); var segs = 0;
      (hh.lines() || []).forEach(function (l) {
        var P = l.draw || l.points; if (!P || segs > 40000) return; var on = false;
        for (var j = 0; j < P.length; j++) {
          var p = P[j]; if (p[0] < S.x0 || p[0] > S.x1 || p[1] < S.y0 || p[1] > S.y1) { on = false; continue; }
          var z = surfZ(S, p[0], p[1]); if (z == null) { on = false; continue; }
          var pp = prj(p[0], p[1], z + 0.02); if (on) g.lineTo(pp[0], pp[1]); else g.moveTo(pp[0], pp[1]); on = true; segs++;
        }
      });
      g.stroke();
    }
    g.font = "bold 11px sans-serif";
    var hm = hh && hh.hM ? hh.hM() : 1;
    ((hh && hh.picks && hh.picks()) || []).forEach(function (p) {
      var z = p.h ? p.h * hm : surfZ(S, p.x, p.y); if (z == null) return;
      var pp = prj(p.x, p.y, z); g.fillStyle = "#ea580c"; g.beginPath(); g.arc(pp[0], pp[1], 4, 0, 2 * Math.PI); g.fill(); g.fillText(p.name, pp[0] + 6, pp[1] - 4);
    });
    V3.taken.forEach(function (p) { var pp = prj(p.x, p.y, p.z); g.fillStyle = "#16a34a"; g.beginPath(); g.arc(pp[0], pp[1], 5, 0, 2 * Math.PI); g.fill(); g.fillStyle = "#14532d"; g.fillText(p.name, pp[0] + 7, pp[1] - 5); });
    if (V3.sel) { var s0 = prj(V3.sel.x, V3.sel.y, V3.sel.z); g.strokeStyle = "#dc2626"; g.lineWidth = 3; g.beginPath(); g.moveTo(s0[0], s0[1]); g.lineTo(s0[0], s0[1] - 28); g.stroke(); g.fillStyle = "#dc2626"; g.beginPath(); g.arc(s0[0], s0[1], 7, 0, 2 * Math.PI); g.fill(); g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke(); }
    var ax = w - 26, ay = 26, d0 = -sy, d1 = -cy * sp, Ln = Math.hypot(d0, d1) || 1;
    g.strokeStyle = "#0f172a"; g.lineWidth = 2; g.beginPath(); g.moveTo(ax - d0 / Ln * 12, ay + d1 / Ln * 12); g.lineTo(ax + d0 / Ln * 12, ay - d1 / Ln * 12); g.stroke();
    g.fillStyle = "#0f172a"; g.font = "bold 12px sans-serif"; g.fillText("N", ax + d0 / Ln * 16 - 4, ay - d1 / Ln * 16 + 4); g.lineWidth = 1;
    for (i = 0; i < 40; i++) { g.fillStyle = col3(i / 39, 1); g.fillRect(8 + i * 2, 8, 2, 8); }
    g.fillStyle = "#334155"; g.font = "11px sans-serif"; g.fillText(zmin.toFixed(2), 8, 28); g.fillText(zmax.toFixed(2) + " m", 70, 28);
  }
  // タップした所の X・Y・Z：頂点の近く(14px)なら頂点、それ以外は手前の三角形の中を内分
  function v3pick(sx, sy) {
    var S = v3surf(); if (!S || !V3P) return null;
    var prj = V3P.prj, best = null, bd = 14, i;
    var cand = [XS.surf, XS.gl].filter(Boolean);
    cand.forEach(function (Sx) { for (i = 0; i < Sx.n; i++) { var p = prj(Sx.px[i], Sx.py[i], Sx.pz[i]), d = Math.hypot(p[0] - sx, p[1] - sy); if (d < bd) { bd = d; best = { x: Sx.px[i], y: Sx.py[i], z: Sx.pz[i], what: (Sx === XS.gl ? "現況" : "設計") + "の面の点(頂点)" }; } } });
    if (best) return best;
    var front = null;
    cand.forEach(function (Sx) {
      for (var t = 0; t < Sx.m; t++) {
        var a = Sx.T[3 * t], b = Sx.T[3 * t + 1], c = Sx.T[3 * t + 2], A = prj(Sx.px[a], Sx.py[a], Sx.pz[a]), B = prj(Sx.px[b], Sx.py[b], Sx.pz[b]), C = prj(Sx.px[c], Sx.py[c], Sx.pz[c]);
        var d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]); if (Math.abs(d) < 1e-9) continue;
        var u = ((B[1] - C[1]) * (sx - C[0]) + (C[0] - B[0]) * (sy - C[1])) / d, v = ((C[1] - A[1]) * (sx - C[0]) + (A[0] - C[0]) * (sy - C[1])) / d, wv = 1 - u - v;
        if (u < 0 || v < 0 || wv < 0) continue;
        var depth = u * A[2] + v * B[2] + wv * C[2];
        if (!front || depth < front.depth) front = { depth: depth, x: u * Sx.px[a] + v * Sx.px[b] + wv * Sx.px[c], y: u * Sx.py[a] + v * Sx.py[b] + wv * Sx.py[c], S: Sx };
      }
    });
    if (!front) return null;
    var z = surfZ(front.S, front.x, front.y); if (z == null) return null;
    return { x: front.x, y: front.y, z: z, what: (front.S === XS.gl ? "現況" : "設計") + "の面の上" };
  }
  function v3touch(cv) {   // 1 本指:回す 2 本指:拡大と移動 タップ:点を取る(PC:ホイールで拡大・右ドラッグで移動)
    var pts = new Map(), d0 = null, p2 = null, tap = null;
    var re = function () { if (!V3.raf) V3.raf = requestAnimationFrame(function () { V3.raf = 0; v3draw(); }); };
    var mid = function () { var v = Array.from(pts.values()); return { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2, d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1 }; };
    var panBy = function (dx, dy) {   // 画面の動き → 図面の中心を動かす(水平面で)
      var S = v3surf(), R = Math.hypot(S.x1 - S.x0, S.y1 - S.y0) / 2 || 1000, sc = Math.min(V3P.w, V3P.h) / (2 * R / 1000) * 0.9 * V3.zoom;
      var cy = Math.cos(V3.yaw), sy = Math.sin(V3.yaw), sp = Math.max(0.2, Math.sin(V3.pitch));
      var xr = -dx / sc, yr = dy / sc / sp;
      V3.cx += (xr * cy + yr * sy) * 1000; V3.cy += (-xr * sy + yr * cy) * 1000;
    };
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("pointerdown", function (e) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button }); try { cv.setPointerCapture(e.pointerId); } catch (er) { /* */ }
      if (pts.size === 1) { d0 = { x: e.clientX, y: e.clientY, yaw: V3.yaw, pitch: V3.pitch, pan: e.button === 2 }; tap = { x: e.clientX, y: e.clientY, t: Date.now() }; }
      if (pts.size === 2) { d0 = null; tap = null; var m = mid(); p2 = { x: m.x, y: m.y, d: m.d, z: V3.zoom }; }
    });
    cv.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
      if (p2 && pts.size >= 2) { var m = mid(); V3.zoom = Math.max(0.2, Math.min(50, p2.z * m.d / p2.d)); panBy(m.x - p2.x, m.y - p2.y); p2.x = m.x; p2.y = m.y; re(); return; }
      if (!d0) return;
      if (d0.pan) { panBy(e.clientX - d0.x, e.clientY - d0.y); d0.x = e.clientX; d0.y = e.clientY; re(); return; }
      V3.yaw = d0.yaw + (e.clientX - d0.x) * 0.01; V3.pitch = Math.max(0.05, Math.min(1.55, d0.pitch + (e.clientY - d0.y) * 0.01)); re();
    });
    var up = function (e) {
      var t = tap; pts.delete(e.pointerId); if (pts.size < 2) p2 = null;
      if (pts.size === 1) { var v = Array.from(pts.values())[0]; d0 = { x: v.x, y: v.y, yaw: V3.yaw, pitch: V3.pitch }; }
      if (!pts.size) d0 = null;
      if (e.type === "pointerup" && t && !pts.size && Date.now() - t.t < 500) {
        var r = cv.getBoundingClientRect(), hit = v3pick(e.clientX - r.left, e.clientY - r.top);
        V3.sel = hit; if (!hit) v3msg("そこには 3D の面がありません。面の上をタップしてください。"); v3draw(); v3ui();
      }
      tap = null;
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) { e.preventDefault(); V3.zoom = Math.max(0.2, Math.min(50, V3.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); re(); }, { passive: false });
  }
  // ---------------------------------------------------------------- 読んだ LandXML を覚える(2026-11-19 ゆきちゃん)
  // 一度読んだ LandXML を IndexedDB「ippatsu-3d」に入れておき、4 本のどのアプリでも開いたらすぐ図面に重ねる。
  // 現場を選んでいれば現場ごと、選んでいなければ「最後に読んだもの」。🗻 →「✕ 外す」で忘れる。
  function keepDb() {
    return new Promise(function (ok, ng) {
      if (!window.indexedDB) return ng(new Error("no idb"));
      var rq = indexedDB.open("ippatsu-3d", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
      rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { ng(rq.error); };
    });
  }
  function keepKeys() { var G = window.Genba, c = G && G.current ? G.current() : ""; return c ? ["g:" + c, "_last"] : ["_last"]; }
  function keepSave(name, buf) {
    XS.kept = name;
    keepDb().then(function (db) {
      var tx = db.transaction("kv", "readwrite"), st = tx.objectStore("kv"), v = { name: name, at: Date.now(), bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
      keepKeys().forEach(function (k) { st.put(v, k); });
      tx.oncomplete = function () { db.close(); };
    }).catch(function () { /* 覚えられなくても読み込みはできている */ });
  }
  function keepDel() {
    keepDb().then(function (db) { var tx = db.transaction("kv", "readwrite"), st = tx.objectStore("kv"); keepKeys().forEach(function (k) { st.delete(k); }); tx.oncomplete = function () { db.close(); }; }).catch(function () { /* */ });
  }
  function keepGet(k) {
    return keepDb().then(function (db) { return new Promise(function (ok) { var rq = db.transaction("kv").objectStore("kv").get(k); rq.onsuccess = function () { db.close(); ok(rq.result || null); }; rq.onerror = function () { db.close(); ok(null); }; }); });
  }
  var restoring = false;
  async function restore(force) {
    if (restoring || !window.IPPATSU_HOST || (window.IPPATSU_SAFE && !force)) return;   // v2.13.0:安全モードでは前の LandXML を自動で重ねない
    if (!force && (XS.surf || XS.gl || XS.als.length)) return;
    restoring = true;
    try {
      var ks = keepKeys(), v = null;
      for (var i = 0; i < ks.length && !v; i++) v = await keepGet(ks[i]);
      if (!v || !v.bytes) return;
      var r = parseLandXml(decodeText(new Uint8Array(v.bytes)));
      if (!r.surf && !r.gl && !r.als.length) return;
      XS.kept = v.name;
      load(r, "🗻 前に読んだ LandXML「" + v.name + "」を図面に重ねました(🗻 →「✕ 外す」で外せます)。", true);
    } catch (e) { /* 覚えたものが読めないときは何もしない */ } finally { restoring = false; }
  }
  window.addEventListener("genba", function (e) { if (e.detail && e.detail.type === "current") restore(true); });
  window.addEventListener("pageshow", function (e) { if (e.persisted) restore(); });

  // 3D の面の高さ(m)。設計の面が無いところは現況の面。面が無ければ null(アプリが拾った点に高さを入れるのに使う)
  function zAt(x, y) { var z = surfZ(XS.surf, x, y); if (z == null) z = surfZ(XS.gl, x, y); return z; }
  window.IPPATSU_XS = { plan: plan, open: open, state: XS, surfZ: surfZ, zAt: zAt, parseLandXml: parseLandXml, loadFile: loadFile, menu3d: menu3d, v3open: v3open, restore: restore };
  var boot = function () { build(); setTimeout(restore, 300); };
  document.addEventListener("DOMContentLoaded", function () { if (window.IPPATSU_HOST) boot(); else setTimeout(function () { if (window.IPPATSU_HOST) boot(); }, 500); });
})();

    
