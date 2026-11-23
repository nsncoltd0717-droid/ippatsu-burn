// 画面(pen.html と desktop.js)から本体へ頼むための橋渡し。
// ・書き出すファイルの名前(app:// の blob から保存すると、Chromium が a.download の名前を落とすため)
// ・右の欄でパソコンの写真フォルダを見る/写真を読む
// ・「アプリの更新」
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('penApp', {
  windows: true,
  noteDownload: (href, name) => ipcRenderer.send('pen:dl-name', String(href || ''), String(name || '')),
  update: () => ipcRenderer.invoke('pen:update'),
  fs: {
    homeDirs: () => ipcRenderer.invoke('pen:home-dirs'),
    pickDir: () => ipcRenderer.invoke('pen:pick-dir'),
    list: (dir) => ipcRenderer.invoke('pen:list-dir', String(dir)),
    hasSub: (dir) => ipcRenderer.invoke('pen:has-sub', String(dir)),
    thumb: (p) => ipcRenderer.invoke('pen:thumb', String(p)),
    read: (p) => ipcRenderer.invoke('pen:read', String(p)),
    reveal: (p) => ipcRenderer.invoke('pen:reveal', String(p)),
  },
});
