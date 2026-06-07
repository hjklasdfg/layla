"""Parse multipart JPEG uploads and run hazard detection."""
from __future__ import annotations

import io
from email import policy
from email.parser import BytesParser
from typing import Any

from PIL import Image

from road_hazard import analyze_frame


def _parse_multipart(body: bytes, content_type: str) -> dict[str, Any]:
    msg = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body
    )
    fields: dict[str, Any] = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        if part.get_filename():
            fields[name] = part.get_payload(decode=True)
        else:
            fields[name] = part.get_content()
    return fields


def decode_jpeg(frame_bytes: bytes) -> Image.Image | None:
    try:
        return Image.open(io.BytesIO(frame_bytes)).convert("RGB")
    except Exception:
        return None


def handle_camera_frame(body: bytes, content_type: str) -> tuple[dict[str, Any] | None, str | None]:
    if "multipart/form-data" not in content_type:
        return None, "multipart/form-data required"

    fields = _parse_multipart(body, content_type)
    frame_bytes = fields.get("frame")
    if not frame_bytes:
        return None, "frame is required"

    frame = decode_jpeg(frame_bytes)
    if frame is None:
        return None, "could not decode JPEG frame"

    index_raw = str(fields.get("frameIndex", "0"))
    frame_index = int(index_raw) if index_raw.isdigit() else 0
    analysis = analyze_frame(frame, frame_index=frame_index)

    return {
        "ok": True,
        "frameIndex": frame_index,
        "bytes": len(frame_bytes),
        **analysis,
    }, None
