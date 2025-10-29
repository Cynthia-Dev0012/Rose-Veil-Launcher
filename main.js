// main.js — Rose Veil Launcher (cleaned)
const { app, BrowserWindow, ipcMain, dialog, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// global safety logs
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

// ---------- SETTINGS LOADER ----------
function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b;
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = deepMerge(a[k], b[k]);
    return out;
  }
  return b === undefined ? a : b;
}

const DEFAULTS = {
  appTitle: "Rose Veil Launcher",
  logoPath: "assets/logo.png",
  exe: { name: "MyGame.exe", sha256Whitelist: [] },
  news: { url: "", timeoutMs: 12000 },
  patch: { manifestUrl: "", destSubdir: "DLC/nsfw" },
  launcher: { updateManifestUrl: "" },
  mods: { subdir: "Mods" },
  dev: { skipChecksum: false },
  window: { width: 860, height: 540, resizable: false }
};

function loadJsonSafe(p) {
  try {
    const txt = fs.readFileSync(p, 'utf-8');
    const s = txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt;
    return JSON.parse(s);
  } catch { return null; }
}

function loadSettings() {
  const appDir = path.dirname(__filename);
  const distCfg = loadJsonSafe(path.join(appDir, 'roseveil.settings.json')) || {};
  const localCfg = loadJsonSafe(path.join(app.getPath('userData'), 'roseveil.local.json')) || {};
  return deepMerge(deepMerge(DEFAULTS, distCfg), localCfg);
}

const settings = loadSettings();

// ----- SINGLE INSTANCE LOCK -----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
}

// ---------- CONSTANTS ----------
const CONFIG_PATH       = path.join(app.getPath('userData'), 'config.json');
const NEWS_CACHE_PATH   = path.join(app.getPath('userData'), 'news_cache.json');

const LAUNCHER_UPDATE_URL = settings.launcher?.updateManifestUrl || "";
const MODS_SUBDIR         = settings.mods?.subdir || "Mods";

// ---------- WINDOW ----------
function createWindow() {
  const win = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    resizable: !!settings.window.resizable,
    title: settings.appTitle,
    backgroundColor: "#101014",
    icon: path.join(__dirname, settings.logoPath),
    frame: false,
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());

// ---------- HELPERS ----------
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch { return { exePath: "" }; }
}
function writeConfig(data) {
  const merged = { ...readConfig(), ...data };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function fileSha256Sync(p) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}
function isValidExe(p) {
  if (!p || !fs.existsSync(p)) return false;
  if (path.basename(p) !== settings.exe.name) return false;
  const wl = settings.exe.sha256Whitelist || [];
  if (wl.length === 0) return true;
  try { return wl.includes(fileSha256Sync(p).toLowerCase()); }
  catch { return false; }
}
async function promptForExe(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win || BrowserWindow.getFocusedWindow(), {
    title: `Select ${settings.exe.name}`,
    properties: ['openFile'],
    filters: [{ name: 'Windows Executable', extensions: ['exe'] }]
  });
  const chosen = (!canceled && filePaths && filePaths[0]) ? filePaths[0] : null;
  if (chosen && isValidExe(chosen)) {
    writeConfig({ exePath: chosen });
    return { ok: true, exePath: chosen };
  }
  return { ok: false, error: chosen ? "Selected EXE is not valid." : "No file chosen." };
}
function ensureExeOrPrompt() {
  const cfg = readConfig();
  if (isValidExe(cfg.exePath)) return { ok: true, exePath: cfg.exePath };
  return { ok: false };
}
function getExeStatus() {
  const cfg = readConfig();
  return { ok: isValidExe(cfg.exePath), exePath: cfg.exePath || "" };
}
function isGameRunningByPath(exePath) {
  return new Promise((resolve) => {
    if (!exePath) return resolve(false);
    const ps = spawn('powershell.exe', [
      '-NoProfile','-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exePath.replace(/'/g,"''")}' } | Select-Object -First 1 ProcessId | ConvertTo-Json`
    ], { windowsHide: true });
    let buf = '';
    ps.stdout.on('data', d => buf += d.toString());
    ps.on('exit', () => {
      try { const obj = JSON.parse(buf.trim() || 'null'); resolve(!!obj); }
      catch { resolve(false); }
    });
    ps.on('error', () => resolve(false));
  });
}

