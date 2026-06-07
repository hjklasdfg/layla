"""HTTP delivery channel — POST /hazard/report and SSE /hazard/report/stream."""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agent import run_agent

PORT = int(os.getenv("PORT", "8002"))


def _decode_image(body: dict) -> tuple[str, str | None]:
    if body.get("imagePath"):
        return body["imagePath"], None

    b64 = body.get("imageBase64")
    if not b64:
        raise ValueError("imagePath or imageBase64 required")

    mime = (body.get("mimeType") or "image/jpeg").lower()
    ext = ".jpg" if "jpeg" in mime or mime == "image/jpg" else ".png"
    raw = base64.b64decode(b64)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    tmp.write(raw)
    tmp.close()
    return tmp.name, tmp.name


def report(body: dict, *, stream: bool = False):
    lat = body.get("lat")
    lng = body.get("lng")
    if lat is None or lng is None:
        return None, "lat and lng are required"

    profile = body.get("userProfile") or body.get("user_profile") or "general"
    events: list[dict] = []
    image_path, temp = None, None

    def on_step(step: dict) -> None:
        if stream:
            events.append({"type": "step", "step": step})

    def on_skill(skill_id: str, output: dict) -> None:
        if stream:
            events.append({"type": "skill", "skill": skill_id, "output": output})

    try:
        image_path, temp = _decode_image(body)
        result = run_agent(
            image_path,
            float(lat),
            float(lng),
            user_profile=profile,
            on_step=on_step,
            on_skill=on_skill,
        )
        result["meta"] = {
            "source": "layla-nemoclaw",
            "profile": profile,
            "demo": os.getenv("LAYLA_NEMOCLAW_DEMO", os.getenv("LAYLA_HAZARD_DEMO", "")),
        }
        if stream:
            events.append({"type": "complete", "result": result})
            return events, None
        return result, None
    finally:
        if temp and os.path.exists(temp):
            os.unlink(temp)


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health"):
            self._json(200, {"ok": True, "service": "layla-nemoclaw"})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.rstrip("/")

        if path == "/hazard/report/stream":
            try:
                body = self._read_body()
            except json.JSONDecodeError:
                self._json(400, {"error": "invalid JSON"})
                return

            events, err = report(body, stream=True)
            if err:
                self._json(400, {"error": err})
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            for event in events:
                line = f"data: {json.dumps(event)}\n\n".encode()
                self.wfile.write(line)
                self.wfile.flush()
            return

        if path != "/hazard/report":
            self._json(404, {"error": "not found"})
            return

        try:
            body = self._read_body()
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid JSON"})
            return

        result, err = report(body)
        if err:
            self._json(400, {"error": err})
            return
        self._json(200, result)

    def log_message(self, fmt, *args):
        if os.getenv("NEMOCLAW_SERVER_QUIET") != "1":
            super().log_message(fmt, *args)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"layla-nemoclaw :{PORT}  POST /hazard/report  SSE /hazard/report/stream")
    server.serve_forever()


if __name__ == "__main__":
    main()
