"""Road hazard detection + proximity scoring from YOLO bounding boxes."""
from __future__ import annotations

import os
import time
from typing import Any

from PIL import Image

from surroundings import bbox_position, describe_surroundings, distance_band

STOP_PROXIMITY_THRESHOLD = float(os.getenv("HAZARD_STOP_PROXIMITY_THRESHOLD", "0.9"))
CROWDED_FRONT_THRESHOLD = int(os.getenv("HAZARD_CROWDED_FRONT_COUNT", "5"))
FRONT_POSITIONS = frozenset({"ahead", "far ahead"})


def is_demo_mode() -> bool:
    return os.getenv("CAMERA_HAZARD_DEMO", "").lower() in ("1", "true", "yes")


def get_detector_mode() -> str:
    return "demo" if is_demo_mode() else "yolo"


def _normalize_box(box: dict[str, float], width: int, height: int) -> dict[str, float]:
    return {
        "x1": max(0.0, min(1.0, box["x1"] / width)),
        "y1": max(0.0, min(1.0, box["y1"] / height)),
        "x2": max(0.0, min(1.0, box["x2"] / width)),
        "y2": max(0.0, min(1.0, box["y2"] / height)),
    }


def proximity_score(box: dict[str, float], width: int, height: int) -> float:
    """Lower in frame + larger area => closer (forward-facing phone camera)."""
    bottom = box["y2"] / height
    area = max(0.0, (box["x2"] - box["x1"]) * (box["y2"] - box["y1"]) / (width * height))
    center_x = (box["x1"] + box["x2"]) / 2 / width
    horizontal_center = 1.0 - min(1.0, abs(center_x - 0.5) * 2.0)
    size_factor = min(1.0, area * 10.0)
    return bottom * 0.55 + size_factor * 0.30 + horizontal_center * 0.15


def _build_result(
    width: int,
    height: int,
    hazards: list[dict[str, Any]],
    *,
    model: str,
    inference_ms: int,
) -> dict[str, Any]:
    hazards.sort(key=lambda h: h["proximity"], reverse=True)
    closest = hazards[0] if hazards else None
    should_stop = closest is not None and closest["proximity"] >= STOP_PROXIMITY_THRESHOLD
    action = "stop" if should_stop else "continue"

    surroundings = describe_surroundings(
        hazards,
        stop_threshold=STOP_PROXIMITY_THRESHOLD,
        crowded_front_threshold=CROWDED_FRONT_THRESHOLD,
    )
    voice_text = surroundings.get("voiceText")
    front_count = sum(1 for h in hazards if h.get("position") in FRONT_POSITIONS)
    crowded = front_count > CROWDED_FRONT_THRESHOLD

    return {
        "frameWidth": width,
        "frameHeight": height,
        "hazards": hazards,
        "action": action,
        "voiceText": voice_text,
        "closestHazard": closest,
        "surroundings": surroundings,
        "crowded": crowded,
        "crowdedFrontCount": front_count,
        "meta": {
            "model": model,
            "inferenceMs": inference_ms,
            "hazardCount": len(hazards),
            "stopThreshold": STOP_PROXIMITY_THRESHOLD,
            "crowdedFrontThreshold": CROWDED_FRONT_THRESHOLD,
            "demo": is_demo_mode(),
        },
    }


def _demo_analyze_frame(image: Image.Image, frame_index: int = 0) -> dict[str, Any]:
    """Synthetic bboxes for backend smoke tests — no GPU/torch."""
    started = time.perf_counter()
    width, height = image.size

    scenario = os.getenv("CAMERA_HAZARD_DEMO_SCENARIO", "alternate")
    if scenario == "alternate":
        show_close = frame_index % 2 == 0
    elif scenario == "close":
        show_close = True
    elif scenario in ("far", "none"):
        show_close = False
    else:
        show_close = True

    hazards: list[dict[str, Any]] = []
    if show_close:
        box = {
            "x1": 0.32 * width,
            "y1": 0.52 * height,
            "x2": 0.68 * width,
            "y2": 0.88 * height,
        }
        hazards.append(
            {
                "label": "demo pothole (close)",
                "bbox": _normalize_box(box, width, height),
                "proximity": round(proximity_score(box, width, height), 3),
                "position": bbox_position(_normalize_box(box, width, height)),
                "distanceBand": "very close",
            }
        )
    else:
        box = {
            "x1": 0.12 * width,
            "y1": 0.08 * height,
            "x2": 0.28 * width,
            "y2": 0.22 * height,
        }
        hazards.append(
            {
                "label": "demo cone (far)",
                "bbox": _normalize_box(box, width, height),
                "proximity": round(proximity_score(box, width, height), 3),
                "position": bbox_position(_normalize_box(box, width, height)),
                "distanceBand": "distant",
            }
        )

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return _build_result(width, height, hazards, model="demo/local-stub", inference_ms=elapsed_ms)


def _yolo_analyze_frame(image: Image.Image) -> dict[str, Any]:
    from yolo_worker import get_worker

    started = time.perf_counter()
    width, height = image.size
    worker = get_worker()

    hazards: list[dict[str, Any]] = []
    for det in worker.detect(image):
        box = det["box"]
        bbox = _normalize_box(box, width, height)
        proximity = round(proximity_score(box, width, height), 3)
        hazards.append(
            {
                "label": det["label"],
                "confidence": det.get("confidence"),
                "bbox": bbox,
                "proximity": proximity,
                "position": bbox_position(bbox),
                "distanceBand": distance_band(proximity, stop_threshold=STOP_PROXIMITY_THRESHOLD),
            }
        )

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return _build_result(width, height, hazards, model=worker.model_path, inference_ms=elapsed_ms)


def analyze_frame(image: Image.Image, frame_index: int = 0) -> dict[str, Any]:
    if is_demo_mode():
        return _demo_analyze_frame(image, frame_index)
    return _yolo_analyze_frame(image)
