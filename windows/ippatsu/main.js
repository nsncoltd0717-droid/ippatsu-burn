// 一発バーン forWindows
// 一発バーンのアプリ（ホーム・脳みそバーン・逃墨太郎・かまし太郎・くるくる・写し太郎・写真ペン太郎）を、1つの Windows アプリにまとめた入れ物(Electron)。
// ・窓の左に「アプリの切替」の帯(rail.html)、右にアプリの画面。帯は別の画面なので、アプリの作りに手を入れずに済む
// ・全アプリを1つの住所 app://pen/ で配る。住所が同じなので、現場(IndexedDB)・写真・設定を全アプリで共通に使える
//   （住所を pen にしているのは、写真ペン太郎 forWindows の写真と設定をそのまま引き継ぐため）
// ・データは %APPDATA%\一発バーン。初めて開いたとき、%APPDATA%\写真ペン太郎 があれば写して引き継ぐ
// ・ページは開くときに手当てする(元の HTML はさわらない)：sw.js を外す、書き出しの名前、パソコン向けの画面(win/common.*)、
//   写真ペン太郎には2列の画面(desktop.*)
// ・「アプリの更新」で公開ページから全アプリを取ってきて入れ替える(%APPDATA%\一発バーン\web)
const { app, BaseWindow, BrowserWindow, WebContentsView, protocol, shell, Menu, dialog, ipcMain, nativeImage, net, session } = require('electron');
const path = require('path');
const fs = require('fs');

const NAME = '一発バーン';
const TITLE = '一発バーン forWindows';
app.setName(NAME);
app.setPath('userData', path.join(app.getPath('appData'), NAME));

const ROOT = path.join(__dirname, 'app');
const SITE = process.env.IPPATSU_SITE || 'https://nsncoltd0717-droid.github.io/ippatsu-burn/';   // 試験用に変えられる
const HOST = 'pen';
const ORIGIN = `app://${HOST}/`;
const RAIL_W = 76;

// アプリの並び(帯とメニューとショートカット)
const APPS = [
  { key: 'home', file: 'index.html', name: 'ホーム', short: 'ホーム', mark: '⌂', color: '#495057' },
  { key: 'nomiso', file: 'nomiso.html', name: '脳みそバーン無敵CAD', short: '脳みそ', mark: '①', color: '#d9480f' },
  { key: 'sumi', file: 'sumi.html', name: 'ECP一撃逃墨太郎', short: '逃墨', mark: '②', color: '#2b8a3e' },
  { key: 'kamashi', file: 'kamashi.html', name: '一発かまし太郎', short: 'かまし', mark: '③', color: '#0b6bcb' },
  { key: 'kurukuru', file: 'kurukuru.html', name: 'くるくる回し太郎', short: 'くるくる', mark: '④', color: '#7048e8' },
  { key: 'utsushi', file: 'utsushi.html', name: 'こっそり写し太郎', short: '写し', mark: '⑤', color: '#c2255c' },
  { key: 'pen', file: 'pen.html', name: '写真ペン太郎', short: 'ペン', mark: '⑥', color: '#e8590c' },
];
// 「アプリの更新」で取ってくる物：配る名前 → 公開ページの場所
const WEB_FILES = {
  'index.html': 'index.html', 'nomiso.html': 'nomiso.html', 'sumi.html': 'sumi.html', 'kamashi.html': 'kamashi.html',
  'kurukuru.html': 'kurukuru.html', 'utsushi.html': 'utsushi.html', 'pen.html': 'pen.html',
  'desktop.js': 'windows/pen/desktop.js', 'desktop.css': 'windows/pen/desktop.css',
  'win/common.js': 'windows/ippatsu/common.js', 'win/common.css': 'windows/ippatsu/common.css', 'win/rail.html': 'windows/ippatsu/rail.html',
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bcmap': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4',
};