// robust JSON parser
function safeParseJSONLabeled(txt, sourceLabel = 'unknown') {
  if (typeof txt !== 'string') throw new Error(`[${sourceLabel}] not text`);
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  const sidx = Math.min(...['{','['].map(ch=>{ const i=txt.indexOf(ch); return i<0?Infinity:i; }));
  if (!isFinite(sidx)) throw new Error(`[${sourceLabel}] no JSON start. First 120: ${txt.slice(0,120)}`);
  const eidx = Math.max(txt.lastIndexOf('}'), txt.lastIndexOf(']'));
  const core = txt.slice(sidx, eidx+1).trim();
  try { return JSON.parse(core); }
  catch (e) { throw new Error(`[${sourceLabel}] JSON parse error: ${e.message}. Near: ${core.slice(0,80)}`); }
}

// HTTP helpers
function httpGetBuffer(url, timeoutMs = (settings.news.timeoutMs || 12000), headers = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    Object.entries(headers).forEach(([k,v])=>req.setHeader(k, v));
    const timer = setTimeout(() => { try{req.abort();}catch{}; reject(new Error('Timeout')); }, timeoutMs);
    const chunks = [];
    let status = 0;
    req.on('response', (resp) => {
      status = resp.statusCode || 0;
      resp.on('data', c => chunks.push(Buffer.from(c)));
      resp.on('end', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status}`));
        resolve(buf);
      });
    });
    req.on('error', (e)=>{ clearTimeout(timer); reject(e); });
    req.end();
  });
}
async function httpGetJsonRetry(url, tries=3, headers={}) {
  let last;
  for (let i=0;i<tries;i++){
    try {
      const buf = await httpGetBuffer(url, settings.news.timeoutMs||12000, headers);
      return safeParseJSONLabeled(buf.toString('utf-8'), url);
    } catch(e){
      last = e;
      await new Promise(r=>setTimeout(r, 500*(i+1)));
    }
  }
  throw last;
}

// news cache helpers
function readNewsCache() {
  try { return JSON.parse(fs.readFileSync(NEWS_CACHE_PATH,'utf-8')); }
  catch { return { etag:null, body:null, ts:0 }; }
}
function writeNewsCache(obj) {
  try {
    fs.mkdirSync(path.dirname(NEWS_CACHE_PATH), { recursive: true });
    fs.writeFileSync(NEWS_CACHE_PATH, JSON.stringify(obj,null,2),'utf-8');
  } catch (e) { console.warn('[news cache] write failed:', e); }
}

// download with resume
function downloadResumable(url, finalPath, onProgress) {
  return new Promise(async (resolve, reject) => {
    const partPath = finalPath + '.part';
    let start = 0;
    try { start = fs.statSync(partPath).size; } catch {}
    const out = fs.createWriteStream(partPath, { flags: start ? 'a' : 'w' });
    const hash = crypto.createHash('sha256');
    let downloaded = start;
    let totalHeader = 0;

    const req = net.request(url);
    if (start > 0) req.setHeader('Range', `bytes=${start}-`);

    req.on('response', (resp) => {
      const sc = resp.statusCode || 0;
      if (sc === 200 && start > 0) { out.close(); try{fs.unlinkSync(partPath);}catch{}; downloaded = 0; start = 0; }
      const len = Number(resp.headers['content-length']) || 0;
      totalHeader = len + start;

      resp.on('data', (chunk) => {
        downloaded += chunk.length;
        hash.update(chunk);
        out.write(chunk);
        onProgress?.({ phase:'downloading', downloaded, total: totalHeader, percent: totalHeader ? (downloaded/totalHeader)*100 : 0 });
      });
      resp.on('end', () => {
        out.end(() => {
          const sha256 = hash.digest('hex');
          try { fs.renameSync(partPath, finalPath); } catch(e){ return reject(e); }
          resolve({ sha256, size: downloaded, total: totalHeader });
        });
      });
    });
    req.on('error', (e) => { out.close(); reject(e); });
    req.end();
  });
}

async function expandZipPowershell(zipPath, destDir) {
  await fs.promises.mkdir(destDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile','-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g,"''")}' -DestinationPath '${destDir.replace(/'/g,"''")}' -Force`
    ], { windowsHide: true });
    ps.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Expand-Archive failed (${code})`)));
    ps.on('error', reject);
  });
}

function getInstalledPatchInfo() {
  try {
    const exeDir = path.dirname(readConfig().exePath);
    const installedPath = path.join(exeDir, settings.patch.destSubdir, 'installed.json');
    if (!fs.existsSync(installedPath)) return null;
    return JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
  } catch { return null; }
}
async function verifyInstalled(manifest, destDir) {
  const files = manifest.files || [];
  const bad = [];
  for (const f of files) {
    const p = path.join(destDir, f.path.replace(/^[/\\]+/,''));
    if (!fs.existsSync(p)) { bad.push({ path: f.path, reason:'missing' }); continue; }
    try {
      const sha = fileSha256Sync(p).toLowerCase();
      if (sha !== String(f.sha256||'').toLowerCase()) bad.push({ path: f.path, reason:'checksum' });
    } catch { bad.push({ path: f.path, reason:'read' }); }
  }
  return bad;
}

function cmpSemver(a, b) {
  const pa = String(a).split('.').map(n=>parseInt(n,10)||0);
  const pb = String(b).split('.').map(n=>parseInt(n,10)||0);
  for (let i=0;i<Math.max(pa.length,pb.length);i++){ const x=pa[i]||0, y=pb[i]||0; if (x>y) return 1; if (x<y) return -1; }
  return 0;
}

// ---------- IPC: App Info & Window ----------
ipcMain.handle('app:title', () => settings.appTitle);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('logo:path', () => path.join(__dirname, settings.logoPath));
ipcMain.handle('win:minimize', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.minimize(); });
ipcMain.handle('win:close', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.close(); });

// ---------- IPC: Settings & First-run ----------
ipcMain.handle('settings:get', () => ({
  appTitle: settings.appTitle,
  dev: settings.dev || {},
  launcher: { updateManifestUrl: settings.launcher?.updateManifestUrl || "" },
  news: { hasUrl: !!settings.news?.url },
  patch: { destSubdir: settings.patch?.destSubdir || "" },
  mods: { subdir: settings.mods?.subdir || "Mods" }
}));
ipcMain.handle('exe:status', () => getExeStatus());
ipcMain.handle('exe:choose', async () => await promptForExe());

// ---------- IPC: News (ETag + cache + real offline detection) ----------
ipcMain.handle('news:fetch', async () => {
  const url = settings.news.url;
  if (!url) return { ok:false, error:'NEWS_URL not set' };

  const cache = readNewsCache();

  try {
    const bodyBuf = await new Promise((resolve, reject) => {
      const req = net.request(url);
      if (cache.etag) req.setHeader('If-None-Match', cache.etag);
      req.setHeader('User-Agent', 'RoseVeilLauncher/1.0');
      req.setHeader('Accept', 'application/json');

      const chunks = []; let status = 0; let etag = null;
      req.on('response', (resp) => {
        status = resp.statusCode || 0;
        etag = resp.headers['etag'] || null;
        resp.on('data', c => chunks.push(Buffer.from(c)));
        resp.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (status === 304) {
            if (cache.body) return resolve(Buffer.from(cache.body, 'utf-8'));
            return reject(new Error('HTTP 304 with no cache body'));
          }
          if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status}: ${buf.toString('utf-8').slice(0,150)}…`));
          if (etag) writeNewsCache({ etag, body: buf.toString('utf-8'), ts: Date.now() });
          resolve(buf);
        });
      });
      req.on('error', reject);
      req.end();
    });

    const json = safeParseJSONLabeled(bodyBuf.toString('utf-8'), url);
    const items = Array.isArray(json) ? json : (json.items || []);
    return { ok:true, items, offline:false };

  } catch (e) {
    if (cache.body) {
      try {
        const j = safeParseJSONLabeled(cache.body, `cache:${settings.news.url}`);
        const items = Array.isArray(j) ? j : (j.items || []);
        return { ok:true, items, offline:true, cached:true };
      } catch {}
    }
    return { ok:false, error:`[news] ${String(e.message || e)}` };
  }
});

