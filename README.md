<p align="center">
  <img src=".github/assets/hero.png" alt="ClipForge: turn long videos into viral clips on your desktop" width="100%" />
</p>

<h3 align="center">The open-source Opus Clip alternative that runs on your desktop.</h3>

<p align="center">
  Turn podcasts, webinars, streams and interviews into ready-to-post vertical clips.<br/>
  AI-picked moments, virality scores, animated captions, auto zoom and speaker-aware reframing.
</p>

<p align="center">
  <a href="https://github.com/JeremySNR/clip-forge/releases/latest"><img src="https://img.shields.io/github/v/release/JeremySNR/clip-forge?color=10b981&label=release" alt="Latest release" /></a>
  <a href="https://github.com/JeremySNR/clip-forge/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/JeremySNR/clip-forge/ci.yml?branch=main&label=CI" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms" />
  <a href="https://github.com/JeremySNR/clip-forge/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome" /></a>
</p>

---

## Why ClipForge instead of Opus Clip?

Opus Clip is great, but it costs a subscription, runs in the cloud, and uploads your footage. ClipForge does the same job as a free desktop app. You bring an OpenAI API key and pay **cents per video** instead of dollars per month.

|                          | **ClipForge**                                   | Opus Clip (and similar SaaS)      |
| ------------------------ | ----------------------------------------------- | --------------------------------- |
| Price                    | Free and open source (MIT). Pay only OpenAI API cents | Monthly subscription          |
| Your footage             | Stays on your machine. Only audio, transcripts and a few frames go to the API | Uploaded to their cloud |
| Processing minutes       | Unlimited                                       | Capped per plan                   |
| Watermark                | Your own logo, or none                          | Removed on paid tiers             |
| Models                   | Your choice (GPT-5 series, or the budget legacy option) | Theirs                    |
| Extensible               | Fork it, script it, PR it                       | Closed                            |

Typical cost: **~$0.36/hour of video** for Whisper transcription plus a few cents of LLM analysis with the default `gpt-5.4-mini`.

## What it looks like

<p align="center">
  <img src=".github/assets/screenshot-clips.png" alt="AI-found clips ranked by virality score" width="49%" />
  <img src=".github/assets/screenshot-editor.png" alt="Clip editor with live preview, caption styles and branding watermark" width="49%" />
</p>

## Features

**Finding the clips**

- **Import anything.** Local files (MP4/MOV/MKV/WEBM and more) or paste a URL from YouTube, Vimeo, TikTok, Twitch, or any site yt-dlp supports. Private or SSO-protected videos (like enterprise Vimeo) work by borrowing the login from your browser. No server integration needed.
- **Whisper transcription** with word-level timestamps. Long videos are chunked automatically and checkpointed, so retries and re-generations never pay for transcription twice.
- **Viral moment detection backed by research.** An LLM picks self-contained hook, build, payoff micro-stories (not clips that trail off mid-setup). You can steer it with your own prompt if you want, like "find the funniest exchanges". A second AI pass reviews every clip ending and extends it to the beat that actually completes the thought.
- **Two-pass virality scoring (0-99).** A text rubric based on Berger and Milkman's *What Makes Online Content Viral?* (JMR 2012), plus measured vocal energy, combined with a vision pass from Kayal et al. (ACL 2025) that scores sampled frames for scroll-stopping potential.

**Making them good**

- **Auto zoom.** Scene-aware punch-ins on the speaker's most energetic lines, jump zooms that cover cuts, and slow creep on static stretches. The kind of thing top short-form editors do to keep people watching.
- **Tighten cuts.** Pauses and filler words ("um", "uh") get removed automatically. Captions, B-roll, zoom and the face track all remap to the shorter timeline.
- **Speaker-aware auto-reframe.** On-device face tracking (UltraFace via ONNX Runtime, no cloud) follows the active speaker. The 9:16 crop cuts between speakers like a camera switch.
- **12 caption styles plus your own fonts.** Karaoke-style word highlighting burned in with libass. Upload any TTF/OTF and previews match exports exactly.
- **Your branding.** Overlay your logo or watermark (corner, size, opacity) on the preview and every export.
- **AI B-roll.** Say "Yoda" and a picture of Yoda pops over the video at that word. Uses Wikipedia and Openverse images, no extra API keys.
- **A real editor.** Filmstrip trim with waveform and live playhead, click-to-seek transcript that doubles as a trim tool, aspect ratios (9:16 / 1:1 / 16:9), and a live preview that matches the export.

**Shipping them**

