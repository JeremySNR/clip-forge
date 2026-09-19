# Cutawan rename

Cutawan is the selected product name. The package/repository slug is `cutawan`,
the application ID is `org.cutawan.app`, and script overrides use `CUTAWAN_`.
The repository is https://github.com/JeremySNR/cutawan and the Pages destination
is https://jeremysnr.github.io/cutawan/.

## Existing installations

New installations store data in the platform application-data directory under
`cutawan`. Existing installations continue using their populated legacy data
directory, preserving absolute project/media paths, settings, fonts, cookies,
and downloaded tools. `src/main/userData.ts` and its tests intentionally retain
the former directory names solely to locate that data. If both profiles contain
data, the Cutawan profile takes precedence. `CUTAWAN_USER_DATA` overrides both.
No user directories are moved, deleted, or merged.

The renamed application has a new installer identity. An old installation may
remain listed separately by the OS. macOS/Linux keyring identity can depend on
the application name: users may need to re-enter an API key if the OS will not
unlock the existing encrypted value. Stored data is retained. Cross-platform
installer/keyring upgrade behavior requires testing on those operating systems.

Historical commits, tags, and already-published binaries retain their historical
contents. Renaming the repository does not rewrite a shipped executable. Publish
a new Cutawan release to distribute the renamed application and its new icon.
GitHub Pages must deploy the updated `docs/` tree to serve the new branding.

## Artwork and screenshots

New generated icon: `build/Cutawan.png`; derived sizes feed the app, installer,
website icons and favicon. New marketing hero: `.github/assets/hero.png`.
New social artwork: `docs/assets/social-preview.png` and `social-card.jpg`.
The website navigation and browser icons use the same generated app icon.

Screenshots in `.github/assets/` and `docs/assets/` are real captures from the
renamed Electron application, using synthetic test footage and an isolated demo
profile. Marketing illustrations are not screenshots.

Regenerate all eight app views offline on Windows or a desktop Linux/macOS host:

```sh
npm run screenshots
```

Outputs go to `.tmp/cutawan-screenshots/`; a different output directory can be
passed after `--`. Headless Linux still requires an Xvfb display, e.g.
`xvfb-run -a npm run screenshots`. The script builds, seeds demo content, captures
home, results, editor, both setup modes, whole-video editor and both settings
views, then exits. It does not use an OpenAI API key or query GitHub for updates.

## Verification

Run `npm test`, `npm run typecheck`, `npm run lint`, and the screenshot command.
Inspect the app captures and the website at desktop/mobile widths. Confirm that
preload API calls use `window.cutawan`, publishing/updater URLs target the new
repository, and the Windows installer filename matches the winget generator.
Old-name source matches are permitted only in the data-directory compatibility
resolver and its regression tests.
