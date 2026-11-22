// Caption presets, word timeline and canvas caption renderer.
const BASE = {
  font: 'Montserrat', weight: 800, italic: false, size: 0.085, color: '#ffffff', hi: '#ffd400', hi2: '',
  stroke: '#000000', strokeW: 0.12, shadow: { c: 'rgba(0,0,0,.6)', b: 8, x: 0, y: 4 },
  bg: '', bgOp: 0.6, upper: false, anim: 'pop', speed: 1, hiActive: true, hiKeys: true, karaoke: false,
  grad: null, pos: 0.72, align: 'center', lineH: 1.25, chunk: 3,
};
const P = (id, name, o) => ({ id, name, ...BASE, ...o });

export const PRESETS = [
  P('mrbeast', 'MrBeast Bold', { font: 'Anton', weight: 400, size: 0.1, upper: true, strokeW: 0.17, hi: '#ffe600', chunk: 2 }),
  P('hormozi', 'Hormozi', { font: 'Montserrat', weight: 900, upper: true, hi: '#00e676', strokeW: 0.1, chunk: 3 }),
  P('podcast', 'Modern Podcast', { font: 'Poppins', weight: 600, size: 0.058, strokeW: 0, bg: '#000000', bgOp: 0.55, hiActive: false, hi: '#9d8cff', anim: 'fade', pos: 0.8, chunk: 5, shadow: null }),
  P('cinematic', 'Cinematic', { font: 'Playfair Display', weight: 700, italic: true, size: 0.055, strokeW: 0, hiActive: false, hiKeys: false, anim: 'fade', pos: 0.86, chunk: 6 }),
  P('yellowkey', 'Yellow Keyword', { font: 'Inter', weight: 800, hiActive: false, hi: '#ffe600', strokeW: 0.1 }),
  P('neonblue', 'Neon Blue', { font: 'Montserrat', weight: 800, color: '#d8f7ff', hi: '#00d4ff', strokeW: 0.04, stroke: '#003a66', shadow: { c: '#00d4ff', b: 26, x: 0, y: 0 } }),
  P('neongreen', 'Neon Green', { font: 'Montserrat', weight: 800, color: '#eaffe0', hi: '#39ff14', strokeW: 0.04, stroke: '#0a3d00', shadow: { c: '#39ff14', b: 26, x: 0, y: 0 } }),
  P('minimal', 'White Minimal', { font: 'Inter', weight: 700, size: 0.06, strokeW: 0, hiActive: false, hiKeys: false, anim: 'fade', shadow: { c: 'rgba(0,0,0,.7)', b: 14, x: 0, y: 2 } }),
  P('gaming', 'Gaming Pixel', { font: 'Press Start 2P', weight: 400, size: 0.048, hi: '#ff2d95', stroke: '#2a0a5e', strokeW: 0.22, anim: 'bounce', upper: true, lineH: 1.5 }),
  P('karaoke', 'Karaoke', { font: 'Poppins', weight: 800, karaoke: true, hiActive: false, hiKeys: false, hi: '#ff3b8d', strokeW: 0.1, anim: 'fade' }),
  P('gradient', 'Gradient Text', { font: 'Montserrat', weight: 900, upper: true, grad: ['#ff6bd6', '#6b8bff'], strokeW: 0.08, hiActive: false, hiKeys: false }),
  P('popup', 'Pop-up', { font: 'Fredoka', weight: 700, anim: 'pop', speed: 1.5, hi: '#ffd400', chunk: 2 }),
  P('bouncing', 'Bouncing Text', { font: 'Fredoka', weight: 700, anim: 'bounce', hi: '#35c8ff', chunk: 3 }),
  P('luxury', 'Luxury', { font: 'Playfair Display', weight: 700, color: '#f3dfa2', hi: '#ffffff', size: 0.06, strokeW: 0, anim: 'fade', pos: 0.8, hiKeys: false, shadow: { c: 'rgba(0,0,0,.8)', b: 10, x: 0, y: 3 } }),
  P('bolduc', 'Bold Uppercase', { font: 'Oswald', weight: 700, upper: true, hi: '#ff3d3d', strokeW: 0.12, size: 0.095 }),
  P('rounded', 'Modern Rounded', { font: 'Fredoka', weight: 600, size: 0.065, strokeW: 0, bg: '#6d28d9', bgOp: 0.92, hiActive: false, hiKeys: false, shadow: null, chunk: 4 }),
  P('shadow', 'Shadow', { font: 'Poppins', weight: 800, strokeW: 0, shadow: { c: '#000000', b: 0, x: 6, y: 6 }, hi: '#ffd400' }),
  P('outline', 'Outline', { font: 'Montserrat', weight: 800, stroke: '#1d4ed8', strokeW: 0.2, hi: '#fde047', shadow: null }),
  P('motivation', 'Motivational', { font: 'Bebas Neue', weight: 400, size: 0.12, upper: true, hi: '#ffb300', pos: 0.5, chunk: 3 }),
  P('documentary', 'Clean Documentary', { font: 'Inter', weight: 500, size: 0.05, strokeW: 0, bg: '#000000', bgOp: 0.35, hiActive: false, hiKeys: false, anim: 'fade', pos: 0.88, chunk: 7, shadow: null }),
  P('shorts', 'Viral Shorts', { font: 'Anton', weight: 400, size: 0.1, upper: true, hi: '#ff0050', hi2: '#00f2ea', strokeW: 0.15, chunk: 2 }),
  P('wordhi', 'Animated Word Highlight', { font: 'Poppins', weight: 800, anim: 'wordpop', hi: '#22d3ee', strokeW: 0.1 }),
  P('interview', 'Pro Interview', { font: 'Inter', weight: 600, size: 0.05, strokeW: 0, bg: '#111827', bgOp: 0.78, hiActive: false, hiKeys: false, anim: 'none', pos: 0.85, chunk: 6, shadow: null }),
  P('colorgame', 'Colorful Gaming', { font: 'Bangers', weight: 400, size: 0.1, grad: ['#fde047', '#f97316'], stroke: '#3b0764', strokeW: 0.2, anim: 'bounce', hiActive: false, hiKeys: false }),
  P('socialmin', 'Minimal Social', { font: 'Inter', weight: 700, size: 0.058, strokeW: 0, hi: '#fcd34d', hiActive: false, anim: 'fade', pos: 0.75, shadow: { c: 'rgba(0,0,0,.7)', b: 12, x: 0, y: 2 } }),
];
export const PRESET_MAP = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
export const FONT_FAMILIES = ['Montserrat', 'Poppins', 'Inter', 'Anton', 'Bebas Neue', 'Oswald', 'Bangers', 'Fredoka', 'Playfair Display', 'Press Start 2P', 'Noto Sans Bengali', 'Noto Sans Devanagari', 'Arial', 'Georgia', 'Impact'];
export const ANIMS = ['none', 'pop', 'bounce', 'fade', 'wordpop'];