// ---------- 写真ペン太郎 forWindows のデータを引き継ぐ(初めて開いたときだけ) ----------
// fs.cpSync は Windows の Electron 39 で、写し先に同じ名前の物があると本体ごと落ちる(kkw01x で確認)。自前で1つずつ写す
function copyTree(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) copyTree(path.join(src, n), path.join(dst, n));
  } else if (st.isFile()) {
    fs.copyFileSync(src, dst);
  }
}
function migrateFromPen() {
  const to = app.getPath('userData');
  const from = path.join(app.getPath('appData'), '写真ペン太郎');
  const mark = path.join(to, 'migrated.json');
  if (fs.existsSync(mark) || fs.existsSync(path.join(to, 'IndexedDB')) || !fs.existsSync(from)) return;
  const skip = new Set(['DIPS', 'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'web', 'web.new',
    'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'blob_storage', 'Shared Dictionary']);
  try {
    fs.mkdirSync(to, { recursive: true });
    const copied = [];
    for (const n of fs.readdirSync(from)) {
      if (skip.has(n)) continue;
      try { copyTree(path.join(from, n), path.join(to, n)); } catch (e) { continue; }
      copied.push(n);
    }
    fs.writeFileSync(mark, JSON.stringify({ from, at: new Date().toISOString(), copied }));
  } catch (e) {
    try { fs.writeFileSync(mark, JSON.stringify({ from, at: new Date().toISOString(), error: String(e && e.message || e) })); } catch (e2) { /* */ }
  }
}
migrateFromPen();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null, rail = null, view = null;
const dlNames = new Map();   // blob の住所 → 付けたい名前(ページから届く)
const statePath = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { return {}; } }
function saveState(patch) { try { fs.writeFileSync(statePath(), JSON.stringify({ ...loadState(), ...patch })); } catch (e) { /* */ } }
function lastDir() { const s = loadState(); return s.dir && fs.existsSync(s.dir) ? s.dir : app.getPath('documents'); }

const appOf = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'app:' || u.host !== HOST) return null;
    const p = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    return APPS.find((a) => a.file === p) || null;
  } catch (e) { return null; }
};
function openApp(key) {
  const a = APPS.find((x) => x.key === key) || APPS[0];
  if (view) view.webContents.loadURL(ORIGIN + a.file);
}

function layout() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  rail.setBounds({ x: 0, y: 0, width: RAIL_W, height: h });
  view.setBounds({ x: RAIL_W, y: 0, width: Math.max(0, w - RAIL_W), height: h });
}

const webPrefs = () => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false });

