"""Turn YOLO detections into a human-readable surroundings description."""
from __future__ import annotations

from typing import Any

NEARBY_THRESHOLD = 0.45


def distance_band(proximity: float, *, stop_threshold: float) -> str:
    if proximity >= stop_threshold:
        return "very close"
    if proximity >= NEARBY_THRESHOLD:
        return "nearby"
    return "distant"


def bbox_position(bbox: dict[str, float]) -> str:
    cx = (bbox["x1"] + bbox["x2"]) / 2
    cy = (bbox["y1"] + bbox["y2"]) / 2

    if cy < 0.22:
        return "far ahead"
    if cx < 0.36:
        return "on the left"
    if cx > 0.64:
        return "on the right"
    return "ahead"


def describe_surroundings(
    hazards: list[dict[str, Any]],
    *,
    stop_threshold: float,
    crowded_front_threshold: int = 5,
) -> dict[str, Any]:
    front_count = sum(
        1
        for h in hazards
        if (h.get("position") or bbox_position(h.get("bbox") or {})) in ("ahead", "far ahead")
    )
    crowded = front_count > crowded_front_threshold
    crowded_summary = (
        "Crowded environment — please be careful."
        if crowded
        else None
    )

    if not hazards:
        return {
            "summary": crowded_summary or "Path looks clear — nothing detected ahead.",
            "voiceText": None,
            "items": [],
            "crowded": crowded,
            "frontCount": front_count,
        }

    items: list[dict[str, Any]] = []
    grouped: dict[tuple[str, str, str], int] = {}

    for hazard in hazards:
        label = str(hazard.get("label", "object")).lower()
        proximity = float(hazard.get("proximity", 0))
        bbox = hazard.get("bbox") or {}
        band = distance_band(proximity, stop_threshold=stop_threshold)
        position = bbox_position(bbox)
        key = (label, band, position)
        grouped[key] = grouped.get(key, 0) + 1

        items.append(
            {
                "label": label,
                "proximity": proximity,
                "distanceBand": band,
                "position": position,
                "confidence": hazard.get("confidence"),
            }
        )

    phrases: list[str] = []
    ranked_groups = sorted(
        grouped.items(),
        key=lambda item: max(
            float(h.get("proximity", 0))
            for h in hazards
            if str(h.get("label", "")).lower() == item[0][0]
        ),
        reverse=True,
    )
    for (label, band, position), count in ranked_groups:
        noun = label if count == 1 else f"{count} {label}s" if not label.endswith("s") else f"{count} {label}"
        if band == "very close":
            phrases.append(f"{noun} very close {position}")
        elif position == "ahead":
            phrases.append(f"{noun} {band} ahead")
        else:
            phrases.append(f"{noun} {band} {position}")

    summary = ". ".join(p.capitalize() for p in phrases) + "."
    if crowded_summary:
        summary = f"{crowded_summary} {summary}"
    elif any(float(h.get("proximity", 0)) >= stop_threshold for h in hazards):
        summary = f"Please be careful. {summary}"

    needs_careful = crowded or any(
        float(h.get("proximity", 0)) >= stop_threshold for h in hazards
    )
    voice_text = summary if needs_careful else None

    return {
        "summary": summary,
        "voiceText": voice_text,
        "items": items,
        "crowded": crowded,
        "frontCount": front_count,
    }
