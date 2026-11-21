// 写真ペン太郎 forWindows
// 一発バーンの pen.html を、そのまま Windows の窓で動かすための入れ物(Electron)。
// ・app://pen/ という自前の住所で開く(file:// だと DWG 読み込みの部品などが動かないため)
// ・写真や現場の保存(IndexedDB/localStorage)は %APPDATA%\写真ペン太郎 に残る
// ・Excel や画像の書き出しは「名前を付けて保存」の窓で保存先を選ぶ
const { app, BrowserWindow, protocol, shell, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, 'app');           // pen.html と vendor/ が入っている所
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
    width: 1280, height: 860, minWidth: 360, minHeight: 480,
    ...(st.bounds || {}),
    title: '写真ペン太郎',
    backgroundColor: '#16181d',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false }
  });
  if (st.max) win.maximize();
  win.on('close', saveState);
  win.on('closed', () => { win = null; });

  // 外のページへのリンクは既定のブラウザで開く。アプリの中は動かさない
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
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
      { label: 'データの保存場所を開く', click: () => shell.openPath(app.getPath('userData')) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    if (u.host !== HOST) return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'pen.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
