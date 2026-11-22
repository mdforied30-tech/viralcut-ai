import { state, save, uid, blobPut, blobGet, blobDel, DEFAULTS } from './store.js';
import { PRESETS, FONT_FAMILIES, ANIMS, clonePreset, ensureFonts, drawCaptions, buildTimeline, chunkAt, keywordSet } from './captions.js';
import { engine, RATIOS, FILTERS, outputSize, pickMime } from './engine.js';
import { makeZip } from './zip.js';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => { s = Math.max(0, s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const slug = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'viralcut';
const YT = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;
const ytId = (u) => { const m = String(u || '').trim().match(YT); return m ? m[1] : null; };
const opts = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const getProject = (id) => state.projects.find((p) => p.id === id);
const DURS = [30, 45, 60, 90, 120, 150, 180];
const durOpts = (v) => opts(DURS.map((d) => [d, d + ' sec']), v);
const COUNTS = [[5, '5 clips'], [10, '10 clips'], [15, '15 clips'], [20, '20 clips'], ['auto', 'Auto-select best clips']];
const LANGS = [['English', 'English'], ['Bengali', 'Bengali (বাংলা)'], ['Hindi', 'Hindi (हिन्दी)']];
const RATIO_LIST = Object.keys(RATIOS).map((r) => [r, r + (r === '9:16' ? ' Vertical' : r === '16:9' ? ' Landscape' : r === '1:1' ? ' Square' : ' Portrait')]);

function toast(msg, kind = '', ms = 3500) {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied', 'ok', 1500); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied', 'ok', 1500); } catch { toast('Copy failed', 'err'); } ta.remove(); }
}
window.addEventListener('vc-save-error', () => toast('Browser storage is full. Delete old projects in My Projects.', 'err', 6000));

async function api(action, body, signal) {
  let res;
  try {
    res = await fetch('/.netlify/functions/api', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-access-code': state.settings.accessCode || '' }, body: JSON.stringify({ action, ...body }) });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Cannot reach the backend. Check your internet connection. (The AI features only work on the deployed Netlify site.)');
  }
  const txt = await res.text();
  let data = null; try { data = JSON.parse(txt); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (!data) {
      if (res.status === 404) throw new Error('Backend function not found. Deploy the whole repository on Netlify (the netlify/functions folder is required).');
      if (res.status === 502 || res.status === 504) throw new Error('The server timed out while the AI was working. Try a shorter video, or raise the Netlify function timeout.');
      throw new Error('Server error ' + res.status);
    }
    throw new Error(data.error || 'Server error ' + res.status);
  }
  return data;
}

/* ---------- state for UI ---------- */
const ui = {
  url: '', meta: null, metaTimer: 0, status: null, analyzing: false, ctl: null, backend: null,
  pf: { filter: 'all', sort: 'score', pid: null, sel: new Set() },
  ed: null, studio: null, cleanup: null, tab: 'captions', job: null, contentLang: null,
};

/* ---------- routing / layout ---------- */
const NAV = [['dashboard', 'Dashboard', '◉'], ['create', 'Create Viral Clips', '✦'], ['projects', 'My Projects', '▤'], ['clips', 'All Clips', '▶'], ['studio', 'Caption Studio', 'Aa'], ['templates', 'Templates', '❖'], ['exports', 'Export History', '⬇'], ['settings', 'Settings', '⚙']];
function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [path, qs] = raw.split('?');
  const [name, ...args] = path.split('/');
  return { name: name || 'dashboard', args, q: new URLSearchParams(qs || '') };
}
function layout(active, body) {
  return `<div class="shell"><aside class="side"><div class="brand"><span class="logo">▲</span><span>VIRALCUT <b>AI</b></span></div>
  <nav>${NAV.map(([k, l, i]) => `<a href="#/${k}" class="${k === active ? 'on' : ''}"><i>${i}</i><span>${l}</span></a>`).join('')}</nav></aside>
  <main class="main">${body}</main></div>`;
}
const notFound = (what) => `<div class="card"><h2>${what} not found</h2><p class="muted">It may have been deleted.</p><a class="btn" href="#/projects">My Projects</a></div>`;

function render() {
  if (ui.cleanup) { ui.cleanup(); ui.cleanup = null; }
  if (!engine.busy) engine.pause();
  ui.ed = null;
  const r = route();
  let body = '', active = r.name, after = null;
  switch (r.name) {
    case 'dashboard': body = dashboardPage(); break;
    case 'create': body = backendBanner() + createPanel(false) + howItWorks(); break;
    case 'projects': body = projectsPage(); break;
    case 'project': { const p = getProject(r.args[0]); body = p ? projectPage(p) : notFound('Project'); active = 'projects'; if (p) after = () => projectAfter(p); break; }
    case 'clips': body = allClipsPage(); break;
    case 'clip': { const p = getProject(r.args[0]); const c = p && p.clips.find((x) => x.id === r.args[1]); body = c ? editorPage(p, c) : notFound('Clip'); active = 'projects'; if (c) after = () => initEditor(p, c, r.q.get('play') === '1'); break; }
    case 'studio': body = studioPage(); after = initStudio; break;
    case 'templates': body = templatesPage(); break;
    case 'exports': body = exportsPage(); break;
    case 'settings': body = settingsPage(); break;
    default: body = notFound('Page');
  }
  $('#app').innerHTML = layout(active, body);
  if (r.name === 'create' || r.name === 'dashboard') bindUrlInput();
  window.scrollTo(0, 0);
  if (after) after();
}
window.addEventListener('hashchange', render);

/* ---------- backend status ---------- */
async function pingBackend() {
  try {
    const res = await fetch('/.netlify/functions/api', { headers: { 'x-access-code': state.settings.accessCode || '' } });
    ui.backend = res.ok ? await res.json() : { error: res.status };
  } catch { ui.backend = { error: 'offline' }; }
}
function backendBanner() {
  const b = ui.backend;
  if (!b) return '';
  if (b.error) return `<div class="alert err"><b>Backend not reachable.</b> The AI analysis needs the Netlify Function. ${b.error === 404 ? 'Deploy the full repository to Netlify (not only the public folder).' : 'Check your connection.'}</div>`;
  if (!b.configured) return `<div class="alert err"><b>GEMINI_API_KEY is missing.</b> In Netlify: Site configuration → Environment variables → add <code>GEMINI_API_KEY</code>, then redeploy.</div>`;
  if (b.accessCodeRequired && !b.authorized) return `<div class="alert err"><b>Access code needed.</b> Enter it in <a href="#/settings">Settings</a>.</div>`;
  return '';
}

