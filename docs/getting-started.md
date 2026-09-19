# Get started with Cutawan

Cutawan is a desktop app. Download an installer, choose how to handle speech and AI on first launch, then import a video. You do not need to clone the repository or install Node.js.

## Install the app

Download the current build from [GitHub Releases](https://github.com/JeremySNR/cutawan/releases/latest). Expand **Assets** and choose the file for your computer:

| Platform | Choose | First launch |
| --- | --- | --- |
| Windows | `.exe` installer | Run the installer. The build is not code-signed yet, so Windows may show a SmartScreen warning; verify that you downloaded it from this repository before proceeding. |
| macOS | `.dmg` | Move Cutawan to Applications. The build is not signed or notarised yet. Right-click Cutawan and choose **Open** on first launch. |
| Linux | `.AppImage` | Make it executable, then run it. For example, in a terminal: `chmod +x Cutawan*.AppImage` and `./Cutawan*.AppImage`. |

Signing and notarisation are planned. Until then, only download installers from the [official release page](https://github.com/JeremySNR/cutawan/releases/latest), not a reposted copy. Builds before v0.10.0 do not have the first-run wizard; use **Settings → General → AI connection** for setup instead.

## Choose a connection

The first-run wizard offers three paths. You can switch later in **Settings → General → AI connection**. **Explore without setup** lets you look around, but processing a new video still needs one of the routes below.

| Route | What it does | What you need |
| --- | --- | --- |
| **ChatGPT sign-in** (beta) | Uses Codex for clip finding and local Whisper for transcription. No OpenAI API key or automatic paid-API fallback. | An installed Codex CLI signed in with ChatGPT, Python 3.10+, and a local Whisper model. Your plan's Codex limits apply. [Detailed setup](chatgpt-subscription.md). |
| **OpenAI-compatible API** | Uses your configured API endpoint for analysis. Speech can go to the transcription API or run locally with Whisper. | An API key and separately billed provider usage. A local-speech choice also needs Python 3.10+ and a model. |
| **Local captions only** | Transcribes and captions a whole video without sending it to an AI service. It does not find or score short clips. | Python 3.10+ and a local Whisper model. |

For either local-speech route, install Python separately first. The wizard can then create a private environment and download faster-whisper plus a **Small** or **Large v3** model into Cutawan's app-data folder after you request it. Small is the lighter download; Large v3 needs several gigabytes. The setup check does not make an AI model request. CPU transcription works but can be slow.

## Make your first video

1. Drag a local video onto the home screen, click **Drag a video here, or click to choose**, or paste a supported video URL and click **Import**.
2. Pick **Find viral clips** for AI-suggested short moments or **Caption whole video** for one continuous captioned edit. The local-only route supports the latter, not AI clip finding.
3. For clips, click **Get clips** and review the suggestions. For a whole video, click **Transcribe and caption**. Processing time depends on video length and your computer or provider.
4. Open the result, adjust the trim, framing and caption style, then export an MP4. Review the finished file before posting; automatic selections and captions can need correction.

The original video stays on your computer. Rendering, face tracking and export are local. On the API route, extracted audio may be sent for transcription, and transcript text and sampled frames are sent for analysis. With ChatGPT/Codex, speech stays local but transcript text and sampled frames are sent for analysis. The local-only route does not run AI clip analysis.

If you hit a problem, [open a bug report](https://github.com/JeremySNR/cutawan/issues/new/choose) with your Cutawan version, operating system and what happened. Please do not include API keys or private footage in an issue.