function createWindow() {
  const st = loadState();
  win = new BaseWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 600, ...(st.bounds || {}),
    title: TITLE, backgroundColor: '#16181d', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
  });
  rail = new WebContentsView({ webPreferences: webPrefs() });
  view = new WebContentsView({ webPreferences: webPrefs() });
  rail.setBackgroundColor('#111318');
  view.setBackgroundColor('#ffffff');
  win.contentView.addChildView(view);
  win.contentView.addChildView(rail);
  layout();
  win.on('resize', layout);
  if (st.max) win.maximize();
  win.on('close', () => saveState({ bounds: win.getNormalBounds(), max: win.isMaximized(), last: (appOf(view.webContents.getURL()) || APPS[0]).key }));
  win.on('closed', () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.close(); win = null; });

  const wc = view.webContents;
  wc.on('page-title-updated', (_e, t) => { if (win) win.setTitle(`${t || NAME} - ${TITLE} ${app.getVersion()}`); });
  const tell = () => { const a = appOf(wc.getURL()); if (rail) rail.webContents.send('rail:state', a ? a.key : ''); };
  wc.on('did-navigate', tell);
  wc.on('did-navigate-in-page', tell);
  wc.on('did-finish-load', tell);

  // 写真ペン太郎の編集は別の窓。外のページは既定のブラウザ。ほかはアプリの中で開かない
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${ORIGIN}pen.html?edit=`)) {
      const eb = loadState().editBounds || {};
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 1200, height: 860, minWidth: 600, minHeight: 480, ...eb,
        title: '写真ペン太郎 - 編集', backgroundColor: '#16181d', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
        webPreferences: webPrefs(),
      } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    else if (url.startsWith(ORIGIN) && appOf(url)) wc.loadURL(url);   // ほかのアプリを新しい窓で開こうとしたら、この窓で開く
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    child.on('close', () => saveState({ editBounds: child.getNormalBounds() }));
    child.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  rail.webContents.on('will-navigate', (e) => e.preventDefault());

  rail.webContents.loadURL(ORIGIN + 'win/rail.html');
  const start = APPS.find((a) => a.key === process.env.IPPATSU_START) || APPS[0];
  wc.loadURL(ORIGIN + start.file);
}

// ---------- 書き出し(Excel・図面・画像など)は保存先を選ぶ。前に選んだフォルダを覚える ----------
function setupSession(ses) {
  ses.on('will-download', (_e, item) => {
    const name = (dlNames.get(item.getURL()) || item.getFilename() || 'download').replace(/[\\/:*?"<>|]/g, '_');
    dlNames.delete(item.getURL());
    if (process.env.IPPATSU_SAVE_TO) { item.setSavePath(path.join(process.env.IPPATSU_SAVE_TO, name)); return; }   // 試験用
    const ext = path.extname(name).slice(1).toLowerCase();
    const filters = ext === 'xlsx' ? [{ name: 'Excel', extensions: ['xlsx'] }] : ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [];
    const to = dialog.showSaveDialogSync(win, { defaultPath: path.join(lastDir(), name), filters });
    if (!to) { item.cancel(); return; }
    item.setSavePath(to);
    saveState({ dir: path.dirname(to) });
    item.once('done', (_ev, state) => {
      if (state !== 'completed' || !win) return;
      const r = dialog.showMessageBoxSync(win, {
        type: 'info', title: TITLE, message: '保存しました', detail: to,
        buttons: ['閉じる', '開く', 'フォルダを開く'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (r === 1) shell.openPath(to);
      else if (r === 2) shell.showItemInFolder(to);
    });
  });
  // くるくる回し太郎の「USB/シリアルでつなぐ」(Web Serial)。つなぐ口を選ぶ窓を出す
  ses.on('select-serial-port', (e, ports, _wc, cb) => {
    e.preventDefault();
    if (!ports.length) { dialog.showMessageBox(win, { type: 'info', title: TITLE, message: 'つなげる口(COMポート)が見つかりません', detail: 'ケーブルを挿してから、もう一度押してください。' }); cb(''); return; }
    const labels = ports.map((p) => `${p.portName || p.portId}${p.displayName ? ' ' + p.displayName : ''}`);
    const r = dialog.showMessageBoxSync(win, { type: 'question', title: TITLE, message: 'つなぐ口を選んでください', buttons: [...labels, 'やめる'], cancelId: labels.length, noLink: true });
    cb(r < ports.length ? ports[r].portId : '');
  });
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler(() => true);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
}

ipcMain.on('pen:dl-name', (_e, href, name) => { if (href && name) { dlNames.set(href, name); setTimeout(() => dlNames.delete(href), 60000); } });
ipcMain.on('pen:focus-self', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
ipcMain.on('rail:open', (_e, key) => openApp(key));
ipcMain.on('rail:menu', (_e, what) => {
  if (what === 'data') shell.openPath(app.getPath('userData'));
  else if (what === 'reload' && view) view.webContents.reload();
});

// ---------- ページを Windows 版にする手当て(元の HTML はさわらない) ----------
const HEAD = `<script>(function(){ document.documentElement.classList.add('ipw'); window.IPPATSU_WINDOWS = true;
var A = window.ippatsuApp; if (!A) return; var c = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function(){ try { if (this.download && this.href) A.noteDownload(this.href, this.download); } catch (e) {} return c.apply(this, arguments); }; })();</script>
<link rel="stylesheet" href="win/common.css">`;
function patchPage(file, html) {
  const key = (APPS.find((a) => a.file === file) || {}).key || '';
  html = html.replace('navigator.serviceWorker.register("sw.js").catch(() => {});', '/* forWindows: sw.js は使わない */');
  let head = HEAD.replace("classList.add('ipw')", `classList.add('ipw','ipw-${key}')`);
  if (key === 'pen') {
    // 写真ペン太郎は2列の画面(desktop.*)も入れる。見出しに forWindows の版
    html = html.replace(/(<h1 class="hm">写真ペン太郎<small>v[^<]*)(<\/small>)/, `$1 forWindows ${app.getVersion()}$2`);
    head += '\n<link rel="stylesheet" href="desktop.css">';
  }
  html = /<head>/i.test(html) ? html.replace(/<head>/i, '<head>\n' + head + '\n') : head + html;   // 最初の1つ(本物の head)だけ
  const tail = (key === 'pen' ? '<script src="desktop.js"></script>\n' : '') + '<script src="win/common.js"></script>';
  const i = html.lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tail + '\n' + html.slice(i) : html + tail;
}

// 「アプリの更新」で取った物があれば、そちらを使う(本体の版が変わったら、同梱の方に戻す)
const webDir = () => path.join(app.getPath('userData'), 'web');
function webMeta() { try { return JSON.parse(fs.readFileSync(path.join(webDir(), 'meta.json'), 'utf8')); } catch (e) { return null; } }
async function readWeb(rel) {
  const m = webMeta();
  if (m && m.shell === app.getVersion()) { try { return await fs.promises.readFile(path.join(webDir(), rel)); } catch (e) { /* */ } }
  return fs.promises.readFile(path.join(ROOT, rel));
}
const screenVer = (js) => ((String(js).match(/SCREEN_VER\s*=\s*'([^']+)'/) || [])[1] || '?');
const ippatsuVer = (html) => ((String(html).match(/<h1>一発バーン <small>(v[0-9.]+)/) || [])[1] || '?');
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function versions() {
  const idx = (await readWeb('index.html').catch(() => '')).toString('utf8');
  const cj = (await readWeb('win/common.js').catch(() => '')).toString('utf8');
  const m = webMeta();
  return { shell: app.getVersion(), ippatsu: ippatsuVer(idx), screen: screenVer(cj), updated: m && m.shell === app.getVersion() ? m.at : null };
}
ipcMain.handle('ipw:versions', versions);

async function fetchBuf(rel) {
  const r = await net.fetch(SITE + encodeURI(rel) + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`${rel} を取れませんでした(${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
async function update() {
  const before = await versions();
  const got = {};
  for (const [name, rel] of Object.entries(WEB_FILES)) {
    try { got[name] = await fetchBuf(rel); } catch (e) {
      if (name.endsWith('.html') && !name.startsWith('win/')) return { ok: false, error: 'インターネットにつながらないか、公開ページが開けません。' + e.message };
    }
  }
  for (const n of Object.keys(got)) {
    if (n.endsWith('.html') && !/<\/html>/i.test(got[n].toString('utf8'))) return { ok: false, error: `取ってきた ${n} が正しくありません` };
  }
  let shellNew = null;
  try { const pk = JSON.parse((await fetchBuf('windows/ippatsu/package.json')).toString('utf8')); if (newer(pk.version, app.getVersion())) shellNew = pk.version; } catch (e) { /* */ }
  const changedFiles = [];
  for (const n of Object.keys(got)) { const cur = await readWeb(n).catch(() => null); if (!cur || !cur.equals(got[n])) changedFiles.push(n); }
  if (changedFiles.length) {
    const tmp = webDir() + '.new';
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const n of Object.keys(WEB_FILES)) {
      const b = got[n] || await readWeb(n);   // まだ公開されていない物は今の物を使う
      fs.mkdirSync(path.dirname(path.join(tmp, n)), { recursive: true });
      fs.writeFileSync(path.join(tmp, n), b);
    }
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ shell: app.getVersion(), at: new Date().toISOString(), files: changedFiles }));
    fs.rmSync(webDir(), { recursive: true, force: true }); fs.renameSync(tmp, webDir());
  }
  try { await session.defaultSession.clearCache(); } catch (e) { /* */ }
  const after = await versions();
  return { ok: true, changed: changedFiles.length > 0, files: changedFiles, before, after, shell: app.getVersion(), shellNew };
}
ipcMain.handle('ipw:update', async () => {
  const r = await update();
  if (r.ok && r.changed && view) view.webContents.reload();   // 帯は知らせを出してから自分で読み直す
  return r;
});
// 写真ペン太郎の画面(desktop.js)の「アプリの更新」とも同じ物を使う。返す形は写真ペン太郎のもの
ipcMain.handle('pen:update', async () => {
  const r = await update();
  if (!r.ok) return r;
  if (r.changed && rail) rail.webContents.reload();
  return { ok: true, changed: r.changed, before: r.before.screen, after: r.after.screen, shell: r.shell, shellNew: r.shellNew };
});

