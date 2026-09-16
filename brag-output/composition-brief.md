# Hyperframes Composition Brief: ClipForge

## Objective
Create a short launch-style brag video for ClipForge — the free, open-source desktop app that turns long videos into captioned vertical clips.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21.5 seconds

## Source Material
- Project root: `/home/user/clip-forge`
- Primary files read: `README.md`, `docs/index.html` (landing page + `:root` tokens), `package.json`, `.github/assets/screenshot-clips.png`, `.github/assets/screenshot-editor.png`, `src/` architecture section
- Product name: ClipForge
- Tagline / strongest claim: "Wide video in. Vertical clips out." — and the argument underneath it, "$0.36 per hour of video. No subscription. No uploads."
- Key UI moments to recreate (both are real screens, matched from the app screenshots):
  1. **The clips grid** — header "4 clips found" + "Ranked by virality score.", dark cards with flame score badges and the app's real clip titles.
  2. **The editor** — 9:16 preview with a burned-in karaoke caption, `MY BRAND` watermark chip, the violet speaker focus box cutting between speakers, and the right rail with the `91 / EXCEPTIONAL` badge and the "Why this score:" panel.
- Copy that must appear verbatim:
  - "Wide video in." / "Vertical clips out."
  - "The open-source Opus Clip alternative that runs on your desktop."
  - "4 clips found" / "Ranked by virality score."
  - "One clip changes everything overnight" (91)
  - "The first 100 videos are practice" (84)
  - "The algorithm is not against you" (76)
  - "EXCEPTIONAL" / "Why this score: Strong curiosity hook, emotionally resonant payoff and a complete standalone arc."
  - "The crop follows the voice, not the movement"
  - "$0.36" / "PER HOUR OF VIDEO, PAID TO OPENAI DIRECTLY"
  - "No subscription." / "No uploads." / "No cap."
  - "MIT licensed. Your machine. Your footage."
  - "github.com/JeremySNR/clip-forge"

## Creative Direction
- Tone preset: `polished`
- Creative direction: quiet, confident open-source product film — dev-tool craft, dark and editorial, no SaaS gloss
- Interpretation: fewer scenes, longer holds, restraint over energy. Elements arrive fast (0.35–0.6s) and then sit still. Nothing bounces, spins or flashes. Copy is short and factual; the product does the arguing.
- Angle: the counter-punch. Hosted clippers charge monthly, cap your minutes and want your footage on their servers. ClipForge does the same job locally for cents, and it is built like an editor rather than a wrapper — the crop follows the voice, not the movement; the preview *is* the export. The video should feel like a product film that quietly out-specs the subscription.
- Hook: a 16:9 frame with a violet focus box snapping onto the speaker, then the frame crushing down to 9:16 as "Wide video in. / Vertical clips out." lands.
- Outro / punchline: "$0.36" stated flatly → "No subscription. No uploads. No cap." → wordmark + "MIT licensed. Your machine. Your footage." + the repo URL.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Gradient text, neon, full-screen linear gradients on dark (they band under H.264)

