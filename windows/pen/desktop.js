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

  // ================= 現場ごとの写真帳 =================
  // 一発バーンの「いまの現場」（Genba）ごとに、写真と初期設定（工事名・黒板の項目など）を分けて持つ。
  // pen.html は写真を IndexedDB「sp-album」、設定を localStorage「sp.cfg」に1組だけ持つので、
  // 現場が替わったら、今の組を IndexedDB「pen-sites」に現場名で預け、替わった先の組を戻して読み直す。
  const GB = window.Genba;
  const SITE_KEY = 'pen.win.albumSite';
  const siteDb = () => new Promise((ok, ng) => { const r = indexedDB.open('pen-sites', 1); r.onupgradeneeded = () => r.result.createObjectStore('albums'); r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
  const siteTx = async (mode, fn) => { const db = await siteDb(); return new Promise((ok, ng) => { const t = db.transaction('albums', mode); const q2 = fn(t.objectStore('albums')); t.oncomplete = () => { db.close(); ok(q2 && q2.result); }; t.onerror = () => { db.close(); ng(t.error); }; t.onabort = () => { db.close(); ng(t.error || new Error('保存できませんでした')); }; }); };
  const lsRaw = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* */ } } };
  const siteNow = () => (GB && GB.current ? GB.current() : '') || '';
  async function swapAlbum(from, to) {
    const items = (await idb.all()) || [];
    await siteTx('readwrite', (st) => st.put({ items, cfg: lsRaw.get('sp.cfg'), at: Date.now() }, from));
    const rec = await siteTx('readonly', (st) => st.get(to));
    await idb.clear();
    if (rec && rec.items) { for (const it of rec.items) await idb.put(it); lsRaw.set('sp.cfg', rec.cfg); }
    else {   // はじめての現場：写真は空、設定は今のまま（工事名は現場名にする）
      let c = {}; try { c = JSON.parse(lsRaw.get('sp.cfg') || '{}') || {}; } catch (e) { /* */ }
      c.name = to || ''; lsRaw.set('sp.cfg', JSON.stringify(c));
    }
    lsRaw.set(SITE_KEY, to);
  }
  {
    const have = lsRaw.get(SITE_KEY), want = siteNow();
    if (have == null) {   // はじめて：今の写真は今の現場のものにする。工事名が空なら現場名を入れる
      lsRaw.set(SITE_KEY, want);
      if (want && !CFG.name) { CFG.name = want; saveCfg(); try { syncCfg(); } catch (e) { /* */ } }
    } else if (have !== want) {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(10,12,16,.92);color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px';
      ov.textContent = `現場「${want || '現場なし'}」の写真に切り替えています…`;
      document.body.appendChild(ov);
      send({ t: 'clear' });   // 編集の窓は閉じる
      setTimeout(() => swapAlbum(have, want).then(() => location.reload(), (e) => { ov.textContent = '切り替えられませんでした: ' + e.message; setTimeout(() => ov.remove(), 4000); }), 400);
      return;
    }
  }
  // ---- 撮影日は黒板・Excel に載せない（2026-11-24 しおりちゃん）。一度だけ、今の設定と現場ごとに預けた設定から外す ----
  let dateStripped = false;
  {
    const NODATE = 'pen.win.noDate';
    const strip = (c) => { const a = (c && c.labels) || []; const b = a.filter((l) => !isDateLabel(l)); if (b.length === a.length) return false; c.labels = b; return true; };
    if (!lsRaw.get(NODATE)) {
      if (strip(CFG)) { saveCfg(); try { syncCfg(); } catch (e) { /* */ } dateStripped = true; }
      lsRaw.set(NODATE, '1');
      siteDb().then((db) => { const t = db.transaction('albums', 'readwrite'), st = t.objectStore('albums'); const rq = st.openCursor();
        rq.onsuccess = () => { const c = rq.result; if (!c) return; const v = c.value; try { const cfg = JSON.parse(v.cfg || '{}'); if (strip(cfg)) { v.cfg = JSON.stringify(cfg); c.update(v); } } catch (e) { /* */ } c.continue(); };
        t.oncomplete = () => db.close(); }).catch(() => {});
    }
  }
  function pickSite() {
    if (!GB || !GB.list || !GB.dialog) return;
    GB.list().then((a) => {
      const cur = siteNow();
      const body = `<div class="ipx-list">${['<button type="button" data-n="" aria-pressed="' + (!cur) + '">（現場を選ばない）</button>'].concat(a.map((r) => `<button type="button" data-n="${h(r.name)}" aria-pressed="${r.name === cur}">🏗 ${h(r.name)}</button>`)).join('')}</div>
        <div style="display:flex;gap:6px;margin-top:10px"><input type="text" id="dkNewSite" data-noipx placeholder="新しい現場の名前" style="flex:1;font:inherit;padding:8px;border-radius:8px;border:1px solid #444;background:#111;color:#fff"><button type="button" id="dkMkSite">＋ 作る</button></div>`;
      const d = GB.dialog('現場を選ぶ', body, [{ label: '閉じる' }], '現場ごとに、写真と初期設定（工事名・黒板の項目など）を分けて持ちます。切り替えると、今の写真はその現場に残ります。');
      const go = (n) => { d.close(); if (n === cur) return; GB.setCurrent(n); location.reload(); };
      d.el.querySelector('.ipx-list').addEventListener('click', (e) => { const t = e.target.closest('button[data-n]'); if (t) go(t.getAttribute('data-n')); });
      const mk = () => { const n = d.el.querySelector('#dkNewSite').value.trim(); GB.create(n).then(() => go(n), (e) => alert(e.message)); };
      d.el.querySelector('#dkMkSite').onclick = mk;
      d.el.querySelector('#dkNewSite').addEventListener('keydown', (e) => { if (e.key === 'Enter') mk(); });
    }).catch((e) => alert(e.message));
  }

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
      <button id="dkSite" class="site" title="現場を切り替える・作る（現場ごとに写真と設定を分けて持ちます）"></button>
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
  const siteBtn = q('#dkSite');
  const drawSite = () => { const n = siteNow(); siteBtn.textContent = '🏗 ' + (n || '現場なし') + ' ▾'; siteBtn.classList.toggle('none', !n); };
  drawSite(); siteBtn.onclick = pickSite;
  window.addEventListener('genba', drawSite);
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
            <div class="ops"><button data-act="open">✎ 編集</button><button data-act="text" title="右の文面（黒板の中身）を手入力で直す">✍ 文面</button><button data-act="del">🗑</button></div>
            <div class="tx" data-act="text" title="ダブルクリックで文面を手入力">${rows.join('')}${more}</div></div>`;
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
    if (e.target.closest('.txed')) return;
    const s = e.target.closest('.dkslot.filled'); if (!s) return;
    if (e.target.closest('.tx')) textEdit(+s.dataset.i); else edit(+s.dataset.i);
  });

  // ---- 文面（写真の右の行＝黒板の中身）をその場で手入力する ----
  function textEdit(i) {
    const it = ITEMS[i], slot = pagesEl.querySelector(`.dkslot[data-i="${i}"]`); if (!it || !slot) return;
    const prev = pagesEl.querySelector('.txed'); if (prev) prev.closest('.dkslot') && render();
    const tx = pagesEl.querySelector(`.dkslot[data-i="${i}"] .tx`); if (!tx) return;
    const labs = bodyLabels().slice(0, CFG.adopt), f = it.state.board.f || {};
    slot.draggable = false; slot.classList.add('editing');
    tx.className = 'txed'; tx.setAttribute('data-noipx', '');
    tx.innerHTML = labs.map((l) => `<label><span>${h(l)}</span>${l === '備考' ? `<textarea data-f="${h(l)}" rows="2">${h(f[l] || '')}</textarea>` : `<input data-f="${h(l)}" value="${h(f[l] || '')}">`}</label>`).join('') +
      `<div class="btns"><button data-x="ok" class="pri">保存（Enter）</button><button data-x="cancel">やめる（Esc）</button></div>`;
    const first = tx.querySelector('input,textarea'); if (first) { first.focus(); first.select && first.select(); }
    const done = async (save) => {
      if (save) {
        const nf = Object.assign({}, it.state.board.f);
        tx.querySelectorAll('[data-f]').forEach((el) => { nf[el.dataset.f] = el.value; });
        it.state = JSON.parse(JSON.stringify(Object.assign({}, it.state, { board: Object.assign({}, it.state.board, { f: nf }) })));
        try { await makeThumb(it); } catch (e) { /* */ }
        await persistItem(it);
      }
      lastOpened = i; render();
    };
    tx.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) { e.stopPropagation(); done(b.dataset.x === 'ok'); } });
    tx.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Enter' && (e.target.tagName !== 'TEXTAREA' || e.ctrlKey)) { e.preventDefault(); done(true); }
    });
  }
  pagesEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'), s = e.target.closest('.dkslot'); if (!b || !s || !s.classList.contains('filled')) return;
    const i = +s.dataset.i;
    if (b.dataset.act === 'open' && b.tagName === 'BUTTON') edit(i);
    else if (b.dataset.act === 'text' && b.tagName === 'BUTTON') textEdit(i);
    else if (b.dataset.act === 'text') { pagesEl.querySelectorAll('.dkslot.cur').forEach((x) => x.classList.remove('cur')); s.classList.add('cur'); lastOpened = i; }
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
  let files = [], sel = new Set(), anchor = -1, tw = LS.get('tw2', 220);
  thumbsEl.style.setProperty('--tw', tw + 'px');
  q('#dkSmall').onclick = () => { tw = Math.max(110, tw - 40); thumbsEl.style.setProperty('--tw', tw + 'px'); LS.set('tw2', tw); };
  q('#dkBig').onclick = () => { tw = Math.min(420, tw + 40); thumbsEl.style.setProperty('--tw', tw + 'px'); LS.set('tw2', tw); };

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
    thumbsEl.innerHTML = files.map((f, k) => `<div class="dkth" draggable="true" data-k="${k}" data-p="${h(f.path)}" title="${h(f.name)}\n${new Date(f.mtime).toLocaleString('ja-JP')}"><div class="im"></div><button class="zoom" type="button" title="大きく見る（ダブルクリック・スペースキーでも）">🔍</button><div class="nm">${h(f.name)}</div></div>`).join('');
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
    q('#dkStat').textContent = files.length ? `${files.length}枚の写真${sel.size ? `（${sel.size}枚を選択）` : ''}（ダブルクリックで拡大・Ctrl/Shiftで複数選択・左の枠へドラッグ）` : '';
  }
  thumbsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.dkth'); if (!el) return; const k = +el.dataset.k;
    if (e.shiftKey && anchor >= 0) { const [a, b] = [Math.min(anchor, k), Math.max(anchor, k)]; if (!e.ctrlKey) sel.clear(); for (let i = a; i <= b; i++) sel.add(i); }
    else if (e.ctrlKey) { sel.has(k) ? sel.delete(k) : sel.add(k); anchor = k; }
    else { sel.clear(); sel.add(k); anchor = k; }
    updSel();
  });
  thumbsEl.addEventListener('dblclick', (e) => { const el = e.target.closest('.dkth'); if (el) preview(+el.dataset.k); });
  thumbsEl.addEventListener('click', (e) => { const z = e.target.closest('.zoom'); if (z) { e.stopPropagation(); preview(+z.closest('.dkth').dataset.k); } }, true);

  // ---- 大きく見る（プレビュー） ----
  let pv = null;
  function preview(k) {
    if (!files[k]) return;
    if (!pv) {
      pv = document.createElement('div'); pv.id = 'dkPv';
      pv.innerHTML = `<div class="bar"><b class="nm"></b><span class="info"></span><span class="sp"></span>
        <button data-a="reveal" title="エクスプローラーで場所を開く">📂 場所を開く</button>
        <button data-a="add" class="pri" title="写真の枠の最後に足す">＋ 写真の枠に足す</button>
        <button data-a="close" title="閉じる（Esc）">✕</button></div>
        <div class="stage"><button data-a="prev" class="nav l" title="前の写真（←）">◀</button><img alt=""><button data-a="next" class="nav r" title="次の写真（→）">▶</button><div class="msg"></div></div>`;
      document.body.appendChild(pv);
      pv.addEventListener('click', (e) => {
        const a = (e.target.closest('[data-a]') || {}).dataset; const kk = +pv.dataset.k;
        if (!a) { if (e.target.classList.contains('stage')) closePv(); return; }
        if (a.a === 'close') closePv();
        else if (a.a === 'prev') preview(Math.max(0, kk - 1));
        else if (a.a === 'next') preview(Math.min(files.length - 1, kk + 1));
        else if (a.a === 'add') { addPaths([files[kk].path], ITEMS.length); pv.querySelector('[data-a=add]').textContent = '✓ 足しました'; }
        else if (a.a === 'reveal' && PA.fs.reveal) PA.fs.reveal(files[kk].path);
      });
    }
    const f = files[k]; pv.dataset.k = k; pv.hidden = false;
    sel.clear(); sel.add(k); anchor = k; updSel();
    const el = thumbsEl.querySelector(`.dkth[data-k="${k}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
    pv.querySelector('.nm').textContent = f.name;
    pv.querySelector('.info').textContent = `${k + 1} / ${files.length}　${new Date(f.mtime).toLocaleString('ja-JP')}　${(f.size / 1048576).toFixed(1)}MB${isUsed(f.path) ? '　貼付済' : ''}`;
    pv.querySelector('[data-a=add]').textContent = '＋ 写真の枠に足す';
    pv.querySelector('[data-a=prev]').disabled = k <= 0; pv.querySelector('[data-a=next]').disabled = k >= files.length - 1;
    const img = pv.querySelector('img'), msg = pv.querySelector('.msg');
    msg.textContent = '読み込み中…'; img.style.opacity = 0.3;
    const want = f.path;
    PA.fs.read(f.path).then((r) => {
      if (pv.hidden || files[+pv.dataset.k] !== f || f.path !== want) return;
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      const u = URL.createObjectURL(new Blob([r.data])); img.dataset.url = u; img.src = u;
      img.onload = () => { img.style.opacity = 1; msg.textContent = ''; };
      img.onerror = () => { msg.textContent = 'この写真は表示できません'; };
    }, () => { msg.textContent = 'この写真は読めませんでした'; });
  }
  function closePv() { if (!pv) return; pv.hidden = true; const img = pv.querySelector('img'); if (img.dataset.url) { URL.revokeObjectURL(img.dataset.url); img.dataset.url = ''; img.removeAttribute('src'); } }
  document.addEventListener('keydown', (e) => {
    if (pv && !pv.hidden) {
      const kk = +pv.dataset.k;
      if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); closePv(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); preview(Math.max(0, kk - 1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); preview(Math.min(files.length - 1, kk + 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); pv.querySelector('[data-a=add]').click(); }
      return;
    }
    if (e.key === ' ' && document.body.classList.contains('home') && sel.size && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); preview([...sel][0]); }
  }, true);
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
    if (dateStripped) { for (let k = 0; k < 40 && !ITEMS.length; k++) await new Promise((r) => setTimeout(r, 100)); try { await refreshThumbs(); } catch (e) { /* */ } }
    if (HAS_FS) {
      try { homeDirs = await PA.fs.homeDirs(); } catch (e) { homeDirs = []; }
      await renderTree();
      if (curDir) listThumbs(curDir); else thumbsEl.innerHTML = '<div class="msg">左のツリーで写真のフォルダを選んでください。<br>よく使うフォルダは「📁 フォルダを足す」で上に出しておけます。</div>';
    }
  })();
})();