// ---------- パソコンの写真フォルダを見る(写真ペン太郎の右の欄) ----------
const IMG = /\.(jpe?g|png|webp)$/i;
ipcMain.handle('pen:home-dirs', () => {
  const out = [];
  for (const k of ['pictures', 'desktop', 'documents', 'downloads']) { try { out.push({ name: { pictures: 'ピクチャ', desktop: 'デスクトップ', documents: 'ドキュメント', downloads: 'ダウンロード' }[k], path: app.getPath(k) }); } catch (e) { /* */ } }
  if (process.platform === 'win32') for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const d = c + ':\\'; if (fs.existsSync(d)) out.push({ name: c + ':', path: d, drive: true }); }
  return out;
});
ipcMain.handle('pen:pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: '写真のフォルダを選ぶ', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pen:list-dir', async (_e, dir) => {
  const ents = await fs.promises.readdir(dir, { withFileTypes: true });
  const dirs = [], files = [];
  for (const d of ents) {
    if (d.name.startsWith('.') || d.name.startsWith('$')) continue;
    if (d.isDirectory()) dirs.push(d.name);
    else if (d.isFile() && IMG.test(d.name)) {
      let st = null; try { st = await fs.promises.stat(path.join(dir, d.name)); } catch (e) { /* */ }
      files.push({ name: d.name, path: path.join(dir, d.name), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 });
    }
  }
  const coll = new Intl.Collator('ja', { numeric: true });
  dirs.sort(coll.compare); files.sort((a, b) => coll.compare(a.name, b.name));
  return { dir, dirs, files };
});
ipcMain.handle('pen:has-sub', async (_e, dir) => {
  try { const ents = await fs.promises.readdir(dir, { withFileTypes: true }); return ents.some((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$')); } catch (e) { return false; }
});
ipcMain.handle('pen:thumb', async (_e, p) => {
  try {
    let im = null;
    if (process.platform === 'win32') { try { im = await nativeImage.createThumbnailFromPath(p, { width: 320, height: 320 }); } catch (e) { im = null; } }
    if (!im || im.isEmpty()) { im = nativeImage.createFromPath(p); if (im.isEmpty()) return ''; const s = im.getSize(); const k = 320 / Math.max(s.width, s.height); if (k < 1) im = im.resize({ width: Math.round(s.width * k), height: Math.round(s.height * k), quality: 'good' }); }
    return im.toDataURL();
  } catch (e) { return ''; }
});
ipcMain.handle('pen:read', async (_e, p) => {
  if (!IMG.test(p)) throw new Error('画像ではありません');
  const st = await fs.promises.stat(p);
  return { name: path.basename(p), mtime: st.mtimeMs, data: await fs.promises.readFile(p) };
});
ipcMain.handle('pen:reveal', (_e, p) => { shell.showItemInFolder(p); });

// ---------- メニュー(Alt で出る。ショートカットはいつでも効く) ----------
function buildMenu() {
  const tpl = [
    { label: 'ファイル', submenu: [
      { label: '読み込み直す', accelerator: 'F5', click: () => view && view.webContents.reload() },
      { type: 'separator' },
      { label: '終了', role: 'quit' },
    ] },
    { label: 'アプリ', submenu: APPS.map((a, i) => ({ label: `${a.mark} ${a.name}`, accelerator: `CmdOrCtrl+${i}`, click: () => openApp(a.key) })) },
    { label: '表示', submenu: [
      { label: '拡大', accelerator: 'CmdOrCtrl+=', click: () => view && view.webContents.setZoomLevel(view.webContents.getZoomLevel() + 0.5) },
      { label: '縮小', accelerator: 'CmdOrCtrl+-', click: () => view && view.webContents.setZoomLevel(view.webContents.getZoomLevel() - 0.5) },
      { label: '元の大きさ', accelerator: 'CmdOrCtrl+Shift+0', click: () => view && view.webContents.setZoomLevel(0) },
      { type: 'separator' },
      { label: '全画面', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      { label: '開発者ツール', accelerator: 'CmdOrCtrl+Shift+I', click: () => view && view.webContents.toggleDevTools() },
    ] },
    { label: 'ヘルプ', submenu: [
      { label: `${TITLE} ${app.getVersion()}`, enabled: false },
      { label: 'データの保存場所を開く', click: () => shell.openPath(app.getPath('userData')) },
      { label: '更新を元に戻す(入れたときの版に戻す)', click: () => { fs.rmSync(webDir(), { recursive: true, force: true }); if (view) view.webContents.reload(); if (rail) rail.webContents.reload(); } },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    if (u.host !== HOST) return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
    try {
      let body = WEB_FILES[rel] ? await readWeb(rel) : await fs.promises.readFile(file);
      if (APPS.some((a) => a.file === rel)) body = patchPage(rel, body.toString('utf8'));
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
  setupSession(session.defaultSession);
  // 「アプリの更新」で入れた画面が古い一時保存(キャッシュ)に負けないように、開くたびにキャッシュを消す。写真や設定は消えない
  session.defaultSession.clearCache().catch(() => {}).finally(() => { buildMenu(); createWindow(); if (process.env.IPPATSU_SHOT) shots(process.env.IPPATSU_SHOT); });
});

// 試験用：全アプリを順に開いて画面を写す(IPPATSU_SHOT=保存先)
async function shots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  const keys = (process.env.IPPATSU_SHOT_APPS || APPS.map((a) => a.key).join(',')).split(',');
  for (const k of keys) {
    openApp(k); await wait(+(process.env.IPPATSU_SHOT_WAIT || 6000));
    try { await view.webContents.executeJavaScript("document.getElementById('ipxOp') && document.getElementById('ipxOp').remove(); 1"); } catch (e) { /* */ }
    await wait(500);
    if (process.env.IPPATSU_SHOT_JS) { try { console.log('JS', k, JSON.stringify(await view.webContents.executeJavaScript(process.env.IPPATSU_SHOT_JS))); } catch (e) { console.log('JSERR', k, e.message); } }
    fs.writeFileSync(path.join(dir, k + '.png'), (await view.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(dir, k + '.rail.png'), (await rail.webContents.capturePage()).toPNG());
  }
  app.quit();
}

app.on('window-all-closed', () => app.quit());
