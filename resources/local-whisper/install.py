"""Download a known faster-whisper model into Cutawan's app-data directory.

With --mlx on Apple Silicon, also download the matching MLX model into
`<target>-mlx`; transcribe.py uses it on the GPU when mlx-whisper is installed.
"""
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

MODELS = {
    "small": "Systran/faster-whisper-small",
    "large-v3": "Systran/faster-whisper-large-v3",
}
MLX_MODELS = {
    "small": "mlx-community/whisper-small-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
}

mlx = "--mlx" in sys.argv
sys.argv = [a for a in sys.argv if a != "--mlx"]
if len(sys.argv) != 3 or sys.argv[1] not in MODELS:
    raise SystemExit("Choose a supported Whisper model: small or large-v3.")

target = Path(sys.argv[2])
target.mkdir(parents=True, exist_ok=True)
print(f"Downloading {sys.argv[1]} from Hugging Face…", flush=True)
snapshot_download(repo_id=MODELS[sys.argv[1]], local_dir=str(target))
if not (target / "model.bin").is_file():
    raise RuntimeError("The model download did not include model.bin. Retry setup.")
if mlx:
    # Optional: the faster-whisper CPU model above is enough on its own.
    try:
        gpu_target = Path(str(target) + "-mlx")
        gpu_target.mkdir(parents=True, exist_ok=True)
        print(f"Downloading the Apple Silicon {sys.argv[1]} model…", flush=True)
        snapshot_download(repo_id=MLX_MODELS[sys.argv[1]], local_dir=str(gpu_target))
        if not (gpu_target / "config.json").is_file() or not any(gpu_target.glob("weights.*")):
            print("Apple Silicon model download incomplete; using the CPU model.", flush=True)
    except Exception as error:
        print(f"Apple Silicon model unavailable; using the CPU model. ({error})", flush=True)
print("Model download complete.", flush=True)
