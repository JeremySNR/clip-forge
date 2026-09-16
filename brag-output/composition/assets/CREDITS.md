# Third-party assets in this composition

| Asset | Source | Licence |
|---|---|---|
| `music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` | "Happy Beats / Business Moves" by [ende.app](https://ende.app/en), bundled with the [`/brag`](https://github.com/latent-spaces/brag) skill | as distributed with `/brag` |
| `sfx/**` | [Kenney](https://kenney.nl/) | CC0 |
| `fonts/BricolageGrotesque.woff2`, `fonts/InstrumentSans.woff2`, `fonts/JetBrainsMono.woff2` | Google Fonts (latin subset) | SIL Open Font Licence 1.1 |
| `fonts/Poppins-Bold.ttf` | copied from this repo's `resources/fonts/` — the caption face ClipForge burns in | SIL Open Font Licence 1.1 (`resources/fonts/OFL-Poppins.txt`) |
| `gsap.min.js` | [GSAP](https://gsap.com/) 3.14.2 | GreenSock standard licence |
| `icon.png`, `icon-outro.png` | this repo's `build/icon.png`, resized | MIT (this project) |

`audio-data.js` is per-frame RMS/band data extracted from the music bed so the
composition can react to it without any runtime audio analysis.
