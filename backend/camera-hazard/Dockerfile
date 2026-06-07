FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

ENV PORT=8001
ENV CAMERA_HAZARD_DEMO=0
ENV YOLO_MODEL=yolo11n.pt
ENV YOLO_DEVICE=auto
EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health')"

CMD ["python", "server.py"]
