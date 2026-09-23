# Silero VAD

`silero-vad.onnx` is Silero VAD v5 (`src/silero_vad/data/silero_vad.onnx` from snakers4/silero-vad), downloaded 22 September 2026.

- Source: https://github.com/snakers4/silero-vad
- SHA-256: `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`
- Size: 2327524 bytes
- Licence: MIT, reproduced in `silero-vad-LICENSE` alongside the model.

Inputs follow the reference wrapper at 16 kHz: 512-sample chunks with 64 samples of preceding context, a `[2, 1, 128]` recurrent state and an int64 sample rate. Speech regions use the reference `get_speech_timestamps` defaults (threshold 0.5, negative threshold 0.35, 250 ms minimum speech, 100 ms minimum silence, 30 ms padding).
