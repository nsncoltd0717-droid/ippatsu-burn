// 写真ペン太郎 forWindows：パソコン用の2列の画面と「アプリの更新」
//   左＝工事写真の枠（ひな形と同じ「写真＋黒板の行」を1ページ3枚で並べる）
//   右＝パソコンの写真フォルダのツリーと、そのフォルダの写真の一覧
//   右の写真を左の枠へドラッグすると、その位置に貼る（ダブルクリックで最後に足す）。左の写真もドラッグで並べ替え。
// pen.html はさわらず、main.js が開くときに </body> の前へ差し込む。pen.html の関数・変数（ITEMS, CFG, TPL, addFiles,
// openItem, renderList, excelLines, sheetInfos, unzip など）をそのまま使う。
(function () {
  'use strict';
  if (!window.penApp || typeof ITEMS === 'undefined' || typeof renderList !== 'function') return;
  const PA = window.penApp, HAS_FS = !!PA.fs;
  const PER_PAGE = 3;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('pen.win.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pen.win.' + k, JSON.stringify(v)); } catch (e) { /* */ } },
  };
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const q = (s, el) => (el || document).querySelector(s);

  // ================= 窓どうしの知らせ合い（一覧の窓 ⇔ 編集の窓） =================
  // 写真を保存・削除したら、もう一方の窓に知らせて読み直してもらう（どちらも同じ IndexedDB を使っている）
  const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pen-sync') : null;
  const send = (m) => { try { bc && bc.postMessage(m); } catch (e) { /* */ } };
  for (const [k, t] of [['put', 'put'], ['del', 'del'], ['clear', 'clear']]) {
    const f = idb[k]; if (typeof f !== 'function') continue;
    idb[k] = function (x) { const r = f.apply(this, arguments); Promise.resolve(r).then(() => send({ t, id: x && x.id ? x.id : x })); return r; };
  }
  // ほかの窓で変わった写真を IndexedDB から読み直す。curId（編集中の写真）は持っている物を使う
  async function syncFromDb(curId) {
    let all = []; try { all = (await idb.all()) || []; } catch (e) { return false; }
    const byId = new Map(ITEMS.map((it) => [it.id, it]));
    const next = all.sort((a, b) => a.order - b.order).map((d) => {
      const it = byId.get(d.id);
      if (!it) return d;
      if (d.id !== curId) Object.assign(it, { order: d.order, blob: d.blob, w: d.w, h: d.h, state: d.state, thumb: d.thumb });
      else it.order = d.order;
      return it;
    });
    ITEMS.splice(0, ITEMS.length, ...next);
    return true;
  }
  const EDIT_ID = new URLSearchParams(location.search).get('edit');
  if (EDIT_ID) { editorMode(); return; }

  // ================= 編集の窓（pen.html?edit=写真のid） =================
  function editorMode() {
    document.documentElement.classList.add('pen-editor');
    document.title = '写真ペン太郎 - 編集';
    const back = q('#bBack');
    let curId = EDIT_ID, closing = false;
    const idxOf = (id) => ITEMS.findIndex((it) => it.id === id);
    const close = async () => { if (closing) return; closing = true; try { if (CUR >= 0) await leaveItem(false); } catch (e) { /* */ } window.close(); };
    if (back) { back.textContent = '✕ 閉じる'; back.title = '保存して編集の窓を閉じる'; back.onclick = close; }
    const origOpen = openItem;
    openItem = async function (i) { const r = await origOpen.apply(this, arguments); if (ITEMS[i]) { curId = ITEMS[i].id; send({ t: 'editing', id: curId }); } return r; };
    const fixTitle = () => { const i = idxOf(curId); if (i >= 0 && CUR >= 0) { CUR = i; q('#edTitle').textContent = `No.${i + 1} / ${ITEMS.length}`; q('#bPrev').disabled = i === 0; q('#bNext').disabled = i === ITEMS.length - 1; } };
    if (bc) bc.onmessage = async (ev) => {
      const m = ev.data || {};
      if (m.t === 'open' && m.id) { await syncFromDb(curId); const i = idxOf(m.id); if (i >= 0) openItem(i); if (PA.focusSelf) PA.focusSelf(); return; }
      if (m.t === 'clear' || (m.t === 'del' && m.id === curId)) { closing = true; window.close(); return; }
      if (m.t === 'put' || m.t === 'del') { await syncFromDb(curId); fixTitle(); }
    };
    // 窓の ✕ で閉じたときも、編集中の写真を残す
    window.addEventListener('beforeunload', () => { if (!closing && CUR >= 0 && ITEMS[CUR]) { try { ITEMS[CUR].state = JSON.parse(snap()); persistItem(ITEMS[CUR]); } catch (e) { /* */ } } });
    (async () => {
      for (let k = 0; k < 100 && idxOf(curId) < 0; k++) await new Promise((r) => setTimeout(r, 50));
      for (let k = 0; k < 50 && !TPL; k++) await new Promise((r) => setTimeout(r, 50));
      const i = idxOf(curId);
      if (i < 0) { alert('この写真は見つかりませんでした（消されたかもしれません）'); closing = true; window.close(); return; }
      openItem(i);
    })();
  }

  // ================= アプリの更新（ホーム画面のボタン） =================
  const hdr = q('header'), sp = hdr && q('.sp', hdr);
  if (hdr && PA.update) {
    const b = document.createElement('button');
    b.id = 'bUpd'; b.className = 'hm'; b.type = 'button'; b.textContent = '⟳ アプリの更新'; b.title = '公開ページから新しい版を取ってきて入れ替えます';
    hdr.insertBefore(b, sp ? sp.nextSibling : null);
    b.onclick = async () => {
      b.classList.add('busy'); b.textContent = '⟳ 確かめています…';
      try {
        const r = await PA.update();
        if (!r || !r.ok) { alert('更新できませんでした。\n' + ((r && r.error) || '')); return; }
        let msg = r.changed ? `新しい版を入れました（写真ペン太郎 v${r.before} → v${r.after}）。\n画面を読み込み直します。写真と設定はそのまま残ります。` : `いまの版が最新です（写真ペン太郎 v${r.after}）。`;
        if (r.shellNew) msg += `\n\nWindows版の本体にも新しい版（${r.shellNew}、いまは ${r.shell}）があります。\n共有ドライブ「Claude(一撃墨太郎)\\写真ペン太郎」のインストーラーで入れ直してください。`;
        alert(msg);
        if (r.changed) location.reload();
      } catch (e) { alert('更新できませんでした。\n' + e.message); }
      finally { b.classList.remove('busy'); b.textContent = '⟳ アプリの更新'; }
    };
  }

  // ================= 2列の画面を組み立てる =================
  const home = q('#home');
  const dk = document.createElement('div');
  dk.id = 'dk'; dk.className = 'hm';
  dk.innerHTML = `
  <div id="dkL">
    <div class="dkbar">
      <span class="ttl">工事写真</span>
      <button id="dkCfg" title="印刷（片面・両面）・工事名・黒板の項目・ひな形">⚙ 初期設定</button>
      <span id="dkMode" class="pg" style="min-width:0"></span>
      <span class="sp"></span>
      <button id="dkZo" title="ページを小さく">－</button><button id="dkZi" title="ページを大きく">＋</button>
      <button id="dkPrev" title="前のページ">◀</button><span class="pg" id="dkPg">1 / 1ページ</span><button id="dkNext" title="次のページ">▶</button>
      <span class="sp"></span>
      <button id="dkClear" title="写真を全部消す">全部消す</button>
      <button class="pri" id="dkXlsx">📊 Excelに書き出す</button>
    </div>
    <div id="dkPages"></div>
  </div>
  <div id="dkR">
    <div class="dkbar">
      <span class="ttl">元の写真</span>
      <button id="dkAddRoot" title="ツリーに写真のフォルダを足す">📁 フォルダを足す</button>
      <button id="dkReload" title="一覧を読み直す">↻</button>
      <span class="sp"></span>
      <button id="dkSmall" title="小さく">－</button><button id="dkBig" title="大きく">＋</button>
    </div>
    <div id="dkSrc"><div id="dkTree"></div><div id="dkThumbs"></div></div>
    <div class="dkbar"><span id="dkStat"></span><button id="dkPickFiles" title="ファイルを選んで最後に足す">🖼 ファイルから足す</button><button class="pri" id="dkAddSel" disabled>選んだ写真を足す</button></div>
  </div>`;
  home.parentNode.insertBefore(dk, home.nextSibling);
  const ROOTC = document.documentElement.classList;   // body の class は pen.html が書き換えるので html に付ける
  ROOTC.add('dk');

  // 初期設定は元の画面（#home）を左に出す
  const cfgBack = document.createElement('button');
  cfgBack.textContent = '← 写真の枠に戻る'; cfgBack.className = 'pri'; cfgBack.style.margin = '0 0 12px';
  home.insertBefore(cfgBack, home.firstChild);
  q('#dkCfg').onclick = () => ROOTC.add('dk-cfg');
  cfgBack.onclick = () => { ROOTC.remove('dk-cfg'); render(); };
  q('#dkXlsx').onclick = () => q('#bXlsx').click();
  q('#dkClear').onclick = () => q('#bClear').click();
  q('#dkPickFiles').onclick = () => q('#fPick').click();

  // ================= 編集を別の窓で開く =================
  // 本体が別の窓に対応していれば（0.4.0 から）別の窓、古い本体ならこの窓の中で編集する
  const SEPARATE = !!PA.editorWindow;
  let editorWin = null, editingId = '';
  function edit(i) {
    const it = ITEMS[i]; if (!it) return;
    lastOpened = i; markCur();
    if (!SEPARATE) return openItem(i);
    if (editorWin && !editorWin.closed) { send({ t: 'open', id: it.id }); return; }
    editorWin = window.open('pen.html?edit=' + encodeURIComponent(it.id), 'penEdit');
    if (!editorWin) openItem(i);
  }
  function markCur() { pagesEl.querySelectorAll('.dkslot').forEach((x) => x.classList.toggle('cur', +x.dataset.i === lastOpened && x.classList.contains('filled'))); }

  // ================= 左：ページ =================
  let slotLines = 7, curPage = 0, lastOpened = -1;
  async function readTplLines() {
    try {
      const info = sheetInfos(await unzip(TPL.buf.slice(0)));
      const want = CFG.mode === 'double' ? '両面' : '片面';
      const s = info.find((x) => x.name.includes(want)) || info.find((x) => x.blocks.length);
      if (s && s.blocks[0]) slotLines = s.blocks[0].slots.length || slotLines;
    } catch (e) { /* ひな形がまだ読めていない */ }
  }
  const pagesEl = q('#dkPages');
  function pageCount() { return Math.max(1, Math.ceil((ITEMS.length + 1) / PER_PAGE)); }
  function render() {
    const n = pageCount(), mode = CFG.mode === 'double' ? '両面' : '片面';
    q('#dkMode').textContent = `${mode}印刷・${ITEMS.length}枚`;
    let html = '';
    for (let p = 0; p < n; p++) {
      html += `<div class="dkpage" data-p="${p}">`;
      for (let k = 0; k < PER_PAGE; k++) {
        const i = p * PER_PAGE + k, it = ITEMS[i];
        if (it) {
          const ls = excelLines(it.state);
          const rows = [];
          for (let r = 0; r < slotLines; r++) rows.push(`<div>${h(ls[r] || '')}</div>`);
          const more = ls.length > slotLines ? `<div class="more">ほか${ls.length - slotLines}行は枠に入りません</div>` : '';
          html += `<div class="dkslot filled${i === lastOpened ? ' cur' : ''}" data-i="${i}" draggable="true">
            <div class="ph" data-act="open" title="ダブルクリックで編集"><img src="${it.thumb}" alt=""><span class="no">No.${i + 1}</span></div>
            <div class="ops"><button data-act="open">✎ 編集</button><button data-act="del">🗑</button></div>
            <div class="tx" data-act="open">${rows.join('')}${more}</div></div>`;
        } else {
          const first = i === ITEMS.length;
          html += `<div class="dkslot" data-i="${ITEMS.length}">
            <div class="ph"><div class="empty">${first ? '右の写真を<br>ここへドラッグ' : ''}</div></div>
            <div class="tx">${'<div></div>'.repeat(slotLines)}</div></div>`;
        }
      }
      html += `<span class="side">${CFG.mode === 'double' ? (p % 2 ? '裏' : '表') : ''}</span><span class="pno">${p + 1}</span></div>`;
    }
    pagesEl.innerHTML = html;
    updPage();
    markUsed();
  }
  function updPage() {
    const n = pageCount(), pgs = pagesEl.children; if (!pgs.length) return;
    const top = pagesEl.scrollTop + pagesEl.clientHeight * 0.3;
    curPage = 0; for (let p = 0; p < pgs.length; p++) if (pgs[p].offsetTop - pagesEl.offsetTop <= top) curPage = p;
    q('#dkPg').textContent = `${curPage + 1} / ${n}ページ`;
    q('#dkPrev').disabled = curPage <= 0; q('#dkNext').disabled = curPage >= n - 1;
  }
  function goPage(p) { const el = pagesEl.children[p]; if (el) pagesEl.scrollTo({ top: el.offsetTop - pagesEl.offsetTop - 12, behavior: 'smooth' }); }
  pagesEl.addEventListener('scroll', () => requestAnimationFrame(updPage));
  let zoom = LS.get('zoom', 1); pagesEl.style.setProperty('--z', zoom);
  const setZoom = (z) => { zoom = Math.max(0.6, Math.min(2.5, z)); pagesEl.style.setProperty('--z', zoom); LS.set('zoom', zoom); requestAnimationFrame(updPage); };
  q('#dkZo').onclick = () => setZoom(zoom / 1.2);
  q('#dkZi').onclick = () => setZoom(zoom * 1.2);
  pagesEl.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
  q('#dkPrev').onclick = () => goPage(curPage - 1);
  q('#dkNext').onclick = () => goPage(curPage + 1);

  pagesEl.addEventListener('dblclick', (e) => {
    const s = e.target.closest('.dkslot.filled'); if (s) edit(+s.dataset.i);
  });
  pagesEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'), s = e.target.closest('.dkslot'); if (!b || !s || !s.classList.contains('filled')) return;
    const i = +s.dataset.i;
    if (b.dataset.act === 'open' && b.tagName === 'BUTTON') edit(i);
    else if (b.dataset.act === 'open') { pagesEl.querySelectorAll('.dkslot.cur').forEach((x) => x.classList.remove('cur')); s.classList.add('cur'); lastOpened = i; }
    else if (b.dataset.act === 'del') {
      if (!confirm(`No.${i + 1} を消しますか？`)) return;
      const [it] = ITEMS.splice(i, 1); idb.del(it.id); forgetUsed(it.id); renumber(); renderList();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('home') || ROOTC.contains('dk-cfg')) return;
    if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
    if (e.key === 'Enter' && lastOpened >= 0 && ITEMS[lastOpened]) { e.preventDefault(); edit(lastOpened); }
    if (e.key === 'PageDown') { e.preventDefault(); goPage(curPage + 1); }
    if (e.key === 'PageUp') { e.preventDefault(); goPage(curPage - 1); }
  });

  // ---- ドラッグ：左の並べ替え／右から貼る／エクスプローラーから貼る ----
  const T_ITEM = 'application/x-pen-item', T_PATHS = 'application/x-pen-paths';
  let dragFrom = -1;
  pagesEl.addEventListener('dragstart', (e) => {
    const s = e.target.closest('.dkslot.filled'); if (!s) return;
    dragFrom = +s.dataset.i; e.dataTransfer.setData(T_ITEM, String(dragFrom)); e.dataTransfer.effectAllowed = 'move';
    s.classList.add('dragging');
  });
  pagesEl.addEventListener('dragend', () => { dragFrom = -1; pagesEl.querySelectorAll('.dragging,.drop').forEach((x) => x.classList.remove('dragging', 'drop')); });
  pagesEl.addEventListener('dragover', (e) => {
    const s = e.target.closest('.dkslot'); if (!s) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(T_ITEM) ? 'move' : 'copy';
    pagesEl.querySelectorAll('.drop').forEach((x) => x !== s && x.classList.remove('drop')); s.classList.add('drop');
  });
  pagesEl.addEventListener('dragleave', (e) => { const s = e.target.closest('.dkslot'); if (s && !s.contains(e.relatedTarget)) s.classList.remove('drop'); });
  pagesEl.addEventListener('drop', async (e) => {
    const s = e.target.closest('.dkslot'); if (!s) return;
    e.preventDefault(); e.stopPropagation(); s.classList.remove('drop');
    const at = Math.min(+s.dataset.i, ITEMS.length), dt = e.dataTransfer;
    if (dt.types.includes(T_ITEM)) {
      const from = +dt.getData(T_ITEM); if (!(from >= 0) || from === at) return;
      const [it] = ITEMS.splice(from, 1); const to = from < at ? at - 1 : at; ITEMS.splice(Math.min(to, ITEMS.length), 0, it);
      lastOpened = Math.min(to, ITEMS.length - 1); renumber(); renderList(); return;
    }
    if (dt.types.includes(T_PATHS)) { let ps = []; try { ps = JSON.parse(dt.getData(T_PATHS)); } catch (err) { /* */ } return addPaths(ps, at); }
    if (dt.files && dt.files.length) return addAt([...dt.files], at, []);
  });

  // 写真を at 番目に貼る。pen.html の addFiles は最後に足すので、足したあとで動かす
  async function addAt(files, at, paths) {
    const before = ITEMS.length;
    await addFiles(files);
    const added = ITEMS.splice(before);
    if (!added.length) return;
    if (paths && paths.length === added.length) added.forEach((it, k) => rememberUsed(paths[k], it.id));
    ITEMS.splice(Math.min(at, ITEMS.length), 0, ...added);
    lastOpened = Math.min(at, ITEMS.length - 1);
    renumber(); renderList();
    goPage(Math.floor((Math.min(at, ITEMS.length - 1)) / PER_PAGE));
  }
  async function addPaths(paths, at) {
    if (!HAS_FS || !paths.length) return;
    const files = [], ok = [];
    for (const p of paths) {
      try { const r = await PA.fs.read(p); files.push(new File([r.data], r.name, { type: /\.png$/i.test(r.name) ? 'image/png' : /\.webp$/i.test(r.name) ? 'image/webp' : 'image/jpeg', lastModified: r.mtime })); ok.push(p); }
      catch (e) { toast(`${p} を読めませんでした`, 3000); }
    }
    await addAt(files, at == null ? ITEMS.length : at, ok);
  }

  // ---- 使った写真の印（元の写真のパス → 貼った写真の id） ----
  let used = LS.get('used', {});
  function rememberUsed(p, id) { used[p] = id; LS.set('used', used); }
  function forgetUsed(id) { for (const k of Object.keys(used)) if (used[k] === id) delete used[k]; LS.set('used', used); }
  function isUsed(p) { const id = used[p]; return !!id && ITEMS.some((it) => it.id === id); }
  function markUsed() { thumbsEl.querySelectorAll('.dkth').forEach((el) => { const u = isUsed(el.dataset.p); const b = q('.used', el); if (u && !b) el.insertAdjacentHTML('beforeend', '<span class="used">貼付済</span>'); if (!u && b) b.remove(); }); }

  // ================= 右：フォルダのツリー =================
  const treeEl = q('#dkTree'), thumbsEl = q('#dkThumbs');
  let roots = LS.get('roots', []), curDir = LS.get('dir', ''), open = new Set(LS.get('open', []));
  let homeDirs = [];
  const base = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  const join = (d, n) => (/[\\/]$/.test(d) ? d + n : d + (d.includes('\\') ? '\\' : '/') + n);

  async function nodeHtml(p, name, depth, isRoot, rm) {
    const isOpen = open.has(p);
    let sub = '';
    if (isOpen) {
      try { const r = await PA.fs.list(p); for (const d of r.dirs) sub += await nodeHtml(join(p, d), d, depth + 1, false, false); }
      catch (e) { sub = `<div class="sec">開けません</div>`; }
    }
    return `<div class="${isRoot ? 'root' : ''}"><div class="nd${p === curDir ? ' on' : ''}" data-p="${h(p)}" title="${h(p)}">
      <span class="tw" data-act="tw">${isOpen ? '▼' : '▶'}</span><span class="ic">${isRoot ? '📁' : '📂'}</span><span class="nm">${h(name)}</span>${rm ? '<span class="rm" data-act="rm" title="ツリーから外す（フォルダは消えません）">✕</span>' : ''}</div>
      ${isOpen ? `<div class="sub">${sub}</div>` : ''}</div>`;
  }
  async function renderTree() {
    if (!HAS_FS) { treeEl.innerHTML = '<div class="sec">この版ではフォルダを見られません</div>'; return; }
    let html = '';
    if (roots.length) { html += '<div class="sec">足したフォルダ</div>'; for (const r of roots) html += await nodeHtml(r, base(r), 0, true, true); }
    html += '<div class="sec">このパソコン</div>';
    for (const d of homeDirs) html += await nodeHtml(d.path, d.name, 0, true, false);
    const st = treeEl.scrollTop; treeEl.innerHTML = html; treeEl.scrollTop = st;
  }
  treeEl.addEventListener('click', async (e) => {
    const nd = e.target.closest('.nd'); if (!nd) return;
    const p = nd.dataset.p, act = (e.target.closest('[data-act]') || {}).dataset;
    if (act && act.act === 'rm') { roots = roots.filter((r) => r !== p); LS.set('roots', roots); return renderTree(); }
    if (act && act.act === 'tw') { open.has(p) ? open.delete(p) : open.add(p); LS.set('open', [...open]); return renderTree(); }
    setDir(p);
  });
  treeEl.addEventListener('dblclick', (e) => { const nd = e.target.closest('.nd'); if (!nd) return; const p = nd.dataset.p; open.has(p) ? open.delete(p) : open.add(p); LS.set('open', [...open]); renderTree(); });
  q('#dkAddRoot').onclick = async () => {
    const p = await PA.fs.pickDir(); if (!p) return;
    if (!roots.includes(p)) { roots.push(p); LS.set('roots', roots); }
    open.add(p); LS.set('open', [...open]); await setDir(p);
  };
  q('#dkReload').onclick = async () => { await renderTree(); if (curDir) await listThumbs(curDir); };

  // ================= 右：写真の一覧 =================
  let files = [], sel = new Set(), anchor = -1, tw = LS.get('tw', 150);
  thumbsEl.style.setProperty('--tw', tw + 'px');
  q('#dkSmall').onclick = () => { tw = Math.max(90, tw - 30); thumbsEl.style.setProperty('--tw', tw + 'px'); LS.set('tw', tw); };
  q('#dkBig').onclick = () => { tw = Math.min(320, tw + 30); thumbsEl.style.setProperty('--tw', tw + 'px'); LS.set('tw', tw); };

  async function setDir(p) {
    curDir = p; LS.set('dir', p);
    treeEl.querySelectorAll('.nd.on').forEach((x) => x.classList.remove('on'));
    const nd = [...treeEl.querySelectorAll('.nd')].find((x) => x.dataset.p === p); if (nd) nd.classList.add('on'); else renderTree();
    await listThumbs(p);
  }
  let listSeq = 0;
  async function listThumbs(p) {
    const seq = ++listSeq;
    sel.clear(); anchor = -1; updSel();
    thumbsEl.innerHTML = '<div class="msg">読み込み中…</div>';
    let r; try { r = await PA.fs.list(p); } catch (e) { thumbsEl.innerHTML = `<div class="msg">このフォルダは開けません<br>${h(p)}</div>`; return; }
    if (seq !== listSeq) return;
    files = r.files;
    if (!files.length) { thumbsEl.innerHTML = `<div class="msg">このフォルダに写真（JPEG・PNG）はありません。${r.dirs.length ? '<br>左のツリーで中のフォルダを開いてください。' : ''}</div>`; q('#dkStat').textContent = h(p); return; }
    thumbsEl.innerHTML = files.map((f, k) => `<div class="dkth" draggable="true" data-k="${k}" data-p="${h(f.path)}" title="${h(f.name)}\n${new Date(f.mtime).toLocaleString('ja-JP')}"><div class="im"></div><div class="nm">${h(f.name)}</div></div>`).join('');
    markUsed(); updSel();
    thumbsEl.querySelectorAll('.dkth').forEach((el) => io.observe(el));
  }
  // 見えている所から小さい画像を作る（同時に4枚まで）
  const queue = []; let running = 0;
  const io = new IntersectionObserver((ents) => { for (const en of ents) if (en.isIntersecting) { io.unobserve(en.target); queue.push(en.target); pump(); } }, { root: thumbsEl, rootMargin: '300px' });
  function pump() {
    while (running < 4 && queue.length) {
      const el = queue.shift(); if (!el.isConnected) continue; running++;
      PA.fs.thumb(el.dataset.p).then((u) => { const im = q('.im', el); if (im) im.innerHTML = u ? `<img src="${u}" alt="">` : '<span style="color:#888;font-size:11px">読めません</span>'; })
        .finally(() => { running--; pump(); });
    }
  }
  function updSel() {
    thumbsEl.querySelectorAll('.dkth').forEach((el) => el.classList.toggle('sel', sel.has(+el.dataset.k)));
    q('#dkAddSel').disabled = !sel.size;
    q('#dkAddSel').textContent = sel.size ? `選んだ ${sel.size}枚を足す` : '選んだ写真を足す';
    q('#dkStat').textContent = files.length ? `${files.length}枚の写真${sel.size ? `（${sel.size}枚を選択）` : ''}（Ctrl/Shiftで複数選択・左の枠へドラッグ）` : '';
  }
  thumbsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.dkth'); if (!el) return; const k = +el.dataset.k;
    if (e.shiftKey && anchor >= 0) { const [a, b] = [Math.min(anchor, k), Math.max(anchor, k)]; if (!e.ctrlKey) sel.clear(); for (let i = a; i <= b; i++) sel.add(i); }
    else if (e.ctrlKey) { sel.has(k) ? sel.delete(k) : sel.add(k); anchor = k; }
    else { sel.clear(); sel.add(k); anchor = k; }
    updSel();
  });
  thumbsEl.addEventListener('dblclick', (e) => { const el = e.target.closest('.dkth'); if (el) addPaths([el.dataset.p], ITEMS.length); });
  thumbsEl.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.dkth'); if (!el) return; const k = +el.dataset.k;
    if (!sel.has(k)) { sel.clear(); sel.add(k); anchor = k; updSel(); }
    const ps = [...sel].sort((a, b) => a - b).map((i) => files[i].path);
    e.dataTransfer.setData(T_PATHS, JSON.stringify(ps)); e.dataTransfer.effectAllowed = 'copy';
    const img = q('img', el); if (img) e.dataTransfer.setDragImage(img, 30, 30);
  });
  q('#dkAddSel').onclick = () => addPaths([...sel].sort((a, b) => a - b).map((i) => files[i].path), ITEMS.length);
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('home') || !files.length) return;
    if (e.ctrlKey && e.key === 'a' && thumbsEl.matches(':hover')) { e.preventDefault(); files.forEach((f, i) => sel.add(i)); updSel(); }
  });

  // ================= pen.html の一覧と連動 =================
  const origRender = renderList;
  // eslint-disable-next-line no-global-assign
  renderList = function () {
    const r = origRender.apply(this, arguments); render();
    if (lastOpened >= 0) { const el = pagesEl.querySelector(`.dkslot[data-i="${lastOpened}"]`); if (el) el.scrollIntoView({ block: 'center' }); }
    return r;
  };
  // 編集画面の ◀▶ で別の写真に移ったら、戻ったときはその写真を選んでおく
  const origOpen = openItem;
  openItem = function (i) { lastOpened = i; return origOpen.apply(this, arguments); };
  const origSave = saveCfg;
  // 初期設定（片面/両面・黒板の行数）が変わったら枠の行数も読み直す
  saveCfg = function () { const r = origSave.apply(this, arguments); readTplLines().then(render); return r; };

  if (bc) bc.onmessage = async (ev) => {
    const m = ev.data || {};
    if (m.t === 'editing' && m.id) { const i = ITEMS.findIndex((it) => it.id === m.id); if (i >= 0) { lastOpened = i; markCur(); } return; }
    if (m.t === 'put' || m.t === 'del' || m.t === 'clear') {
      if (CUR >= 0) return;   // この窓で編集中なら、戻ったときに読み直す
      const keep = pagesEl.scrollTop;
      if (await syncFromDb('')) { origRender(); render(); pagesEl.scrollTop = keep; }
    }
  };

  (async () => {
    for (let k = 0; k < 50 && !TPL; k++) await new Promise((r) => setTimeout(r, 100));
    await readTplLines();
    render();
    if (HAS_FS) {
      try { homeDirs = await PA.fs.homeDirs(); } catch (e) { homeDirs = []; }
      await renderTree();
      if (curDir) listThumbs(curDir); else thumbsEl.innerHTML = '<div class="msg">左のツリーで写真のフォルダを選んでください。<br>よく使うフォルダは「📁 フォルダを足す」で上に出しておけます。</div>';
    }
  })();
})();
