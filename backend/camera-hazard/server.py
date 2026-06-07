"""Layla camera-hazard service — real-time YOLO hazard detection.

Run:  python server.py
      frontend/.env.local -> CAMERA_HAZARD_API_URL=http://localhost:8001
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from frame_handler import handle_camera_frame
from road_hazard import get_detector_mode, is_demo_mode

PORT = int(os.getenv("PORT", "8001"))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send(204, {})

    def do_GET(self) -> None:
        if not self.path.startswith("/health"):
            return self._send(404, {"error": "GET /health"})

        mode = get_detector_mode()
        model = "demo/local-stub" if mode == "demo" else os.getenv("YOLO_MODEL", "yolo11n.pt")
        payload: dict = {
            "ok": True,
            "service": "camera-hazard",
            "ready": True,
            "demo": is_demo_mode(),
            "mode": mode,
            "model": model,
            "endpoints": ["POST /camera/frame"],
        }

        if mode == "yolo":
            try:
                from yolo_worker import _resolve_device

                payload["yoloDevice"] = _resolve_device(os.getenv("YOLO_DEVICE", "auto"))
            except Exception:
                payload["yoloDevice"] = "cpu"

        self._send(200, payload)

    def do_POST(self) -> None:
        if not self.path.startswith("/camera/frame"):
            return self._send(404, {"error": "POST /camera/frame"})
        self._handle_multipart(handle_camera_frame)

    def _handle_multipart(
        self, handler: Callable[[bytes, str], tuple[dict | None, str | None]]
    ) -> None:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            return self._send(400, {"error": "multipart/form-data required"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n)
            resp, err = handler(body, content_type)
        except Exception as e:
            return self._send(500, {"error": f"camera request failed: {e}"})
        if err:
            return self._send(422, {"error": err})
        self._send(200, resp)

    def log_message(self, *args) -> None:
        sys.stderr.write("  " + (args[0] % args[1:]) + "\n")


if __name__ == "__main__":
    print(f"Layla camera-hazard service on http://localhost:{PORT}")
    print("  POST /camera/frame  ·  GET /health")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
