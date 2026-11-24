// 脳みそバーン無敵CAD forWindows（一発かまし太郎入り）
// app/ の中身(nomiso.html・kamashi.html・vendor/libredwg)を app://nomiso/ で配信して1つの窓で開く。
// file:// だと libredwg(wasm)の読み込みが通らないので独自スキームにしている(写真ペン太郎 forWindows と同じ作り)。
"use strict";
const { app, BrowserWindow, protocol, shell, Menu, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const HOST = "nomiso";
const ROOT = path.join(__dirname, "app");
const PAGES = { nomiso: "nomiso.html", kamashi: "kamashi.html" };
const TITLE = "脳みそバーン無敵CAD forWindows";

app.setName("脳みそバーン無敵CAD");
app.setPath("userData", path.join(app.getPath("appData"), "脳みそバーン無敵CAD"));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".bcmap": "application/octet-stream", ".zip": "application/zip",
};

function serve(req) {
  const u = new URL(req.url);
  let p = decodeURIComponent(u.pathname);
  if (p === "/" || p === "") p = "/" + PAGES.nomiso;
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  return new Response(fs.readFileSync(file), { status: 200, headers: { "content-type": type } });
}

// ページから「この blob はこの名前で保存」と教えてもらう(app:// では a.download の名前が落ちるため)
const pendingNames = new Map();
ipcMain.on("note-download", (_e, href, name) => {
  if (typeof href === "string" && typeof name === "string") { pendingNames.set(href, name); setTimeout(() => pendingNames.delete(href), 60000); }
});

let win = null;
function pageUrl(key) { return `app://${HOST}/${PAGES[key] || PAGES.nomiso}`; }
function open(key) { if (win) win.loadURL(pageUrl(key)); }

function buildMenu() {
  const tpl = [
    { label: "ファイル", submenu: [{ role: "quit", label: "終了" }] },
    { label: "アプリ", submenu: [
      { label: "① 脳みそバーン無敵CAD", accelerator: "CmdOrCtrl+1", click: () => open("nomiso") },
      { label: "③ 一発かまし太郎", accelerator: "CmdOrCtrl+2", click: () => open("kamashi") },
    ] },
    { label: "表示", submenu: [
      { role: "reload", label: "読み込み直す" },
      { type: "separator" },
      { role: "zoomIn", label: "文字を大きく" }, { role: "zoomOut", label: "文字を小さく" }, { role: "resetZoom", label: "元の大きさ" },
      { type: "separator" },
      { role: "togglefullscreen", label: "全画面" },
      { role: "toggleDevTools", label: "開発者ツール" },
    ] },
    { label: "ヘルプ", submenu: [
      { label: "版の情報", click: () => dialog.showMessageBox(win, { type: "info", title: TITLE, message: TITLE,
        detail: `版 ${app.getVersion()}\n脳みそバーン無敵CAD と 一発かまし太郎 を1つにまとめた Windows 版です。\n図面はこのパソコンの中で開くだけで、どこにも送られません。\nデータの置き場所: ${app.getPath("userData")}` }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 800, minHeight: 560, title: TITLE, backgroundColor: "#0f1013",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.maximize();
  win.on("page-title-updated", (e, t) => { e.preventDefault(); win.setTitle(t || TITLE); });
  const wc = win.webContents;
  // 外のリンクは既定のブラウザで開く。アプリ内は nomiso / kamashi だけ
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => {
    if (url.startsWith(`app://${HOST}/`)) {
      const p = new URL(url).pathname.replace(/^\//, "");
      if (p === "" || Object.values(PAGES).includes(p)) return;
    }
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  wc.session.on("will-download", (_e, item) => {
    const name = pendingNames.get(item.getURL()) || item.getFilename() || "download";
    item.setSaveDialogOptions({ title: "名前を付けて保存", defaultPath: path.join(app.getPath("documents"), name) });
  });
  win.loadURL(pageUrl("nomiso"));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    protocol.handle("app", serve);
    buildMenu();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