export function clonePreset(id) { return JSON.parse(JSON.stringify(PRESET_MAP[id] || PRESETS[1])); }

export function fontString(st, px) {
  return `${st.italic ? 'italic ' : ''}${st.weight} ${px}px "${st.font}", "Noto Sans Bengali", "Noto Sans Devanagari", "Segoe UI", Arial, sans-serif`;
}

// Make sure webfonts (incl. Bengali/Hindi glyph fonts) are loaded before drawing/exporting.
export async function ensureFonts(st, sample = '') {
  if (!document.fonts || !document.fonts.load) return;
  const jobs = [
    document.fonts.load(`${st.italic ? 'italic ' : ''}${st.weight} 40px "${st.font}"`, 'Abc' + sample.slice(0, 40)),
    document.fonts.load('700 40px "Noto Sans Bengali"', 'অআক'),
    document.fonts.load('700 40px "Noto Sans Devanagari"', 'अआक'),
  ];
  try { await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 4000))]); } catch { /* offline: fallback fonts are used */ }
}

// ---- timeline: captions -> chunks of words with approximate per-word timing ----
export function buildTimeline(caps, chunkSize, offset = 0) {
  const chunks = [];
  for (const c of caps || []) {
    const words = String(c.text || '').split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const s = c.start + offset, e = Math.max(c.end + offset, s + 0.2);
    const total = words.reduce((a, w) => a + w.length + 1, 0);
    let t = s;
    const timed = words.map((w) => {
      const d = ((w.length + 1) / total) * (e - s);
      const o = { w, s: t, e: t + d }; t += d; return o;
    });
    const n = Math.max(1, chunkSize | 0 || 3);
    // balance chunk sizes so we do not leave a single orphan word
    const parts = Math.ceil(timed.length / n);
    const per = Math.ceil(timed.length / parts);
    for (let i = 0; i < timed.length; i += per) {
      const ws = timed.slice(i, i + per);
      chunks.push({ start: ws[0].s, end: ws[ws.length - 1].e, words: ws });
    }
  }
  chunks.sort((a, b) => a.start - b.start);
  return chunks;
}
export function chunkAt(chunks, t) {
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (t >= c.start && t < (chunks[i + 1] ? Math.max(c.end, Math.min(chunks[i + 1].start, c.end + 0.35)) : c.end + 0.35)) return c;
  }
  return null;
}

