// VIRALCUT AI - secure backend (Netlify Function).
// Keeps GEMINI_API_KEY on the server. Actions: ping, meta, analyze, content, translate.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const YT_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)(?<id>[A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/;
const CATS = ['funny', 'emotional', 'educational', 'motivational', 'podcast', 'shocking', 'story', 'other'];
const LANGS = ['English', 'Bengali', 'Hindi'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reply = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});
const fail = (status, message) => Object.assign(new Error(message), { status });

function videoId(url) {
  const m = String(url || '').trim().match(YT_RE);
  return m ? m.groups.id : null;
}

function parseTime(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

function isoDuration(s) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s || '');
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function gemini(parts, schema, temperature = 0.4) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw fail(500, 'GEMINI_API_KEY is not set in the Netlify environment variables.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
  });
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body });
    } catch (e) {
      last = { status: 502, message: 'Could not reach the Gemini API: ' + e.message };
      await sleep(1200 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* handled below */ }
    if (res.ok && data) {
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw fail(422, 'Gemini blocked this request: ' + data.promptFeedback.blockReason);
      }
      const cand = data.candidates && data.candidates[0];
      const out = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
      if (!out) throw fail(502, 'Gemini returned an empty answer (finishReason: ' + ((cand && cand.finishReason) || 'unknown') + ').');
      try { return JSON.parse(out); } catch { throw fail(502, 'Gemini returned malformed JSON. Please try again.'); }
    }
    const msg = (data && data.error && data.error.message) || text.slice(0, 300) || 'Unknown Gemini error';
    last = { status: res.status, message: msg };
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
    await sleep(1500 * (attempt + 1));
  }
  const st = last.status === 429 ? 429 : last.status >= 400 && last.status < 500 ? 400 : 502;
  throw fail(st, 'Gemini API error (' + last.status + '): ' + last.message);
}

const S = (type, extra = {}) => ({ type, ...extra });
const CLIP_SCHEMA = S('OBJECT', {
  properties: {
    video_title: S('STRING'),
    language: S('STRING'),
    duration: S('STRING'),
    clips: S('ARRAY', {
      items: S('OBJECT', {
        properties: {
          start: S('STRING'), end: S('STRING'), title: S('STRING'), hook: S('STRING'),
          description: S('STRING'), topic: S('STRING'), category: S('STRING'), score: S('INTEGER'),
          reason: S('STRING'), platform: S('STRING'), keywords: S('ARRAY', { items: S('STRING') }),
          captions: S('ARRAY', {
            items: S('OBJECT', {
              properties: { start: S('STRING'), end: S('STRING'), text: S('STRING') },
              required: ['start', 'end', 'text'],
            }),
          }),
        },
        required: ['start', 'end', 'title', 'hook', 'score', 'captions'],
      }),
    }),
  },
  required: ['clips'],
});

function normalizeClips(raw, opt) {
  const total = parseTime(raw.duration);
  const min = opt.min, max = opt.max;
  const list = [];
  for (const c of raw.clips || []) {
    let s = parseTime(c.start), e = parseTime(c.end);
    if (s == null || e == null || e <= s) continue;
    if (total && s >= total) continue;
    if (total && e > total) e = total;
    let caps = (c.captions || [])
      .map((x) => ({ start: parseTime(x.start), end: parseTime(x.end), text: String(x.text || '').trim() }))
      .filter((x) => x.start != null && x.end != null && x.end > x.start && x.text)
      .sort((a, b) => a.start - b.start);
    if (e - s > max) {
      // trim to the last complete caption line that fits, never cut mid-sentence blindly
      const fit = caps.filter((x) => x.end <= s + max);
      if (!fit.length) continue;
      e = fit[fit.length - 1].end;
    }
    if (e - s < min - 3) continue;
    caps = caps
      .filter((x) => x.end > s && x.start < e)
      .map((x) => ({ start: Math.max(x.start, s), end: Math.min(x.end, e), text: x.text }));
    const category = CATS.includes(String(c.category).toLowerCase()) ? String(c.category).toLowerCase() : 'other';
    list.push({
      start: +s.toFixed(2), end: +e.toFixed(2), duration: +(e - s).toFixed(2),
      title: String(c.title || 'Untitled clip').slice(0, 140),
      hook: String(c.hook || '').slice(0, 240),
      description: String(c.description || '').slice(0, 500),
      topic: String(c.topic || '').slice(0, 100),
      category,
      score: Math.max(1, Math.min(100, Math.round(Number(c.score) || 50))),
      reason: String(c.reason || '').slice(0, 400),
      platform: String(c.platform || 'YouTube Shorts').slice(0, 60),
      keywords: (c.keywords || []).map((k) => String(k).trim()).filter(Boolean).slice(0, 12),
      captions: caps,
    });
  }
  // duplicate / overlap removal: keep the higher scoring clip
  list.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of list) {
    const dup = kept.some((k) => {
      const ov = Math.min(c.end, k.end) - Math.max(c.start, k.start);
      return ov > 0 && ov / Math.min(c.duration, k.duration) > 0.3;
    });
    if (!dup) kept.push(c);
  }
  return { language: raw.language || '', title: raw.video_title || '', duration: total, clips: kept.slice(0, opt.count) };
}

