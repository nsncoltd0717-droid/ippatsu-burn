// 写真ペン太郎 forWindows
// 一発バーンの pen.html を、そのまま Windows の窓で動かすための入れ物(Electron)。
// ・app://pen/ という自前の住所で開く(file:// だと DWG 読み込みの部品などが動かないため)
// ・写真や現場の保存(IndexedDB/localStorage)は %APPDATA%\写真ペン太郎 に残る
// ・Excel や画像の書き出しは「名前を付けて保存」の窓で保存先を選ぶ
// ・パソコン用の2列の画面(desktop.js / desktop.css)を pen.html に差し込んで出す
// ・「アプリの更新」で公開ページから pen.html と desktop.* を取ってきて入れ替える(%APPDATA%\写真ペン太郎\web)
const { app, BrowserWindow, protocol, shell, Menu, dialog, ipcMain, nativeImage, net, session } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, 'app');           // pen.html と vendor/ が入っている所
const SITE = process.env.PEN_SITE || 'https://nsncoltd0717-droid.github.io/ippatsu-burn/';   // PEN_SITE は試験用
const WEB_FILES = { 'pen.html': 'pen.html', 'desktop.js': 'windows/pen/desktop.js', 'desktop.css': 'windows/pen/desktop.css' };
const webDir = () => path.join(app.getPath('userData'), 'web');   // 「アプリの更新」で取ってきた物
const HOST = 'pen';
const START = `app://${HOST}/pen.html`;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.bcmap': 'application/octet-stream', '.webmanifest': 'application/manifest+json'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const dlNames = new Map();   // blob の住所 → 付けたい名前(preload.js から届く)
ipcMain.on('pen:focus-self', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
ipcMain.on('pen:dl-name', (_e, href, name) => { if (href && name) { dlNames.set(href, name); setTimeout(() => dlNames.delete(href), 60000); } });
const statePath = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (e) { return {}; } }
function saveState() {
  if (!win) return;
  try { fs.writeFileSync(statePath(), JSON.stringify({ ...loadState(), bounds: win.getNormalBounds(), max: win.isMaximized() })); } catch (e) { /* */ }
}