/* ---------- create panel ---------- */
function metaHtml() {
  const id = ytId(ui.url);
  if (!ui.url.trim()) return `<p class="muted">Supports youtube.com/watch, youtu.be, Shorts and Live links.</p>`;
  if (!id) return `<p class="bad">That is not a valid YouTube video link.</p>`;
  const m = ui.meta && ui.meta.id === id ? ui.meta : null;
  const st = m ? m.status : 'checking';
  const label = { available: 'Available', private: 'Private', unavailable: 'Unavailable / removed', restricted: 'Restricted (embedding off)', unknown: 'Status unknown', checking: 'Checking…' }[st] || st;
  return `<div class="preview"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="Video thumbnail">
  <div><h3>${esc((m && m.title) || 'Video ' + id)}</h3>
  <div class="muted">Channel: ${esc((m && m.channel) || '—')} · Duration: ${m && m.duration ? fmt(m.duration) : 'shown after analysis'}</div>
  <span class="chip ${st === 'available' ? 'ok' : st === 'checking' || st === 'unknown' ? '' : 'warn'}">${label}</span></div></div>`;
}
function statusHtml() {
  const s = ui.status;
  if (!s) return '';
  if (s.kind === 'run') return `<div class="alert run"><span class="spin"></span> <span id="run-msg">${esc(s.msg)}</span> <button class="btn sm" data-act="cancel-analyze">Cancel</button></div>`;
  if (s.kind === 'err') return `<div class="alert err"><b>Could not analyze this video.</b><br>${esc(s.msg)}<div class="row mt"><button class="btn sm" data-act="manual-project">Create project without AI (import file &amp; cut manually)</button></div></div>`;
  return '';
}
function createPanel(compact) {
  const s = state.settings;
  return `<section class="card hero">
  <h1>${compact ? 'Turn a long video into viral shorts' : 'Create Viral Clips'}</h1>
  <p class="muted">Paste one YouTube link. Gemini watches the video, picks complete moments and writes the timestamps and captions.</p>
  <div class="urlrow"><input id="yt-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="Paste your YouTube video link here..." value="${esc(ui.url)}">
  <button class="btn" data-act="paste">Paste URL</button><button class="btn primary" id="btn-analyze" data-act="analyze" ${ui.analyzing ? 'disabled' : ''}>Analyze Video</button></div>
  <div id="url-preview">${metaHtml()}</div>
  <div class="grid opts">
   <label>Min length<select data-set="minDur" data-num>${durOpts(s.minDur)}</select></label>
   <label>Max length<select data-set="maxDur" data-num>${durOpts(s.maxDur)}</select></label>
   <label>Number of clips<select data-set="count">${opts(COUNTS, s.count)}</select></label>
   <label>Ratio<select data-set="ratio">${opts(RATIO_LIST, s.ratio)}</select></label>
   <label>Caption style<select data-set="style">${opts(PRESETS.map((p) => [p.id, p.name]), s.style)}</select></label>
   <label>Content language<select data-set="lang">${opts(LANGS, s.lang)}</select></label>
  </div>
  <div id="analyze-status">${statusHtml()}</div>
  <p class="note">Use only videos you own or have permission to repurpose. VIRALCUT does not download or bypass YouTube protections: the AI reads the public video through the official Gemini API, and you import your own authorized source file to render the clips.</p>
  </section>`;
}
function howItWorks() {
  return `<section class="card"><h3>How it works</h3><ol class="steps">
  <li><b>Analyze</b> – paste the link, the AI finds the strongest complete moments (real timestamps).</li>
  <li><b>Import</b> – add your own copy of the video file (stays in your browser).</li>
  <li><b>Edit</b> – captions, 25 styles, ratios, music, logo, filters.</li>
  <li><b>Export</b> – clips are rendered for real on your device and downloaded as MP4/WebM or a ZIP.</li></ol></section>`;
}
function bindUrlInput() { const i = $('#yt-url'); if (i && ui.url) updateMeta(false); }
function updateMeta(fetchIt = true) {
  const box = $('#url-preview'); if (box) box.innerHTML = metaHtml();
  const id = ytId(ui.url);
  clearTimeout(ui.metaTimer);
  if (!id || (ui.meta && ui.meta.id === id)) return;
  ui.metaTimer = setTimeout(() => fetchMeta(id), fetchIt ? 500 : 0);
}
async function fetchMeta(id) {
  try {
    const m = await api('meta', { url: ui.url });
    if (ytId(ui.url) !== id) return;
    ui.meta = m;
  } catch { if (ytId(ui.url) === id) ui.meta = { id, title: '', channel: '', duration: null, status: 'unknown' }; }
  const box = $('#url-preview'); if (box) box.innerHTML = metaHtml();
}

async function analyze() {
  const id = ytId(ui.url);
  if (!id) return toast('Paste a valid YouTube link first.', 'err');
  if (ui.analyzing) return;
  if (ui.meta && ui.meta.id === id && ['private', 'unavailable'].includes(ui.meta.status)) return toast('This video is private or unavailable, so it cannot be analyzed.', 'err', 5000);
  const s = state.settings;
  if (+s.maxDur < +s.minDur) s.maxDur = s.minDur;
  save();
  ui.analyzing = true; ui.ctl = new AbortController();
  const t0 = Date.now();
  ui.status = { kind: 'run', msg: 'Gemini is watching the whole video… 0s (long videos can take a few minutes)' };
  const refresh = () => { const el = $('#analyze-status'); if (el) el.innerHTML = statusHtml(); const b = $('#btn-analyze'); if (b) b.disabled = ui.analyzing; };
  refresh();
  const timer = setInterval(() => { const el = $('#run-msg'); if (el) el.textContent = `Gemini is watching the whole video… ${Math.round((Date.now() - t0) / 1000)}s (long videos can take a few minutes)`; }, 1000);
  try {
    const r = await api('analyze', { url: ui.url, minDur: +s.minDur, maxDur: +s.maxDur, count: s.count }, ui.ctl.signal);
    const meta = ui.meta && ui.meta.id === id ? ui.meta : {};
    const p = { id: uid(), created: Date.now(), url: 'https://www.youtube.com/watch?v=' + id, vid: id, title: meta.title || r.title || 'YouTube ' + id, channel: meta.channel || '', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration: meta.duration || r.duration || null, language: r.language || '', sourceName: '', clips: [] };
    p.clips = r.clips.map((c, i) => newClip(c, i + 1));
    state.projects.unshift(p); save(true);
    ui.status = null; ui.url = ''; ui.meta = null;
    toast(`${p.clips.length} clips found`, 'ok');
    location.hash = '#/project/' + p.id;
  } catch (e) {
    ui.status = e.name === 'AbortError' ? null : { kind: 'err', msg: e.message };
  } finally {
    clearInterval(timer); ui.analyzing = false; ui.ctl = null; refresh();
  }
}

function newClip(c, n) {
  const s = state.settings;
  const style = s.customStyle ? JSON.parse(JSON.stringify(s.customStyle)) : clonePreset(s.style);
  return {
    id: uid(), n, start: 0, end: 60, title: 'Clip ' + n, hook: '', description: '', topic: '', category: 'other', score: 50, reason: '', platform: 'YouTube Shorts',
    keywords: [], captions: [], ratio: s.ratio, fit: 'fill', cropX: 0.5, track: false, style, styleId: style.id,
    text: { content: '', y: 0.15, color: '#ffffff', size: 0.07 }, logo: null, music: null, vol: 1, filter: 'none', trans: 'none',
    noise: false, silence: false, capOffset: 0, content: null, thumb: null, ...c,
  };
}

/* ---------- dashboard / projects / clips ---------- */
function dashboardPage() {
  const clips = state.projects.reduce((a, p) => a + p.clips.length, 0);
  return `${backendBanner()}${createPanel(true)}
  <div class="grid stats"><div class="card stat"><b>${state.projects.length}</b><span>Projects</span></div><div class="card stat"><b>${clips}</b><span>Clips</span></div><div class="card stat"><b>${state.exports.length}</b><span>Exports</span></div></div>
  <h3 class="sec">Recent projects</h3>${state.projects.length ? `<div class="grid cards">${state.projects.slice(0, 3).map(projectCard).join('')}</div>` : '<div class="card muted">No projects yet. Paste a YouTube link above to start.</div>'}${howItWorks()}`;
}
function projectCard(p) {
  return `<article class="card pcard"><a href="#/project/${p.id}"><img src="${esc(p.thumb)}" alt=""></a><div class="cbody"><h4>${esc(p.title)}</h4>
  <div class="muted">${p.clips.length} clips · ${new Date(p.created).toLocaleDateString()} · ${p.sourceName ? 'source imported' : 'source not imported'}</div>
  <div class="row"><a class="btn sm primary" href="#/project/${p.id}">Open</a><button class="btn sm danger" data-act="del-project" data-pid="${p.id}">Delete</button></div></div></article>`;
}
function projectsPage() {
  return `<h2>My Projects</h2>${state.projects.length ? `<div class="grid cards">${state.projects.map(projectCard).join('')}</div>` : '<div class="card muted">No projects yet. <a href="#/create">Create your first clips</a>.</div>'}`;
}
function allClipsPage() {
  const all = state.projects.flatMap((p) => p.clips.map((c) => ({ p, c })));
  return `<h2>All Clips</h2>${all.length ? `<div class="grid cards">${all.map(({ p, c }) => clipCard(p, c, true)).join('')}</div>` : '<div class="card muted">No clips yet.</div>'}`;
}

