const $ = (q) => document.querySelector(q);
const escapeHtml = (s) => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

function humanBytes(b){ if(b==null) return ''; const u=['B','KB','MB','GB']; let i=0,x=b; while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${x.toFixed(1)} ${u[i]}`; }
function humanSpeed(bps){ return bps? `${humanBytes(bps)}/s` : ''; }

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

async function init(){
  // title (for the custom bar) and version
  const title = await window.api.appTitle();
  $('#titleText').textContent = title;

  const v = await window.api.appVersion();
  $('#appVersion').textContent = `v${v}`;

  // window buttons
  $('#btnMin').addEventListener('click', () => window.api.winMinimize());
  $('#btnClose').addEventListener('click', () => window.api.winClose());

  // logo
  const logoPath = await window.api.logoPath();
  $('#logoImg').src = `file://${logoPath.replace(/\\/g,'/')}`;

  // Ensure exe on first run (prompts if missing)
  await window.api.ensureExe();

  // News
  const res = await window.api.fetchNews();
  if (res?.ok) renderNews(res.items || []);
  else renderNews([{ title: "No news available", body: res?.error || "" }]);

  // Patch badge from manifest + installed
  await refreshPatchBadge();

  // Launch
  $('#btnLaunch').addEventListener('click', async () => {
    $('#btnLaunch').disabled = true;
    const r = await window.api.launchGame();
    if (!r?.ok){ alert("Launch failed: " + (r?.error || "Unknown error")); $('#btnLaunch').disabled = false; }
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
    const pct = Math.max(0, Math.min(100, p.percent || 0));
    $('#patchBar').style.width = `${pct.toFixed(1)}%`;
    $('#patchInfo').textContent = `${pct.toFixed(1)}%  •  ${humanBytes(p.downloaded)}/${humanBytes(p.total)}  •  ${humanSpeed(p.speed||0)}`;
  });
  window.api.onPatchDone(async (d) => {
    if (d.ok) $('#patchPhase').textContent = d.message || 'Done';
    else { $('#patchPhase').textContent = 'Patch failed'; alert(d.error || 'Patch failed'); }
    $('#btnPatch').disabled = false;
    if (!d.ok){ $('#patchBar').style.width = '0%'; $('#patchInfo').textContent = ''; }
    await refreshPatchBadge();
  });
}

window.addEventListener('DOMContentLoaded', init);
