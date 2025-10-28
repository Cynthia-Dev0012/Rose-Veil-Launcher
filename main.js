const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---------- SETTINGS LOADER ----------
function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return b; // override arrays
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
  window: { width: 860, height: 540, resizable: false }
};

function loadJsonSafe(p) {
  try {
    const txt = fs.readFileSync(p, 'utf-8');
    // strip possible BOM
    let s = txt.charCodeAt(0) === 0xFEFF ? txt.slice(1) : txt;
    return JSON.parse(s);
  } catch { return null; }
}

function loadSettings() {
  const appDir = path.dirname(__filename);
  const distCfg = loadJsonSafe(path.join(appDir, 'roseveil.settings.json')) || {};
  // local per-user override lives in userData
  const localCfg = loadJsonSafe(path.join(app.getPath('userData'), 'roseveil.local.json')) || {};
  return deepMerge(deepMerge(DEFAULTS, distCfg), localCfg);
}

const settings = loadSettings();
const APP_TITLE = settings.appTitle;
const LOGO_PATH = path.join(__dirname, settings.logoPath);
const ALLOWED_EXE_NAME = settings.exe.name;
const HASH_WHITELIST = settings.exe.sha256Whitelist || [];
const NEWS_URL = settings.news.url;
const NEWS_TIMEOUT = settings.news.timeoutMs || 12000;
const PATCH_MANIFEST_URL = settings.patch.manifestUrl;
const PATCH_DEST_SUBDIR = settings.patch.destSubdir;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
// ------------------------------------
/*
Example nsfw_manifest.json:
{
  "version": "1.0.0",
  "url": "https://cdn.example.com/dlc/nsfw_patch_1.0.0.zip",
  "sha256": "abcdef1234...lowercasehex",
  "size_bytes": 842000000
}
*/
// =============================

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