// ---------- IPC: Game Launch ----------
ipcMain.handle('exe:ensure', async () => {
  const res = ensureExeOrPrompt();
  if (res.ok) return res;
  return await promptForExe();
});
ipcMain.handle('game:launch', async () => {
  const ensured = ensureExeOrPrompt();
  let exePath = ensured.ok ? ensured.exePath : null;
  if (!exePath) {
    const prompted = await promptForExe();
    if (!prompted.ok) return { ok:false, error: prompted.error || 'No EXE selected.' };
    exePath = prompted.exePath;
  }
  const running = await isGameRunningByPath(exePath);
  if (running) return { ok:false, error:'Game already running.' };

  try { const child = spawn(exePath, [], { detached:true, stdio:'ignore' }); child.unref(); setTimeout(() => app.quit(), 150); return { ok:true }; }
  catch (err) { return { ok:false, error:String(err) }; }
});

// ---------- IPC: Launcher Update ----------
ipcMain.handle('update:check', async () => {
  if (!LAUNCHER_UPDATE_URL) return { ok:false, reason:'no-url' };
  try {
    const m = await httpGetJsonRetry(LAUNCHER_UPDATE_URL, 2, { 'User-Agent':'RoseVeilLauncher/1.0','Accept':'application/json' });
    const current = app.getVersion();
    const newer = cmpSemver(m.version, current) > 0;
    return { ok:true, newer, latest:m.version, url:m.url, sha256:m.sha256||null, current };
  } catch (e) {
    return { ok:false, error:String(e) };
  }
});
ipcMain.handle('update:start', async (_e, { url, sha256 }) => {
  if (!url) return { ok:false, error:'No URL' };
  const tmp = path.join(app.getPath('temp'), 'rvlauncher_update.bin');
  try { fs.unlinkSync(tmp); } catch {}
  try {
    const dl = await downloadResumable(url, tmp);
    if (!settings.dev?.skipChecksum && sha256) {
      const got = fileSha256Sync(tmp).toLowerCase();
      if (got !== String(sha256).toLowerCase()) return { ok:false, error:'Installer checksum mismatch' };
    }
    const child = spawn(tmp, [], { detached:true, stdio:'ignore' });
    child.unref(); setTimeout(() => app.quit(), 250);
    return { ok:true };
  } catch (e) {
    return { ok:false, error:String(e) };
  }
});

