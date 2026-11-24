// 画面から本体へ頼むための橋渡し(一発バーン forWindows)。
// ・ippatsuApp：全アプリ共通(書き出しの名前、アプリの切替の帯、アプリの更新、版)
// ・penApp：写真ペン太郎の2列の画面(desktop.js)が使う物。写真ペン太郎 forWindows と同じ形
const { contextBridge, ipcRenderer } = require('electron');
const noteDownload = (href, name) => ipcRenderer.send('pen:dl-name', String(href || ''), String(name || ''));
contextBridge.exposeInMainWorld('ippatsuApp', {
  windows: true,
  noteDownload,
  open: (key) => ipcRenderer.send('rail:open', String(key)),
  menu: (what) => ipcRenderer.send('rail:menu', String(what)),
  update: () => ipcRenderer.invoke('ipw:update'),
  versions: () => ipcRenderer.invoke('ipw:versions'),
  onState: (cb) => ipcRenderer.on('rail:state', (_e, key) => { try { cb(key); } catch (e) { /* */ } }),
});
contextBridge.exposeInMainWorld('penApp', {
  windows: true,
  editorWindow: true,
  focusSelf: () => ipcRenderer.send('pen:focus-self'),
  noteDownload,
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
