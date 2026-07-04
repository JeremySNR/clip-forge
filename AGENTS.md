# AGENTS.md

## Cursor Cloud specific instructions

ClipForge is a single **Electron + Vite + React + TypeScript** desktop app (npm, Node 20+). There is no backend server, database, or container to start — the only external service is the OpenAI API. Standard commands live in `README.md` and `package.json` scripts; this section only captures non-obvious cloud caveats.

### Environment already provided
- `npm install` is handled by the startup update script — dependencies (including bundled `ffmpeg-static`, `ffprobe-static`, and the `onnxruntime-node` native binary) are already installed on session start.
- `OPENAI_API_KEY` is injected as a secret and is required for the AI stages (Whisper transcription + LLM highlight/scoring/B-roll). Optionally override the endpoint with `OPENAI_BASE_URL`.
- `xvfb` (`xvfb-run`) is available for running the GUI headlessly.

### Running the GUI headlessly (no physical display)
- This is a desktop Electron app; there is no web URL. To launch it in a headless VM, wrap it in Xvfb and disable the sandbox/GPU:
  `xvfb-run -a --server-args="-screen 0 1600x1000x24" npx electron . --no-sandbox --disable-gpu`
  (Requires a prior `npm run build` so `out/` exists.) `npm run dev` also works but expects a display.
- Harmless `Failed to connect to the bus` (DBus) and GPU warnings are expected under Xvfb and can be ignored.
- `scripts/smoke-test.sh [out-dir]` is the fastest end-to-end GUI check: it builds, seeds a demo project via `scripts/seed-demo.ts`, launches under Xvfb with `CLIPFORGE_SMOKE` set, and writes `home.png`, `clips.png`, `editor.png`, `settings.png` screenshots. Set `CLIPFORGE_SMOKE` to an output dir to trigger this auto-screenshot-and-exit mode.

### Tests / lint
- There is **no linter and no test framework**. `npm run typecheck` is the only static gate; the `scripts/test-*.ts` files are standalone `tsx` scripts (see `README.md` "Tests"). Run them via `npx tsx --tsconfig tsconfig.node.json scripts/<name>.ts`.
- Tests that hit OpenAI (`test-e2e.ts`, `test-broll.ts`) need `OPENAI_API_KEY`; `test-pipeline.ts`, `test-resilience.ts`, `test-encoders.ts`, `test-quality.ts` run fully offline.

### Persistence
- Projects and encrypted settings are stored in Electron `userData` (`~/.config/clipforge/` on Linux), not in the repo. Delete that dir to reset app state.
