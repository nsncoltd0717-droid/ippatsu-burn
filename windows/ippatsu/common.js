// 一発バーン forWindows：全アプリ共通のパソコン向けの手当て(たたき台)
// main.js が各アプリの </body> の前に差し込む。「⟳ 更新」で公開ページから届く。直したら SCREEN_VER を上げる。
(function () {
  'use strict';
  // 画面の版(「⟳ 更新」で届く分)。左の帯の下に出る
  const SCREEN_VER = '画面 2026-11-26a';
  window.IPPATSU_WINDOWS_SCREEN = SCREEN_VER;
  const root = document.documentElement;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('ipw.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ipw.' + k, JSON.stringify(v)); } catch (e) { /* */ } },
  };
  const kick = () => { try { window.dispatchEvent(new Event('resize')); } catch (e) { /* */ } };

  // ---- 図面系(上に図面 main、下に操作 .sheet の作り)は、図面を左・操作を右の2列にする ----
  const main = document.querySelector('body > main'), sheet = document.querySelector('body > .sheet');
  if (main && sheet && main.querySelector('#cv')) {
    root.classList.add('ipw-cad');
    const MIN = 320, key = 'side.' + (location.pathname.replace(/^\/+|\.html$/g, '') || 'home');
    const setSide = (w) => {
      w = Math.max(MIN, Math.min(Math.round(w), Math.max(MIN, window.innerWidth - 420)));
      root.style.setProperty('--ipw-side', w + 'px');
      split.style.left = (window.innerWidth - w) + 'px';
      return w;
    };
    const split = document.createElement('div');
    split.className = 'ipw-split'; split.title = 'ドラッグで右の欄の幅を変える(ダブルクリックで元の幅)';
    document.body.appendChild(split);
    const DEF = root.classList.contains('ipw-tab') ? 520 : 460;   // タブレットは右の欄を少し広く
    let side = setSide(LS.get(key, DEF));
    split.addEventListener('pointerdown', (e) => {
      e.preventDefault(); split.setPointerCapture(e.pointerId); split.classList.add('drag'); root.classList.add('ipw-dragging');
      const mv = (ev) => { side = setSide(window.innerWidth - ev.clientX); kick(); };
      const up = () => { split.removeEventListener('pointermove', mv); split.classList.remove('drag'); root.classList.remove('ipw-dragging'); LS.set(key, side); kick(); };
      split.addEventListener('pointermove', mv);
      split.addEventListener('pointerup', up, { once: true });
      split.addEventListener('pointercancel', up, { once: true });
    });
    split.addEventListener('dblclick', () => { side = setSide(DEF); LS.set(key, side); kick(); });
    window.addEventListener('resize', () => setSide(side));
    // 体の作りを変えたので、図面を描き直してもらう
    requestAnimationFrame(() => { kick(); setTimeout(kick, 300); });
  }

  // ================= 0.6.0：PC の画面向け =================
  const DESK = root.classList.contains('ipw-desk');
  const app = (location.pathname.replace(/^\/+|\.html$/g, '') || 'index');

  // ---- オープニング：横長の画面では、ぼかした背景を敷く。デスクトップでは「クリックか Esc でスキップ」 ----
  const op = document.getElementById('ipxOp');
  if (op) {
    const s2 = op.querySelector('.s2'), v = op.querySelector('.s2 video'), pic = op.querySelector('.s2 div.pic');
    const src = (v && v.getAttribute('poster')) || (pic && (pic.style.backgroundImage.match(/url\(["']?([^"')]+)/) || [])[1]) || '';
    if (s2 && src) { const bg = document.createElement('div'); bg.className = 'ipw-bg'; bg.style.backgroundImage = `url("${src}")`; s2.insertBefore(bg, s2.firstChild); }
    const sk = op.querySelector('.skip'); if (sk && DESK) sk.textContent = 'クリックか Esc でスキップ';
    const key = (e) => {
      if (!document.getElementById('ipxOp')) { window.removeEventListener('keydown', key, true); return; }
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.removeEventListener('keydown', key, true); try { window.IPPATSU_OPENING_CLOSE && window.IPPATSU_OPENING_CLOSE(); } catch (x) { /* */ } }
    };
    window.addEventListener('keydown', key, true);
  }

  // 上に貼り付く帯(見出しなど)の高さ。ひそか・写し太郎で、その下に貼り付ける物の位置に使う
  const setTop = () => {
    let t = 0;
    for (const el of document.querySelectorAll('body > header, body > #tBar')) {
      const p = getComputedStyle(el).position;
      if (p === 'sticky' || p === 'fixed') t += el.offsetHeight;
    }
    if (t) root.style.setProperty('--ipw-top', t + 'px');
  };

  // ---- ホーム：現場(左)とアプリ(右)の2つの欄に分ける(狭いときは CSS で今までどおり縦に並ぶ) ----
  if (app === 'index') {
    const apps = [...document.querySelectorAll('body > a.app')];
    const h2s = [...document.querySelectorAll('body > h2')];
    const appsH = apps.length ? apps[0].previousElementSibling : null;
    if (apps.length && appsH && appsH.tagName === 'H2') {
      const box = document.createElement('div'); box.className = 'ipw-home2';
      const left = document.createElement('div'); left.className = 'ipw-left';
      const right = document.createElement('div'); right.className = 'ipw-right';
      const grid = document.createElement('div'); grid.className = 'ipw-apps';
      const firstH = h2s[0];
      firstH.parentNode.insertBefore(box, firstH);
      box.append(left, right);
      // アプリの見出しより前の物(いまの現場・クラウド)と、アプリより後の物(現場の一覧)は左、フッターはそのまま下
      let n = box.nextElementSibling;
      while (n) {
        const next = n.nextElementSibling;
        if (n.tagName === 'FOOTER' || n.tagName === 'SCRIPT' || n.classList.contains('ipw-split')) { n = next; continue; }
        if (n === appsH) right.appendChild(n);
        else if (n.matches('a.app')) grid.appendChild(n);
        else left.appendChild(n);
        n = next;
      }
      right.appendChild(grid);
    }
  }

  // ---- ひそか・写し太郎：貼り付く帯の高さを覚える ----
  if (app === 'hisoka' || app === 'utsushi') {
    setTop(); window.addEventListener('resize', setTop); setTimeout(setTop, 500);
  }
  // ---- 写し太郎(デスクトップ)：下のタブを見出しの下へ ----
  if (app === 'utsushi' && DESK) {
    const tabs = document.querySelector('nav.tabs'), hd = document.querySelector('body > header');
    if (tabs && hd) hd.insertAdjacentElement('afterend', tabs);
  }
})();
