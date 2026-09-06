# Changelog

Notable changes per release. Full commit history and downloadable builds are on
the [releases page](https://github.com/JeremySNR/clip-forge/releases).

This project uses [semantic versioning](https://semver.org/), loosely: while
still pre-1.0, minor bumps carry new features and patch bumps carry fixes.

## [Unreleased]

### Changed

- **Clip boundaries are chosen on sentences.** The model now reads the
  transcript as one sentence per line (derived from word punctuation, with
  unpunctuated rambles split at their longest pauses) instead of Whisper's
  segments, which break mid-sentence, and is told to start and end every clip
  on a line. The ending and opening reviews work on the same sentences. When
  a start still lands inside a sentence, the clip opens that sentence rather
  than skipping to the next; an end inside a sentence completes it.
- **Tightened clips keep their tails.** Removing pauses used to trim the room
  after the last word down to 0.3 s, so the export's 0.4 s fade ducked the
  final syllable. Tightening now keeps 0.7 s after the last word and 0.3 s
  before the first.
- **Long videos come back in minutes, not an hour.** Speaker-framing analysis
  (face tracking plus active speaker detection at 25 fps) is the slowest
  per-clip stage by a wide margin. The pipeline now runs it only for the top
  tier of clips (the eight highest-scoring, extended to twelve for scores of
  80 or more) and leaves the rest pending. A pending clip is analysed the
  moment it is opened in the editor, or before it is exported, and the
  editor says so while it waits. The analysis uses the clip's current trim,
  so a clip extended before opening is tracked end to end.
- **Captions lay out by width, not word count.** Groups are broken into lines
  from a per-style character budget derived from the font's measured glyph
  widths and the output aspect ratio, capped at two lines. The same layout
  feeds the preview and the ASS export (which now carries explicit line
  breaks with libass wrapping off), so a caption can no longer wrap
  differently in the file than it did in the editor.
- **Captions hold briefly after a sentence.** A finished group stays up for
  up to 1.5 s, cut short by the next group, instead of leaving an empty frame
  on every pause.
- **Loudness normalisation is two-pass.** Exports measure the clip first and
  normalise with a single linear gain (true-peak limited only where needed)
  instead of the single-pass gain rider, which pumped audibly on speech.
  Falls back to single-pass when the source cannot be measured.

### Fixed

- **Exported captions sat higher than the preview.** The ASS style was
  bottom-aligned on the anchor line while the preview centred its block
  there, so two-line captions rendered about half a block too high. Events
  are now positioned middle-centre on the anchor.
- **Whisper hallucinations reached captions and the clip picker.** Segments
  Whisper itself flags as silence (high no-speech probability with
  low-confidence text) or as looped output (high compression ratio) are now
  dropped at stitch time, along with their words, and never primed into the
  next chunk.
- **Words with zero or negative duration never lit up in karaoke captions.**
  Word timings are now made monotonic and given a minimum on-screen duration
  when the transcript is stitched.

### Added

- **`scripts/eval-clips.ts`.** Measures clip boundaries on saved projects
  (mid-sentence opens and closes, clipped or dead-air tails, length spread),
  and with `--rerun` compares them against fresh detection on the same
  transcript, so prompt changes can be checked instead of guessed.

- **"Fit under N MB" export.** A size cap in Settings and the editor export
  panel, so clips land under Discord, email or WhatsApp limits. The encoder
  already knew how; this is the missing control, plus the achieved file size
  (and a note when the planner had to downscale) after export.
- **OpenAI-compatible API endpoints.** Settings now takes a chat base URL
  (Azure, OpenRouter, Groq, LM Studio, Ollama) and an optional separate
  transcription URL, so a local Whisper server can sit next to a hosted LLM.
  Structured-output calls fall back from `json_schema` to `json_object` (and
  then a plain JSON completion) when the provider does not support OpenAI's
  strict schema mode. `OPENAI_BASE_URL` still overrides Settings when set.
- **winget publishing path.** A manifest generator (`scripts/print-winget-manifest.mjs`)
  and a Release workflow job that updates
  [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) once the
  first listing exists. See [docs/winget.md](docs/winget.md).

### Removed

- **The WorkVivo posting integration.** It was specific to one organisation's
  internal comms platform and depended on an undocumented endpoint set, which
  made it an odd fit for a general-purpose tool. Everything it did that was not
  WorkVivo-specific stayed: the size-targeted two-pass encode
  (`src/shared/uploadBudget.ts`) is still here and still tested, and brand voice
  now steers the TikTok/Reels/Shorts post captions rather than only the internal
  ones.

### Changed

- Brand voice settings (name, tone, style, things to avoid) now feed the AI post
  caption writer. Previously they only affected the internal posting captions,
  so the setting appeared to do nothing for most users.

## [0.7.0] - 2026-09-02

### Added

- **"Caption the whole video" mode.** A second way to work alongside AI clip
  finding: give it a 16:9 video and it comes back as one vertical, captioned
  edit you can trim, restyle and export, with optional speaker tracking and
  auto zoom. Both modes work on the same project and share the transcript, so
  switching between them never pays for transcription twice.
- **Full-quality WorkVivo uploads.** Clips now upload through the presigned
  flow rather than inline through the Customer API, which rejected anything
  beyond a few megabytes. Needs a one-off browser sign-in in Settings; the API
  remains the fallback.
- **Custom caption fonts.** Upload any TTF or OTF. Families are matched on the
  name embedded in the file rather than the filename, so previews and exports
  agree.
- **Size-targeted rendering.** When an upload has a hard byte cap, the bitrate
  is planned up front and the clip is encoded once to hit it, instead of
  rendering at a quality target and re-compressing afterwards.

### Fixed

- **Burned-in captions rendered at roughly 58% of their intended size.** CSS
  `font-size` sets the em square, but libass sizes text against the font's OS/2
  window ascent plus descent. Em sizes were being passed straight through as
  ASS `Fontsize`. This was the gap between the live preview and the exported
  file.
- Very long edits could build zoom filter graphs large enough to choke ffmpeg.
  Zoom events are now capped per clip.

## [0.6.18] - 2026-08-03

### Fixed

- Black screen after updating from a source checkout, and the app now reports a
  failed relaunch instead of disappearing silently.
- Source updates no longer rebuild when the pull brought nothing.
- `media://` no longer serves `settings.json` or session cookies to the
  renderer.
- Concurrent project saves could lose edits. Writes are now serialised.
- Every OpenAI request has a per-attempt timeout, so a hung connection no
  longer stalls the pipeline indefinitely.

## [0.6.17] - 2026-07-23

### Fixed

- B-roll image search froze the app on restricted networks (#44).

## [0.6.16] - 2026-07-07

### Added

- **Video type selector.** Tell ClipForge what kind of footage it is and it
  steers 9:16 layout and face tracking accordingly.
- Screencasts are detected and letterboxed for 9:16 rather than cropped into
  unreadable text.

### Fixed

- Face tracking now bails out early when it finds no usable faces, instead of
  producing a bad crop.
- Several active-speaker content classification fixes.

## [0.6.15] - 2026-07-07

### Added

- WorkVivo posting, with brand-voiced AI captions and a settings page.

### Fixed

- WorkVivo caption posting and space pagination.
- Empty captions are now respected rather than replaced.

## Earlier releases

0.6.14 and earlier predate this changelog. See the
[releases page](https://github.com/JeremySNR/clip-forge/releases) for the
history.