// ---------- IPC: Mods (Open Folder only) ----------
function getModsDir() {
  const st = getExeStatus();
  if (!st.ok) return null;
  const exeDir = path.dirname(st.exePath);
  return path.join(exeDir, MODS_SUBDIR);
}
ipcMain.handle('mods:open', async () => {
  const dir = getModsDir();
  if (!dir) return { ok:false, error:'Game path not set' };
  fs.mkdirSync(dir, { recursive:true });
  await shell.openPath(dir);
  return { ok:true, dir };
});

// ---------- IPC: Patch (download/verify/unzip) ----------
ipcMain.on('patch:start', async (evt) => {
  const send = (ch, p) => evt.sender.send(ch, p);
  try {
    send('patch:status', { phase:'manifest', message:'Fetching manifest…' });
    const manifest = await httpGetJsonRetry(settings.patch.manifestUrl, 3);

    const cfg = readConfig();
    if (!isValidExe(cfg.exePath)) {
      const prompt = await promptForExe();
      if (!prompt.ok) throw new Error(prompt.error || "Game EXE not set.");
    }
    const exeDir = path.dirname(readConfig().exePath);
    const destDir = path.join(exeDir, settings.patch.destSubdir);

    const tmpZip = path.join(app.getPath('temp'), `nsfw_${manifest.version}.zip`);
    try { fs.unlinkSync(tmpZip); } catch {}

    send('patch:status', { phase:'download', message:'Downloading patch…' });
    const dl = await downloadResumable(manifest.url, tmpZip, (p) => send('patch:progress', p));

    send('patch:status', { phase:'verify', message:'Verifying checksum…' });
    const got = dl.sha256.toLowerCase();
    const want = String(manifest.sha256||'').toLowerCase();
    if (!settings.dev?.skipChecksum) {
      if (!want || got !== want) throw new Error(`Checksum mismatch.\nExpected: ${want}\nGot: ${got}`);
    } else {
      console.log('[DEV] skipping checksum verification');
    }

    send('patch:status', { phase:'unzip', message:'Extracting files…' });
    await expandZipPowershell(tmpZip, destDir);

    const bad = await verifyInstalled(manifest, destDir);
    if (!settings.dev?.skipChecksum && bad.length) throw new Error(`Post-install verify failed for ${bad.length} file(s).`);

    fs.writeFileSync(path.join(destDir, 'installed.json'), JSON.stringify({
      component:'nsfw_patch',
      version: manifest.version,
      installedAt: new Date().toISOString()
    }, null, 2), 'utf-8');

    send('patch:done', { ok:true, message:`Installed NSFW ${manifest.version}` });
  } catch (e) {
    evt.sender.send('patch:done', { ok:false, error:String(e) });
  }
});

