"use strict";
(() => {
  // packages/io/src/dxfRaw.ts
  var EXTRUSION_TOL = 1e-6;
  function dxfExtrusionOf(nx, ny, nz) {
    if (Math.abs(nx) < EXTRUSION_TOL && Math.abs(ny) < EXTRUSION_TOL) {
      if (Math.abs(nz - 1) < EXTRUSION_TOL) return "plan";
      if (Math.abs(nz + 1) < EXTRUSION_TOL) return "flipped";
    }
    return "tilted";
  }
  var norm360 = (a) => (a % 360 + 360) % 360;
  function dxfFlipArc(a0, a1) {
    const s = norm360(180 - a1);
    return [s, Math.abs(a1 - a0 - 360) < 1e-9 ? s + 360 : norm360(180 - a0)];
  }
  function dxfTiltedNote(items) {
    const n = items.filter((e) => e.tilted).length;
    if (n === 0) return void 0;
    return `押出方向が (0,0,±1) でない図形が ${n} 個あります(傾いた面)。平面の座標に直せないので、書かれた座標のまま読みました。位置を図面で確かめてください`;
  }
  function stripMText(raw) {
    return raw.replace(/\\P/g, " ").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/[{}]/g, "").replace(/\\\\/g, "\\").replace(/\s+/g, " ").trim();
  }

  // packages/io/src/dxf.ts
  var DxfError = class extends Error {
  };
  var neg = (v) => 0 - v;
  function decode(buf) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      return new TextDecoder("shift_jis").decode(buf);
    }
  }
  function parseDxfTexts(data) {
    const src = typeof data === "string" ? data : decode(data);
    if (src.startsWith("AutoCAD Binary DXF")) {
      throw new DxfError("バイナリ形式の DXF は未対応です。ASCII DXF で保存し直してください。");
    }
    const lines = src.split(/\r\n|\r|\n/);
    const out = [];
    let kind = "";
    let x = 0;
    let y = 0;
    let layer = "";
    let height = 0;
    let text = "";
    let frags = [];
    let hasPoint = false;
    let nx = 0;
    let ny = 0;
    let nz = 1;
    let embedded = false;
    let xIsWcs = false;
    let backward = false;
    let dirX;
    const flush = () => {
      if (kind === "TEXT" || kind === "MTEXT" || kind === "ATTRIB") {
        const body = kind === "MTEXT" ? stripMText(frags.join("") + text) : text.trim();
        if (hasPoint && body) {
          const raw = dxfExtrusionOf(nx, ny, nz);
          const ext = kind === "MTEXT" ? "plan" : raw;
          const t = { x: ext === "flipped" && !xIsWcs ? neg(x) : x, y, text: body, layer, height };
          if (ext === "tilted") t.tilted = true;
          const wcsForm = kind === "MTEXT" || xIsWcs;
          if (wcsForm ? raw === "flipped" && !((dirX ?? -1) > 0) : ext === "flipped" !== backward)
            t.mirrored = true;
          out.push(t);
        }
      }
      kind = "";
      x = 0;
      y = 0;
      layer = "";
      height = 0;
      text = "";
      frags = [];
      hasPoint = false;
      nx = 0;
      ny = 0;
      nz = 1;
      embedded = false;
      xIsWcs = false;
      backward = false;
      dirX = void 0;
    };
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number.parseInt((lines[i] ?? "").trim(), 10);
      const value = lines[i + 1] ?? "";
      if (Number.isNaN(code)) continue;
      if (code === 0) {
        flush();
        kind = value.trim().toUpperCase();
        continue;
      }
      if (!kind) continue;
      switch (code) {
        case 101:
          embedded = true;
          break;
        case 11:
          if (kind === "MTEXT" || embedded) dirX = Number(value.trim());
          break;
        case 71:
          if ((kind === "TEXT" || kind === "ATTRIB") && !embedded) backward = (Number(value.trim()) & 2) === 2;
          break;
        case 10:
          x = Number(value.trim());
          hasPoint = Number.isFinite(x);
          xIsWcs = embedded;
          break;
        case 20:
          y = Number(value.trim());
          if (!Number.isFinite(y)) hasPoint = false;
          break;
        case 40:
          height = Number(value.trim()) || 0;
          break;
        case 8:
          layer = value.trim();
          break;
        case 3:
          frags.push(value);
          break;
        case 1:
          text = value;
          break;
        case 210:
          if (!embedded) nx = Number(value.trim());
          break;
        case 220:
          if (!embedded) ny = Number(value.trim());
          break;
        case 230:
          if (!embedded) nz = Number(value.trim());
          break;
        default:
          break;
      }
    }
    flush();
    return out;
  }
  function parseDxfEntities(data) {
    const src = typeof data === "string" ? data : decode(data);
    if (src.startsWith("AutoCAD Binary DXF")) {
      throw new DxfError("バイナリ形式の DXF は未対応です。ASCII DXF で保存し直してください。");
    }
    const lines = src.split(/\r\n|\r|\n/);
    const out = [];
    let kind = "";
    let layer = "";
    let closed = false;
    let flags70 = 0;
    let openPoly = null;
    let radius = 0;
    let a0;
    let a1;
    let lt = "";
    let col = 256;
    let xs = [];
    let ys = [];
    let nx = 0;
    let ny = 0;
    let nz = 1;
    const layerLt = /* @__PURE__ */ new Map();
    let tableName = "";
    let tableLt = "";
    let tableCol = 0;
    const layerCol = /* @__PURE__ */ new Map();
    const pendingCol = [];
    const pending = [];
    const closePoly = () => {
      if (!openPoly) return;
      const p = openPoly;
      openPoly = null;
      if (!p.mesh && p.pts.length > 0) p.e.points = p.pts;
      if (p.e.points.length === 0) {
        const k = out.lastIndexOf(p.e);
        if (k >= 0) out.splice(k, 1);
      }
    };
    const flush = () => {
      if (openPoly) {
        if (kind === "VERTEX") {
          if ((flags70 & 16) === 0 && xs.length > 0 && ys.length > 0) {
            const vx = xs[0];
            openPoly.pts.push([openPoly.flip ? neg(vx) : vx, ys[0]]);
          }
        } else closePoly();
      }
      if (kind === "LINE" || kind === "LWPOLYLINE" || kind === "POLYLINE" || kind === "CIRCLE" || kind === "ARC") {
        const ocs = kind !== "LINE" && (kind !== "POLYLINE" || (flags70 & (8 | 16 | 64)) === 0);
        const ext = ocs ? dxfExtrusionOf(nx, ny, nz) : "plan";
        const flip = ext === "flipped";
        const points = [];
        for (let i = 0; i < Math.min(xs.length, ys.length); i++)
          points.push([flip ? neg(xs[i]) : xs[i], ys[i]]);
        if (points.length > 0 || kind === "POLYLINE") {
          const e = { kind, layer, points, closed, radius };
          if (kind === "ARC" && a0 !== void 0 && a1 !== void 0) {
            [e.startAngle, e.endAngle] = flip ? dxfFlipArc(a0, a1) : [a0, a1];
          }
          if (ext === "tilted") e.tilted = true;
          if (lt && lt !== "BYLAYER") {
            if (lt !== "CONTINUOUS" && lt !== "BYBLOCK") e.linetype = lt;
          } else pending.push(e);
          if (col >= 1 && col <= 255) e.color = col;
          else if (col === 256) pendingCol.push(e);
          out.push(e);
          if (kind === "POLYLINE") openPoly = { e, mesh: (flags70 & (16 | 64)) !== 0, flip, pts: [] };
        }
      }
      if (kind === "LAYER" && tableName && tableLt) layerLt.set(tableName.toUpperCase(), tableLt.toUpperCase());
      if (kind === "LAYER" && tableName && tableCol) layerCol.set(tableName.toUpperCase(), Math.abs(tableCol));
      kind = "";
      layer = "";
      closed = false;
      flags70 = 0;
      radius = 0;
      a0 = void 0;
      a1 = void 0;
      lt = "";
      col = 256;
      tableName = "";
      tableLt = "";
      tableCol = 0;
      xs = [];
      ys = [];
      nx = 0;
      ny = 0;
      nz = 1;
    };
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number.parseInt((lines[i] ?? "").trim(), 10);
      const value = (lines[i + 1] ?? "").trim();
      if (Number.isNaN(code)) continue;
      if (code === 0) {
        flush();
        kind = value.toUpperCase();
        continue;
      }
      if (kind === "ARC" && code === 50) a0 = Number.parseFloat(value);
      if (kind === "ARC" && code === 51) a1 = Number.parseFloat(value);
      if (!kind) continue;
      if (kind === "LAYER") {
        if (code === 2) tableName = value;
        else if (code === 6) tableLt = value;
        else if (code === 62) tableCol = Number.parseInt(value, 10) || 0;
        continue;
      }
      switch (code) {
        case 6:
          lt = value.toUpperCase();
          break;
        case 8:
          layer = value;
          break;
        case 62: {
          const v = Number.parseInt(value, 10);
          if (Number.isFinite(v)) col = v;
          break;
        }
        case 10:
        case 11: {
          const v = Number(value);
          if (Number.isFinite(v)) xs.push(v);
          break;
        }
        case 20:
        case 21: {
          const v = Number(value);
          if (Number.isFinite(v)) ys.push(v);
          break;
        }
        case 40:
          radius = Number(value) || 0;
          break;
        case 70:
          closed = (Number(value) & 1) === 1;
          flags70 = Number.parseInt(value, 10) || 0;
          break;
        case 210:
          nx = Number(value);
          break;
        case 220:
          ny = Number(value);
          break;
        case 230:
          nz = Number(value);
          break;
        default:
          break;
      }
    }
    flush();
    closePoly();
    for (const e of pending) {
      const l = layerLt.get(e.layer.toUpperCase());
      if (l && l !== "CONTINUOUS") e.linetype = l;
    }
    for (const e of pendingCol) {
      const c = layerCol.get(e.layer.toUpperCase());
      if (c && c >= 1 && c <= 255) e.color = c;
    }
    return out;
  }
  function parseDxfDims(data) {
    const src = typeof data === "string" ? data : decode(data);
    if (src.startsWith("AutoCAD Binary DXF")) {
      throw new DxfError("バイナリ形式の DXF は未対応です。ASCII DXF で保存し直してください。");
    }
    const lines = src.split(/\r\n|\r|\n/);
    const out = [];
    let kind = "";
    let layer = "";
    let flags = Number.NaN;
    let text = "";
    let measured = Number.NaN;
    let rotation = 0;
    const pt = {};
    let nx = 0;
    let ny = 0;
    let nz = 1;
    const flush = () => {
      if (kind === "DIMENSION" && Number.isFinite(flags)) {
        const dimKind = flags & 7;
        const def = pt[10];
        const mid11 = pt[11];
        const dimExt = dxfExtrusionOf(nx, ny, nz);
        const mid2 = mid11 && dimExt === "flipped" ? [neg(mid11[0]), mid11[1]] : mid11;
        const rotDeg = dimExt === "flipped" ? 180 - rotation : rotation;
        const a = pt[13];
        const b = pt[14];
        const dim = {
          layer,
          kind: dimKind,
          x: (mid2 ?? def)?.[0] ?? 0,
          y: (mid2 ?? def)?.[1] ?? 0,
          text,
          ...Number.isFinite(measured) ? { measured } : {}
        };
        if (dimExt === "tilted") dim.tilted = true;
        if (a && b && (dimKind === 0 || dimKind === 1)) {
          dim.from = a;
          dim.to = b;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len2 = dimKind === 0 ? Math.abs(dx * Math.cos(rotDeg * Math.PI / 180) + dy * Math.sin(rotDeg * Math.PI / 180)) : Math.hypot(dx, dy);
          dim.length = len2;
          if (Number.isFinite(measured) && len2 > 0) dim.factor = measured / len2;
        }
        out.push(dim);
      }
      kind = "";
      layer = "";
      flags = Number.NaN;
      text = "";
      measured = Number.NaN;
      rotation = 0;
      for (const k of Object.keys(pt)) delete pt[Number(k)];
      nx = 0;
      ny = 0;
      nz = 1;
    };
    let pendingX = {};
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number.parseInt((lines[i] ?? "").trim(), 10);
      const raw = lines[i + 1] ?? "";
      const value = raw.trim();
      if (Number.isNaN(code)) continue;
      if (code === 0) {
        flush();
        pendingX = {};
        kind = value.toUpperCase();
        continue;
      }
      if (kind !== "DIMENSION") continue;
      if (code === 10 || code === 11 || code === 13 || code === 14) {
        const v = Number(value);
        if (Number.isFinite(v)) pendingX[code] = v;
        continue;
      }
      if (code === 20 || code === 21 || code === 23 || code === 24) {
        const base = code - 10;
        const x = pendingX[base];
        const v = Number(value);
        if (x !== void 0 && Number.isFinite(v)) pt[base] = [x, v];
        continue;
      }
      switch (code) {
        case 8:
          layer = value;
          break;
        case 210:
          nx = Number(value);
          break;
        case 220:
          ny = Number(value);
          break;
        case 230:
          nz = Number(value);
          break;
        case 70:
          flags = Number.parseInt(value, 10);
          break;
        case 42:
          measured = Number(value);
          break;
        case 50:
          rotation = Number(value) || 0;
          break;
        case 1:
          text = raw.trim();
          break;
        default:
          break;
      }
    }
    flush();
    return out;
  }
  function dxfDimScale(dims, digits = 4) {
    const counts = /* @__PURE__ */ new Map();
    let total = 0;
    for (const d of dims) {
      if (d.factor === void 0 || !Number.isFinite(d.factor)) continue;
      const key = Math.round(d.factor * 10 ** digits) / 10 ** digits;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total++;
    }
    if (total === 0) return void 0;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const [factor, agreed] = sorted[0];
    return {
      factor,
      agreed,
      total,
      others: sorted.slice(1).map(([f, c]) => ({ factor: f, count: c }))
    };
  }
  function parseDxfLines3d(data) {
    const src = typeof data === "string" ? data : decode(data);
    if (src.startsWith("AutoCAD Binary DXF")) {
      throw new DxfError("バイナリ形式の DXF は未対応です。ASCII DXF で保存し直してください。");
    }
    const lines = src.split(/\r\n|\r|\n/);
    const out = [];
    let kind = "";
    let layer = "";
    let flags = 0;
    let radius = 0;
    let a0;
    let a1;
    let elev = 0;
    let x0 = Number.NaN;
    let y0 = Number.NaN;
    let z0 = 0;
    let x1 = Number.NaN;
    let y1 = Number.NaN;
    let z1 = 0;
    let bulge = 0;
    let nx = 0;
    let ny = 0;
    let nz = 1;
    let lx = [];
    let ly = [];
    let lb = [];
    let poly = null;
    let section = "";
    let sawSection = false;
    let expectSectionName = false;
    const inEntities = () => section === "ENTITIES" || !sawSection;
    const emit = (e) => {
      out.push({ ...e, hasZ: e.zs.some((z) => z !== 0) });
    };
    const finish = () => {
      if (!inEntities()) return;
      const ext = dxfExtrusionOf(nx, ny, nz);
      const flip = ext === "flipped";
      const tag = ext === "tilted" ? { tilted: true } : {};
      switch (kind) {
        case "LINE":
          if ([x0, y0, x1, y1].every(Number.isFinite)) {
            emit({
              kind: "LINE",
              layer,
              points: [
                [x0, y0],
                [x1, y1]
              ],
              zs: [z0, z1],
              bulges: [0, 0],
              closed: false,
              radius: 0
            });
          }
          break;
        case "LWPOLYLINE": {
          const n = Math.min(lx.length, ly.length);
          if (n >= 2) {
            const points = [];
            for (let i = 0; i < n; i++)
              points.push([flip ? neg(lx[i]) : lx[i], ly[i]]);
            emit({
              kind: "LWPOLYLINE",
              layer,
              points,
              zs: points.map(() => flip ? neg(elev) : elev),
              bulges: points.map((_, i) => flip ? neg(lb[i] ?? 0) : lb[i] ?? 0),
              closed: (flags & 1) === 1,
              radius: 0,
              ...tag
            });
          }
          break;
        }
        case "POLYLINE": {
          const pe = (flags & 8) === 8 ? "plan" : ext;
          const h = Number.isFinite(z0) ? z0 : 0;
          poly = (flags & 64) === 0 && (flags & 16) === 0 ? { layer, flags, elev: pe === "flipped" ? neg(h) : h, ext: pe, xs: [], ys: [], zs: [], bs: [] } : null;
          break;
        }
        case "VERTEX":
          if (poly && (flags & 16) === 0 && Number.isFinite(x0) && Number.isFinite(y0)) {
            const pf = poly.ext === "flipped";
            poly.xs.push(pf ? neg(x0) : x0);
            poly.ys.push(y0);
            poly.zs.push((poly.flags & 8) === 8 ? z0 : poly.elev);
            poly.bs.push((poly.flags & 8) === 8 ? 0 : pf ? neg(bulge) : bulge);
          }
          break;
        case "SEQEND":
          if (poly && poly.xs.length >= 2) {
            const p = poly;
            emit({
              kind: "POLYLINE",
              layer: p.layer,
              points: p.xs.map((x, i) => [x, p.ys[i]]),
              zs: p.zs,
              bulges: p.bs,
              closed: (p.flags & 1) === 1,
              radius: 0,
              ...p.ext === "tilted" ? { tilted: true } : {}
            });
          }
          poly = null;
          break;
        case "ARC":
        case "CIRCLE":
          if (Number.isFinite(x0) && Number.isFinite(y0) && radius > 0) {
            const e = {
              kind,
              layer,
              points: [[flip ? neg(x0) : x0, y0]],
              zs: [flip ? neg(z0) : z0],
              bulges: [0],
              closed: kind === "CIRCLE",
              radius,
              ...tag
            };
            if (kind === "ARC") {
              if (a0 === void 0 || a1 === void 0) break;
              [e.startAngle, e.endAngle] = flip ? dxfFlipArc(a0, a1) : [a0, a1];
            }
            emit(e);
          }
          break;
        default:
          break;
      }
    };
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number.parseInt((lines[i] ?? "").trim(), 10);
      const value = (lines[i + 1] ?? "").trim();
      if (Number.isNaN(code)) continue;
      if (code === 0) {
        finish();
        kind = value.toUpperCase();
        if (kind === "SECTION") {
          sawSection = true;
          expectSectionName = true;
        } else if (kind === "ENDSEC") {
          section = "";
          poly = null;
        }
        if (kind !== "VERTEX" && kind !== "SEQEND") poly = null;
        layer = "";
        flags = 0;
        radius = 0;
        a0 = void 0;
        a1 = void 0;
        elev = 0;
        x0 = Number.NaN;
        y0 = Number.NaN;
        z0 = 0;
        x1 = Number.NaN;
        y1 = Number.NaN;
        z1 = 0;
        bulge = 0;
        nx = 0;
        ny = 0;
        nz = 1;
        lx = [];
        ly = [];
        lb = [];
        continue;
      }
      if (expectSectionName && code === 2) {
        section = value.toUpperCase();
        expectSectionName = false;
        continue;
      }
      const v = Number(value);
      switch (code) {
        case 8:
          layer = value;
          break;
        case 10:
          if (kind === "LWPOLYLINE") {
            lx.push(v);
            lb.push(0);
          } else x0 = v;
          break;
        case 20:
          if (kind === "LWPOLYLINE") ly.push(v);
          else y0 = v;
          break;
        case 30:
          if (Number.isFinite(v)) z0 = v;
          break;
        case 11:
          x1 = v;
          break;
        case 21:
          y1 = v;
          break;
        case 31:
          if (Number.isFinite(v)) z1 = v;
          break;
        case 38:
          if (Number.isFinite(v)) elev = v;
          break;
        case 40:
          radius = Number.isFinite(v) ? v : 0;
          break;
        case 42:
          if (!Number.isFinite(v)) break;
          if (kind === "LWPOLYLINE") {
            if (lb.length > 0) lb[lb.length - 1] = v;
          } else bulge = v;
          break;
        case 50:
          if (Number.isFinite(v)) a0 = v;
          break;
        case 51:
          if (Number.isFinite(v)) a1 = v;
          break;
        case 70:
          flags = Number.parseInt(value, 10) || 0;
          break;
        case 210:
          nx = v;
          break;
        case 220:
          ny = v;
          break;
        case 230:
          nz = v;
          break;
        default:
          break;
      }
    }
    finish();
    return out;
  }

  // packages/modules-toplayout/src/naming.ts
  function makeName(index, opt) {
    const prefix = opt?.prefix ?? "";
    const start = opt?.start ?? 1;
    const pad = opt?.pad ?? 0;
    const num2 = String(start + index).padStart(pad, "0");
    const name = `${prefix}${num2}`;
    if (name.length > 16) throw new Error(`点名が 16 文字を超えます: ${name}`);
    return name;
  }

  // packages/modules-toplayout/src/arc.ts
  var EPS = 1e-6;
  var rad = (deg) => deg * Math.PI / 180;
  function sweepDeg(arc, closed) {
    if (closed) return 360;
    let s = (arc.endAngle - arc.startAngle) % 360;
    if (s <= EPS) s += 360;
    return s;
  }
  function ptAt(arc, aDeg) {
    const t = rad(arc.startAngle + aDeg);
    return [arc.center[0] + arc.radius * Math.cos(t), arc.center[1] + arc.radius * Math.sin(t)];
  }
  function offsetArc(arc, offset, side) {
    const r = side === "left" ? arc.radius - offset : arc.radius + offset;
    if (r <= EPS) throw new Error("逃げ寸法が半径以上です(中心側へは逃がせません)");
    return { center: arc.center, radius: r, startAngle: arc.startAngle, endAngle: arc.endAngle };
  }
  function tessellateArc(arc, closed = false) {
    const sw = sweepDeg(arc, closed);
    const n = Math.max(8, Math.ceil(sw / 5));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(ptAt(arc, sw * i / n));
    return out;
  }
  function pointsAlongArc(arc, pitch, closed, naming) {
    const sw = sweepDeg(arc, closed);
    const L = arc.radius * rad(sw);
    const raw = [];
    raw.push({ p: ptAt(arc, 0), kind: "vertex" });
    if (pitch > 0) {
      for (let t = pitch; t < L - EPS; t += pitch) {
        raw.push({ p: ptAt(arc, t / arc.radius * (180 / Math.PI)), kind: "pitch" });
      }
    }
    if (!closed) raw.push({ p: ptAt(arc, sw), kind: "vertex" });
    return raw.map((r, i) => ({ name: makeName(i, naming), x: r.p[0], y: r.p[1], kind: r.kind }));
  }
  function centerDistanceToOffset(arc, R) {
    if (!(R > EPS)) throw new Error("中心からの離れは 0 より大きく入れてください");
    const d = R - arc.radius;
    return { offset: Math.abs(d), side: d < 0 ? "left" : "right" };
  }

  // packages/modules-toplayout/src/csv.ts
  function formatCoord(v, decimals) {
    const r = Number(v.toFixed(decimals));
    return (Object.is(r, -0) ? 0 : r).toFixed(decimals);
  }
  function outputH(p, opt, scale) {
    if (p.h !== void 0) return p.h;
    const h = opt.h ?? 0;
    const hFrom = opt.hFrom ?? "z";
    if (hFrom === "const" || p.z === void 0) return h;
    return hFrom === "zPlus" ? p.z * scale + h : p.z * scale;
  }
  function toTopLayoutCsv(points, opt = {}) {
    const axis = opt.axis ?? "asDrawn";
    const scale = (opt.unit ?? "m") === "m" ? 1e-3 : 1;
    const decimals = opt.decimals ?? 3;
    const eol = opt.eol ?? "\r\n";
    const rows = points.map((p) => {
      const east = p.x * scale;
      const north = p.y * scale;
      const [X, Y] = axis === "northEast" ? [north, east] : [east, north];
      const H = outputH(p, opt, scale);
      return `${p.name},${formatCoord(X, decimals)},${formatCoord(Y, decimals)},${formatCoord(H, decimals)}`;
    });
    return rows.length ? `${rows.join(eol)}${eol}` : "";
  }

  // packages/modules-toplayout/src/drawingScale.ts
  var UNIT_MM = { mm: 1, cm: 10, m: 1e3 };
  function drawingFactor(unit, scaleDenominator) {
    if (!(scaleDenominator > 0) || !Number.isFinite(scaleDenominator)) {
      throw new Error(`縮尺の分母が正しくありません: ${scaleDenominator}`);
    }
    return UNIT_MM[unit] * scaleDenominator;
  }
  function scaleLine(line, k) {
    if (!(k > 0) || !Number.isFinite(k)) throw new Error(`倍率が正しくありません: ${k}`);
    const sp = (p) => [p[0] * k, p[1] * k];
    const out = { ...line, points: line.points.map(sp), draw: line.draw.map(sp) };
    if (line.zs) out.zs = line.zs.map((z) => z * k);
    if (line.arc) out.arc = { ...line.arc, center: sp(line.arc.center), radius: line.arc.radius * k };
    return out;
  }
  function insunitsOf(text) {
    const ln = text.split(/\r\n|\r|\n/);
    for (let i = 0; i + 3 < ln.length; i++) {
      if ((ln[i] ?? "").trim() === "9" && (ln[i + 1] ?? "").trim().toUpperCase() === "$INSUNITS") {
        const v = Number.parseInt((ln[i + 3] ?? "").trim(), 10);
        return v === 4 ? "mm" : v === 5 ? "cm" : v === 6 ? "m" : void 0;
      }
      if ((ln[i] ?? "").trim() === "2" && (ln[i + 1] ?? "").trim().toUpperCase() === "ENTITIES") break;
    }
    return void 0;
  }
  var COMMON_SCALES = [1, 50, 100, 200, 250, 300, 500, 1e3];
  function candidatesFromDimFactor(factor) {
    if (!(factor > 0) || !Number.isFinite(factor)) return [];
    const out = [];
    for (const dimUnit of ["mm", "m"]) {
      const real = factor * UNIT_MM[dimUnit];
      for (const scale of COMMON_SCALES) {
        for (const unit of ["mm", "cm", "m"]) {
          const f = UNIT_MM[unit] * scale;
          if (Math.abs(real - f) / f >= 5e-3) continue;
          if (out.some((c) => c.unit === unit && c.scale === scale)) continue;
          out.push({ unit, scale, dimUnit });
        }
      }
    }
    return out;
  }
  function dimFactorAgrees(factor, k) {
    if (!(factor > 0) || !(k > 0)) return true;
    return ["mm", "m"].some((u) => Math.abs(factor * UNIT_MM[u] - k) / k < 5e-3);
  }
  function calibrateScale(unit, currentDen, measuredMm, trueMm, preferUnit) {
    for (const [name, v] of [
      ["いまの縮尺の分母", currentDen],
      ["測った長さ", measuredMm],
      ["本当の長さ", trueMm]
    ]) {
      if (!(v > 0) || !Number.isFinite(v)) throw new Error(`${name}が正しくありません: ${v}`);
    }
    const TOL = 5e-4;
    const ratio = trueMm / measuredMm;
    const k = UNIT_MM[unit] * currentDen * ratio;
    const at11 = (u2) => Math.abs(k - UNIT_MM[u2]) / UNIT_MM[u2] < TOL;
    let u = unit;
    const headerFits = !!preferUnit && k / UNIT_MM[preferUnit] >= 1 - TOL;
    if (currentDen === 1) {
      if (preferUnit && at11(preferUnit)) return { unit: preferUnit, den: 1, snapped: true, ratio };
      if (headerFits && preferUnit) {
        u = preferUnit;
      } else {
        for (const c of ["mm", "m", "cm"]) {
          if (at11(c)) return { unit: c, den: 1, snapped: true, ratio };
        }
      }
    }
    let den = k / UNIT_MM[u];
    if (den < 1 - TOL && u !== "mm") {
      u = headerFits && preferUnit ? preferUnit : "mm";
      den = k / UNIT_MM[u];
    }
    for (const s of COMMON_SCALES) {
      if (Math.abs(den - s) / s < TOL) return { unit: u, den: s, snapped: true, ratio };
    }
    const near = COMMON_SCALES.find((s) => Math.abs(den - s) / s < 5e-3);
    const out = {
      unit: u,
      den: Number(den.toPrecision(9)),
      snapped: false,
      ratio
    };
    if (near !== void 0) out.near = near;
    return out;
  }

  // packages/modules-toplayout/src/tin.ts
  var EPS2 = 1e-6;
  function buildTin(input) {
    const pts = [];
    for (const p of input) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.h)) continue;
      if (!pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < EPS2)) pts.push(p);
    }
    if (pts.length < 3) return { pts, tris: [] };
    const n = pts.length;
    const cx = pts.reduce((a, p) => a + p.x, 0) / n;
    const cy = pts.reduce((a, p) => a + p.y, 0) / n;
    const P = pts.map((p) => [p.x - cx, p.y - cy]);
    let span = 0;
    for (const [x, y] of P) span = Math.max(span, Math.abs(x), Math.abs(y));
    span = span || 1;
    P.push([-30 * span, -30 * span], [30 * span, -30 * span], [0, 30 * span]);
    const circum = (a, b, c) => {
      const [ax, ay] = P[a];
      const [bx, by] = P[b];
      const [qx, qy] = P[c];
      const d = 2 * (ax * (by - qy) + bx * (qy - ay) + qx * (ay - by));
      if (Math.abs(d) < 1e-300) return { v: [a, b, c], cx: 0, cy: 0, r2: Number.POSITIVE_INFINITY };
      const a2 = ax * ax + ay * ay;
      const b2 = bx * bx + by * by;
      const c2 = qx * qx + qy * qy;
      const ux = (a2 * (by - qy) + b2 * (qy - ay) + c2 * (ay - by)) / d;
      const uy = (a2 * (qx - bx) + b2 * (ax - qx) + c2 * (bx - ax)) / d;
      return { v: [a, b, c], cx: ux, cy: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
    };
    let tris = [circum(n, n + 1, n + 2)];
    for (let i = 0; i < n; i++) {
      const [px, py] = P[i];
      const bad = [];
      const keep = [];
      for (const t of tris) {
        if ((px - t.cx) ** 2 + (py - t.cy) ** 2 < t.r2 * (1 + 1e-12)) bad.push(t);
        else keep.push(t);
      }
      const count = /* @__PURE__ */ new Map();
      const key = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
      const edges = [];
      for (const t of bad) {
        const [a, b, c] = t.v;
        for (const e of [
          [a, b],
          [b, c],
          [c, a]
        ]) {
          const k = key(e[0], e[1]);
          if (count.has(k)) count.delete(k);
          else count.set(k, e);
        }
      }
      for (const e of count.values()) edges.push(e);
      tris = keep;
      for (const [a, b] of edges) tris.push(circum(a, b, i));
    }
    const out = [];
    for (const t of tris) {
      if (t.v.some((k) => k >= n)) continue;
      const [a, b, c] = t.v;
      const [ax, ay] = P[a];
      const [bx, by] = P[b];
      const [qx, qy] = P[c];
      if (Math.abs((bx - ax) * (qy - ay) - (by - ay) * (qx - ax)) < 1e-12 * span * span) continue;
      out.push([a, b, c]);
    }
    return { pts, tris: out };
  }
  function tinHeight(tin, x, y) {
    if (tin.tris.length === 0) return void 0;
    for (const [a, b, c] of tin.tris) {
      const A = tin.pts[a];
      const B = tin.pts[b];
      const C = tin.pts[c];
      const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
      const w0 = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / d;
      const w1 = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / d;
      const w2 = 1 - w0 - w1;
      const tol = -1e-9;
      if (w0 >= tol && w1 >= tol && w2 >= tol) return w0 * A.h + w1 * B.h + w2 * C.h;
    }
    return void 0;
  }

  // packages/modules-toplayout/src/heights.ts
  function applyHeights(points, rule, scale, overrides) {
    const missing = [];
    const out = points.map((p) => {
      let h;
      switch (rule.kind) {
        case "zAbs":
          h = p.z === void 0 ? void 0 : p.z * scale;
          break;
        case "zRel":
          h = p.z === void 0 ? void 0 : p.z * scale + rule.base;
          break;
        case "slope":
          if (p.sta === void 0) h = void 0;
          else if (rule.h1 !== void 0 && rule.length)
            h = rule.h0 + (rule.h1 - rule.h0) * p.sta / rule.length;
          else h = rule.h0 + (rule.grade ?? 0) / 100 * p.sta * scale;
          break;
        case "points":
          h = tinHeight(rule.tin, p.x, p.y);
          break;
        case "const":
          h = rule.h;
          break;
      }
      const o = overrides?.[p.name];
      if (o !== void 0 && Number.isFinite(o)) h = o;
      const q = { ...p };
      if (h === void 0 || !Number.isFinite(h)) {
        missing.push(p.name);
        delete q.h;
      } else q.h = h;
      return q;
    });
    return { points: out, missing };
  }

  // packages/modules-toplayout/src/path.ts
  var EPS3 = 1e-6;
  var TWO_PI = Math.PI * 2;
  var dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  var mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  function segStart(s) {
    if (s.kind === "line") return s.a;
    return s.p0 ?? [s.c[0] + s.r * Math.cos(s.a0), s.c[1] + s.r * Math.sin(s.a0)];
  }
  function segEnd(s) {
    if (s.kind === "line") return s.b;
    if (s.p1) return s.p1;
    const t = s.a0 + s.sw;
    return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)];
  }
  var FLAT = 1e-6;
  var isFlatArc = (s) => s.kind === "arc" && Math.abs(s.sw) < FLAT && !!s.p0 && !!s.p1;
  function segLength(s) {
    if (s.kind === "line") return dist(s.a, s.b);
    if (isFlatArc(s)) return dist(s.p0, s.p1) * (1 + s.sw * s.sw / 24);
    return s.r * Math.abs(s.sw);
  }
  function segPointAt(s, f) {
    if (s.kind === "line") return [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f];
    if (f === 0) return segStart(s);
    if (f === 1) return segEnd(s);
    if (isFlatArc(s)) {
      const c = dist(s.p0, s.p1);
      const sag = c / 2 * Math.tan(Math.abs(s.sw) / 4) * 4 * f * (1 - f) * Math.sign(s.sw);
      const rx = (s.p1[1] - s.p0[1]) / c;
      const ry = -(s.p1[0] - s.p0[0]) / c;
      return [s.p0[0] + (s.p1[0] - s.p0[0]) * f + rx * sag, s.p0[1] + (s.p1[1] - s.p0[1]) * f + ry * sag];
    }
    const t = s.a0 + s.sw * f;
    return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)];
  }
  function bulgeToSeg(p1, p2, bulge, za = 0, zb = 0) {
    const c = dist(p1, p2);
    if (c < EPS3 || Math.abs(bulge) * c / 2 < EPS3) return { kind: "line", a: p1, b: p2, za, zb };
    const th = 4 * Math.atan(bulge);
    const m = mid(p1, p2);
    const nx = -(p2[1] - p1[1]) / c;
    const ny = (p2[0] - p1[0]) / c;
    const h = c / 2 / Math.tan(th / 2);
    const center = [m[0] + nx * h, m[1] + ny * h];
    const r = c / 2 / Math.abs(Math.sin(th / 2));
    const a0 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
    return { kind: "arc", c: center, r, a0, sw: th, za, zb, p0: p1, p1: p2 };
  }
  function segmentsFromBulges(points, bulges, closed, zs) {
    const n = points.length;
    const segCount = closed ? n : n - 1;
    const out = [];
    for (let i = 0; i < segCount; i++) {
      const a = points[i];
      const j = (i + 1) % n;
      const b = points[j];
      if (dist(a, b) < EPS3) continue;
      out.push(bulgeToSeg(a, b, bulges?.[i] ?? 0, zs?.[i] ?? 0, zs?.[j] ?? 0));
    }
    if (out.length === 0) throw new Error("線には長さのある辺が 1 つ以上必要です");
    return out;
  }
  function offsetSeg(s, d, side) {
    const sgn = side === "left" ? 1 : -1;
    if (s.kind === "line") {
      const L = dist(s.a, s.b);
      if (L < EPS3) throw new Error("長さ 0 の線分には法線が定義できません");
      const nx = -(s.b[1] - s.a[1]) / L * sgn;
      const ny = (s.b[0] - s.a[0]) / L * sgn;
      return {
        kind: "line",
        a: [s.a[0] + nx * d, s.a[1] + ny * d],
        b: [s.b[0] + nx * d, s.b[1] + ny * d],
        za: s.za,
        zb: s.zb
      };
    }
    const dr = -sgn * Math.sign(s.sw) * d;
    const r = s.r + dr;
    if (r <= EPS3) throw new Error("逃げ寸法が円弧の半径以上です(中心側へは逃がせません)");
    const move = (p) => {
      const ux = (p[0] - s.c[0]) / s.r;
      const uy = (p[1] - s.c[1]) / s.r;
      return [p[0] + ux * dr, p[1] + uy * dr];
    };
    return { ...s, r, p0: move(segStart(s)), p1: move(segEnd(s)) };
  }
  function lineCircle(a, b, c, r) {
    const L = dist(a, b);
    const dx = (b[0] - a[0]) / L;
    const dy = (b[1] - a[1]) / L;
    const fx = a[0] - c[0];
    const fy = a[1] - c[1];
    const t0 = -(fx * dx + fy * dy);
    const perp = Math.abs(fx * dy - fy * dx);
    const gap = r - perp;
    if (gap < 0) return [];
    const h = Math.sqrt(gap * (r + perp));
    const footX = a[0] + dx * t0;
    const footY = a[1] + dy * t0;
    return [
      [footX - dx * h, footY - dy * h],
      [footX + dx * h, footY + dy * h]
    ];
  }
  function circleCircle(c1, r1, c2, r2) {
    const d = dist(c1, c2);
    if (d < EPS3 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
    const a = ((r1 - r2) * (r1 + r2) + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, (r1 - a) * (r1 + a)));
    const ux = (c2[0] - c1[0]) / d;
    const uy = (c2[1] - c1[1]) / d;
    const px = c1[0] + ux * a;
    const py = c1[1] + uy * a;
    return [
      [px - uy * h, py + ux * h],
      [px + uy * h, py - ux * h]
    ];
  }
  function lineLine(a1, b1, a2, b2) {
    const d1x = b1[0] - a1[0];
    const d1y = b1[1] - a1[1];
    const d2x = b2[0] - a2[0];
    const d2y = b2[1] - a2[1];
    const den = d1x * d2y - d1y * d2x;
    const scale = Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y);
    if (Math.abs(den) < 1e-12 * scale) return [];
    const t = ((a2[0] - a1[0]) * d2y - (a2[1] - a1[1]) * d2x) / den;
    return [[a1[0] + d1x * t, a1[1] + d1y * t]];
  }
  function intersectSegs(p0, q0) {
    const chord = (s) => isFlatArc(s) ? { kind: "line", a: s.p0, b: s.p1, za: s.za, zb: s.zb } : s;
    const p = chord(p0);
    const q = chord(q0);
    if (p.kind === "line" && q.kind === "line") return lineLine(p.a, p.b, q.a, q.b);
    if (p.kind === "line" && q.kind === "arc") return lineCircle(p.a, p.b, q.c, q.r);
    if (p.kind === "arc" && q.kind === "line") return lineCircle(q.a, q.b, p.c, p.r);
    if (p.kind === "arc" && q.kind === "arc") return circleCircle(p.c, p.r, q.c, q.r);
    return [];
  }
  function retrim(s, start, end) {
    if (s.kind === "line") return { ...s, a: start, b: end };
    const a0 = Math.atan2(start[1] - s.c[1], start[0] - s.c[0]);
    const a1 = Math.atan2(end[1] - s.c[1], end[0] - s.c[0]);
    let sw = a1 - a0;
    sw -= TWO_PI * Math.round((sw - s.sw) / TWO_PI);
    return { ...s, a0, sw, p0: start, p1: end };
  }
  function joinTol(segs) {
    let m = 1;
    for (const s of segs) {
      for (const p of [segStart(s), segEnd(s)]) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]));
    }
    return EPS3 + 1e-10 * m;
  }
  function hasArcBulge(points, bulges, closed) {
    if (!bulges) return false;
    const n = points.length;
    const segCount = closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const c = dist(points[i], points[(i + 1) % n]);
      if (Math.abs(bulges[i] ?? 0) * c / 2 >= EPS3) return true;
    }
    return false;
  }
  function offsetPath(segs, d, side, closed) {
    const off = segs.map((s) => offsetSeg(s, d, side));
    const n = off.length;
    const tol = joinTol(off);
    const starts = off.map(segStart);
    const ends = off.map(segEnd);
    const joins = closed ? n : n - 1;
    for (let k = 0; k < joins; k++) {
      const i = k;
      const j = (k + 1) % n;
      const pe = segEnd(off[i]);
      const ns = segStart(off[j]);
      if (dist(pe, ns) <= tol) {
        const x = mid(pe, ns);
        ends[i] = x;
        starts[j] = x;
        continue;
      }
      const ref = mid(pe, ns);
      let best;
      for (const x of intersectSegs(off[i], off[j])) {
        if (!best || dist(x, ref) < dist(best, ref)) best = x;
      }
      if (best) {
        ends[i] = best;
        starts[j] = best;
      }
    }
    return off.map((s, i) => retrim(s, starts[i], ends[i]));
  }
  function cumLengths(segs) {
    const out = [0];
    for (const s of segs) out.push(out[out.length - 1] + segLength(s));
    return out;
  }
  function footFraction(orig, p) {
    if (orig.kind === "line") {
      const dx = orig.b[0] - orig.a[0];
      const dy = orig.b[1] - orig.a[1];
      const L2 = dx * dx + dy * dy;
      if (L2 === 0) return 0;
      const t = ((p[0] - orig.a[0]) * dx + (p[1] - orig.a[1]) * dy) / L2;
      return Math.min(1, Math.max(0, t));
    }
    if (Math.abs(orig.sw) < 1e-6 && orig.p0 && orig.p1) {
      return footFraction({ kind: "line", a: orig.p0, b: orig.p1, za: orig.za, zb: orig.zb }, p);
    }
    const ang = Math.atan2(p[1] - orig.c[1], p[0] - orig.c[0]);
    const sw = Math.abs(orig.sw);
    let d = orig.sw >= 0 ? ang - orig.a0 : orig.a0 - ang;
    d = (d % TWO_PI + TWO_PI) % TWO_PI;
    if (d <= sw) return sw > 0 ? d / sw : 0;
    return d - sw < TWO_PI - d ? 1 : 0;
  }
  function staZ(orig, cum, i, f) {
    const s = orig[i];
    return { sta: cum[i] + f * segLength(s), z: s.za + (s.zb - s.za) * f };
  }
  function pointsAlongPath(segs, pitch, closed, naming, withZ = false, orig) {
    const tol = joinTol(segs);
    const cum = orig ? cumLengths(orig) : void 0;
    const raw = [];
    const n = segs.length;
    const at = (i, f, p, kind) => {
      const s = segs[i];
      if (orig && cum) {
        const { sta, z } = staZ(orig, cum, i, f);
        raw.push({ p, z, sta, kind });
      } else raw.push({ p, z: s.za + (s.zb - s.za) * f, kind });
    };
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      at(i, 0, segStart(s), "vertex");
      if (pitch > 0) {
        const L = segLength(s);
        for (let t = pitch; t < L - EPS3; t += pitch) {
          const p = segPointAt(s, t / L);
          at(i, orig ? footFraction(orig[i], p) : t / L, p, "pitch");
        }
      }
      const last = i === n - 1;
      if (last && !closed) {
        at(i, 1, segEnd(s), "vertex");
      } else {
        const next = segs[(i + 1) % n];
        if (dist(segEnd(s), segStart(next)) > tol) at(i, 1, segEnd(s), "vertex");
      }
    }
    return raw.map((r, i) => {
      const lp = { name: makeName(i, naming), x: r.p[0], y: r.p[1], kind: r.kind };
      if (withZ) lp.z = r.z;
      if (r.sta !== void 0) lp.sta = r.sta;
      return lp;
    });
  }
  function annotateStations(points, orig) {
    const cum = cumLengths(orig);
    let i = -1;
    for (const p of points) {
      if (p.kind === "vertex") {
        if (i + 1 < orig.length) {
          i++;
          p.sta = cum[i];
        } else p.sta = cum[orig.length];
      } else {
        const k = Math.max(0, i);
        p.sta = staZ(orig, cum, k, footFraction(orig[k], [p.x, p.y])).sta;
      }
    }
  }
  function tessellatePath(segs, closed) {
    const out = [];
    const tol = joinTol(segs);
    segs.forEach((s, i) => {
      const st = segStart(s);
      const prev = out[out.length - 1];
      if (!prev || dist(prev, st) > tol) out.push(st);
      if (s.kind === "arc") {
        const n = Math.max(2, Math.ceil(Math.abs(s.sw * 180 / Math.PI) / 5));
        for (let k = 1; k <= n; k++) out.push(segPointAt(s, k / n));
      } else out.push(s.b);
      if (closed && i === segs.length - 1 && out.length > 1 && dist(out[out.length - 1], out[0]) <= tol) {
        out.pop();
      }
    });
    return out;
  }

  // packages/modules-toplayout/src/lineInfo.ts
  function lineInfo(line) {
    const closed = line.closed ?? false;
    if (line.arc) {
      const a = line.arc;
      const sw = sweepDeg(a, closed);
      const at = (deg) => {
        const t = (a.startAngle + deg) * Math.PI / 180;
        return [a.center[0] + a.radius * Math.cos(t), a.center[1] + a.radius * Math.sin(t)];
      };
      const length = a.radius * sw * Math.PI / 180;
      const vertices = closed ? [at(0)] : [at(0), at(sw)];
      const info2 = {
        vertices,
        center: a.center,
        edges: [{ from: 0, to: closed ? 0 : 1, length, radius: a.radius, mid: at(sw / 2) }],
        total: length
      };
      if (line.zs?.length) info2.zs = vertices.map(() => line.zs?.[0]);
      return info2;
    }
    const pts = line.points;
    const n = pts.length;
    const segCount = closed ? n : n - 1;
    const edges = [];
    let total = 0;
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % n;
      const a = pts[i];
      const b = pts[j];
      const s = bulgeToSeg(a, b, line.bulges?.[i] ?? 0);
      const length = segLength(s);
      if (length < 1e-9) continue;
      const e = { from: i, to: j, length, mid: segPointAt(s, 0.5) };
      if (s.kind === "arc") e.radius = s.r;
      edges.push(e);
      total += length;
    }
    const info = { vertices: pts.slice(), edges, total };
    if (line.zs?.length) info.zs = line.zs.slice();
    return info;
  }
  function toDisplay(p, axis, unit) {
    const k = unit === "m" ? 1e-3 : 1;
    return axis === "northEast" ? [p[1] * k, p[0] * k] : [p[0] * k, p[1] * k];
  }

  // packages/modules-toplayout/src/nigezumi.ts
  var EPS4 = 1e-6;
  var sub = (a, b) => ({ x: a[0] - b[0], y: a[1] - b[1] });
  var len = (v) => Math.hypot(v.x, v.y);
  function normal(a, b, side) {
    const d = sub(b, a);
    const L = len(d);
    if (L < EPS4) throw new Error("長さ 0 の線分には法線が定義できません");
    const nx = -d.y / L;
    const ny = d.x / L;
    return side === "left" ? { x: nx, y: ny } : { x: -nx, y: -ny };
  }
  function shift(p, n, dist2) {
    return [p[0] + n.x * dist2, p[1] + n.y * dist2];
  }
  function intersect(p1, d1, p2, d2) {
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 1e-12) return void 0;
    const t = ((p2[0] - p1[0]) * d2.y - (p2[1] - p1[1]) * d2.x) / denom;
    return [p1[0] + d1.x * t, p1[1] + d1.y * t];
  }
  function dedupe(points, closed) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (!last || len(sub(p, last)) >= EPS4) out.push(p);
    }
    if (closed && out.length >= 2) {
      const first = out[0];
      const last = out[out.length - 1];
      if (len(sub(first, last)) < EPS4) out.pop();
    }
    return out;
  }
  function offsetPolyline(input, offset, side, closed = false) {
    const pts = dedupe(input, closed);
    if (pts.length < 2) throw new Error("線には 2 点以上が必要です");
    const segCount = closed ? pts.length : pts.length - 1;
    const seg = [];
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const n = normal(a, b, side);
      seg.push({ p: shift(a, n, offset), d: sub(b, a) });
    }
    const out = [];
    if (!closed) {
      out.push(seg[0].p);
      for (let i = 1; i < pts.length - 1; i++) {
        const prev = seg[i - 1];
        const cur = seg[i];
        const x = intersect(prev.p, prev.d, cur.p, cur.d);
        out.push(x ?? shift(pts[i], normal(pts[i - 1], pts[i], side), offset));
      }
      const lastSeg = seg[seg.length - 1];
      const lastA = pts[pts.length - 2];
      const lastB = pts[pts.length - 1];
      out.push(shift(lastB, normal(lastA, lastB, side), offset));
      return out;
    }
    for (let i = 0; i < pts.length; i++) {
      const prev = seg[(i - 1 + segCount) % segCount];
      const cur = seg[i];
      const x = intersect(prev.p, prev.d, cur.p, cur.d);
      out.push(x ?? cur.p);
    }
    return out;
  }
  function pointsAlong(vertices, pitch, closed, naming) {
    const raw = [];
    const segCount = closed ? vertices.length : vertices.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      raw.push({ p: a, kind: "vertex" });
      if (pitch > 0) {
        const L = len(sub(b, a));
        const d = { x: (b[0] - a[0]) / L, y: (b[1] - a[1]) / L };
        for (let t = pitch; t < L - EPS4; t += pitch) {
          raw.push({ p: [a[0] + d.x * t, a[1] + d.y * t], kind: "pitch" });
        }
      }
    }
    if (!closed) raw.push({ p: vertices[vertices.length - 1], kind: "vertex" });
    return raw.map((r, i) => ({
      name: makeName(i, naming),
      x: r.p[0],
      y: r.p[1],
      kind: r.kind
    }));
  }
  function offsetOutline(line, offset, side) {
    const closed = line.closed ?? false;
    if (line.arc) return tessellateArc(offsetArc(line.arc, offset, side), closed);
    if (hasArcBulge(line.points, line.bulges, closed)) {
      const segs = segmentsFromBulges(line.points, line.bulges, closed);
      return tessellatePath(offsetPath(segs, offset, side, closed), closed);
    }
    return offsetPolyline(line.points, offset, side, closed);
  }
  function arcToSeg(arc, closed) {
    const a0 = arc.startAngle * Math.PI / 180;
    const sw = sweepDeg(arc, closed) * Math.PI / 180;
    return { kind: "arc", c: arc.center, r: arc.radius, a0, sw, za: 0, zb: 0 };
  }
  function nigezumi(input) {
    const closed = input.closed ?? false;
    const pitch = input.pitch ?? 0;
    if (input.arc) {
      const oa = offsetArc(input.arc, input.offset, input.side);
      const pts2 = pointsAlongArc(oa, pitch, closed, input.naming);
      annotateStations(pts2, [arcToSeg(input.arc, closed)]);
      const z = input.zs?.[0];
      if (z !== void 0) for (const p of pts2) p.z = z;
      return pts2;
    }
    if (hasArcBulge(input.points, input.bulges, closed) || input.zs) {
      const segs = segmentsFromBulges(input.points, input.bulges, closed, input.zs);
      const off = offsetPath(segs, input.offset, input.side, closed);
      return pointsAlongPath(off, pitch, closed, input.naming, input.zs !== void 0, segs);
    }
    const vertices = offsetPolyline(input.points, input.offset, input.side, closed);
    const pts = pointsAlong(vertices, pitch, closed, input.naming);
    annotateStations(pts, segmentsFromBulges(input.points, void 0, closed));
    return pts;
  }

  // packages/modules-toplayout/src/pointLines.ts
  var toPt = (r, o) => {
    const k = o.unit === "m" ? 1e3 : 1;
    return o.axis === "northEast" ? [r.Y * k, r.X * k] : [r.X * k, r.Y * k];
  };
  var EPS5 = 1e-6;
  function makeLine(name, rows, closed, o) {
    const pts = [];
    const names = [];
    const hs = [];
    for (const r of rows) {
      const p = toPt(r, o);
      const q = pts[pts.length - 1];
      if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < EPS5) continue;
      pts.push(p);
      names.push(r.name);
      hs.push(r.H);
    }
    if (closed && pts.length > 2) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS5) {
        pts.pop();
        names.pop();
        hs.pop();
      }
    }
    if (pts.length < 2) return void 0;
    const line = { name, points: pts, names, closed: closed && pts.length > 2 };
    if (hs.every((h) => h !== void 0) && hs.some((h) => h !== 0))
      line.zs = hs.map((h) => h * (o.unit === "m" ? 1e3 : 1));
    return line;
  }
  function isSimaText(fileName, text) {
    return /\.sima?$/i.test(fileName) || /^\s*(G00|Z00|A00|A99)\s*,/m.test(text);
  }
  function parseSimaParcels(text) {
    const out = [];
    let cur;
    for (const line of text.split(/\r\n|\r|\n/)) {
      const c = line.split(",").map((x) => x.trim());
      if (c[0] === "D00") {
        if (cur) out.push({ ...cur, open: true });
        cur = { name: c[2] || c[1] || `画地${out.length + 1}`, refs: [] };
      } else if (c[0] === "B01" && cur) {
        cur.refs.push({ no: c[1] ?? "", name: c[2] ?? "" });
      } else if (c[0] === "D99" && cur) {
        out.push(cur);
        cur = void 0;
      }
    }
    if (cur) out.push({ ...cur, open: true });
    return out;
  }
  function simaRowsByNo(text) {
    const m = /* @__PURE__ */ new Map();
    for (const line of text.split(/\r\n|\r|\n/)) {
      const c = line.split(",").map((x) => x.trim());
      if (c[0] !== "A01") continue;
      const X = Number(c[3]);
      const Y = Number(c[4]);
      if (c[3] === "" || c[4] === "" || !Number.isFinite(X) || !Number.isFinite(Y)) continue;
      const r = { name: c[2] ?? "", X, Y };
      const H = Number(c[5]);
      if ((c[5] ?? "") !== "" && Number.isFinite(H)) r.H = H;
      if (c[1]) m.set(`#${c[1]}`, r);
      if (r.name && !m.has(r.name)) m.set(r.name, r);
    }
    return m;
  }
  function linesFromPoints(rows, opt, simaText) {
    const lines = [];
    const missing = [];
    if (simaText !== void 0) {
      const byNo = simaRowsByNo(simaText);
      for (const pc of parseSimaParcels(simaText)) {
        const rs = [];
        let ok = true;
        for (const ref of pc.refs) {
          const r = (ref.no ? byNo.get(`#${ref.no}`) : void 0) ?? byNo.get(ref.name);
          if (pc.open || !r || ref.name && r.name && r.name !== ref.name) {
            ok = false;
            break;
          }
          rs.push(r);
        }
        const ln = ok ? makeLine(`画地 ${pc.name}`, rs, true, opt) : void 0;
        if (ln) lines.push(ln);
        else missing.push(pc.name);
      }
    }
    if (!lines.length) {
      const all = makeLine("全部の点を順に結んだ線", rows, !!opt.closeAll, opt);
      if (all) lines.push(all);
    }
    return { lines, missing };
  }

  // packages/modules-toplayout/src/profile.ts
  function profileSegments(points) {
    const pts = points.map((p, i) => ({ p, i })).sort((a, b) => a.p.sta - b.p.sta || a.i - b.i).map((x) => x.p);
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.h === void 0 || b.h === void 0 || !Number.isFinite(a.h) || !Number.isFinite(b.h)) continue;
      const length = b.sta - a.sta;
      const dh = b.h - a.h;
      const s = { from: a.name, to: b.name, length, dh };
      if (length > 0) s.grade = dh / length * 100;
      segs.push(s);
    }
    return { points: pts, segs };
  }

  // packages/modules-toplayout/src/sima.ts
  var fix = (v, d) => {
    const r = Number(v.toFixed(d));
    return (Object.is(r, -0) ? 0 : r).toFixed(d);
  };
  function toSima(points, opt = {}) {
    const scale = (opt.unit ?? "m") === "m" ? 1e-3 : 1;
    const d = opt.decimals ?? 3;
    const eol = opt.eol ?? "\r\n";
    const title = opt.title ?? "ECP-NIGEZUMI";
    const lines = [`G00,01,${title},`, "Z00,座標ﾃﾞｰﾀ,", "A00,"];
    points.forEach((p, i) => {
      const X = p.y * scale;
      const Y = p.x * scale;
      const H = outputH(p, opt, scale);
      lines.push(`A01,${i + 1},${p.name},${fix(X, d)},${fix(Y, d)},${fix(H, d)},`);
    });
    lines.push("A99,", "Z99,");
    return `${lines.join(eol)}${eol}`;
  }
  var SJIS = {
    座: [141, 192],
    標: [149, 87],
    ﾃ: [195],
    ﾞ: [222],
    ｰ: [176],
    ﾀ: [192]
  };
  function simaToSjis(text) {
    const out = [];
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if (c < 128) out.push(c);
      else if (SJIS[ch]) out.push(...SJIS[ch]);
      else throw new Error(`SIMA に書けない文字があります: 「${ch}」(点名・工事名は半角英数にしてください)`);
    }
    return Uint8Array.from(out);
  }
  var num = (s) => {
    if (s === void 0 || s.trim() === "") return void 0;
    const v = Number(s.trim());
    return Number.isFinite(v) ? v : void 0;
  };
  function parseSima(text) {
    const out = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      const c = line.split(",");
      if ((c[0] ?? "").trim() !== "A01") continue;
      const X = num(c[3]);
      const Y = num(c[4]);
      if (X === void 0 || Y === void 0) continue;
      const row = { name: (c[2] ?? "").trim(), X, Y };
      const H = num(c[5]);
      if (H !== void 0) row.H = H;
      out.push(row);
    }
    return out;
  }
  function parsePointCsv(text) {
    const out = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      const c = line.split(",");
      if (c.length < 3) continue;
      const X = num(c[1]);
      const Y = num(c[2]);
      if (X === void 0 || Y === void 0) continue;
      const row = { name: (c[0] ?? "").trim(), X, Y };
      const H = num(c[3]);
      if (H !== void 0) row.H = H;
      out.push(row);
    }
    return out;
  }
  function rowsToHeightPoints(rows, opt) {
    const k = opt.unit === "m" ? 1e3 : 1;
    const hs = opt.hScale ?? 1;
    const out = [];
    for (const r of rows) {
      if (r.H === void 0) continue;
      const [x, y] = opt.axis === "northEast" ? [r.Y, r.X] : [r.X, r.Y];
      out.push({ x: x * k, y: y * k, h: r.H * hs });
    }
    return out;
  }

  // packages/modules-toplayout/src/types.ts
  var TOPLAYOUT_SCHEMA_VERSION = 1;

  // packages/modules-toplayout/src/browser.ts
  function linesFromDxf(data, k = 1) {
    return linesFromDxfRaw(data).map((l) => k === 1 ? l : scaleLine(l, k));
  }
  function dxfScaleHints(data) {
    // Shift_JIS の DXF(脳みそバーンの保存・日本の CAD)でも画層名(「補助線」など)が化けないように(2026-11-19)
    const text = typeof data === "string" ? data : (() => { try { return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch (e) { return new TextDecoder("shift_jis").decode(data); } })();
    const out = { candidates: [] };
    const u = insunitsOf(text);
    if (u) out.insunits = u;
    try {
      const ds = dxfDimScale(parseDxfDims(data));
      if (ds) {
        out.dimFactor = ds.factor;
        out.dimAgreed = ds.agreed;
        out.dimTotal = ds.total;
        const cs = candidatesFromDimFactor(ds.factor);
        out.candidates = u ? [...cs.filter((c) => c.unit === u), ...cs.filter((c) => c.unit !== u)] : cs;
      }
    } catch {
    }
    return out;
  }
  function linesFromDxfRaw(data) {
    const out = [];
    let id = 0;
    for (const e of parseDxfLines3d(data)) {
      const zs = e.hasZ ? e.zs : void 0;
      if (e.kind === "ARC" || e.kind === "CIRCLE") {
        const closed = e.kind === "CIRCLE";
        const arc = {
          center: e.points[0],
          radius: e.radius,
          startAngle: closed ? 0 : e.startAngle,
          endAngle: closed ? 360 : e.endAngle
        };
        const pts = tessellateArc(arc, closed);
        const line2 = { id: id++, layer: e.layer, closed, points: pts, arc, draw: pts };
        if (zs) line2.zs = zs;
        if (e.tilted) line2.tilted = true;
        out.push(line2);
        continue;
      }
      if (e.points.length < 2) continue;
      const bulgy = hasArcBulge(e.points, e.bulges, e.closed);
      const line = { id: id++, layer: e.layer, closed: e.closed, points: e.points, draw: e.points };
      if (bulgy) {
        line.bulges = e.bulges;
        line.draw = tessellatePath(segmentsFromBulges(e.points, e.bulges, e.closed), e.closed);
      }
      if (zs) line.zs = zs;
      if (e.tilted) line.tilted = true;
      out.push(line);
    }
    return out;
  }
  function linesFromPointFile(text, sima, opt) {
    const rows = sima ? parseSima(text) : parsePointCsv(text);
    const o = sima ? { axis: "northEast", unit: "m", closeAll: opt.closeAll } : opt;
    const r = linesFromPoints(rows, o, sima ? text : void 0);
    const lines = r.lines.map((l, id) => {
      const line = { id, layer: l.name, closed: l.closed, points: l.points, draw: l.points };
      if (l.zs) line.zs = l.zs;
      return line;
    });
    return { lines, missing: r.missing, points: rows.length };
  }
  function textsFromDxf(data, k = 1) {
    try {
      return parseDxfTexts(data).filter((t) => t.text.trim() !== "").map((t) => {
        const o = { x: t.x * k, y: t.y * k, text: t.text, height: t.height * k };
        if (t.mirrored) o.mirrored = true;
        return o;
      });
    } catch {
      return [];
    }
  }
  function lineLength(line) {
    const segs = line.arc ? [arcToSeg(line.arc, line.closed)] : segmentsFromBulges(line.points, line.bulges, line.closed);
    return cumLengths(segs).at(-1);
  }
  var g = globalThis;
  g.TopLayout = {
    SCHEMA_VERSION: TOPLAYOUT_SCHEMA_VERSION,
    linesFromDxf,
    textsFromDxf,
    linesFromPointFile,
    profileSegments,
    isSimaText,
    lineInfo,
    toDisplay,
    formatCoord,
    dxfScaleHints,
    dimFactorAgrees,
    calibrateScale,
    drawingFactor,
    COMMON_SCALES,
    dxfTiltedNote,
    parseDxfEntities,
    parseDxfLines3d,
    offsetPolyline,
    pointsAlong,
    offsetArc,
    centerDistanceToOffset,
    pointsAlongArc,
    tessellateArc,
    segmentsFromBulges,
    offsetPath,
    pointsAlongPath,
    tessellatePath,
    offsetOutline,
    nigezumi,
    toTopLayoutCsv,
    toSima,
    simaToSjis,
    parseSima,
    parsePointCsv,
    rowsToHeightPoints,
    buildTin,
    tinHeight,
    applyHeights,
    lineLength
  };
})();
