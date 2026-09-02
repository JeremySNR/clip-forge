# Contributing to ClipForge

Thanks for looking. ClipForge is a TypeScript Electron app and contributions are
genuinely welcome, whether that is a bug report, a caption style or a new
pipeline stage.

## Getting set up

You need **Node.js 20+**. FFmpeg is bundled, so there is nothing else to
install.

```bash
git clone https://github.com/JeremySNR/clip-forge.git
cd clip-forge
npm install
npm run dev
```

Most of the app works without an API key. Transcription and clip analysis need
an [OpenAI API key](https://platform.openai.com/api-keys), entered in Settings
and stored encrypted with Electron `safeStorage`. If you want to explore the UI
without spending anything, seed a demo project instead:

```bash
npx tsx --tsconfig tsconfig.node.json scripts/seed-demo.ts
```

## Before you open a PR

These three must pass, and CI enforces all of them plus an offline render test
and a UI smoke test:

```bash
npm test          # vitest, currently 254 tests
npm run typecheck # both tsconfigs, node and web
npm run lint      # eslint
```

## How the code is laid out

`README.md` has the full tree. The short version:

- `src/main/` is the Electron main process. `src/main/pipeline/` is where
  transcription, clip detection, face tracking and rendering live.
- `src/shared/` is the important one. Caption layout, tighten-cuts and zoom
  planning all live here **because the live preview and the export both use
  them**. If you change planning logic, change it here or the preview and the
  rendered file will disagree.
- `src/renderer/` is the React UI (Tailwind, Zustand).
- `src/preload/` is the typed, context-isolated bridge. IPC handlers are in
  `src/main/ipc.ts`.

`AGENTS.md` has notes aimed at AI coding agents, and is worth a read for humans
too.

## Testing changes to the pipeline

Unit tests cover the planners and pure logic. For anything that touches ffmpeg
or rendering, the standalone scripts in `scripts/` are the real check:

```bash
npx tsx --tsconfig tsconfig.node.json scripts/test-pipeline.ts   # offline
./scripts/smoke-test.sh .tmp/smoke                               # Xvfb, Linux
```

`test-pipeline`, `test-quality`, `test-encoders`, `test-resilience`,
`test-wholevideo`, `test-captionsize` and `test-uploadsize` run offline.
`test-e2e`, `test-broll` and `test-youtube` need network or an API key. Each
file's header says what it covers.

## Things that are easy to get wrong

- **Preview and export must match.** Anything affecting what the viewer sees
  belongs in `src/shared/`, used by both paths.
- **Caption sizing is not CSS sizing.** libass sizes text against the font's
  OS/2 window ascent plus descent, not the em square. Use `assFontSize`.
- **Don't log auth values.** API keys, session cookies and CSRF tokens must
  never reach a log line or an error message.
- **Long videos are the hard case.** Chunking, checkpointing and progress
  reporting all matter more than they look. Test with something over an hour if
  you touch transcription.

## Reporting bugs

Open an issue with the template. The app version, your OS, and the console
output (View → Toggle Developer Tools) are what make a report actionable.

If you think you have found a security issue, please read
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Style

- TypeScript throughout, no `any` without a comment explaining why.
- Comments explain **why**, not what. Match the density of the file you are in.
- British English in prose and comments.