async function actMeta(b) {
  const id = videoId(b.url);
  if (!id) throw fail(400, 'This is not a valid YouTube video link.');
  const out = { id, title: '', channel: '', thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, duration: null, status: 'unknown' };
  const yk = process.env.YOUTUBE_API_KEY;
  if (yk) {
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${id}&key=${yk}`);
      const d = await r.json();
      const it = d.items && d.items[0];
      if (r.ok && it) {
        out.title = it.snippet.title; out.channel = it.snippet.channelTitle;
        out.duration = isoDuration(it.contentDetails.duration);
        out.status = it.status.privacyStatus === 'private' ? 'private' : 'available';
        return out;
      }
      if (r.ok && !it) { out.status = 'unavailable'; return out; }
    } catch { /* fall through to oEmbed */ }
  }
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    if (r.ok) {
      const d = await r.json();
      out.title = d.title || ''; out.channel = d.author_name || ''; out.status = 'available';
    } else if (r.status === 404) out.status = 'unavailable';
    else out.status = 'restricted';
  } catch { out.status = 'unknown'; }
  return out;
}

async function actAnalyze(b) {
  const id = videoId(b.url);
  if (!id) throw fail(400, 'This is not a valid YouTube video link.');
  const min = [30, 45, 60, 90, 120, 150, 180].includes(+b.minDur) ? +b.minDur : 30;
  let max = [30, 45, 60, 90, 120, 150, 180].includes(+b.maxDur) ? +b.maxDur : 90;
  if (max < min) max = min;
  const count = b.count === 'auto' ? 20 : [5, 10, 15, 20].includes(+b.count) ? +b.count : 10;
  const want = b.count === 'auto' ? 'as many genuinely strong clips as the video deserves (at most 20, never pad with weak ones)' : `up to ${count} clips`;
  const prompt = `You are a senior short-form video editor. Watch and listen to the ENTIRE video and select ${want}.

Rules:
- Each clip must be between ${min} and ${max} seconds long and make sense on its own, with a clear beginning, middle and end.
- Never start in the middle of a sentence and never end before the main point is finished.
- Prefer: strong opening hooks, emotional, funny, shocking, educational or motivational moments, important statements, storytelling, complete conversations.
- Clips must not overlap or repeat the same point.
- Use ONLY timestamps that really exist in the video. Format "MM:SS" or "H:MM:SS". Do not invent timestamps.
- "duration" is the total length of the whole video as "H:MM:SS".
- "category" is exactly one of: ${CATS.join(', ')}.
- "score" (1-100) is your honest estimate of engagement potential; it is not a guarantee of views.
- "platform" is the best fit: YouTube Shorts, TikTok, Instagram Reels or Facebook Reels.
- "captions": a verbatim transcript of the spoken words inside the clip, split into short caption lines (3-9 words each) with absolute "start"/"end" timestamps in the SAME "MM:SS" or "MM:SS.s" format, in the original spoken language and script (Bengali in Bengali script, Hindi in Devanagari). Add punctuation.
- "keywords": 3-6 important words from the clip as they appear in the captions.
- "language": the main spoken language of the video.`;
  const raw = await gemini([{ file_data: { file_uri: 'https://www.youtube.com/watch?v=' + id } }, { text: prompt }], CLIP_SCHEMA, 0.3);
  const res = normalizeClips(raw, { min, max, count });
  if (!res.clips.length) throw fail(422, 'The AI did not return any valid clips for this video. Try a different duration range or another video.');
  return res;
}

const CONTENT_SCHEMA = S('OBJECT', {
  properties: {
    youtube_title: S('STRING'), tiktok_caption: S('STRING'), facebook_caption: S('STRING'), instagram_caption: S('STRING'),
    description: S('STRING'), hashtags: S('ARRAY', { items: S('STRING') }), keywords: S('ARRAY', { items: S('STRING') }),
    thumbnail_text: S('STRING'), music_suggestion: S('STRING'), broll_ideas: S('ARRAY', { items: S('STRING') }),
  },
  required: ['youtube_title', 'tiktok_caption', 'facebook_caption', 'instagram_caption', 'description', 'hashtags', 'keywords', 'thumbnail_text'],
});

async function actContent(b) {
  const lang = LANGS.includes(b.language) ? b.language : 'English';
  const text = String(b.transcript || '').slice(0, 6000);
  if (!text && !b.title) throw fail(400, 'Nothing to write about: this clip has no title or captions.');
  const prompt = `Write social media content in ${lang} for this short video clip.
Title: ${String(b.title || '').slice(0, 200)}
Hook: ${String(b.hook || '').slice(0, 300)}
Transcript: ${text}

Be accurate to the transcript, do not promise views or virality. Hashtags start with #. thumbnail_text must be 2-5 words. music_suggestion = a mood/genre of background music. broll_ideas = 3-5 short B-roll visual ideas. Bengali output must be in Bengali script.`;
  return gemini([{ text: prompt }], CONTENT_SCHEMA, 0.7);
}

async function actTranslate(b) {
  const lang = LANGS.includes(b.target) ? b.target : null;
  if (!lang) throw fail(400, 'Unsupported target language.');
  const texts = Array.isArray(b.texts) ? b.texts.map((t) => String(t)) : [];
  if (!texts.length || texts.length > 400 || texts.join('').length > 40000) throw fail(400, 'Too many caption lines to translate at once.');
  const schema = S('OBJECT', { properties: { texts: S('ARRAY', { items: S('STRING') }) }, required: ['texts'] });
  const prompt = `Translate each of the ${texts.length} subtitle lines below into ${lang} (use the native script). Keep the meaning, keep each line short, return exactly ${texts.length} lines in the same order.\n\n` + JSON.stringify(texts);
  const out = await gemini([{ text: prompt }], schema, 0.2);
  if (!Array.isArray(out.texts) || out.texts.length !== texts.length) throw fail(502, 'Translation returned a different number of lines. Please try again.');
  return { texts: out.texts.map(String) };
}

exports.handler = async (event) => {
  try {
    const code = process.env.ACCESS_CODE || '';
    const sent = (event.headers && (event.headers['x-access-code'] || event.headers['X-Access-Code'])) || '';
    const authorized = !code || sent === code;
    if (event.httpMethod === 'GET') {
      return reply(200, { ok: true, configured: !!process.env.GEMINI_API_KEY, model: MODEL, accessCodeRequired: !!code, authorized });
    }
    if (event.httpMethod !== 'POST') throw fail(405, 'Method not allowed.');
    let b;
    try { b = JSON.parse(event.body || '{}'); } catch { throw fail(400, 'Invalid JSON body.'); }
    if (!authorized) throw fail(401, 'Access code required or wrong. Enter it in Settings.');
    switch (b.action) {
      case 'meta': return reply(200, await actMeta(b));
      case 'analyze': return reply(200, await actAnalyze(b));
      case 'content': return reply(200, await actContent(b));
      case 'translate': return reply(200, await actTranslate(b));
      default: throw fail(400, 'Unknown action.');
    }
  } catch (e) {
    return reply(e.status || 500, { error: e.message || 'Server error' });
  }
};

exports._test = { videoId, parseTime, normalizeClips, isoDuration };
