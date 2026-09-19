# Face detection and mouth-detail study

The Gilly production-wide shot exposed two separate losses: faces were missed at the detector's 320 × 240 input, and the speaker model received mouth crops from a video downsampled to 640 pixels wide. Improving detection alone did not fix the selected speaker. Preserving mouth detail did.

## Detector comparison

Ten development frames were tested with UltraFace at 320 × 240 and OpenCV YuNet at source-aspect widths of 640 and 1280 pixels. These are development examples, not a labelled held-out benchmark.

| Frame | UltraFace 320 | YuNet 640 | YuNet 1280 | Inspection |
| --- | ---: | ---: | ---: | --- |
| Panel 1 | 3 | 5 | 5 | Higher-resolution alternatives found all five panelists. |
| Panel 2 | 3 | 5 | 5 | Same improvement on a second selected moment. |
| Gilly wide 1 | 2 | 1 | 3 | 1280 found both participants and a crew member. |
| Gilly wide 2 | 0 | 1 | 3 | 640 found the listener; 1280 also recovered the speaker. |
| Translation screen | 0 | 1 | 1 | Both YuNet runs produced a false face on the spice photograph. |

Counts above use a 0.65 threshold for all models; their scores are not calibrated on a common scale. The screen false positive scored about 0.67–0.69. The native candidate uses 0.75, which removed it on this frame while retaining both interview participants. It also removed a lower-confidence crew face in one frame. This threshold was chosen using the development sample and requires independent validation.

The other samples included close interviews, a Wozniak two-shot and a presenter inset. Per-frame inference took roughly 2–3 ms for UltraFace, 4 ms median for YuNet 640 and 14 ms median for YuNet 1280 in this short reference run. These are single-call local observations, not rigorous throughput benchmarks.

- [Raw detections and timings](../../.tmp/quality-corpus/face-study/results.json)
- [Panel comparison](../../.tmp/quality-corpus/face-study/panel-1-comparison.jpg)
- [Difficult interview comparison](../../.tmp/quality-corpus/face-study/gilly-wide-2-comparison.jpg)
- [Observed false positive](../../.tmp/quality-corpus/face-study/screen-comparison.jpg)

## Controlled speaker comparison

The same 38.04-second Gilly clip, same LR-ASD weights, same MFCC pipeline and same selection policy were run three ways. The inspected wide interval begins at source 224.1 seconds and contains 182 sampled frames. The orange-shirt participant's source horizontal position is used as a regression target; this is not an independently annotated audiovisual benchmark.

| Detector / mouth-crop decode width | Frames targeting Gilly | Frames targeting listener | Unassigned | Whole analysis time |
| --- | ---: | ---: | ---: | ---: |
| UltraFace / 640 | 0 | 130 | 52 | 2.8 s |
| YuNet / 640 | 21 | 160 | 1 | 7.6 s |
| YuNet / 1920 | 181 | 0 | 1 | 8.3 s |

With the same YuNet face tracks, retaining more source mouth detail changed the wide-shot mean speaking logit for Gilly from about 0.17 to 2.83 and the listener from 0.33 to −1.04. This supports fixing preprocessing rather than attributing the failure entirely to the active-speaker architecture. It does not establish general 99.5% speaker accuracy.

- [Detailed comparison and track summaries](../../.tmp/quality-corpus/face-study/speaker-comparison.json)
- [Native/OpenCV inference comparison](../../.tmp/quality-corpus/face-study/native-parity.json)

The TypeScript ONNX path matched OpenCV's face counts at threshold 0.75 on all ten identical RGB inputs; matched box IoU exceeded 0.99999. That checks implementation equivalence on these inputs, not detector correctness against human labels.

## Production changes

YuNet now provides face detections at a maximum long edge of 1280, preserving aspect ratio. Mouth crops retain the source up to a 1920-pixel long edge, without upscaling. The original detector remains available when the new model is missing or fails. Python/OpenCV was used for comparison only; the app uses its existing native ONNX Runtime dependency.

The composition guard still retains uncertain wide shots. A small face can now qualify when its equivalent size in the actual decoded frame is at least 32 pixels, its speaking logit exceeds 1, and its margin over rival tracks exceeds 1. At least 30% of a shot needs usable detail/evidence. These are conservative, provisional policy thresholds, not probabilities. They do not solve overlap, off-screen speech or identity association in general.

## Sources and provenance

Model: OpenCV Zoo `face_detection_yunet_2026may.onnx`, the dynamic-input re-export of its 2023 model. The [official model description](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) documents input handling and its MIT licence. The downloaded model's SHA-256 matches its [Git LFS pointer](https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2026may.onnx): `ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0`.

The [official OpenCV decoder](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/src/face_detect.cpp) defines the preprocessing and output conventions checked by the native implementation. The [LR-ASD paper](https://junhua-liao.github.io/Junhua-Liao/publications/papers/IJCV_2025.pdf) discusses degraded performance on smaller faces; its published benchmark results are not results for this pipeline.

Reference environment: Python 3.13.1, OpenCV headless 5.0.0.93, local ONNX Runtime. Helpers and raw RGB fixtures are local ignored artifacts in `.tmp`; source footage and licences are recorded in the corpus catalog. No independent speaker labels, subjective listening or audience evaluation were collected here.