const FILTERS_UI = [['all', 'All'], ['best', 'Best Moments'], ['interesting', 'Most Interesting'], ['funny', 'Funny'], ['emotional', 'Emotional'], ['educational', 'Educational'], ['motivational', 'Motivational'], ['podcast', 'Podcast Highlights'], ['trending', 'Trending Potential']];
const filterFn = {
  all: () => true, best: (c) => c.score >= 80, interesting: (c) => ['shocking', 'story'].includes(c.category), funny: (c) => c.category === 'funny',
  emotional: (c) => c.category === 'emotional', educational: (c) => c.category === 'educational', motivational: (c) => c.category === 'motivational',
  podcast: (c) => c.category === 'podcast', trending: (c) => c.score >= 85,
};
function clipCard(p, c, showProj) {
  return `<article class="card clip"><a class="thumb" href="#/clip/${p.id}/${c.id}"><img data-thumb="${c.id}" loading="lazy" alt="" src="${esc(c.thumb || p.thumb)}"><span class="badge n">#${c.n}</span><span class="badge d">${Math.round(c.end - c.start)}s</span><span class="badge s">${c.score}</span></a>
  <div class="cbody">${showProj ? `<div class="muted">${esc(p.title)}</div>` : `<label class="chk"><input type="checkbox" data-sel="${c.id}" ${ui.pf.sel.has(c.id) ? 'checked' : ''}> Select</label>`}
  <h4>${esc(c.title)}</h4><div class="muted">${fmt(c.start)} → ${fmt(c.end)} · ${esc(c.category)} · ${esc(c.platform)}</div>
  ${c.hook ? `<p class="hook">“${esc(c.hook)}”</p>` : ''}<div class="bar" title="AI engagement estimate – not a guarantee of views"><i style="width:${c.score}%"></i></div>
  <div class="row"><a class="btn sm" href="#/clip/${p.id}/${c.id}?play=1">Preview</a><a class="btn sm" href="#/clip/${p.id}/${c.id}">Edit</a><button class="btn sm primary" data-act="dl-clip" data-pid="${p.id}" data-cid="${c.id}">Download</button></div></div></article>`;
}
function projectPage(p) {
  if (ui.pf.pid !== p.id) ui.pf = { filter: 'all', sort: 'score', pid: p.id, sel: new Set() };
  const list = p.clips.filter((c) => filterFn[ui.pf.filter](c));
  const sorters = { score: (a, b) => b.score - a.score, durasc: (a, b) => (a.end - a.start) - (b.end - b.start), durdesc: (a, b) => (b.end - b.start) - (a.end - a.start), time: (a, b) => a.start - b.start };
  list.sort(sorters[ui.pf.sort]);
  return `<div class="card phead"><img src="${esc(p.thumb)}" alt=""><div><h2>${esc(p.title)}</h2>
  <div class="muted">${esc(p.channel)} ${p.language ? '· Language: ' + esc(p.language) : ''} · ${p.clips.length} clips</div>
  <div class="row mt"><a class="btn sm" href="${esc(p.url)}" target="_blank" rel="noopener">Open on YouTube</a><button class="btn sm" data-act="add-clip" data-pid="${p.id}">+ Add clip manually</button><button class="btn sm danger" data-act="del-project" data-pid="${p.id}">Delete project</button></div></div></div>
  <div class="card" id="src-card">${sourceCard(p)}</div>
  <div class="card batch"><b>Batch tools</b> <span class="muted" id="selcount">${ui.pf.sel.size} selected</span>
   <div class="row"><button class="btn sm" data-act="sel-all">Select all shown</button><button class="btn sm" data-act="sel-none">Clear</button></div>
   <div class="grid opts"><label>Caption style<select id="b-style"><option value="">—</option>${opts(PRESETS.map((x) => [x.id, x.name]), '')}</select></label>
   <label>Ratio<select id="b-ratio"><option value="">—</option>${opts(RATIO_LIST, '')}</select></label>
   <label>Font<select id="b-font"><option value="">—</option>${opts(FONT_FAMILIES.map((f) => [f, f]), '')}</select></label>
   <label>Caption position<select id="b-pos"><option value="">—</option>${opts([[0.2, 'Top'], [0.5, 'Middle'], [0.75, 'Bottom']], '')}</select></label></div>
   <div class="row"><button class="btn sm primary" data-act="apply-batch" data-pid="${p.id}">Apply to selected</button><button class="btn sm primary" data-act="zip-sel" data-pid="${p.id}">Export selected (ZIP)</button><button class="btn sm" data-act="zip-all" data-pid="${p.id}">Export all (ZIP)</button></div></div>
  <div class="bar2"><div class="chips">${FILTERS_UI.map(([k, l]) => `<button class="chip ${ui.pf.filter === k ? 'on' : ''}" data-act="filter" data-k="${k}">${l}</button>`).join('')}</div>
  <label class="sortl">Sort<select data-pf="sort">${opts([['score', 'Engagement score'], ['time', 'Video order'], ['durasc', 'Duration ↑'], ['durdesc', 'Duration ↓']], ui.pf.sort)}</select></label></div>
  ${list.length ? `<div class="grid cards" id="clipgrid">${list.map((c) => clipCard(p, c, false)).join('')}</div>` : '<div class="card muted">No clips match this filter.</div>'}`;
}
function sourceCard(p) {
  return `<b>Source video</b> ${p.sourceName ? `<span class="chip ok">Imported: ${esc(p.sourceName)}</span>` : '<span class="chip warn">Not imported yet</span>'}
  <p class="muted">To preview and render clips, import your own authorized copy of this video (your upload, or a file you have permission to use). The file stays in this browser; it is never uploaded. Make sure it is the same video as the link.</p>
  <label class="btn sm primary filebtn">${p.sourceName ? 'Replace file' : 'Import source video'}<input type="file" id="src-file" data-pid="${p.id}" accept="video/*,.mp4,.mov,.webm,.m4v,.mkv" hidden></label><span id="src-msg" class="muted"></span>`;
}
async function projectAfter(p) {
  if (p.sourceName) {
    try { await ensureSource(p); genThumbs(p); } catch { /* shown when needed */ }
  }
}
async function genThumbs(p) {
  if (engine.projectId !== p.id) return;
  for (const c of p.clips) {
    if (c.thumb || engine.busy || engine.playing || engine.projectId !== p.id) continue;
    try {
      c.thumb = await engine.frameDataURL(Math.min(c.start + 0.5, (engine.video.duration || c.end) - 0.1));
      $$(`img[data-thumb="${c.id}"]`).forEach((i) => { i.src = c.thumb; });
    } catch { /* ignore */ }
  }
  save();
}
async function ensureSource(p) {
  if (engine.projectId === p.id && engine.ready) return;
  let b = null;
  try { b = await blobGet('src:' + p.id); } catch { /* ignore */ }
  if (!b) throw new Error('Import the source video first (Project page → Import source video).');
  await engine.loadSource(p.id, b);
}
async function importSource(p, file) {
  const msg = $('#src-msg');
  if (msg) msg.textContent = ' Loading…';
  try {
    if (engine.projectId === p.id) engine.unload(p.id);
    await engine.loadSource(p.id, file);
    const d = engine.video.duration;
    let stored = true;
    try { await blobPut('src:' + p.id, file); } catch { stored = false; }
    p.sourceName = file.name; p.srcDuration = d;
    if (!p.duration) p.duration = d;
    p.clips.forEach((c) => { c.thumb = null; });
    save(true);
    const warns = [];
    if (p.duration && Math.abs(d - p.duration) > 3) warns.push(`This file is ${fmt(d)} long but the YouTube video is ${fmt(p.duration)}. Timestamps may not line up – make sure it is the same video.`);
    const beyond = p.clips.filter((c) => c.end > d + 0.5).length;
    if (beyond) warns.push(`${beyond} clip(s) end after this file finishes.`);
    if (!stored) warns.push('The file could not be saved in browser storage (too big?), so you must re-import it next visit.');
    toast('Source video loaded', 'ok');
    warns.forEach((w) => toast(w, 'err', 8000));
    render();
  } catch (e) { toast(e.message, 'err', 6000); if (msg) msg.textContent = ''; }
}

/* ---------- export ---------- */
function showJob(title, n) {
  const m = document.createElement('div'); m.id = 'job'; m.className = 'modal';
  m.innerHTML = `<div class="card jobbox"><h3>${esc(title)}</h3><p class="muted" id="job-msg"></p><div class="pbar"><i id="job-bar" style="width:0%"></i></div><p id="job-pct" class="muted">0%</p>
  <p class="note">Real rendering is happening on your device at normal playback speed. Keep this tab open and visible.</p><button class="btn danger" data-act="cancel-job">Cancel</button></div>`;
  document.body.appendChild(m);
}
function jobUpdate(msg, pct) { const a = $('#job-msg'), b = $('#job-bar'), c = $('#job-pct'); if (a) a.textContent = msg; if (b) b.style.width = Math.round(pct * 100) + '%'; if (c) c.textContent = Math.round(pct * 100) + '%'; }
const hideJob = () => { const m = $('#job'); if (m) m.remove(); };
const fileName = (p, c, ext) => `${slug(p.title)}_clip${c.n}_${c.ratio.replace(':', 'x')}_${state.settings.res}p.${ext}`;

