# Brag Plan: ClipForge

## What is this app?
A free, open-source Electron desktop app that turns long videos — podcasts, webinars, streams, interviews — into ready-to-post captioned vertical clips: the AI reads the transcript, cuts self-contained moments, scores them 0–99 for virality, crops to whoever is actually speaking, and burns in karaoke captions. It does Opus Clip's job for about $0.36 an hour of video, on your own machine.

## The angle
Not "AI tool launches." The angle is **the counter-punch**: the hosted clippers charge monthly, cap your minutes and want your footage on their servers. ClipForge does the same work locally for cents, and it is built like an editor rather than a wrapper — the crop follows the *voice*, not the movement; the preview *is* the export. The video should feel like a confident open-source product film that quietly out-specs the subscription, not like a SaaS ad.

## Hook (first 2-3 seconds)
A wide 16:9 frame sits on off-black. A violet focus box snaps onto the speaker, the frame crushes down to a 9:16 clip, and the line lands: **"Wide video in. Vertical clips out."** The product's whole mechanic, demonstrated before a single word of marketing.

## Key moments (the middle)
- The clips grid: **"4 clips found · Ranked by virality score"** — real cards arriving one by one with real flame-badge scores (91, 84, 76) and the real titles from the app.
- The editor: the 9:16 preview with a karaoke caption highlighting a word live, the **91 / EXCEPTIONAL** badge and the app's own **"Why this score: Strong curiosity hook…"** reasoning panel.
- The crop cutting between speakers like a camera switch — the focus box moving because the *voice* moved, labelled with the site's own line: **"The crop follows the voice, not the movement."**

## Outro / punchline
The price, stated flatly, because it is the whole argument: **$0.36** per hour of video — then **"No subscription. No uploads. No cap."** and the wordmark over `github.com/JeremySNR/clip-forge`. The joke, such as it is, is that there is no joke: it just costs cents.

## User flow worth showing
Entry → key action → result:
1. A long 16:9 recording goes in (local file or a pasted URL).
2. Whisper transcribes it and the AI finds + scores the moments — the clips grid fills with ranked cards.
3. You open one in the editor: speaker-aware 9:16 crop, karaoke captions, then Export.

The centrepiece scenes (3 and 4) are this flow. The landing-page material is used only as the frame around it.

## Tone
- Preset: `polished`
- Creative direction: quiet, confident open-source product film — dev-tool craft, dark and editorial, no SaaS gloss
- Interpretation: fewer scenes, longer holds, restraint over energy. Motion is fast to arrive and then still. Nothing bounces. The copy is short and factual, and the product does the arguing. Transitions are soft crossfades and clean cuts, never flashes or spins.

## Format: landscape — 1920x1080
## Duration: 23.4 seconds (6 clips; the closing beat is split so the price and the wordmark each get a real hold)

## Visual identity (from the project)
- Background: `#0a0a0a` (with `--panel #151817`, `--panel-2 #1b1f1e`, `--raise #101211` for surfaces)
- Accent: `#8b5cf6` (violet, sampled from the logo mark), lift `#a78bfa`, CTA `#7c3aed`
- Text: `#f4f6f5` primary, `#a9b2ae` grey, `#737b78` dim
- Hairlines: `rgba(244,246,245,.08)` / `.16`
- Display font: Bricolage Grotesque (600/800)
- Body font: Instrument Sans (400/500/600); mono: JetBrains Mono (uppercase 11px, .14em tracking, for eyebrow labels)
- Strongest visual element: the app's own dark UI — score badges, the 9:16 preview with burned-in karaoke captions, the violet focus box. Also the site's film-grain-over-off-black treatment.

## Share copy (draft)
Wide video in, vertical clips out. ClipForge is a free, open-source Opus Clip alternative that runs on your desktop — AI-picked moments, virality scores, karaoke captions and a crop that follows the voice, not the movement. ~$0.36 an hour of video, no subscription, footage never leaves your machine.

## Audio direction
- Role: warm, steady bed with sparse professional accents — the music supports, it never performs.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean; the polished pick)
- Music treatment: start at 0, volume ~0.30, quick fade-in over the first 0.6s, and a fade under the final wordmark so the last SFX rings out. Never above 0.35.
- Music cue guidance: bundled preset read — `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`, tempo ~110 BPM. Strong cues to target: **9.29s** (third clip card lands), **13.11s** (the 91/EXCEPTIONAL score badge), **17.47s** (the $0.36 payoff). Beat-grid window for the sequential clip cards: 7.09 / 8.19 / 9.29 (every other beat, ~1.1s apart, so each card title can actually be read).
- Audio-reactive treatment: subtle — use music RMS/bass to let the violet accent glow and the product panel presence breathe. No waveform, no equalizer bars, no strobing.
- SFX posture: sparse. 3–4 cues total, motion-matched, nothing comedic.
- Audio-coupled moments: the 16:9→9:16 crush (one dry reveal hit), each clip card arriving (soft card/drop accents on the beat grid), the score badge landing, the final wordmark.
- Restraint rule: no sound on every element, no risers, no whooshes on text. If a moment already reads without sound, leave it silent.

## Storyboard