function createWindow() {
  const win = new BrowserWindow({
    width: settings.window.width,
    height: settings.window.height,
    resizable: !!settings.window.resizable,
    title: APP_TITLE,
    backgroundColor: "#101014",
    icon: LOGO_PATH,
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

// ---------- Helpers ----------
function fileSha256Sync(p) {
  const h = crypto.createHash('sha256');
  const data = fs.readFileSync(p);
  h.update(data);
  return h.digest('hex');
}
function isValidExe(p) {
  if (!p || !fs.existsSync(p)) return false;
  if (path.basename(p) !== ALLOWED_EXE_NAME) return false;
  if (HASH_WHITELIST.length === 0) return true;
  try {
    const sha = fileSha256Sync(p);
    return HASH_WHITELIST.includes(sha.toLowerCase());
  } catch { return false; }
}
async function promptForExe(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win || BrowserWindow.getFocusedWindow(), {
    title: `Select ${ALLOWED_EXE_NAME}`,
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

// robust JSON parsing (handles BOM and stray characters)
function safeParseJSON(txt) {
  if (typeof txt !== 'string') throw new Error('Not text');
  // strip BOM
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  const start = Math.min(
    ...['{','['].map(sym => {
      const i = txt.indexOf(sym);
      return i === -1 ? Number.POSITIVE_INFINITY : i;
    })
  );
  if (!isFinite(start)) throw new Error('No JSON start found');
  // try to cut to last closing brace/bracket
  const lastBrace = txt.lastIndexOf('}');
  const lastBracket = txt.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  const core = txt.slice(start, end + 1).trim();
  return JSON.parse(core);
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const chunks = [];
    req.on('response', (resp) => {
      const status = resp.statusCode || 0;
      resp.on('data', c => chunks.push(Buffer.from(c)));
      resp.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (status < 200 || status >= 300) {
          return reject(new Error(`HTTP ${status}: ${body.slice(0,150)}...`));
        }
        try { resolve(safeParseJSON(body)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function downloadWithProgress(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const out = fs.createWriteStream(dest);
    const hash = crypto.createHash('sha256');
    let downloaded = 0;
    let total = 0;
    let lastTick = Date.now();
    let lastBytes = 0;

    req.on('response', (resp) => {
      total = Number(resp.headers['content-length']) || 0;
      resp.on('data', (chunk) => {
        downloaded += chunk.length;
        hash.update(chunk);
        out.write(chunk);

        const now = Date.now();
        if (now - lastTick >= 250) {
          const delta = downloaded - lastBytes;
          const speed = delta / ((now - lastTick) / 1000);
          lastTick = now; lastBytes = downloaded;
          onProgress?.({ phase:'downloading', downloaded, total, percent: total? (downloaded/total)*100: 0, speed });
        }
      });
      resp.on('end', () => out.end(() =>
        resolve({ sha256: hash.digest('hex'), size: downloaded, total })
      ));
    });
    req.on('error', (e) => reject(e));
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

// read installed patch version next to game exe
function getInstalledPatchInfo() {
  try {
    const cfg = readConfig();
    const exeDir = path.dirname(cfg.exePath);
    const installedPath = path.join(exeDir, 'DLC', 'nsfw', 'installed.json');
    if (!fs.existsSync(installedPath)) return null;
    return JSON.parse(fs.readFileSync(installedPath, 'utf-8'));
  } catch { return null; }
}

// ---------- IPC ----------
ipcMain.handle('app:title', () => APP_TITLE);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('logo:path', () => LOGO_PATH);

// window controls
ipcMain.handle('win:minimize', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.minimize(); });
ipcMain.handle('win:close', () => { const w = BrowserWindow.getFocusedWindow(); if (w) w.close(); });

// News
ipcMain.handle('news:fetch', async () => {
  if (!NEWS_URL) return { ok: false, error: "NEWS_URL not set." };
  try {
    const json = await httpGetJson(NEWS_URL);
    const items = Array.isArray(json) ? json : (json.items || []);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

// EXE ensure + Launch
ipcMain.handle('exe:ensure', async () => {
  const res = ensureExeOrPrompt();
  if (res.ok) return res;
  return await promptForExe();
});
ipcMain.handle('game:launch', async () => {
  let exePath;
  const ensured = ensureExeOrPrompt();
  if (ensured.ok) exePath = ensured.exePath;
  else {
    const prompted = await promptForExe();
    if (!prompted.ok) return { ok: false, error: prompted.error || "No EXE selected." };
    exePath = prompted.exePath;
  }
  try {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => app.quit(), 150);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Patch: manifest + download + verify + unzip + installed flag
ipcMain.on('patch:start', async (evt) => {
  const send = (ch, p) => evt.sender.send(ch, p);
  try {
    send('patch:status', { phase: 'manifest', message: 'Fetching manifest…' });
    const manifest = await httpGetJson(PATCH_MANIFEST_URL); // {version,url,sha256,size_bytes}

    const cfg = readConfig();
    if (!isValidExe(cfg.exePath)) {
      const prompt = await promptForExe();
      if (!prompt.ok) throw new Error(prompt.error || "Game EXE not set.");
    }
    const exeDir = path.dirname(readConfig().exePath);
    const destDir = path.join(exeDir, 'DLC', 'nsfw');

    const tmpZip = path.join(app.getPath('temp'), `nsfw_${manifest.version}.zip`);
    try { fs.unlinkSync(tmpZip); } catch {}

    send('patch:status', { phase: 'download', message: 'Downloading patch…' });
    await downloadWithProgress(manifest.url, tmpZip, (p) => {
      send('patch:progress', p);
    });

    send('patch:status', { phase: 'verify', message: 'Verifying checksum…' });
    const fileSha = crypto.createHash('sha256').update(fs.readFileSync(tmpZip)).digest('hex').toLowerCase();
    const want = String(manifest.sha256 || '').toLowerCase();
    if (!want || fileSha !== want) throw new Error(`Checksum mismatch.\nExpected: ${want}\nGot: ${fileSha}`);

    send('patch:status', { phase: 'unzip', message: 'Extracting files…' });
    await expandZipPowershell(tmpZip, destDir);

    fs.writeFileSync(path.join(destDir, 'installed.json'), JSON.stringify({
      component: 'nsfw_patch',
      version: manifest.version,
      installedAt: new Date().toISOString()
    }, null, 2), 'utf-8');

    send('patch:done', { ok: true, message: `Installed NSFW ${manifest.version}` });
  } catch (e) {
    send('patch:done', { ok: false, error: String(e) });
  }
});

// expose manifest + installed version for badge
ipcMain.handle('patch:versions', async () => {
  try {
    const manifest = await httpGetJson(PATCH_MANIFEST_URL);
    const installed = getInstalledPatchInfo();
    return { ok: true, manifestVersion: manifest.version || null, installedVersion: installed?.version || null };
  } catch (e) {
    const installed = getInstalledPatchInfo();
    return { ok: false, error: String(e), installedVersion: installed?.version || null };
  }
});