function lastDir() { const s = loadState(); return s.dir && fs.existsSync(s.dir) ? s.dir : app.getPath('documents'); }
function rememberDir(d) { const s = loadState(); s.dir = d; try { fs.writeFileSync(statePath(), JSON.stringify(s)); } catch (e) { /* */ } }

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 560,
    ...(st.bounds || {}),
    title: '写真ペン太郎',
    backgroundColor: '#16181d',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false }
  });
  if (st.max) win.maximize();
  win.on('close', saveState);
  win.on('closed', () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.close(); });
  win.on('closed', () => { win = null; });

  // 外のページへのリンクは既定のブラウザで開く。アプリの中は動かさない
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 写真の編集は別の窓で開く(desktop.js が pen.html?edit=写真のid を開く)
    if (url.startsWith(`app://${HOST}/pen.html?edit=`)) {
      const eb = loadState().editBounds || {};
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 1200, height: 860, minWidth: 600, minHeight: 480, ...eb,
        title: '写真ペン太郎 - 編集', backgroundColor: '#16181d', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false }
      } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    child.on('close', () => { try { fs.writeFileSync(statePath(), JSON.stringify({ ...loadState(), editBounds: child.getNormalBounds() })); } catch (e) { /* */ } });
    child.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`app://${HOST}/`)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(`app://${HOST}/`)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // 書き出し(Excel・画像)は保存先を選ばせる。前に選んだフォルダを覚えておく
  win.webContents.session.on('will-download', (e, item) => {
    const name = (dlNames.get(item.getURL()) || item.getFilename()).replace(/[\\/:*?"<>|]/g, '_');
    dlNames.delete(item.getURL());
    if (process.env.PEN_DEBUG) console.log('DL', JSON.stringify(name), item.getURL().slice(0, 40), item.getMimeType());
    if (process.env.PEN_SAVE_TO) { item.setSavePath(path.join(process.env.PEN_SAVE_TO, name)); return; }   // 試験用(窓を出さない)
    const ext = path.extname(name).slice(1).toLowerCase();
    const filters = ext === 'xlsx' ? [{ name: 'Excel', extensions: ['xlsx'] }]
      : ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [];
    const to = dialog.showSaveDialogSync(win, { defaultPath: path.join(lastDir(), name), filters });
    if (!to) { item.cancel(); return; }
    item.setSavePath(to);
    rememberDir(path.dirname(to));
    item.once('done', (_ev, state) => {
      if (state !== 'completed' || !win) return;
      const r = dialog.showMessageBoxSync(win, {
        type: 'info', title: '写真ペン太郎', message: '保存しました', detail: to,
        buttons: ['閉じる', '開く', 'フォルダを開く'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (r === 1) shell.openPath(to);
      else if (r === 2) shell.showItemInFolder(to);
    });
  });

  win.loadURL(START);
}

function buildMenu() {
  const tpl = [
    { label: 'ファイル', submenu: [
      { label: '再読み込み', accelerator: 'F5', click: () => win && win.reload() },
      { type: 'separator' },
      { label: '終了', role: 'quit' }
    ] },
    { label: '表示', submenu: [
      { label: '拡大', role: 'zoomIn', accelerator: 'Ctrl+=' },
      { label: '縮小', role: 'zoomOut' },
      { label: '元の大きさ', role: 'resetZoom' },
      { type: 'separator' },
      { label: '全画面', role: 'togglefullscreen' },
      { label: '開発者ツール', role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' }
    ] },
    { label: 'ヘルプ', submenu: [
      { label: `写真ペン太郎 forWindows ${app.getVersion()}`, enabled: false },
      { label: 'データの保存場所を開く', click: () => shell.openPath(app.getPath('userData')) },
      { label: '更新を元に戻す(入れたときの版に戻す)', click: () => { fs.rmSync(webDir(), { recursive: true, force: true }); if (win) win.reload(); } }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ---------- pen.html を Windows 版にする手当て(元の pen.html はさわらない) ----------
function patchPen(html) {
  // 題名に forWindows を足す
  html = html.replace(/(<h1 class="hm">写真ペン太郎<small>v[^<]*)(<\/small>)/, `$1 forWindows ${app.getVersion()}$2`);
  // ホーム画面アプリ用の sw.js はいらない
  html = html.replace('navigator.serviceWorker.register("sw.js").catch(() => {});', '/* Windows版では使わない */');
  // 書き出しの名前を本体へ知らせる(preload.js の penApp.noteDownload)
  const head = `<script>(function(){ if (!window.penApp) return; var c = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function(){ try { if (this.download && this.href) penApp.noteDownload(this.href, this.download); } catch (e) {} return c.apply(this, arguments); }; })();</script>
<link rel="stylesheet" href="desktop.css">`;
  html = html.includes('</head>') ? html.replace('</head>', head + '\n</head>') : head + html;
  const tail = '<script src="desktop.js"></script>';
  const i = html.lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tail + '\n' + html.slice(i) : html + tail;
}

// 「アプリの更新」で取った物があれば、そちらを使う(本体の版が変わったら、同梱の方に戻す)
function webMeta() { try { return JSON.parse(fs.readFileSync(path.join(webDir(), 'meta.json'), 'utf8')); } catch (e) { return null; } }
const ASSET_RE = /vendor\/(?:ipx|opening)\/[A-Za-z0-9_.-]+/g;   // v2.13.0 から HTML が別ファイルで読む共通部品
async function readWeb(name) {
  const m = webMeta();
  if (m && m.shell === app.getVersion()) { try { return await fs.promises.readFile(path.join(webDir(), name)); } catch (e) { /* */ } }
  return fs.promises.readFile(path.join(ROOT, name));
}
const verOf = (html) => ((String(html).match(/<h1 class="hm">写真ペン太郎<small>v([0-9.]+)/) || [])[1] || '?');
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

async function fetchText(rel) {
  const r = await net.fetch(SITE + encodeURI(rel) + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`${rel} を取れませんでした(${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
ipcMain.handle('pen:update', async () => {
  const got = {};
  for (const [name, rel] of Object.entries(WEB_FILES)) {
    try { got[name] = await fetchText(rel); } catch (e) { if (name === 'pen.html') return { ok: false, error: 'インターネットにつながらないか、公開ページが開けません。' + e.message }; }
  }
  const html = got['pen.html'].toString('utf8');
  if (!/写真ペン太郎/.test(html) || !/<\/html>/i.test(html)) return { ok: false, error: '取ってきた pen.html が正しくありません' };
  let shellNew = null;
  try { const pk = JSON.parse((await fetchText('windows/pen/package.json')).toString('utf8')); if (newer(pk.version, app.getVersion())) shellNew = pk.version; } catch (e) { /* */ }
  // 共通部品は名前に版の印が付いているので、HTML に書いてある物のうち手元に無い物だけ取ってくる
  const assets = new Set();
  for (const m of html.matchAll(ASSET_RE)) assets.add(m[0]);
  for (const a of assets) {
    const have = await readWeb(a).catch(() => null);
    if (have) { got[a] = have; continue; }
    try { got[a] = await fetchText(a); } catch (e) { return { ok: false, error: `部品 ${a} を取れませんでした。更新はしていません。` + e.message }; }
  }
  let changed = false;
  for (const name of Object.keys(got)) { const cur = await readWeb(name).catch(() => null); if (!cur || !cur.equals(got[name])) changed = true; }
  const before = verOf((await readWeb('pen.html')).toString('utf8'));
  if (changed) {
    const tmp = webDir() + '.new';
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    for (const name of [...Object.keys(WEB_FILES), ...assets]) {
      const b = got[name] || await readWeb(name);   // desktop.* がまだ公開されていなければ今の物を使う
      fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true });
      fs.writeFileSync(path.join(tmp, name), b);
    }
    fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify({ shell: app.getVersion(), at: new Date().toISOString(), pen: verOf(html) }));
    fs.rmSync(webDir(), { recursive: true, force: true }); fs.renameSync(tmp, webDir());
  }
  try { await session.defaultSession.clearCache(); } catch (e) { /* */ }
  return { ok: true, changed, before, after: verOf(html), shell: app.getVersion(), shellNew };
});

// ---------- パソコンの写真フォルダを見る(右の欄) ----------
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
  try { const ents = await fs.promises.readdir(dir, { withFileTypes: true }); return ents.some(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$')); } catch (e) { return false; }
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

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    if (u.host !== HOST) return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'pen.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
    try {
      let body = await readWeb(rel);   // 「更新」で取った物(HTML・共通部品)があればそちら、無ければ同梱の物
      if (rel === 'pen.html') body = patchPen(body.toString('utf8'));
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
  // 「アプリの更新」で入れた画面が古い一時保存(キャッシュ)に負けないように、開くたびにキャッシュを消す。写真や設定は消えない
  session.defaultSession.clearCache().catch(() => {}).finally(() => { buildMenu(); createWindow(); });
});

app.on('window-all-closed', () => app.quit());