async function runExport(p, clips, asZip) {
  if (engine.busy) return toast('Another export is already running.', 'err');
  if (!clips.length) return toast('No clips selected.', 'err');
  if (!pickMime()) return toast('This browser cannot export video. Use desktop/Android Chrome, Edge or Firefox.', 'err', 6000);
  try { await ensureSource(p); } catch (e) { return toast(e.message, 'err', 5000); }
  const bad = clips.find((c) => c.end > engine.video.duration + 0.5);
  if (bad) return toast(`Clip #${bad.n} ends after the imported file finishes. Adjust it in the editor.`, 'err', 6000);
  const ctl = new AbortController(); ui.job = ctl;
  showJob(asZip ? 'Exporting ZIP' : 'Rendering clip', clips.length);
  const s = state.settings, done = [];
  try {
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const r = await engine.render(c, { res: +s.res, fps: +s.fps }, (pct) => jobUpdate(`Clip ${i + 1} of ${clips.length}: ${c.title}`, (i + pct) / clips.length), ctl.signal);
      const name = fileName(p, c, r.ext);
      const rec = { id: uid(), name, pid: p.id, title: c.title, ratio: c.ratio, res: s.res, fps: s.fps, size: r.blob.size, date: Date.now() };
      try { await blobPut('exp:' + rec.id, r.blob); state.exports.unshift(rec); save(true); } catch { toast('Could not keep this file in Export History (storage full); your download continues.', 'err'); }
      done.push({ name, blob: r.blob });
      if (!asZip) download(r.blob, name);
    }
    if (asZip) { jobUpdate('Creating ZIP…', 1); download(await makeZip(done), slug(p.title) + '_clips.zip'); }
    toast('Export finished', 'ok');
  } catch (e) {
    if (e.name === 'AbortError') toast('Export cancelled'); else toast(e.message, 'err', 7000);
  } finally { hideJob(); ui.job = null; const bb = $('#btn-play'); if (bb) bb.textContent = '▶ Play'; if (ui.ed) edShow(); }
}

/* ---------- caption/style controls (shared by editor + studio) ---------- */
function shadowMode(st) { const s = st.shadow; if (!s) return 'none'; if (s.b === 0) return 'hard'; if (s.x === 0 && s.y === 0) return 'glow'; return 'soft'; }
function styleControls(st) {
  return `<div class="grid ctl">
  <label>Font<select data-bind="style.font">${opts(FONT_FAMILIES.map((f) => [f, f]), st.font)}</select></label>
  <label>Weight<select data-bind="style.weight" data-num>${opts([400, 500, 600, 700, 800, 900].map((w) => [w, w]), st.weight)}</select></label>
  <label>Size<input type="range" min="0.03" max="0.16" step="0.005" data-bind="style.size" value="${st.size}"></label>
  <label>Words per line<input type="range" min="1" max="8" step="1" data-bind="style.chunk" value="${st.chunk}"></label>
  <label>Text color<input type="color" data-bind="style.color" value="${esc(st.color)}"></label>
  <label>Highlight color<input type="color" data-bind="style.hi" value="${esc(st.hi)}"></label>
  <label>Outline width<input type="range" min="0" max="0.25" step="0.01" data-bind="style.strokeW" value="${st.strokeW}"></label>
  <label>Outline color<input type="color" data-bind="style.stroke" value="${esc(st.stroke)}"></label>
  <label>Shadow<select data-shadow>${opts([['none', 'None'], ['soft', 'Soft'], ['hard', 'Hard'], ['glow', 'Glow']], shadowMode(st))}</select></label>
  <label>Background box<select data-bgmode>${opts([['off', 'Off'], ['on', 'On']], st.bg ? 'on' : 'off')}</select></label>
  <label>Background color<input type="color" data-bind="style.bg" value="${esc(st.bg || '#000000')}"></label>
  <label>Background opacity<input type="range" min="0.1" max="1" step="0.05" data-bind="style.bgOp" value="${st.bgOp}"></label>
  <label>Vertical position<input type="range" min="0.1" max="0.95" step="0.01" data-bind="style.pos" value="${st.pos}"></label>
  <label>Alignment<select data-bind="style.align">${opts([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], st.align)}</select></label>
  <label>Line spacing<input type="range" min="1" max="2" step="0.05" data-bind="style.lineH" value="${st.lineH}"></label>
  <label>Animation<select data-bind="style.anim">${opts(ANIMS.map((a) => [a, a]), st.anim)}</select></label>
  <label>Animation speed<input type="range" min="0.5" max="3" step="0.1" data-bind="style.speed" value="${st.speed}"></label>
  <label class="chk"><input type="checkbox" data-bind="style.upper" ${st.upper ? 'checked' : ''}> UPPERCASE</label>
  <label class="chk"><input type="checkbox" data-bind="style.hiActive" ${st.hiActive ? 'checked' : ''}> Highlight spoken word</label>
  <label class="chk"><input type="checkbox" data-bind="style.hiKeys" ${st.hiKeys ? 'checked' : ''}> Highlight key words</label>
  <label class="chk"><input type="checkbox" data-bind="style.karaoke" ${st.karaoke ? 'checked' : ''}> Karaoke fill</label></div>`;
}
const SHADOWS = { none: () => null, soft: () => ({ c: 'rgba(0,0,0,.7)', b: 12, x: 0, y: 3 }), hard: () => ({ c: '#000000', b: 0, x: 6, y: 6 }), glow: (st) => ({ c: st.hi, b: 26, x: 0, y: 0 }) };
function setPath(obj, path, val) { const k = path.split('.'); let o = obj; for (let i = 0; i < k.length - 1; i++) { if (o[k[i]] == null) o[k[i]] = {}; o = o[k[i]]; } o[k[k.length - 1]] = val; }
function boundRoot() { return ui.ed ? ui.ed.c : ui.studio ? ui.studio : null; }
function afterBound(path) {
  if (ui.ed) {
    save();
    if (/style\.(font|weight)/.test(path)) ensureFonts(ui.ed.c.style).then(edRedraw);
    edRedraw();
  } else if (ui.studio) { if (/style\.(font|weight)/.test(path)) ensureFonts(ui.studio.style).then(() => {}); }
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'yt-url') { ui.url = el.value; ui.status = ui.status && ui.status.kind === 'err' ? null : ui.status; updateMeta(true); return; }
  if (el.dataset.bind) {
    const root = boundRoot(); if (!root) return;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' || 'num' in el.dataset ? Number(el.value) : el.value;
    if (Number.isNaN(v)) return;
    setPath(root, el.dataset.bind, v);
    afterBound(el.dataset.bind);
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.set) { const v = 'num' in el.dataset ? Number(el.value) : el.value; state.settings[el.dataset.set] = v; if (el.dataset.set === 'style') state.settings.customStyle = null; save(); return; }
  if (el.dataset.shadow !== undefined) { const root = boundRoot(); if (!root) return; root.style.shadow = SHADOWS[el.value](root.style); afterBound('style.shadow'); return; }
  if (el.dataset.bgmode !== undefined) { const root = boundRoot(); if (!root) return; root.style.bg = el.value === 'on' ? (root.style.bg || '#000000') : ''; afterBound('style.bg'); return; }
  if (el.dataset.sel) { el.checked ? ui.pf.sel.add(el.dataset.sel) : ui.pf.sel.delete(el.dataset.sel); const s = $('#selcount'); if (s) s.textContent = ui.pf.sel.size + ' selected'; return; }
  if (el.dataset.pf) { ui.pf[el.dataset.pf] = el.value; render(); return; }
  if (el.id === 'src-file' && el.files[0]) { const p = getProject(el.dataset.pid); if (p) await importSource(p, el.files[0]); return; }
  if (el.dataset.cap) { capEdit(el); return; }
  if (el.dataset.trim) { setTrim(el.dataset.trim, el.value); return; }
  if (el.id === 'logo-file' && el.files[0]) { await setLogo(el.files[0]); return; }
  if (el.id === 'music-file' && el.files[0]) { await setMusic(el.files[0]); return; }
  if (el.id === 'content-lang') ui.contentLang = el.value;
  if (el.id === 'ed-preset') { if (!el.value) return; const c = ui.ed.c; c.style = clonePreset(el.value); c.styleId = el.value; save(); await ensureFonts(c.style); $('#style-ctl').innerHTML = styleControls(c.style); edRedraw(); return; }
  if (el.id === 'ed-res') { state.settings.res = +el.value; save(); return; }
  if (el.id === 'ed-fps') { state.settings.fps = +el.value; save(); return; }
  if (el.id === 'ed-title') { ui.ed.c.title = el.value; save(); return; }
});

