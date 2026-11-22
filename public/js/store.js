// Persistent state (localStorage) + binary storage (IndexedDB).
const KEY = 'viralcut.v1';
export const DEFAULTS = {
  ratio: '9:16', res: 720, fps: 30, style: 'hormozi', customStyle: null,
  minDur: 30, maxDur: 90, count: 'auto', lang: 'English', accessCode: '',
};
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    return { projects: d.projects || [], exports: d.exports || [], settings: { ...DEFAULTS, ...(d.settings || {}) } };
  } catch { return { projects: [], exports: [], settings: { ...DEFAULTS } }; }
}
export const state = load();
let timer = null;
export function save(now = false) {
  const run = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { console.warn('save failed', e); window.dispatchEvent(new CustomEvent('vc-save-error')); return false; }
  };
  if (now) { clearTimeout(timer); return run(); }
  clearTimeout(timer); timer = setTimeout(run, 250); return true;
}
window.addEventListener('beforeunload', () => save(true));
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// IndexedDB blob store
let dbp = null;
function open() {
  if (!dbp) dbp = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB is not available in this browser.'));
    const r = indexedDB.open('viralcut-blobs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('b');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction('b', mode);
    const rq = fn(t.objectStore('b'));
    t.oncomplete = () => res(rq ? rq.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Storage aborted (disk quota?)'));
  });
}
export const blobPut = (k, v) => tx('readwrite', (s) => s.put(v, k));
export const blobGet = (k) => tx('readonly', (s) => s.get(k));
export const blobDel = (k) => tx('readwrite', (s) => s.delete(k));
