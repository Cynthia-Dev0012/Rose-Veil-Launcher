// renderer.js
(function(){
  const $ = (q) => document.querySelector(q);

  function must(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing DOM element #${id}`);
    return el;
  }

  async function safeInit() {
    console.log('[boot] starting…');
    if (!window.api) throw new Error('preload did not expose window.api');
    console.log('[boot] api methods:', Object.keys(window.api || {}));

    // Title/version/logo
    $('#titleText') && (document.getElementById('titleText').textContent = await window.api.appTitle());
    $('#appVersion') && (document.getElementById('appVersion').textContent = 'v' + await window.api.appVersion());
    const logoPath = await window.api.logoPath();
    const logo = document.getElementById('logoImg');
    if (logo) logo.src = `file://${logoPath.replace(/\\/g,'/')}`;

    // First-run card (no dialogs)
    if (typeof showFirstRunIfNeeded === 'function') {
      await showFirstRunIfNeeded();
    }

    // Launcher update banner
    if (typeof checkLauncherUpdate === 'function') {
      await checkLauncherUpdate();
    }

    // News (show offline banner only on real failure)
    if (typeof renderNews === 'function') {
      const news = await window.api.fetchNews();
      console.log('[news] response:', news);
      const banner = document.getElementById('offlineBanner');

      if (news?.ok) {
        const list = Array.isArray(news.items) ? news.items : [];
        renderNews(list.length ? list : [{ title: 'No news yet', body: 'Your news.json is empty.' }]);
        if (banner) banner.style.display = 'none';
      } else {
        renderNews([{ title: 'News unavailable', body: String(news?.error || 'Unknown error') }]);
        if (banner) banner.style.display = 'block';
      }
    }

    // Patch badge refresh (if function exists)
    if (typeof refreshPatchBadge === 'function') {
      await refreshPatchBadge();
    }

    // Wire buttons only if they exist
    const btnMin = document.getElementById('btnMin');
    if (btnMin) btnMin.onclick = () => window.api.winMinimize();

    const btnClose = document.getElementById('btnClose');
    if (btnClose) btnClose.onclick = () => window.api.winClose();

    const btnLaunch = document.getElementById('btnLaunch');
    if (btnLaunch) btnLaunch.onclick = async () => {
      btnLaunch.disabled = true;
      const r = await window.api.launchGame();
      if (!r?.ok) { alert(r?.error || 'Launch failed'); btnLaunch.disabled = false; }
    };

    const btnPatch = document.getElementById('btnPatch');
    if (btnPatch) {
      btnPatch.onclick = () => {
        btnPatch.disabled = true;
        const bar = document.getElementById('patchBar');
        const phase = document.getElementById('patchPhase');
        const info = document.getElementById('patchInfo');
        if (bar) bar.style.width = '0%';
        if (phase) phase.textContent = 'Starting…';
        if (info) info.textContent = '';
        window.api.startPatch?.();
      };
      window.api.onPatchStatus?.((d) => { const e = document.getElementById('patchPhase'); if (e) e.textContent = d.message || d.phase || ''; });
      window.api.onPatchProgress?.((p) => {
        const pct = Math.max(0, Math.min(100, p.percent || 0)).toFixed(1);
        const bar = document.getElementById('patchBar');
        const info = document.getElementById('patchInfo');
        if (bar) bar.style.width = `${pct}%`;
        if (info) info.textContent = `${pct}%`;
      });
      window.api.onPatchDone?.(async (d) => {
        const phase = document.getElementById('patchPhase');
        if (d.ok) phase && (phase.textContent = d.message || 'Done');
        else { phase && (phase.textContent = 'Patch failed'); alert(d.error || 'Patch failed'); }
        btnPatch.disabled = false;
        if (!d.ok) { const bar = document.getElementById('patchBar'); const info = document.getElementById('patchInfo'); if (bar) bar.style.width = '0%'; if (info) info.textContent = ''; }
        if (typeof refreshPatchBadge === 'function') await refreshPatchBadge();
      });
    }

    const btnVerify = document.getElementById('btnVerify');
    if (btnVerify && window.api.startVerify) {
      btnVerify.onclick = () => { btnVerify.disabled = true; const s = document.getElementById('verifyStatus'); if (s) s.textContent = 'Verifying…'; window.api.startVerify(); };
      window.api.onVerifyDone?.((d) => {
        const s = document.getElementById('verifyStatus');
        if (d.ok && d.repaired) s && (s.textContent = 'Verified & repaired');
        else if (d.ok) s && (s.textContent = 'All files OK');
        else { s && (s.textContent = 'Verify failed'); alert(d.error || 'Verify failed'); }
        btnVerify.disabled = false;
      });
    }

    const btnNsfwToggle = document.getElementById('btnNsfwToggle');
    if (btnNsfwToggle && window.api.nsfwToggle) {
      btnNsfwToggle.onclick = async () => {
        const enable = btnNsfwToggle.dataset.state !== 'enabled';
        btnNsfwToggle.disabled = true;
        const r = await window.api.nsfwToggle(enable);
        if (!r?.ok) alert(r?.error || 'Toggle failed');
        btnNsfwToggle.disabled = false;
        btnNsfwToggle.dataset.state = enable ? 'enabled' : 'disabled';
        btnNsfwToggle.textContent = enable ? 'Disable NSFW' : 'Enable NSFW';
        if (typeof refreshPatchBadge === 'function') await refreshPatchBadge();
      };
    }

    const btnNsfwUninstall = document.getElementById('btnNsfwUninstall');
    if (btnNsfwUninstall && window.api.nsfwUninstall) {
      btnNsfwUninstall.onclick = async () => {
        if (!confirm('Remove NSFW patch files?')) return;
        btnNsfwUninstall.disabled = true;
        const r = await window.api.nsfwUninstall();
        if (!r?.ok) alert(r?.error || 'Uninstall failed');
        btnNsfwUninstall.disabled = false;
        if (btnNsfwToggle) { btnNsfwToggle.dataset.state = 'disabled'; btnNsfwToggle.textContent = 'Enable NSFW'; }
        if (typeof refreshPatchBadge === 'function') await refreshPatchBadge();
      };
    }

    const btnOpenMods = document.getElementById('btnOpenMods');
    if (btnOpenMods && window.api.modsOpen) {
      btnOpenMods.onclick = async () => {
        const r = await window.api.modsOpen();
        if (!r?.ok) alert(r?.error || 'Mods folder unavailable');
      };
    }

    console.log('[boot] init complete');
  }

  window.addEventListener('DOMContentLoaded', () => {
    safeInit().catch(e => {
      console.error('[boot] init crash:', e);
      alert('Launcher init failed: ' + e.message);
    });
  });
})();