## Visual Identity
(Exact values from `docs/index.html` `:root`.)
- Background: `#0a0a0a`; surfaces `#101211` (raise), `#151817` (panel), `#1b1f1e` (panel-2)
- Text: `#f4f6f5` primary, `#a9b2ae` grey, `#737b78` dim
- Accent: `#8b5cf6` violet; lift `#a78bfa`; CTA `#7c3aed`
- Hairlines: `rgba(244,246,245,.08)` / `rgba(244,246,245,.16)`
- Display font: Bricolage Grotesque (600/800) — shipped locally at `assets/fonts/BricolageGrotesque.woff2`
- Body font: Instrument Sans — `assets/fonts/InstrumentSans.woff2`; mono eyebrow labels: JetBrains Mono — `assets/fonts/JetBrainsMono.woff2`
- Caption font inside the 9:16 preview: Poppins Bold — `assets/fonts/Poppins-Bold.ttf`, copied from the app's own `resources/fonts/`, so the recreated karaoke caption uses the typeface ClipForge actually burns in
- Visual references from the project: film-grain over off-black; flame score badges; 9:16 preview panel; hairline-bordered dark cards; mono uppercase eyebrow labels with wide tracking

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **Hook — wide in, vertical out** — 3.4s — 16:9 frame, violet focus box snaps to the speaker, frame crushes to 9:16; "Wide video in." then "Vertical clips out."
2. **Reveal** — 3.0s — ClipForge wordmark + "The open-source Opus Clip alternative that runs on your desktop."
3. **The app finds the clips** — 5.0s — "4 clips found / Ranked by virality score." Three real cards arrive one by one with scores 91 / 84 / 76, then the full set holds.
4. **The editor** — 5.2s — 9:16 preview, karaoke word highlight, focus box cuts speaker→speaker, `91 EXCEPTIONAL` badge + "Why this score:" panel, and the line "The crop follows the voice, not the movement".
5. **Price then wordmark** — 4.9s — "$0.36" lands, "No subscription. / No uploads. / No cap.", then wordmark + "MIT licensed. Your machine. Your footage." + repo URL.

## Audio
- Audio role: warm steady bed with sparse professional accents; the music supports, never performs.
- Audio arc: fade in under the hook → steady through the reveal → light rhythmic card arrivals → stays out of the way during the editor → lifts for the price payoff → fades under the final wordmark while one bell rings out.
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` at volume 0.30
- Music treatment: 0.6s fade-in from 0; hold ~0.30; fade to 0 from ~19.8s so the closing bell rings over silence. Never above 0.35.
- Music cue guidance: bundled preset at `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`, ~110 BPM. Target strong cues: **9.29s** (third clip card), **13.11s** (score badge), **17.47s** ($0.36 payoff). Beat grid for the sequential clip cards: **7.09 / 8.19 / 9.29** (every other beat, ~1.1s apart, so each card title can be read).
- Audio-reactive treatment: subtle — violet accent glow and product-panel presence breathe with RMS/bass. No waveform, no equalizer bars, no strobing, no text scaling.
- Audio-coupled moments:
  - Scene 1, the 16:9→9:16 crush — one dry reveal hit
  - Scene 3, each clip card arriving — soft card/drop accent, same timestamp as the visual, on the beat grid
  - Scene 4, the crop cutting between speakers — light UI click; score badge landing — soft accent
  - Scene 5, the wordmark landing — one bell that rings over the music fade
- SFX selection guidance: sparse and dry, 4–6 cues total. Card-family sounds for card-like arrivals, a soft impact for the crush, a click for the simulated crop switch, a bell for the final payoff. Nothing comedic, nothing aggressive. SFX volume 0.55–0.75 (polished restraint).
- SFX analysis guidance: `/home/user/latent-spaces/brag/skills/brag/assets/sfx/sfx-analysis.md` — prefer low/medium high-frequency-risk files for these repeated, polished moments.
- Exact SFX choice: Hyperframes chooses filenames, timestamps, density and volume based on the implemented animation. Staged locally already: `assets/sfx/impact/impactSoft_medium_000.ogg`, `assets/sfx/impact/impactBell_heavy_000.ogg`, `assets/sfx/interface/drop_001.ogg`, `assets/sfx/interface/click_001.ogg`, `assets/sfx/casino/card-place-{1,2,3}.ogg`.
- Audio files: already copied into `brag-output/composition/assets/`.

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract + `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats, audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli` (lint/check/render). /brag is its own workflow: do not enter the `hyperframes` entry-point intent interview and do not route into its generic promo / launch-video workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project (scenes 3 and 4 are recreations of the actual app screens).
- Keep all text readable in the final render: short labels ≥0.8s settled, sentences ≥0.3s per word.
- Keep the video within 15–25 seconds.
- Include the planned music/SFX layer.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints; ignore cues that hurt readability, pacing or product clarity. Use only the 3 strong-cue locks listed above.
- Use local assets only — no network at render time.
- Run `npx hyperframes check` before render — it is brag's single gate.