const hexA = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const easeOutBack = (k) => 1 + 2.70158 * Math.pow(k - 1, 3) + 1.70158 * Math.pow(k - 1, 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function keywordSet(list) {
  const s = new Set();
  for (const k of list || []) for (const w of String(k).split(/\s+/)) { const n = norm(w); if (n) s.add(n); }
  return s;
}

export function drawCaptions(ctx, W, H, chunk, t, st, keys) {
  if (!chunk || !chunk.words.length) return;
  const px = Math.max(10, Math.round(st.size * Math.min(W, H)));
  ctx.save();
  ctx.font = fontString(st, px);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const space = ctx.measureText(' ').width;
  const words = chunk.words.map((w) => {
    const text = st.upper ? w.w.toUpperCase() : w.w;
    return { ...w, text, width: ctx.measureText(text).width };
  });
  const maxW = W * 0.88;
  const lines = [];
  let cur = [], curW = 0;
  for (const w of words) {
    const add = cur.length ? space + w.width : w.width;
    if (cur.length && curW + add > maxW) { lines.push({ ws: cur, w: curW }); cur = [w]; curW = w.width; }
    else { cur.push(w); curW += add; }
  }
  if (cur.length) lines.push({ ws: cur, w: curW });
  const lh = px * st.lineH;
  const blockH = lines.length * lh;
  let top = st.pos * H - blockH / 2;
  top = clamp(top, H * 0.03, Math.max(H * 0.03, H * 0.97 - blockH));
  const age = t - chunk.start;
  const dur = 0.18 / Math.max(0.2, st.speed || 1);
  const k = clamp(age / dur, 0, 1);
  let alpha = 1, blockScale = 1;
  if (st.anim === 'pop') { alpha = k; blockScale = 0.7 + 0.3 * easeOutBack(k); }
  else if (st.anim === 'fade') alpha = clamp(k * 1.5, 0, 1);
  const cx = W / 2, cy = top + blockH / 2;
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy); ctx.scale(blockScale, blockScale); ctx.translate(-cx, -cy);

  const left = W * 0.06, right = W * 0.94;
  const xFor = (ln) => (st.align === 'left' ? left : st.align === 'right' ? right - ln.w : (W - ln.w) / 2);

  if (st.bg) {
    const padX = px * 0.45, padY = px * 0.22;
    const bw = Math.max(...lines.map((l) => l.w)) + padX * 2;
    const bx = st.align === 'left' ? left - padX : st.align === 'right' ? right - bw + padX : (W - bw) / 2;
    ctx.fillStyle = hexA(st.bg, st.bgOp);
    const r = px * 0.35, y0 = top - padY, bh = blockH + padY * 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, y0, bw, bh, r); else ctx.rect(bx, y0, bw, bh);
    ctx.fill();
  }

  lines.forEach((ln, li) => {
    let x = xFor(ln);
    const yBase = top + li * lh + lh / 2;
    for (const w of ln.ws) {
      const active = t >= w.s && t < w.e;
      const spoken = t >= w.e;
      let color = st.color, isHi = false;
      if (st.karaoke && (spoken || active)) { color = st.hi; isHi = true; }
      else if (st.hiActive && active) { color = st.hi; isHi = true; }
      else if (st.hiKeys && keys && keys.has(norm(w.w))) { color = st.hi2 || st.hi; isHi = true; }
      let y = yBase, sc = 1;
      if (st.anim === 'bounce' && active) y -= Math.sin(clamp((t - w.s) / Math.max(0.05, w.e - w.s), 0, 1) * Math.PI) * px * 0.2;
      if (st.anim === 'wordpop' && active) sc = 1.18;
      ctx.save();
      if (sc !== 1) { const wx = x + w.width / 2; ctx.translate(wx, y); ctx.scale(sc, sc); ctx.translate(-wx, -y); }
      if (st.strokeW > 0) {
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.lineWidth = px * st.strokeW; ctx.strokeStyle = st.stroke;
        ctx.strokeText(w.text, x, y);
      }
      if (st.shadow) { ctx.shadowColor = st.shadow.c; ctx.shadowBlur = st.shadow.b; ctx.shadowOffsetX = st.shadow.x; ctx.shadowOffsetY = st.shadow.y; }
      if (st.grad && !isHi) {
        const g = ctx.createLinearGradient(0, y - px / 2, 0, y + px / 2);
        g.addColorStop(0, st.grad[0]); g.addColorStop(1, st.grad[1]);
        ctx.fillStyle = g;
      } else ctx.fillStyle = color;
      ctx.fillText(w.text, x, y);
      ctx.restore();
      x += w.width + space;
    }
  });
  ctx.restore();
}
