"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("nomisoApp", {
  windows: true,
  noteDownload: (href, name) => ipcRenderer.send("note-download", String(href), String(name)),
});
