# ClipForge

**Open-source AI video clipper.** Turn long videos — podcasts, webinars, streams, interviews — into ready-to-post short clips with AI-picked moments, virality scores, and animated karaoke captions. A free, local-first alternative to Opus Clip that runs as a desktop app.

## What it does

1. **Import** any local video (MP4, MOV, MKV, WEBM…) or **paste a URL** — YouTube, Twitch, and every other site yt-dlp supports (the downloader binary is fetched automatically on first use).
2. **Transcribe** it with OpenAI Whisper (word-level timestamps, long videos chunked automatically).
3. **Find viral moments** — an LLM reads the timestamped transcript and picks self-contained, hook-first moments. You can steer it with your own prompt ("find the funniest exchanges", "focus on pricing advice").
4. **Score every clip** 0–99 with a virality rubric (hook strength, emotion, value density, completeness, shareability) plus a written explanation.
5. **Auto-reframe with face tracking** — an on-device face detector (UltraFace via ONNX Runtime, no cloud calls) tracks the speaker in each clip and the vertical crop cuts between speaker positions automatically, like a camera switch. Footage without faces falls back to a manual focus slider.
6. **AI B-roll** — mention "Yoda" and a picture of Yoda pops over the video at that exact word. An LLM tags visual keywords in each clip's word-timed transcript, images come from Wikipedia/Openverse (no extra API keys), and each insert is fullscreen or a picture-in-picture panel with fade in/out. Every insert can be toggled, switched between modes, or removed in the editor.
7. **Edit** each clip: trim with draggable handles, reframe to 9:16 / 1:1 / 16:9 (auto face-follow, fill-crop with a focus slider, or fit with a blurred background), pick a caption style, toggle the AI hook title, manage B-roll inserts.
8. **Preview live** — playback is bounded to the clip; reframing (including the auto face-follow cuts) and word-by-word captions are simulated in real time before you render anything.
9. **Export** MP4s with captions burned in (H.264 + AAC, faststart), one clip at a time or all at once. Three quality tiers (Draft / Standard / High with Lanczos scaling), and **NVIDIA GPU encoding (NVENC)**: ClipForge verifies your GPU with a real test encode, can download a GPU-enabled ffmpeg build on demand (the bundled one is CPU-only), and automatically falls back to CPU if a GPU encode fails mid-run.
10. **Iterate cheaply** — the transcript is checkpointed the moment Whisper finishes, so retries after a failure and "Regenerate" with different instructions skip transcription and take seconds. All API calls retry transient failures with backoff, and analysis can be cancelled mid-run.

Everything runs locally except the OpenAI API calls (Whisper + chat completions). Your videos never leave your machine.

## Requirements

- Node.js 20+
- An [OpenAI API key](https://platform.openai.com/api-keys) (entered in-app, stored encrypted with Electron `safeStorage`)

FFmpeg is bundled via `ffmpeg-static` — nothing to install.

## Run it

```bash
npm install
npm run dev        # development with hot reload
npm run package    # build a distributable (dmg / nsis / AppImage)
```

## Cost

Approximate OpenAI cost per hour of source video: ~$0.36 for Whisper transcription plus well under $0.05 for highlight analysis with `gpt-4o-mini` (the default; larger models selectable in Settings).

## Architecture

```
src/
├── main/                  Electron main process
│   ├── pipeline/
│   │   ├── ffmpeg.ts      probe, audio chunk extraction, thumbnails
│   │   ├── openai.ts      minimal REST client (Whisper + structured chat)
│   │   ├── transcribe.ts  chunked transcription, timestamp stitching
│   │   ├── highlights.ts  LLM viral-moment detection + scoring
│   │   ├── faces.ts       UltraFace ONNX face tracking -> focus track
│   │   ├── ytdlp.ts       yt-dlp binary management + URL downloads
│   │   ├── broll.ts       LLM keyword tagging for B-roll inserts
│   │   ├── imagesearch.ts keyless Wikipedia/Openverse image search
│   │   ├── encoders.ts    NVENC detection/verification, GPU ffmpeg download
│   │   ├── captions.ts    ASS karaoke subtitle generation
│   │   └── render.ts      cut, reframe (incl. auto face-follow), burn-in
│   ├── ipc.ts             typed IPC handlers
│   ├── settings.ts        encrypted API key + model settings
│   └── projects.ts        project persistence (userData/projects)
├── preload/               context-isolated typed bridge
├── shared/                types + caption styles/layout shared by both sides
└── renderer/              React UI (Tailwind, Zustand)
```

The renderer's live caption preview and the exported ASS subtitles share the same word-grouping code (`src/shared/captionLayout.ts`), so what you see is what gets burned in.

## Tests

```bash
npx tsx --tsconfig tsconfig.node.json scripts/test-pipeline.ts  # offline: ffmpeg + captions + renders
npx tsx --tsconfig tsconfig.node.json scripts/test-e2e.ts       # full AI pipeline (needs OPENAI_API_KEY)
npx tsx --tsconfig tsconfig.node.json scripts/test-youtube.ts   # URL import + face tracking on real footage
npx tsx --tsconfig tsconfig.node.json scripts/test-resilience.ts # retries, dedup, cancellation
npx tsx --tsconfig tsconfig.node.json scripts/test-encoders.ts   # NVENC detection, quality tiers, GPU ffmpeg download
npx tsx --tsconfig tsconfig.node.json scripts/test-broll.ts      # Star Wars B-roll e2e (needs OPENAI_API_KEY)
./scripts/smoke-test.sh                                          # UI screenshots under Xvfb
npm run typecheck
```

## Roadmap

- Transcript-based editing (click words to seek/trim/cut)
- Editable captions (fix transcription errors before export)
- Filmstrip timeline with waveform in the editor
- More caption styles + custom fonts
- Direct publishing/scheduling

## License

MIT