- **Export** H.264/AAC MP4s with burned-in captions. Loudness-normalised to -14 LUFS, gentle audio tail fade, three quality tiers, NVIDIA NVENC GPU encoding with automatic CPU fallback.
- **AI post captions.** One click writes a scroll-stopping TikTok/Reels/Shorts caption (hook-first line, one engagement driver, niche hashtags). Copy it and jump straight to TikTok Studio upload.
- **In-app updates.** Packaged builds download and install updates themselves. Source checkouts update with one click (pull, rebuild, relaunch).

## Quick start

```bash
git clone https://github.com/JeremySNR/clip-forge.git
cd clip-forge
npm install
npm run dev        # development with hot reload
npm run package    # distributable build (dmg / nsis / AppImage)
```

### Publishing a release (for maintainers)

Most people should just download the app from the [releases page](https://github.com/JeremySNR/clip-forge/releases/latest) — there's no need to run anything from source. To cut a new release, bump the version and push a tag; the [`Release` workflow](.github/workflows/release.yml) builds the macOS `.dmg`, Windows installer and Linux `AppImage` and publishes them, along with the update manifests the in-app updater reads:

```bash
npm version patch        # or minor / major — bumps package.json and creates the tag
git push --follow-tags   # pushes the commit and the vX.Y.Z tag
```

Once a user has installed any build, later releases install themselves automatically. The macOS app is **not code-signed yet**, so on first launch the user right-clicks the app and chooses **Open** to get past Gatekeeper (a one-time step). Signing + notarization removes that prompt and is what enables fully silent macOS auto-updates — add an Apple Developer ID certificate and wire the signing secrets into the workflow when you're ready.

You need **Node.js 20+** and an [OpenAI API key](https://platform.openai.com/api-keys). Enter it in the app and it gets stored encrypted with Electron `safeStorage`. FFmpeg is bundled, so there is nothing else to install. Prebuilt Linux AppImages are on the [releases page](https://github.com/JeremySNR/clip-forge/releases/latest).

Everything except transcription and analysis runs locally. Rendering, face tracking, editing, zoom and export never leave your machine. Only extracted audio, transcripts and a few sampled frames go to the OpenAI API. Never the full video.

## Architecture

```
src/
├── main/                  Electron main process
│   ├── pipeline/
│   │   ├── ffmpeg.ts      probe, audio chunk extraction, thumbnails
│   │   ├── openai.ts      minimal REST client (Whisper + structured chat)
│   │   ├── transcribe.ts  chunked transcription, timestamp stitching
│   │   ├── highlights.ts  LLM viral-moment detection, scoring, ending review
│   │   ├── faces.ts       UltraFace face tracking + scene-cut detection
│   │   ├── energy.ts      per-segment vocal energy (arousal signal)
│   │   ├── ytdlp.ts       yt-dlp binary management + URL downloads
│   │   ├── broll.ts       LLM keyword tagging for B-roll inserts
│   │   ├── imagesearch.ts keyless Wikipedia/Openverse image search
│   │   ├── encoders.ts    NVENC detection/verification, GPU ffmpeg download
│   │   ├── captions.ts    ASS karaoke subtitle generation
│   │   ├── socialCaption.ts AI post-caption writer
│   │   └── render.ts      cut, reframe, auto zoom, watermark, burn-in
│   ├── updates.ts         GitHub release checks + self-update
│   ├── fonts.ts           custom caption fonts (sfnt parsing, merged fontsdir)
│   ├── ipc.ts             typed IPC handlers
│   ├── settings.ts        encrypted API key, models, branding
│   └── projects.ts        project persistence (userData/projects)
├── preload/               context-isolated typed bridge
├── shared/                types, caption styles/layout, tighten + zoom planners
└── renderer/              React UI (Tailwind, Zustand)
```

The live preview and the export share the same planning code in `src/shared/` (caption layout, tighten cuts, zoom), so what you see is what gets rendered.

## Tests

Unit tests, typecheck and lint run in CI on every push, alongside the offline pipeline test and a UI smoke test:

```bash
npm test               # vitest unit tests
npm run typecheck
npm run lint
```

Integration test scripts live in `scripts/` (`test-pipeline`, `test-e2e`, `test-quality`, `test-encoders`, `test-resilience`, `test-broll`, `test-youtube`, `smoke-test.sh`). See each file's header for what it covers. The e2e ones need `OPENAI_API_KEY`.

## Roadmap

- Direct publishing and scheduling to socials (needs an audited TikTok/YouTube app; contributions welcome)
- Multi-language caption translation
- Manual zoom keyframes on the timeline

## Contributing

Issues and PRs are welcome. The codebase is TypeScript end-to-end. `npm test && npm run typecheck && npm run lint` must pass. CI enforces all three plus an offline render test.

## License

[MIT](LICENSE)
