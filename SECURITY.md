# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/JeremySNR/clip-forge/security/advisories/new),
which goes straight to the maintainers.

Please include what you were doing, what happened, and the app version. If you
have a proof of concept, a description of the mechanism is more useful than a
working exploit.

This is a small volunteer project, so expect an initial response within about a
week rather than within hours.

## What is in scope

ClipForge is a desktop app that handles credentials and personal video, so the
interesting areas are:

- **The OpenAI API key.** Stored encrypted with Electron `safeStorage`, in
  `userData/settings.json`. Anything that leaks it, logs it, or exposes it to
  the renderer beyond the typed IPC bridge is in scope.
- **Browser cookies.** To download private or SSO-protected videos, ClipForge
  can borrow cookies from your installed browser. Anything that sends those
  somewhere they should not go is in scope.
- **The `media://` protocol.** It serves local files to the renderer. Path
  traversal out of the allowed directories, or serving files it should not
  (settings, cookie stores), is in scope.
- **Renderer isolation.** Context isolation is on and node integration is off.
  A renderer escape, or IPC that executes arbitrary commands on main, is in
  scope.
- **Update integrity.** Anything letting an attacker serve a malicious update
  through `electron-updater`, or through the source-checkout self-update path,
  is in scope.

## What is not in scope

- **The macOS builds are not code-signed yet.** This is known and documented in
  the README. It is a signing gap, not a vulnerability report.
- Findings that require an attacker to already have local code execution or
  filesystem access as your user.
- The fact that audio, transcripts and sampled frames are sent to the OpenAI
  API. That is the documented design; only the full video staying local is
  promised.
- Vulnerabilities in OpenAI, yt-dlp or other third-party services.
  Please report those to them.

## Supported versions

Only the latest release gets fixes. The in-app updater keeps packaged installs
current automatically.