const $ = (q) => document.querySelector(q);
const escapeHtml = (s) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

function humanBytes(b){ if(b==null) return ''; const u=['B','KB','MB','GB']; let i=0,x=b; while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${x.toFixed(1)} ${u[i]}`; }



function renderNews(items){
  const wrap = $('#newsList'); wrap.innerHTML = "";
  items.forEach(it => {
    const card = document.createElement('div');
    card.className = 'news-card';
    card.innerHTML = `
      <div class="news-title">${escapeHtml(it.title || "Update")}</div>
      <div class="news-date">${escapeHtml(it.date || "")}</div>
      <div class="news-body">${escapeHtml(it.body || "")}</div>`;
    wrap.appendChild(card);
  });
}


async function refreshPatchBadge(){
  const badge = $('#patchBadge');
  const res = await window.api.patchVersions();
  let text = 'Patch: unavailable';
  if (res.ok) {
    const m = res.manifestVersion || '?';
    if (res.installedVersion && res.installedVersion === m) {
      text = `Patch v${m} ✓ installed`;
      badge.classList.add('ok');
    } else if (res.installedVersion) {
      text = `Patch v${res.installedVersion} • latest v${m}`;
      badge.classList.remove('ok');
    } else {
      text = `Patch v${m} • not installed`;
      badge.classList.remove('ok');
    }
  } else {
    if (res.installedVersion) {
      text = `Patch v${res.installedVersion} (offline)`;
      badge.classList.remove('ok');
    }
  }
  badge.textContent = text;
}

async function showFirstRunIfNeeded(){
  const st = await window.api.exeStatus();
  const setup = document.getElementById('setupCard');
  const appWrap = document.querySelector('.app');
  if (!st.ok) {
    setup.style.display = 'flex';
    appWrap.style.filter = 'blur(2px)';
    const btn = document.getElementById('btnChooseExe');
    const status = document.getElementById('setupStatus');
    btn.onclick = async () => {
      btn.disabled = true; status.textContent = 'Waiting for selection…';
      const res = await window.api.exeChoose();
      btn.disabled = false;
      if (res?.ok) { setup.style.display = 'none'; appWrap.style.filter = ''; }
      else { status.textContent = res?.error || 'No file chosen / invalid.'; }
    };
    return false;
  } else {
    setup.style.display = 'none';
    appWrap.style.filter = '';
    return true;
  }
}

async function checkLauncherUpdate(){
  const banner = document.getElementById('updateBanner');
  const text = document.getElementById('updateText');
  const btn = document.getElementById('btnUpdate');

  const res = await window.api.updateCheck();
  if (res?.ok && res.newer) {
    text.textContent = `Launcher update: v${res.latest} available (you have v${res.current})`;
    banner.style.display = 'flex';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Downloading…';
      const r = await window.api.updateStart({ url: res.url, sha256: res.sha256 });
      if (!r?.ok) { alert(r?.error || 'Update failed'); btn.disabled = false; btn.textContent = 'Update'; }
      else { btn.textContent = 'Launching installer…'; }
    };
  } else {
    banner.style.display = 'none';
  }
}

function initMods(){
  const status = document.getElementById('modsStatus');
  document.getElementById('btnOpenMods').addEventListener('click', async () => {
    const r = await window.api.modsOpen();
    if (!r?.ok) alert(r?.error || 'Mods folder unavailable');
  });
  window.api.onModsWatch((d) => {
    if (d.type === 'ready') status.textContent = `Watching: ${d.dir}`;
    if (d.type === 'change') status.textContent = `Change: ${d.eventType} ${d.filename||''}`;
    if (d.type === 'error') status.textContent = d.message || 'Watch error';
  });
  window.api.modsWatchStart();
  window.addEventListener('beforeunload', () => window.api.modsWatchStop());
}


async function init(){
  $('#titleText').textContent = await window.api.appTitle();
  $('#appVersion').textContent = `v${await window.api.appVersion()}`;
  $('#btnMin').addEventListener('click', () => window.api.winMinimize());
  $('#btnClose').addEventListener('click', () => window.api.winClose());
  await showFirstRunIfNeeded();       // show setup card if needed (no dialogs)
await checkLauncherUpdate();        // banner if newer launcher exists
initMods();                         // mods open/watch

  async function ensureFirstRunUI(){
  const st = await window.api.exeStatus();
  const setup = document.getElementById('setupCard');
  if (!st.ok) {
    setup.style.display = 'flex';
    document.querySelector('.app').style.filter = 'blur(2px)';
    const btn = document.getElementById('btnChooseExe');
    const status = document.getElementById('setupStatus');
    btn.onclick = async () => {
      btn.disabled = true; status.textContent = 'Waiting for selection…';
      const res = await window.api.exeChoose();
      if (res?.ok) {
        setup.style.display = 'none';
        document.querySelector('.app').style.filter = '';
      } else {
        status.textContent = res?.error || 'No file chosen / invalid.';
      }
      btn.disabled = false;
    };
    return false;
  } else {
    setup.style.display = 'none';
    document.querySelector('.app').style.filter = '';
    return true;
  }
}

async function checkLauncherUpdate(){
  const banner = document.getElementById('updateBanner');
  const text = document.getElementById('updateText');
  const btn = document.getElementById('btnUpdate');

  const res = await window.api.updateCheck();
  if (res?.ok && res.newer) {
    text.textContent = `Launcher update available: v${res.latest} (you have v${res.current})`;
    banner.style.display = 'flex';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Downloading…';
      const r = await window.api.updateStart({ url: res.url, sha256: res.sha256 });
      if (!r?.ok) {
        alert(r?.error || 'Update failed');
        btn.disabled = false; btn.textContent = 'Update';
      } else {
        btn.textContent = 'Launching installer…';
      }
    };
  } else {
    banner.style.display = 'none';
  }
}

function startModsWatcher(){
  const status = document.getElementById('modsStatus');
  window.api.onModsWatch((d) => {
    if (d.type === 'ready') status.textContent = `Watching: ${d.dir}`;
    if (d.type === 'change') status.textContent = `Change: ${d.eventType} ${d.filename || ''}`;
    if (d.type === 'error') status.textContent = d.message || 'Watch error';
  });
  window.api.modsWatchStart();
}

document.getElementById('btnOpenMods').addEventListener('click', async () => {
  const r = await window.api.modsOpen();
  if (!r?.ok) alert(r?.error || 'Mods folder unavailable');
});

startModsWatcher();
window.addEventListener('beforeunload', () => window.api.modsWatchStop());



  const logoPath = await window.api.logoPath();
  $('#logoImg').src = `file://${logoPath.replace(/\\/g,'/')}`;

 await ensureFirstRunUI();

  //dev mode
  if ((await window.api.getSettings?.())?.dev?.skipChecksum) {
  const devTag = document.createElement('div');
  devTag.textContent = 'DEV MODE: skipChecksum enabled';
  devTag.style.cssText = 'position:fixed;bottom:4px;left:4px;font-size:11px;color:#ffb3b3;opacity:0.7;';
  document.body.appendChild(devTag);
}



// News + offline banner (show only on real failure)
const news = await window.api.fetchNews();
console.log('[news] response:', news);

if (news?.ok) {
  const list = Array.isArray(news.items) ? news.items : [];
  renderNews(list.length ? list : [{ title: "No news yet", body: "Your news.json is empty." }]);
  // hide banner whenever we have usable news
  document.getElementById('offlineBanner').style.display = 'none';
} else {
  renderNews([{ title: "News unavailable", body: String(news?.error || 'Unknown error') }]);
  document.getElementById('offlineBanner').style.display = 'block';
}


  // Launch
  $('#btnLaunch').addEventListener('click', async () => {
    $('#btnLaunch').disabled = true;
    const r = await window.api.launchGame();
    if (!r?.ok){ alert(r?.error || 'Launch failed'); $('#btnLaunch').disabled = false; }
  });

  // Patch
  $('#btnPatch').addEventListener('click', () => {
    $('#btnPatch').disabled = true;
    $('#patchBar').style.width = '0%';
    $('#patchPhase').textContent = 'Starting…';
    $('#patchInfo').textContent = '';
    window.api.startPatch();
  });
  window.api.onPatchStatus((d) => { $('#patchPhase').textContent = d.message || d.phase || ''; });
  window.api.onPatchProgress((p) => {
    const pct = Math.max(0, Math.min(100, p.percent || 0)).toFixed(1);
    $('#patchBar').style.width = `${pct}%`;
    $('#patchInfo').textContent = `${pct}%  •  ${humanBytes(p.downloaded)}/${humanBytes(p.total)}`;
  });
  window.api.onPatchDone(async (d) => {
    if (d.ok) $('#patchPhase').textContent = d.message || 'Done';
    else { $('#patchPhase').textContent = 'Patch failed'; alert(d.error || 'Patch failed'); }
    $('#btnPatch').disabled = false;
    if (!d.ok){ $('#patchBar').style.width = '0%'; $('#patchInfo').textContent = ''; }
    await refreshPatchBadge();
  });

  // Verify/Repair
  $('#btnVerify').addEventListener('click', () => {
    $('#btnVerify').disabled = true;
    $('#verifyStatus').textContent = 'Verifying…';
    window.api.startVerify();
  });
  window.api.onVerifyDone((d) => {
    if (d.ok && d.repaired) $('#verifyStatus').textContent = 'Verified & repaired';
    else if (d.ok) $('#verifyStatus').textContent = 'All files OK';
    else $('#verifyStatus').textContent = 'Verify failed';
    if (!d.ok && d.error) alert(d.error);
    $('#btnVerify').disabled = false;
  });

  // NSFW toggle + uninstall
  const nsfwToggle = $('#btnNsfwToggle');
  const nsfwUninstall = $('#btnNsfwUninstall');

  nsfwToggle.addEventListener('click', async () => {
    const enable = nsfwToggle.dataset.state !== 'enabled';
    nsfwToggle.disabled = true;
    const r = await window.api.nsfwToggle(enable);
    if (!r?.ok) alert(r?.error || 'Toggle failed');
    nsfwToggle.disabled = false;
    nsfwToggle.dataset.state = enable ? 'enabled' : 'disabled';
    nsfwToggle.textContent = enable ? 'Disable NSFW' : 'Enable NSFW';
    await refreshPatchBadge();
  });

  nsfwUninstall.addEventListener('click', async () => {
    if (!confirm('Remove NSFW patch files?')) return;
    nsfwUninstall.disabled = true;
    const r = await window.api.nsfwUninstall();
    if (!r?.ok) alert(r?.error || 'Uninstall failed');
    nsfwUninstall.disabled = false;
    nsfwToggle.dataset.state = 'disabled';
    nsfwToggle.textContent = 'Enable NSFW';
    await refreshPatchBadge();
  });
}

window.addEventListener('DOMContentLoaded', init);