/* ---------- clip editor ---------- */
function editorPage(p, c) {
  const s = state.settings;
  ui.contentLang = ui.contentLang || s.lang;
  return `<div class="edtop"><a class="btn sm" href="#/project/${p.id}">← ${esc(p.title.slice(0, 40))}</a><input id="ed-title" class="titlein" value="${esc(c.title)}" aria-label="Clip title"></div>
  <div class="ed"><div class="edleft">
   <div id="ed-banner"></div>
   <div class="stage"><canvas id="pv" width="360" height="640"></canvas></div>
   <div class="transport"><button class="btn primary" id="btn-play" data-act="ed-play">▶ Play</button><input type="range" id="scrub" min="${c.start}" max="${c.end}" step="0.05" value="${c.start}"><span id="tcur" class="muted">0:00</span></div>
   <div class="card trim"><b>Clip start / end (seconds in the source video)</b>
    <div class="trimrow"><button class="btn sm" data-act="nudge" data-w="start" data-d="-0.5">−</button><label>Start<input type="number" step="0.1" min="0" data-trim="start" id="t-start" value="${c.start.toFixed(1)}"></label><button class="btn sm" data-act="nudge" data-w="start" data-d="0.5">+</button>
    <button class="btn sm" data-act="nudge" data-w="end" data-d="-0.5">−</button><label>End<input type="number" step="0.1" min="0" data-trim="end" id="t-end" value="${c.end.toFixed(1)}"></label><button class="btn sm" data-act="nudge" data-w="end" data-d="0.5">+</button></div>
    <div class="muted" id="t-dur">Duration ${(c.end - c.start).toFixed(1)}s (${fmt(c.start)} → ${fmt(c.end)})</div></div>
   <div class="card renderbar"><div class="grid opts"><label>Quality<select id="ed-res">${opts([[720, '720p'], [1080, '1080p']], s.res)}</select></label><label>Frame rate<select id="ed-fps">${opts([[30, '30 FPS'], [60, '60 FPS']], s.fps)}</select></label></div>
    <button class="btn primary big" data-act="render-one" data-pid="${p.id}" data-cid="${c.id}">Render &amp; Download (${pickMime() ? pickMime().startsWith('video/mp4') ? 'MP4' : 'WebM' : 'not supported'})</button>
    <p class="note">Rendered at normal speed on your device (a 60s clip takes about 60s). 4K is not offered because in-browser encoding can't do it reliably.</p></div>
  </div><div class="edright">
   <div class="card info"><b>${esc(c.topic || 'Clip')}</b> · score ${c.score}/100 <span class="muted">(AI estimate, no guarantee)</span>${c.hook ? `<p class="hook">Hook: “${esc(c.hook)}”</p>` : ''}${c.reason ? `<p class="muted">Why selected: ${esc(c.reason)}</p>` : ''}</div>
   <div class="tabs">${[['captions', 'Captions'], ['style', 'Style'], ['frame', 'Frame'], ['audio', 'Audio'], ['content', 'AI Content']].map(([k, l]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-k="${k}">${l}</button>`).join('')}</div>
   <div class="card panel" data-panel="captions" ${ui.tab === 'captions' ? '' : 'hidden'}>${captionsPanel(c)}</div>
   <div class="card panel" data-panel="style" ${ui.tab === 'style' ? '' : 'hidden'}><label>Caption preset<select id="ed-preset"><option value="">Custom</option>${opts(PRESETS.map((x) => [x.id, x.name]), c.styleId)}</select></label><div id="style-ctl">${styleControls(c.style)}</div></div>
   <div class="card panel" data-panel="frame" ${ui.tab === 'frame' ? '' : 'hidden'}>${framePanel(c)}</div>
   <div class="card panel" data-panel="audio" ${ui.tab === 'audio' ? '' : 'hidden'}>${audioPanel(c)}</div>
   <div class="card panel" data-panel="content" ${ui.tab === 'content' ? '' : 'hidden'}>${contentPanel(c)}</div>
  </div></div>`;
}
function captionsPanel(c) {
  return `<div class="grid opts"><label>Timing offset (s)<input type="number" step="0.1" min="-5" max="5" data-bind="capOffset" value="${c.capOffset || 0}"></label>
  <label>Translate captions to<select id="tr-lang">${opts(LANGS, 'English')}</select></label></div>
  <div class="row"><button class="btn sm" data-act="translate">Translate with AI</button><button class="btn sm" data-act="cap-add">+ Add line</button></div>
  <p class="muted">Caption timing comes from the AI transcript and is approximate – use the offset or edit lines to fix. Word highlighting is estimated within each line.</p>
  <div id="caplist">${capList(c)}</div>`;
}
function capList(c) {
  if (!c.captions.length) return '<p class="muted">No captions yet. Add lines manually.</p>';
  return c.captions.map((x, i) => `<div class="caprow"><input type="number" step="0.1" data-cap="start" data-i="${i}" value="${x.start.toFixed(1)}" aria-label="start"><input type="number" step="0.1" data-cap="end" data-i="${i}" value="${x.end.toFixed(1)}" aria-label="end"><input type="text" data-cap="text" data-i="${i}" value="${esc(x.text)}" aria-label="text"><button class="btn sm danger" data-act="cap-del" data-i="${i}">✕</button></div>`).join('');
}
function framePanel(c) {
  return `<div class="row">${RATIO_LIST.map(([r]) => `<button class="chip ${c.ratio === r ? 'on' : ''}" data-act="ratio" data-r="${r}">${r}</button>`).join('')}</div>
  <div class="grid ctl"><label>Framing<select data-bind="fit">${opts([['fill', 'Fill (crop)'], ['fit', 'Fit (blurred background)']], c.fit)}</select></label>
  <label>Crop position (left ↔ right)<input type="range" min="0" max="1" step="0.01" data-bind="cropX" value="${c.cropX}"></label>
  <label class="chk"><input type="checkbox" data-bind="track" ${c.track ? 'checked' : ''} ${engine.supportsFace ? '' : 'disabled'}> Face tracking ${engine.supportsFace ? '' : '(not supported by this browser)'}</label>
  <label>Filter<select data-bind="filter">${opts(Object.keys(FILTERS).map((f) => [f, f]), c.filter)}</select></label>
  <label>Transition<select data-bind="trans">${opts([['none', 'None'], ['fade', 'Fade in/out'], ['zoom', 'Slow zoom']], c.trans)}</select></label></div>
  <b>Text overlay</b><div class="grid ctl"><label>Text<textarea rows="2" data-bind="text.content">${esc(c.text.content)}</textarea></label><label>Size<input type="range" min="0.03" max="0.15" step="0.005" data-bind="text.size" value="${c.text.size}"></label><label>Vertical position<input type="range" min="0.05" max="0.95" step="0.01" data-bind="text.y" value="${c.text.y}"></label><label>Color<input type="color" data-bind="text.color" value="${esc(c.text.color)}"></label></div>
  <b>Logo</b><div class="grid ctl"><label class="btn sm filebtn">${c.logo ? 'Replace logo' : 'Add logo'}<input type="file" id="logo-file" accept="image/*" hidden></label>${c.logo ? `<label>Corner<select data-bind="logo.pos">${opts([['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']], c.logo.pos)}</select></label><label>Size<input type="range" min="0.05" max="0.4" step="0.01" data-bind="logo.size" value="${c.logo.size}"></label><button class="btn sm danger" data-act="logo-clear">Remove logo</button>` : ''}</div>`;
}
function audioPanel(c) {
  return `<div class="grid ctl"><label>Original volume<input type="range" min="0" max="2" step="0.05" data-bind="vol" value="${c.vol}"></label>
  <label class="btn sm filebtn">${c.music ? 'Replace music / sound effect' : 'Add background music / sound effect'}<input type="file" id="music-file" accept="audio/*" hidden></label>
  ${c.music ? `<div class="muted">${esc(c.music.name)}</div><label>Music volume<input type="range" min="0" max="1" step="0.05" data-bind="music.vol" value="${c.music.vol}"></label><button class="btn sm danger" data-act="music-clear">Remove music</button>` : ''}
  <label class="chk"><input type="checkbox" data-bind="noise" ${c.noise ? 'checked' : ''}> Basic noise filter (cuts rumble below 100 Hz and hiss above 9 kHz)</label>
  <label class="chk"><input type="checkbox" data-bind="silence" ${c.silence ? 'checked' : ''}> Silence remover (skips pauses longer than 1s between spoken lines)</label></div>
  <p class="muted">Use only music you have the rights to.</p>`;
}
const CONTENT_FIELDS = [['youtube_title', 'YouTube Shorts title'], ['tiktok_caption', 'TikTok caption'], ['facebook_caption', 'Facebook Reels caption'], ['instagram_caption', 'Instagram Reels caption'], ['description', 'Video description'], ['hashtags', 'Hashtags'], ['keywords', 'Keywords'], ['thumbnail_text', 'Thumbnail text'], ['music_suggestion', 'Music suggestion'], ['broll_ideas', 'B-roll ideas']];
function contentPanel(c) {
  const ct = c.content;
  return `<div class="grid opts"><label>Language<select id="content-lang">${opts(LANGS, ui.contentLang)}</select></label></div>
  <div class="row"><button class="btn sm primary" data-act="gen-content">Generate with AI</button><button class="btn sm" data-act="thumb">Generate thumbnail (PNG)</button></div>
  ${ct ? CONTENT_FIELDS.filter(([k]) => ct[k] != null).map(([k, l]) => `<div class="cfield"><label>${l}</label><textarea readonly rows="${k === 'description' ? 4 : 2}">${esc(Array.isArray(ct[k]) ? ct[k].join(k === 'hashtags' || k === 'keywords' ? ' ' : '\n') : ct[k])}</textarea><button class="btn sm" data-act="copy" data-k="${k}">Copy</button></div>`).join('') : '<p class="muted">Generate titles, captions, hashtags, keywords and thumbnail text for this clip.</p>'}`;
}

async function initEditor(p, c, autoplay) {
  const cv = $('#pv');
  const [W, H] = outputSize(c.ratio, 360); cv.width = W; cv.height = H;
  const cur = (ui.ed = { p, c, cv, env: engine.makeEnv(c), t: c.start, ok: false, seq: 0 });
  const cx = cv.getContext('2d'); cx.fillStyle = '#000'; cx.fillRect(0, 0, W, H);
  try { await ensureSource(p); }
  catch (e) {
    $('#ed-banner').innerHTML = `<div class="alert err">${esc(e.message)}<div class="row mt"><label class="btn sm primary filebtn">Import source video<input type="file" id="src-file" data-pid="${p.id}" accept="video/*,.mp4,.mov,.webm,.m4v,.mkv" hidden></label></div></div>`;
    return;
  }
  if (ui.ed !== cur) return;
  if (c.end > engine.video.duration + 0.5) $('#ed-banner').innerHTML = `<div class="alert err">This clip ends at ${fmt(c.end)} but the imported file is only ${fmt(engine.video.duration)} long. Adjust the end time or import the correct video.</div>`;
  cur.ok = true;
  await ensureFonts(c.style, c.captions.map((x) => x.text).join(' '));
  if (ui.ed !== cur) return;
  await edShow();
  if (autoplay && ui.ed === cur) edPlay();
}
async function edShow() {
  const e = ui.ed; if (!e || !e.ok) return;
  const seq = ++e.seq;
  await engine.showFrame(e.c, e.env, e.cv, e.t);
  if (seq === e.seq) edTime(e.t);
}
function edTime(t) {
  const e = ui.ed; if (!e) return;
  const s = $('#scrub'), l = $('#tcur');
  if (s) s.value = t;
  if (l) l.textContent = `${fmt(t - e.c.start)} / ${fmt(e.c.end - e.c.start)}`;
}
function edRedraw() {
  const e = ui.ed; if (!e) return;
  Object.assign(e.env, engine.makeEnv(e.c));
  if (e.ok && !engine.playing) edShow();
}
async function edPlay() {
  const e = ui.ed; if (!e || !e.ok) return toast('Import the source video first.', 'err');
  const b = $('#btn-play');
  if (engine.playing) { engine.pause(); e.t = engine.video.currentTime; if (b) b.textContent = '▶ Play'; return; }
  if (b) b.textContent = '❚❚ Pause';
  try {
    await engine.play(e.c, e.env, e.cv, (t, ended) => {
      e.t = t; edTime(t);
      if (ended) { e.t = e.c.start; const bb = $('#btn-play'); if (bb) bb.textContent = '▶ Play'; edShow(); }
    });
  } catch (err) { if (b) b.textContent = '▶ Play'; toast('Playback failed: ' + err.message, 'err', 5000); }
}
function setTrim(which, val) {
  const e = ui.ed; if (!e) return;
  const c = e.c, max = (engine.video && engine.video.duration) || e.p.duration || 1e9;
  val = clamp(Number(val) || 0, 0, max);
  if (which === 'start') c.start = Math.min(val, c.end - 1); else c.end = Math.min(Math.max(val, c.start + 1), max);
  c.start = +c.start.toFixed(2); c.end = +c.end.toFixed(2); c.thumb = null;
  $('#t-start').value = c.start.toFixed(1); $('#t-end').value = c.end.toFixed(1);
  $('#t-dur').textContent = `Duration ${(c.end - c.start).toFixed(1)}s (${fmt(c.start)} → ${fmt(c.end)})`;
  const s = $('#scrub'); s.min = c.start; s.max = c.end;
  engine.pause(); const b = $('#btn-play'); if (b) b.textContent = '▶ Play';
  e.t = c.start; save(); edRedraw();
}
function capEdit(el) {
  const c = ui.ed.c, i = +el.dataset.i, k = el.dataset.cap, row = c.captions[i]; if (!row) return;
  if (k === 'text') row.text = el.value; else { const v = Number(el.value); if (Number.isNaN(v)) return; row[k] = v; if (row.end <= row.start) row.end = row.start + 0.5; }
  c.captions.sort((a, b) => a.start - b.start);
  save(); $('#caplist').innerHTML = capList(c); edRedraw();
}
async function setLogo(file) {
  const c = ui.ed.c;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read this image.')); i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(img.src);
    c.logo = { data: cv.toDataURL('image/png'), pos: 'tr', size: 0.15 };
    save(true); $('[data-panel="frame"]').innerHTML = framePanel(c);
    setTimeout(edRedraw, 80);
  } catch (e) { toast(e.message, 'err'); }
}
async function setMusic(file) {
  const c = ui.ed.c;
  try { await blobPut('music:' + c.id, file); } catch { return toast('Could not store this audio file (storage full).', 'err'); }
  engine.musicClipId = null; c.music = { name: file.name, vol: 0.25 };
  save(true); $('[data-panel="audio"]').innerHTML = audioPanel(c);
}

/* ---------- caption studio ---------- */
function studioPage() {
  if (!ui.studio) { const s = state.settings; ui.studio = { style: s.customStyle ? JSON.parse(JSON.stringify(s.customStyle)) : clonePreset(s.style) }; }
  const st = ui.studio.style;
  return `<h2>Caption Studio</h2><p class="muted">25 presets – tap one to preview it instantly, then fine-tune every detail.</p>
  <div class="ed"><div class="edleft"><div class="stage"><canvas id="sv" width="360" height="640"></canvas></div></div>
  <div class="edright"><div class="card"><div class="row"><button class="btn primary" data-act="studio-default">Use as default for new clips</button></div>
  <div class="row mt"><select id="studio-proj">${state.projects.length ? opts(state.projects.map((p) => [p.id, p.title.slice(0, 50)]), state.projects[0].id) : '<option value="">No projects</option>'}</select><button class="btn" data-act="studio-apply">Apply to all clips in project</button></div></div>
  <div class="card"><div class="gallery">${PRESETS.map((p) => `<button class="gcard ${st.id === p.id ? 'on' : ''}" data-act="preset" data-id="${p.id}"><canvas width="180" height="110" data-pv="${p.id}"></canvas><span>${esc(p.name)}</span></button>`).join('')}</div></div>
  <div class="card" id="studio-ctl">${styleControls(st)}</div></div></div>`;
}
function initStudio() {
  const cv = $('#sv'); if (!cv) return;
  const ctx = cv.getContext('2d');
  let raf = 0, alive = true;
  const sample = 'This is how your captions will look';
  let cacheKey = '', tl = [];
  const keys = keywordSet(['captions']);
  const loop = () => {
    if (!alive) return;
    const st = ui.studio.style;
    const k = st.chunk + sample; if (k !== cacheKey) { cacheKey = k; tl = buildTimeline([{ start: 0, end: 3.2, text: sample }], st.chunk); }
    const t = (performance.now() / 1000) % 3.6;
    const g = ctx.createLinearGradient(0, 0, cv.width, cv.height); g.addColorStop(0, '#2a1a5e'); g.addColorStop(1, '#0b3a6b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
    drawCaptions(ctx, cv.width, cv.height, chunkAt(tl, t), t, st, keys);
    raf = requestAnimationFrame(loop);
  };
  ui.cleanup = () => { alive = false; cancelAnimationFrame(raf); };
  const paintGallery = () => $$('canvas[data-pv]').forEach((c) => {
    const st = clonePreset(c.dataset.pv), x = c.getContext('2d');
    x.fillStyle = '#1b1530'; x.fillRect(0, 0, c.width, c.height);
    st.pos = 0.5; st.size = Math.min(st.size, 0.1) * 1.35; st.anim = 'none';
    const ch = { start: 0, end: 2, words: [{ w: 'Viral', s: 0, e: 1 }, { w: 'captions', s: 1, e: 2 }] };
    drawCaptions(x, c.width, c.height, ch, 1.4, st, keywordSet(['viral']));
  });
  Promise.all(PRESETS.map((p) => ensureFonts(p))).then(() => { if (alive) paintGallery(); });
  paintGallery();
  ensureFonts(ui.studio.style);
  loop();
}

/* ---------- templates / exports / settings ---------- */
const TEMPLATES = [
  { id: 't1', name: 'Podcast Highlights', desc: 'Long conversations → 60–120s moments, clean readable captions.', ratio: '9:16', style: 'podcast', minDur: 60, maxDur: 120, count: 10 },
  { id: 't2', name: 'Motivational Speeches', desc: 'Short powerful statements, big bold text.', ratio: '9:16', style: 'motivation', minDur: 30, maxDur: 60, count: 10 },
  { id: 't3', name: 'Gaming Moments', desc: 'High-energy short clips with playful captions.', ratio: '9:16', style: 'gaming', minDur: 30, maxDur: 45, count: 15 },
  { id: 't4', name: 'Educational Explainers', desc: 'Complete explanations with Hormozi-style keywords.', ratio: '9:16', style: 'hormozi', minDur: 45, maxDur: 90, count: 10 },
  { id: 't5', name: 'Funny Moments', desc: 'Punchy jokes and reactions.', ratio: '9:16', style: 'mrbeast', minDur: 30, maxDur: 60, count: 15 },
  { id: 't6', name: 'Interview / Luxury', desc: 'Elegant 4:5 portrait clips for Instagram.', ratio: '4:5', style: 'luxury', minDur: 60, maxDur: 150, count: 5 },
  { id: 't7', name: 'Landscape Highlights', desc: '16:9 documentary-style clips up to 3 minutes.', ratio: '16:9', style: 'documentary', minDur: 90, maxDur: 180, count: 5 },
];
function templatesPage() {
  return `<h2>Templates</h2><p class="muted">A template sets your default ratio, caption style, clip length and clip count.</p><div class="grid cards">${TEMPLATES.map((t) => `<article class="card"><h4>${esc(t.name)}</h4><p class="muted">${esc(t.desc)}</p><div class="muted">${t.ratio} · ${t.minDur}–${t.maxDur}s · ${t.count} clips · ${esc(PRESETS.find((p) => p.id === t.style).name)}</div><button class="btn primary mt" data-act="use-template" data-id="${t.id}">Use template</button></article>`).join('')}</div>`;
}
function exportsPage() {
  return `<h2>Export History</h2>${state.exports.length ? `<div class="row mb"><button class="btn sm danger" data-act="hist-clear">Clear all</button></div><div class="card"><table class="tbl"><tr><th>File</th><th>Size</th><th>Date</th><th></th></tr>${state.exports.map((x) => `<tr><td>${esc(x.name)}<div class="muted">${x.ratio} · ${x.res}p · ${x.fps} FPS</div></td><td>${mb(x.size)}</td><td>${new Date(x.date).toLocaleString()}</td><td><button class="btn sm primary" data-act="hist-dl" data-id="${x.id}">Download</button> <button class="btn sm danger" data-act="hist-del" data-id="${x.id}">✕</button></td></tr>`).join('')}</table></div>` : '<div class="card muted">No exports yet. Rendered clips appear here.</div>'}`;
}
function settingsPage() {
  const s = state.settings, b = ui.backend;
  return `<h2>Settings</h2><div class="card"><h3>Defaults</h3><div class="grid opts">
  <label>Ratio<select data-set="ratio">${opts(RATIO_LIST, s.ratio)}</select></label>
  <label>Export quality<select data-set="res" data-num>${opts([[720, '720p'], [1080, '1080p']], s.res)}</select></label>
  <label>Frame rate<select data-set="fps" data-num>${opts([[30, '30 FPS'], [60, '60 FPS']], s.fps)}</select></label>
  <label>Caption style<select data-set="style">${opts(PRESETS.map((p) => [p.id, p.name]), s.style)}</select></label>
  <label>Min clip length<select data-set="minDur" data-num>${durOpts(s.minDur)}</select></label>
  <label>Max clip length<select data-set="maxDur" data-num>${durOpts(s.maxDur)}</select></label>
  <label>Clips per video<select data-set="count">${opts(COUNTS, s.count)}</select></label>
  <label>Content language<select data-set="lang">${opts(LANGS, s.lang)}</select></label></div>
  ${s.customStyle ? '<p class="muted">A custom caption style from Caption Studio is the default for new clips. <button class="btn sm" data-act="reset-style">Reset</button></p>' : ''}</div>
  <div class="card"><h3>Backend</h3><p class="muted">${b ? (b.error ? 'Not reachable (' + esc(b.error) + ')' : `Connected · model ${esc(b.model)} · API key ${b.configured ? 'configured ✓' : 'MISSING ✗'}${b.accessCodeRequired ? ' · access code ' + (b.authorized ? 'accepted ✓' : 'required ✗') : ''}`) : 'Not checked yet.'}</p>
  <label>Access code (only if you set ACCESS_CODE on Netlify)<input type="password" id="access" value="${esc(s.accessCode)}" data-set="accessCode" autocomplete="off"></label>
  <button class="btn" data-act="ping">Check backend</button></div>
  <div class="card"><h3>Data</h3><p class="muted">Projects, settings and files are stored only in this browser.</p><button class="btn danger" data-act="wipe">Delete all data</button></div>`;
}

/* ---------- click actions ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  switch (a) {
    case 'paste': try { const t = await navigator.clipboard.readText(); ui.url = t.trim(); const i = $('#yt-url'); if (i) i.value = ui.url; updateMeta(true); } catch { toast('Clipboard blocked – long-press the box and paste.', 'err'); } break;
    case 'analyze': analyze(); break;
    case 'cancel-analyze': if (ui.ctl) ui.ctl.abort(); break;
    case 'manual-project': {
      const id = ytId(ui.url); const m = ui.meta && ui.meta.id === id ? ui.meta : {};
      const p = { id: uid(), created: Date.now(), url: id ? 'https://www.youtube.com/watch?v=' + id : '', vid: id || '', title: m.title || 'Manual project', channel: m.channel || '', thumb: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '', duration: m.duration || null, language: '', sourceName: '', clips: [] };
      state.projects.unshift(p); save(true); ui.status = null; location.hash = '#/project/' + p.id; break;
    }
    case 'del-project': {
      const p = getProject(el.dataset.pid); if (!p || !confirm('Delete this project and its imported video?')) break;
      engine.unload(p.id); blobDel('src:' + p.id).catch(() => {}); p.clips.forEach((c) => blobDel('music:' + c.id).catch(() => {}));
      state.projects = state.projects.filter((x) => x !== p); save(true);
      if (route().name === 'project') location.hash = '#/projects'; else render(); break;
    }
    case 'add-clip': {
      const p = getProject(el.dataset.pid); const d = p.srcDuration || p.duration || 120;
      const last = p.clips.reduce((m, c) => Math.max(m, c.end), 0); const start = last + 1 < d - 5 ? last + 1 : 0;
      const c = newClip({ start, end: Math.min(start + 45, d), title: 'Manual clip ' + (p.clips.length + 1) }, p.clips.length + 1);
      p.clips.push(c); save(true); location.hash = `#/clip/${p.id}/${c.id}`; break;
    }
    case 'filter': ui.pf.filter = el.dataset.k; render(); break;
    case 'sel-all': $$('[data-sel]').forEach((i) => { i.checked = true; ui.pf.sel.add(i.dataset.sel); }); $('#selcount').textContent = ui.pf.sel.size + ' selected'; break;
    case 'sel-none': ui.pf.sel.clear(); $$('[data-sel]').forEach((i) => { i.checked = false; }); $('#selcount').textContent = '0 selected'; break;
    case 'apply-batch': {
      const p = getProject(el.dataset.pid); const list = p.clips.filter((c) => ui.pf.sel.has(c.id));
      if (!list.length) { toast('Select clips first.', 'err'); break; }
      const sv = $('#b-style').value, rv = $('#b-ratio').value, fv = $('#b-font').value, pv = $('#b-pos').value;
      if (!sv && !rv && !fv && !pv) { toast('Choose something to apply.', 'err'); break; }
      list.forEach((c) => { if (sv) { c.style = clonePreset(sv); c.styleId = sv; } if (rv) c.ratio = rv; if (fv) c.style.font = fv; if (pv) c.style.pos = +pv; });
      save(true); toast(`Applied to ${list.length} clips`, 'ok'); break;
    }
    case 'zip-sel': { const p = getProject(el.dataset.pid); runExport(p, p.clips.filter((c) => ui.pf.sel.has(c.id)), true); break; }
    case 'zip-all': { const p = getProject(el.dataset.pid); runExport(p, p.clips.slice(), true); break; }
    case 'dl-clip': { const p = getProject(el.dataset.pid); runExport(p, [p.clips.find((c) => c.id === el.dataset.cid)], false); break; }
    case 'render-one': { const p = getProject(el.dataset.pid); runExport(p, [p.clips.find((c) => c.id === el.dataset.cid)], false); break; }
    case 'cancel-job': if (ui.job) ui.job.abort(); break;
    case 'tab': ui.tab = el.dataset.k; $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.k === ui.tab)); $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== ui.tab; }); break;
    case 'ed-play': edPlay(); break;
    case 'nudge': { const c = ui.ed.c; setTrim(el.dataset.w, c[el.dataset.w] + Number(el.dataset.d)); break; }
    case 'cap-add': { const c = ui.ed.c; const last = c.captions.length ? c.captions[c.captions.length - 1].end : c.start; c.captions.push({ start: last, end: Math.min(last + 2, c.end), text: 'New caption' }); save(); $('#caplist').innerHTML = capList(c); edRedraw(); break; }
    case 'cap-del': { const c = ui.ed.c; c.captions.splice(+el.dataset.i, 1); save(); $('#caplist').innerHTML = capList(c); edRedraw(); break; }
    case 'translate': {
      const c = ui.ed.c; if (!c.captions.length) { toast('No captions to translate.', 'err'); break; }
      el.disabled = true; el.textContent = 'Translating…';
      try {
        const r = await api('translate', { texts: c.captions.map((x) => x.text), target: $('#tr-lang').value });
        r.texts.forEach((t, i) => { c.captions[i].text = t; });
        const L = $('#tr-lang').value; c.keywords = []; save(); $('#caplist').innerHTML = capList(c); edRedraw(); toast('Captions translated to ' + L, 'ok');
        await ensureFonts(c.style, r.texts.join(' ')); edRedraw();
      } catch (err) { toast(err.message, 'err', 6000); }
      el.disabled = false; el.textContent = 'Translate with AI'; break;
    }
    case 'ratio': {
      const e2 = ui.ed; e2.c.ratio = el.dataset.r; save();
      const [W, H] = outputSize(e2.c.ratio, 360); e2.cv.width = W; e2.cv.height = H;
      $$('[data-act="ratio"]').forEach((b) => b.classList.toggle('on', b === el)); edRedraw(); break;
    }
    case 'logo-clear': ui.ed.c.logo = null; save(); $('[data-panel="frame"]').innerHTML = framePanel(ui.ed.c); edRedraw(); break;
    case 'music-clear': { const c = ui.ed.c; c.music = null; blobDel('music:' + c.id).catch(() => {}); engine.musicClipId = null; save(); $('[data-panel="audio"]').innerHTML = audioPanel(c); break; }
    case 'gen-content': {
      const c = ui.ed.c; el.disabled = true; el.textContent = 'Generating…';
      try {
        c.content = await api('content', { title: c.title, hook: c.hook, transcript: c.captions.map((x) => x.text).join(' '), language: ui.contentLang });
        save(); $('[data-panel="content"]').innerHTML = contentPanel(c);
      } catch (err) { toast(err.message, 'err', 6000); el.disabled = false; el.textContent = 'Generate with AI'; }
      break;
    }
    case 'copy': { const v = ui.ed.c.content[el.dataset.k]; copyText(Array.isArray(v) ? v.join(el.dataset.k === 'hashtags' || el.dataset.k === 'keywords' ? ' ' : '\n') : v); break; }
    case 'thumb': {
      const e2 = ui.ed; if (!e2.ok) { toast('Import the source video first.', 'err'); break; }
      engine.pause();
      try { const text = (e2.c.content && e2.c.content.thumbnail_text) || e2.c.title.split(/\s+/).slice(0, 4).join(' '); const blob = await engine.poster(e2.c, e2.env, text); download(blob, `${slug(e2.p.title)}_clip${e2.c.n}_thumbnail.png`); await edShow(); } catch (err) { toast(err.message, 'err'); }
      break;
    }
    case 'preset': { ui.studio.style = clonePreset(el.dataset.id); await ensureFonts(ui.studio.style); $('#studio-ctl').innerHTML = styleControls(ui.studio.style); $$('.gcard').forEach((g) => g.classList.toggle('on', g === el)); break; }
    case 'studio-default': state.settings.customStyle = JSON.parse(JSON.stringify(ui.studio.style)); state.settings.style = ui.studio.style.id || state.settings.style; save(true); toast('Saved as default for new clips', 'ok'); break;
    case 'studio-apply': {
      const p = getProject($('#studio-proj').value); if (!p) { toast('No project selected.', 'err'); break; }
      p.clips.forEach((c) => { c.style = JSON.parse(JSON.stringify(ui.studio.style)); c.styleId = c.style.id; }); save(true); toast(`Style applied to ${p.clips.length} clips`, 'ok'); break;
    }
    case 'use-template': {
      const t = TEMPLATES.find((x) => x.id === el.dataset.id); Object.assign(state.settings, { ratio: t.ratio, style: t.style, customStyle: null, minDur: t.minDur, maxDur: t.maxDur, count: t.count }); save(true); toast('Template applied: ' + t.name, 'ok'); location.hash = '#/create'; break;
    }
    case 'reset-style': state.settings.customStyle = null; save(true); render(); break;
    case 'hist-dl': { const x = state.exports.find((v) => v.id === el.dataset.id); const b = await blobGet('exp:' + x.id).catch(() => null); if (b) download(b, x.name); else toast('This file is no longer stored. Render the clip again.', 'err'); break; }
    case 'hist-del': { blobDel('exp:' + el.dataset.id).catch(() => {}); state.exports = state.exports.filter((v) => v.id !== el.dataset.id); save(true); render(); break; }
    case 'hist-clear': if (confirm('Delete all exported files from history?')) { state.exports.forEach((x) => blobDel('exp:' + x.id).catch(() => {})); state.exports = []; save(true); render(); } break;
    case 'ping': await pingBackend(); render(); break;
    case 'wipe': if (confirm('Delete ALL projects, clips, exports and settings from this browser?')) { engine.unload(engine.projectId); try { indexedDB.deleteDatabase('viralcut-blobs'); } catch { /* ignore */ } localStorage.removeItem('viralcut.v1'); location.hash = '#/dashboard'; location.reload(); } break;
  }
});

/* ---------- boot ---------- */
if (!window.MediaRecorder) setTimeout(() => toast('Video export needs a recent Chrome, Edge or Firefox.', 'err', 7000), 500);
render();
pingBackend().then(() => { const r = route().name; if (['dashboard', 'create', 'settings'].includes(r) && !ui.analyzing && !engine.busy) render(); });
