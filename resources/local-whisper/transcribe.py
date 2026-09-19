"""Local word-timestamp transcription. Dependencies/models are installed explicitly."""
import json
import os
from pathlib import Path
import sys

job = json.load(sys.stdin)
model_path = Path(job.get("modelPath") or "")
if not (model_path / "model.bin").is_file():
    raise RuntimeError("Select a downloaded faster-whisper model folder containing model.bin.")

# Keep Windows CUDA libraries available for the lifetime of the process.
handles = []
if sys.platform == "win32":
    for entry in sys.path:
        for directory in (Path(entry) / "nvidia").glob("*/bin"):
            handles.append(os.add_dll_directory(str(directory)))
            os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")

import ctranslate2
from faster_whisper import WhisperModel

if "--check" in sys.argv:
    print(json.dumps({"ready": True}))
    sys.exit(0)

gpu = ctranslate2.get_cuda_device_count() > 0
model = WhisperModel(str(model_path), device="cuda" if gpu else "cpu",
                     compute_type="float16" if gpu else "int8", local_files_only=True)
segments, info = model.transcribe(
    job["path"], language=job.get("language") or None, beam_size=5,
    word_timestamps=True, vad_filter=True, condition_on_previous_text=False,
    initial_prompt=job.get("prompt") or None)
result = {"language": info.language, "duration": info.duration,
          "text": "", "words": [], "segments": []}
for segment in segments:
    result["text"] += segment.text
    result["segments"].append({key: getattr(segment, key) for key in
        ["id", "start", "end", "text", "avg_logprob", "no_speech_prob", "compression_ratio"]})
    result["words"].extend({"word": word.word, "start": word.start, "end": word.end}
                           for word in segment.words or [])
print(json.dumps(result))
