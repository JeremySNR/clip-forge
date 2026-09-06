# Publishing ClipForge to winget

Windows is where most ClipForge installs happen. A
[winget](https://learn.microsoft.com/en-us/windows/package-manager/) package
lets people run:

```
winget install JeremySNR.ClipForge
```

The app is **not code-signed yet**, which winget allows. Users will still see a
SmartScreen prompt on first launch.

## First publish (one-off)

The first listing is a pull request to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). Generate the
three YAML files from the latest GitHub release:

```bash
node scripts/print-winget-manifest.mjs --out .tmp/winget
```

Then either:

- install [wingetcreate](https://github.com/microsoft/winget-create) and submit
  (`wingetcreate submit .tmp/winget`), or
- open a PR against `microsoft/winget-pkgs` under
  `manifests/j/JeremySNR/ClipForge/<version>/` with those three files.

Package identifier: **JeremySNR.ClipForge**.

## Later releases (automatic)

Once the package exists, set two repository secrets/variables:

| Name | Where | Value |
| --- | --- | --- |
| `WINGET_TOKEN` | Actions secret | A PAT with `public_repo` that can open PRs on a fork of `winget-pkgs` |
| `WINGET_PACKAGE_ID` | Actions variable | `JeremySNR.ClipForge` |

The [Release workflow](../.github/workflows/release.yml) then runs
`winget-releaser` after each GitHub Release so the manifest stays current.
Leave `WINGET_PACKAGE_ID` empty until the first package is accepted, otherwise
the job would try to update a package that does not exist yet.
