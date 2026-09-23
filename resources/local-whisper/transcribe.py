"""Local word-timestamp transcription. Dependencies/models are installed explicitly."""
import json
import os
from pathlib import Path
import platform
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
from faster_whisper import WhisperModel, decode_audio

if "--check" in sys.argv:
    print(json.dumps({"ready": True}))
    sys.exit(0)


def mlx_model():
    """The Apple Silicon GPU copy installed beside the CPU model, if usable."""
    if sys.platform != "darwin" or platform.machine() != "arm64":
        return None
    folder = Path(str(model_path) + "-mlx")
    if not (folder / "config.json").is_file() or not any(folder.glob("weights.*")):
        return None
    try:
        import mlx_whisper  # noqa: F401
    except ImportError:
        return None
    return folder


def transcribe_mlx(folder):
    """~3x faster than CPU int8 on an M1 with no loss against a large-v3-turbo reference.

    faster-whisper's Silero VAD picks the speech regions, as its vad_filter
    does on the CPU path, so silence cannot become hallucinated text.
    """
    import mlx_whisper
    from faster_whisper.vad import VadOptions, get_speech_timestamps
    audio = decode_audio(job["path"], sampling_rate=16000)
    speech = get_speech_timestamps(audio, VadOptions())
    duration = len(audio) / 16000
    result = {"language": job.get("language") or "", "duration": duration, "text": "", "words": [], "segments": []}
    if not speech:
        return result
    clips = [t for chunk in speech for t in (chunk["start"] / 16000, chunk["end"] / 16000)]
    output = mlx_whisper.transcribe(
        audio, path_or_hf_repo=str(folder), language=job.get("language") or None,
        word_timestamps=True, condition_on_previous_text=False, clip_timestamps=clips,
        hallucination_silence_threshold=2.0, initial_prompt=job.get("prompt") or None)
    result["language"] = output.get("language") or result["language"]
    for index, segment in enumerate(output["segments"]):
        result["text"] += segment["text"]
        result["segments"].append({"id": index, **{key: segment.get(key) for key in
            ["start", "end", "text", "avg_logprob", "no_speech_prob", "compression_ratio"]}})
        result["words"].extend({"word": word["word"], "start": word["start"], "end": word["end"]}
                               for word in segment.get("words") or [])
    return result


def transcribe_cpu():
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
    return result


folder = mlx_model()
print(json.dumps(transcribe_mlx(folder) if folder else transcribe_cpu()))
