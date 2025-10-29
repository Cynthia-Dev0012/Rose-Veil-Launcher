// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  appTitle: () => ipcRenderer.invoke('app:title'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  logoPath: () => ipcRenderer.invoke('logo:path'),

  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winClose: () => ipcRenderer.invoke('win:close'),

  fetchNews: () => ipcRenderer.invoke('news:fetch'),

  ensureExe: () => ipcRenderer.invoke('exe:ensure'),
  launchGame: () => ipcRenderer.invoke('game:launch'),

  exeStatus: () => ipcRenderer.invoke('exe:status'),
exeChoose: () => ipcRenderer.invoke('exe:choose'),

updateCheck: () => ipcRenderer.invoke('update:check'),
updateStart: (payload) => ipcRenderer.invoke('update:start', payload),

  getSettings: () => ipcRenderer.invoke('settings:get'),


modsOpen: () => ipcRenderer.invoke('mods:open'),

  startPatch: () => ipcRenderer.send('patch:start'),
  onPatchStatus: (cb) => ipcRenderer.on('patch:status', (_e, d) => cb(d)),
  onPatchProgress: (cb) => ipcRenderer.on('patch:progress', (_e, d) => cb(d)),
  onPatchDone: (cb) => ipcRenderer.on('patch:done', (_e, d) => cb(d)),
  patchVersions: () => ipcRenderer.invoke('patch:versions'),
  startVerify: () => ipcRenderer.send('patch:verify'),
  onVerifyDone: (cb) => ipcRenderer.on('patch:verify:done', (_e, d) => cb(d)),

  nsfwToggle: (enable) => ipcRenderer.invoke('nsfw:toggle', enable),
  nsfwUninstall: () => ipcRenderer.invoke('nsfw:uninstall')

  
});
