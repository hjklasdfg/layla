#!/usr/bin/env python3
"""Smoke test for camera-hazard service. Run with server up or auto-start via __main__."""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.error
import urllib.request
from PIL import Image

from road_hazard import analyze_frame
from surroundings import describe_surroundings

BASE = os.getenv("CAMERA_HAZARD_TEST_URL", "http://127.0.0.1:8001")


def _get(path: str) -> dict:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=5) as res:
        return json.loads(res.read().decode())


def _post_frame(jpeg_bytes: bytes, frame_index: int = 0) -> dict:
    boundary = "----LaylaCameraHazardTest"
    data = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="frameIndex"\r\n\r\n',
            f"{frame_index}\r\n".encode(),
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="frame"; filename="test.jpg"\r\n',
            b"Content-Type: image/jpeg\r\n\r\n",
            jpeg_bytes,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    req = urllib.request.Request(
        f"{BASE}/camera/frame",
        data=data,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode())


def _make_jpeg_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (320, 240), color=(30, 30, 30)).save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def test_describe_surroundings() -> None:
    empty = describe_surroundings([], stop_threshold=0.72)
    assert "clear" in empty["summary"].lower(), empty

    result = describe_surroundings(
        [
            {
                "label": "person",
                "proximity": 0.8,
                "bbox": {"x1": 0.4, "y1": 0.5, "x2": 0.6, "y2": 0.9},
            },
            {
                "label": "car",
                "proximity": 0.4,
                "bbox": {"x1": 0.05, "y1": 0.1, "x2": 0.2, "y2": 0.25},
            },
        ],
        stop_threshold=0.72,
    )
    assert "person" in result["summary"].lower(), result
    assert len(result["items"]) == 2, result
    print("  describe_surroundings: ok")


def test_demo_analyze_frame() -> None:
    os.environ["CAMERA_HAZARD_DEMO"] = "1"
    img = Image.new("RGB", (640, 480), color=(30, 30, 30))
    close = analyze_frame(img, frame_index=0)
    far = analyze_frame(img, frame_index=1)
    assert close["action"] == "stop", close
    assert far["action"] == "continue", far
    assert len(close["hazards"]) == 1
    assert "bbox" in close["hazards"][0]
    assert close.get("surroundings", {}).get("summary"), close
    print("  analyze_frame (demo): ok")


def test_health() -> None:
    health = _get("/health")
    assert health.get("ok") is True, health
    assert health.get("service") == "camera-hazard"
    print(f"  /health: ok mode={health.get('mode')} demo={health.get('demo')}")


def test_frame_endpoint() -> None:
    result = _post_frame(_make_jpeg_bytes(), 0)
    assert result.get("ok") is True, result
    assert isinstance(result.get("hazards"), list), result
    assert result.get("action") in ("stop", "continue"), result
    print(
        f"  /camera/frame: ok action={result['action']} "
        f"inferenceMs={result.get('meta', {}).get('inferenceMs')}"
    )


def main() -> int:
    os.environ.setdefault("CAMERA_HAZARD_DEMO", "1")
    print("Unit tests:")
    test_describe_surroundings()
    test_demo_analyze_frame()

    print(f"HTTP tests against {BASE}:")
    try:
        test_health()
        test_frame_endpoint()
    except urllib.error.URLError as e:
        print(f"  SKIP http tests — server not running at {BASE}: {e}")
        print("  Start with: CAMERA_HAZARD_DEMO=1 python server.py")
        return 1

    print("All tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
