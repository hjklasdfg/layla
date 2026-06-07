"""Ultralytics YOLO worker — lazy-loaded object detection for road hazards."""
from __future__ import annotations

import os
from typing import Any

from PIL import Image

_WORKER: "YoloWorker | None" = None

# COCO classes that can block or endanger pedestrians when close in frame.
DEFAULT_HAZARD_CLASSES = {
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
    "dog",
    "cat",
    "horse",
    "suitcase",
    "backpack",
    "handbag",
    "bench",
    "fire hydrant",
    "potted plant",
    "stop sign",
}


class YoloWorker:
    def __init__(self, model_path: str, device: str = "cpu", conf: float = 0.35):
        from ultralytics import YOLO

        self.model_path = model_path
        self.conf = conf
        self.device = device
        self.model = YOLO(model_path)

        hazard_classes = os.getenv("YOLO_HAZARD_CLASSES", "")
        if hazard_classes.strip():
            self.hazard_classes = {
                c.strip().lower() for c in hazard_classes.split(",") if c.strip()
            }
        else:
            self.hazard_classes = DEFAULT_HAZARD_CLASSES

    def detect(self, image: Image.Image) -> list[dict[str, Any]]:
        import numpy as np

        results = self.model.predict(
            source=np.array(image),
            conf=self.conf,
            device=self.device,
            imgsz=int(os.getenv("YOLO_IMGSZ", "640")),
            verbose=False,
        )

        detections: list[dict[str, Any]] = []
        for result in results:
            if result.boxes is None:
                continue
            names = result.names or {}
            for box in result.boxes:
                cls_id = int(box.cls[0])
                label = names.get(cls_id, str(cls_id))
                if label.lower() not in self.hazard_classes:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                detections.append(
                    {
                        "label": label,
                        "confidence": round(float(box.conf[0]), 3),
                        "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    }
                )
        return detections


def _resolve_device(requested: str = "") -> str:
    """Pick YOLO device; fall back to CPU when CUDA is unavailable."""
    import torch

    req = requested.strip().lower()
    cuda_ok = torch.cuda.is_available()

    if not req or req == "auto":
        return "0" if cuda_ok else "cpu"

    if req in ("cpu", "mps"):
        return req

    # GPU indices: 0, cuda, cuda:0, device=0, etc.
    wants_gpu = req.startswith("cuda") or req.isdigit()
    if wants_gpu:
        if cuda_ok:
            if req.startswith("cuda:"):
                return req.split(":", 1)[1]
            if req.startswith("cuda"):
                return "0"
            return req
        print(
            f"  [yolo] YOLO_DEVICE={requested!r} but torch.cuda.is_available()=False — using cpu",
            flush=True,
        )
        return "cpu"

    return requested


def get_worker() -> YoloWorker:
    global _WORKER
    if _WORKER is not None:
        return _WORKER

    model_path = os.getenv("YOLO_MODEL", "yolo11n.pt")
    conf = float(os.getenv("YOLO_CONF", "0.35"))
    device = _resolve_device(os.getenv("YOLO_DEVICE", "auto"))

    print(f"  [yolo] loading {model_path} on device={device}", flush=True)
    _WORKER = YoloWorker(model_path, device=device, conf=conf)
    return _WORKER
