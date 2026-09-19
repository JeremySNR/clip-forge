# Use your ChatGPT subscription (beta)

ClipForge can use **Codex CLI signed in with ChatGPT** for clip selection, visual analysis and captions. It uses your account's Codex allowance. A ChatGPT subscription is not an API key, and access/model availability depend on your plan. This option never falls back to a paid API or another model.

Audio transcription runs locally with faster-whisper. Rendering and speaker tracking also run locally. Transcript text and selected frames go to Codex for analysis. ClipForge does not read, copy or store Codex authentication tokens.

## One-time setup

1. Install the current [Codex CLI](https://developers.openai.com/codex/cli), run `codex login`, and choose ChatGPT sign-in. `codex login status` should report ChatGPT, not API-key authentication.
2. Install Python 3.10+ and create a dedicated environment:

   ```sh
   python -m venv clipforge-whisper
   ```

   On Windows, install using `clipforge-whisper\Scripts\python.exe -m pip install faster-whisper huggingface-hub`. On macOS/Linux, use `clipforge-whisper/bin/python -m pip install faster-whisper huggingface-hub`.
3. Explicitly download a compatible model. For the large-v3 model used in our quality experiments, run this with that environment's Python (requires several GB of download and storage):

   ```sh
   python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-large-v3', local_dir='whisper-large-v3')"
   ```

   CPU transcription works but can be slow. A compatible NVIDIA CUDA installation enables faster GPU transcription; see [faster-whisper's installation requirements](https://github.com/SYSTRAN/faster-whisper#requirements). ClipForge does not automatically download Python, models or GPU libraries. A smaller compatible model is possible, with a transcription-quality tradeoff.
4. In **Settings → General → AI connection**, choose **ChatGPT subscription via Codex (beta)**. Set the Python executable to the environment's full executable path and the speech model folder to the downloaded folder containing `model.bin`. If Codex is not on PATH, set its executable path too.
5. Choose **Save and check setup**. This checks CLI authentication, Python dependencies and model files without making a model request. The first real transcription verifies runtime/GPU compatibility.

## Control usage

- The analysis default is **`gpt-5.6-luna`, low reasoning**. A model unavailable to your account produces an error. You can enter another supported model explicitly.
- The default limit is **10 new requests per UTC day**, shared across ClipForge projects on this profile. One video can require more than 10 requests. Set a higher cap deliberately if needed, or set **0** to use only cached analysis.
- Successful identical requests are cached locally, keyed by model, reasoning setting, messages and output schema. A model change does not reuse another model's cache.
- Failed inference attempts also count. ClipForge does not automatically retry subscription inference. The limit is a request count, **not a token or monetary budget**; long prompts and images can consume more allowance.
- Your account's own credits, subscription limits and spending settings still apply. ClipForge does not buy credits or redeem resets.
- Cached responses are stored in `subscription-cache` under the app's data folder and can contain derived information about your media. Temporary prompts/images are removed after each request.

The API connection remains available separately. Existing installations keep their current API settings until they explicitly switch providers. Existing project files need no conversion.

This is an optional CLI integration, not an OpenAI-sponsored product or unlimited ChatGPT API access. It uses the documented [non-interactive CLI](https://learn.chatgpt.com/docs/non-interactive-mode) and [ChatGPT authentication](https://learn.chatgpt.com/docs/auth) paths.
