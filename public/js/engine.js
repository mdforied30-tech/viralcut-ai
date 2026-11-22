// Video engine: frame compositing (crop/fit, filters, captions, text, logo), audio graph,
// real-time preview and real rendering (canvas + MediaRecorder -> MP4/WebM file).
import { drawCaptions, chunkAt, buildTimeline, keywordSet, ensureFonts } from './captions.js';
import { blobGet } from './store.js';

export const RATIOS = { '9:16': [9, 16], '16:9': [16, 9], '1:1': [1, 1], '4:5': [4, 5], '3:4': [3, 4] };
export const FILTERS = {
  none: 'none', vivid: 'saturate(1.35) contrast(1.08)', warm: 'sepia(.25) saturate(1.2) brightness(1.03)',
  cool: 'hue-rotate(-12deg) saturate(1.1) brightness(1.02)', bw: 'grayscale(1) contrast(1.1)',
  cinematic: 'contrast(1.18) saturate(.9) sepia(.12)', bright: 'brightness(1.15) contrast(1.05)',
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function outputSize(ratio, short) {
  const [a, b] = RATIOS[ratio] || RATIOS['9:16'];
  const s = short / Math.min(a, b);
  return [Math.round((a * s) / 2) * 2, Math.round((b * s) / 2) * 2];
}
export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,opus', 'video/mp4;codecs=avc1,opus', 'video/mp4;codecs=avc1', 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  return c.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}
export const extFor = (mime) => (String(mime).startsWith('video/mp4') ? 'mp4' : 'webm');

function seek(v, t) {
  return new Promise((res) => {
    t = clamp(t, 0, (v.duration || t) - 0.001);
    if (Math.abs(v.currentTime - t) < 0.005 && v.readyState >= 2) return res();
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); clearTimeout(to); res(); };
    const to = setTimeout(fin, 6000);
    v.addEventListener('seeked', fin);
    v.currentTime = t;
  });
}

const logoCache = new Map();
function logoImage(data) {
  if (!data) return null;
  let i = logoCache.get(data);
  if (!i) { i = new Image(); i.src = data; logoCache.set(data, i); }
  return i.complete && i.naturalWidth ? i : null;
}

const bg = document.createElement('canvas');
const bgx = bg.getContext('2d');

function gapSkip(segs, clip, t) {
  if (!clip.silence || !segs.length) return null;
  let prevEnd = clip.start, next = null;
  for (const g of segs) {
    if (t >= g.s && t < g.e) return null;
    if (g.e <= t) prevEnd = Math.max(prevEnd, g.e);
    else if (g.s > t) { next = g; break; }
  }
  if (!next) return null;
  if (next.s - prevEnd > 1.0 && next.s - t > 0.5 && t > prevEnd + 0.4) return next.s - 0.2;
  return null;
}