// ---------- IPC: Patch verify/repair ----------
ipcMain.on('patch:verify', async (evt) => {
  const send = (ch,p)=>evt.sender.send(ch,p);
  try {
    const manifest = await httpGetJsonRetry(settings.patch.manifestUrl, 3);
    const exeDir = path.dirname(readConfig().exePath);
    const destDir = path.join(exeDir, settings.patch.destSubdir);

    const bad = await verifyInstalled(manifest, destDir);
    if (bad.length === 0) return send('patch:verify:done', { ok:true, repaired:false, issues:0 });

    const tmpZip = path.join(app.getPath('temp'), `nsfw_${manifest.version}.zip`);
    if (!fs.existsSync(tmpZip)) {
      await downloadResumable(manifest.url, tmpZip);
      const got = fileSha256Sync(tmpZip).toLowerCase();
      const want = String(manifest.sha256||'').toLowerCase();
      if (!want || got !== want) throw new Error('Redownload checksum failed');
    }
    await expandZipPowershell(tmpZip, destDir);
    const bad2 = await verifyInstalled(manifest, destDir);
    if (bad2.length) return send('patch:verify:done', { ok:false, repaired:false, issues: bad2.length });
    send('patch:verify:done', { ok:true, repaired:true, issues:0 });
  } catch(e){
    evt.sender.send('patch:verify:done', { ok:false, error:String(e) });
  }
});

// ---------- IPC: NSFW toggle/uninstall ----------
ipcMain.handle('nsfw:toggle', async (_e, enable) => {
  const exePath = readConfig().exePath;
  if (!isValidExe(exePath)) return { ok:false, error:'Game EXE not set' };
  const exeDir = path.dirname(exePath);
  const onPath = path.join(exeDir, settings.patch.destSubdir);
  const offPath = onPath.replace(/nsfw$/,'nsfw.disabled');

  try {
    if (enable) {
      if (fs.existsSync(offPath) && !fs.existsSync(onPath)) fs.renameSync(offPath, onPath);
    } else {
      if (fs.existsSync(onPath) && !fs.existsSync(offPath)) fs.renameSync(onPath, offPath);
    }
    return { ok:true };
  } catch(e){ return { ok:false, error:String(e) }; }
});
ipcMain.handle('nsfw:uninstall', async () => {
  const exePath = readConfig().exePath;
  if (!isValidExe(exePath)) return { ok:false, error:'Game EXE not set' };
  const exeDir = path.dirname(exePath);
  const onPath = path.join(exeDir, settings.patch.destSubdir);
  const offPath = onPath.replace(/nsfw$/,'nsfw.disabled');
  const target = fs.existsSync(onPath) ? onPath : (fs.existsSync(offPath) ? offPath : null);
  if (!target) return { ok:true };

  const rm = p => { if (fs.existsSync(p)) { for (const f of fs.readdirSync(p)) {
      const fp = path.join(p,f); const st = fs.lstatSync(fp);
      if (st.isDirectory()) rm(fp); else fs.unlinkSync(fp);
    } fs.rmdirSync(p); } };
  try { rm(target); return { ok:true }; }
  catch(e){ return { ok:false, error:String(e) }; }
});

// ---------- IPC: Patch versions badge ----------
ipcMain.handle('patch:versions', async () => {
  try {
    const manifest = await httpGetJsonRetry(settings.patch.manifestUrl, 3);
    const installed = getInstalledPatchInfo();
    return { ok:true, manifestVersion: manifest.version || null, installedVersion: installed?.version || null };
  } catch (e) {
    const installed = getInstalledPatchInfo();
    return { ok:false, error:String(e), installedVersion: installed?.version || null };
  }
});
