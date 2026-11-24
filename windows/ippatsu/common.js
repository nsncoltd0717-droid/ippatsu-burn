// 一発バーン forWindows：全アプリ共通のパソコン向けの手当て(たたき台)
// main.js が各アプリの </body> の前に差し込む。「⟳ 更新」で公開ページから届く。直したら SCREEN_VER を上げる。
(function () {
  'use strict';
  // 画面の版(「⟳ 更新」で届く分)。左の帯の下に出る
  const SCREEN_VER = '画面 2026-11-25a';
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
    let side = setSide(LS.get(key, 460));
    split.addEventListener('pointerdown', (e) => {
      e.preventDefault(); split.setPointerCapture(e.pointerId); split.classList.add('drag'); root.classList.add('ipw-dragging');
      const mv = (ev) => { side = setSide(window.innerWidth - ev.clientX); kick(); };
      const up = () => { split.removeEventListener('pointermove', mv); split.classList.remove('drag'); root.classList.remove('ipw-dragging'); LS.set(key, side); kick(); };
      split.addEventListener('pointermove', mv);
      split.addEventListener('pointerup', up, { once: true });
      split.addEventListener('pointercancel', up, { once: true });
    });
    split.addEventListener('dblclick', () => { side = setSide(460); LS.set(key, side); kick(); });
    window.addEventListener('resize', () => setSide(side));
    // 体の作りを変えたので、図面を描き直してもらう
    requestAnimationFrame(() => { kick(); setTimeout(kick, 300); });
  }
})();