export const engine = {
  video: null, projectId: null, url: null, actx: null, nodes: null, music: null, musicClipId: null, musicUrl: null,
  face: { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 }, faceDet: null, faceBusy: false, lastFace: 0,
  raf: 0, token: 0, playing: false, busy: false,
  supportsFace: typeof window !== 'undefined' && 'FaceDetector' in window,

  init() {
    if (this.video) return;
    const v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto';
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    this.video = v;
    const m = new Audio(); m.loop = true; m.preload = 'auto';
    this.music = m;
  },
  get ready() { return !!(this.video && this.url && this.video.videoWidth); },

  async loadSource(pid, blob) {
    this.init();
    if (this.projectId === pid && this.url) return;
    this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob); this.projectId = pid;
    const v = this.video;
    await new Promise((res, rej) => {
      const clean = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', bad); };
      const ok = () => { clean(); res(); };
      const bad = () => { clean(); this.url = null; this.projectId = null; rej(new Error('Your browser cannot play this file. Please use an MP4 (H.264) or WebM video.')); };
      v.addEventListener('loadeddata', ok); v.addEventListener('error', bad);
      v.src = this.url;
    });
  },
  unload(pid) {
    if (!this.video || this.projectId !== pid) return;
    this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.video.removeAttribute('src'); this.video.load();
    this.url = null; this.projectId = null;
  },

  async audioInit() {
    this.init();
    if (!this.actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Web Audio is not supported in this browser.');
      const a = new AC();
      const vs = a.createMediaElementSource(this.video);
      const vg = a.createGain();
      const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 10;
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
      const rec = a.createMediaStreamDestination();
      const mon = a.createGain();
      vs.connect(vg); vg.connect(hp); hp.connect(lp); lp.connect(rec); lp.connect(mon); mon.connect(a.destination);
      const ms = a.createMediaElementSource(this.music);
      const mg = a.createGain();
      ms.connect(mg); mg.connect(rec); mg.connect(mon);
      this.actx = a; this.nodes = { vg, hp, lp, rec, mon, mg };
    }
    if (this.actx.state === 'suspended') await this.actx.resume();
  },
  applyAudio(clip, monitor) {
    const n = this.nodes; if (!n) return;
    n.vg.gain.value = clip.vol == null ? 1 : clip.vol;
    n.mg.gain.value = clip.music ? clip.music.vol : 0;
    n.hp.frequency.value = clip.noise ? 100 : 10;
    n.lp.frequency.value = clip.noise ? 9000 : 20000;
    n.mon.gain.value = monitor ? 1 : 0;
  },
  async prepMusic(clip) {
    if (!clip.music) { this.music.pause(); return false; }
    if (this.musicClipId !== clip.id || !this.musicUrl) {
      const blob = await blobGet('music:' + clip.id);
      if (!blob) throw new Error('The background music file is missing. Please add it again in the Audio tab.');
      if (this.musicUrl) URL.revokeObjectURL(this.musicUrl);
      this.musicUrl = URL.createObjectURL(blob); this.music.src = this.musicUrl; this.musicClipId = clip.id;
    }
    return true;
  },

  makeEnv(clip) {
    const off = clip.capOffset || 0;
    const caps = clip.captions || [];
    return {
      tl: buildTimeline(caps, clip.style.chunk, off),
      keys: keywordSet(clip.keywords),
      segs: caps.map((c) => ({ s: c.start + off, e: c.end + off })).sort((a, b) => a.s - b.s),
    };
  },

  async faceTick() {
    if (!this.supportsFace || this.faceBusy) return;
    const now = performance.now();
    if (now - this.lastFace < 400) return;
    this.lastFace = now; this.faceBusy = true;
    try {
      this.faceDet = this.faceDet || new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const f = await this.faceDet.detect(this.video);
      if (f.length) {
        const b = f[0].boundingBox;
        this.face.tx = (b.x + b.width / 2) / this.video.videoWidth;
        this.face.ty = (b.y + b.height / 2) / this.video.videoHeight;
      }
    } catch { this.supportsFace = false; }
    this.faceBusy = false;
  },

  drawFrame(ctx, W, H, clip, t, env = {}) {
    const v = this.video;
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const vw = v && v.videoWidth, vh = v && v.videoHeight;
    const prog = clamp((t - clip.start) / Math.max(0.1, clip.end - clip.start), 0, 1);
    if (vw && vh) {
      const filt = FILTERS[clip.filter] || 'none';
      if (clip.fit === 'fit') {
        const bw = Math.max(16, Math.round(W / 14)), bh = Math.max(16, Math.round(H / 14));
        if (bg.width !== bw || bg.height !== bh) { bg.width = bw; bg.height = bh; }
        const sc = Math.max(bw / vw, bh / vh), sw = bw / sc, sh = bh / sc;
        bgx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, bw, bh);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bg, 0, 0, W, H);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
        const zoom = clip.trans === 'zoom' ? 1 + 0.08 * prog : 1;
        const s = Math.min(W / vw, H / vh) * zoom, dw = vw * s, dh = vh * s;
        ctx.filter = filt;
        ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.filter = 'none';
      } else {
        const zoom = clip.trans === 'zoom' ? 1 + 0.1 * prog : 1;
        const s = Math.max(W / vw, H / vh) * zoom, sw = W / s, sh = H / s;
        let fx = clip.cropX == null ? 0.5 : clip.cropX, fy = 0.5;
        if (clip.track && this.supportsFace) {
          this.face.x += (this.face.tx - this.face.x) * 0.15; this.face.y += (this.face.ty - this.face.y) * 0.15;
          fx = this.face.x; fy = this.face.y;
        }
        const sx = clamp(fx * vw - sw / 2, 0, vw - sw), sy = clamp(fy * vh - sh / 2, 0, vh - sh);
        ctx.filter = filt;
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
        ctx.filter = 'none';
      }
    }
    if (clip.text && clip.text.content) {
      const lines = String(clip.text.content).split('\n').slice(0, 4);
      let px = Math.round(clip.text.size * Math.min(W, H));
      ctx.font = `800 ${px}px "Montserrat","Noto Sans Bengali","Noto Sans Devanagari",Arial,sans-serif`;
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (widest > W * 0.9) { px = Math.floor((px * W * 0.9) / widest); ctx.font = `800 ${px}px "Montserrat","Noto Sans Bengali","Noto Sans Devanagari",Arial,sans-serif`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = px * 0.14; ctx.strokeStyle = '#000'; ctx.fillStyle = clip.text.color || '#fff';
      lines.forEach((l, i) => {
        const y = clip.text.y * H + (i - (lines.length - 1) / 2) * px * 1.2;
        ctx.strokeText(l, W / 2, y); ctx.fillText(l, W / 2, y);
      });
      ctx.textAlign = 'start';
    }
    if (clip.logo && clip.logo.data) {
      const img = logoImage(clip.logo.data);
      if (img) {
        const lw = clip.logo.size * Math.min(W, H), lh = (lw * img.naturalHeight) / img.naturalWidth, m = Math.min(W, H) * 0.04;
        const p = clip.logo.pos || 'tr';
        ctx.globalAlpha = 0.95;
        ctx.drawImage(img, p.includes('l') ? m : W - lw - m, p.includes('t') ? m : H - lh - m, lw, lh);
        ctx.globalAlpha = 1;
      }
    }
    if (!env.noCaps && env.tl) drawCaptions(ctx, W, H, chunkAt(env.tl, t), t, clip.style, env.keys);
    if (env.thumbText) {
      const px = Math.round(Math.min(W, H) * 0.13);
      ctx.font = `900 ${px}px "Anton","Montserrat","Noto Sans Bengali",Impact,sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const words = env.thumbText.toUpperCase().split(/\s+/); const lines = []; let cur = '';
      for (const w of words) { const n = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(n).width > W * 0.88) { lines.push(cur); cur = w; } else cur = n; }
      if (cur) lines.push(cur);
      lines.forEach((l, i) => {
        const y = H * 0.2 + i * px * 1.15;
        ctx.lineWidth = px * 0.2; ctx.strokeStyle = '#000'; ctx.strokeText(l, W / 2, y);
        ctx.fillStyle = i === 0 ? '#ffe600' : '#ffffff'; ctx.fillText(l, W / 2, y);
      });
      ctx.textAlign = 'start';
    }
    if (clip.trans === 'fade') {
      const a = Math.max(0, 1 - (t - clip.start) / 0.3, 1 - (clip.end - t) / 0.3);
      if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${clamp(a, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
    }
    ctx.restore();
  },

  async showFrame(clip, env, canvas, t) {
    if (!this.ready) return;
    await seek(this.video, t);
    this.drawFrame(canvas.getContext('2d'), canvas.width, canvas.height, clip, t, env);
  },

  async play(clip, env, canvas, onTick) {
    if (!this.ready || this.busy) return;
    await this.audioInit();
    this.applyAudio(clip, true);
    const hasMusic = await this.prepMusic(clip);
    const v = this.video;
    let t0 = v.currentTime;
    if (t0 < clip.start || t0 >= clip.end - 0.05) t0 = clip.start;
    await seek(v, t0);
    const token = ++this.token;
    this.playing = true;
    const ctx = canvas.getContext('2d');
    if (hasMusic) { this.music.currentTime = 0; this.music.play().catch(() => {}); }
    try { await v.play(); } catch (err) { this.playing = false; throw err; }
    const tick = () => {
      if (token !== this.token) return;
      const t = v.currentTime;
      if (t >= clip.end - 0.03 || v.ended) { this.pause(); onTick(clip.start, true); return; }
      const skip = gapSkip(env.segs || [], clip, t);
      if (skip != null) v.currentTime = Math.min(skip, clip.end - 0.1);
      if (clip.track) this.faceTick();
      this.drawFrame(ctx, canvas.width, canvas.height, clip, t, env);
      onTick(t, false);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  pause() {
    this.token++; cancelAnimationFrame(this.raf);
    if (this.video) this.video.pause();
    if (this.music) this.music.pause();
    this.playing = false;
  },

  async frameDataURL(t, width = 240) {
    if (!this.ready) return null;
    await seek(this.video, t);
    const v = this.video, c = document.createElement('canvas');
    c.width = width; c.height = Math.round((width * v.videoHeight) / v.videoWidth);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  },

  async poster(clip, env, text) {
    const [W, H] = outputSize(clip.ratio, 1080);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    await ensureFonts(clip.style);
    const t = clip.start + Math.min(3, (clip.end - clip.start) * 0.15);
    await seek(this.video, t);
    this.drawFrame(c.getContext('2d'), W, H, { ...clip, trans: 'none', text: clip.text }, t, { ...env, noCaps: true, thumbText: text });
    return new Promise((res) => c.toBlob(res, 'image/png'));
  },

  // REAL render: plays the selected range and records the composited canvas + audio.
  async render(clip, opts, onProgress, signal) {
    if (!this.ready) throw new Error('Import the source video first.');
    if (this.busy) throw new Error('Another render is already running.');
    const mime = pickMime();
    if (!mime) throw new Error('This browser cannot record video (MediaRecorder missing). Use a recent Chrome, Edge or Firefox on desktop/Android.');
    this.busy = true; this.pause();
    const v = this.video;
    let wake = null, rec = null, vstream = null;
    try {
      const [W, H] = outputSize(clip.ratio, opts.res);
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const env = this.makeEnv(clip);
      await ensureFonts(clip.style, (clip.captions || []).map((c) => c.text).join(' '));
      await this.audioInit();
      this.applyAudio(clip, false);
      const hasMusic = await this.prepMusic(clip);
      await seek(v, clip.start);
      this.drawFrame(ctx, W, H, clip, clip.start, env);
      vstream = canvas.captureStream(opts.fps);
      const stream = new MediaStream([...vstream.getVideoTracks(), ...this.nodes.rec.stream.getAudioTracks()]);
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.res >= 1080 ? 8e6 : 5e6, audioBitsPerSecond: 128000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res, rej) => { rec.onstop = res; rec.onerror = (e) => rej(e.error || new Error('Recorder error')); });
      try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch { /* optional */ }
      rec.start(1000);
      if (hasMusic) { this.music.currentTime = 0; this.music.play().catch(() => {}); }
      try { await v.play(); } catch (e) { throw new Error('The browser blocked playback (' + e.message + '). Tap the Render button again.'); }
      await new Promise((resolve, reject) => {
        let lastT = v.currentTime, lastMove = performance.now();
        const tick = () => {
          if (signal && signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
          const t = v.currentTime;
          if (t !== lastT) { lastT = t; lastMove = performance.now(); }
          else if (performance.now() - lastMove > 15000) return reject(new Error('Playback stalled. Keep this tab open and visible while rendering.'));
          const skip = gapSkip(env.segs, clip, t);
          if (skip != null) v.currentTime = Math.min(skip, clip.end - 0.1);
          if (clip.track) this.faceTick();
          this.drawFrame(ctx, W, H, clip, t, env);
          onProgress(clamp((t - clip.start) / (clip.end - clip.start), 0, 1));
          if (t >= clip.end - 0.03 || v.ended) return resolve();
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      v.pause(); this.music.pause();
      try { rec.requestData(); } catch { /* ignore */ }
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) throw new Error('Rendering produced an empty file.');
      onProgress(1);
      return { blob, mime: blob.type, ext: extFor(mime), width: W, height: H };
    } finally {
      v.pause(); this.music.pause();
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* ignore */ } }
      if (vstream) vstream.getTracks().forEach((t) => t.stop());
      if (wake) wake.release().catch(() => {});
      this.busy = false;
    }
  },
};