### Scene 1 — Hook: wide in, vertical out — 0.0–3.4s
Off-black frame, faint film grain. A 16:9 rectangle holds a simple abstract "recording" (two seated figures / speaker blocks, in the app's dark palette — not photographic). A violet focus box snaps onto the left speaker, then the frame crushes inward to a 9:16 clip that keeps the speaker centred. Text lands under it: **"Wide video in."** then **"Vertical clips out."** (display font, large, the second line arriving as the crush completes).
Sequential/interaction: yes — focus box snaps on (0.6s), then the 16:9 → 9:16 crush resolves as one move; the two copy lines arrive in sequence, each holding ≥0.9s settled.
Audio intent: a single dry weight on the crush; otherwise let the bed carry it.
Audio-coupled idea: one `impactSoft_medium` at the start of the crush.
Music: steady bed, faded in.
Transition mood: clean cut → Scene 2

### Scene 2 — The reveal — 3.4–6.8s
The ClipForge wordmark with the violet mark, and under it the project's own line: **"The open-source Opus Clip alternative that runs on your desktop."** Mono eyebrow above: `OPEN SOURCE VIDEO CLIPPER`. Wide letter-spacing, lots of empty off-black, nothing moving except a slow accent glow.
Sequential/interaction: none — one settled hold. The sentence holds ≥1.8s.
Audio intent: calm, confident. No new SFX; the bed alone.
Audio-coupled idea: none — the silence here is the restraint.
Music: bed continues, subtle audio-reactive glow on the mark.
Transition mood: soft crossfade → Scene 3

### Scene 3 — The app finds the clips — 6.8–11.4s
Recreation of the real clips screen. Header: the sparkle glyph + **"4 clips found"**, subhead **"Ranked by virality score."** Three cards arrive one by one, each with a flame score badge and the app's real titles:
- **91** — "One clip changes everything overnight"
- **84** — "The first 100 videos are practice"
- **76** — "The algorithm is not against you"
Each card is a dark panel with a hairline border, a 9:16 thumbnail block and the score badge top-left. The full set holds on screen together for ~1.4s after the last one lands.
Sequential/interaction: yes — three cards arrive one by one on the beat grid at 7.09 / 8.19 / 9.29, each with a soft card accent; the third lands on a strong cue.
Audio intent: light rhythmic arrival — the product working, not a fanfare.
Audio-coupled idea: card-by-card sequence (`casino/card-place` or `interface/drop`), one per card, same timestamp as the visual.
Music: bed steady; card arrivals snapped to the beat grid.
Transition mood: clean cut → Scene 4

### Scene 4 — The editor does the hard part — 11.4–16.6s
The editor recreation: a 9:16 preview panel on the left with a burned-in karaoke caption where one word flips to the highlight colour mid-line ("This is how creators **actually** blow up…"), a small `MY BRAND` watermark chip in the corner, and the violet focus box visibly cutting from one speaker to the other. On the right, the app's own rail: the **91 / EXCEPTIONAL** badge and the **"Why this score: Strong curiosity hook, emotionally resonant payoff and a complete standalone arc."** panel. A small mono label states the claim: **"The crop follows the voice, not the movement."**
Sequential/interaction: yes — the caption word highlight flips live, then the crop cuts speaker→speaker (one hard, camera-switch move, not a slide), then the score badge lands (beat-locked to 13.11s).
Audio intent: precise and dry. The crop cut is the moment that earns a sound.
Audio-coupled idea: a light UI click on the crop switch; one soft bell/announcement on the score badge landing.
Music: bed steady; panel presence breathing subtly with bass.
Transition mood: soft crossfade → Scene 5

### Scene 5 — The price — 16.6–20.75s
Big display type: **$0.36** with a small mono line under it — **PER HOUR OF VIDEO, PAID TO OPENAI DIRECTLY**. It lands on the 17.47s strong cue. Then three short lines clear in on the beat grid — **"No subscription."** / **"No uploads."** / **"No cap."** — and the full set holds for over a second.
Sequential/interaction: yes — the number lands first, then the three lines arrive at 18.02 / 18.56 / 19.10 (~0.54s apart, each staying on screen once it arrives, with the whole set held to 20.75).
Audio intent: the payoff. One clean landing on the number; the bed lifts rather than stops.
Audio-coupled idea: the number landing on the strong cue.
Music: bed steady.
Transition mood: clean cut → Scene 6

### Scene 6 — The wordmark — 20.75–23.4s
The app's own icon beside the ClipForge wordmark, the line **"MIT licensed. Your machine. Your footage."**, and `github.com/JeremySNR/clip-forge` in mono. Music fades under the hold.
Sequential/interaction: yes — lockup, then line, then URL, each with room to be read; the frame holds still for the last 1.3s.
Audio intent: one quiet bell that rings over the music fade.
Audio-coupled idea: `impactBell_heavy_000` on the wordmark landing at 20.75s.
Music: fades from 20.9s to silence under the final hold.
Transition mood: final hold — no transition out.

**Music mood for this video:** upbeat-but-restrained corporate bed (vol-12, steady and clean)
**Audio summary:** A quiet steady bed fades in under the crush, carries the clip cards on the beat grid, stays out of the way while the editor does the talking, then lifts for the price payoff and fades under a single ringing hit on the wordmark.
