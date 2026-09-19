# YuNet face detector

`face-detection-yunet.onnx` is OpenCV Zoo's `face_detection_yunet_2026may.onnx`, downloaded 12 September 2026. It is the dynamic-input re-export of the 2023 model, not a newly trained model.

- Source: https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- Download: https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2026may.onnx
- SHA-256: `ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0`
- Size: 229738 bytes
- Licence: MIT, reproduced in `yunet-LICENSE` alongside the model.

Preprocessing uses unnormalized BGR with zero padding to multiples of 32. The stride heads combine classification/objectness scores and decode grid offsets and exponential box sizes. These conventions were checked against OpenCV's official `modules/objdetect/src/face_detect.cpp` implementation. Cutawan's TypeScript inference path uses its existing ONNX Runtime dependency, not Python/OpenCV.
