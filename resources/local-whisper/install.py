"""Download a known faster-whisper model into Cutawan's app-data directory."""
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

MODELS = {
    "small": "Systran/faster-whisper-small",
    "large-v3": "Systran/faster-whisper-large-v3",
}

if len(sys.argv) != 3 or sys.argv[1] not in MODELS:
    raise SystemExit("Choose a supported Whisper model: small or large-v3.")

target = Path(sys.argv[2])
target.mkdir(parents=True, exist_ok=True)
print(f"Downloading {sys.argv[1]} from Hugging Face…", flush=True)
snapshot_download(repo_id=MODELS[sys.argv[1]], local_dir=str(target))
if not (target / "model.bin").is_file():
    raise RuntimeError("The model download did not include model.bin. Retry setup.")
print("Model download complete.", flush=True)
