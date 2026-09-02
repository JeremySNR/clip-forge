# Changelog

Notable changes per release. Full commit history and downloadable builds are on
the [releases page](https://github.com/JeremySNR/clip-forge/releases).

This project uses [semantic versioning](https://semver.org/), loosely: while
still pre-1.0, minor bumps carry new features and patch bumps carry fixes.

## [Unreleased]

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
