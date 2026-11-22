# VIRALCUT AI

YouTube video -> AI-picked short clips -> captions -> real MP4 export.

## Deploy (GitHub -> Netlify)
1. Upload ALL files in this folder to a GitHub repo (keep the folder structure).
2. Netlify -> Add new site -> Import from Git -> pick the repo. Build command: leave empty. Publish dir: `public` (already set in netlify.toml).
3. Site configuration -> Environment variables -> add `GEMINI_API_KEY` (from aistudio.google.com). Optional: `GEMINI_MODEL`, `YOUTUBE_API_KEY`, `ACCESS_CODE`.
4. Deploys -> Trigger deploy -> Deploy site. Done.

## How it works
- Paste a YouTube link: title/channel/thumbnail load, Gemini analyses the video by URL (key stays in the Netlify Function).
- Cutting/rendering happens in the browser from the video file you own/are authorised to use (no YouTube downloading or DRM bypass). Pick that file once when asked.
- Projects, settings and export history are saved in the browser (IndexedDB/localStorage).
- Best on desktop/Android Chrome or Edge.
