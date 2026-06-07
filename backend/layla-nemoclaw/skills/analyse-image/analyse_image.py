"""Skill 1 — analyse image with VLM."""
from __future__ import annotations

import json
import os
import re
from typing import Any

MODEL_ID = os.getenv("LAYLA_VLM_MODEL", "Qwen/Qwen2.5-VL-3B-Instruct")

_VLM_MODEL = None
_VLM_PROCESSOR = None


def is_demo_mode() -> bool:
    demo = os.getenv("LAYLA_NEMOCLAW_DEMO") or os.getenv("LAYLA_HAZARD_DEMO") or ""
    return demo.lower() in ("1", "true", "yes")


def _demo_hazard() -> dict[str, Any]:
    return {
        "hazard_detected": True,
        "hazard_type": "broken tactile paving",
        "severity": "medium",
        "description": "Demo mode: uneven pavement with missing tactile paving near a crossing.",
        "accessibility_impact": "Blind and low-vision pedestrians may miss the crossing cue.",
        "confidence": 0.85,
        "model": "demo",
    }


def _load_vlm():
    global _VLM_MODEL, _VLM_PROCESSOR
    if _VLM_MODEL is not None:
        return _VLM_MODEL, _VLM_PROCESSOR

    from transformers import AutoModelForImageTextToText, AutoProcessor

    _VLM_MODEL = AutoModelForImageTextToText.from_pretrained(
        MODEL_ID,
        torch_dtype="auto",
        device_map="auto",
    )
    _VLM_PROCESSOR = AutoProcessor.from_pretrained(MODEL_ID)
    return _VLM_MODEL, _VLM_PROCESSOR


def run(image_path: str) -> dict[str, Any]:
    """Analyse a road/pavement image. Returns hazard classification JSON."""
    if is_demo_mode():
        return _demo_hazard()

    from qwen_vl_utils import process_vision_info

    model, processor = _load_vlm()

    prompt = """
You are analysing a road/pavement image for public hazards.

Return JSON only with:
{
  "hazard_detected": boolean,
  "hazard_type": string,
  "severity": "low" | "medium" | "high",
  "description": string,
  "accessibility_impact": string,
  "confidence": number
}

Look for potholes, broken pavement, blocked wheelchair access, fallen objects,
flooding, damaged street furniture, dangerous crossings, or road obstruction.
"""

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image_path},
                {"type": "text", "text": prompt},
            ],
        }
    ]

    text = processor.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )

    image_inputs, video_inputs = process_vision_info(messages)

    inputs = processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to(model.device)

    generated_ids = model.generate(**inputs, max_new_tokens=512)
    output = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

    match = re.search(r"\{.*\}", output, re.DOTALL)
    if not match:
        return {
            "hazard_detected": False,
            "hazard_type": "unknown",
            "severity": "low",
            "description": output,
            "accessibility_impact": "Unable to determine clearly.",
            "confidence": 0.3,
            "model": MODEL_ID,
        }

    result = json.loads(match.group(0))
    result["model"] = MODEL_ID
    return result
