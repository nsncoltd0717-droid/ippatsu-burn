// 図脳RAPID の図面（.zrd・.zsdx・.zsdxz）を読んで DXF の文字列にする（墨太郎の「図面をひらく」で使う）。
// 読み方は 墨太郎エンジン\sumitaro\zunou.py と同じ（そちらに説明）。ブラウザだけで動く（オフライン可）。
(function (g) {
  "use strict";
  const MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const END = 0xfffffffe, FREE = 0xffffffff;
  const ZRD = { name: "zrd", sig: [1, 1, 2, 0x0a, 0, 0, 0], h: 17, enc: "shift_jis" };
  const ZSDX = { name: "zsdx", sig: [1, 1, 2, 0x0f, 0, 0, 0], h: 32, enc: "utf-16le" };
  const KIND = { 0x108: "DIMENSION", 0x10b: "GROUP", 0x10c: "LEADER" };

  function isOle(u8) {
    return u8.length > 512 && MAGIC.every((b, i) => u8[i] === b);
  }

  // ---------------------------------------------------------------- OLE 複合ファイル
  function readStream(u8, name) {
    if (!isOle(u8)) throw new Error("図脳RAPID の図面ではありません(OLE 複合ファイルではない)");
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
    const ss = 1 << u16(30), mss = 1 << u16(32);
    const nFat = u32(44), dirStart = u32(48), cutoff = u32(56);
    const miniStart = u32(60), difStart = u32(68), nDif = u32(72);
    const sectOff = (i) => (i + 1) * ss;
    const difat = [];
    for (let i = 0; i < 109; i++) difat.push(u32(76 + 4 * i));
    let d = difStart;
    for (let k = 0; k < nDif && d !== END && d !== FREE; k++) {
      const o = sectOff(d);
      for (let i = 0; i < ss / 4 - 1; i++) difat.push(u32(o + 4 * i));
      d = u32(o + ss - 4);
    }
    const fat = [];
    for (const s of difat.slice(0, nFat)) {
      const o = sectOff(s);
      for (let i = 0; i < ss / 4; i++) fat.push(u32(o + 4 * i));
    }
    const chain = (start, table) => {
      const out = [], seen = new Set();
      let s = start;
      while (s !== END && s !== FREE && s < table.length && !seen.has(s)) { seen.add(s); out.push(s); s = table[s]; }
      return out;
    };
    const gather = (sects, size) => {
      const out = new Uint8Array(sects.length * ss);
      sects.forEach((s, i) => out.set(u8.subarray(sectOff(s), sectOff(s) + ss), i * ss));
      return size === undefined ? out : out.subarray(0, size);
    };
    const dir = gather(chain(dirStart, fat));
    const ddv = new DataView(dir.buffer);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nl = ddv.getUint16(o + 64, true);
      const nm = new TextDecoder("utf-16le").decode(dir.subarray(o, o + Math.max(0, nl - 2)));
      entries.push({ name: nm, type: dir[o + 66], start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
    }
    const e = entries.find((x) => x.type === 2 && x.name === name);
    if (!e) throw new Error(`図脳RAPID の図面ではありません(${name} がない)`);
    if (e.size >= cutoff) return gather(chain(e.start, fat), e.size);
    const minifat = [];
    for (const s of chain(miniStart, fat)) {
      const o = sectOff(s);
      for (let i = 0; i < ss / 4; i++) minifat.push(u32(o + 4 * i));
    }
    const ministream = gather(chain(entries[0].start, fat));
    const ms = chain(e.start, minifat);
    const out = new Uint8Array(ms.length * mss);
    ms.forEach((s, i) => out.set(ministream.subarray(s * mss, (s + 1) * mss), i * mss));
    return out.subarray(0, e.size);
  }

  // DecompressionStream が無いブラウザ（古い iPhone など）用の inflate（zlib の頭 2 バイトを飛ばす）
  function inflateJS(src) {
    let pos = 2, bit = 0, cnt = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), op = 0;
    const need = (n) => { if (op + n > out.length) { let m = out.length * 2; while (m < op + n) m *= 2; const o = new Uint8Array(m); o.set(out.subarray(0, op)); out = o; } };
    const bits = (n) => { while (cnt < n) { if (pos >= src.length) throw new Error("inflate: 途中で終わり"); bit |= src[pos++] << cnt; cnt += 8; } const v = bit & ((1 << n) - 1); bit >>>= n; cnt -= n; return v; };
    const build = (lens) => { const cnts = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(lens.length); for (const l of lens) cnts[l]++; cnts[0] = 0; for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + cnts[i - 1]; for (let i = 0; i < lens.length; i++) if (lens[i]) sym[offs[lens[i]]++] = i; return { cnts, sym }; };
    const decode = (t) => { let code = 0, first = 0, idx = 0; for (let l = 1; l < 16; l++) { code |= bits(1); const c = t.cnts[l]; if (code - c < first) return t.sym[idx + code - first]; idx += c; first += c; first <<= 1; code <<= 1; } throw new Error("inflate: 符号が不正"); };
    const LB = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258], LE = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    const DB = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577], DE = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    let fixL = null, fixD = null, last = 0;
    while (!last) {
      last = bits(1); const type = bits(2);
      if (type === 0) {
        bit = 0; cnt = 0; const len = src[pos] | (src[pos + 1] << 8); pos += 4;
        need(len); out.set(src.subarray(pos, pos + len), op); op += len; pos += len; continue;
      }
      let lt, dt;
      if (type === 1) {
        if (!fixL) { const l = new Uint8Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); fixL = build(l); fixD = build(new Uint8Array(30).fill(5)); }
        lt = fixL; dt = fixD;
      } else if (type === 2) {
        const hl = bits(5) + 257, hd = bits(5) + 1, hc = bits(4) + 4, ord = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15], cl = new Uint8Array(19);
        for (let i = 0; i < hc; i++) cl[ord[i]] = bits(3);
        const ct = build(cl), ls = new Uint8Array(hl + hd);
        for (let i = 0; i < hl + hd;) { const s = decode(ct); if (s < 16) ls[i++] = s; else if (s === 16) { const p = ls[i - 1]; for (let r = 3 + bits(2); r--;) ls[i++] = p; } else if (s === 17) i += 3 + bits(3); else i += 11 + bits(7); }
        lt = build(ls.subarray(0, hl)); dt = build(ls.subarray(hl));
      } else throw new Error("inflate: 種類が不正");
      for (;;) {
        const s = decode(lt);
        if (s < 256) { need(1); out[op++] = s; }
        else if (s === 256) break;
        else { const k = s - 257, len = LB[k] + bits(LE[k]), d = decode(dt), dist = DB[d] + bits(DE[d]); need(len); for (let i = 0; i < len; i++, op++) out[op] = out[op - dist]; }
      }
    }
    return out.slice(0, op);
  }

  async function inflate(u8) {
    if (typeof DecompressionStream === "function" && typeof Blob.prototype.stream === "function") {
      try {
        const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"));
        return new Uint8Array(await new Response(s).arrayBuffer());
      } catch (e) { /* 下の JS 版で */ }
    }
    return inflateJS(u8);
  }

  // ---------------------------------------------------------------- 記録
  const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  function walk(u8, p, end, strict) {
    const dv = view(u8), out = [];
    while (p + 6 <= end) {
      const t = dv.getUint16(p, true), n = dv.getUint32(p + 2, true);
      if (p + 6 + n > end) return strict ? null : out;
      out.push([t, p + 6, n]);
      p += 6 + n;
      if (t === 0xffff) return !strict || p === end ? out : null;
    }
    return strict ? null : out;
  }
  const startsWith = (u8, s) => [...s].every((ch, i) => u8[i] === ch.charCodeAt(0));

  async function records(c) {
    const dv = view(c);
    if (startsWith(c, "ZRD.")) {
      for (let s = 16; s < Math.min(c.length, 8192); s++) {
        const t = dv.getUint16(s, true);
        if (![0x11, 0x5, 0x6, 0x9, 0x10d].includes(t)) continue;
        const r = walk(c, s, c.length, true);
        if (r) return { f: ZRD, recs: r.map(([t, p, n]) => [t, c.subarray(p, p + n)]) };
      }
      throw new Error("図脳RAPID(.zrd)の記録の並びを見つけられません(対応していない版)");
    }
    if (startsWith(c, "PHT.ZSDX")) {
      for (let s = 16; s < Math.min(c.length, 8192); s++) {
        const t0 = dv.getUint16(s, true), n0 = dv.getUint32(s + 2, true);
        if (!(t0 & 0x8000) || s + 6 + n0 > c.length || c[s + 6] !== 0x78) continue;
        try {
          const out = [];
          let p = s;
          while (p + 6 <= c.length) {
            const t = dv.getUint16(p, true), n = dv.getUint32(p + 2, true);
            let body = c.subarray(p + 6, p + 6 + n);
            if (t !== 0xffff && t & 0x8000 && n) body = await inflate(body);
            out.push([t === 0xffff ? t : t & 0x7fff, body]);
            p += 6 + n;
            if (t === 0xffff) break;
          }
          if (out.length > 3) return { f: ZSDX, recs: out };
        } catch (e) { /* 次の位置 */ }
      }
      throw new Error("図脳RAPID(.zsdx)の記録の並びを見つけられません(対応していない版)");
    }
    throw new Error("図脳RAPID の図面ではありません(ヘッダが ZRD. でも PHT.ZSDX でもない)");
  }

  // ---------------------------------------------------------------- 図形
  const ang = (cx, cy, x, y) => ((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 360) % 360;
  function str(b, dv, q, f) {
    const n = dv.getUint32(q, true);
    const s = new TextDecoder(f.enc).decode(b.subarray(q + 4, q + 4 + n)).replace(/\0+$/, "");
    return [s, q + 4 + n];
  }
  function sigAt(b, i, f) { return f.sig.every((x, k) => b[i + k] === x); }
  function kids(b, f) {
    const dv = view(b), out = [];
    let p = 1;
    for (;;) {
      let i = -1;
      for (let k = p; k + 7 <= b.length; k++) if (sigAt(b, k, f)) { i = k; break; }
      if (i < 0) return out;
      const s = i - 6;
      if (s >= 0) {
        const t = dv.getUint16(s, true), n = dv.getUint32(s + 2, true);
        if (t >= 0x101 && t <= 0x10c && s + 6 + n <= b.length) { out.push([t, b.subarray(s + 6, s + 6 + n)]); p = s + 6 + n; continue; }
      }
      p = i + 1;
    }
  }
  // 塗り潰し・ハッチ(0x0110)の境界(設計図作成エンジンの zrd_read.py の _fill_paths と同じ読み方)
  function arcPts(st, en, c, ccw) {
    let a0 = Math.atan2(st[1] - c[1], st[0] - c[0]), a1 = Math.atan2(en[1] - c[1], en[0] - c[0]);
    const r = Math.hypot(st[0] - c[0], st[1] - c[1]);
    if (ccw) while (a1 <= a0) a1 += 2 * Math.PI; else while (a1 >= a0) a1 -= 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(((a1 - a0) * 180) / Math.PI) / 2)), out = [];
    for (let i = 1; i < n; i++) out.push([c[0] + r * Math.cos(a0 + ((a1 - a0) * i) / n), c[1] + r * Math.sin(a0 + ((a1 - a0) * i) / n)]);
    out.push(en);
    return out;
  }
  function fillPaths(b, dv, base) {
    if (b.length < base + 4) return null;
    const d = (o) => dv.getFloat64(o, true);
    const n = dv.getUint32(base, true), paths = [];
    let o = base + 4;
    try {
      for (let i = 0; i < n; i++) {
        const k = b[o];
        if (k === 0 || k === 1) {
          if (k === 1 && !paths.length) return null;
          if (k === 0) paths.push([]);
          paths[paths.length - 1].push([d(o + 1), d(o + 9)]);
          o += 17;
        } else if (k === 2 || k === 3) {
          const last = paths.length && paths[paths.length - 1];
          if (!last || !last.length) return null;
          last.push(...arcPts(last[last.length - 1], [d(o + 1), d(o + 9)], [d(o + 17), d(o + 25)], k === 3));
          o += 41;
        } else if (k === 4 && b[o + 1] === 0) {
          const m = dv.getUint32(o + 2, true);
          if (!paths.length) paths.push([]);
          for (let j = 0; j < m; j++) paths[paths.length - 1].push([d(o + 6 + 16 * j), d(o + 14 + 16 * j)]);
          o += 6 + 16 * m;
        } else return null;
      }
    } catch (e) { return null; }
    const out = [];
    for (let p of paths) {
      if (!p.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]) && Math.abs(q[0]) < 1e9 && Math.abs(q[1]) < 1e9)) return null;
      p = p.filter((q, i) => i === 0 || q[0] !== p[i - 1][0] || q[1] !== p[i - 1][1]);
      if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
      if (p.length >= 3) out.push(p);
    }
    return out.length ? out : null;
  }
  // 寸法(0x0108)の線。共通部分の後 77 バイトの設定に続いて「点数 u32 ＋ 点」の並びが 5 つ:
  //   0 補助線の先(寸法線の外側)、1 寸法線、2 補助線の元(図形からすき間をあけた所)、3 測った図形、4 寸法線(1 と同じ)
  // 中ノ谷川・泉の広場の .zrd で確かめた(2026-11-06)。矢印は 0x010A(種類・先端・向き・大きさ)
  function dimension(b, dv, f, base, group, out) {
    const ok = (v) => Number.isFinite(v) && (v === 0 || (Math.abs(v) > 1e-6 && Math.abs(v) < 1e9));
    const segs = [];
    let q = f.h + 77;
    while (q + 4 <= b.length) {
      const n = dv.getUint32(q, true);
      if (n < 1 || n > 1000 || q + 4 + 16 * n > b.length) break;
      const pts = [];
      for (let i = 0; i < n; i++) pts.push([dv.getFloat64(q + 4 + 16 * i, true), dv.getFloat64(q + 12 + 16 * i, true)]);
      if (!pts.every((p) => ok(p[0]) && ok(p[1]))) break;
      segs.push(pts);
      q += 4 + 16 * n;
    }
    const g = { ...base, group: group || "DIMENSION", dim: true };
    const line = (a, c) => { if (a[0] !== c[0] || a[1] !== c[1]) out.push({ ...g, type: "LINE", start: a, end: c }); };
    if (segs.length >= 5 && segs.every((s) => s.length >= 2)) {
      const L = (s) => s[s.length - 1];
      out.push({ ...g, type: "LINE", start: segs[4][0], end: L(segs[4]), dimMain: true }); // 寸法線
      line(segs[2][0], segs[0][0]);                 // 補助線
      line(L(segs[2]), L(segs[0]));
    } else for (const s of segs) for (let i = 0; i + 1 < s.length; i++) line(s[i], s[i + 1]);
    // 矢印
    for (let i = q; i + 6 + 50 <= b.length; i++) {
      if (b[i] !== 0x0a || b[i + 1] !== 0x01) continue;
      const n = dv.getUint32(i + 2, true), m = i + 6;
      if (n < 50 || m + n > b.length || !sigAt(b, m, f)) continue;
      const kind = b[m + 17], x = dv.getFloat64(m + 18, true), y = dv.getFloat64(m + 26, true);
      const a = dv.getFloat64(m + 34, true), sz = dv.getFloat64(m + 42, true);
      if (kind && sz > 0 && ok(x) && ok(y)) {
        for (const da of [0.3, -0.3]) line([x, y], [x + sz * Math.cos(a + da), y + sz * Math.sin(a + da)]);
      }
      i += 5 + n;
    }
  }
  function decode(t, b, f, layers, group, out, unknown) {
    const dv = view(b), H = f.h;
    const d = (o) => dv.getFloat64(o, true);
    const lid = dv.getUint32(7, true);
    const base = { layer: (layers.get(lid) || String(lid)), aux: lid >= 0x80000000, group };
    try {
      if (t === 0x101) out.push({ ...base, type: "LINE", start: [d(H), d(H + 8)], end: [d(H + 16), d(H + 24)] });
      else if (t === 0x102) out.push({ ...base, type: "CIRCLE", center: [d(H + 35), d(H + 43)], radius: d(H + 51) });
      else if (t === 0x103) {
        const cx = d(H), cy = d(H + 8), r = d(H + 16), sx = d(H + 24), sy = d(H + 32), ex = d(H + 40), ey = d(H + 48);
        out.push({ ...base, type: "ARC", center: [cx, cy], radius: r, sa: ang(cx, cy, sx, sy), ea: ang(cx, cy, ex, ey) });
      } else if (t === 0x104 || t === 0x105) {
        let cx = d(H + 35), cy = d(H + 43), a0 = d(H + 51), a = d(H + 59), bb = d(H + 67), sh = 0;
        if (bb > a) { [a, bb] = [bb, a]; a0 += Math.PI / 2; sh = Math.PI / 2; }
        const e = { ...base, type: "ELLIPSE", center: [cx, cy], angle: a0, major: a, minor: bb, t0: 0, t1: 2 * Math.PI };
        if (t === 0x105) { e.t0 = d(H + 75) - sh; e.t1 = d(H + 83) - sh; }
        out.push(e);
      } else if (t === 0x106) {
        const x = d(H), y = d(H + 8), n = dv.getUint32(H + 16, true);
        const corner = n ? [d(H + 20), d(H + 28)] : [x, y];
        let q = H + 20 + 16 * n;
        const a = d(q), h = d(q + 9);
        let font, s;
        [font, q] = str(b, dv, q + 25, f);
        [s, q] = str(b, dv, q, f);
        out.push({ ...base, type: "TEXT", at: [x, y], corner, angle: a, height: h, text: s });
      } else if (t === 0x107) {
        let q = H + 36;
        const marks = [];
        while (dv.getUint16(q, true) === 0x10a) {
          const n = dv.getUint32(q + 2, true);
          if (n >= 50) marks.push({ kind: b[q + 6 + 17], ang: d(q + 6 + 34), size: d(q + 6 + 42) });
          q += 6 + n;
        }
        const n = dv.getUint32(q, true), pts = [];
        for (let i = 0; i < n; i++) pts.push([d(q + 4 + 16 * i), d(q + 12 + 16 * i)]);
        if (n === 1 || (n === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) out.push({ ...base, type: "POINT", at: pts[0], mark: marks[0] || null });
        else if (n) {
          const closed = n > 2 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1];
          out.push({ ...base, type: "POLYLINE", points: closed ? pts.slice(0, -1) : pts, closed, marks: marks.some((m) => m.kind) ? marks : undefined });
        }
      } else if (t === 0x110) {
        const paths = fillPaths(b, dv, H + 35);
        if (paths) for (const pth of paths) out.push({ ...base, type: "POLYLINE", points: pth, closed: true, fill: true });
        else unknown[t] = (unknown[t] || 0) + 1;
      } else if (t === 0x108) {
        dimension(b, dv, f, base, group, out);
        for (const [kt, kb] of kids(b, f)) decode(kt, kb, f, layers, group || KIND[t], out, unknown);
      } else if (KIND[t]) {
        for (const [kt, kb] of kids(b, f)) decode(kt, kb, f, layers, group || KIND[t], out, unknown);
      } else if (t !== 0x10a) unknown[t] = (unknown[t] || 0) + 1;
    } catch (e) {
      unknown[t] = (unknown[t] || 0) + 1;
    }
  }

  async function parse(c) {
    const { f, recs } = await records(c);
    const layers = new Map(), entities = [], unknown = {};
    let origin = null, rot = 0;
    const layerRec = (dd) => {
      const v = view(dd), lid = v.getUint32(0, true), ln = v.getUint32(4, true);
      layers.set(lid, new TextDecoder(f.enc).decode(dd.subarray(8, 8 + ln)).replace(/\0+$/, ""));
    };
    for (const [t, dd] of recs) {
      if (t === 0x11) layerRec(dd);
      else if (t === 0x4) for (const [tt, p, n] of walk(dd, 4, dd.length, false) || []) { if (tt === 0x11) layerRec(dd.subarray(p, p + n)); }
      else if (t === 0xa && dd.length === 16) origin = [view(dd).getFloat64(0, true), view(dd).getFloat64(8, true)];
      else if (t === 0x303 && dd.length >= 16) { const a = view(dd).getFloat64(8, true); if (Number.isFinite(a) && Math.abs(a) < 100) rot = a; } // 座標設定の回転角(rad)
    }
    for (const [t, dd] of recs) {
      if (t !== 0x5) continue;
      for (const [tt, p, n] of walk(dd, f === ZSDX ? 12 : 4, dd.length, false) || []) {
        const b = dd.subarray(p, p + n);
        if (!sigAt(b, 0, f)) { unknown[tt] = (unknown[tt] || 0) + 1; continue; }
        decode(tt, b, f, layers, null, entities, unknown);
      }
    }
    const hasWorld = !!origin && (Math.abs(origin[0]) > 1e-9 || Math.abs(origin[1]) > 1e-9);
    // 公共座標 = 回転(-rot) × (図面の点 - 原点)。中ノ谷川の図面(25°)を法面工座標.csv と照合して確かめた
    let r = hasWorld ? Math.atan2(Math.sin(rot), Math.cos(rot)) : 0;
    if (Math.abs(r) < 1e-12) r = 0;
    return { fmt: f.name, layers, entities, origin: hasWorld ? origin : null, rot: r, unknown };
  }

  async function read(u8) {
    return parse(readStream(u8, "Contents"));
  }

  // ---------------------------------------------------------------- DXF
  // 図面は実寸 mm。公共座標の原点があれば、公共座標(mm。横=Y東・縦=X北)に移して書く。
  // 図形の代表点(はなれ値の判定用)
  function refPoint(e) {
    return e.start || e.center || e.at || e.corner || (e.points && e.points[0]) || null;
  }
  // 図面の大部分からとても遠い図形(用紙の外に置いた原点の印・貼り付けの残りなど)を見つける。
  // 中央値から 75% の図形までの距離の 20 倍、かつ 2 km より遠いもの。
  function farSet(dr) {
    const ps = [];
    for (const e of dr.entities) { if (e.aux) continue; const p = refPoint(e); if (p) ps.push(p); }
    if (ps.length < 20) return new Set();
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
    const mx = med(ps.map((p) => p[0])), my = med(ps.map((p) => p[1]));
    const ds = ps.map((p) => Math.hypot(p[0] - mx, p[1] - my)).sort((a, b) => a - b);
    const lim = Math.max(20 * ds[Math.floor(ds.length * 0.75)], 2e6);
    const far = new Set();
    for (const e of dr.entities) { const p = refPoint(e); if (p && Math.hypot(p[0] - mx, p[1] - my) > lim) far.add(e); }
    return far;
  }
  function toDxf(dr, opt = {}) {
    const world = opt.world ?? !!dr.origin;
    const [ox, oy] = world && dr.origin ? dr.origin : [0, 0];
    const th = world && dr.origin ? -(dr.rot || 0) : 0, thD = (th * 180) / Math.PI, cs = Math.cos(th), sn = Math.sin(th);
    const far = opt.keepFar ? new Set() : farSet(dr);
    dr.dropped = far.size;
    const L = [];
    const g = (c, v) => { L.push(String(c), typeof v === "number" ? (Number.isInteger(v) && c >= 60 && c < 80 ? String(v) : v.toFixed(6)) : String(v)); };
    const lay = (e) => (e.layer || "0").replace(/[<>/\\":;?*|=`,]/g, "_");
    g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSUNITS"); g(70, 4); g(0, "ENDSEC");
    g(0, "SECTION"); g(2, "ENTITIES");
    for (const e of dr.entities) {
      if ((e.aux && !opt.aux) || far.has(e)) continue;
      const P = (p) => { const x = p[0] - ox, y = p[1] - oy; return th ? [x * cs - y * sn, x * sn + y * cs] : [x, y]; };
      if (e.type === "LINE") { const a = P(e.start), b = P(e.end); g(0, "LINE"); g(8, lay(e)); g(10, a[0]); g(20, a[1]); g(11, b[0]); g(21, b[1]); }
      else if (e.type === "CIRCLE") { const c = P(e.center); g(0, "CIRCLE"); g(8, lay(e)); g(10, c[0]); g(20, c[1]); g(40, e.radius); }
      else if (e.type === "ARC") { const c = P(e.center); g(0, "ARC"); g(8, lay(e)); g(10, c[0]); g(20, c[1]); g(40, e.radius); g(50, (e.sa + thD + 360) % 360); g(51, (e.ea + thD + 360) % 360); }
      else if (e.type === "ELLIPSE") {
        // 楕円は折れ線にする(墨太郎の線として選べる)
        let t0 = e.t0, t1 = e.t1;
        while (t1 <= t0) t1 += 2 * Math.PI;
        const n = Math.max(8, Math.ceil(((t1 - t0) * 180) / Math.PI / 3));
        const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
        g(0, "POLYLINE"); g(8, lay(e)); g(66, 1); g(70, 0);
        for (let i = 0; i <= n; i++) {
          const t = t0 + ((t1 - t0) * i) / n, u = e.major * Math.cos(t), v = e.minor * Math.sin(t);
          const p = P([e.center[0] + u * ca - v * sa, e.center[1] + u * sa + v * ca]);
          g(0, "VERTEX"); g(8, lay(e)); g(10, p[0]); g(20, p[1]);
        }
        g(0, "SEQEND");
      } else if (e.type === "POLYLINE") {
        g(0, "POLYLINE"); g(8, lay(e)); g(66, 1); g(70, e.closed ? 1 : 0);
        for (const q of e.points) { const p = P(q); g(0, "VERTEX"); g(8, lay(e)); g(10, p[0]); g(20, p[1]); }
        g(0, "SEQEND");
        // 線の端の記号(引出線の矢印・黒丸など)。始めの記号は最初の点、終わりの記号は最後の点に付く
        if (opt.marks && e.marks && !e.closed) {
          e.marks.forEach((m, i) => {
            if (!m || !m.kind || i > 1) return;
            const p = P(i === 0 ? e.points[0] : e.points[e.points.length - 1]);
            opt.marks.push({ x: p[0], y: p[1], kind: 100 + m.kind, ang: (m.ang || 0) + th, size: m.size || 0 });
          });
        }
      } else if (e.type === "POINT") {
        // 点の記号を線で描く(× ・＋・その他は小さい ＋)。大きさが無ければ 1 m
        const p = P(e.at), m = e.mark || { kind: 0, ang: 0, size: 0 };
        if (opt.marks) opt.marks.push({ x: p[0], y: p[1], kind: m.kind, ang: (m.ang || 0) + th, size: m.size || 0 });
        if (opt.marks && opt.markLines === false) continue; // 記号は線にしない(かまし太郎：記号の中心に吸い付かせる)
        const s = m.size > 0 ? m.size : 1000, a0 = (m.ang || 0) + th;
        const strokes = m.kind === 9 ? [[s, a0 + Math.PI / 4], [s, a0 - Math.PI / 4]]
          : m.kind === 8 ? [[s, a0], [s, a0 + Math.PI / 2], [s / 5, a0 + Math.PI / 4], [s / 5, a0 - Math.PI / 4]]
          : [[s / 2, a0], [s / 2, a0 + Math.PI / 2]];
        for (const [ln, th] of strokes) {
          const dx = (ln / 2) * Math.cos(th), dy = (ln / 2) * Math.sin(th);
          g(0, "LINE"); g(8, lay(e)); g(10, p[0] - dx); g(20, p[1] - dy); g(11, p[0] + dx); g(21, p[1] + dy);
        }
      }
      else if (e.type === "TEXT" && e.text.trim()) {
        const p = P(e.corner);
        g(0, "TEXT"); g(8, lay(e)); g(10, p[0]); g(20, p[1]); g(40, Math.max(e.height, 1e-6));
        g(1, e.text.replace(/[\r\n]+/g, " ")); g(50, ((((e.angle + th) * 180) / Math.PI) % 360 + 360) % 360);
      }
    }
    g(0, "ENDSEC"); g(0, "EOF");
    return L.join("\r\n") + "\r\n";
  }

  function summary(dr) {
    const c = {};
    for (const e of dr.entities) if (!e.aux) c[e.type] = (c[e.type] || 0) + 1;
    return c;
  }

  // 公共座標(m) → 図面の点(mm、墨太郎の DXF の座標)。原点が無ければ null。
  // 図脳の図面の点(mm) → 墨太郎の座標(公共座標 mm、横=Y東・縦=X北)。原点が無ければそのまま
  function toWorld(dr, p) {
    if (!dr.origin) return [p[0], p[1]];
    const x = p[0] - dr.origin[0], y = p[1] - dr.origin[1], th = -(dr.rot || 0);
    return th ? [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th)] : [x, y];
  }
  function worldToDrawing(dr, X, Y) {
    return dr.origin ? [Y * 1000, X * 1000] : null;
  }

  g.Zunou = { isOle, readStream, read, parse, toDxf, summary, worldToDrawing, toWorld };
})(typeof window !== "undefined" ? window : globalThis);

    
