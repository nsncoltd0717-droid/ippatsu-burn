// 書き出すファイルの名前を本体へ知らせるだけの橋渡し。
// (app:// の blob から保存すると、Chromium が a.download の名前を落として「download」になるため)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('penApp', {
  windows: true,
  noteDownload: (href, name) => ipcRenderer.send('pen:dl-name', String(href || ''), String(name || '')),
});
