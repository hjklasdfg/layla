# Camera hazard service (live watch)

Real-time YOLO hazard detection for Layla's live camera watch. The frontend sends JPEG frames every ~300ms to `POST /camera/frame`.

For UI testing without this service, use `CAMERA_HAZARD_FAKE_LOOP=true` in the Next.js frontend instead.

## Install

```bash
cd backend/camera-hazard
python3 -m venv .venv && source .venv/bin/activate
pip install torch   # CUDA build from pytorch.org on GPU hosts
pip install -r requirements.txt
```

## Run

```bash
CAMERA_HAZARD_DEMO=0 YOLO_DEVICE=auto python server.py
```

`YOLO_DEVICE=auto` picks GPU when CUDA is available, otherwise CPU.

Backend smoke test (no YOLO/torch):

```bash
CAMERA_HAZARD_DEMO=1 python server.py
```

```env
# frontend/.env.local
CAMERA_HAZARD_FAKE_LOOP=false
CAMERA_HAZARD_API_URL=http://<spark-ip>:8001
CAMERA_HAZARD_AUTO_START=false
```

## Env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `YOLO_MODEL` | `yolo11n.pt` | Ultralytics weights (auto-downloaded) |
| `YOLO_DEVICE` | `auto` | `auto`, `cpu`, `0`, `cuda:0`, etc. |
| `YOLO_CONF` | `0.35` | Minimum detection confidence |
| `YOLO_IMGSZ` | `640` | Inference size |
| `YOLO_HAZARD_CLASSES` | (built-in set) | Comma-separated COCO classes |
| `HAZARD_STOP_PROXIMITY_THRESHOLD` | `0.9` | Proximity score that triggers stop |
| `HAZARD_CROWDED_FRONT_COUNT` | `5` | Objects ahead before crowded warning |
| `CAMERA_HAZARD_DEMO` | `0` | `1` = synthetic bboxes, no YOLO |

Proximity is estimated from bbox position and size (lower in frame + larger = closer).

## Test

```bash
CAMERA_HAZARD_DEMO=1 python server.py   # terminal 1
python test_integration.py               # terminal 2
```
