const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  appTitle: () => ipcRenderer.invoke('app:title'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  logoPath: () => ipcRenderer.invoke('logo:path'),

  // window controls
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winClose: () => ipcRenderer.invoke('win:close'),

  // content
  fetchNews: () => ipcRenderer.invoke('news:fetch'),

  // exe + game
  ensureExe: () => ipcRenderer.invoke('exe:ensure'),
  launchGame: () => ipcRenderer.invoke('game:launch'),

  // patch
  startPatch: () => ipcRenderer.send('patch:start'),
  onPatchStatus: (cb) => ipcRenderer.on('patch:status', (_e, d) => cb(d)),
  onPatchProgress: (cb) => ipcRenderer.on('patch:progress', (_e, d) => cb(d)),
  onPatchDone: (cb) => ipcRenderer.on('patch:done', (_e, d) => cb(d)),
  patchVersions: () => ipcRenderer.invoke('patch:versions')
});
